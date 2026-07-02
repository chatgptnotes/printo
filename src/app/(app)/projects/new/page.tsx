'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Building2, Zap, Loader2 } from 'lucide-react';

const BUILDING_TYPES = [
  'Residential',
  'Commercial',
  'Mixed Use',
  'Industrial',
  'Healthcare',
  'Hospitality',
  'Educational',
  'Government',
  'Retail',
  'Warehouse',
  'Other',
];

export default function NewProjectPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    project_name: '',
    client_name: '',
    building_type: '',
    floors: '',
    total_area_sqft: '',
    consultant: '',
    location: '',
  });

  const set = (field: string, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (form.floors && (isNaN(Number(form.floors)) || Number(form.floors) < 1)) {
      setError('Number of floors must be a valid number');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_name: form.project_name.trim() || null,
          client_name: form.client_name.trim() || null,
          building_type: form.building_type || null,
          floors: form.floors ? Number(form.floors) : null,
          total_area_sqft: form.total_area_sqft ? Number(form.total_area_sqft) : null,
          consultant: form.consultant.trim() || null,
          location: form.location.trim() || null,
          status: 'pending',
          priority: 'new',
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create project');
      }

      const data = await res.json();
      const projectId = data.project?.id;
      if (!projectId) throw new Error('No project ID returned');
      router.push(`/bids/${projectId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link href="/bids" className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">New Electrical Project</h1>
              <p className="text-xs text-gray-400">Manual project entry — upload drawings after creation</p>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-medium text-gray-300">Project Details</span>
            </div>

            <Field label="Project Name">
              <input
                type="text"
                value={form.project_name}
                onChange={e => set('project_name', e.target.value)}
                placeholder="e.g. Al Reem Tower — Electrical Works"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </Field>

            <Field label="Client Name">
              <input
                type="text"
                value={form.client_name}
                onChange={e => set('client_name', e.target.value)}
                placeholder="e.g. Al Reem Real Estate LLC"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Building Type">
                <select
                  value={form.building_type}
                  onChange={e => set('building_type', e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">Select type</option>
                  {BUILDING_TYPES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>

              <Field label="Number of Floors">
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={form.floors}
                  onChange={e => set('floors', e.target.value)}
                  placeholder="e.g. 12"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Total Area (sqft)">
                <input
                  type="number"
                  min="0"
                  value={form.total_area_sqft}
                  onChange={e => set('total_area_sqft', e.target.value)}
                  placeholder="e.g. 45000"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </Field>

              <Field label="Consultant">
                <input
                  type="text"
                  value={form.consultant}
                  onChange={e => set('consultant', e.target.value)}
                  placeholder="e.g. KEO International"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </Field>
            </div>

            <Field label="Location">
              <input
                type="text"
                value={form.location}
                onChange={e => set('location', e.target.value)}
                placeholder="e.g. Al Reem Island, Abu Dhabi"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </Field>
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <Link
              href="/bids"
              className="flex-1 text-center py-2.5 rounded-lg border border-gray-700 text-sm text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-sm font-medium transition-colors"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating…
                </>
              ) : (
                'Create Project'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-gray-400">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
