"use client";

import { useRef, useState } from "react";
import type { DonePayload, EventType, StreamEvent } from "@/lib/types";

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

export function useUploadStream(onDone: (p: DonePayload) => void) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  async function start(file: Blob, fileName: string, floorCategory: string, strict: boolean) {
    if (busy.current) return;
    busy.current = true;
    setLines([]);
    setProgress(0);
    setError(null);
    setPhase("streaming");

    try {
      const form = new FormData();
      form.append("file", file, fileName);
      form.append("floor_category", floorCategory);
      form.append("strict", String(strict));

      const resp = await fetch("/api/upload", { method: "POST", body: form });
      if (!resp.ok || !resp.body) {
        const d = await resp.json().catch(() => ({ detail: "Upload failed" }));
        throw new Error(d.detail || "Upload failed");
      }

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
            onDone(ev as DonePayload);
            busy.current = false;
            return;
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
      setError("The pipeline stream ended unexpectedly.");
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      busy.current = false;
    }
  }

  return { lines, progress, phase, error, start };
}
