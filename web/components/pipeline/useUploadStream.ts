"use client";

import { useRef, useState } from "react";
import type { DonePayload, EventType, StreamEvent } from "@/lib/types";

// Vercel functions cap request bodies at 4.5 MB. Files at or under the cap go
// to the same-origin BFF `/api/upload` in one request; larger files upload in
// sub-cap chunks via `/api/upload-chunk` and are assembled by the backend on
// finalize. Everything stays same-origin (browser → Vercel → VPS) — the browser
// never connects to the VPS directly.
const VERCEL_BODY_LIMIT = 4 * 1024 * 1024; // 4 MB (margin under Vercel's 4.5 MB)
const CHUNK_SIZE = 3.5 * 1024 * 1024; // 3.5 MB per chunk

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
  if (/Validation|R1\d/.test(text)) return Math.min(current + 4, 85);
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
        const uploadId = newUploadId();
        const total = Math.ceil(file.size / CHUNK_SIZE);
        push(`Large file (${sizeMB} MB) — uploading in ${total} parts…`);
        for (let i = 0; i < total; i++) {
          const cForm = new FormData();
          cForm.append("upload_id", uploadId);
          cForm.append("index", String(i));
          cForm.append("chunk", file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE), fileName);
          let cRes: Response;
          try {
            cRes = await fetch("/api/upload-chunk", { method: "POST", body: cForm });
          } catch (e) {
            throw new Error(
              `Upload interrupted at part ${i + 1}/${total}` +
                (e instanceof Error && e.message ? ` (${e.message})` : "") + ".",
            );
          }
          if (!cRes.ok) throw new Error(`Part ${i + 1}/${total} rejected (HTTP ${cRes.status}).`);
          setProgress(Math.min(2 + Math.round(((i + 1) / total) * 10), 12));
          push(`Uploaded ${i + 1}/${total} parts…`);
        }
        const finForm = new FormData();
        finForm.append("upload_id", uploadId);
        finForm.append("file_name", fileName);
        finForm.append("floor_category", floorCategory);
        finForm.append("strict", String(strict));
        finForm.append("project_description", projectDescription);
        try {
          resp = await fetch("/api/upload", { method: "POST", body: finForm });
        } catch (e) {
          throw new Error(
            "Couldn't finalize upload" +
              (e instanceof Error && e.message ? ` (${e.message})` : "") + ".",
          );
        }
      }
      if (!resp.ok || !resp.body) {
        const d = await resp.json().catch(() => ({ detail: `Upload failed (HTTP ${resp.status})` }));
        throw new Error(d.detail || `Upload failed (HTTP ${resp.status})`);
      }
      push("Extracting — this can take up to ~90s for large drawings…", "success");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let prog = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const raw of parts) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          let ev: StreamEvent;
          try {
            ev = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (ev.type === "done" && ev.verdict) {
            setProgress(100);
            setPhase("done");
            busy.current = false;
            return ev as DonePayload;
          }
          if (ev.line) {
            const t = ev.type || "info";
            setLines((prev) => [...prev, { text: ev.line as string, type: t }]);
            prog = progressFor(ev.line, prog);
            setProgress(prog);
          }
        }
      }
      // stream ended without an explicit done
      setPhase("error");
      const endMsg = "The pipeline stream ended unexpectedly.";
      setError(endMsg);
      push(endMsg, "error");
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
