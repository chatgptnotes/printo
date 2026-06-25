"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import HeroFallback from "@/components/upload/HeroFallback";
import { EventLog, ProgressBar } from "@/components/pipeline/EventLog";
import { useUploadStream } from "@/components/pipeline/useUploadStream";
import { usePrintoStore } from "@/lib/store";
import {
  FLOOR_CATEGORIES,
  MARQUEE_TAGS,
  SAMPLE_DRAWINGS,
  STEP_CARDS,
} from "@/lib/constants";

const Hero3D = dynamic(() => import("@/components/upload/Hero3D"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted">
      Loading 3D model…
    </div>
  ),
});

interface BatchItem {
  name: string;
  drawingId: number | null;
  verdict: string | null;
}

export default function UploadPage() {
  const router = useRouter();
  const setLastResult = usePrintoStore((s) => s.setLastResult);
  const strict = usePrintoStore((s) => s.strict);
  const setStrict = usePrintoStore((s) => s.setStrict);

  const [floor, setFloor] = useState(FLOOR_CATEGORIES[0]);
  const [projectDescription, setProjectDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  // Batch progress (multi-file) — null when not running a batch.
  const [batch, setBatch] = useState<{ index: number; total: number; name: string } | null>(null);
  const [batchResults, setBatchResults] = useState<BatchItem[]>([]);

  const { lines, progress, phase, error, start } = useUploadStream();

  // Process a list sequentially (the backend handles one drawing at a time).
  // A single file navigates straight to its result; multiple files show a batch
  // summary with a link to each.
  async function processFiles(list: File[], floorCat: string, desc: string) {
    if (!list.length) return;
    setBatchResults([]);

    if (list.length === 1) {
      const r = await start(list[0], list[0].name, floorCat, strict, desc);
      if (r) {
        setLastResult(r);
        router.push(`/results/${r.drawing_id}`);
      }
      return;
    }

    const acc: BatchItem[] = [];
    for (let i = 0; i < list.length; i++) {
      setBatch({ index: i + 1, total: list.length, name: list[i].name });
      const r = await start(list[i], list[i].name, floorCat, strict, desc);
      if (r) {
        setLastResult(r);
        acc.push({ name: list[i].name, drawingId: r.drawing_id, verdict: r.verdict });
      } else {
        acc.push({ name: list[i].name, drawingId: null, verdict: null });
      }
      setBatchResults([...acc]);
    }
    setBatch(null);
  }

  async function onSample(s: (typeof SAMPLE_DRAWINGS)[number]) {
    const res = await fetch(`/samples/${s.file}`);
    if (!res.ok) {
      alert("Sample not available.");
      return;
    }
    const blob = await res.blob();
    const r = await start(blob as File, s.file, s.floor, strict, projectDescription);
    if (r) {
      setLastResult(r);
      router.push(`/results/${r.drawing_id}`);
    }
  }

  const streaming = phase === "streaming";
  const busy = streaming || batch !== null;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative grid grid-cols-1 gap-6 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-[#0b1326] via-surface to-[#0a1020] p-8 shadow-hero lg:grid-cols-2">
        <div className="flex flex-col justify-center">
          <span className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-accent-orange/40 px-3 py-1 text-xs font-semibold text-accent-orange">
            <span className="h-2 w-2 animate-pulse2 rounded-full bg-accent-orange" />
            AI Compliance &amp; Extraction Gateway
          </span>
          <h1 className="text-4xl font-black leading-tight md:text-5xl">
            Construction Drawings,{" "}
            <span className="text-grad">Read &amp; Verified</span> by AI
          </h1>
          <p className="mt-3 max-w-md text-muted">
            Upload an approved drawing — ERP RealSoft extracts the title block, validates
            it against 18 rules, and pushes clean data to RealSoft.
          </p>
          <div className="mt-5 flex gap-6 text-sm">
            <div>
              <div className="text-xl font-bold text-accent-orange">~14s</div>
              <div className="text-muted">per drawing</div>
            </div>
            <div>
              <div className="text-xl font-bold text-accent-orange">26+</div>
              <div className="text-muted">fields</div>
            </div>
            <div>
              <div className="text-xl font-bold text-accent-orange">18</div>
              <div className="text-muted">rules</div>
            </div>
          </div>
        </div>
        <div className="relative h-[300px] overflow-hidden rounded-xl border border-border bg-[#05080f] lg:h-[360px]">
          <ErrorBoundary fallback={<HeroFallback />}>
            <Hero3D />
          </ErrorBoundary>
          <span className="pointer-events-none absolute left-3 top-3 text-xs text-accent-orange">
            ● Live 3D Model
          </span>
        </div>
      </section>

      {/* Marquee */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface py-2">
        <div className="flex w-max animate-marquee gap-3 whitespace-nowrap">
          {[...MARQUEE_TAGS, ...MARQUEE_TAGS].map((t, i) => (
            <span
              key={i}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted"
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* Steps */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEP_CARDS.map((s) => (
          <Card key={s.n} className="transition-transform hover:-translate-y-1 hover:border-accent-orange/50 hover:shadow-orange-glow">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-accent-orange to-accent-orange-light font-black text-[#0b1326]">
              {s.n}
            </div>
            <h3 className="font-bold">{s.title}</h3>
            <p className="mt-1 text-sm text-muted">{s.body}</p>
          </Card>
        ))}
      </div>

      {/* Live pipeline (shown while streaming or after) */}
      {(streaming || lines.length > 0) && (
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold">Compilation in progress</h2>
            {batch && (
              <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-accent-orange">
                Drawing {batch.index} of {batch.total}
                <span className="ml-2 max-w-[220px] truncate align-middle text-muted">
                  {batch.name}
                </span>
              </span>
            )}
          </div>
          <EventLog lines={lines} />
          <ProgressBar value={progress} />
          {error && <p className="mt-2 text-sm text-result-fail">{error}</p>}
        </Card>
      )}

      {/* Batch summary (after a multi-file run completes) */}
      {!batch && batchResults.length > 0 && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">
              Batch complete — {batchResults.filter((b) => b.drawingId !== null).length}/
              {batchResults.length} processed
            </h2>
            <Link
              href="/history"
              className="rounded-[10px] border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold hover:border-accent-orange/50"
            >
              View all in History →
            </Link>
          </div>
          <div className="space-y-2">
            {batchResults.map((b, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-surface-2 px-4 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{b.name}</span>
                {b.drawingId !== null ? (
                  <>
                    <span
                      className={`text-xs font-semibold ${
                        b.verdict === "FAILED" || b.verdict === "ERROR"
                          ? "text-result-fail"
                          : b.verdict === "WARNING"
                            ? "text-accent-orange"
                            : "text-[#6ee7b7]"
                      }`}
                    >
                      {b.verdict ?? "DONE"}
                    </span>
                    <Link
                      href={`/results/${b.drawingId}`}
                      className="rounded-[10px] bg-accent-orange px-3 py-1 text-xs font-bold text-[#0b1326]"
                    >
                      Review
                    </Link>
                  </>
                ) : (
                  <span className="text-xs font-semibold text-result-fail">Failed</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Upload + samples */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-bold">Upload drawings</h2>
          <label className="mb-1 block text-xs font-semibold text-muted">
            Brief project description <span className="text-dim">(optional)</span>
          </label>
          <textarea
            rows={3}
            value={projectDescription}
            onChange={(e) => setProjectDescription(e.target.value)}
            maxLength={500}
            placeholder="e.g. G+2 residential villa, Plot 14, Whitefield — RCC frame, interior fit-out scope"
            className="mb-1 w-full resize-none rounded-[10px] border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none placeholder:text-dim focus:border-accent-orange"
          />
          <p className="mb-4 text-right text-xs text-dim">
            {projectDescription.length}/500
          </p>

          <label className="mb-1 block text-xs font-semibold text-muted">
            Floor / Category
          </label>
          <select
            className="mb-4 w-full rounded-[10px] border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent-orange"
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
          >
            {FLOOR_CATEGORIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>

          <input
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif,.dwg,.dxf,.dwf"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="mb-2 block w-full text-sm text-muted file:mr-3 file:rounded-[10px] file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:text-sm file:text-text"
          />

          {files.length > 0 && (
            <div className="mb-3 max-h-32 space-y-1 overflow-y-auto rounded-[10px] border border-border bg-surface-2 px-3 py-2">
              <p className="text-xs font-semibold text-muted">
                {files.length} file{files.length > 1 ? "s" : ""} selected
                {files.length > 1 ? " — processed one by one" : ""}
              </p>
              {files.map((f, i) => (
                <div key={i} className="flex justify-between gap-2 text-xs text-muted">
                  <span className="min-w-0 truncate">{f.name}</span>
                  <span className="shrink-0">{(f.size / (1024 * 1024)).toFixed(1)} MB</span>
                </div>
              ))}
            </div>
          )}

          <label className="mb-4 flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={strict}
              onChange={(e) => setStrict(e.target.checked)}
            />
            Strict mode (treat warnings as errors)
          </label>

          <Button
            variant="primary"
            fullWidth
            disabled={!files.length || busy}
            onClick={() => processFiles(files, floor, projectDescription)}
          >
            {batch
              ? `Processing ${batch.index}/${batch.total}…`
              : streaming
                ? "Processing…"
                : files.length > 1
                  ? `Process ${files.length} drawings`
                  : "Process Drawing"}
          </Button>
        </Card>

        <Card>
          <h2 className="mb-4 font-bold">Try a sample drawing</h2>
          <div className="space-y-3">
            {SAMPLE_DRAWINGS.map((s) => (
              <button
                key={s.file}
                disabled={busy}
                onClick={() => onSample(s)}
                className="flex w-full items-center gap-3 rounded-[10px] border border-border bg-surface-2 px-4 py-3 text-left transition-colors hover:border-accent-orange/50 disabled:opacity-50"
              >
                <span className="text-xl">{s.icon}</span>
                <span>
                  <span className="block text-sm font-semibold">{s.label}</span>
                  <span className="block text-xs text-muted">{s.floor}</span>
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
