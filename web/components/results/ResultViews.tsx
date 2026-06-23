"use client";

import { useState } from "react";
import type { Extracted, RealsoftPayload, Verdict } from "@/lib/types";
import { FIELD_GROUPS, HEAT_LABELS } from "@/lib/constants";
import { confPct, fmtVal, heatColor, roomRow } from "@/lib/format";

export function VerdictBanner({
  verdict,
  errors,
  warnings,
  elapsed,
  erpStatus,
}: {
  verdict: Verdict;
  errors: string[];
  warnings: string[];
  elapsed: number;
  erpStatus?: string;
}) {
  const base = "rounded-xl border px-5 py-4 text-sm font-extrabold";
  if (verdict === "PASSED")
    return (
      <div className={`${base} border-result-pass/40 bg-result-pass/10 text-[#6ee7b7]`}>
        ✅ EXTRACTION COMPLETE — ALL RULES PASSED · {elapsed}s · ERP:{" "}
        {(erpStatus || "—").toUpperCase()}
      </div>
    );
  if (verdict === "WARNING")
    return (
      <div className={`${base} border-result-warn/40 bg-result-warn/10 text-[#fcd34d]`}>
        ⚠️ COMPLETE — {warnings.length} WARNING(S) · {elapsed}s · ERP:{" "}
        {(erpStatus || "—").toUpperCase()}
      </div>
    );
  return (
    <div className={`${base} border-result-fail/40 bg-result-fail/10 text-[#fca5a5]`}>
      ❌ VALIDATION FAILED — {errors.length} ERROR(S) · {elapsed}s
    </div>
  );
}

export function MetricsScorecard({
  extracted,
  verdict,
  errors,
  warnings,
}: {
  extracted: Extracted;
  verdict: Verdict;
  errors: string[];
  warnings: string[];
}) {
  const fieldCount = Object.entries(extracted).filter(
    ([k, v]) =>
      k !== "confidence" &&
      k !== "field_locations" &&
      v !== null &&
      v !== "" &&
      !(Array.isArray(v) && v.length === 0),
  ).length;
  const conf = extracted.confidence || {};
  const vals = Object.values(conf).filter((v) => typeof v === "number");
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const vcolor =
    verdict === "PASSED" ? "#6ee7b7" : verdict === "WARNING" ? "#fcd34d" : "#fca5a5";

  const cards = [
    { val: String(fieldCount), label: "Fields" },
    { val: `${Math.round(avg * 100)}%`, label: "Avg Confidence" },
    { val: verdict, label: "Verdict", color: vcolor },
    { val: String(errors.length), label: "Errors", color: "#fca5a5" },
    { val: String(warnings.length), label: "Warnings", color: "#fcd34d" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-border bg-surface p-4 text-center">
          <div className="text-xl font-bold" style={c.color ? { color: c.color } : undefined}>
            {c.val}
          </div>
          <div className="text-xs text-muted">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

export function ConfidenceHeatmap({ conf }: { conf: Record<string, number> }) {
  const items = Object.keys(HEAT_LABELS).filter((k) => k in conf);
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
        Confidence Heatmap
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((k) => {
          const c = conf[k];
          const col = heatColor(c);
          return (
            <div
              key={k}
              className="rounded-lg border px-3 py-1.5 text-xs"
              style={{ background: col.bg, borderColor: col.border, color: col.text }}
            >
              <span className="mr-1 opacity-80">{HEAT_LABELS[k]}</span>
              {confPct(c)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FieldsDisplay({ extracted }: { extracted: Extracted }) {
  const conf = extracted.confidence || {};
  return (
    <div className="space-y-4">
      {Object.entries(FIELD_GROUPS).map(([group, fields]) => {
        const rows = fields.filter(([key]) => {
          const v = extracted[key];
          return !(v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0));
        });
        if (rows.length === 0) return null;
        return (
          <div key={group}>
            <div className="mb-1 rounded-md bg-accent-blue/10 px-2 py-1 text-xs font-semibold text-[#93c5fd]">
              {group}
            </div>
            {rows.map(([key, label]) => (
              <div
                key={key}
                className="flex items-center gap-2 border-b border-border py-1.5 text-sm"
              >
                <span className="min-w-[150px] text-xs text-muted">{label}</span>
                <span className="flex-1 font-semibold">{fmtVal(extracted[key])}</span>
                <ConfBadge c={conf[key]} />
              </div>
            ))}
          </div>
        );
      })}
      <RoomScheduleTable rooms={extracted.room_schedule} />
    </div>
  );
}

function ConfBadge({ c }: { c: number | undefined }) {
  if (c === undefined) return null;
  const col = heatColor(c);
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ background: col.bg, color: col.text }}
    >
      {confPct(c)}
    </span>
  );
}

export function RoomScheduleTable({
  rooms,
}: {
  rooms: Extracted["room_schedule"];
}) {
  if (!rooms || rooms.length === 0) return null;
  return (
    <div>
      <div className="mb-1 rounded-md bg-accent-blue/10 px-2 py-1 text-xs font-semibold text-[#93c5fd]">
        🛋️ Room Schedule
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-1">Room</th>
            <th className="py-1">Area</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((r, i) => {
            const [name, area] = roomRow(r);
            return (
              <tr key={i} className="border-t border-border">
                <td className="py-1">{name}</td>
                <td className="py-1">{area}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ValidationResults({
  errors,
  warnings,
}: {
  errors: string[];
  warnings: string[];
}) {
  if (errors.length === 0 && warnings.length === 0)
    return (
      <div className="rounded-lg border border-result-pass/40 bg-result-pass/10 px-3 py-2 text-sm text-[#6ee7b7]">
        ✅ All validation rules passed
      </div>
    );
  return (
    <div className="space-y-1.5">
      {errors.map((e, i) => (
        <div
          key={`e${i}`}
          className="rounded-lg border border-result-fail/40 bg-result-fail/10 px-3 py-2 text-sm text-[#fca5a5]"
        >
          ❌ {e}
        </div>
      ))}
      {warnings.map((w, i) => (
        <div
          key={`w${i}`}
          className="rounded-lg border border-result-warn/40 bg-result-warn/10 px-3 py-2 text-sm text-[#fcd34d]"
        >
          ⚠️ {w}
        </div>
      ))}
    </div>
  );
}

export function ErpPayloadViewer({ payload }: { payload: RealsoftPayload }) {
  const [open, setOpen] = useState(false);
  if (!payload || Object.keys(payload).length === 0) return null;
  const meta = payload.metadata || {};
  const lowConf = meta.low_confidence_fields || [];
  const warns = meta.mapping_warnings || [];
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      {lowConf.length > 0 && (
        <p className="text-xs text-[#fcd34d]">
          ⚠️ {lowConf.length} ERP field(s) flagged low-confidence: {lowConf.join(", ")}
        </p>
      )}
      {warns.length > 0 && (
        <p className="text-xs text-muted">🛠️ {warns.length} mapping warning(s)</p>
      )}
      <button
        className="mt-2 text-xs font-semibold text-accent-orange"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "▾ Hide" : "▸ Show"} ERP Payload (RealSoft format)
      </button>
      {open && (
        <pre className="mt-2 max-h-80 overflow-auto rounded bg-[#05080f] p-3 text-[11px] text-muted">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}
