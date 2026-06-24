"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
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

export default function UploadPage() {
  const router = useRouter();
  const setLastResult = usePrintoStore((s) => s.setLastResult);
  const strict = usePrintoStore((s) => s.strict);
  const setStrict = usePrintoStore((s) => s.setStrict);

  const [floor, setFloor] = useState(FLOOR_CATEGORIES[0]);
  const [file, setFile] = useState<File | null>(null);

  const { lines, progress, phase, error, start } = useUploadStream((payload) => {
    setLastResult(payload);
    router.push(`/results/${payload.drawing_id}`);
  });

  async function processFile(blob: Blob, name: string, floorCat: string) {
    await start(blob, name, floorCat, strict);
  }

  async function onSample(s: (typeof SAMPLE_DRAWINGS)[number]) {
    const res = await fetch(`/samples/${s.file}`);
    if (!res.ok) {
      alert("Sample not available.");
      return;
    }
    const blob = await res.blob();
    await processFile(blob, s.file, s.floor);
  }

  const streaming = phase === "streaming";

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
          <Hero3D />
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
          <h2 className="mb-2 font-bold">Compilation in progress</h2>
          <EventLog lines={lines} />
          <ProgressBar value={progress} />
          {error && <p className="mt-2 text-sm text-result-fail">{error}</p>}
        </Card>
      )}

      {/* Upload + samples */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-bold">Upload a drawing</h2>
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
            accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif,.dwg,.dxf,.dwf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mb-4 block w-full text-sm text-muted file:mr-3 file:rounded-[10px] file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:text-sm file:text-text"
          />

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
            disabled={!file || streaming}
            onClick={() => file && processFile(file, file.name, floor)}
          >
            {streaming ? "Processing…" : "Process Drawing"}
          </Button>
        </Card>

        <Card>
          <h2 className="mb-4 font-bold">Try a sample drawing</h2>
          <div className="space-y-3">
            {SAMPLE_DRAWINGS.map((s) => (
              <button
                key={s.file}
                disabled={streaming}
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
