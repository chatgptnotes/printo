"use client";

import { useMemo, useState } from "react";
import { Card, SectionRule } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { FIELD_GROUPS } from "@/lib/constants";
import { confPct, heatColor } from "@/lib/format";
import type { ApproveResult, ReviewData, RuleRow } from "@/lib/types";

type FieldState = Record<string, string | boolean>;

/** Stringify an extracted value for an editable text input. */
function toInput(value: unknown): string | boolean {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Convert an edited input back to the shape the backend should store, preserving
 * the original field type (arrays stay arrays, objects stay objects). */
function fromInput(original: unknown, edited: string | boolean): unknown {
  if (typeof edited === "boolean") return edited;
  const text = edited.trim();
  if (Array.isArray(original)) {
    return text === "" ? [] : text.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (original && typeof original === "object") {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

export function ReviewEditor({
  data,
  username,
  onApproved,
}: {
  data: ReviewData;
  username: string;
  onApproved: (result: ApproveResult) => void;
}) {
  const id = data.drawing_id;
  const conf = data.extracted.confidence || {};

  // Failed-rule findings grouped by field, so each field can flag its own issues.
  const flagsByField = useMemo(() => {
    const map: Record<string, RuleRow[]> = {};
    for (const r of data.rules) {
      if (r.passed) continue;
      (map[r.field_name] ||= []).push(r);
    }
    return map;
  }, [data.rules]);

  const [fields, setFields] = useState<FieldState>(() => {
    const init: FieldState = {};
    for (const [, rows] of Object.entries(FIELD_GROUPS)) {
      for (const [key] of rows) init[key] = toInput(data.extracted[key]);
    }
    return init;
  });
  const [summary, setSummary] = useState(data.summary_override || data.summary_draft);
  const [busy, setBusy] = useState<"" | "draft" | "approve">("");
  const [msg, setMsg] = useState<string | null>(null);

  function set(key: string, value: string | boolean) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  /** Serialize every editable field back to backend shape. */
  function buildFieldsPayload(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, edited] of Object.entries(fields)) {
      out[key] = fromInput(data.extracted[key], edited);
    }
    return out;
  }

  async function saveDraft() {
    setBusy("draft");
    setMsg(null);
    try {
      const r = await fetch(`/api/drawings/${id}/fields`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: buildFieldsPayload(), corrected_by: username }),
      });
      const body = await r.json().catch(() => ({}));
      setMsg(r.ok ? `💾 ${body.message || "Draft saved"}` : "Save failed");
    } catch {
      setMsg("Save failed");
    } finally {
      setBusy("");
    }
  }

  async function approve() {
    setBusy("approve");
    setMsg(null);
    try {
      const r = await fetch(`/api/drawings/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: buildFieldsPayload(),
          summary_override: summary,
          approved_by: username,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setMsg(body.detail || "Approval failed");
        return;
      }
      const result: ApproveResult = await r.json();
      onApproved(result);
    } catch {
      setMsg("Approval failed");
    } finally {
      setBusy("");
    }
  }

  const working = busy !== "";

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-result-warn/40 bg-result-warn/10 px-5 py-4 text-sm font-extrabold text-[#fcd34d]">
        ⏸️ PENDING YOUR VERIFICATION — nothing has been pushed to ERP and no summary
        has been generated yet. Cross-check each field against the drawing, fix any
        mistakes, then approve.
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Editable fields */}
        <Card>
          <SectionRule>Cross-Verify &amp; Edit Fields</SectionRule>
          <div className="space-y-4">
            {Object.entries(FIELD_GROUPS).map(([group, rows]) => (
              <div key={group}>
                <div className="mb-1 rounded-md bg-accent-blue/10 px-2 py-1 text-xs font-semibold text-[#93c5fd]">
                  {group}
                </div>
                {rows.map(([key, label]) => {
                  const flags = flagsByField[key] || [];
                  const c = conf[key];
                  const col = heatColor(c);
                  const isBool = typeof fields[key] === "boolean";
                  return (
                    <div key={key} className="flex items-start gap-2 border-b border-border py-1.5">
                      <span className="mt-1.5 min-w-[130px] text-xs text-muted">
                        {label}
                        {flags.length > 0 && (
                          <span
                            title={flags.map((f) => `${f.rule_id}: ${f.message}`).join("\n")}
                            className="ml-1 cursor-help text-result-fail"
                          >
                            {flags.some((f) => f.severity === "ERROR") ? "❌" : "⚠️"}
                          </span>
                        )}
                      </span>
                      {isBool ? (
                        <label className="flex flex-1 items-center gap-2 py-1.5 text-sm">
                          <input
                            type="checkbox"
                            checked={fields[key] as boolean}
                            onChange={(e) => set(key, e.target.checked)}
                          />
                          <span className="text-muted">{fields[key] ? "Present" : "Not present"}</span>
                        </label>
                      ) : (
                        <input
                          className="flex-1 rounded-[10px] border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-accent-orange"
                          value={fields[key] as string}
                          onChange={(e) => set(key, e.target.value)}
                        />
                      )}
                      {c !== undefined && (
                        <span
                          className="mt-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{ background: col.bg, color: col.text }}
                        >
                          {confPct(c)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </Card>

        {/* Source drawing + findings, for cross-verification */}
        <div className="space-y-6">
          <Card>
            <SectionRule>Source Drawing</SectionRule>
            {data.thumbnail_uri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.thumbnail_uri}
                alt="Source drawing with mistake markings"
                className="w-full rounded-lg border border-border"
              />
            ) : (
              <p className="text-sm text-muted">Preview unavailable.</p>
            )}
            <p className="mt-2 text-xs text-muted">
              Red marks flag fields that failed validation. Compare the values on the
              left against the drawing before approving.
            </p>
          </Card>

          <Card>
            <SectionRule>Validation Findings</SectionRule>
            <ReviewFindings rules={data.rules} />
          </Card>
        </div>
      </div>

      {/* Editable summary + approval */}
      <Card>
        <SectionRule>Executive Summary (editable)</SectionRule>
        <p className="mb-2 text-xs text-muted">
          This is the summary that will appear on the report. Edit it as needed — it
          is generated only once you approve.
        </p>
        <textarea
          className="h-32 w-full rounded-[10px] border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent-orange"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={saveDraft} disabled={working}>
            💾 {busy === "draft" ? "Saving…" : "Save Draft"}
          </Button>
          <Button variant="primary" onClick={approve} disabled={working}>
            ✅ {busy === "approve" ? "Approving…" : "Approve & Generate Summary"}
          </Button>
          {msg && <span className="text-xs text-muted">{msg}</span>}
        </div>
        <p className="mt-2 text-xs text-muted">
          Approving pushes the verified data to RealSoft ERP and unlocks the report.
        </p>
      </Card>
    </div>
  );
}

function ReviewFindings({ rules }: { rules: RuleRow[] }) {
  const failed = rules.filter((r) => !r.passed);
  if (rules.length === 0)
    return <p className="text-sm text-muted">No validation findings.</p>;
  if (failed.length === 0)
    return (
      <div className="rounded-lg border border-result-pass/40 bg-result-pass/10 px-3 py-2 text-sm text-[#6ee7b7]">
        ✅ All validation rules passed
      </div>
    );
  return (
    <div className="space-y-1.5">
      {failed.map((r, i) => {
        const isError = r.severity === "ERROR";
        return (
          <div
            key={`${r.rule_id}-${i}`}
            className={`rounded-lg border px-3 py-2 text-sm ${
              isError
                ? "border-result-fail/40 bg-result-fail/10 text-[#fca5a5]"
                : "border-result-warn/40 bg-result-warn/10 text-[#fcd34d]"
            }`}
          >
            {isError ? "❌" : "⚠️"} <span className="font-semibold">{r.rule_id}</span>{" "}
            {r.field_name && <span className="opacity-80">({r.field_name})</span>} — {r.message}
          </div>
        );
      })}
    </div>
  );
}
