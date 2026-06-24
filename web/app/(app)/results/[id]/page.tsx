"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, SectionRule } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  ConfidenceHeatmap,
  ErpPayloadViewer,
  FieldsDisplay,
  MetricsScorecard,
  ValidationResults,
  VerdictBanner,
} from "@/components/results/ResultViews";
import { ReviewEditor } from "@/components/results/ReviewEditor";
import type { ApproveResult, ReviewData, Verdict } from "@/lib/types";

export default function ResultsPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [username, setUsername] = useState("user");
  const [approveResult, setApproveResult] = useState<ApproveResult | null>(null);

  // Manual (re)send to RealSoft — retries the ERP transfer after approval.
  const [erpSending, setErpSending] = useState(false);
  const [erpMsg, setErpMsg] = useState<string | null>(null);

  async function sendToErp() {
    setErpSending(true);
    setErpMsg(null);
    try {
      const r = await fetch(`/api/erp/push/${id}`, { method: "POST" });
      const j = await r.json().catch(() => null);
      setErpMsg(
        r.ok && j
          ? j.message || `Status: ${j.status}`
          : (j && (j.detail || j.message)) || "Transfer failed.",
      );
    } catch {
      setErpMsg("Transfer failed — backend unreachable.");
    } finally {
      setErpSending(false);
    }
  }

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => u && setUsername(u.username))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/drawings/${id}/review`);
      if (!r.ok) {
        setMissing(true);
        return;
      }
      setReview((await r.json()) as ReviewData);
      setMissing(false);
    } catch {
      setMissing(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  function handleApproved(result: ApproveResult) {
    setApproveResult(result);
    setErpMsg(null);
    load();
  }

  async function reopen() {
    setApproveResult(null);
    setErpMsg(null);
    try {
      await fetch(`/api/drawings/${id}/reopen`, { method: "POST" });
    } catch {
      /* the reload reflects the truth either way */
    }
    load();
  }

  if (loading) return <p className="text-muted">Loading results…</p>;
  if (missing || !review) return <p className="text-muted">No results for this drawing.</p>;

  // Blur block — no extraction / report was produced.
  if (review.status === "blurred") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-result-fail/40 bg-result-fail/10 px-5 py-4 font-extrabold text-[#fca5a5]">
          🌫️ IMAGE TOO BLURRY — REPORT NOT GENERATED
        </div>
        <p className="text-muted">
          The uploaded image is too blurry for report generation. No report was generated.
          Please re-upload a clearer scan or photo.
        </p>
        <Link href="/">
          <Button variant="primary">← Upload another drawing</Button>
        </Link>
      </div>
    );
  }

  // Pending verification — editable cross-verify screen (no ERP push / summary yet).
  if (review.review_status === "pending_review") {
    return <ReviewEditor data={review} username={username} onApproved={handleApproved} />;
  }

  // Approved — final results, report exports, and ERP retry.
  const errors = review.rules
    .filter((r) => !r.passed && r.severity === "ERROR")
    .map((r) => r.message);
  const warnings = review.rules
    .filter((r) => !r.passed && r.severity === "WARNING")
    .map((r) => r.message);
  const verdict: Verdict = review.verdict ?? "PASSED";
  const approvedWhen = (review.approved_at || "").slice(0, 16).replace("T", " ");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-result-pass/40 bg-result-pass/10 px-5 py-3 text-sm font-bold text-[#6ee7b7]">
        <span>
          ✅ Verified &amp; approved
          {review.approved_by ? ` by ${review.approved_by}` : ""}
          {approvedWhen ? ` on ${approvedWhen}` : ""}
          {approveResult ? ` · ERP: ${approveResult.erp_status.toUpperCase()}` : ""}
        </span>
        <Button variant="secondary" onClick={reopen} className="ml-auto">
          ✏️ Reopen for editing
        </Button>
      </div>

      <VerdictBanner
        verdict={verdict}
        errors={errors}
        warnings={warnings}
        elapsed={review.elapsed}
        erpStatus={approveResult?.erp_status}
      />
      <MetricsScorecard
        extracted={review.extracted}
        verdict={verdict}
        errors={errors}
        warnings={warnings}
      />
      <ConfidenceHeatmap conf={review.extracted.confidence || {}} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <SectionRule>Extracted Data</SectionRule>
          <FieldsDisplay extracted={review.extracted} />
        </Card>
        <Card>
          <SectionRule>Validation Results</SectionRule>
          <ValidationResults errors={errors} warnings={warnings} />
          <div className="mt-4">
            <ErpPayloadViewer payload={review.erp_payload} />
          </div>
        </Card>
      </div>

      <Card>
        <SectionRule>Export &amp; Transfer</SectionRule>
        <div className="flex flex-wrap gap-3">
          <Link href={`/report/${id}`}>
            <Button variant="primary">📄 View Report</Button>
          </Link>
          <a href={`/api/report/${id}/pdf`} target="_blank" rel="noreferrer">
            <Button variant="secondary">⬇️ Download PDF</Button>
          </a>
          <a href={`/api/export/${id}/excel`}>
            <Button variant="secondary">📊 Excel</Button>
          </a>
          <Button variant="secondary" onClick={sendToErp} disabled={erpSending}>
            {erpSending ? "Sending…" : "🚀 Re-send to RealSoft"}
          </Button>
        </div>
        {erpMsg && <p className="mt-3 text-xs text-accent-orange-light">{erpMsg}</p>}
        <p className="mt-3 text-xs text-muted">
          The report includes the drawing with red markings on any mistakes.
        </p>
      </Card>
    </div>
  );
}
