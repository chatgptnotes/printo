"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, SectionRule } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  BoqDisplay,
  ErpPayloadViewer,
  FieldsDisplay,
} from "@/components/results/ResultViews";
import { ReviewEditor } from "@/components/results/ReviewEditor";
import type { ApproveResult, BoqItem, ReviewData } from "@/lib/types";

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

  // A pending drawing with no extracted fields means the pipeline failed before
  // producing an extraction (timeout / AI error) — there is nothing to verify.
  const fieldCount = Object.keys(review.extracted || {}).filter(
    (k) => k !== "confidence" && k !== "field_locations",
  ).length;
  if (review.review_status === "pending_review" && fieldCount === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-result-fail/40 bg-result-fail/10 px-5 py-4 font-extrabold text-[#fca5a5]">
          ⚠️ EXTRACTION DID NOT COMPLETE
        </div>
        <p className="text-muted">
          This drawing could not be processed{review.status ? ` (status: ${review.status})` : ""}.
        </p>
        {review.failure_reason && (
          <div className="rounded-[10px] border border-result-fail/40 bg-result-fail/10 px-4 py-3 text-sm text-[#fca5a5]">
            <span className="font-semibold">Reason: </span>
            {review.failure_reason}
          </div>
        )}
        <p className="text-muted">Please re-upload and try again.</p>
        <Link href="/">
          <Button variant="primary">← Upload another drawing</Button>
        </Link>
      </div>
    );
  }

  // Pending review — editable BOQ screen (no ERP push / summary yet).
  if (review.review_status === "pending_review") {
    return <ReviewEditor data={review} username={username} onApproved={handleApproved} />;
  }

  // Approved — final BOQ, report exports, and ERP retry.
  const approvedWhen = (review.approved_at || "").slice(0, 16).replace("T", " ");
  const boqItems: BoqItem[] =
    (review.boq_items && review.boq_items.length
      ? review.boq_items
      : (review.extracted.boq_items as BoqItem[] | undefined) || []) as BoqItem[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-result-pass/40 bg-result-pass/10 px-5 py-3 text-sm font-bold text-[#6ee7b7]">
        <span>
          ✅ BOQ approved
          {review.approved_by ? ` by ${review.approved_by}` : ""}
          {approvedWhen ? ` on ${approvedWhen}` : ""}
          {approveResult ? ` · ERP: ${approveResult.erp_status.toUpperCase()}` : ""}
        </span>
        <Button variant="secondary" onClick={reopen} className="ml-auto">
          ✏️ Reopen for editing
        </Button>
      </div>

      {review.project_description && review.project_description.trim() && (
        <Card>
          <SectionRule>Project Description</SectionRule>
          <p className="whitespace-pre-line text-sm text-muted">
            {review.project_description}
          </p>
        </Card>
      )}

      <Card>
        <SectionRule>Bill of Quantities</SectionRule>
        <BoqDisplay items={boqItems} />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <SectionRule>Title Block &amp; Drawing Info</SectionRule>
          <FieldsDisplay extracted={review.extracted} />
        </Card>
        <Card>
          <SectionRule>ERP Payload (RealSoft)</SectionRule>
          <ErpPayloadViewer payload={review.erp_payload} />
        </Card>
      </div>

      <Card>
        <SectionRule>Export &amp; Transfer</SectionRule>
        <div className="flex flex-wrap gap-3">
          <Link href={`/report/${id}`}>
            <Button variant="primary">📄 View BOQ Report</Button>
          </Link>
          <a href={`/api/report/${id}/pdf`} target="_blank" rel="noreferrer">
            <Button variant="secondary">⬇️ Download PDF</Button>
          </a>
          <a href={`/api/export/${id}/excel`}>
            <Button variant="secondary">📊 Download Excel (BOQ)</Button>
          </a>
          <Button variant="secondary" onClick={sendToErp} disabled={erpSending}>
            {erpSending ? "Sending…" : "🚀 Re-send to RealSoft"}
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">
          The Excel workbook is a full multi-sheet Bill of Quantities (Cover · one
          sheet per trade · Summary) with live rate/amount formulas — type unit rates
          and every total recalculates automatically.
        </p>
        {erpMsg && <p className="mt-3 text-xs text-accent-orange-light">{erpMsg}</p>}
      </Card>
    </div>
  );
}
