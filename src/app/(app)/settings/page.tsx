'use client';

import { Database, FileUp, ShieldCheck, Sparkles } from 'lucide-react';

const settings = [
  {
    label: 'Direct Upload Intake',
    value: 'Enabled',
    detail: 'Users create projects and upload drawings, schedules, specifications, and archives directly.',
    icon: FileUp,
  },
  {
    label: 'AI Extraction',
    value: 'Fresh per upload',
    detail: 'Each extraction reads the current uploaded files and keeps estimator review mandatory.',
    icon: Sparkles,
  },
  {
    label: 'Storage',
    value: 'Supabase private bucket',
    detail: 'Project files are stored in the private sabi-attachments bucket.',
    icon: Database,
  },
  {
    label: 'Email Integration',
    value: 'Removed',
    detail: 'Gmail sync, inbox polling, reply templates, and email sending are disabled.',
    icon: ShieldCheck,
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Direct upload BOQ workflow configuration</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {settings.map((item) => (
          <div key={item.label} className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm shadow-slate-900/5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                <item.icon className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-800">{item.label}</h2>
                <p className="mt-1 text-sm font-bold text-slate-950">{item.value}</p>
                <p className="mt-2 text-xs leading-5 text-slate-500">{item.detail}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
