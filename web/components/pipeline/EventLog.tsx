"use client";

import { useEffect, useRef } from "react";
import type { LogLine } from "./useUploadStream";

export function EventLog({ lines }: { lines: LogLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [lines]);

  return (
    <div className="term" ref={ref}>
      {lines.length === 0 ? (
        <div className="event-line event-info">Waiting for pipeline…</div>
      ) : (
        lines.map((l, i) => (
          <div key={i} className={`event-line event-${l.type}`}>
            {l.text}
          </div>
        ))
      )}
    </div>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className="h-full bg-accent-orange transition-all duration-300"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
