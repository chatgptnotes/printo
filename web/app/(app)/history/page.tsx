"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { DrawingSummary } from "@/lib/types";

export default function HistoryPage() {
  const [drawings, setDrawings] = useState<DrawingSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [transferMsg, setTransferMsg] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function load() {
    setError(false);
    setDrawings(null);
    fetch("/api/drawings")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setDrawings)
      .catch(() => setError(true));
  }

  useEffect(load, []);

  async function transferAll() {
    setTransferring(true);
    setTransferMsg(null);
    try {
      const r = await fetch("/api/erp/push-all", { method: "POST" });
      const j = await r.json().catch(() => null);
      setTransferMsg(
        r.ok && j
          ? `Transferred ${j.total}: ${j.sent} sent, ${j.failed} failed, ${j.simulated} simulated.`
          : "Transfer failed.",
      );
    } catch {
      setTransferMsg("Transfer failed - backend unreachable.");
    } finally {
      setTransferring(false);
    }
  }

  async function sendOne(did: number) {
    setSendingId(did);
    setTransferMsg(null);
    try {
      const r = await fetch(`/api/erp/push/${did}`, { method: "POST" });
      const j = await r.json().catch(() => null);
      setTransferMsg(r.ok && j ? `#${did}: ${j.message || j.status}` : `#${did}: transfer failed.`);
    } catch {
      setTransferMsg(`#${did}: transfer failed - backend unreachable.`);
    } finally {
      setSendingId(null);
    }
  }

  async function deleteOne(did: number, fileName: string) {
    const ok = window.confirm(
      `Delete report #${did}?\n\n${fileName}\n\nThis removes the upload, generated report data, BOQ review data, and ERP push history for this drawing.`,
    );
    if (!ok) return;

    setDeletingId(did);
    setTransferMsg(null);
    try {
      const r = await fetch(`/api/drawings/${did}`, { method: "DELETE" });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setTransferMsg(j?.detail || `#${did}: delete failed.`);
        return;
      }
      setDrawings((prev) => prev?.filter((d) => d.id !== did) ?? prev);
      setTransferMsg(`#${did}: deleted.`);
    } catch {
      setTransferMsg(`#${did}: delete failed - backend unreachable.`);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-lg font-bold">Processing History</h1>
        <Button variant="secondary" onClick={load}>
          Refresh
        </Button>
        <Link href="/report/project">
          <Button variant="secondary">Project Summary Report</Button>
        </Link>
        <a href="/api/export/project/excel">
          <Button variant="secondary">All Excel</Button>
        </a>
        <a href="/api/report/project/pdf" download="erp_realsoft_project_report.pdf" target="_blank" rel="noreferrer">
          <Button variant="secondary">Project PDF</Button>
        </a>
        <Button variant="primary" onClick={transferAll} disabled={transferring}>
          {transferring ? "Transferring..." : "Transfer all"}
        </Button>
      </div>

      {transferMsg && <p className="text-sm text-accent-orange-light">{transferMsg}</p>}

      {error && <p className="text-result-fail">Backend not reachable.</p>}
      {!drawings && !error && <p className="text-muted">Loading...</p>}
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
              <span className="text-muted">- {d.floor_category || "-"}</span>
              <span className="ml-auto">
                <StatusBadge status={d.status} />
              </span>
            </summary>

            <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div>
                <p className="text-muted">
                  Drawing No.: <span className="text-text">{d.drawing_number || "-"}</span>
                </p>
                <p className="text-muted">
                  Title: <span className="text-text">{d.drawing_title || "-"}</span>
                </p>
                <p className="text-muted">
                  Project: <span className="text-text">{d.project_name || "-"}</span>
                </p>
              </div>
              <div>
                <p className="text-muted">
                  Uploaded: <span className="text-text">{(d.uploaded_at || "").slice(0, 16)}</span>
                </p>
              </div>
            </div>

            {d.failure_reason && (
              <div className="mt-3 rounded-[10px] border border-result-fail/40 bg-result-fail/10 px-3 py-2 text-sm text-[#fca5a5]">
                <span className="font-semibold">Unable to process: </span>
                {d.failure_reason}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-3">
              <Link href={`/results/${d.id}`}>
                <Button variant="secondary">View Results</Button>
              </Link>
              <Link href={`/report/${d.id}`}>
                <Button variant="secondary">Report</Button>
              </Link>
              <Button
                variant="secondary"
                onClick={() => sendOne(d.id)}
                disabled={sendingId === d.id}
              >
                {sendingId === d.id ? "Sending..." : "Send to RealSoft"}
              </Button>
              <Button
                variant="secondary"
                className="border-result-fail/60 text-result-fail hover:border-result-fail"
                onClick={() => deleteOne(d.id, d.file_name)}
                disabled={deletingId === d.id}
              >
                {deletingId === d.id ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
