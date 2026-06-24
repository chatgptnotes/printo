"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, SectionRule } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { ErpStatus, ErpPushRecord, ErpPushResult, ErpPushSummary } from "@/lib/types";

const PUSH_TONE: Record<string, string> = {
  sent: "bg-result-pass/15 text-[#6ee7b7]",
  failed: "bg-result-fail/15 text-[#fca5a5]",
  simulated: "bg-accent-orange/15 text-accent-orange-light",
  skipped: "bg-white/10 text-muted",
};

function PushPill({ status }: { status: string }) {
  const cls = PUSH_TONE[status] || "bg-white/10 text-muted";
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}>
      {status}
    </span>
  );
}

function ConnectionPill({ status }: { status: ErpStatus }) {
  let tone = "bg-accent-orange/15 text-accent-orange-light";
  let label = "● Simulation mode";
  if (status.mode === "live") {
    if (status.reachable) {
      tone = "bg-result-pass/15 text-[#6ee7b7]";
      label = "● Connected";
    } else {
      tone = "bg-result-fail/15 text-[#fca5a5]";
      label = "● Unreachable";
    }
  }
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold ${tone}`}>{label}</span>
  );
}

export default function IntegrationsPage() {
  const [status, setStatus] = useState<ErpStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [pushes, setPushes] = useState<ErpPushRecord[] | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [summary, setSummary] = useState<ErpPushSummary | null>(null);
  const [resendingId, setResendingId] = useState<number | null>(null);

  const loadStatus = useCallback(async () => {
    setTesting(true);
    try {
      const r = await fetch("/api/erp/status");
      setStatus(r.ok ? await r.json() : null);
    } catch {
      setStatus(null);
    } finally {
      setTesting(false);
    }
  }, []);

  const loadPushes = useCallback(async () => {
    try {
      const r = await fetch("/api/erp/pushes");
      setPushes(r.ok ? await r.json() : []);
    } catch {
      setPushes([]);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadPushes();
  }, [loadStatus, loadPushes]);

  async function transferAll() {
    setTransferring(true);
    setSummary(null);
    try {
      const r = await fetch("/api/erp/push-all", { method: "POST" });
      if (r.ok) setSummary(await r.json());
    } catch {
      /* surfaced via empty summary */
    } finally {
      setTransferring(false);
      loadPushes();
    }
  }

  async function resend(id: number) {
    setResendingId(id);
    try {
      await fetch(`/api/erp/push/${id}`, { method: "POST" });
    } catch {
      /* ignore — row state refreshes from history */
    } finally {
      setResendingId(null);
      loadPushes();
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold">Integrations</h1>

      {/* ── RealSoft connection ─────────────────────────────────────────── */}
      <Card>
        <SectionRule>RealSoft API Connection</SectionRule>
        <div className="flex flex-wrap items-center gap-4">
          {status ? <ConnectionPill status={status} /> : <span className="text-muted">Checking…</span>}
          <Button variant="secondary" onClick={loadStatus} disabled={testing}>
            {testing ? "Testing…" : "🔌 Test Connection"}
          </Button>
        </div>
        {status && (
          <dl className="mt-4 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
            <div className="text-muted">
              Endpoint: <span className="text-text">{status.base_url || "—"}</span>
            </div>
            <div className="text-muted">
              Module: <span className="text-text">{status.module}</span>
            </div>
            <div className="text-muted">
              Credentials:{" "}
              <span className="text-text">{status.configured ? "Configured" : "Not configured"}</span>
            </div>
            <div className="text-muted">
              Mode: <span className="text-text capitalize">{status.mode}</span>
            </div>
          </dl>
        )}
        {status?.mode === "simulation" && (
          <p className="mt-3 text-xs text-accent-orange-light">
            Simulation mode — set REALSOFT_BASE_URL and REALSOFT_API_KEY on the server to send to the
            live RealSoft API. Transfers are still recorded so you can preview the flow.
          </p>
        )}
      </Card>

      {/* ── Bulk transfer ───────────────────────────────────────────────── */}
      <Card>
        <SectionRule>Transfer Reports to RealSoft</SectionRule>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={transferAll} disabled={transferring}>
            {transferring ? "Transferring…" : "🚀 Transfer all reports"}
          </Button>
          <span className="text-xs text-muted">
            (Re)sends every processed drawing&apos;s ERP payload to RealSoft.
          </span>
        </div>
        {summary && (
          <p className="mt-3 text-sm text-text">
            Transferred {summary.total}: <span className="text-[#6ee7b7]">{summary.sent} sent</span>,{" "}
            <span className="text-[#fca5a5]">{summary.failed} failed</span>,{" "}
            <span className="text-accent-orange-light">{summary.simulated} simulated</span>.
          </p>
        )}
      </Card>

      {/* ── Push history ────────────────────────────────────────────────── */}
      <Card>
        <SectionRule>Push History</SectionRule>
        {!pushes && <p className="text-muted">Loading…</p>}
        {pushes && pushes.length === 0 && (
          <p className="text-muted">No transfers yet. Process a drawing, then transfer it here.</p>
        )}
        <div className="space-y-2">
          {pushes?.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm"
            >
              <span className="font-semibold">#{p.drawing_id}</span>
              <span className="text-muted">{p.file_name || "—"}</span>
              <span className="text-dim">{(p.pushed_at || "").slice(0, 16).replace("T", " ")}</span>
              <span className="ml-auto">
                <PushPill status={p.status} />
              </span>
              <Button variant="ghost" onClick={() => resend(p.drawing_id)} disabled={resendingId === p.drawing_id}>
                {resendingId === p.drawing_id ? "…" : "↻ Resend"}
              </Button>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Bulk export ─────────────────────────────────────────────────── */}
      <Card>
        <SectionRule>Bulk Export</SectionRule>
        <div className="flex flex-wrap gap-3">
          <a href="/api/export/project/excel">
            <Button variant="secondary">📊 Download all as Excel</Button>
          </a>
          <a href="/api/report/project/pdf" download="erp_realsoft_project_report.pdf" target="_blank" rel="noreferrer">
            <Button variant="secondary">⬇️ Project PDF</Button>
          </a>
        </div>
        <p className="mt-3 text-xs text-muted">
          The Excel workbook has a Summary sheet (one row per drawing) plus an All Extractions sheet.
        </p>
      </Card>
    </div>
  );
}
