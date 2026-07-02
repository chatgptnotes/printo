'use client';

import { useEffect, useState, useRef } from 'react';
import { formatAED } from '@/lib/shared/utils';
import { Plus, Save, Search, Pencil, Trash2, X, Check, Upload, FileSpreadsheet, AlertCircle, RefreshCw, ExternalLink, History, ChevronRight } from 'lucide-react';
import ExcelJS from 'exceljs';

interface PriceItem {
  id: string;
  discipline: string;
  category: string;
  item_name: string;
  description: string | null;
  unit: string;
  unit_rate_aed: number;
  brand: string | null;
  notes: string | null;
  rate_source: string | null;
  rate_checked_at: string | null;
  updated_at: string;
}

interface RefreshProposal {
  id: string;
  item_name: string;
  unit: string;
  old_rate: number;
  new_rate: number;
  source_name: string | null;
  source_url: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
}

interface RateHistoryRow {
  batch_id: string;
  item_id: string | null;
  item_name: string;
  old_rate: number | null;
  new_rate: number;
  source: string | null;
  changed_at: string;
}

const DISCIPLINES = ['hvac', 'electrical', 'plumbing', 'fire_fighting', 'fire_alarm', 'bms', 'drainage', 'lpg'];

const CATEGORIES: Record<string, string[]> = {
  hvac: ['Equipment', 'Indoor Units', 'Ductwork', 'Duct Accessories', 'Air Terminals', 'Piping', 'Condensate', 'Insulation', 'Ventilation', 'Controls', 'Testing & Commissioning', 'Supports', 'Electrical (HVAC)'],
  electrical: ['Switchgear', 'Cables', 'Fixtures', 'Accessories', 'Power'],
  plumbing: ['Pipes', 'Fittings', 'Fixtures', 'Tanks', 'Pumps', 'Valves'],
  fire_fighting: ['Sprinklers', 'Pumps', 'Pipes', 'Accessories', 'Tanks'],
  fire_alarm: ['Panels', 'Detectors', 'Accessories', 'Cables'],
  bms: ['Controllers', 'Sensors', 'Software'],
  drainage: ['Pipes', 'Manholes', 'Fittings', 'Accessories'],
  lpg: ['Pipes', 'Valves', 'Regulators', 'Accessories'],
};

const DISCIPLINE_LABELS: Record<string, string> = {
  hvac: 'HVAC', electrical: 'Electrical', plumbing: 'Plumbing',
  fire_fighting: 'Fire Fighting', fire_alarm: 'Fire Alarm',
  bms: 'BMS', drainage: 'Drainage', lpg: 'LPG',
};

const DISC_COLORS: Record<string, string> = {
  hvac: 'bg-blue-500', electrical: 'bg-amber-500', plumbing: 'bg-cyan-500',
  fire_fighting: 'bg-red-500', fire_alarm: 'bg-orange-500',
  bms: 'bg-purple-500', drainage: 'bg-teal-500', lpg: 'bg-emerald-500',
};

export default function PriceLibraryPage() {
  const [loading, setLoading] = useState(true);
  const [filterDiscipline, setFilterDiscipline] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<PriceItem>>({});
  const [newItem, setNewItem] = useState({
    discipline: 'hvac', category: 'Equipment', item_name: '', description: '',
    unit: 'nos', unit_rate_aed: 0, brand: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  // Excel upload state
  const [showUpload, setShowUpload] = useState(false);
  const [parsedRows, setParsedRows] = useState<Array<Partial<PriceItem> & { _row: number; _error?: string }>>([]);
  const [uploadError, setUploadError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ inserted: number; skipped: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Refresh Dubai Rates (AI + live web search) state
  const [showRefresh, setShowRefresh] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [refreshRows, setRefreshRows] = useState<RefreshProposal[]>([]);
  const [refreshEdits, setRefreshEdits] = useState<Record<string, number>>({});
  const [refreshChecked, setRefreshChecked] = useState<Record<string, boolean>>({});
  const [applyingRefresh, setApplyingRefresh] = useState(false);
  const [refreshResult, setRefreshResult] = useState<{ updated: number; skipped: number } | null>(null);

  // Sources & History panel state
  const [showSourcesHistory, setShowSourcesHistory] = useState(false);
  const [historyRows, setHistoryRows] = useState<RateHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [openBatches, setOpenBatches] = useState<Record<string, boolean>>({});

  const [allItems, setAllItems] = useState<PriceItem[]>([]);

  const fetchItems = async () => {
    setLoading(true);
    const res = await fetch('/api/price-library');
    const data = await res.json();
    setAllItems(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => { fetchItems(); }, []);

  // Client-side filtering by discipline
  const items_filtered = filterDiscipline
    ? allItems.filter(i => i.discipline === filterDiscipline)
    : allItems;

  const filteredItems = searchQuery
    ? items_filtered.filter(i =>
        i.item_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (i.brand || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (i.notes || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : items_filtered;

  const handleAdd = async () => {
    if (!newItem.item_name || !newItem.unit_rate_aed) return;
    setSaving(true);
    await fetch('/api/price-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newItem),
    });
    setShowAdd(false);
    setNewItem({ discipline: 'hvac', category: 'Equipment', item_name: '', description: '', unit: 'nos', unit_rate_aed: 0, brand: '', notes: '' });
    setSaving(false);
    await fetchItems();
  };

  const startEdit = (item: PriceItem) => {
    setEditingId(item.id);
    setEditValues({ item_name: item.item_name, unit: item.unit, unit_rate_aed: item.unit_rate_aed, brand: item.brand, notes: item.notes });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await fetch('/api/price-library', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editingId, ...editValues }),
    });
    setEditingId(null);
    setEditValues({});
    await fetchItems();
  };

  const deleteItem = async (id: string) => {
    if (!confirm('Delete this price item? This cannot be undone.')) return;
    await fetch(`/api/price-library?id=${id}`, { method: 'DELETE' });
    await fetchItems();
  };

  // Excel upload: column name matching
  const COLUMN_MAP: Record<string, string[]> = {
    discipline: ['discipline', 'service', 'trade', 'dept'],
    category: ['category', 'type', 'group', 'section'],
    item_name: ['item_name', 'item', 'name', 'description', 'material', 'particulars'],
    unit: ['unit', 'uom', 'u/m'],
    unit_rate_aed: ['unit_rate_aed', 'rate', 'price', 'unit_rate', 'amount', 'cost', 'unit price', 'unit_price'],
    brand: ['brand', 'manufacturer', 'make', 'supplier'],
    notes: ['notes', 'remarks', 'comment', 'remark'],
  };

  const matchColumn = (header: string): string | null => {
    const h = header.toLowerCase().trim();
    for (const [field, aliases] of Object.entries(COLUMN_MAP)) {
      if (aliases.some(a => h === a || h.includes(a))) return field;
    }
    return null;
  };

  const handleFileUpload = async (file: File) => {
    setUploadError('');
    setParsedRows([]);
    setImportResult(null);

    try {
      const buffer = await file.arrayBuffer();
      let headers: string[] = [];
      let dataRows: string[][] = [];

      if (file.name.endsWith('.csv')) {
        // Parse CSV manually
        const text = new TextDecoder().decode(buffer);
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { setUploadError('Empty CSV file.'); return; }
        headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        dataRows = lines.slice(1).map(line => {
          const cells: string[] = [];
          let current = '';
          let inQuote = false;
          for (const ch of line) {
            if (ch === '"') { inQuote = !inQuote; }
            else if (ch === ',' && !inQuote) { cells.push(current.trim()); current = ''; }
            else { current += ch; }
          }
          cells.push(current.trim());
          return cells;
        });
      } else {
        // Parse XLSX with ExcelJS
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const sheet = workbook.worksheets[0];
        if (!sheet || sheet.rowCount < 2) { setUploadError('Empty spreadsheet.'); return; }
        const headerRow = sheet.getRow(1);
        headerRow.eachCell((cell) => {
          headers.push(String(cell.value || '').trim());
        });
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const cells: string[] = [];
          for (let c = 1; c <= headers.length; c++) {
            let val = row.getCell(c).value;
            if (val && typeof val === 'object' && 'result' in val) val = (val as any).result;
            cells.push(val != null ? String(val).trim() : '');
          }
          dataRows.push(cells);
        });
      }

      // Map headers to fields
      const colMap: Record<number, string> = {};
      headers.forEach((h, i) => {
        const field = matchColumn(h);
        if (field) colMap[i] = field;
      });

      if (Object.keys(colMap).length === 0) {
        setUploadError('Could not detect columns. Expected headers: discipline, category, item_name, unit, rate');
        return;
      }

      // Parse data rows
      const rows: Array<Partial<PriceItem> & { _row: number; _error?: string }> = [];
      dataRows.forEach((cells, idx) => {
        const item: Record<string, unknown> = { _row: idx + 2 };
        for (const [colIdx, field] of Object.entries(colMap)) {
          item[field] = cells[Number(colIdx)] || '';
        }
        if (item.unit_rate_aed) {
          const rate = parseFloat(String(item.unit_rate_aed).replace(/[^0-9.]/g, ''));
          item.unit_rate_aed = isNaN(rate) ? 0 : rate;
        }
        if (!item.item_name) { item._error = 'Missing item name'; }
        else if (!item.unit_rate_aed || Number(item.unit_rate_aed) <= 0) { item._error = 'Missing/invalid rate'; }
        else if (!item.discipline) { item._error = 'Missing discipline'; }
        else if (!item.category) { item._error = 'Missing category'; }

        rows.push(item as any);
      });

      if (rows.length === 0) {
        setUploadError('No data rows found in spreadsheet.');
        return;
      }

      setParsedRows(rows);
    } catch (err: any) {
      setUploadError(`Failed to parse file: ${err.message}`);
    }
  };

  const handleImport = async () => {
    const validRows = parsedRows.filter(r => !r._error);
    if (validRows.length === 0) return;
    setImporting(true);
    try {
      const res = await fetch('/api/price-library/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: validRows.map(({ _row, _error, ...rest }) => rest) }),
      });
      const result = await res.json();
      setImportResult(result);
      if (result.inserted > 0) {
        await fetchItems();
      }
    } catch (err: any) {
      setUploadError(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  // Refresh Dubai Rates: fetch AI web-search proposals (no DB write yet)
  const handleRefresh = async () => {
    setShowRefresh(true); setShowAdd(false); setShowUpload(false); setShowSourcesHistory(false);
    setRefreshing(true); setRefreshError(''); setRefreshRows([]); setRefreshResult(null);
    try {
      const res = await fetch('/api/price-library/refresh', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setRefreshError(data.error || 'Failed to fetch latest rates'); return; }
      const rows: RefreshProposal[] = Array.isArray(data) ? data : [];
      if (rows.length === 0) { setRefreshError('No updated Dubai rates were found.'); return; }
      setRefreshRows(rows);
      setRefreshEdits(Object.fromEntries(rows.map(r => [r.id, r.new_rate])));
      setRefreshChecked(Object.fromEntries(rows.map(r => [r.id, true])));
    } catch (err: any) {
      setRefreshError(err.message || 'Failed to fetch latest rates');
    } finally {
      setRefreshing(false);
    }
  };

  // Apply only the rows the user kept checked
  const handleApplyRefresh = async () => {
    const approved = refreshRows
      .filter(r => refreshChecked[r.id])
      .map(r => ({
        id: r.id,
        item_name: r.item_name,
        old_rate: r.old_rate,
        unit_rate_aed: refreshEdits[r.id],
        rate_source: r.source_url ? `${r.source_name || 'web'} (${r.source_url})` : r.source_name,
      }));
    if (approved.length === 0) return;
    setApplyingRefresh(true);
    try {
      const res = await fetch('/api/price-library/refresh', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: approved }),
      });
      const result = await res.json();
      if (!res.ok) { setRefreshError(result.error || 'Failed to apply rates'); return; }
      setRefreshResult(result);
      if (result.updated > 0) { await fetchItems(); await fetchHistory(); }
    } catch (err: any) {
      setRefreshError(err.message || 'Failed to apply rates');
    } finally {
      setApplyingRefresh(false);
    }
  };

  // Sources & History: load past refresh runs
  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/price-library/refresh');
      const data = await res.json();
      setHistoryRows(Array.isArray(data) ? data : []);
    } finally {
      setHistoryLoading(false);
    }
  };

  const toggleSourcesHistory = () => {
    const next = !showSourcesHistory;
    setShowSourcesHistory(next);
    if (next) { setShowAdd(false); setShowUpload(false); setShowRefresh(false); fetchHistory(); }
  };

  // Group by discipline then category
  const grouped: Record<string, Record<string, PriceItem[]>> = {};
  filteredItems.forEach(item => {
    if (!grouped[item.discipline]) grouped[item.discipline] = {};
    if (!grouped[item.discipline][item.category]) grouped[item.discipline][item.category] = [];
    grouped[item.discipline][item.category].push(item);
  });

  // Stats
  const totalItems = filteredItems.length;
  const discCounts = DISCIPLINES.map(d => ({ d, count: allItems.filter(i => i.discipline === d).length }));
  const lastChecked = allItems
    .map(i => i.rate_checked_at)
    .filter(Boolean)
    .sort()
    .pop();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Price Library</h1>
          <p className="text-sm text-gray-500 mt-1">
            {totalItems} items — Dubai MEP market rates{lastChecked ? ` (last refreshed ${new Date(lastChecked).toLocaleDateString()})` : ' (Q1 2025)'}. Click any rate to edit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> {refreshing ? 'Searching…' : 'Refresh Dubai Rates'}
          </button>
          <button
            onClick={toggleSourcesHistory}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border ${showSourcesHistory ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
          >
            <History className="h-4 w-4" /> Sources &amp; History
          </button>
          <button
            onClick={() => { setShowUpload(!showUpload); setShowAdd(false); setShowSourcesHistory(false); }}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700"
          >
            <Upload className="h-4 w-4" /> Upload Excel
          </button>
          <button
            onClick={() => { setShowAdd(!showAdd); setShowUpload(false); setShowSourcesHistory(false); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Add Item
          </button>
        </div>
      </div>

      {/* Discipline pills with counts */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilterDiscipline(null)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${!filterDiscipline ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          All ({allItems.length})
        </button>
        {discCounts.filter(dc => dc.count > 0).map(({ d, count }) => (
          <button key={d} onClick={() => setFilterDiscipline(d === filterDiscipline ? null : d)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${filterDiscipline === d ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            <span className={`w-2 h-2 rounded-full ${DISC_COLORS[d] || 'bg-gray-400'}`} />
            {DISCIPLINE_LABELS[d]} ({count})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search items, brands, categories..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none"
        />
      </div>

      {/* Upload Excel panel */}
      {showUpload && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
              <h3 className="text-sm font-semibold text-emerald-800">Upload Price Data from Excel</h3>
            </div>
            <button onClick={() => { setShowUpload(false); setParsedRows([]); setUploadError(''); setImportResult(null); }}
              className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
          </div>

          {/* File input */}
          {parsedRows.length === 0 && !importResult && (
            <div>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-emerald-300 rounded-xl p-8 text-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-100/50 transition-colors"
              >
                <Upload className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-emerald-700">Click to upload Excel or CSV</p>
                <p className="text-xs text-emerald-500 mt-1">Supports .xlsx, .xls, .csv — max 500 rows</p>
                <p className="text-[10px] text-gray-400 mt-2">Expected columns: discipline, category, item_name, unit, rate (+ optional: brand, notes)</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = ''; }}
              />
            </div>
          )}

          {/* Error */}
          {uploadError && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-lg px-4 py-3 mt-3">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <p className="text-sm">{uploadError}</p>
            </div>
          )}

          {/* Preview table */}
          {parsedRows.length > 0 && !importResult && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-emerald-700">
                  <span className="font-bold">{parsedRows.filter(r => !r._error).length}</span> valid rows
                  {parsedRows.some(r => r._error) && (
                    <span className="text-amber-600 ml-2">({parsedRows.filter(r => r._error).length} with errors)</span>
                  )}
                </p>
                <div className="flex gap-2">
                  <button onClick={() => { setParsedRows([]); setUploadError(''); }}
                    className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg">Clear</button>
                  <button
                    onClick={handleImport}
                    disabled={importing || parsedRows.filter(r => !r._error).length === 0}
                    className="px-4 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {importing ? 'Importing...' : `Import ${parsedRows.filter(r => !r._error).length} Items`}
                  </button>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left py-2 px-2 font-medium text-gray-500 w-6">#</th>
                      <th className="text-left py-2 px-2 font-medium text-gray-500">Discipline</th>
                      <th className="text-left py-2 px-2 font-medium text-gray-500">Category</th>
                      <th className="text-left py-2 px-2 font-medium text-gray-500">Item</th>
                      <th className="text-left py-2 px-2 font-medium text-gray-500 w-14">Unit</th>
                      <th className="text-right py-2 px-2 font-medium text-gray-500 w-24">Rate (AED)</th>
                      <th className="text-left py-2 px-2 font-medium text-gray-500 w-20">Brand</th>
                      <th className="text-left py-2 px-2 font-medium text-gray-500 w-16">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {parsedRows.slice(0, 100).map((row, i) => (
                      <tr key={i} className={row._error ? 'bg-red-50/50' : 'hover:bg-gray-50'}>
                        <td className="py-1.5 px-2 text-gray-400 tabular-nums">{row._row}</td>
                        <td className="py-1.5 px-2 text-gray-600">{row.discipline || '—'}</td>
                        <td className="py-1.5 px-2 text-gray-600">{row.category || '—'}</td>
                        <td className="py-1.5 px-2 text-gray-800 truncate max-w-[200px]">{row.item_name || '—'}</td>
                        <td className="py-1.5 px-2 text-gray-500">{row.unit || '—'}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums font-medium">{row.unit_rate_aed ? Number(row.unit_rate_aed).toLocaleString() : '—'}</td>
                        <td className="py-1.5 px-2 text-gray-500 truncate">{row.brand || '—'}</td>
                        <td className="py-1.5 px-2">
                          {row._error ? (
                            <span className="text-[9px] text-red-600 bg-red-100 px-1.5 py-0.5 rounded">{row._error}</span>
                          ) : (
                            <span className="text-[9px] text-green-600 bg-green-100 px-1.5 py-0.5 rounded">OK</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedRows.length > 100 && (
                  <p className="text-[10px] text-gray-400 text-center py-2">Showing first 100 of {parsedRows.length} rows</p>
                )}
              </div>
            </div>
          )}

          {/* Import result */}
          {importResult && (
            <div className="mt-3">
              <div className={`rounded-lg px-4 py-3 ${importResult.inserted > 0 ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
                <p className="text-sm font-medium">
                  {importResult.inserted > 0 ? `Successfully imported ${importResult.inserted} items` : 'No items imported'}
                  {importResult.skipped > 0 && ` (${importResult.skipped} skipped)`}
                </p>
                {importResult.errors.length > 0 && (
                  <ul className="mt-2 text-xs space-y-0.5">
                    {importResult.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                    {importResult.errors.length > 5 && <li>...and {importResult.errors.length - 5} more</li>}
                  </ul>
                )}
              </div>
              <button
                onClick={() => { setShowUpload(false); setParsedRows([]); setImportResult(null); }}
                className="mt-2 text-xs text-gray-500 hover:text-gray-700"
              >Done</button>
            </div>
          )}
        </div>
      )}

      {/* Refresh Dubai Rates panel (AI + live web search) */}
      {showRefresh && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-violet-600" />
              <h3 className="text-sm font-semibold text-violet-800">Latest Dubai Rates — review before applying</h3>
            </div>
            <button onClick={() => { setShowRefresh(false); setRefreshRows([]); setRefreshError(''); setRefreshResult(null); }}
              className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
          </div>

          {refreshing && (
            <div className="flex items-center gap-3 text-sm text-violet-700 py-6 justify-center">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-violet-600" />
              Web-searching current Dubai market prices… this can take a minute.
            </div>
          )}

          {refreshError && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-lg px-4 py-3">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <p className="text-sm">{refreshError}</p>
            </div>
          )}

          {!refreshing && refreshRows.length > 0 && !refreshResult && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-violet-700">
                  <span className="font-bold">{Object.values(refreshChecked).filter(Boolean).length}</span> of {refreshRows.length} selected — edit any rate, uncheck to skip
                </p>
                <button
                  onClick={handleApplyRefresh}
                  disabled={applyingRefresh || Object.values(refreshChecked).filter(Boolean).length === 0}
                  className="px-4 py-1.5 text-xs font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50"
                >
                  {applyingRefresh ? 'Applying…' : `Apply ${Object.values(refreshChecked).filter(Boolean).length} rates`}
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-200">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-center py-2 px-2 font-medium text-gray-500 w-8">✓</th>
                      <th className="text-left py-2 px-2 font-medium text-gray-500">Item</th>
                      <th className="text-left py-2 px-2 font-medium text-gray-500 w-14">Unit</th>
                      <th className="text-right py-2 px-2 font-medium text-gray-500 w-20">Old</th>
                      <th className="text-right py-2 px-2 font-medium text-gray-500 w-28">New (AED)</th>
                      <th className="text-left py-2 px-2 font-medium text-gray-500">Source</th>
                      <th className="text-left py-2 px-2 font-medium text-gray-500 w-16">Conf.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {refreshRows.map(row => {
                      const checked = !!refreshChecked[row.id];
                      const up = refreshEdits[row.id] > row.old_rate;
                      return (
                        <tr key={row.id} className={checked ? 'hover:bg-gray-50' : 'opacity-40'}>
                          <td className="py-1.5 px-2 text-center">
                            <input type="checkbox" checked={checked}
                              onChange={e => setRefreshChecked({ ...refreshChecked, [row.id]: e.target.checked })} />
                          </td>
                          <td className="py-1.5 px-2 text-gray-800 truncate max-w-[200px]">{row.item_name}</td>
                          <td className="py-1.5 px-2 text-gray-500">{row.unit}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-gray-400">{row.old_rate.toLocaleString()}</td>
                          <td className="py-1.5 px-2 text-right">
                            <input type="number" value={refreshEdits[row.id] ?? ''}
                              onChange={e => setRefreshEdits({ ...refreshEdits, [row.id]: parseFloat(e.target.value) || 0 })}
                              className={`w-24 px-2 py-1 border rounded text-right text-xs ${up ? 'text-green-700 border-green-300' : 'text-red-700 border-red-300'}`} />
                          </td>
                          <td className="py-1.5 px-2 text-gray-500 truncate max-w-[180px]">
                            {row.source_url ? (
                              <a href={row.source_url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-violet-600 hover:underline">
                                {row.source_name || 'source'} <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (row.source_name || '—')}
                          </td>
                          <td className="py-1.5 px-2">
                            {row.confidence && (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded ${row.confidence === 'high' ? 'text-green-700 bg-green-100' : row.confidence === 'medium' ? 'text-amber-700 bg-amber-100' : 'text-gray-600 bg-gray-100'}`}>
                                {row.confidence}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {refreshResult && (
            <div className="mt-1">
              <div className={`rounded-lg px-4 py-3 ${refreshResult.updated > 0 ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
                <p className="text-sm font-medium">
                  {refreshResult.updated > 0 ? `Applied ${refreshResult.updated} updated rates` : 'No rates applied'}
                  {refreshResult.skipped > 0 && ` (${refreshResult.skipped} skipped)`}
                </p>
              </div>
              <button onClick={() => { setShowRefresh(false); setRefreshRows([]); setRefreshResult(null); }}
                className="mt-2 text-xs text-gray-500 hover:text-gray-700">Done</button>
            </div>
          )}
        </div>
      )}

      {/* Sources & History panel */}
      {showSourcesHistory && (() => {
        // Source string is stored as "name (url)" — split label from link.
        const parseSource = (src: string | null): { label: string; url: string | null } => {
          if (!src) return { label: '', url: null };
          const m = src.match(/\((https?:\/\/[^)]+)\)\s*$/);
          if (m) return { label: src.slice(0, m.index).trim() || m[1], url: m[1] };
          return { label: src, url: null };
        };
        // Group history rows by batch_id, preserving newest-first order.
        const batches: Array<{ batch_id: string; changed_at: string; rows: RateHistoryRow[] }> = [];
        const byId: Record<string, number> = {};
        for (const r of historyRows) {
          if (byId[r.batch_id] === undefined) {
            byId[r.batch_id] = batches.length;
            batches.push({ batch_id: r.batch_id, changed_at: r.changed_at, rows: [] });
          }
          batches[byId[r.batch_id]].rows.push(r);
        }
        return (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-gray-600" />
              <h3 className="text-sm font-semibold text-gray-800">Rate Sources &amp; Refresh History</h3>
            </div>
            <button onClick={() => setShowSourcesHistory(false)} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
          </div>

          {/* Sourced rates */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Sourced Rates ({filteredItems.length})</p>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr className="text-left text-gray-500">
                    <th className="py-2 px-3 font-medium">Item</th>
                    <th className="py-2 px-3 font-medium text-right w-24">Rate</th>
                    <th className="py-2 px-3 font-medium">Source</th>
                    <th className="py-2 px-3 font-medium w-28">Last refreshed</th>
                    <th className="py-2 px-3 font-medium w-16">Origin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredItems.map(item => {
                    const { label, url } = parseSource(item.rate_source);
                    return (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="py-1.5 px-3 text-gray-800 truncate max-w-[220px]">{item.item_name}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums font-medium text-gray-800">{formatAED(item.unit_rate_aed)}</td>
                        <td className="py-1.5 px-3 text-gray-500 truncate max-w-[200px]">
                          {url ? (
                            <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-violet-600 hover:underline">
                              {label} <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (label || '—')}
                        </td>
                        <td className="py-1.5 px-3 text-gray-500">{item.rate_checked_at ? new Date(item.rate_checked_at).toLocaleDateString() : '—'}</td>
                        <td className="py-1.5 px-3">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded ${item.rate_source ? 'text-violet-700 bg-violet-100' : 'text-gray-500 bg-gray-100'}`}>
                            {item.rate_source ? 'AI' : 'manual'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Refresh history */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Refresh History</p>
            {historyLoading ? (
              <div className="flex items-center justify-center py-6">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-500" />
              </div>
            ) : batches.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">No refresh runs recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {batches.map(b => {
                  const open = !!openBatches[b.batch_id];
                  return (
                    <div key={b.batch_id} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                      <button
                        onClick={() => setOpenBatches({ ...openBatches, [b.batch_id]: !open })}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50"
                      >
                        <ChevronRight className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                        <span className="text-xs font-medium text-gray-700">{new Date(b.changed_at).toLocaleString()}</span>
                        <span className="text-[11px] text-gray-400 ml-auto">{b.rows.length} rate{b.rows.length === 1 ? '' : 's'} updated</span>
                      </button>
                      {open && (
                        <table className="w-full text-xs border-t border-gray-100">
                          <tbody className="divide-y divide-gray-50">
                            {b.rows.map(r => {
                              const { label, url } = parseSource(r.source);
                              return (
                                <tr key={r.item_id + r.changed_at} className="hover:bg-gray-50">
                                  <td className="py-1.5 px-3 text-gray-700 truncate max-w-[220px]">{r.item_name}</td>
                                  <td className="py-1.5 px-3 text-right tabular-nums text-gray-400">{r.old_rate != null ? formatAED(r.old_rate) : '—'}</td>
                                  <td className="py-1.5 px-3 text-center text-gray-300 w-6">→</td>
                                  <td className="py-1.5 px-3 text-right tabular-nums font-medium text-gray-800 w-24">{formatAED(r.new_rate)}</td>
                                  <td className="py-1.5 px-3 text-gray-500 truncate max-w-[180px]">
                                    {url ? (
                                      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-violet-600 hover:underline">{label} <ExternalLink className="h-3 w-3" /></a>
                                    ) : (label || '—')}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {/* Add form */}
      {showAdd && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-blue-800 mb-3">Add New Price Item</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <select value={newItem.discipline} onChange={e => setNewItem({...newItem, discipline: e.target.value, category: CATEGORIES[e.target.value]?.[0] || ''})}
              className="px-3 py-2 border rounded-lg text-sm">
              {DISCIPLINES.map(d => <option key={d} value={d}>{DISCIPLINE_LABELS[d]}</option>)}
            </select>
            <select value={newItem.category} onChange={e => setNewItem({...newItem, category: e.target.value})}
              className="px-3 py-2 border rounded-lg text-sm">
              {(CATEGORIES[newItem.discipline] || []).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input placeholder="Item name *" value={newItem.item_name} onChange={e => setNewItem({...newItem, item_name: e.target.value})}
              className="px-3 py-2 border rounded-lg text-sm" />
            <input placeholder="Unit (nos, Rmt, sqft, LS)" value={newItem.unit} onChange={e => setNewItem({...newItem, unit: e.target.value})}
              className="px-3 py-2 border rounded-lg text-sm" />
            <input placeholder="Rate (AED) *" type="number" value={newItem.unit_rate_aed || ''} onChange={e => setNewItem({...newItem, unit_rate_aed: parseFloat(e.target.value) || 0})}
              className="px-3 py-2 border rounded-lg text-sm" />
            <input placeholder="Brand (optional)" value={newItem.brand} onChange={e => setNewItem({...newItem, brand: e.target.value})}
              className="px-3 py-2 border rounded-lg text-sm" />
            <input placeholder="Notes (optional)" value={newItem.notes} onChange={e => setNewItem({...newItem, notes: e.target.value})}
              className="px-3 py-2 border rounded-lg text-sm col-span-2 md:col-span-1" />
            <div className="flex items-center gap-2">
              <button onClick={handleAdd} disabled={saving || !newItem.item_name || !newItem.unit_rate_aed}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                <Save className="h-4 w-4" /> {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => { setShowAdd(false); setNewItem({ discipline: 'hvac', category: 'Equipment', item_name: '', description: '', unit: 'nos', unit_rate_aed: 0, brand: '', notes: '' }); }}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50">
                <X className="h-4 w-4" /> Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Items table */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">No items found.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([disc, categories]) => (
            <div key={disc} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div className="bg-gray-50 px-4 py-2.5 border-b flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${DISC_COLORS[disc] || 'bg-gray-400'}`} />
                <h3 className="text-sm font-bold text-gray-800">{DISCIPLINE_LABELS[disc] || disc}</h3>
                <span className="text-xs text-gray-400 ml-auto">{Object.values(categories).flat().length} items</span>
              </div>
              {Object.entries(categories).map(([cat, catItems]) => (
                <div key={cat}>
                  <div className="px-4 py-1.5 bg-gray-50/50 border-b border-t border-gray-100">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{cat}</span>
                  </div>
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead>
                      <tr className="text-left text-[10px] text-gray-400 uppercase border-b">
                        <th className="px-4 py-1.5">Item</th>
                        <th className="px-4 py-1.5">Unit</th>
                        <th className="px-4 py-1.5 text-right">Rate (AED)</th>
                        <th className="px-4 py-1.5 hidden sm:table-cell">Brand</th>
                        <th className="px-4 py-1.5 hidden md:table-cell">Notes</th>
                        <th className="px-4 py-1.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {catItems.map(item => {
                        const isEditing = editingId === item.id;
                        return (
                          <tr key={item.id} className={`border-b border-gray-50 ${isEditing ? 'bg-blue-50' : 'hover:bg-gray-50'} group`}>
                            <td className="px-4 py-2">
                              {isEditing ? (
                                <input value={editValues.item_name || ''} onChange={e => setEditValues({...editValues, item_name: e.target.value})}
                                  className="w-full px-2 py-1 border border-blue-300 rounded text-sm" />
                              ) : (
                                <p className="font-medium text-gray-700">{item.item_name}</p>
                              )}
                              {!isEditing && item.description && <p className="text-[10px] text-gray-400 mt-0.5">{item.description}</p>}
                            </td>
                            <td className="px-4 py-2 text-gray-500">
                              {isEditing ? (
                                <input value={editValues.unit || ''} onChange={e => setEditValues({...editValues, unit: e.target.value})}
                                  className="w-full px-2 py-1 border border-blue-300 rounded text-sm" />
                              ) : item.unit}
                            </td>
                            <td className="px-4 py-2 text-right">
                              {isEditing ? (
                                <input type="number" value={editValues.unit_rate_aed || ''} onChange={e => setEditValues({...editValues, unit_rate_aed: parseFloat(e.target.value) || 0})}
                                  className="w-full px-2 py-1 border border-blue-300 rounded text-sm text-right"
                                  onKeyDown={e => e.key === 'Enter' && saveEdit()} />
                              ) : (
                                <>
                                  <span className="font-semibold text-gray-800 tabular-nums cursor-pointer hover:text-blue-600" onClick={() => startEdit(item)}>
                                    {formatAED(item.unit_rate_aed)}
                                  </span>
                                  {item.rate_source && (
                                    <p className="text-[9px] text-violet-500 mt-0.5 truncate max-w-[140px] ml-auto" title={item.rate_source}>{item.rate_source}</p>
                                  )}
                                </>
                              )}
                            </td>
                            <td className="px-4 py-2 text-gray-400 hidden sm:table-cell">
                              {isEditing ? (
                                <input value={editValues.brand || ''} onChange={e => setEditValues({...editValues, brand: e.target.value})}
                                  className="w-full px-2 py-1 border border-blue-300 rounded text-sm" />
                              ) : (item.brand || '-')}
                            </td>
                            <td className="px-4 py-2 text-[11px] text-gray-400 hidden md:table-cell">
                              {isEditing ? (
                                <input value={editValues.notes || ''} onChange={e => setEditValues({...editValues, notes: e.target.value})}
                                  className="w-full px-2 py-1 border border-blue-300 rounded text-sm" />
                              ) : (item.notes || '-')}
                            </td>
                            <td className="px-4 py-2 text-right">
                              {isEditing ? (
                                <div className="flex items-center justify-end gap-1">
                                  <button onClick={saveEdit} className="p-1 text-green-600 hover:bg-green-50 rounded">
                                    <Check className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => { setEditingId(null); setEditValues({}); }} className="p-1 text-gray-400 hover:bg-gray-100 rounded">
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => startEdit(item)} className="p-1 text-blue-500 hover:bg-blue-50 rounded" title="Edit">
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => deleteItem(item.id)} className="p-1 text-red-400 hover:bg-red-50 rounded" title="Delete">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
