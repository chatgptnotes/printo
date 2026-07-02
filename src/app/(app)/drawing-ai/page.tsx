'use client';

import { useState, useEffect } from 'react';
import { ScanLine, Layers, ArrowRight, Loader2, AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Zap, Database, Cable } from 'lucide-react';
import Link from 'next/link';

interface FloorSummary {
  floor_label: string;
  floor_code: string;
  supply_m: number;
  return_m: number;
  exhaust_m: number;
  fresh_air_m: number;
  fittings: number;
  terminals: number;
  accessories: number;
}

interface LineItem {
  key: string;
  description: string;
  quantity: number;
  unit: string;
  unit_rate_aed: number;
  total_aed: number;
  category: string;
}

interface Project {
  id: string;
  project_name: string | null;
  email_subject: string | null;
  client_name: string | null;
  total_area_sqft: number | null;
  floors: number | null;
  building_type: string | null;
}

interface AnalysisResult {
  project_id: string;
  project_name: string;
  drawings_analyzed: number;
  floor_summary: FloorSummary[];
  line_items: LineItem[];
  total_boq_aed: number;
  confidence: number;
  reasoning: string;
}

// ── Electrical types ──────────────────────────────────────────────────────────

interface OutletCounts {
  single_13a: number; single_13a_wp: number; twin_13a: number; outlet_15a: number;
  fcu_fused_spur: number; water_heater_20a: number; washing_machine_20a: number;
  gas_ignition_13a: number; gas_detector: number; hand_dryer: number;
  floor_box_f1: number; usb_outlet: number; industrial_16a: number;
  dp_switch_20a: number; control_panel: number;
}
interface ElecFloorSummary {
  floor_label: string; floor_code: string; total_outlets: number;
  db_tags: string[]; outlets: OutletCounts;
}
interface ElecLineItem {
  key: string; description: string; quantity: number; unit: string;
  unit_rate_aed: number; total_aed: number; category: string;
  confidence: 'high' | 'medium' | 'low';
}
interface ElecDB { tag: string; type: string; rating_a: number | null; tcl_kw: number | null; floor: string | null; is_emergency: boolean; circuit_count: number | null; }
interface ElecCable { size_mm2: number; core_count: number; type: string; length_m: number | null; circuit: string | null; is_fire_rated: boolean; }
interface ElectricalData {
  transformer: { kva: number | null; voltage_ratio: string | null; count: number } | null;
  generator: { kva: number | null; type: string | null; count: number } | null;
  ats: { rating_a: number | null; count: number } | null;
  main_acb: { rating_a: number | null; breaking_ka: number | null; count: number } | null;
  capacitor_bank: { kvar: number | null; type: string | null } | null;
  total_connected_load_kw: number | null;
  power_factor: number | null;
  fire_pump_kw: number | null;
  distribution_boards: ElecDB[];
  cables: ElecCable[];
  sld_found: boolean;
}
interface ElecAnalysisResult {
  project_id: string; project_name: string; drawings_analyzed: number;
  electrical_data: ElectricalData;
  floor_summary: ElecFloorSummary[];
  line_items: ElecLineItem[];
  total_boq_aed: number; confidence: number; reasoning: string;
}

export default function DrawingAIPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'duct-routes' | 'electrical'>('duct-routes');
  const [elecLoading, setElecLoading] = useState(false);
  const [elecResult, setElecResult] = useState<ElecAnalysisResult | null>(null);
  const [elecError, setElecError] = useState<string | null>(null);
  const [elecExpandedCats, setElecExpandedCats] = useState<Set<string>>(new Set());
  const [elecExpandedFloors, setElecExpandedFloors] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/projects', { headers: { Authorization: `Bearer ${document.cookie.replace(/(?:(?:^|.*;\s*)token\s*=\s*([^;]*).*$)|^.*$/, '$1')}` } })
      .then(r => r.json())
      .then(data => {
        setProjects(data.projects || []);
        setLoadingProjects(false);
      })
      .catch(() => setLoadingProjects(false));
  }, []);

  const runAnalysis = async () => {
    if (!selectedProject) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/drawing-ai/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${document.cookie.replace(/(?:(?:^|.*;\s*)token\s*=\s*([^;]*).*$)|^.*$/, '$1')}`,
        },
        body: JSON.stringify({ project_id: selectedProject }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.details || 'Analysis failed');
      setResult(data);
      // Expand all categories by default
      const cats = new Set<string>(data.line_items.map((i: LineItem) => i.category));
      setExpandedCategories(cats);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const runElectricalAnalysis = async () => {
    if (!selectedProject) return;
    setElecLoading(true);
    setElecError(null);
    setElecResult(null);
    try {
      const res = await fetch('/api/drawing-ai/electrical', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${document.cookie.replace(/(?:(?:^|.*;\s*)token\s*=\s*([^;]*).*$)|^.*$/, '$1')}`,
        },
        body: JSON.stringify({ project_id: selectedProject }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.details || 'Analysis failed');
      setElecResult(data);
      const cats = new Set<string>(data.line_items.map((i: ElecLineItem) => i.category));
      setElecExpandedCats(cats);
    } catch (err: any) {
      setElecError(err.message);
    } finally {
      setElecLoading(false);
    }
  };

  const toggleElecCat = (cat: string) => setElecExpandedCats(prev => { const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });
  const toggleElecFloor = (f: string) => setElecExpandedFloors(prev => { const n = new Set(prev); n.has(f) ? n.delete(f) : n.add(f); return n; });

  const elecGroupedItems = elecResult?.line_items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, ElecLineItem[]>) || {};

  // Group line items by category
  const groupedItems = result?.line_items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, LineItem[]>) || {};

  const selectedProjectData = projects.find(p => p.id === selectedProject);

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Drawing AI Analysis</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload MEP drawings and let AI extract quantities, identify systems, and generate BOQ items automatically.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('duct-routes')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'duct-routes'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <span className="flex items-center gap-1.5"><ScanLine className="h-3.5 w-3.5" /> Duct Routes</span>
        </button>
        <button
          onClick={() => setActiveTab('electrical')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'electrical'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <span className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> Electrical Power</span>
        </button>
      </div>

      {activeTab === 'duct-routes' && (<>
      {/* Project Selector + Run */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4">
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Select Project</label>
            {loadingProjects ? (
              <div className="h-10 bg-gray-50 rounded-lg animate-pulse" />
            ) : (
              <select
                value={selectedProject}
                onChange={e => { setSelectedProject(e.target.value); setResult(null); setError(null); }}
                className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Choose a project...</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.project_name || p.email_subject || p.id.substring(0, 8)} — {p.client_name || 'Unknown client'}
                  </option>
                ))}
              </select>
            )}
          </div>
          <button
            onClick={runAnalysis}
            disabled={!selectedProject || loading}
            className="h-10 px-5 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap w-full sm:w-auto"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
            {loading ? 'Analyzing...' : 'Analyze Duct Routes'}
          </button>
        </div>

        {selectedProjectData && (
          <div className="mt-3 flex gap-4 text-xs text-gray-500">
            <span>{selectedProjectData.building_type || 'Unknown type'}</span>
            <span>{selectedProjectData.total_area_sqft?.toLocaleString() || '?'} sqft</span>
            <span>{selectedProjectData.floors || '?'} floors</span>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">Analysis Failed</p>
            <p className="text-xs text-red-600 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-8 text-center">
          <Loader2 className="h-8 w-8 text-violet-500 animate-spin mx-auto mb-3" />
          <p className="text-sm font-medium text-violet-800">Analyzing floor plans with Claude AI...</p>
          <p className="text-xs text-violet-600 mt-1">Tracing duct runs, counting terminals, measuring lengths. This may take 30-60 seconds.</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Summary Bar */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <h2 className="text-sm font-semibold text-gray-900">Duct Route Analysis Complete</h2>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span>{result.drawings_analyzed} drawing(s)</span>
                <span>{result.floor_summary.length} floor(s)</span>
              </div>
            </div>
            {result.reasoning && (
              <p className="text-xs text-gray-500 italic">{result.reasoning}</p>
            )}
          </div>

          {/* Floor-by-Floor Duct Routes */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
              <Layers className="h-4 w-4 text-blue-500" />
              <h3 className="text-sm font-semibold text-gray-900">Duct Routes by Floor</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-2.5 text-left font-medium">Floor</th>
                    <th className="px-4 py-2.5 text-right font-medium">Supply (m)</th>
                    <th className="px-4 py-2.5 text-right font-medium">Return (m)</th>
                    <th className="px-4 py-2.5 text-right font-medium">Exhaust (m)</th>
                    <th className="px-4 py-2.5 text-right font-medium">Fresh Air (m)</th>
                    <th className="px-4 py-2.5 text-right font-medium">Fittings</th>
                    <th className="px-4 py-2.5 text-right font-medium">Terminals</th>
                    <th className="px-4 py-2.5 text-right font-medium">Accessories</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.floor_summary.map((f, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium text-gray-900">{f.floor_label}</td>
                      <td className="px-4 py-2.5 text-right text-blue-600 font-mono">{f.supply_m}</td>
                      <td className="px-4 py-2.5 text-right text-cyan-600 font-mono">{f.return_m}</td>
                      <td className="px-4 py-2.5 text-right text-amber-600 font-mono">{f.exhaust_m}</td>
                      <td className="px-4 py-2.5 text-right text-green-600 font-mono">{f.fresh_air_m}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600 font-mono">{f.fittings}</td>
                      <td className="px-4 py-2.5 text-right text-purple-600 font-mono">{f.terminals}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600 font-mono">{f.accessories}</td>
                    </tr>
                  ))}
                  {/* Totals row */}
                  <tr className="bg-gray-50 font-semibold">
                    <td className="px-4 py-2.5 text-gray-900">Total</td>
                    <td className="px-4 py-2.5 text-right text-blue-700 font-mono">{result.floor_summary.reduce((s, f) => s + f.supply_m, 0)}</td>
                    <td className="px-4 py-2.5 text-right text-cyan-700 font-mono">{result.floor_summary.reduce((s, f) => s + f.return_m, 0)}</td>
                    <td className="px-4 py-2.5 text-right text-amber-700 font-mono">{result.floor_summary.reduce((s, f) => s + f.exhaust_m, 0)}</td>
                    <td className="px-4 py-2.5 text-right text-green-700 font-mono">{result.floor_summary.reduce((s, f) => s + f.fresh_air_m, 0)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-700 font-mono">{result.floor_summary.reduce((s, f) => s + f.fittings, 0)}</td>
                    <td className="px-4 py-2.5 text-right text-purple-700 font-mono">{result.floor_summary.reduce((s, f) => s + f.terminals, 0)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-700 font-mono">{result.floor_summary.reduce((s, f) => s + f.accessories, 0)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* BOQ Line Items */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ScanLine className="h-4 w-4 text-violet-500" />
                <h3 className="text-sm font-semibold text-gray-900">Generated BOQ Items</h3>
              </div>
              <span className="text-sm font-bold text-gray-900">
                AED {result.total_boq_aed.toLocaleString()}
              </span>
            </div>
            <div className="divide-y divide-gray-100">
              {Object.entries(groupedItems).map(([category, items]) => (
                <div key={category}>
                  <button
                    onClick={() => toggleCategory(category)}
                    className="w-full px-5 py-2.5 flex items-center justify-between hover:bg-gray-50 text-left"
                  >
                    <div className="flex items-center gap-2">
                      {expandedCategories.has(category) ? (
                        <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                      )}
                      <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{category}</span>
                      <span className="text-xs text-gray-400">{items.length} items</span>
                    </div>
                    <span className="text-xs font-semibold text-gray-600">
                      AED {items.reduce((s, i) => s + i.total_aed, 0).toLocaleString()}
                    </span>
                  </button>
                  {expandedCategories.has(category) && (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-400 border-b border-gray-50">
                          <th className="px-5 py-1.5 text-left font-medium">Description</th>
                          <th className="px-4 py-1.5 text-right font-medium">Qty</th>
                          <th className="px-4 py-1.5 text-right font-medium">Unit</th>
                          <th className="px-4 py-1.5 text-right font-medium">Rate (AED)</th>
                          <th className="px-4 py-1.5 text-right font-medium">Amount (AED)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, i) => (
                          <tr key={i} className="hover:bg-gray-50 border-b border-gray-50">
                            <td className="px-5 py-2 text-gray-700">{item.description}</td>
                            <td className="px-4 py-2 text-right font-mono text-gray-600">{item.quantity.toLocaleString()}</td>
                            <td className="px-4 py-2 text-right text-gray-500">{item.unit}</td>
                            <td className="px-4 py-2 text-right font-mono text-gray-600">{item.unit_rate_aed.toLocaleString()}</td>
                            <td className="px-4 py-2 text-right font-mono font-medium text-gray-900">{item.total_aed.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
            {/* Grand Total */}
            <div className="px-5 py-3 bg-gradient-to-r from-violet-50 to-blue-50 border-t border-gray-200 flex items-center justify-between">
              <span className="text-sm font-bold text-gray-900">Grand Total (Ductwork + Terminals + Accessories)</span>
              <span className="text-lg font-bold text-violet-700">AED {result.total_boq_aed.toLocaleString()}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Link
              href={`/bids/${result.project_id}`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700"
            >
              View Project <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <p className="text-xs text-gray-400">
              These quantities are automatically used when running Detailed estimation for this project.
            </p>
          </div>
        </>
      )}

      {/* Empty state when no result */}
      {!result && !loading && !error && (
        <div className="bg-gray-50 border border-gray-200 border-dashed rounded-xl p-12 text-center">
          <ScanLine className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Select a project and click "Analyze Duct Routes" to extract ductwork quantities from floor plan drawings.</p>
          <p className="text-xs text-gray-400 mt-2">AI will trace supply, return, exhaust, and fresh air duct runs per floor, count terminals and fittings, and generate priced BOQ items.</p>
        </div>
      )}
      </>)}

      {/* Electrical Power Tab */}
      {activeTab === 'electrical' && (<>
        {/* Project Selector + Run */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4">
            <div className="flex-1 min-w-0">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Select Project</label>
              {loadingProjects ? (
                <div className="h-10 bg-gray-50 rounded-lg animate-pulse" />
              ) : (
                <select
                  value={selectedProject}
                  onChange={e => { setSelectedProject(e.target.value); setElecResult(null); setElecError(null); }}
                  className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                >
                  <option value="">Choose a project...</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.project_name || p.email_subject || p.id.substring(0, 8)} — {p.client_name || 'Unknown client'}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <button
              onClick={runElectricalAnalysis}
              disabled={!selectedProject || elecLoading}
              className="h-10 px-5 bg-yellow-500 text-white text-sm font-medium rounded-lg hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap w-full sm:w-auto"
            >
              {elecLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {elecLoading ? 'Analyzing...' : 'Analyze Electrical Drawings'}
            </button>
          </div>
          {selectedProjectData && (
            <div className="mt-3 flex gap-4 text-xs text-gray-500">
              <span>{selectedProjectData.building_type || 'Unknown type'}</span>
              <span>{selectedProjectData.total_area_sqft?.toLocaleString() || '?'} sqft</span>
              <span>{selectedProjectData.floors || '?'} floors</span>
            </div>
          )}
        </div>

        {elecError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-800">Analysis Failed</p>
              <p className="text-xs text-red-600 mt-1">{elecError}</p>
            </div>
          </div>
        )}

        {elecLoading && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-8 text-center">
            <Loader2 className="h-8 w-8 text-yellow-500 animate-spin mx-auto mb-3" />
            <p className="text-sm font-medium text-yellow-800">Analyzing electrical drawings with Claude AI...</p>
            <p className="text-xs text-yellow-600 mt-1">Reading single-line diagram, counting outlets per floor, extracting panel hierarchy. 30–60 seconds.</p>
          </div>
        )}

        {elecResult && (<>
          {/* Summary Bar */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <h2 className="text-sm font-semibold text-gray-900">Electrical Analysis Complete</h2>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span>{elecResult.drawings_analyzed} drawing(s)</span>
                {elecResult.electrical_data.sld_found && (
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">SLD Found</span>
                )}
              </div>
            </div>
            {elecResult.reasoning && <p className="text-xs text-gray-500 italic">{elecResult.reasoning}</p>}
          </div>

          {/* Single-Line Diagram Summary */}
          {elecResult.electrical_data.sld_found && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-500" />
                <h3 className="text-sm font-semibold text-gray-900">Single-Line Diagram — Key Data</h3>
              </div>
              <div className="p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {elecResult.electrical_data.transformer && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Transformer</p>
                    <p className="text-sm font-semibold text-gray-900">{elecResult.electrical_data.transformer.kva ?? '—'} kVA</p>
                    {elecResult.electrical_data.transformer.voltage_ratio && (
                      <p className="text-xs text-gray-400">{elecResult.electrical_data.transformer.voltage_ratio}</p>
                    )}
                  </div>
                )}
                {elecResult.electrical_data.generator && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Generator</p>
                    <p className="text-sm font-semibold text-gray-900">{elecResult.electrical_data.generator.kva ?? '—'} kVA</p>
                    <p className="text-xs text-gray-400">{elecResult.electrical_data.generator.type || 'Diesel'}</p>
                  </div>
                )}
                {elecResult.electrical_data.ats && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">ATS</p>
                    <p className="text-sm font-semibold text-gray-900">{elecResult.electrical_data.ats.rating_a ?? '—'} A</p>
                    <p className="text-xs text-gray-400">{elecResult.electrical_data.ats.count} unit(s)</p>
                  </div>
                )}
                {elecResult.electrical_data.main_acb && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Main ACB</p>
                    <p className="text-sm font-semibold text-gray-900">{elecResult.electrical_data.main_acb.rating_a ?? '—'} A</p>
                    <p className="text-xs text-gray-400">{elecResult.electrical_data.main_acb.breaking_ka ?? '—'} kA</p>
                  </div>
                )}
                {elecResult.electrical_data.total_connected_load_kw && (
                  <div className="bg-yellow-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Total Connected Load</p>
                    <p className="text-sm font-semibold text-gray-900">{elecResult.electrical_data.total_connected_load_kw.toLocaleString()} kW</p>
                    {elecResult.electrical_data.power_factor && (
                      <p className="text-xs text-gray-400">pf {elecResult.electrical_data.power_factor}</p>
                    )}
                  </div>
                )}
                {elecResult.electrical_data.fire_pump_kw && (
                  <div className="bg-red-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Fire Pump</p>
                    <p className="text-sm font-semibold text-gray-900">{elecResult.electrical_data.fire_pump_kw} kW</p>
                  </div>
                )}
                {elecResult.electrical_data.capacitor_bank && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Capacitor Bank</p>
                    <p className="text-sm font-semibold text-gray-900">{elecResult.electrical_data.capacitor_bank.kvar ?? '—'} kVAR</p>
                    <p className="text-xs text-gray-400">{elecResult.electrical_data.capacitor_bank.type || 'Automatic'}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Distribution Board Hierarchy */}
          {elecResult.electrical_data.distribution_boards.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                <Database className="h-4 w-4 text-blue-500" />
                <h3 className="text-sm font-semibold text-gray-900">Distribution Board Hierarchy</h3>
                <span className="text-xs text-gray-400">{elecResult.electrical_data.distribution_boards.length} boards</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="px-4 py-2.5 text-left font-medium">Tag</th>
                      <th className="px-4 py-2.5 text-left font-medium">Type</th>
                      <th className="px-4 py-2.5 text-right font-medium">Rating (A)</th>
                      <th className="px-4 py-2.5 text-right font-medium">TCL (kW)</th>
                      <th className="px-4 py-2.5 text-left font-medium">Floor</th>
                      <th className="px-4 py-2.5 text-left font-medium">Emergency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {elecResult.electrical_data.distribution_boards.map((db, i) => (
                      <tr key={i} className={`hover:bg-gray-50 ${db.is_emergency ? 'bg-red-50/30' : ''}`}>
                        <td className="px-4 py-2.5 font-mono text-sm font-medium text-gray-900">{db.tag}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-500 uppercase">{db.type.replace('_', ' ')}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-gray-700">{db.rating_a ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-gray-700">{db.tcl_kw ?? '—'}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-500">{db.floor || '—'}</td>
                        <td className="px-4 py-2.5">{db.is_emergency ? <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">Yes</span> : <span className="text-xs text-gray-400">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Cable Schedule */}
          {elecResult.electrical_data.cables.filter(c => c.length_m).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                <Cable className="h-4 w-4 text-orange-500" />
                <h3 className="text-sm font-semibold text-gray-900">Cable Schedule</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                      <th className="px-4 py-2.5 text-left font-medium">Size</th>
                      <th className="px-4 py-2.5 text-left font-medium">Type</th>
                      <th className="px-4 py-2.5 text-right font-medium">Length (m)</th>
                      <th className="px-4 py-2.5 text-left font-medium">Circuit</th>
                      <th className="px-4 py-2.5 text-left font-medium">Fire Rated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {elecResult.electrical_data.cables.filter(c => c.length_m).map((c, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-mono text-sm font-medium text-gray-900">{c.core_count}C × {c.size_mm2}mm²</td>
                        <td className="px-4 py-2.5 text-xs text-gray-500 uppercase">{c.type.replace('_', ' ')}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-gray-700">{c.length_m}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-500">{c.circuit || '—'}</td>
                        <td className="px-4 py-2.5">{c.is_fire_rated ? <span className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">FR</span> : <span className="text-xs text-gray-400">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Floor Outlet Inventory */}
          {elecResult.floor_summary.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                <Layers className="h-4 w-4 text-purple-500" />
                <h3 className="text-sm font-semibold text-gray-900">Outlet Inventory by Floor</h3>
              </div>
              <div className="divide-y divide-gray-100">
                {elecResult.floor_summary.map((f) => (
                  <div key={f.floor_code}>
                    <button
                      onClick={() => toggleElecFloor(f.floor_code)}
                      className="w-full px-5 py-2.5 flex items-center justify-between hover:bg-gray-50 text-left"
                    >
                      <div className="flex items-center gap-2">
                        {elecExpandedFloors.has(f.floor_code) ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                        <span className="text-sm font-medium text-gray-900">{f.floor_label}</span>
                        {f.db_tags.length > 0 && <span className="text-xs text-gray-400 font-mono">{f.db_tags.join(', ')}</span>}
                      </div>
                      <span className="text-xs text-gray-500">{f.total_outlets} outlets total</span>
                    </button>
                    {elecExpandedFloors.has(f.floor_code) && (
                      <div className="px-5 pb-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                        {[
                          ['13A Single', f.outlets.single_13a],
                          ['13A Single WP', f.outlets.single_13a_wp],
                          ['13A Twin', f.outlets.twin_13a],
                          ['15A', f.outlets.outlet_15a],
                          ['FCU Spur', f.outlets.fcu_fused_spur],
                          ['Water Heater', f.outlets.water_heater_20a],
                          ['Washing M/C', f.outlets.washing_machine_20a],
                          ['Gas Ignition', f.outlets.gas_ignition_13a],
                          ['Gas Detector', f.outlets.gas_detector],
                          ['Hand Dryer', f.outlets.hand_dryer],
                          ['Floor Box F1', f.outlets.floor_box_f1],
                          ['USB Outlet', f.outlets.usb_outlet],
                          ['16A Industrial', f.outlets.industrial_16a],
                          ['20A DP Switch', f.outlets.dp_switch_20a],
                          ['Control Panel', f.outlets.control_panel],
                        ].filter(([, v]) => (v as number) > 0).map(([label, val]) => (
                          <div key={label as string} className="bg-gray-50 rounded p-2 text-center">
                            <p className="text-xs text-gray-500">{label}</p>
                            <p className="text-sm font-bold text-gray-900">{val}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* BOQ Line Items */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-500" />
                <h3 className="text-sm font-semibold text-gray-900">Generated Electrical BOQ</h3>
              </div>
              <span className="text-sm font-bold text-gray-900">AED {elecResult.total_boq_aed.toLocaleString()}</span>
            </div>
            <div className="divide-y divide-gray-100">
              {Object.entries(elecGroupedItems).map(([category, items]) => (
                <div key={category}>
                  <button
                    onClick={() => toggleElecCat(category)}
                    className="w-full px-5 py-2.5 flex items-center justify-between hover:bg-gray-50 text-left"
                  >
                    <div className="flex items-center gap-2">
                      {elecExpandedCats.has(category) ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                      <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{category}</span>
                      <span className="text-xs text-gray-400">{items.length} items</span>
                    </div>
                    <span className="text-xs font-semibold text-gray-600">AED {items.reduce((s, i) => s + i.total_aed, 0).toLocaleString()}</span>
                  </button>
                  {elecExpandedCats.has(category) && (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-400 border-b border-gray-50">
                          <th className="px-5 py-1.5 text-left font-medium">Description</th>
                          <th className="px-4 py-1.5 text-right font-medium">Qty</th>
                          <th className="px-4 py-1.5 text-right font-medium">Unit</th>
                          <th className="px-4 py-1.5 text-right font-medium">Rate (AED)</th>
                          <th className="px-4 py-1.5 text-right font-medium">Amount (AED)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, i) => (
                          <tr key={i} className="hover:bg-gray-50 border-b border-gray-50">
                            <td className="px-5 py-2 text-gray-700">{item.description}</td>
                            <td className="px-4 py-2 text-right font-mono text-gray-600">{item.quantity.toLocaleString()}</td>
                            <td className="px-4 py-2 text-right text-gray-500">{item.unit}</td>
                            <td className="px-4 py-2 text-right font-mono text-gray-600">{item.unit_rate_aed.toLocaleString()}</td>
                            <td className="px-4 py-2 text-right font-mono font-medium text-gray-900">{item.total_aed.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
            <div className="px-5 py-3 bg-gradient-to-r from-yellow-50 to-amber-50 border-t border-gray-200 flex items-center justify-between">
              <span className="text-sm font-bold text-gray-900">Grand Total (Electrical Power)</span>
              <span className="text-lg font-bold text-yellow-700">AED {elecResult.total_boq_aed.toLocaleString()}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link href={`/bids/${elecResult.project_id}`} className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700">
              View Project <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </>)}

        {!elecResult && !elecLoading && !elecError && (
          <div className="bg-gray-50 border border-gray-200 border-dashed rounded-xl p-12 text-center">
            <Zap className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">Select a project and click "Analyze Electrical Drawings" to extract power outlet counts, distribution board hierarchy, and SLD data.</p>
            <p className="text-xs text-gray-400 mt-2">AI reads single-line diagrams (transformer, generator, ATS, ACB, TCL), counts outlet symbols per floor, and generates a priced electrical BOQ.</p>
          </div>
        )}
      </>)}
    </div>
  );
}
