'use client';

// Pure 2D SVG building-elevation renderer. Receives an SvgPlanModel + toggles.
// No 3D / WebGL — renders instantly and can be exported as a .svg image.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Minimize2, Download, FileText } from 'lucide-react';
import type { SvgPanel, SvgPlanModel } from '@/lib/plan/types';
import { BUCKET_META, BUCKETS } from '@/lib/plan/cost';
import { printHtmlDocument } from '@/lib/plan/print-pdf';

export type CableLabelMode = 'merged' | 'box' | 'wire';

export interface ViewToggles {
  showFloors: boolean;
  isolateWiring: boolean;
  showPanels: boolean;
  showLabels: boolean;
  showCableLabels: boolean;
  cableLabelMode: CableLabelMode;
  showOutlets: boolean;
  showLighting: boolean;
}

const PANEL_FILL: Record<SvgPanel['kind'], string> = { mdb: '#dbeafe', smdb: '#ede9fe', db: '#e0f2fe' };
export const PANEL_STROKE: Record<SvgPanel['kind'], string> = { mdb: '#1e40af', smdb: '#7c3aed', db: '#0284c7' };

// Toggle chips shown inside fullscreen (the parent toolbars aren't visible there).
const FS_TOGGLES: Array<{ key: keyof ViewToggles; label: string }> = [
  { key: 'showFloors', label: 'Floors' },
  { key: 'isolateWiring', label: 'Isolate' },
  { key: 'showPanels', label: 'Panels' },
  { key: 'showLabels', label: 'Labels' },
  { key: 'showCableLabels', label: 'Cable specs' },
  { key: 'showOutlets', label: 'Outlets' },
  { key: 'showLighting', label: 'Lighting' },
];

// 3-way placement switch for the cable-spec chips. Shared by the embedded toolbar
// (PlanDiagram) and the fullscreen overlay so the labels read the same everywhere.
export const CABLE_LABEL_MODES: Array<{ key: CableLabelMode; label: string; hint: string }> = [
  { key: 'merged', label: 'Merged', hint: 'Identical feeders on a floor collapse to one chip (×count)' },
  { key: 'box', label: 'Per box', hint: 'A chip above every board' },
  { key: 'wire', label: 'On wire', hint: 'A chip on every wire run' },
];

export function CableLabelModeSwitch({ mode, onChange }: { mode: CableLabelMode; onChange: (m: CableLabelMode) => void }) {
  return (
    <div className="flex items-center rounded-lg bg-gray-100 p-0.5">
      {CABLE_LABEL_MODES.map((m) => (
        <button
          key={m.key}
          title={m.hint}
          onClick={() => onChange(m.key)}
          className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${mode === m.key ? 'bg-white text-sabi-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

export default function PlanSvg({ model, toggles, onToggle, onCableLabelMode }: { model: SvgPlanModel; toggles: ViewToggles; onToggle?: (k: keyof ViewToggles) => void; onCableLabelMode?: (m: CableLabelMode) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const { width, height, floors, panels, cables } = model;
  const floorHeightM = model.summary.typicalFloorHeightM;

  const MIN_SCALE = 0.1;
  const MAX_SCALE = 6;
  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

  // Camera model: a fixed-size SVG (width=cw, height=ch) whose viewBox is moved and
  // zoomed. `scale` = css px per model unit; (tx,ty) = the model coordinate shown at
  // the viewport's top-left corner. Zooming adjusts (tx,ty) so the point under the
  // cursor stays put — instead of the old width/height scaling that always anchored
  // at the top-left corner and made the content jump.
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [cw, setCw] = useState(0);
  const [ch, setCh] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Mirror live state into refs so the once-attached wheel/pointer listeners read
  // current values without re-binding on every render.
  const scaleRef = useRef(scale); useEffect(() => { scaleRef.current = scale; }, [scale]);
  const txRef = useRef(tx); useEffect(() => { txRef.current = tx; }, [tx]);
  const tyRef = useRef(ty); useEffect(() => { tyRef.current = ty; }, [ty]);
  const isFsRef = useRef(isFullscreen); useEffect(() => { isFsRef.current = isFullscreen; }, [isFullscreen]);

  // Zoom by `factor` about a viewport point (px,py), keeping the model point under
  // that screen point fixed.
  const zoomAt = (px: number, py: number, factor: number) => {
    const s0 = scaleRef.current;
    const s1 = clampScale(s0 * factor);
    if (s1 === s0) return;
    const mX = txRef.current + px / s0;
    const mY = tyRef.current + py / s0;
    setScale(s1);
    setTx(mX - px / s1);
    setTy(mY - py / s1);
  };

  // Fit the whole diagram into a viewport of explicit size (vw,vh), centered.
  // Takes explicit dimensions so the auto-fit can run synchronously off the freshly
  // measured rect instead of waiting for cw/ch state to propagate (which races).
  const fitInto = (vw: number, vh: number, pad = 32, maxScale = MAX_SCALE) => {
    if (!vw || !vh) return;
    const s = clampScale(Math.min(maxScale, (vw - pad) / width, (vh - pad) / height));
    setScale(s);
    setTx(width / 2 - vw / (2 * s));
    setTy(height / 2 - vh / (2 * s));
  };
  const fitAll = (pad = 32, maxScale = MAX_SCALE) => fitInto(cw, ch, pad, maxScale);

  // True 1:1, centered.
  const reset = () => {
    setScale(1);
    setTx(width / 2 - cw / 2);
    setTy(height / 2 - ch / 2);
  };

  // Auto-fit ALL floors into the embedded viewport ONCE, the moment the container has
  // a real size — never enlarges past 1:1 (maxScale=1). Reset per building so a new
  // model re-fits. Tracked as a ref so manual zoom afterwards is never overridden.
  const hasAutoFit = useRef(false);
  useEffect(() => { hasAutoFit.current = false; }, [model.height]);

  // Measure the gesture viewport and drive the one-time auto-fit from the SAME rect
  // read (no state-propagation race). The derived viewBox tracks cw/ch, so later
  // resizes just reveal more/less model area at the current scale.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setCw(r.width); setCh(r.height);
      if (!hasAutoFit.current && !document.fullscreenElement && r.width >= 1 && r.height >= 60) {
        fitInto(r.width, r.height, 16, 1);
        hasAutoFit.current = true;
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  // Wheel = zoom-to-cursor. Embedded: only with Ctrl/Cmd (trackpad pinch sets
  // ctrlKey) so plain wheel still scrolls the surrounding page. Fullscreen: plain
  // wheel zooms. Attached non-passive so preventDefault works (React's onWheel is
  // passive and can't reliably preventDefault).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || isFsRef.current)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drag-to-pan via Pointer Events (mouse/touch/pen). Ignores clicks on the control
  // overlays (data-no-pan) so buttons never start a pan.
  const drag = useRef<null | { id: number; sx: number; sy: number; tx0: number; ty0: number }>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-no-pan]')) return;
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, tx0: txRef.current, ty0: tyRef.current };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setIsPanning(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const s = scaleRef.current;
    setTx(d.tx0 - (e.clientX - d.sx) / s);
    setTy(d.ty0 - (e.clientY - d.sy) / s);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current?.id === e.pointerId) { drag.current = null; setIsPanning(false); }
  };

  // Keep the button icon in sync with browser fullscreen (covers Esc / F11 exits),
  // and fit the whole riser on enter / reset on exit. rAF because the ResizeObserver
  // lags the fullscreen transition — seed cw/ch from the live rect.
  useEffect(() => {
    const onChange = () => {
      const fs = document.fullscreenElement === containerRef.current;
      setIsFullscreen(fs);
      requestAnimationFrame(() => {
        const el = viewportRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setCw(r.width); setCh(r.height);
        if (fs) {
          const s = Math.max(0.3, Math.min(4, Math.min((r.width - 48) / width, (r.height - 48) / height)));
          setScale(s);
          setTx(width / 2 - r.width / (2 * s));
          setTy(height / 2 - r.height / (2 * s));
        } else {
          setScale(1);
          setTx(width / 2 - r.width / 2);
          setTy(height / 2 - r.height / 2);
        }
      });
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [width, height]);


  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      el.requestFullscreen?.();
    }
  };

  const viewBox = `${tx} ${ty} ${cw / scale} ${ch / scale}`;

  const layout = useMemo(() => {
    const firstColX = panels.length ? Math.min(...panels.map((p) => p.x)) : 188;
    const laneX = firstColX - 40;
    const gutterMid = Math.max(20, (laneX - 12) / 2);
    const top = floors.length ? Math.min(...floors.map((f) => f.yTop)) : 0;
    const bottom = floors.length ? Math.max(...floors.map((f) => f.yTop + f.height)) : height;
    return { laneX, gutterMid, top, bottom };
  }, [panels, floors, height]);

  const downloadSvg = () => {
    if (!svgRef.current) return;
    // Export the WHOLE diagram, not the current cropped/zoomed view: clone and
    // override the viewBox/size so the file is always the full building.
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    const xml = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(model.summary.buildingName || 'plan').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-wiring.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export the WHOLE diagram to PDF — same full-building clone as the SVG download,
  // but scaled to the page and printed (the SVG carries its own inline styling/legend
  // so it needs no app CSS). Landscape when the diagram is wider than it is tall.
  const exportPdf = () => {
    if (!svgRef.current) return;
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
    clone.setAttribute('width', '100%');
    clone.removeAttribute('height');
    clone.style.maxWidth = '100%';
    clone.style.height = 'auto';
    const xml = new XMLSerializer().serializeToString(clone);
    const title = `${model.summary.buildingName || 'Plan'} — Wiring Diagram`;
    printHtmlDocument(
      `<h1 style="font:700 15px system-ui,sans-serif;margin:0 0 10px;color:#0f172a">${title}</h1>${xml}`,
      { title, landscape: width > height },
    );
  };

  const panelOpacity = toggles.isolateWiring ? 0.18 : 1;

  return (
    <div ref={containerRef} className="relative h-full w-full bg-slate-100">
      {/* Zoom / export controls */}
      <div data-no-pan className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-lg border border-gray-300 bg-white/95 px-1 py-1 shadow-sm">
        <button onClick={() => zoomAt(cw / 2, ch / 2, 1.2)} className="p-1.5 hover:bg-gray-100 rounded" title="Zoom in"><ZoomIn className="h-4 w-4 text-gray-600" /></button>
        <button onClick={() => zoomAt(cw / 2, ch / 2, 1 / 1.2)} className="p-1.5 hover:bg-gray-100 rounded" title="Zoom out"><ZoomOut className="h-4 w-4 text-gray-600" /></button>
        <button onClick={reset} className="p-1.5 hover:bg-gray-100 rounded" title="Reset zoom"><span className="text-[10px] font-bold text-gray-600 px-0.5">1:1</span></button>
        <button onClick={() => fitAll(32)} className="p-1.5 hover:bg-gray-100 rounded" title="Fit all floors"><span className="text-[10px] font-bold text-gray-600 px-0.5">FIT</span></button>
        <button onClick={toggleFullscreen} className="p-1.5 hover:bg-gray-100 rounded" title={isFullscreen ? 'Exit full screen' : 'Full screen'}>
          {isFullscreen ? <Minimize2 className="h-4 w-4 text-gray-600" /> : <Maximize2 className="h-4 w-4 text-gray-600" />}
        </button>
        <span className="mx-1 h-5 w-px bg-gray-200" />
        <button onClick={downloadSvg} className="p-1.5 hover:bg-gray-100 rounded" title="Download SVG"><Download className="h-4 w-4 text-gray-600" /></button>
        <button onClick={exportPdf} className="p-1.5 hover:bg-gray-100 rounded" title="Export PDF"><FileText className="h-4 w-4 text-gray-600" /></button>
      </div>

      {/* Fullscreen-only: layer toggles (the parent toolbar isn't visible in fullscreen) */}
      {isFullscreen && onToggle && (
        <div data-no-pan className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-1 rounded-lg border border-gray-300 bg-white/95 px-1.5 py-1 shadow-sm max-w-[60%]">
          {FS_TOGGLES.map((t) => (
            <button
              key={t.key}
              onClick={() => onToggle(t.key)}
              className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${toggles[t.key] ? 'bg-sabi-500 text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'}`}
            >
              {t.label}
            </button>
          ))}
          {toggles.showCableLabels && onCableLabelMode && (
            <CableLabelModeSwitch mode={toggles.cableLabelMode} onChange={onCableLabelMode} />
          )}
        </div>
      )}

      {/* Fullscreen-only: colour legend (box + cable meanings) */}
      {isFullscreen && (
        <div data-no-pan className="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-gray-300 bg-white/95 px-2.5 py-1.5 shadow-sm text-[11px] text-gray-600">
          <span className="font-semibold uppercase tracking-wide text-gray-400 text-[10px]">Boxes:</span>
          {([['mdb', 'Main (MDB)'], ['smdb', 'Sub (SMDB)'], ['db', 'DB']] as const).map(([k, label]) => (
            <span key={k} className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-sm border" style={{ borderColor: PANEL_STROKE[k], background: PANEL_STROKE[k] + '22' }} />{label}
            </span>
          ))}
          <span className="font-semibold uppercase tracking-wide text-gray-400 text-[10px] ml-1">Cables:</span>
          {BUCKETS.map((b) => (
            <span key={b.bucket} className="flex items-center gap-1" title={b.hint}>
              <span className="h-0.5 w-4 rounded-full" style={{ background: b.color }} />{b.label}
            </span>
          ))}
        </div>
      )}

      {/* p-4 wrapper restores the slate margin; the inner (measured) card carries the
          border + rounding so the diagram reads as a framed card again. Measuring the
          inner card keeps the zoom-to-cursor math exact (padding lives outside it). */}
      <div className="h-full w-full p-4">
        <div
          ref={viewportRef}
          className={`h-full w-full overflow-hidden rounded-lg border border-slate-200 bg-white ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <svg
            ref={svgRef}
            width={cw}
            height={ch}
            viewBox={viewBox}
            preserveAspectRatio="xMidYMid meet"
            xmlns="http://www.w3.org/2000/svg"
            style={{ display: 'block', background: '#ffffff' }}
          >
          {/* ── Floor bands + gutter labels ── */}
          {toggles.showFloors && floors.map((f, i) => (
            <g key={f.index}>
              <rect x={0} y={f.yTop} width={width} height={f.height} fill={i % 2 ? '#f8fafc' : '#ffffff'} />
              <line x1={0} y1={f.yTop} x2={width} y2={f.yTop} stroke="#e2e8f0" strokeWidth={1} />
              <text x={layout.gutterMid} y={f.yTop + f.height / 2 - 8} textAnchor="middle" dominantBaseline="middle" fontSize={13} fontWeight={700} fill="#334155">{f.label}</text>
              {(model.cableLengthByFloor[f.index] || 0) > 0 && (
                <text x={layout.gutterMid} y={f.yTop + f.height / 2 + 9} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight={600} fill="#64748b">≈ {Math.round(model.cableLengthByFloor[f.index]).toLocaleString()} m</text>
              )}
              {/* Floor-to-floor height dimension in the far-left margin: vertical
                  line spanning the band with end ticks + a rotated "3.4 m" label. */}
              {typeof floorHeightM === 'number' && floorHeightM > 0 && (
                <>
                  <line x1={10} y1={f.yTop + 8} x2={10} y2={f.yTop + f.height - 8} stroke="#cbd5e1" strokeWidth={1} />
                  <line x1={6} y1={f.yTop + 8} x2={14} y2={f.yTop + 8} stroke="#cbd5e1" strokeWidth={1} />
                  <line x1={6} y1={f.yTop + f.height - 8} x2={14} y2={f.yTop + f.height - 8} stroke="#cbd5e1" strokeWidth={1} />
                  <text x={24} y={f.yTop + f.height / 2} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight={600} fill="#94a3b8" transform={`rotate(-90 24 ${f.yTop + f.height / 2})`}>{floorHeightM} m</text>
                </>
              )}
            </g>
          ))}
          {toggles.showFloors && (
            <line x1={layout.laneX + 22} y1={layout.top} x2={layout.laneX + 22} y2={layout.bottom} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="2 3" />
          )}

          {/* ── Riser lane guide ── */}
          <rect x={layout.laneX - 4} y={layout.top} width={8} height={layout.bottom - layout.top} fill="#f1f5f9" stroke="#e2e8f0" strokeWidth={1} rx={3} />
          <text x={layout.laneX} y={layout.top + 10} textAnchor="middle" fontSize={8} fill="#94a3b8" transform={`rotate(90 ${layout.laneX} ${layout.top + 10})`}>RISER</text>

          {/* ── Cables ── */}
          {cables.filter((c) => c.resolved).map((c, i) => (
            <path key={`p${i}`} d={c.path} fill="none" stroke={BUCKET_META[c.bucket].color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.95} />
          ))}

          {/* ── Panels ── */}
          {toggles.showPanels && panels.map((p, i) => (
            <g key={`pan${i}`} opacity={panelOpacity}>
              <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={5} fill={PANEL_FILL[p.kind]} stroke={PANEL_STROKE[p.kind]} strokeWidth={1.5} />
              {toggles.showLabels && (
                <>
                  <text x={p.x + p.w / 2} y={p.y + p.h / 2 - 4} textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight={700} fill={PANEL_STROKE[p.kind]}>{p.tag}</text>
                  <text x={p.x + p.w / 2} y={p.y + p.h / 2 + 9} textAnchor="middle" dominantBaseline="middle" fontSize={8} fill="#64748b">{p.kind.toUpperCase()}{p.rating_a ? ` · ${p.rating_a}A` : ''}</text>
                </>
              )}
            </g>
          ))}

          {/* ── Cable labels (mm² · m) — drawn after panels so boxes never hide them.
                Greedy de-overlap: a dense take-off has 100+ feeders, so we place a
                label only when its box doesn't collide with one already placed —
                guarantees every visible label is readable (no piles). Hidden ones
                remain in the Data tab. ── */}
          {toggles.showCableLabels && (() => {
            const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
            const out: React.ReactNode[] = [];
            const collidesAt = (x: number, w: number, cy: number) =>
              placed.some((p) => Math.abs((p.x + p.w / 2) - (x + w / 2)) < (p.w + w) / 2 - 2 && Math.abs((p.y + p.h / 2) - cy) < 13);
            // Which floor band a label sits in (by its y).
            const floorOf = (y: number) => {
              for (const f of floors) if (y >= f.yTop && y <= f.yTop + f.height) return f.index;
              return -1;
            };
            // Build the chips to render. Spec-less connectors (tenant/internal
            // boards drawn "by tenant" with no size or length) get a wire but no
            // length chip in every mode.
            const hasSpec = (c: (typeof cables)[number]) =>
              c.resolved && !((!c.sizeMm2 || c.sizeMm2 <= 0) && (!c.lengthM || c.lengthM <= 0));
            type Chip = { c: (typeof cables)[number]; text: string; ax: number; ay: number };
            const chips: Chip[] = [];
            if (toggles.cableLabelMode === 'merged') {
              // Collapse IDENTICAL feeder specs on the same floor to ONE chip. A
              // typical floor repeats the same 16mm²·25m apartment feeder ~15×, which
              // otherwise rendered as a full second row of chips above the boxes and
              // read as a duplicated building. Keep a ×count so detail isn't lost.
              const groups = new Map<string, { c: (typeof cables)[number]; count: number }>();
              for (const c of cables) {
                if (!hasSpec(c)) continue;
                const spec = `${c.sizeMm2 || '—'}mm² · ${c.lengthM}m`;
                const key = floorOf(c.labelY) + '|' + spec;
                const g = groups.get(key);
                if (g) g.count += 1;
                else groups.set(key, { c, count: 1 });
              }
              for (const { c, count } of groups.values()) {
                chips.push({ c, text: `${c.sizeMm2 || '—'}mm² · ${c.lengthM}m${count > 1 ? ` ×${count}` : ''}`, ax: c.labelX, ay: c.labelY });
              }
            } else {
              // box / wire: one chip per wire, no merging. 'wire' anchors the chip
              // on the run (in the gap left of the box); 'box' sits above the box.
              const onWire = toggles.cableLabelMode === 'wire';
              for (const c of cables) {
                if (!hasSpec(c)) continue;
                chips.push({
                  c,
                  text: `${c.sizeMm2 || '—'}mm² · ${c.lengthM}m`,
                  ax: onWire ? c.segLabelX : c.labelX,
                  ay: onWire ? c.segLabelY : c.labelY,
                });
              }
            }
            let i = 0;
            for (const { c, text, ax, ay } of chips) {
              i += 1;
              const w = text.length * 5.4 + 8;
              const x = ax - w / 2;
              // Stack colliding chips upward (15px pitch) so each stays visible; cap
              // the stack so it can't climb into the floor above.
              let cy = ay - 1;
              let row = 0;
              while (row < 5 && collidesAt(x, w, cy)) { cy -= 15; row += 1; }
              if (row >= 5 && collidesAt(x, w, cy)) continue;
              placed.push({ x, y: cy - 7, w, h: 14 });
              out.push(
                <g key={`l${i}`}>
                  <rect x={x} y={cy - 8} width={w} height={14} rx={3} fill="#ffffff" stroke={BUCKET_META[c.bucket].color} strokeWidth={0.75} opacity={0.97} />
                  <text x={ax} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight={600} fill="#0f172a">{text}</text>
                </g>,
              );
            }
            return out;
          })()}

          {/* ── Outlet + lighting badges per floor (stacked, centred in the band) ── */}
          {floors.map((f) => {
            const nOut = toggles.showOutlets ? model.outletsByFloor[f.index] || 0 : 0;
            const nLight = toggles.showLighting ? model.lightingByFloor[f.index] || 0 : 0;
            const badges: Array<{ text: string; fill: string; stroke: string; color: string }> = [];
            if (nOut) badges.push({ text: `⊙ ${nOut} outlets`, fill: '#ecfdf5', stroke: '#10b981', color: '#047857' });
            if (nLight) badges.push({ text: `💡 ${nLight} lights`, fill: '#fefce8', stroke: '#f59e0b', color: '#b45309' });
            if (!badges.length) return null;
            const gap = 4;
            const stackH = badges.length * 18 + (badges.length - 1) * gap;
            const startY = f.yTop + f.height / 2 - stackH / 2;
            return (
              <g key={`b${f.index}`}>
                {badges.map((b, i) => {
                  const y = startY + i * (18 + gap);
                  return (
                    <g key={i}>
                      <rect x={width - 96} y={y} width={80} height={18} rx={9} fill={b.fill} stroke={b.stroke} strokeWidth={1} />
                      <text x={width - 56} y={y + 9} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight={600} fill={b.color}>{b.text}</text>
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* ── Gauge legend (bottom-left, travels with the exported SVG) ── */}
          <g transform={`translate(14 ${height - 12})`}>
            {BUCKETS.map((b, i) => (
              <g key={b.bucket} transform={`translate(${i * 150} 0)`}>
                <line x1={0} y1={-3} x2={18} y2={-3} stroke={b.color} strokeWidth={3} strokeLinecap="round" />
                <text x={23} y={0} fontSize={9} fill="#475569">{b.label}</text>
              </g>
            ))}
          </g>
          </svg>
        </div>
      </div>
    </div>
  );
}
