'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-10">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.16),transparent_32rem),linear-gradient(135deg,#f8fafc_0%,#eef2f7_48%,#e0f2fe_100%)]" />
      <div className="w-full max-w-md rounded-2xl border border-white/70 bg-white/90 p-8 text-center shadow-xl shadow-slate-900/10 backdrop-blur">
        <div className="mb-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
            <Lock className="h-7 w-7 text-slate-500" />
          </div>
        </div>
        <h2 className="text-xl font-bold text-slate-950 mb-2">Registration Disabled</h2>
        <p className="text-sm leading-6 text-slate-500 mb-6">
          New account registration is not available. Contact your administrator for access.
        </p>
        <Link
          href="/auth/login"
          className="inline-flex rounded-xl bg-slate-950 px-6 py-2.5 text-sm font-semibold text-white shadow-sm shadow-slate-900/20 transition-all duration-200 hover:bg-sky-600"
        >
          Back to Login
        </Link>
      </div>
    </div>
  );
}
