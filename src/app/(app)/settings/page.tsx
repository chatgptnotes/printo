'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Mail, MessageSquare, Percent, Building2, Globe, Tag, Plus, X, Save, Reply, Pencil, Trash2, ChevronDown, ChevronRight, Check, ArrowRight } from 'lucide-react';

export default function SettingsPage() {

  // Reply templates state
  const [templates, setTemplates] = useState<{ key: string; label: string; emoji: string; body: string; attachBoq?: boolean }[]>([]);
  const [tplLoading, setTplLoading] = useState(true);
  const [tplSaving, setTplSaving] = useState(false);
  const [tplMessage, setTplMessage] = useState('');
  const [tplSource, setTplSource] = useState('');
  const [editingTpl, setEditingTpl] = useState<string | null>(null);
  const [addingTpl, setAddingTpl] = useState(false);
  const [newTpl, setNewTpl] = useState({ key: '', label: '', emoji: '📧', body: '', attachBoq: false });

  useEffect(() => {
    fetch('/api/reply-templates')
      .then(r => r.json())
      .then(data => {
        setTemplates(data.templates || []);
        setTplSource(data.source || 'defaults');
        setTplLoading(false);
      })
      .catch(() => setTplLoading(false));
  }, []);

  const saveTemplates = async () => {
    setTplSaving(true);
    setTplMessage('');
    try {
      const res = await fetch('/api/reply-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates }),
      });
      const data = await res.json();
      if (data.saved) {
        setTplMessage('Templates saved');
        setTplSource('database');
      } else {
        setTplMessage(data.error || 'Failed to save');
      }
    } catch {
      setTplMessage('Failed to save templates');
    }
    setTplSaving(false);
  };

  const addTemplate = () => {
    if (!newTpl.key || !newTpl.label || !newTpl.body) return;
    setTemplates([...templates, { ...newTpl }]);
    setNewTpl({ key: '', label: '', emoji: '📧', body: '', attachBoq: false });
    setAddingTpl(false);
  };

  const removeTemplate = (key: string) => {
    if (!confirm(`Delete template "${key}"?`)) return;
    setTemplates(templates.filter(t => t.key !== key));
  };

  const updateTemplate = (key: string, updates: Partial<typeof newTpl>) => {
    setTemplates(templates.map(t => t.key === key ? { ...t, ...updates } : t));
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Pipeline configuration</p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Gmail Config */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm shadow-slate-900/5">
          <div className="flex items-center gap-2 mb-4">
            <Mail className="h-5 w-5 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-800">Gmail Account</h2>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500">Monitored Account</label>
              <p className="text-sm font-medium text-gray-900">{process.env.NEXT_PUBLIC_GMAIL_ACCOUNT || 'chatgptnotes@gmail.com'}</p>
            </div>
            <div>
              <label className="text-xs text-gray-500">Target Email</label>
              <p className="text-sm font-medium text-gray-900">estimation@realsoft.example</p>
              <p className="text-[10px] text-gray-400">Only emails addressed to this are processed</p>
            </div>
            <div>
              <label className="text-xs text-gray-500">Polling Interval</label>
              <p className="text-sm text-gray-600">Every 5 minutes (Vercel Cron)</p>
            </div>
          </div>
        </div>

        {/* WhatsApp Config */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm shadow-slate-900/5">
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare className="h-5 w-5 text-green-600" />
            <h2 className="text-sm font-semibold text-slate-800">WhatsApp Notifications</h2>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500">Notification Number</label>
              <p className="text-sm font-medium text-gray-900">+919373111709</p>
            </div>
            <div>
              <label className="text-xs text-gray-500">Method</label>
              <p className="text-sm text-gray-600">OpenClaw CLI</p>
            </div>
            <div>
              <label className="text-xs text-gray-500">Trigger</label>
              <p className="text-sm text-gray-600">New RFQ email detected</p>
            </div>
          </div>
        </div>

        {/* Estimation Defaults */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm shadow-slate-900/5">
          <div className="flex items-center gap-2 mb-4">
            <Percent className="h-5 w-5 text-teal-600" />
            <h2 className="text-sm font-semibold text-slate-800">Estimation Defaults</h2>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500">Default Margin</label>
              <p className="text-sm font-medium text-gray-900">15%</p>
            </div>
            <div>
              <label className="text-xs text-gray-500">AI Model</label>
              <p className="text-sm text-gray-600">Anthropic Claude Sonnet 4.6 (classification, extraction, MEP analysis)</p>
            </div>
            <div>
              <label className="text-xs text-gray-500">Pricing Modes</label>
              <p className="text-sm text-gray-600">Fast (AED/sqft) + Detailed (Claude component analysis)</p>
            </div>
          </div>
        </div>

        {/* Company Info */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm shadow-slate-900/5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="h-5 w-5 text-indigo-600" />
            <h2 className="text-sm font-semibold text-slate-800">ERP Realsoft Company</h2>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500">Address</label>
              <p className="text-sm text-gray-600">Company address will be configured before production launch.</p>
            </div>
            <div>
              <label className="text-xs text-gray-500">Website</label>
              <p className="text-sm text-gray-600">realsoft.example</p>
            </div>
            <div>
              <label className="text-xs text-gray-500">Technical Director</label>
              <p className="text-sm text-gray-600">ERP Realsoft Administrator</p>
            </div>
          </div>
        </div>
      </div>

      {/* RFQ Keywords — link to master page */}
      <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm shadow-slate-900/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-amber-600" />
            <div>
              <h2 className="text-sm font-semibold text-slate-800">RFQ Detection Keywords</h2>
              <p className="text-xs text-gray-400 mt-0.5">Manage keywords used for email classification. All emails are verified by AI.</p>
            </div>
          </div>
          <Link href="/keywords" className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-sky-600 transition-all duration-200 hover:bg-sky-50 hover:text-sky-800">
            Open Keyword Manager <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Reply Templates Management */}
      <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm shadow-slate-900/5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Reply className="h-5 w-5 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-800">Reply Templates</h2>
            <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              {tplSource === 'database' ? 'Custom' : 'Default'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAddingTpl(!addingTpl)}
              className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all duration-200 hover:bg-slate-200"
            >
              <Plus className="h-3.5 w-3.5" /> Add Template
            </button>
            <button
              onClick={saveTemplates}
              disabled={tplSaving}
              className="flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white transition-all duration-200 hover:bg-sky-600 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {tplSaving ? 'Saving...' : 'Save Templates'}
            </button>
          </div>
        </div>

        <p className="text-xs text-gray-400 mb-3">
          Email reply templates used in the project reply modal. Use placeholders: {'{project_name}'}, {'{client_name}'}, {'{quote_amount}'}, {'{service_list}'}, {'{area}'}, {'{location}'}, {'{sent_date}'}
        </p>

        {tplMessage && (
          <div className="text-xs text-green-600 bg-green-50 px-3 py-1.5 rounded-lg mb-3">{tplMessage}</div>
        )}

        {/* Add template form */}
        {addingTpl && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 space-y-3">
            <h3 className="text-sm font-semibold text-blue-800">New Template</h3>
            <div className="grid grid-cols-3 gap-3">
              <input placeholder="Key (e.g. revision)" value={newTpl.key} onChange={e => setNewTpl({ ...newTpl, key: e.target.value.toLowerCase().replace(/\s/g, '_') })}
                className="px-3 py-2 border rounded-lg text-sm" />
              <input placeholder="Label (e.g. Request Revision)" value={newTpl.label} onChange={e => setNewTpl({ ...newTpl, label: e.target.value })}
                className="px-3 py-2 border rounded-lg text-sm" />
              <input placeholder="Emoji (e.g. 📝)" value={newTpl.emoji} onChange={e => setNewTpl({ ...newTpl, emoji: e.target.value })}
                className="px-3 py-2 border rounded-lg text-sm" />
            </div>
            <textarea placeholder="Email body template... Use {project_name}, {client_name}, etc." value={newTpl.body}
              onChange={e => setNewTpl({ ...newTpl, body: e.target.value })} rows={6}
              className="w-full px-3 py-2 border rounded-lg text-sm font-mono resize-none" />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={newTpl.attachBoq} onChange={e => setNewTpl({ ...newTpl, attachBoq: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600" />
                Auto-attach BOQ
              </label>
              <div className="flex gap-2">
                <button onClick={() => setAddingTpl(false)} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={addTemplate} disabled={!newTpl.key || !newTpl.label || !newTpl.body}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Templates list */}
        {tplLoading ? (
          <p className="text-xs text-gray-400">Loading templates...</p>
        ) : (
          <div className="space-y-2">
            {templates.map(tpl => (
              <div key={tpl.key} className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{tpl.emoji}</span>
                    {editingTpl === tpl.key ? (
                      <input value={tpl.label} onChange={e => updateTemplate(tpl.key, { label: e.target.value })}
                        className="px-2 py-1 border rounded text-sm font-medium" />
                    ) : (
                      <span className="text-sm font-medium text-gray-800">{tpl.label}</span>
                    )}
                    <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{tpl.key}</span>
                    {tpl.attachBoq && <span className="text-[10px] text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">+BOQ</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    {editingTpl === tpl.key ? (
                      <button onClick={() => setEditingTpl(null)} className="p-1 text-green-600 hover:bg-green-50 rounded">
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button onClick={() => setEditingTpl(tpl.key)} className="p-1 text-gray-400 hover:bg-gray-100 rounded">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button onClick={() => removeTemplate(tpl.key)} className="p-1 text-red-400 hover:bg-red-50 rounded">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {editingTpl === tpl.key && (
                  <div className="p-4 space-y-2">
                    <div className="flex items-center gap-3">
                      <input placeholder="Emoji" value={tpl.emoji} onChange={e => updateTemplate(tpl.key, { emoji: e.target.value })}
                        className="w-16 px-2 py-1 border rounded text-sm text-center" />
                      <label className="flex items-center gap-2 text-xs text-gray-600">
                        <input type="checkbox" checked={tpl.attachBoq || false} onChange={e => updateTemplate(tpl.key, { attachBoq: e.target.checked })}
                          className="rounded border-gray-300 text-blue-600" />
                        Auto-attach BOQ
                      </label>
                    </div>
                    <textarea value={tpl.body} onChange={e => updateTemplate(tpl.key, { body: e.target.value })} rows={8}
                      className="w-full px-3 py-2 border rounded-lg text-sm font-mono resize-none" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="text-[10px] text-gray-400 mt-3">{templates.length} templates. Click edit to modify body text. Remember to Save Templates after changes.</p>
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-slate-50/90 p-5 shadow-sm shadow-slate-900/5">
        <div className="flex items-center gap-2 mb-2">
          <Globe className="h-5 w-5 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-700">System Info</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Version:</span>
            <span className="ml-2 font-medium">1.0.0</span>
          </div>
          <div>
            <span className="text-gray-500">Environment:</span>
            <span className="ml-2 font-medium">{process.env.NODE_ENV || 'production'}</span>
          </div>
          <div>
            <span className="text-gray-500">Domain:</span>
            <span className="ml-2 font-medium">realsoft.example</span>
          </div>
          <div>
            <span className="text-gray-500">Platform:</span>
            <span className="ml-2 font-medium">Vercel</span>
          </div>
        </div>
      </div>
    </div>
  );
}
