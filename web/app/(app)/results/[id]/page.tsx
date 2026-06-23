"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
import { CorrectionsForm } from "@/components/results/CorrectionsForm";
import { usePrintoStore } from "@/lib/store";
import type { DrawingDetail, Extracted, Verdict } from "@/lib/types";

interface EffectiveResult {
  verdict: Verdict;
  errors: string[];
  warnings: string[];
  elapsed: number;
  erpStatus?: string;
  extracted: Extracted;
  realsoftPayload: Record<string, unknown>;
}

export default function ResultsPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const stored = usePrintoStore((s) => s.lastResult);
  const [data, setData] = useState<EffectiveResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("user");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => u && setUsername(u.username))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (stored && stored.drawing_id === id) {
      setData({
        verdict: stored.verdict,
        errors: stored.errors || [],
        warnings: stored.warnings || [],
        elapsed: stored.elapsed || 0,
        erpStatus: stored.erp_status,
        extracted: stored.extracted || {},
        realsoftPayload: stored.realsoft_payload || {},
      });
      setLoading(false);
      return;
    }
    // Fallback: reconstruct from the stored drawing detail (no verdict/errors).
    let on = true;
    fetch(`/api/drawings/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: DrawingDetail) => {
        if (!on) return;
        const extracted: Extracted = { confidence: {} };
        for (const e of d.extractions || []) {
          extracted[e.field] = e.value;
          if (e.confidence !== null) extracted.confidence![e.field] = e.confidence;
        }
        const status = d.drawing?.status;
        const verdict: Verdict =
          status === "blurred" || status === "error" ? "FAILED" : "PASSED";
        setData({
          verdict,
          errors: status === "blurred" ? ["Uploaded image is too blurry for report generation."] : [],
          warnings: [],
          elapsed: 0,
          extracted,
          realsoftPayload: {},
        });
      })
      .catch(() => on && setData(null))
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
  }, [id, stored]);

  if (loading) return <p className="text-muted">Loading results…</p>;
  if (!data) return <p className="text-muted">No results for this drawing.</p>;

  // Blur block — no report was generated.
  if (data.errors.some((e) => e.toLowerCase().includes("too blurry"))) {
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

  return (
    <div className="space-y-6">
      <VerdictBanner
        verdict={data.verdict}
        errors={data.errors}
        warnings={data.warnings}
        elapsed={data.elapsed}
        erpStatus={data.erpStatus}
      />
      <MetricsScorecard
        extracted={data.extracted}
        verdict={data.verdict}
        errors={data.errors}
        warnings={data.warnings}
      />
      <ConfidenceHeatmap conf={data.extracted.confidence || {}} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <SectionRule>Extracted Data</SectionRule>
          <FieldsDisplay extracted={data.extracted} />
        </Card>
        <Card>
          <SectionRule>Validation Results</SectionRule>
          <ValidationResults errors={data.errors} warnings={data.warnings} />
          <div className="mt-4">
            <ErpPayloadViewer payload={data.realsoftPayload} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <SectionRule>Human Verification</SectionRule>
          <CorrectionsForm drawingId={id} extracted={data.extracted} username={username} />
        </Card>
        <Card>
          <SectionRule>Export</SectionRule>
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
          </div>
          <p className="mt-3 text-xs text-muted">
            The report includes the drawing with red markings on any mistakes.
          </p>
        </Card>
      </div>
    </div>
  );
}
