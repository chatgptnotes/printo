'use client';

// Embeddable Plan & Wiring diagram — used inline on the bid detail page (and anywhere
// an ElectricalProcedureResult is in hand). Owns its toggle state; renders the toolbar
// + the 2D SVG. For the full-screen experience (cost panel, project picker) link to /plan.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Zap, Tag as TagIcon, Lightbulb, Plug, Layers3, Ruler } from 'lucide-react';
import type { ElectricalProcedureResult } from '@/lib/ai/ai-provider';
import { buildPlanModel } from '@/lib/plan/build-model';
import PlanSvg, { ViewToggles, CableLabelModeSwitch } from './PlanSvg';
import PlanDataTables from './PlanDataTables';
import PlanSummary from './PlanSummary';

function Toggle({ active, on, off, label, onClick }: { active: boolean; on: React.ReactNode; off: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
        active ? 'bg-sabi-500 text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
      }`}
    >
      {active ? on : off} {label}
    </button>
  );
}

export default function PlanDiagram({
  elec,
  project,
  height,
  projectId,
}: {
  elec: ElectricalProcedureResult | null;
  project?: { floors?: number | null; total_area_sqft?: number | null; building_name?: string | null };
  height?: number;
  // When given, the Data tab becomes an inline editor and edits autosave to this
  // project's electrical record (same endpoint the /plan page uses). Omit for read-only embeds.
  projectId?: string;
}) {
  const [view, setView] = useState<'diagram' | 'data'>('diagram');

  // Editable working copy of the scan. The parent passes a freshly-derived `elec`
  // object on every render (new identity, same content), so re-sync only when the
  // CONTENT changes (a real reload) — never on a plain re-render, or local edits
  // would be wiped. Local edits update this copy and debounce-save to the server.
  const [editedElec, setEditedElec] = useState<ElectricalProcedureResult | null>(elec);
  const sig = elec ? JSON.stringify(elec) : '';
  useEffect(() => { setEditedElec(elec); /* resync to server content on reload */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);
  const onElecChange = useCallback((next: ElectricalProcedureResult) => {
    setEditedElec(next);
    if (!projectId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`/api/projects/${projectId}/electrical`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ electrical: next }),
      }).catch(() => {});
    }, 700);
  }, [projectId]);
  const [toggles, setToggles] = useState<ViewToggles>({
    showFloors: true,
    isolateWiring: false,
    showPanels: true,
    showLabels: true,
    showCableLabels: true,
    cableLabelMode: 'merged',
    showOutlets: true,
    showLighting: true,
  });
  const set = (k: keyof ViewToggles) => () => setToggles((t) => ({ ...t, [k]: !t[k] }));

  const model = useMemo(
    () => (editedElec && Array.isArray(editedElec.cable_schedule) && editedElec.cable_schedule.length > 0 ? buildPlanModel(editedElec, project) : null),
    [editedElec, project],
  );

  if (!model) {
    return (
      <div className="p-8 text-center text-sm text-gray-500">
        The Plan &amp; Wiring diagram appears here once the electrical scan has produced a cable schedule
        (run <span className="font-semibold">Run Pricing</span>).
      </div>
    );
  }

  // Embed height scales with the building so a tall riser (14+ floors) renders
  // at a readable size instead of being crammed into a fixed box; capped so it
  // doesn't dominate the page, and short buildings stay compact. Caller can
  // still override via the `height` prop.
  const viewportH = height ?? Math.round(Math.min(980, Math.max(440, model.height * 0.66 + 60)));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3 pb-2">
        <div className="flex items-center rounded-lg bg-gray-100 p-0.5 mr-1">
          {(['diagram', 'data'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold capitalize transition-colors ${view === v ? 'bg-white text-sabi-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {v}
            </button>
          ))}
        </div>
        <span className={view === 'diagram' ? 'contents' : 'hidden'}>
        <Toggle active={toggles.showFloors} onClick={set('showFloors')} label="Floors" on={<Layers3 className="h-3 w-3" />} off={<Layers3 className="h-3 w-3" />} />
        <Toggle active={toggles.isolateWiring} onClick={set('isolateWiring')} label="Isolate Wiring" on={<Zap className="h-3 w-3" />} off={<Zap className="h-3 w-3" />} />
        <Toggle active={toggles.showPanels} onClick={set('showPanels')} label="Panels" on={<Eye className="h-3 w-3" />} off={<EyeOff className="h-3 w-3" />} />
        <Toggle active={toggles.showLabels} onClick={set('showLabels')} label="Labels" on={<TagIcon className="h-3 w-3" />} off={<TagIcon className="h-3 w-3" />} />
        <Toggle active={toggles.showCableLabels} onClick={set('showCableLabels')} label="Cable specs" on={<Ruler className="h-3 w-3" />} off={<Ruler className="h-3 w-3" />} />
        {toggles.showCableLabels && (
          <CableLabelModeSwitch mode={toggles.cableLabelMode} onChange={(m) => setToggles((t) => ({ ...t, cableLabelMode: m }))} />
        )}
        <Toggle active={toggles.showOutlets} onClick={set('showOutlets')} label="Outlets" on={<Plug className="h-3 w-3" />} off={<Plug className="h-3 w-3" />} />
        <Toggle active={toggles.showLighting} onClick={set('showLighting')} label="Lighting" on={<Lightbulb className="h-3 w-3" />} off={<Lightbulb className="h-3 w-3" />} />
        </span>
      </div>
      <PlanSummary model={model} />
      <div style={{ height: viewportH }} className="border-t border-gray-100">
        {view === 'diagram' ? <PlanSvg model={model} toggles={toggles} onToggle={(k) => setToggles((t) => ({ ...t, [k]: !t[k] }))} onCableLabelMode={(m) => setToggles((t) => ({ ...t, cableLabelMode: m }))} /> : <PlanDataTables elec={editedElec!} onElecChange={projectId ? onElecChange : undefined} />}
      </div>
    </div>
  );
}
