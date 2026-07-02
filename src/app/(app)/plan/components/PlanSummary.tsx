'use client';

// Plain-language summary of the wiring plan — turns the computed SvgPlanModel into a
// readable sentence + stat grid + colour legend, so a non-engineer can understand the
// diagram without reading the drawing. Pure presentation; all numbers come from the model.
import React from 'react';
import { Info, AlertTriangle } from 'lucide-react';
import type { SvgPlanModel } from '@/lib/plan/types';
import { PANEL_STROKE } from './PlanSvg';
import { BUCKETS } from '@/lib/plan/cost';

const PANEL_LEGEND: Array<{ kind: 'mdb' | 'smdb' | 'db'; label: string }> = [
  { kind: 'mdb', label: 'Main panel (MDB)' },
  { kind: 'smdb', label: 'Sub-panel (SMDB)' },
  { kind: 'db', label: 'Distribution board (DB)' },
];

export default function PlanSummary({ model }: { model: SvgPlanModel }) {
  const s = model.summary;

  // ── Readable sentence ──────────────────────────────────────────────────
  const sentence: string[] = [];
  sentence.push(`This building has ${s.floorsIdentified} floor${s.floorsIdentified === 1 ? '' : 's'}.`);
  if (s.mdbTag) {
    const rating = s.mdbRatingA ? ` (${s.mdbRatingA}A)` : '';
    const feeds: string[] = [];
    if (s.smdbCount) feeds.push(`${s.smdbCount} sub-panel${s.smdbCount === 1 ? '' : 's'} (SMDB)`);
    if (s.dbCount) feeds.push(`${s.dbCount} distribution board${s.dbCount === 1 ? '' : 's'} (DB)`);
    sentence.push(`The main panel ${s.mdbTag}${rating} feeds ${feeds.join(' and ') || 'the building'}.`);
  } else if (s.smdbCount || s.dbCount) {
    sentence.push(`It has ${s.smdbCount} sub-panel${s.smdbCount === 1 ? '' : 's'} (SMDB) and ${s.dbCount} distribution board${s.dbCount === 1 ? '' : 's'} (DB).`);
  }
  if (s.totalCableLengthM > 0) sentence.push(`Total estimated cabling ≈ ${Math.round(s.totalCableLengthM).toLocaleString()} m.`);

  // ── Lighting line ──────────────────────────────────────────────────────
  const lightingLine = s.lightingTotal > 0
    ? `≈ ${s.lightingTotal.toLocaleString()} light fitting${s.lightingTotal === 1 ? '' : 's'}${s.lightingTypes ? ` across ${s.lightingTypes} type${s.lightingTypes === 1 ? '' : 's'}` : ''} read from the drawing legend — itemised in the Excel BOQ (Bill 8).`
    : 'Lighting estimated by floor area (no fixture legend found on the drawing) — see the Excel BOQ (Bill 8).';

  // ── Stat grid ──────────────────────────────────────────────────────────
  const stats: Array<[string, string]> = [
    ['Floors', String(s.floorsIdentified)],
    ['Main panel', s.mdbTag ? `${s.mdbTag}${s.mdbRatingA ? ` · ${s.mdbRatingA}A` : ''}` : '—'],
    ['Sub-panels (SMDB)', String(s.smdbCount)],
    ['Boards (DB)', String(s.dbCount)],
    ['Power outlets', s.outletsTotal ? s.outletsTotal.toLocaleString() : '—'],
    ['Light fittings', s.lightingTotal ? s.lightingTotal.toLocaleString() : '—'],
    ['Total wire length', `${Math.round(s.totalCableLengthM).toLocaleString()} m`],
    ['Cable runs', String(model.cables.length)],
  ];

  return (
    <div className="border-b border-gray-100 bg-slate-50/60 px-4 py-3 space-y-3">
      {/* Plain-language sentence */}
      <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-gray-700">
        <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-sabi-500" />
        <span>{sentence.join(' ')}</span>
      </p>

      {/* Lighting + wire length in words */}
      <p className="text-[11.5px] text-gray-500 pl-6">💡 {lightingLine}</p>

      {/* Stat grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-gray-400">{k}</div>
            <div className="text-[12.5px] font-bold text-gray-900 truncate" title={v}>{v}</div>
          </div>
        ))}
      </div>

      {/* Colour legend — what the boxes and lines mean */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Boxes:</span>
        {PANEL_LEGEND.map((p) => (
          <span key={p.kind} className="flex items-center gap-1.5 text-[11px] text-gray-600">
            <span className="h-3 w-3 rounded-sm border" style={{ borderColor: PANEL_STROKE[p.kind], background: PANEL_STROKE[p.kind] + '22' }} />
            {p.label}
          </span>
        ))}
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 ml-2">Cables:</span>
        {BUCKETS.map((b) => (
          <span key={b.bucket} className="flex items-center gap-1.5 text-[11px] text-gray-600" title={b.hint}>
            <span className="h-0.5 w-4 rounded-full" style={{ background: b.color }} />
            {b.label}
          </span>
        ))}
      </div>

      {/* Honest note when some cable runs couldn't be placed on the diagram */}
      {model.unresolvedCount > 0 && (
        <p className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>{model.unresolvedCount} cable run{model.unresolvedCount === 1 ? '' : 's'} couldn&apos;t be matched to a panel on the diagram (still counted in the totals above) — open the <b>Data</b> tab to review.</span>
        </p>
      )}
    </div>
  );
}
