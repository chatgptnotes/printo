'use client';

import React from 'react';
import { Cable, Layers, AlertTriangle, FlaskConical } from 'lucide-react';
import { formatAED } from '@/lib/shared/utils';
import type { SvgPlanModel } from '@/lib/plan/types';
import { computeCost, RateMap, BUCKET_META } from '@/lib/plan/cost';

export default function CostPanel({
  model,
  rates,
  onRateChange,
}: {
  model: SvgPlanModel;
  rates: RateMap;
  onRateChange: (next: RateMap) => void;
}) {
  const cost = computeCost(model, rates);

  return (
    <div className="flex flex-col bg-white">
      <div className="px-4 py-3 border-b border-gray-200 bg-gradient-to-r from-sabi-500 to-sabi-600">
        <div className="flex items-center gap-2 text-white">
          <Layers className="h-4 w-4" />
          <h2 className="text-sm font-bold">Material &amp; Cost Estimator</h2>
        </div>
        {model.isDemo && (
          <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-100">
            <FlaskConical className="h-3 w-3" /> Sample data — open a project to load real cables
          </span>
        )}
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-px bg-gray-200">
        <div className="bg-white px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-500">Total Wire Length</p>
          <p className="text-xl font-bold text-gray-900">{cost.totalLengthM.toLocaleString()} <span className="text-sm font-medium text-gray-500">m</span></p>
        </div>
        <div className="bg-white px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-500">Est. Wire Cost</p>
          <p className="text-xl font-bold text-emerald-600">{formatAED(cost.totalCost)}</p>
        </div>
      </div>

      {/* Per-gauge breakdown with live-editable rates */}
      <div className="p-4 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Breakdown by gauge</p>
        {cost.byBucket.map((b) => (
          <div key={b.bucket} className="rounded-xl border border-gray-200 p-3">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: b.color }} />
              <span className="text-sm font-semibold text-gray-800 flex-1">{b.label}</span>
              <span className="text-[11px] text-gray-400">{b.runs} run{b.runs === 1 ? '' : 's'}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-gray-400">{BUCKET_META[b.bucket].hint}</p>
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1">
                <p className="text-[11px] text-gray-500">Length</p>
                <p className="text-sm font-semibold text-gray-900">{b.lengthM.toLocaleString()} m</p>
              </div>
              <div className="flex-1">
                <label className="text-[11px] text-gray-500">Rate (AED/m)</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={b.ratePerM}
                  onChange={(e) =>
                    onRateChange({ ...rates, [b.bucket]: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm font-semibold text-gray-900 focus:border-sabi-500 focus:outline-none focus:ring-1 focus:ring-sabi-500"
                />
              </div>
              <div className="flex-1 text-right">
                <p className="text-[11px] text-gray-500">Amount</p>
                <p className="text-sm font-bold text-gray-900">{formatAED(b.amount)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Notes */}
      <div className="mt-auto px-4 py-3 border-t border-gray-200 space-y-2 text-[11px] text-gray-500">
        <p className="flex items-center gap-1.5">
          <Cable className="h-3.5 w-3.5" /> {model.cables.length} cable runs · {model.floors.length} floors · {model.panels.length} panels
        </p>
        {model.unresolvedCount > 0 && (
          <p className="flex items-start gap-1.5 text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            {model.unresolvedCount} run{model.unresolvedCount === 1 ? '' : 's'} couldn&apos;t be routed in 3D (tags unmatched) — length still counted in the cost above.
          </p>
        )}
        <p className="italic">Lengths are estimate-derived from the cable schedule; the building shell is a schematic riser.</p>
      </div>
    </div>
  );
}
