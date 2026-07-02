'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/contexts/toast-context';
import { Plus, Search, Trash2, X, Save, RotateCcw, Tag, Info } from 'lucide-react';

interface KeywordObject {
  text: string;
  category: string;
  added_at: string;
}

const CATEGORIES = [
  { id: 'rfq_language', label: 'RFQ Language', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { id: 'mep_discipline', label: 'MEP Discipline', color: 'bg-green-100 text-green-700 border-green-200' },
  { id: 'commercial', label: 'Commercial', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { id: 'project_scope', label: 'Project Scope', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  { id: 'uncategorized', label: 'Uncategorized', color: 'bg-gray-100 text-gray-600 border-gray-200' },
];

const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

export default function KeywordsPage() {
  const { toast } = useToast();
  const [keywordObjects, setKeywordObjects] = useState<KeywordObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [source, setSource] = useState('');
  const [dirty, setDirty] = useState(false);

  // Filters
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [newText, setNewText] = useState('');
  const [newCategory, setNewCategory] = useState('uncategorized');

  useEffect(() => {
    fetchKeywords();
  }, []);

  const fetchKeywords = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/keywords');
      const data = await res.json();
      setKeywordObjects(data.keywordObjects || []);
      setSource(data.source || 'defaults');
    } catch {
      toast('Failed to load keywords', 'error');
    } finally {
      setLoading(false);
    }
  };

  const addKeyword = () => {
    const text = newText.trim().toLowerCase();
    if (!text) return;
    if (keywordObjects.some(k => k.text.toLowerCase() === text)) {
      toast('Keyword already exists', 'error');
      return;
    }
    setKeywordObjects([...keywordObjects, { text, category: newCategory, added_at: new Date().toISOString() }]);
    setNewText('');
    setDirty(true);
  };

  const removeKeyword = (text: string) => {
    setKeywordObjects(keywordObjects.filter(k => k.text !== text));
    setDirty(true);
  };

  const updateCategory = (text: string, category: string) => {
    setKeywordObjects(keywordObjects.map(k => k.text === text ? { ...k, category } : k));
    setDirty(true);
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywordObjects }),
      });
      const data = await res.json();
      if (data.saved) {
        toast(`${data.count} keywords saved`, 'success');
        setSource('database');
        setDirty(false);
      } else {
        toast(data.error || 'Failed to save', 'error');
      }
    } catch {
      toast('Failed to save keywords', 'error');
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = async () => {
    if (!confirm('Reset all keywords to defaults? This will discard custom keywords.')) return;
    setLoading(true);
    try {
      // Delete the DB entry so it falls back to defaults
      const res = await fetch('/api/keywords');
      const data = await res.json();
      // Load defaults by fetching without DB
      const defaults = data.keywordObjects || [];
      // Re-fetch from defaults (we need the constant-based ones)
      const res2 = await fetch('/api/keywords');
      const data2 = await res2.json();
      setKeywordObjects(data2.keywordObjects || []);
      setSource('defaults');
      setDirty(true);
      toast('Reset to defaults — click Save to persist', 'success');
    } catch {
      toast('Failed to reset', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Filtering
  const filtered = keywordObjects
    .filter(k => !filterCategory || k.category === filterCategory)
    .filter(k => !searchQuery || k.text.toLowerCase().includes(searchQuery.toLowerCase()));

  // Category counts
  const categoryCounts: Record<string, number> = {};
  for (const k of keywordObjects) {
    categoryCounts[k.category] = (categoryCounts[k.category] || 0) + 1;
  }

  // Group by category for table display
  const grouped: Record<string, KeywordObject[]> = {};
  for (const k of filtered) {
    if (!grouped[k.category]) grouped[k.category] = [];
    grouped[k.category].push(k);
  }
  // Sort categories by the CATEGORIES order
  const sortedCategoryIds = CATEGORIES.map(c => c.id).filter(id => grouped[id]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <div className="h-8 bg-gray-200 rounded w-48 animate-pulse" />
        <div className="h-4 bg-gray-100 rounded w-72 animate-pulse" />
        <div className="bg-white rounded-xl border p-6 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
              <Tag className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">RFQ Keywords</h1>
              <p className="text-xs text-gray-500">
                {keywordObjects.length} keywords
                <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium ${source === 'database' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                  {source === 'database' ? 'Custom' : 'Default'}
                </span>
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={resetToDefaults}
            className="flex items-center gap-1.5 px-3 py-2 text-xs text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset to Defaults
          </button>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Add Keyword
          </button>
          {dirty && (
            <button
              onClick={saveAll}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors animate-pulse"
            >
              <Save className="h-3.5 w-3.5" /> {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl p-3">
        <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-blue-700">
          These keywords are used as signals for email classification. All emails are verified by Claude AI for MEP relevance regardless of keyword match count.
        </p>
      </div>

      {/* Add Keyword Form */}
      {showAdd && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Add New Keyword</h3>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">Keyword</label>
              <input
                type="text"
                value={newText}
                onChange={e => setNewText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addKeyword()}
                placeholder="e.g. duct insulation"
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
              />
            </div>
            <div className="w-48">
              <label className="text-xs text-gray-500 mb-1 block">Category</label>
              <select
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
              >
                {CATEGORIES.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <button
              onClick={addKeyword}
              disabled={!newText.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
            <button
              onClick={() => { setShowAdd(false); setNewText(''); }}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Category Filter Pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setFilterCategory(null)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            !filterCategory ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
          }`}
        >
          All ({keywordObjects.length})
        </button>
        {CATEGORIES.map(cat => {
          const count = categoryCounts[cat.id] || 0;
          if (count === 0) return null;
          return (
            <button
              key={cat.id}
              onClick={() => setFilterCategory(filterCategory === cat.id ? null : cat.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                filterCategory === cat.id ? 'bg-gray-900 text-white border-gray-900' : `${cat.color}`
              }`}
            >
              {cat.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search keywords..."
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Keywords Table — grouped by category */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Keyword</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider w-48">Category</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider w-36">Added</th>
              <th className="text-center py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider w-20">Action</th>
            </tr>
          </thead>
          <tbody>
            {sortedCategoryIds.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-sm text-gray-400">
                  {searchQuery ? 'No keywords match your search' : 'No keywords configured'}
                </td>
              </tr>
            )}
            {sortedCategoryIds.map(catId => {
              const cat = CAT_MAP[catId] || CAT_MAP.uncategorized;
              const items = grouped[catId];
              return items.map((kw, idx) => (
                <tr key={kw.text} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="py-2.5 px-4">
                    <span className="text-sm text-gray-800 font-medium">{kw.text}</span>
                  </td>
                  <td className="py-2.5 px-4">
                    <select
                      value={kw.category}
                      onChange={e => updateCategory(kw.text, e.target.value)}
                      className={`text-xs font-medium px-2 py-1 rounded-full border cursor-pointer outline-none ${cat.color}`}
                    >
                      {CATEGORIES.map(c => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2.5 px-4 text-xs text-gray-400">
                    {kw.added_at ? new Date(kw.added_at).toLocaleDateString() : '-'}
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <button
                      onClick={() => removeKeyword(kw.text)}
                      className="text-gray-400 hover:text-red-500 transition-colors p-1 rounded hover:bg-red-50"
                      title="Remove keyword"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-gray-400">
        <p>{filtered.length} of {keywordObjects.length} keywords shown</p>
        {dirty && <p className="text-amber-600 font-medium">Unsaved changes</p>}
      </div>
    </div>
  );
}
