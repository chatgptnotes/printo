'use client';

// Raw extracted electrical data, rendered as tables for line-by-line cross-checking
// against the source drawing / BOQ. Reads the ElectricalProcedureResult directly
// (not the derived diagram model) so figures match the scan exactly.
//
// Because the scan is not 100% reliable, every row self-flags where the data is
// uncertain (⚠): a cable whose endpoint doesn't match a known board, a board with
// no rating, a zero size/length, or a whole schedule the scan never captured. The
// flags tell a reviewer exactly which lines to verify before the data is trusted.
import React, { useRef } from 'react';
import { Cable, Server, Gauge, Plug, AlertTriangle, ShieldCheck, FileText, Check, Plus, X } from 'lucide-react';
import type { ElectricalProcedureResult } from '@/lib/ai/ai-provider';
import { bucketFor, BUCKET_META } from '@/lib/plan/cost';
import { printHtmlDocument } from '@/lib/plan/print-pdf';
import { floorForCable, explainCableLength, riserFloorIndex, deriveTypicalFloors, LV_LEAD_IN_M, LV_LOOP_M } from '@/lib/electrical/derive-cable-paths';

const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[\s.\-_/]/g, '');

// Project standard is "Nr" for countable items; the scan sometimes emits "No.".
// Normalise so every row matches the sub-total/grand-total rows + the units key.
const normalizeUnit = (u?: string | null): string => {
  const t = (u ?? '').trim();
  if (!t) return 'Nr';
  if (/^(no\.?|nos\.?|nr\.?|each|ea\.?|pcs?\.?|pieces?)$/i.test(t)) return 'Nr';
  return t; // pass through m, m², Sum, Item, Lot, set, kg…
};

// Order floors basement → ground → typical (1F…) → roof → building-wide.
function floorRank(fl: string): number {
  const s = fl.toUpperCase();
  if (/BASEMENT|UNDERGROUND|\bUG\b|^B$/.test(s)) return -20;
  if (/GROUND|^G$|^GF$/.test(s)) return -10;
  const m = s.match(/(\d+)\s*F/);
  if (m) return parseInt(m[1], 10);
  if (/ROOF|^RF$/.test(s)) return 100;
  return 200; // building-wide / unassigned last
}

function Section({ icon: Icon, title, count, children }: { icon: React.ElementType; title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
        <Icon className="h-4 w-4 text-sabi-500" />
        <h3 className="text-sm font-bold text-gray-800">{title}</h3>
        {count != null && <span className="text-[11px] font-semibold text-gray-400">({count})</span>}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

// Amber notice for a schedule the scan never produced — make the gap visible
// instead of silently hiding it.
function MissingNotice({ icon: Icon, title, what }: { icon: React.ElementType; title: string; what: string }) {
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
        <div>
          <h3 className="text-sm font-bold text-amber-800">{title} — not extracted</h3>
          <p className="text-[12px] text-amber-700 mt-0.5">The scan didn&apos;t capture {what}. Add manually or re-scan the drawing before relying on this section.</p>
        </div>
      </div>
    </section>
  );
}

// Explains, in plain words, how the cable lengths in the schedule below were arrived
// at — the floor-to-floor distance, how far each run climbs, and whether lengths were
// measured off the drawing or estimated. Numbers come from the same fields the take-off
// uses, so this box always matches the lengths shown.
function LengthMethodPanel({ elec, floors }: { elec: ElectricalProcedureResult; floors: string[] }) {
  const h = Number(elec.typical_floor_height_m);
  const hasHeight = Number.isFinite(h) && h > 0;
  const scaled = !!elec.scale_detected;
  const cables = elec.cable_schedule || [];
  const hasReplica = cables.some((c) => /typical-floor replica/i.test(c.circuit_description || ''));
  const T = deriveTypicalFloors(elec);
  // Cumulative riser climb to each floor = how many floor-heights up it sits.
  // Keep EVERY floor (show "n/a" when a floor can't be resolved) so all floors appear.
  const climbs = hasHeight
    ? floors.map((f) => { const idx = riserFloorIndex(f, T); return { f, climb: idx == null ? null : idx * h }; })
    : [];

  return (
    <section className="rounded-xl border border-sabi-200 bg-sabi-50/60 px-4 py-3">
      <h3 className="text-sm font-bold text-sabi-800">How these lengths were measured</h3>
      <div className="mt-1 space-y-1 text-[12px] text-sabi-800">
        <p>
          <span className="font-semibold">Floors ({floors.length}):</span>{' '}
          {floors.length ? floors.join(' · ') : 'not read from the drawing'}
        </p>
        <p>
          <span className="font-semibold">Floor-to-floor height:</span>{' '}
          {hasHeight ? `${h} m` : 'not read from the drawing'}
          {hasHeight && <span className="text-sabi-600"> (from drawing title block)</span>}
        </p>
        <p>
          {scaled
            ? 'Lengths measured directly from the drawing scale.'
            : hasHeight
              ? `No scale on the drawing — vertical runs estimated. Each riser run = ${LV_LEAD_IN_M} m lead-in + (floors climbed × ${h} m) + ${LV_LOOP_M} m loop.`
              : 'No scale and no floor height on the drawing — vertical run lengths must be verified manually.'}
        </p>
        {hasReplica && (
          <p>Repeating floors above the typical floor reuse its lengths (multiplied, per George&apos;s rule).</p>
        )}
      </div>
      {/* The actual maths + rules used to turn the drawing into a length, always shown. */}
      <div className="mt-2 rounded-lg border border-sabi-200 bg-white px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-sabi-600">How each run&apos;s length is worked out</p>
        <ul className="mt-1 space-y-0.5 text-[11px] text-sabi-800 list-disc list-inside">
          <li>
            <span className="font-semibold">Vertical riser run</span> (main panel → sub-panel) ={' '}
            {LV_LEAD_IN_M} m lead-in + (floors climbed × {hasHeight ? `${h} m` : 'floor height'}) + {LV_LOOP_M} m loop.
          </li>
          <li><span className="font-semibold">On-floor run</span> (sub-panel → board) = measured along the floor plan.</li>
          <li>If the drawing has a scale, lengths are read straight off it; if not, the riser maths above is used.</li>
          <li>Buildings taller than 7 floors reuse the typical floor&apos;s lengths for the floors above (George&apos;s rule); shorter buildings are counted floor-by-floor.</li>
        </ul>
      </div>
      {climbs.length > 0 && (
        <div className="mt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-sabi-600">Riser climb to each floor ({climbs.length} floors)</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {climbs.map(({ f, climb }) => (
              <span key={f} className="inline-flex items-center gap-1 rounded bg-white border border-sabi-200 px-2 py-0.5 text-[11px] text-sabi-800">
                <span className="font-semibold">{f}</span>
                <span className="text-sabi-400">→</span>
                <span className="tabular-nums">{climb == null ? 'n/a' : `${climb.toFixed(1)} m`}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-1.5 font-semibold text-gray-500 uppercase tracking-wide text-[10px] ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
}
function Td({ children, right, mono }: { children: React.ReactNode; right?: boolean; mono?: boolean }) {
  return <td className={`px-3 py-1.5 text-gray-800 ${right ? 'text-right tabular-nums' : 'text-left'} ${mono ? 'font-mono' : ''}`}>{children}</td>;
}

// Inline-editable text cell: looks like the plain cell text until focused. When not
// editable (read-only view / PDF export clone) it falls back to the static `fmt` text so
// print output is unchanged. Uncontrolled (defaultValue + commit-on-blur) so typing never
// thrashes the parent state or the autosave; only a real change commits.
function EditableText({ value, onCommit, mono, editable, right }: { value: unknown; onCommit: (v: string) => void; mono?: boolean; editable?: boolean; right?: boolean }) {
  if (!editable) return <>{fmt(value)}</>;
  const orig = value == null ? '' : String(value);
  return (
    // key on the committed value: forces a remount (fresh defaultValue) when rows are
    // added/deleted and React reuses this DOM node for a different row by position.
    <input
      key={orig}
      defaultValue={orig}
      onBlur={(e) => { const v = e.target.value; if (v !== orig) onCommit(v); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      placeholder="—"
      className={`w-full min-w-[3.5rem] bg-transparent rounded px-1 -mx-1 outline-none focus:bg-white focus:ring-1 focus:ring-sabi-400 ${right ? 'text-right' : ''} ${mono ? 'font-mono' : ''}`}
    />
  );
}

// Inline-editable numeric cell. Empty input commits `null`; otherwise a parsed number.
function EditableNumber({ value, onCommit, editable }: { value: number | null | undefined; onCommit: (v: number | null) => void; editable?: boolean }) {
  if (!editable) return <>{fmt(value)}</>;
  const orig = value == null ? '' : String(value);
  return (
    <input
      key={orig}
      type="number"
      defaultValue={orig}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        if (raw === orig) return;
        onCommit(raw === '' ? null : Number(raw));
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      placeholder="—"
      className="w-full min-w-[3rem] bg-transparent rounded px-1 -mx-1 text-right tabular-nums outline-none focus:bg-white focus:ring-1 focus:ring-sabi-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
    />
  );
}

// Small ✕ to delete an editable row; renders nothing in read-only mode.
function DeleteRowBtn({ onClick, editable }: { onClick: () => void; editable?: boolean }) {
  if (!editable) return null;
  return (
    <button type="button" data-edit-only onClick={onClick} title="Delete this row" className="ml-1.5 inline-flex text-gray-300 hover:text-red-500 align-middle">
      <X className="h-3 w-3" />
    </button>
  );
}

// "+ Add row" button shown as a full-width footer row; renders nothing when read-only.
function AddRow({ cols, label, onClick, editable }: { cols: number; label: string; onClick: () => void; editable?: boolean }) {
  if (!editable) return null;
  return (
    <tr data-edit-only>
      <td colSpan={cols} className="px-3 py-1">
        <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-[11px] font-semibold text-sabi-600 hover:text-sabi-700">
          <Plus className="h-3 w-3" /> {label}
        </button>
      </td>
    </tr>
  );
}

// ⚠ chip / ✓ confirmed / green tick. Clickable when `onToggle` is given: ⚠ → confirm,
// ✓ → un-confirm. A human "confirmed" overrides the auto-flag so the row reads as resolved.
function Flag({ issues, confirmed, onToggle }: { issues: string[]; confirmed?: boolean; onToggle?: () => void }) {
  if (confirmed) {
    return (
      <button type="button" onClick={onToggle} disabled={!onToggle} title={onToggle ? 'Confirmed by reviewer — click to un-confirm' : 'Confirmed by reviewer'}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold disabled:cursor-default">
        <Check className="h-3 w-3" /> confirmed
      </button>
    );
  }
  if (issues.length === 0) return <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 inline" aria-label="ok" />;
  return (
    <button type="button" onClick={onToggle} disabled={!onToggle}
      title={`${issues.join(' · ')}${onToggle ? ' · click to confirm as checked & OK' : ''}`}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold hover:bg-amber-200 disabled:cursor-default disabled:hover:bg-amber-100">
      <AlertTriangle className="h-3 w-3" /> check
    </button>
  );
}

export default function PlanDataTables({ elec, onElecChange }: { elec: ElectricalProcedureResult; onElecChange?: (next: ElectricalProcedureResult) => void }) {
  const cables = elec.cable_schedule || [];
  const smdbs = elec.smdb_inventory || [];
  const dbs = elec.db_inventory || [];
  const loads = elec.load_summary || [];
  const supply = elec.incoming_supply;
  const outlets = elec.power_outlets || [];
  const containment = elec.containment || [];
  const earthing = elec.earthing || [];
  const metering = elec.metering || [];
  const lvPanels = elec.lv_panels || [];

  // Inline editing is on only when the parent passes a change handler (off for the PDF
  // export clone). Helpers immutably replace one slice of the result and hand the whole
  // edited object back up; the parent debounce-saves it. `commit` is the single write path.
  const editable = !!onElecChange;
  const commit = (next: ElectricalProcedureResult) => onElecChange?.(next);
  const setCables = (next: typeof cables) => commit({ ...elec, cable_schedule: next });
  const updateCable = (idx: number, patch: Partial<(typeof cables)[number]>) => setCables(cables.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  const setSmdbs = (next: typeof smdbs) => commit({ ...elec, smdb_inventory: next });
  const updateSmdb = (idx: number, patch: Partial<(typeof smdbs)[number]>) => setSmdbs(smdbs.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  const setDbs = (next: typeof dbs) => commit({ ...elec, db_inventory: next });
  const updateDb = (idx: number, patch: Partial<(typeof dbs)[number]>) => setDbs(dbs.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  const setLoads = (next: typeof loads) => commit({ ...elec, load_summary: next });
  const updateLoad = (idx: number, patch: Partial<(typeof loads)[number]>) => setLoads(loads.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const setOutlets = (next: typeof outlets) => commit({ ...elec, power_outlets: next });
  const updateOutlet = (idx: number, patch: Partial<(typeof outlets)[number]>) => setOutlets(outlets.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  const setContainment = (next: typeof containment) => commit({ ...elec, containment: next });
  const updateContainment = (idx: number, patch: Partial<(typeof containment)[number]>) => setContainment(containment.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  const setEarthing = (next: typeof earthing) => commit({ ...elec, earthing: next });
  const updateEarthing = (idx: number, patch: Partial<(typeof earthing)[number]>) => setEarthing(earthing.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  const setMetering = (next: typeof metering) => commit({ ...elec, metering: next });
  const updateMetering = (idx: number, patch: Partial<(typeof metering)[number]>) => setMetering(metering.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  const updateMdb = (patch: Partial<NonNullable<typeof elec.mdb_info>>) => commit({ ...elec, mdb_info: { ...(elec.mdb_info || { location: null, rating_a: null, floor: null, tag: null }), ...patch } });
  const updateSupply = (patch: Partial<NonNullable<typeof supply>>) => commit({ ...elec, incoming_supply: { ...(supply as NonNullable<typeof supply>), ...patch } });

  // Known board tags — used to flag cable endpoints that point at nothing.
  // Include LV panels (LVP-02…) and mechanical loads (FIRE PUMP, EV charger):
  // those are real, named endpoints, so a run feeding them is not "unmatched".
  const panelTags = new Set<string>([
    norm(elec.mdb_info?.tag),
    ...smdbs.map((s) => norm(s.id)),
    ...dbs.map((d) => norm(d.db_id)),
    ...lvPanels.map((p) => norm(p.tag)),
    ...(elec.mechanical_equipment || []).map((m) => norm(m.description)),
  ].filter(Boolean));
  const tagKnown = (tag: string) => {
    const t = norm(tag);
    if (!t) return false;
    for (const g of panelTags) if (g.startsWith(t) || t.startsWith(g)) return true;
    return false;
  };
  const cableIssues = (c: { from: string; to: string; size_mm2: number; length_m: number }) => {
    const out: string[] = [];
    if (!(c.size_mm2 > 0)) out.push('no cable size');
    if (!(c.length_m > 0)) out.push('no length');
    if (!tagKnown(c.from)) out.push(`source "${c.from}" not in board list`);
    if (!tagKnown(c.to)) out.push(`target "${c.to}" not in board list`);
    return out;
  };

  // Review tally for the banner. A human-confirmed row drops out of the count so the
  // "all clean" banner can be reached by confirming as well as by fixing.
  const flaggedCables = cables.filter((c) => cableIssues(c).length > 0 && !c.review_confirmed).length;
  const unratedPanels = [...smdbs, ...dbs].filter((p: { rating_a?: number | null; review_confirmed?: boolean }) => p.rating_a == null && !p.review_confirmed).length;
  const missing: string[] = [];
  if (outlets.length === 0) missing.push('outlets');
  if (containment.length === 0) missing.push('containment');
  if (earthing.length === 0) missing.push('earthing');
  if (metering.length === 0) missing.push('metering');
  const allClean = flaggedCables === 0 && unratedPanels === 0 && missing.length === 0;

  const rootRef = useRef<HTMLDivElement>(null);
  // Export the full data view to PDF: clone the rendered tables, drop the scroll/height
  // constraints (so every floor's schedule prints, not just the visible slice), strip the
  // export button itself, then print through the shared helper (carries the app CSS over).
  const exportPdf = () => {
    if (!rootRef.current) return;
    // Capture live input values first: the inputs are uncontrolled, so the edited value
    // lives on the DOM .value property of the ORIGINAL nodes — cloneNode only copies
    // attributes and would read stale text.
    const liveValues = Array.from(rootRef.current.querySelectorAll('input')).map((inp) => (inp as HTMLInputElement).value);
    const clone = rootRef.current.cloneNode(true) as HTMLDivElement;
    clone.style.height = 'auto';
    clone.style.overflow = 'visible';
    clone.querySelector('[data-export-pdf]')?.remove();
    // The Data tab is an inline editor; flatten its edit chrome for the printed copy so
    // the PDF reads as a clean table: drop add/delete controls, then replace each editable
    // input with its current text value (data-edit-only removal touches no inputs, so the
    // clone's input order still matches the captured live values).
    clone.querySelectorAll('[data-edit-only]').forEach((el) => el.remove());
    clone.querySelectorAll('input').forEach((inp, i) => {
      inp.replaceWith(document.createTextNode(liveValues[i] || '—'));
    });
    printHtmlDocument(
      `<h1 style="font:700 15px system-ui,sans-serif;margin:0 0 12px;color:#0f172a">Electrical Data — Cable Schedule &amp; Inventory</h1>${clone.outerHTML}`,
      { title: 'Electrical Data' },
    );
  };

  return (
    <div ref={rootRef} className="h-full overflow-y-auto bg-gray-50 p-4 space-y-4">
      {/* ── Export bar ── */}
      <div data-export-pdf className="flex justify-end">
        <button
          onClick={exportPdf}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white text-gray-600 border border-gray-300 hover:bg-gray-50 transition-colors"
        >
          <FileText className="h-3.5 w-3.5" /> Export PDF
        </button>
      </div>

      {/* ── Units key (full forms of the short-form units used in the tables) ── */}
      <div className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[11px] text-gray-500">
        <span className="font-semibold text-gray-600">Units:</span> Nr = Number · m = Metre · m² = Square metre · Sum = Lump sum
      </div>

      {/* ── Review banner ── */}
      {allClean ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 flex items-center gap-2 text-[12px] text-emerald-800">
          <ShieldCheck className="h-4 w-4" /> All extracted rows passed the consistency checks.
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-amber-800"><AlertTriangle className="h-4 w-4" /> Needs review before use</div>
          <ul className="mt-1 text-[12px] text-amber-700 list-disc list-inside space-y-0.5">
            {flaggedCables > 0 && <li><b>{flaggedCables}</b> of {cables.length} cable runs have an unmatched endpoint or missing size/length</li>}
            {unratedPanels > 0 && <li><b>{unratedPanels}</b> boards have no amp rating</li>}
            {missing.length > 0 && <li><b>{missing.join(', ')}</b> {missing.length === 1 ? 'schedule was' : 'schedules were'} not extracted from the drawing</li>}
          </ul>
          <p className="mt-1.5 text-[11px] text-amber-600">Rows marked <span className="font-bold">⚠ check</span> below are AI-estimated or inconsistent — verify them against the drawing.</p>
        </div>
      )}

      {/* ── Cable schedule — one box per floor, ordered Basement → Roof → building-wide ── */}
      {(() => {
        // Keep each row's index in the flat `cables` array so an inline edit updates the
        // correct element even though rows are displayed regrouped by floor.
        const byFloor = new Map<string, Array<{ c: (typeof cables)[number]; idx: number }>>();
        cables.forEach((c, idx) => {
          const fl = String(c.floor ?? floorForCable(c.from, c.to) ?? '').trim();
          const key = fl || 'Building-wide';
          if (!byFloor.has(key)) byFloor.set(key, []);
          byFloor.get(key)!.push({ c, idx });
        });
        const sorted = [...byFloor.keys()].sort((a, b) => floorRank(a) - floorRank(b));
        // Floors for the riser-climb breakdown: prefer the scan's full label list,
        // fall back to the floors that actually appear in the schedule.
        const panelFloors = (elec.floor_labels && elec.floor_labels.length ? elec.floor_labels : sorted)
          .slice()
          .sort((a, b) => floorRank(a) - floorRank(b));
        const grandLen = cables.reduce((s, c) => s + (c.length_m || 0), 0);
        // Cable is procured per conductor size + insulation type, so totals are split
        // by `size mm² + type` (the real BOQ line item) rather than lumped into one number.
        const breakdown = (list: typeof cables) => {
          const m = new Map<string, { size: number; type: string; count: number; len: number }>();
          for (const c of list) {
            const size = c.size_mm2 || 0;
            const type = String(c.type ?? '').trim() || '—';
            const key = `${size}|${type}`;
            const e = m.get(key) || { size, type, count: 0, len: 0 };
            e.count++; e.len += c.length_m || 0;
            m.set(key, e);
          }
          return [...m.values()].sort((a, b) => b.size - a.size); // largest size first
        };
        return (
          <>
            <LengthMethodPanel elec={elec} floors={panelFloors} />
            {sorted.map((floor) => {
              const list = byFloor.get(floor)!;
              const floorCables = list.map((p) => p.c);
              const floorLen = floorCables.reduce((s, c) => s + (c.length_m || 0), 0);
              return (
                <Section key={floor} icon={Cable} title={`Cable Schedule — ${floor}`} count={list.length}>
                  <table className="w-full text-[11px]">
                    <thead className="bg-white sticky top-0">
                      <tr className="border-b border-gray-200">
                        <Th>#</Th><Th>From</Th><Th>To</Th><Th right>Size mm²</Th><Th right>Length m</Th><Th>Type</Th><Th>Review</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {list.map(({ c, idx }, i) => {
                        const meta = BUCKET_META[bucketFor(c.size_mm2 || 0)];
                        const issues = cableIssues(c);
                        const resolved = issues.length === 0 || c.review_confirmed;
                        const explain = `Feeds ${fmt(c.to)} from ${fmt(c.from)} · ${fmt(c.size_mm2)} mm² ${fmt(c.type)} · ${fmt(c.length_m)} m run on ${floor}. · Length: ${explainCableLength(c, elec).text}.${c.source_drawing_number ? ` · Source drawing: ${c.source_drawing_number}` : ''}${issues.length ? ` · Needs review: ${issues.join(', ')}` : ''}`;
                        return (
                          <tr key={idx} title={editable ? undefined : explain} className={`${editable ? '' : 'cursor-help'} ${resolved ? 'hover:bg-sabi-50/40' : 'bg-amber-50/60'}`}>
                            <Td>{i + 1}</Td>
                            <Td mono><EditableText editable={editable} mono value={c.from} onCommit={(v) => updateCable(idx, { from: v })} /></Td>
                            <Td mono><EditableText editable={editable} mono value={c.to} onCommit={(v) => updateCable(idx, { to: v })} /></Td>
                            <Td right><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: meta.color }} /><EditableNumber editable={editable} value={c.size_mm2} onCommit={(v) => updateCable(idx, { size_mm2: v ?? 0 })} /></span></Td>
                            <Td right><EditableNumber editable={editable} value={c.length_m} onCommit={(v) => updateCable(idx, { length_m: v ?? 0 })} /></Td>
                            <Td><EditableText editable={editable} value={c.type} onCommit={(v) => updateCable(idx, { type: v })} /></Td>
                            <Td><Flag issues={issues} confirmed={c.review_confirmed} onToggle={editable ? () => updateCable(idx, { review_confirmed: !c.review_confirmed }) : undefined} /><DeleteRowBtn editable={editable} onClick={() => setCables(cables.filter((_, j) => j !== idx))} /></Td>
                          </tr>
                        );
                      })}
                      <AddRow editable={editable} cols={7} label="Add cable"
                        onClick={() => setCables([...cables, { from: '', to: '', size_mm2: 0, length_m: 0, type: '', circuit_description: null, floor: floor === 'Building-wide' ? null : floor }])} />
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 border-t border-gray-200">
                        <td colSpan={7} className="px-3 py-1 font-bold text-gray-500 uppercase tracking-wide text-[10px]">Total length by size + type</td>
                      </tr>
                      {breakdown(floorCables).map((b) => (
                        <tr key={`${b.size}|${b.type}`} className="bg-gray-50 text-gray-700">
                          <td colSpan={3} className="px-3 py-1.5">{b.count} run{b.count === 1 ? '' : 's'}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: BUCKET_META[bucketFor(b.size)].color }} />{b.size}</span>
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{Math.round(b.len)} m</td>
                          <td className="px-3 py-1.5">{b.type}</td>
                          <td />
                        </tr>
                      ))}
                      <tr className="bg-gray-100 font-bold border-t border-gray-200 text-gray-800">
                        <td colSpan={3} className="px-3 py-1.5">Floor total — {floor}</td>
                        <td className="px-3 py-1.5 text-right">—</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{Math.round(floorLen)} m</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </Section>
              );
            })}
            {cables.length > 0 && (
              <div className="rounded-xl border border-sabi-200 bg-sabi-50 px-4 py-3">
                <div className="flex items-center justify-between text-[13px] font-bold text-sabi-800">
                  <span>Total — all floors</span>
                  <span className="tabular-nums">{cables.length} cable runs · {Math.round(grandLen)} m</span>
                </div>
                <table className="w-full mt-2 text-[11px] text-sabi-800">
                  <tbody>
                    {breakdown(cables).map((b) => (
                      <tr key={`${b.size}|${b.type}`} className="border-t border-sabi-200/60">
                        <td className="py-1">
                          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: BUCKET_META[bucketFor(b.size)].color }} />{b.size} mm² {b.type}</span>
                        </td>
                        <td className="py-1 text-right tabular-nums text-sabi-600">{b.count} run{b.count === 1 ? '' : 's'}</td>
                        <td className="py-1 text-right tabular-nums font-semibold">{Math.round(b.len)} m</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        );
      })()}

      {/* ── Panel inventory ── */}
      <Section icon={Server} title="Main / LV Panel">
        <table className="w-full text-[11px]">
          <thead><tr className="border-b border-gray-200"><Th>Tag</Th><Th>Floor</Th><Th>Location</Th><Th right>Rating A</Th><Th>Outgoing MCCBs</Th><Th>Review</Th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {(() => {
              const mdbIssues = elec.mdb_info?.rating_a == null ? ['no rating'] : [];
              const mdbResolved = mdbIssues.length === 0 || elec.mdb_info?.review_confirmed;
              return (
                <tr className={mdbResolved ? '' : 'bg-amber-50/60'}>
                  <Td mono><EditableText editable={editable} mono value={elec.mdb_info?.tag} onCommit={(v) => updateMdb({ tag: v })} /></Td>
                  <Td><EditableText editable={editable} value={elec.mdb_info?.floor} onCommit={(v) => updateMdb({ floor: v })} /></Td>
                  <Td><EditableText editable={editable} value={elec.mdb_info?.location} onCommit={(v) => updateMdb({ location: v })} /></Td>
                  <Td right><EditableNumber editable={editable} value={elec.mdb_info?.rating_a} onCommit={(v) => updateMdb({ rating_a: v })} /></Td>
                  <Td>{lvPanels[0]?.outgoing_mccbs?.map((m) => `${m.to}:${m.rating_a}A×${m.count}`).join(', ') || '—'}</Td>
                  <Td><Flag issues={mdbIssues} confirmed={elec.mdb_info?.review_confirmed} onToggle={editable ? () => updateMdb({ review_confirmed: !elec.mdb_info?.review_confirmed }) : undefined} /></Td>
                </tr>
              );
            })()}
          </tbody>
        </table>
      </Section>

      <Section icon={Server} title="Sub-Main Distribution Boards (SMDB)" count={smdbs.length}>
        <table className="w-full text-[11px]">
          <thead><tr className="border-b border-gray-200"><Th>Tag</Th><Th>Floor</Th><Th right>Rating A</Th><Th>Feeder from MDB</Th><Th right>Load kW</Th><Th>Review</Th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {smdbs.map((s, i) => {
              const iss = [s.rating_a == null ? 'no rating' : '', !s.cable_size_from_mdb ? 'no feeder size' : ''].filter(Boolean);
              const resolved = iss.length === 0 || s.review_confirmed;
              return (
                <tr key={i} className={resolved ? 'hover:bg-sabi-50/40' : 'bg-amber-50/60'}>
                  <Td mono><EditableText editable={editable} mono value={s.id} onCommit={(v) => updateSmdb(i, { id: v })} /></Td>
                  <Td><EditableText editable={editable} value={s.floor} onCommit={(v) => updateSmdb(i, { floor: v })} /></Td>
                  <Td right><EditableNumber editable={editable} value={s.rating_a} onCommit={(v) => updateSmdb(i, { rating_a: v })} /></Td>
                  <Td><EditableText editable={editable} value={s.cable_size_from_mdb} onCommit={(v) => updateSmdb(i, { cable_size_from_mdb: v })} /></Td>
                  <Td right><EditableNumber editable={editable} value={s.connected_load_kw} onCommit={(v) => updateSmdb(i, { connected_load_kw: v })} /></Td>
                  <Td><Flag issues={iss} confirmed={s.review_confirmed} onToggle={editable ? () => updateSmdb(i, { review_confirmed: !s.review_confirmed }) : undefined} /><DeleteRowBtn editable={editable} onClick={() => setSmdbs(smdbs.filter((_, j) => j !== i))} /></Td>
                </tr>
              );
            })}
            <AddRow editable={editable} cols={6} label="Add SMDB"
              onClick={() => setSmdbs([...smdbs, { id: '', floor: '', rating_a: null, cable_size_from_mdb: null, connected_load_kw: null }])} />
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-semibold border-t border-gray-200 text-gray-700">
              <td colSpan={4} className="px-3 py-1.5">Total — {smdbs.length} board{smdbs.length === 1 ? '' : 's'}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{Math.round(smdbs.reduce((s, x) => s + (x.connected_load_kw || 0), 0))} kW</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </Section>

      <Section icon={Server} title="Distribution Boards (DB)" count={dbs.length}>
        <table className="w-full text-[11px]">
          <thead><tr className="border-b border-gray-200"><Th>Fed from SMDB</Th><Th>DB tag</Th><Th>Floor</Th><Th right>Rating A</Th><Th>Cable size</Th><Th>Review</Th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {dbs.map((d, i) => {
              const iss = [d.rating_a == null ? 'no rating' : '', !d.cable_size ? 'no cable size' : ''].filter(Boolean);
              const resolved = iss.length === 0 || d.review_confirmed;
              return (
                <tr key={i} className={resolved ? 'hover:bg-sabi-50/40' : 'bg-amber-50/60'}>
                  <Td mono><EditableText editable={editable} mono value={d.smdb_id} onCommit={(v) => updateDb(i, { smdb_id: v })} /></Td>
                  <Td mono><EditableText editable={editable} mono value={d.db_id} onCommit={(v) => updateDb(i, { db_id: v })} /></Td>
                  <Td><EditableText editable={editable} value={d.floor} onCommit={(v) => updateDb(i, { floor: v })} /></Td>
                  <Td right><EditableNumber editable={editable} value={d.rating_a} onCommit={(v) => updateDb(i, { rating_a: v })} /></Td>
                  <Td><EditableText editable={editable} value={d.cable_size} onCommit={(v) => updateDb(i, { cable_size: v })} /></Td>
                  <Td><Flag issues={iss} confirmed={d.review_confirmed} onToggle={editable ? () => updateDb(i, { review_confirmed: !d.review_confirmed }) : undefined} /><DeleteRowBtn editable={editable} onClick={() => setDbs(dbs.filter((_, j) => j !== i))} /></Td>
                </tr>
              );
            })}
            <AddRow editable={editable} cols={6} label="Add DB"
              onClick={() => setDbs([...dbs, { smdb_id: '', db_id: '', floor: '', rating_a: null, cable_size: null }])} />
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-semibold border-t border-gray-200 text-gray-700">
              <td colSpan={6} className="px-3 py-1.5">Total — {dbs.length} board{dbs.length === 1 ? '' : 's'}</td>
            </tr>
          </tfoot>
        </table>
      </Section>

      {/* ── Loads & incoming supply ── */}
      {loads.length > 0 && (
        <Section icon={Gauge} title="Load Summary" count={loads.length}>
          <table className="w-full text-[11px]">
            <thead><tr className="border-b border-gray-200"><Th>Panel</Th><Th right>TCL kW</Th><Th right>Standby kW</Th><Th right>Demand factor</Th><Th right>Max demand kW</Th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {loads.map((l, i) => (
                <tr key={i}>
                  <Td mono><EditableText editable={editable} mono value={l.panel} onCommit={(v) => updateLoad(i, { panel: v })} /></Td>
                  <Td right><EditableNumber editable={editable} value={l.tcl_kw} onCommit={(v) => updateLoad(i, { tcl_kw: v ?? 0 })} /></Td>
                  <Td right><EditableNumber editable={editable} value={l.standby_kw} onCommit={(v) => updateLoad(i, { standby_kw: v ?? 0 })} /></Td>
                  <Td right><EditableNumber editable={editable} value={l.demand_factor} onCommit={(v) => updateLoad(i, { demand_factor: v ?? 0 })} /></Td>
                  <Td right><span className="inline-flex items-center justify-end"><EditableNumber editable={editable} value={l.max_demand_kw} onCommit={(v) => updateLoad(i, { max_demand_kw: v ?? 0 })} /><DeleteRowBtn editable={editable} onClick={() => setLoads(loads.filter((_, j) => j !== i))} /></span></Td>
                </tr>
              ))}
              <AddRow editable={editable} cols={5} label="Add load row"
                onClick={() => setLoads([...loads, { panel: '', tcl_kw: 0, standby_kw: 0, demand_factor: 0, max_demand_kw: 0 }])} />
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-semibold border-t border-gray-200 text-gray-700">
                <td className="px-3 py-1.5">Total</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{Math.round(loads.reduce((s, l) => s + (l.tcl_kw || 0), 0))}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{Math.round(loads.reduce((s, l) => s + (l.standby_kw || 0), 0))}</td>
                <td className="px-3 py-1.5 text-right">—</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{Math.round(loads.reduce((s, l) => s + (l.max_demand_kw || 0), 0))}</td>
              </tr>
            </tfoot>
          </table>
        </Section>
      )}

      {supply && (supply.transformers?.length || supply.generator || supply.ats || editable) && (
        <Section icon={Gauge} title="Incoming Supply">
          <table className="w-full text-[11px]">
            <tbody className="divide-y divide-gray-50">
              {(supply.transformers || []).map((t, i) => (
                <tr key={`t${i}`}>
                  <Td>Transformer</Td>
                  <Td right><span className="inline-flex items-center justify-end gap-1"><EditableNumber editable={editable} value={t.kva} onCommit={(v) => updateSupply({ transformers: (supply.transformers || []).map((x, j) => (j === i ? { ...x, kva: v ?? 0 } : x)) })} /> kVA</span></Td>
                  <Td><EditableText editable={editable} value={t.voltage_ratio} onCommit={(v) => updateSupply({ transformers: (supply.transformers || []).map((x, j) => (j === i ? { ...x, voltage_ratio: v } : x)) })} /></Td>
                  <Td right><span className="inline-flex items-center justify-end">×<EditableNumber editable={editable} value={t.count} onCommit={(v) => updateSupply({ transformers: (supply.transformers || []).map((x, j) => (j === i ? { ...x, count: v ?? 0 } : x)) })} /><DeleteRowBtn editable={editable} onClick={() => updateSupply({ transformers: (supply.transformers || []).filter((_, j) => j !== i) })} /></span></Td>
                </tr>
              ))}
              <AddRow editable={editable} cols={4} label="Add transformer"
                onClick={() => updateSupply({ transformers: [...(supply.transformers || []), { kva: 0, voltage_ratio: '', count: 1 }] })} />
              {supply.generator && (
                <tr>
                  <Td>Generator</Td>
                  <Td right><span className="inline-flex items-center justify-end gap-1"><EditableNumber editable={editable} value={supply.generator.kva} onCommit={(v) => updateSupply({ generator: { ...supply.generator!, kva: v ?? 0 } })} /> kVA</span></Td>
                  <Td><EditableText editable={editable} value={supply.generator.type} onCommit={(v) => updateSupply({ generator: { ...supply.generator!, type: v } })} /></Td>
                  <Td right>—</Td>
                </tr>
              )}
              {supply.ats && (
                <tr>
                  <Td>ATS</Td>
                  <Td right><span className="inline-flex items-center justify-end gap-1"><EditableNumber editable={editable} value={supply.ats.rating_a} onCommit={(v) => updateSupply({ ats: { ...supply.ats!, rating_a: v ?? 0 } })} /> A</span></Td>
                  <Td>—</Td><Td right>—</Td>
                </tr>
              )}
            </tbody>
          </table>
        </Section>
      )}

      {/* ── Accessory schedules — show real data, or a visible "not extracted" notice ── */}
      {outlets.length > 0 || editable ? (
        <Section icon={Plug} title="Power Outlets" count={outlets.length}>
          <table className="w-full text-[11px]">
            <thead><tr className="border-b border-gray-200"><Th>Description</Th><Th>Unit</Th><Th right>Qty</Th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {(() => {
                // Floor-wise take-off: group by floor (this floor has X, that floor
                // has Y) with a per-floor sub-total, then a building grand total.
                // Keep each row's flat index so inline edits hit the right element.
                const byFloor = new Map<string, Array<{ o: (typeof outlets)[number]; idx: number }>>();
                outlets.forEach((o, idx) => {
                  const fl = (o.floor || '').toString().trim();
                  const key = fl || 'Building-wide';
                  if (!byFloor.has(key)) byFloor.set(key, []);
                  byFloor.get(key)!.push({ o, idx });
                });
                const sorted = [...byFloor.keys()].sort((a, b) => floorRank(a) - floorRank(b));
                const rows: React.ReactNode[] = [];
                for (const floor of sorted) {
                  const list = byFloor.get(floor)!;
                  const sub = list.reduce((s, p) => s + (p.o.estimated_qty || 0), 0);
                  rows.push(
                    <tr key={`h-${floor}`} className="bg-sabi-50/70"><td colSpan={3} className="px-3 py-1 font-bold text-sabi-700 uppercase tracking-wide text-[10px]">{floor}</td></tr>,
                  );
                  list.forEach(({ o, idx }) => rows.push(
                    <tr key={`o-${idx}`}>
                      <Td><EditableText editable={editable} value={o.description} onCommit={(v) => updateOutlet(idx, { description: v })} /></Td>
                      <Td>{editable ? <EditableText editable value={o.unit} onCommit={(v) => updateOutlet(idx, { unit: v })} /> : normalizeUnit(o.unit)}</Td>
                      <Td right><span className="inline-flex items-center justify-end"><EditableNumber editable={editable} value={o.estimated_qty} onCommit={(v) => updateOutlet(idx, { estimated_qty: v ?? 0 })} /><DeleteRowBtn editable={editable} onClick={() => setOutlets(outlets.filter((_, j) => j !== idx))} /></span></Td>
                    </tr>,
                  ));
                  rows.push(
                    <AddRow key={`a-${floor}`} editable={editable} cols={3} label="Add outlet"
                      onClick={() => setOutlets([...outlets, { description: '', unit: 'Nr', estimated_qty: 0, floor: floor === 'Building-wide' ? null : floor }])} />,
                  );
                  rows.push(
                    <tr key={`s-${floor}`} className="bg-gray-50 font-semibold"><Td>Sub-total — {floor}</Td><Td>Nr</Td><Td right>{sub}</Td></tr>,
                  );
                }
                if (editable && sorted.length === 0) {
                  rows.push(
                    <AddRow key="a-empty" editable cols={3} label="Add outlet"
                      onClick={() => setOutlets([...outlets, { description: '', unit: 'Nr', estimated_qty: 0, floor: null }])} />,
                  );
                }
                const grand = outlets.reduce((s, o) => s + (o.estimated_qty || 0), 0);
                rows.push(
                  <tr key="grand" className="bg-sabi-100 font-bold"><Td>TOTAL — all floors</Td><Td>Nr</Td><Td right>{grand}</Td></tr>,
                );
                return rows;
              })()}
            </tbody>
          </table>
        </Section>
      ) : <MissingNotice icon={Plug} title="Power Outlets" what="socket / outlet quantities (the drawing has a power legend, but counts weren't read)" />}

      {containment.length > 0 || editable ? (
        <Section icon={Plug} title="Containment" count={containment.length}>
          <table className="w-full text-[11px]">
            <thead><tr className="border-b border-gray-200"><Th>Description</Th><Th>Unit</Th><Th right>Qty</Th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {containment.map((c, i) => (
                <tr key={i}>
                  <Td><EditableText editable={editable} value={c.description} onCommit={(v) => updateContainment(i, { description: v })} /></Td>
                  <Td>{editable ? <EditableText editable value={c.unit} onCommit={(v) => updateContainment(i, { unit: v })} /> : normalizeUnit(c.unit)}</Td>
                  <Td right><span className="inline-flex items-center justify-end"><EditableNumber editable={editable} value={c.estimated_qty} onCommit={(v) => updateContainment(i, { estimated_qty: v ?? 0 })} /><DeleteRowBtn editable={editable} onClick={() => setContainment(containment.filter((_, j) => j !== i))} /></span></Td>
                </tr>
              ))}
              <AddRow editable={editable} cols={3} label="Add containment item"
                onClick={() => setContainment([...containment, { description: '', unit: 'm', estimated_qty: 0 }])} />
            </tbody>
            <tfoot>
              {(() => {
                const units = new Set(containment.map((c) => normalizeUnit(c.unit)));
                const sum = Math.round(containment.reduce((s, c) => s + (c.estimated_qty || 0), 0));
                return (
                  <tr className="bg-gray-50 font-semibold border-t border-gray-200 text-gray-700">
                    <td className="px-3 py-1.5">Total — {containment.length} item{containment.length === 1 ? '' : 's'}</td>
                    <td className="px-3 py-1.5">{units.size === 1 ? [...units][0] : '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{sum}</td>
                  </tr>
                );
              })()}
            </tfoot>
          </table>
        </Section>
      ) : <MissingNotice icon={Plug} title="Containment (cable tray / trunking / conduit)" what="containment lengths" />}

      {earthing.length > 0 || metering.length > 0 || editable ? (
        <Section icon={Plug} title="Earthing & Metering" count={earthing.length + metering.length}>
          <table className="w-full text-[11px]">
            <thead><tr className="border-b border-gray-200"><Th>Item</Th><Th>Description</Th><Th right>Qty</Th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {earthing.map((e, i) => (
                <tr key={`e${i}`}>
                  <Td>Earthing</Td>
                  <Td><EditableText editable={editable} value={e.description} onCommit={(v) => updateEarthing(i, { description: v })} /></Td>
                  <Td right><span className="inline-flex items-center justify-end"><EditableNumber editable={editable} value={e.qty} onCommit={(v) => updateEarthing(i, { qty: v ?? 0 })} /><DeleteRowBtn editable={editable} onClick={() => setEarthing(earthing.filter((_, j) => j !== i))} /></span></Td>
                </tr>
              ))}
              <AddRow editable={editable} cols={3} label="Add earthing item"
                onClick={() => setEarthing([...earthing, { description: '', unit: 'Nr', qty: 0 }])} />
              {metering.map((m, i) => (
                <tr key={`m${i}`}>
                  <Td>Metering</Td>
                  <Td><EditableText editable={editable} value={m.description} onCommit={(v) => updateMetering(i, { description: v })} /></Td>
                  <Td right><span className="inline-flex items-center justify-end"><EditableNumber editable={editable} value={m.qty} onCommit={(v) => updateMetering(i, { qty: v ?? 0 })} /><DeleteRowBtn editable={editable} onClick={() => setMetering(metering.filter((_, j) => j !== i))} /></span></Td>
                </tr>
              ))}
              <AddRow editable={editable} cols={3} label="Add metering item"
                onClick={() => setMetering([...metering, { description: '', qty: 0 }])} />
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-semibold border-t border-gray-200 text-gray-700">
                <td colSpan={2} className="px-3 py-1.5">Total — {earthing.length + metering.length} item{earthing.length + metering.length === 1 ? '' : 's'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{Math.round([...earthing, ...metering].reduce((s, x) => s + (x.qty || 0), 0))}</td>
              </tr>
            </tfoot>
          </table>
        </Section>
      ) : <MissingNotice icon={Plug} title="Earthing & Metering" what="earthing and metering items" />}
    </div>
  );
}
