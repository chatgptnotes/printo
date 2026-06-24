"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { DrawingSummary } from "@/lib/types";

export default function HistoryPage() {
  const [drawings, setDrawings] = useState<DrawingSummary[] | null>(null);
  const [error, setError] = useState(false);

  function load() {
    setError(false);
    setDrawings(null);
    fetch("/api/drawings")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setDrawings)
      .catch(() => setError(true));
  }

  useEffect(load, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-lg font-bold">Processing History</h1>
        <Button variant="secondary" onClick={load}>
          🔄 Refresh
        </Button>
        <Link href="/report/project">
          <Button variant="secondary">📊 Project Summary Report</Button>
        </Link>
        <a href="/api/report/project/pdf" download="erp_realsoft_project_report.pdf" target="_blank" rel="noreferrer">
          <Button variant="primary">⬇️ Project PDF</Button>
        </a>
      </div>

      {error && <p className="text-result-fail">Backend not reachable.</p>}
      {!drawings && !error && <p className="text-muted">Loading…</p>}
      {drawings && drawings.length === 0 && (
        <p className="text-muted">No drawings processed yet.</p>
      )}

      <div className="space-y-2">
        {drawings?.map((d) => (
          <details
            key={d.id}
            className="rounded-xl border border-border bg-surface px-4 py-3"
          >
            <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
              <span className="font-semibold">#{d.id}</span>
              <span className="text-muted">{d.file_name}</span>
              <span className="text-muted">· {d.floor_category || "—"}</span>
              <span className="ml-auto">
                <StatusBadge status={d.status} />
              </span>
            </summary>

            <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div>
                <p className="text-muted">
                  Drawing No.:{" "}
                  <span className="text-text">{d.drawing_number || "—"}</span>
                </p>
                <p className="text-muted">
                  Title: <span className="text-text">{d.drawing_title || "—"}</span>
                </p>
                <p className="text-muted">
                  Project: <span className="text-text">{d.project_name || "—"}</span>
                </p>
              </div>
              <div>
                <p className="text-muted">
                  Uploaded:{" "}
                  <span className="text-text">{(d.uploaded_at || "").slice(0, 16)}</span>
                </p>
              </div>
            </div>

            <div className="mt-3 flex gap-3">
              <Link href={`/results/${d.id}`}>
                <Button variant="secondary">📊 View Results</Button>
              </Link>
              <Link href={`/report/${d.id}`}>
                <Button variant="secondary">📄 Report</Button>
              </Link>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
