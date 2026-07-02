'use client';

import { useEffect, useState } from 'react';
import { YardstickRate } from '@/lib/shared/types';
import { SERVICE_LABELS } from '@/lib/shared/constants';
import { useToast } from '@/contexts/toast-context';
import { Ruler, Plus, Save, X } from 'lucide-react';

const BUILDING_TYPES = ['office', 'residential', 'villa', 'hotel', 'retail', 'warehouse', 'hospital', 'restaurant'];
const SERVICE_TYPES = ['hvac', 'electrical', 'plumbing', 'fire_fighting', 'fire_alarm', 'bms', 'drainage', 'lpg'];

export default function YardstickPage() {
  const { toast } = useToast();
  const [rates, setRates] = useState<YardstickRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<YardstickRate>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [newRate, setNewRate] = useState({ building_type: 'office', service_type: 'hvac', min_aed_per_sqft: 0, max_aed_per_sqft: 0, notes: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchRates();
  }, []);

  const fetchRates = async () => {
    try {
      const res = await fetch('/api/yardstick');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setRates(data.rates || []);
    } catch {
      // Not connected
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (rate: YardstickRate) => {
    setEditingId(rate.id);
    setEditValues({
      min_aed_per_sqft: rate.min_aed_per_sqft,
      max_aed_per_sqft: rate.max_aed_per_sqft,
    });
  };

  const saveEdit = async (id: string) => {
    try {
      await fetch('/api/yardstick', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...editValues }),
      });
      setEditingId(null);
      fetchRates();
    } catch {
      toast('Failed to save', 'error');
    }
  };

  const addRate = async () => {
    if (!newRate.min_aed_per_sqft || !newRate.max_aed_per_sqft) return;
    setSaving(true);
    try {
      await fetch('/api/yardstick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRate),
      });
      setShowAdd(false);
      setNewRate({ building_type: 'office', service_type: 'hvac', min_aed_per_sqft: 0, max_aed_per_sqft: 0, notes: '' });
      await fetchRates();
    } catch {
      toast('Failed to add rate', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Group by building type
  const grouped = rates.reduce<Record<string, YardstickRate[]>>((acc, rate) => {
    const key = rate.building_type;
    if (!acc[key]) acc[key] = [];
    acc[key].push(rate);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Yardstick Rates</h1>
          <p className="text-sm text-gray-500 mt-1">Market benchmark rates (AED per sqft) for estimation validation</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Add Rate
        </button>
      </div>

      {showAdd && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-blue-800 mb-3">Add New Yardstick Rate</h3>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <select value={newRate.building_type} onChange={e => setNewRate({...newRate, building_type: e.target.value})}
              className="px-3 py-2 border rounded-lg text-sm">
              {BUILDING_TYPES.map(bt => <option key={bt} value={bt}>{bt.charAt(0).toUpperCase() + bt.slice(1)}</option>)}
            </select>
            <select value={newRate.service_type} onChange={e => setNewRate({...newRate, service_type: e.target.value})}
              className="px-3 py-2 border rounded-lg text-sm">
              {SERVICE_TYPES.map(st => <option key={st} value={st}>{SERVICE_LABELS[st as keyof typeof SERVICE_LABELS] || st}</option>)}
            </select>
            <input placeholder="Min AED/sqft *" type="number" value={newRate.min_aed_per_sqft || ''} onChange={e => setNewRate({...newRate, min_aed_per_sqft: parseFloat(e.target.value) || 0})}
              className="px-3 py-2 border rounded-lg text-sm" />
            <input placeholder="Max AED/sqft *" type="number" value={newRate.max_aed_per_sqft || ''} onChange={e => setNewRate({...newRate, max_aed_per_sqft: parseFloat(e.target.value) || 0})}
              className="px-3 py-2 border rounded-lg text-sm" />
            <input placeholder="Notes (optional)" value={newRate.notes} onChange={e => setNewRate({...newRate, notes: e.target.value})}
              className="px-3 py-2 border rounded-lg text-sm" />
            <div className="flex items-center gap-2">
              <button onClick={addRate} disabled={saving || !newRate.min_aed_per_sqft || !newRate.max_aed_per_sqft}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                <Save className="h-4 w-4" /> {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => { setShowAdd(false); setNewRate({ building_type: 'office', service_type: 'hvac', min_aed_per_sqft: 0, max_aed_per_sqft: 0, notes: '' }); }}
                className="flex items-center justify-center gap-1 px-3 py-2 bg-white border border-gray-300 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {Object.entries(grouped).map(([buildingType, buildingRates]) => (
        <div key={buildingType} className="bg-white rounded-xl border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 rounded-t-xl">
            <h2 className="text-sm font-semibold text-gray-700 capitalize">
              {buildingType}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Service</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-600">Min (AED/sqft)</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-600">Max (AED/sqft)</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Notes</th>
                  <th className="text-center px-4 py-2 font-medium text-gray-600 w-20">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {buildingRates.map((rate) => (
                  <tr key={rate.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-900">
                      {SERVICE_LABELS[rate.service_type as keyof typeof SERVICE_LABELS] || rate.service_type}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {editingId === rate.id ? (
                        <input
                          type="number"
                          value={editValues.min_aed_per_sqft || ''}
                          onChange={(e) => setEditValues({ ...editValues, min_aed_per_sqft: Number(e.target.value) })}
                          className="w-20 text-right border border-gray-300 rounded px-2 py-1 text-sm"
                        />
                      ) : (
                        <span className="text-gray-700">{rate.min_aed_per_sqft}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {editingId === rate.id ? (
                        <input
                          type="number"
                          value={editValues.max_aed_per_sqft || ''}
                          onChange={(e) => setEditValues({ ...editValues, max_aed_per_sqft: Number(e.target.value) })}
                          className="w-20 text-right border border-gray-300 rounded px-2 py-1 text-sm"
                        />
                      ) : (
                        <span className="text-gray-700">{rate.max_aed_per_sqft}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-500 text-xs">{rate.notes || '-'}</td>
                    <td className="px-4 py-2 text-center">
                      {editingId === rate.id ? (
                        <button
                          onClick={() => saveEdit(rate.id)}
                          className="text-green-600 hover:text-green-800"
                        >
                          <Save className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => startEdit(rate)}
                          className="text-gray-400 hover:text-blue-600 text-xs"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {rates.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          <Ruler className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No yardstick rates configured yet.</p>
          <p className="text-xs mt-1">Run the database migration to seed default UAE market rates.</p>
        </div>
      )}
    </div>
  );
}
