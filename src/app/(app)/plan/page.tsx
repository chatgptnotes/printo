'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Box, Eye, EyeOff, Zap, Tag as TagIcon, Lightbulb, Plug, Loader2, ArrowLeft, Layers3, Ruler, ScanLine, FileSpreadsheet, Maximize2, Minimize2 } from 'lucide-react';
import Link from 'next/link';
import type { ElectricalProcedureResult } from '@/lib/ai/ai-provider';
import { buildPlanModel } from '@/lib/plan/build-model';
import { DEMO_MODEL, DEMO_ELEC } from '@/lib/plan/demo-model';
import { DEFAULT_RATES, RateMap } from '@/lib/plan/cost';
import type { SvgPlanModel } from '@/lib/plan/types';
import PlanSvg, { ViewToggles, CableLabelModeSwitch } from './components/PlanSvg';
import PlanDataTables from './components/PlanDataTables';
import PlanSummary from './components/PlanSummary';
import CostPanel from './components/CostPanel';

const DEMO_ELEC_RAW = DEMO_ELEC as ElectricalProcedureResult;

interface PickProject { id: string; project_name?: string | null; client_name?: string | null; }

function ToggleBtn({ active, on, off, label, onClick }: { active: boolean; on: React.ReactNode; off: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
        active ? 'bg-sabi-500 text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
      }`}
    >
      {active ? on : off} {label}
    </button>
  );
}

function ExtractionDetails({ model }: { model: SvgPlanModel }) {
  const s = model.summary;
  const rows: Array<[string, string]> = [
    ['Floors identified', String(s.floorsIdentified)],
    ['Drawing scale', s.drawingScale ? `${s.drawingScale}${s.scaleDetected ? '' : ' (assumed)'}` : 'not detected'],
    ['Main panel (MDB)', s.mdbTag ? `${s.mdbTag}${s.mdbRatingA ? ` · ${s.mdbRatingA}A` : ''}` : '—'],
    ['Sub-mains (SMDB)', String(s.smdbCount)],
    ['Distribution boards', String(s.dbCount)],
    ['Cable runs', String(model.cables.length)],
    ['Total cable length', `${s.totalCableLengthM.toLocaleString()} m`],
    ['Power outlets', s.outletsTotal ? String(s.outletsTotal) : '—'],
  ];
  return (
    <div className="border-b border-gray-200 bg-white">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-slate-700 to-slate-800 text-white">
        <ScanLine className="h-4 w-4" />
        <h2 className="text-sm font-bold">Extraction Details</h2>
      </div>
      <dl className="divide-y divide-gray-100">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between px-4 py-1.5">
            <dt className="text-[12px] text-gray-500">{k}</dt>
            <dd className="text-[12px] font-semibold text-gray-900 text-right">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function PlanInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get('project');

  const [model, setModel] = useState<SvgPlanModel>(DEMO_MODEL);
  const [elecRaw, setElecRaw] = useState<ElectricalProcedureResult>(DEMO_ELEC_RAW);
  const [view, setView] = useState<'diagram' | 'data'>('diagram');
  // Focus mode hides the top summary strip + right sidebar so the diagram fills the screen.
  const [focusMode, setFocusMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pickList, setPickList] = useState<PickProject[]>([]);
  const [rates, setRates] = useState<RateMap>(DEFAULT_RATES);
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const elecSaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(() => {
    fetch('/api/projects?status=boq_ready')
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((d) => setPickList(Array.isArray(d.projects) ? d.projects : []))
      .catch(() => setPickList([]));
  }, []);

  useEffect(() => {
    if (!projectId) { setModel(DEMO_MODEL); setElecRaw(DEMO_ELEC_RAW); setNote(null); setRates(DEFAULT_RATES); return; }
    let cancelled = false;
    setLoading(true);
    setNote(null);
    fetch(`/api/projects/${projectId}`)
      .then((r) => { if (!r.ok) throw new Error('not found'); return r.json(); })
      .then((data) => {
        if (cancelled) return;
        const proj = data.project || data;
        const svc = (proj.services || []).find((s: { service_type?: string }) => s.service_type === 'electrical');
        // Fields like typical_floor_height_m / scale_detected / floor_labels live only
        // under raw_electrical_procedure on a real scan (the stored top-level object
        // omits them). Unwrap to the full result — same as build-model does — so the
        // Data tab's length-method panel sees floor height, scale and floor labels.
        const aiExt = svc?.ai_extraction as (ElectricalProcedureResult & { raw_electrical_procedure?: ElectricalProcedureResult }) | null;
        const elec = (aiExt?.raw_electrical_procedure ?? aiExt) || null;
        if (elec && Array.isArray(elec.cable_schedule) && elec.cable_schedule.length > 0) {
          setModel(buildPlanModel(elec, {
            floors: proj.floors,
            total_area_sqft: proj.total_area_sqft,
            building_name: proj.project_name || proj.client_name,
          }));
          setElecRaw(elec);
          // Load any saved cable rates so the panel reflects what the BOQ export
          // will use; fall back to defaults for un-set buckets. setRates directly
          // (not the autosave wrapper) so loading doesn't trigger a re-save.
          const saved = svc?.rate_overrides as Partial<RateMap> | null | undefined;
          setRates(saved ? { ...DEFAULT_RATES, ...saved } : DEFAULT_RATES);
        } else {
          setModel(DEMO_MODEL);
          setElecRaw(DEMO_ELEC_RAW);
          setNote('This project has no cable schedule yet — showing a sample building.');
          setRates(DEFAULT_RATES);
        }
      })
      .catch(() => { if (!cancelled) { setModel(DEMO_MODEL); setElecRaw(DEMO_ELEC_RAW); setNote('Could not load that project — showing a sample building.'); setRates(DEFAULT_RATES); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const onPick = useCallback((id: string) => {
    router.push(id ? `/plan?project=${id}` : '/plan');
  }, [router]);

  // User-initiated rate edits: update state immediately, then debounce-persist to
  // the project's electrical service row (skipped for the demo / no project) so
  // the BOQ export prices cables from these numbers.
  const onRateChange = useCallback((next: RateMap) => {
    setRates(next);
    if (!projectId || model.isDemo) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`/api/projects/${projectId}/rates`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      }).catch(() => {});
    }, 600);
  }, [projectId, model.isDemo]);

  // User-initiated electrical-data edits (Data tab): update state immediately for live
  // UI feedback, then debounce-persist the full edited object to the project's electrical
  // service row (skipped for the demo / no project) so the BOQ export uses the corrections.
  const onElecChange = useCallback((next: ElectricalProcedureResult) => {
    setElecRaw(next);
    if (!projectId || model.isDemo) return;
    if (elecSaveTimer.current) clearTimeout(elecSaveTimer.current);
    elecSaveTimer.current = setTimeout(() => {
      fetch(`/api/projects/${projectId}/electrical`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ electrical: next }),
      }).catch(() => {});
    }, 700);
  }, [projectId, model.isDemo]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (elecSaveTimer.current) clearTimeout(elecSaveTimer.current);
  }, []);

  const set = (k: keyof ViewToggles) => () => setToggles((t) => ({ ...t, [k]: !t[k] }));

  return (
    <div className="flex flex-col min-h-full bg-gray-50">
      {/* Header / controls */}
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 px-5 py-3 bg-white border-b border-gray-200">
        <Link href="/bids" className="text-gray-400 hover:text-gray-600"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sabi-500 to-sabi-600 flex items-center justify-center">
            <Box className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-gray-900 leading-tight">Plan &amp; Wiring Diagram</h1>
            <p className="text-[11px] text-gray-500 leading-tight">{model.summary.buildingName}{loading ? ' · loading…' : ''}</p>
          </div>
        </div>

        <div className="h-6 w-px bg-gray-200 mx-1" />

        {/* Diagram | Data tab switch */}
        <div className="flex items-center rounded-lg bg-gray-100 p-0.5">
          {(['diagram', 'data'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 rounded-md text-xs font-semibold capitalize transition-colors ${view === v ? 'bg-white text-sabi-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {v}
            </button>
          ))}
        </div>

        <div className={`flex-wrap items-center gap-2 ${view === 'diagram' ? 'flex' : 'hidden'}`}>
          <ToggleBtn active={toggles.showFloors} onClick={set('showFloors')} label="Floors"
            on={<Layers3 className="h-3.5 w-3.5" />} off={<Layers3 className="h-3.5 w-3.5" />} />
          <ToggleBtn active={toggles.isolateWiring} onClick={set('isolateWiring')} label="Isolate Wiring"
            on={<Zap className="h-3.5 w-3.5" />} off={<Zap className="h-3.5 w-3.5" />} />
          <ToggleBtn active={toggles.showPanels} onClick={set('showPanels')} label="Panels"
            on={<Eye className="h-3.5 w-3.5" />} off={<EyeOff className="h-3.5 w-3.5" />} />
          <ToggleBtn active={toggles.showLabels} onClick={set('showLabels')} label="Labels"
            on={<TagIcon className="h-3.5 w-3.5" />} off={<TagIcon className="h-3.5 w-3.5" />} />
          <ToggleBtn active={toggles.showCableLabels} onClick={set('showCableLabels')} label="Cable specs"
            on={<Ruler className="h-3.5 w-3.5" />} off={<Ruler className="h-3.5 w-3.5" />} />
          {toggles.showCableLabels && (
            <CableLabelModeSwitch mode={toggles.cableLabelMode} onChange={(m) => setToggles((t) => ({ ...t, cableLabelMode: m }))} />
          )}
          <ToggleBtn active={toggles.showOutlets} onClick={set('showOutlets')} label="Outlets"
            on={<Plug className="h-3.5 w-3.5" />} off={<Plug className="h-3.5 w-3.5" />} />
          <ToggleBtn active={toggles.showLighting} onClick={set('showLighting')} label="Lighting"
            on={<Lightbulb className="h-3.5 w-3.5" />} off={<Lightbulb className="h-3.5 w-3.5" />} />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setFocusMode((f) => !f)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              focusMode ? 'bg-sabi-500 text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
            }`}
            title={focusMode ? 'Show side panels' : 'Focus mode — hide side panels'}
          >
            {focusMode ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            {focusMode ? 'Exit focus' : 'Focus'}
          </button>
          {projectId && !model.isDemo && (
            <a
              href={`/api/projects/${projectId}/boq/industry`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 transition-all"
              title="Download the Dubai industry-standard 13-Bill priced BOQ (George's format)"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> Export Excel (BOQ)
            </a>
          )}
          <select
            value={projectId || ''}
            onChange={(e) => onPick(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 focus:border-sabi-500 focus:outline-none"
          >
            <option value="">Demo building (sample)</option>
            {pickList.map((p) => (
              <option key={p.id} value={p.id}>{p.project_name || p.client_name || p.id.slice(0, 8)}</option>
            ))}
          </select>
        </div>
      </header>

      {note && (
        <div className="px-5 py-1.5 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-700">{note}</div>
      )}

      {/* Body: SVG diagram + right column */}
      <div className="flex flex-col lg:flex-row">
        <div className="flex-1 min-w-0 flex flex-col">
          {!focusMode && <PlanSummary model={model} />}
          <div className={`relative ${focusMode ? 'h-[82vh] min-h-[520px]' : 'h-[72vh] min-h-[460px]'}`}>
            {view === 'diagram' ? <PlanSvg model={model} toggles={toggles} onToggle={(k) => setToggles((t) => ({ ...t, [k]: !t[k] }))} onCableLabelMode={(m) => setToggles((t) => ({ ...t, cableLabelMode: m }))} /> : <PlanDataTables elec={elecRaw} onElecChange={onElecChange} />}
          </div>
        </div>
        {!focusMode && (
          <div className="w-full lg:w-[360px] flex-shrink-0 flex flex-col border-t lg:border-t-0 lg:border-l border-gray-200">
            <ExtractionDetails model={model} />
            <CostPanel model={model} rates={rates} onRateChange={onRateChange} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function PlanPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>}>
      <PlanInner />
    </Suspense>
  );
}
