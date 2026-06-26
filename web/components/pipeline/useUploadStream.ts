"use client";

import { useRef, useState } from "react";
import type { DonePayload, EventType } from "@/lib/types";

// Vercel functions cap request bodies at 4.5 MB. Files at or under the cap go
// to the same-origin BFF `/api/upload` in one request; larger files upload in
// sub-cap chunks via `/api/upload-chunk` and are assembled by the backend on
// finalize. Everything stays same-origin (browser → Vercel → VPS) — the browser
// never connects to the VPS directly.
const VERCEL_BODY_LIMIT = 4 * 1024 * 1024; // 4 MB (margin under Vercel's 4.5 MB)
const CHUNK_SIZE = 3.5 * 1024 * 1024; // 3.5 MB per chunk

// A chunk POST can hit a transient gateway timeout (504) even when the backend
// actually succeeds, so we retry the WHOLE chunk sequence (not a single part):
// each attempt uses a fresh upload_id, and chunk 0 opens the .part in "wb" which
// truncates — so a restart never double-appends and corrupts the assembled file.
const CHUNK_MAX_ATTEMPTS = 3;
const CHUNK_TRANSIENT_STATUS = new Set([502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function newUploadId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

export interface LogLine {
  text: string;
  type: EventType;
}

type Phase = "idle" | "streaming" | "done" | "error";

function progressFor(text: string, current: number): number {
  if (/R0[123]/.test(text)) return Math.min(current + 5, 15);
  if (/Blur Check/i.test(text)) return Math.min(current + 3, 18);
  if (/Pre-pass/i.test(text)) return Math.min(current + 5, 25);
  if (/Claude|AI Processing|Extraction/i.test(text)) return Math.min(current + 15, 70);
  if (/BOQ|Quantit|Take-off|Extraction Complete/i.test(text)) return Math.min(current + 4, 85);
  if (/ERP|Mapping/i.test(text)) return Math.min(current + 3, 92);
  if (/Verification|Approval|Review|Report/i.test(text)) return Math.min(current + 3, 97);
  return Math.min(current + 1, 96);
}

export function useUploadStream() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  // Processes one file and resolves with its final result (or null on
  // error/timeout), so callers can await it and process files sequentially.
  async function start(
    file: Blob,
    fileName: string,
    floorCategory: string,
    strict: boolean,
    projectDescription = "",
    discipline = "",
  ): Promise<DonePayload | null> {
    if (busy.current) return null;
    busy.current = true;
    setProgress(2);
    setError(null);
    setPhase("streaming");

    // Visible step log so the flow is transparent (and failures aren't hidden).
    const push = (text: string, type: EventType = "info") =>
      setLines((prev) => [...prev, { text, type }]);

    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    setLines([{ text: `Uploading ${fileName} (${sizeMB} MB)…`, type: "info" }]);

    try {
      const form = new FormData();
      form.append("file", file, fileName);
      form.append("floor_category", floorCategory);
      form.append("strict", String(strict));
      form.append("project_description", projectDescription);
      form.append("discipline", discipline);

      let resp: Response;
      if (file.size <= VERCEL_BODY_LIMIT) {
        // Small file: one same-origin request to the BFF.
        try {
          resp = await fetch("/api/upload", { method: "POST", body: form });
        } catch (e) {
          throw new Error(
            "Couldn't reach the server" +
              (e instanceof Error && e.message ? ` (${e.message})` : "") + ".",
          );
        }
      } else {
        // Large file: upload in sub-cap chunks, then finalize (assemble + run).
        const total = Math.ceil(file.size / CHUNK_SIZE);
        push(`Large file (${sizeMB} MB) — uploading in ${total} parts…`);

        // Upload all chunks; on a transient failure restart the whole sequence
        // with a fresh upload_id (chunk 0 truncates, so no double-append).
        // Returns the upload_id of the successful sequence for the finalize step.
        const uploadAllChunks = async (): Promise<string> => {
          for (let attempt = 1; attempt <= CHUNK_MAX_ATTEMPTS; attempt++) {
            const uploadId = newUploadId();
            try {
              for (let i = 0; i < total; i++) {
                const cForm = new FormData();
                cForm.append("upload_id", uploadId);
                cForm.append("index", String(i));
                cForm.append("chunk", file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE), fileName);
                const cRes = await fetch("/api/upload-chunk", { method: "POST", body: cForm });
                if (!cRes.ok) {
                  // Transient gateway timeouts are retried; hard rejections fail fast.
                  if (CHUNK_TRANSIENT_STATUS.has(cRes.status) && attempt < CHUNK_MAX_ATTEMPTS) {
                    throw { transient: true as const, part: i + 1, status: cRes.status };
                  }
                  throw new Error(`Part ${i + 1}/${total} rejected (HTTP ${cRes.status}).`);
                }
                setProgress(Math.min(2 + Math.round(((i + 1) / total) * 10), 12));
                push(`Uploaded ${i + 1}/${total} parts…`);
              }
              return uploadId; // whole sequence succeeded
            } catch (e) {
              // A thrown TypeError is a network failure (also transient).
              const transient =
                (typeof e === "object" && e !== null && "transient" in e) || e instanceof TypeError;
              if (transient && attempt < CHUNK_MAX_ATTEMPTS) {
                push(
                  `Network hiccup — retrying upload (attempt ${attempt + 1}/${CHUNK_MAX_ATTEMPTS})…`,
                  "warning",
                );
                setProgress(2);
                await sleep(800 * attempt);
                continue; // restart the sequence with a fresh upload_id
              }
              if (e instanceof Error) throw e;
              throw new Error(`Upload interrupted while sending parts to the server.`);
            }
          }
          throw new Error("Upload failed after several attempts — please try again.");
        };

        const uploadId = await uploadAllChunks();

        const finForm = new FormData();
        finForm.append("upload_id", uploadId);
        finForm.append("file_name", fileName);
        finForm.append("floor_category", floorCategory);
        finForm.append("strict", String(strict));
        finForm.append("project_description", projectDescription);
        finForm.append("discipline", discipline);
        try {
          resp = await fetch("/api/upload", { method: "POST", body: finForm });
        } catch (e) {
          throw new Error(
            "Couldn't finalize upload" +
              (e instanceof Error && e.message ? ` (${e.message})` : "") + ".",
          );
        }
      }
      const upJson = await resp.json().catch(() => null);
      if (!resp.ok || !upJson || !upJson.drawing_id) {
        throw new Error((upJson && upJson.detail) || `Upload failed (HTTP ${resp.status})`);
      }
      const drawingId: number = upJson.drawing_id;
      push("Extracting — multi-sheet drawings take a few minutes…", "success");

      // The pipeline runs in a background job; poll for step-log lines + the result.
      let since = 0;
      let prog = 12;
      let netFails = 0;
      const startedAt = Date.now();
      const MAX_POLL_MS = 30 * 60 * 1000; // 30-minute safety guard

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (Date.now() - startedAt > MAX_POLL_MS) {
          throw new Error("Timed out waiting for the drawing to finish processing.");
        }
        await sleep(1500);
        let pollResp: Response;
        try {
          pollResp = await fetch(`/api/drawings/${drawingId}/events?since=${since}`);
        } catch {
          if (++netFails > 12) throw new Error("Lost connection to the server.");
          continue;
        }
        if (!pollResp.ok) {
          if (++netFails > 12) throw new Error(`Status check failed (HTTP ${pollResp.status}).`);
          continue;
        }
        netFails = 0;
        const j = await pollResp.json().catch(() => null);
        if (!j) continue;
        for (const ln of j.lines || []) {
          const t = (ln.type || "info") as EventType;
          setLines((prev) => [...prev, { text: ln.text as string, type: t }]);
          prog = progressFor(ln.text, prog);
          setProgress(prog);
        }
        if (typeof j.next === "number") since = j.next;
        if (j.done && j.done.verdict) {
          if (["FAILED", "ERROR", "TIMEOUT"].includes(String(j.done.verdict))) {
            const lastError = [...(j.lines || [])]
              .reverse()
              .find((ln) => ln?.type === "error" && ln?.text);
            throw new Error(lastError?.text || `Processing failed (${j.done.verdict}).`);
          }
          setProgress(100);
          setPhase("done");
          busy.current = false;
          return j.done as DonePayload;
        }
        if (j.phase === "error") {
          throw new Error(j.detail || "Processing failed.");
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setPhase("error");
      setError(msg);
      push(msg, "error");
    } finally {
      busy.current = false;
    }
    return null;
  }

  return { lines, progress, phase, error, start };
}
