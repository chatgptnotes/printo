"use client";

import { useState } from "react";
import { Card, SectionRule } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { FIELD_GROUPS } from "@/lib/constants";
import type { ApproveResult, BoqItem, ReviewData } from "@/lib/types";

type FieldState = Record<string, string | boolean>;

function toInput(value: unknown): string | boolean {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

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

const SCALAR_GROUPS = Object.entries(FIELD_GROUPS);

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

  const [fields, setFields] = useState<FieldState>(() => {
    const init: FieldState = {};
    for (const [, rows] of SCALAR_GROUPS) {
      for (const [key] of rows) init[key] = toInput(data.extracted[key]);
    }
    return init;
  });

  const initialBoq: BoqItem[] = (data.boq_items && data.boq_items.length
    ? data.boq_items
    : (data.extracted.boq_items as BoqItem[] | undefined) || []) as BoqItem[];
  const [boq, setBoq] = useState<BoqItem[]>(
    initialBoq.map((b) => ({
      section: b.section ?? "",
      description: b.description ?? "",
      unit: b.unit ?? "",
      quantity: b.quantity ?? "",
    })),
  );

  const [summary, setSummary] = useState(data.summary_override || data.summary_draft);
  const [busy, setBusy] = useState<"" | "draft" | "approve">("");
  const [msg, setMsg] = useState<string | null>(null);

  function set(key: string, value: string | boolean) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }
  function setItem(i: number, key: keyof BoqItem, value: string) {
    setBoq((prev) => prev.map((it, idx) => (idx === i ? { ...it, [key]: value } : it)));
  }
  function addItem() {
    setBoq((prev) => [...prev, { section: "", description: "", unit: "nos", quantity: "" }]);
  }
  function removeItem(i: number) {
    setBoq((prev) => prev.filter((_, idx) => idx !== i));
  }

  function buildFieldsPayload(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, edited] of Object.entries(fields)) {
      out[key] = fromInput(data.extracted[key], edited);
    }
    return out;
  }
  function buildBoqPayload(): BoqItem[] {
    return boq.filter((b) => b.section || b.description || b.unit || b.quantity);
  }

  async function saveDraft() {
    setBusy("draft");
    setMsg(null);
    try {
      const r = await fetch(`/api/drawings/${id}/fields`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: buildFieldsPayload(),
          boq_items: buildBoqPayload(),
          corrected_by: username,
        }),
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
          boq_items: buildBoqPayload(),
          summary_override: summary,
          approved_by: username,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setMsg(body.detail || "Approval failed");
        return;
      }
      onApproved((await r.json()) as ApproveResult);
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
        ⏸️ BOQ READY FOR REVIEW — nothing has been pushed to ERP yet. Review the title block
        and Bill of Quantities below, adjust any line, then approve to push to RealSoft.
      </div>

      {/* Bill of Quantities — editable */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <SectionRule>Bill of Quantities</SectionRule>
          <Button variant="secondary" onClick={addItem}>
            + Add line
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 pr-2">Section</th>
                <th className="py-1 pr-2">Description</th>
                <th className="w-20 py-1 pr-2">Unit</th>
                <th className="w-24 py-1 pr-2">Qty</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {boq.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-xs text-muted">
                    No BOQ lines — click “Add line”.
                  </td>
                </tr>
              )}
              {boq.map((it, i) => (
                <tr key={i} className="border-t border-border">
                  {(["section", "description", "unit", "quantity"] as (keyof BoqItem)[]).map((k) => (
                    <td key={k} className="py-1 pr-2">
                      <input
                        className="w-full rounded-[8px] border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-accent-orange"
                        value={(it[k] as string) ?? ""}
                        onChange={(e) => setItem(i, k, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="py-1 text-center">
                    <button
                      onClick={() => removeItem(i)}
                      className="text-muted hover:text-result-fail"
                      title="Remove line"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Title block — editable */}
        <Card>
          <SectionRule>Title Block &amp; Drawing Info</SectionRule>
          <div className="space-y-4">
            {SCALAR_GROUPS.map(([group, rows]) => (
              <div key={group}>
                <div className="mb-1 rounded-md bg-accent-blue/10 px-2 py-1 text-xs font-semibold text-[#93c5fd]">
                  {group}
                </div>
                {rows.map(([key, label]) => {
                  const isBool = typeof fields[key] === "boolean";
                  return (
                    <div key={key} className="flex items-start gap-2 border-b border-border py-1.5">
                      <span className="mt-1.5 min-w-[130px] text-xs text-muted">{label}</span>
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
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </Card>

        {/* Source drawing (clean — no markings) */}
        <Card>
          <SectionRule>Source Drawing</SectionRule>
          {data.thumbnail_uri ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.thumbnail_uri}
              alt="Source drawing"
              className="w-full rounded-lg border border-border"
            />
          ) : (
            <p className="text-sm text-muted">Preview unavailable.</p>
          )}
          <p className="mt-2 text-xs text-muted">
            Cross-check the title block and quantities against the drawing before approving.
          </p>
        </Card>
      </div>

      {/* Editable summary + approval */}
      <Card>
        <SectionRule>BOQ Summary (editable)</SectionRule>
        <textarea
          className="h-28 w-full rounded-[10px] border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent-orange"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={saveDraft} disabled={working}>
            💾 {busy === "draft" ? "Saving…" : "Save Draft"}
          </Button>
          <Button variant="primary" onClick={approve} disabled={working}>
            ✅ {busy === "approve" ? "Approving…" : "Approve & Push to ERP"}
          </Button>
          {msg && <span className="text-xs text-muted">{msg}</span>}
        </div>
        <p className="mt-2 text-xs text-muted">
          Approving pushes the title block + BOQ to RealSoft ERP and unlocks the report.
        </p>
      </Card>
    </div>
  );
}
