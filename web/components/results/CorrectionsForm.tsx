"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { fmtVal } from "@/lib/format";
import type { Extracted } from "@/lib/types";

export function CorrectionsForm({
  drawingId,
  extracted,
  username,
}: {
  drawingId: number;
  extracted: Extracted;
  username: string;
}) {
  const editableKeys = Object.keys(extracted).filter(
    (k) => k !== "confidence" && k !== "field_locations",
  );
  const [field, setField] = useState(editableKeys[0] || "");
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pick(k: string) {
    setField(k);
    setValue(fmtVal(extracted[k]) === "—" ? "" : fmtVal(extracted[k]));
    setMsg(null);
  }

  async function save() {
    if (!field) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/drawings/${drawingId}/correction`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field_name: field,
          corrected_value: value,
          corrected_by: username,
        }),
      });
      setMsg(r.ok ? `Saved correction for '${field}'` : "Save failed");
    } catch {
      setMsg("Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block text-xs font-semibold text-muted">Field to correct</label>
      <select
        className="w-full rounded-[10px] border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent-orange"
        value={field}
        onChange={(e) => pick(e.target.value)}
      >
        {editableKeys.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>

      <label className="block text-xs font-semibold text-muted">Corrected value</label>
      <input
        className="w-full rounded-[10px] border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent-orange"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />

      <Button variant="primary" onClick={save} disabled={busy || !field}>
        💾 {busy ? "Saving…" : "Save Correction"}
      </Button>
      {msg && <p className="text-xs text-muted">{msg}</p>}
    </div>
  );
}
