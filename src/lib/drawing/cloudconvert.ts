/**
 * CloudConvert DWG → PDF fallback.
 *
 * Used only when the free in-process LibreDWG-WASM path (see `dwg-converter.ts`)
 * fails to produce usable DXF text. CloudConvert renders the DWG to a real PDF
 * which then goes through full vision scanning — higher fidelity than the
 * text-only WASM path, but it's a paid external round-trip, so it's the safety
 * net, never the default.
 *
 * Degrades gracefully: if `CLOUDCONVERT_API_KEY` is not set, `convertDwgToPdf`
 * returns null and the caller falls back to skipping the file with guidance.
 */

const API = 'https://api.cloudconvert.com/v2';

// Cap the whole round-trip so a slow conversion can't blow the lambda budget.
const CONVERT_TIMEOUT_MS = Number(process.env.CLOUDCONVERT_TIMEOUT_MS) || 90_000;

interface CcTask {
  name: string;
  operation: string;
  status: string;
  result?: {
    form?: { url: string; parameters: Record<string, string> };
    files?: Array<{ url: string; filename: string }>;
  };
}
interface CcJob {
  id: string;
  status: string;
  tasks: CcTask[];
}

/**
 * Convert a DWG buffer to a PDF buffer via CloudConvert.
 * Returns null when no API key is configured (feature simply off).
 * Throws on a genuine conversion/transport failure so the caller can log it.
 */
export async function convertDwgToPdf(buffer: Buffer, filename: string): Promise<Buffer | null> {
  const key = process.env.CLOUDCONVERT_API_KEY;
  if (!key) return null;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CONVERT_TIMEOUT_MS);
  const auth = { Authorization: `Bearer ${key}` };

  try {
    // 1. Create a job: upload → convert(dwg→pdf) → export url.
    const jobRes = await fetch(`${API}/jobs`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        tasks: {
          'import-dwg': { operation: 'import/upload' },
          'convert-dwg': {
            operation: 'convert',
            input: 'import-dwg',
            input_format: 'dwg',
            output_format: 'pdf',
          },
          'export-pdf': { operation: 'export/url', input: 'convert-dwg' },
        },
      }),
    });
    if (!jobRes.ok) {
      throw new Error(`CloudConvert job create failed: ${jobRes.status} ${(await jobRes.text()).slice(0, 200)}`);
    }
    const job: CcJob = (await jobRes.json()).data;

    // 2. Upload the DWG to the import task's signed form.
    const importTask = job.tasks.find(t => t.name === 'import-dwg');
    const form = importTask?.result?.form;
    if (!form) throw new Error('CloudConvert import task returned no upload form');

    const fd = new FormData();
    for (const [k, v] of Object.entries(form.parameters)) fd.append(k, v);
    fd.append('file', new Blob([new Uint8Array(buffer)]), filename);
    const upRes = await fetch(form.url, { method: 'POST', body: fd, signal: ac.signal });
    if (!upRes.ok) throw new Error(`CloudConvert upload failed: ${upRes.status}`);

    // 3. Block until the job finishes (CloudConvert long-poll).
    const waitRes = await fetch(`${API}/jobs/${job.id}/wait`, { headers: auth, signal: ac.signal });
    if (!waitRes.ok) throw new Error(`CloudConvert wait failed: ${waitRes.status}`);
    const done: CcJob = (await waitRes.json()).data;
    if (done.status !== 'finished') {
      throw new Error(`CloudConvert job ended with status "${done.status}"`);
    }

    // 4. Download the exported PDF.
    const exportTask = done.tasks.find(t => t.name === 'export-pdf');
    const fileUrl = exportTask?.result?.files?.[0]?.url;
    if (!fileUrl) throw new Error('CloudConvert export task returned no file URL');
    const fileRes = await fetch(fileUrl, { signal: ac.signal });
    if (!fileRes.ok) throw new Error(`CloudConvert download failed: ${fileRes.status}`);
    return Buffer.from(await fileRes.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}
