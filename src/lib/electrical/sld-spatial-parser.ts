/**
 * Spatial SLD parser — uses pdfjs-dist to extract text items WITH coordinates
 * from electrical schematic PDFs, then clusters labels to find:
 *   • Drawing scale (Step 4)        — search "1:NN" or "SCALE 1:NN"
 *   • MDB / LV-Panel info (Step 5)  — find tag, then nearest amp rating
 *   • SMDB inventory (Step 7)       — every SMDB tag + rating + cable size in
 *                                      a small bounding box around it
 *   • SMDB→DB mappings (Step 11)    — DB tags clustered around each SMDB tag
 *
 * Falls back gracefully: if pdfjs fails or the PDF has no embedded text (i.e.
 * it's a scan), returns null and callers continue using the regex-only
 * `runElectricalPrePass()`.
 *
 * Vercel safety: pdfjs-dist v4 legacy build is pure JS, no worker thread
 * needed (we pass disableWorker:true). No native deps.
 */

interface PdfItem {
  str: string;
  page: number;
  x: number;
  y: number;
}

export interface SldSpatialResult {
  drawing_scale: string | null;
  mdb_info: { tag: string | null; rating_a: number | null };
  smdb_inventory: Array<{ id: string; rating_a: number | null; cable_size_from_mdb: string | null; page: number }>;
  smdb_to_db_map: Array<{ smdb_id: string; db_ids: string[] }>;
  pages_parsed: number;
  source: 'sld-spatial';
}

const SCALE_RE = /\b(?:scale\s*)?1\s*[:×x]\s*(\d{2,4})\b/i;
const SMDB_RE = /^SMDB[-\s]?[A-Z0-9]{1,8}(?:-[A-Z0-9]{1,4})?$/i;
const MDB_RE = /^(?:LVP[-\s]?\d{1,3}|MDB[-\s]?\d{0,3}|MAIN\s+DB)$/i;
const DB_RE = /^DB[-\s]?[A-Z]?\d{1,3}[A-Z]?$/i;
const AMPS_RE = /^(\d{2,4})\s*A$/i;
const CABLE_RE = /^(\d)\s*[Cc]\s*[x×]?\s*(\d+(?:\.\d+)?)\s*mm[²2]?$/i;

const PROXIMITY_PX = 80; // labels within this radius (PDF user-space) are "near"

/**
 * Parse a PDF buffer and extract structured electrical findings using spatial
 * clustering of text items.
 *
 * Returns null if pdfjs throws or the document has no text items at all.
 */
export async function parseSldSpatial(buffer: Buffer, maxPages = 8): Promise<SldSpatialResult | null> {
  try {
    // Dynamic import keeps pdfjs out of the cold-start path for routes that
    // don't need it. Legacy build is the Node-friendly one.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0,
    });
    const doc = await loadingTask.promise;
    const pageLimit = Math.min(doc.numPages, maxPages);
    const items: PdfItem[] = [];

    for (let p = 1; p <= pageLimit; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      for (const it of content.items as Array<{ str?: string; transform?: number[] }>) {
        const str = (it.str ?? '').trim();
        if (!str) continue;
        const tr = it.transform ?? [0, 0, 0, 0, 0, 0];
        items.push({ str, page: p, x: tr[4] ?? 0, y: tr[5] ?? 0 });
      }
      page.cleanup();
    }

    if (items.length === 0) return null;

    return analyseItems(items, pageLimit);
  } catch (err) {
    console.warn('[sld-spatial] parse failed:', (err as Error).message);
    return null;
  }
}

function analyseItems(items: PdfItem[], pages_parsed: number): SldSpatialResult {
  let drawing_scale: string | null = null;
  let mdb_tag: string | null = null;
  let mdb_rating: number | null = null;
  const smdbMap = new Map<string, { rating_a: number | null; cable: string | null; page: number; x: number; y: number }>();
  const dbItems: Array<{ id: string; page: number; x: number; y: number }> = [];

  for (const it of items) {
    if (!drawing_scale) {
      const m = it.str.match(SCALE_RE);
      if (m) drawing_scale = `1:${m[1]}`;
    }

    if (!mdb_tag && MDB_RE.test(it.str)) {
      mdb_tag = it.str.toUpperCase().replace(/\s+/g, '-');
      const nearAmps = findNearby(items, it, AMPS_RE);
      if (nearAmps) mdb_rating = parseInt(nearAmps[1], 10);
    }

    if (SMDB_RE.test(it.str)) {
      const id = it.str.toUpperCase().replace(/\s+/g, '-');
      if (!smdbMap.has(id)) {
        const nearAmps = findNearby(items, it, AMPS_RE);
        const nearCable = findNearby(items, it, CABLE_RE);
        smdbMap.set(id, {
          rating_a: nearAmps ? parseInt(nearAmps[1], 10) : null,
          cable: nearCable ? `${nearCable[1]}C×${nearCable[2]}mm²` : null,
          page: it.page,
          x: it.x,
          y: it.y,
        });
      }
    }

    if (DB_RE.test(it.str) && !it.str.toUpperCase().startsWith('SMDB')) {
      const id = it.str.toUpperCase().replace(/\s+/g, '-');
      dbItems.push({ id, page: it.page, x: it.x, y: it.y });
    }
  }

  // Cluster DBs to nearest SMDB on the same page; falls back to first SMDB if
  // none on the same page.
  const smdb_to_db_map: SldSpatialResult['smdb_to_db_map'] = [];
  for (const [smdbId, smdb] of smdbMap.entries()) {
    const dbIds = new Set<string>();
    for (const db of dbItems) {
      if (db.page !== smdb.page) continue;
      const dx = db.x - smdb.x;
      const dy = db.y - smdb.y;
      if (dx * dx + dy * dy <= PROXIMITY_PX * PROXIMITY_PX * 4) dbIds.add(db.id);
    }
    smdb_to_db_map.push({ smdb_id: smdbId, db_ids: [...dbIds] });
  }

  return {
    drawing_scale,
    mdb_info: { tag: mdb_tag, rating_a: mdb_rating },
    smdb_inventory: [...smdbMap.entries()].map(([id, v]) => ({
      id,
      rating_a: v.rating_a,
      cable_size_from_mdb: v.cable,
      page: v.page,
    })),
    smdb_to_db_map,
    pages_parsed,
    source: 'sld-spatial',
  };
}

/**
 * Find the first text item whose centre is within PROXIMITY_PX of `anchor`
 * (same page only) AND matches the regex. Returns the regex match groups.
 */
function findNearby(items: PdfItem[], anchor: PdfItem, re: RegExp): RegExpMatchArray | null {
  let best: { dist: number; m: RegExpMatchArray } | null = null;
  for (const it of items) {
    if (it.page !== anchor.page) continue;
    if (it === anchor) continue;
    const dx = it.x - anchor.x;
    const dy = it.y - anchor.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > PROXIMITY_PX * PROXIMITY_PX) continue;
    const m = it.str.match(re);
    if (m && (!best || distSq < best.dist)) best = { dist: distSq, m };
  }
  return best?.m ?? null;
}
