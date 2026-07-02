'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import Link from 'next/link';
import { Eye, EyeOff, Zap } from 'lucide-react';

const IS_DEV = process.env.NODE_ENV !== 'production';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [devLoading, setDevLoading] = useState(false);
  const { login } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDevLogin = async () => {
    if (!IS_DEV) return;
    setError('');
    setDevLoading(true);

    try {
      await fetch('/api/auth/seed-admin', { method: 'POST' });
      await login('admin@sabi.ae', 'sabi2024');
    } catch (err: any) {
      setError(err.message || 'Dev login failed');
    } finally {
      setDevLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-10">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.16),transparent_32rem),linear-gradient(135deg,#f8fafc_0%,#eef2f7_48%,#e0f2fe_100%)]" />
      <div className="w-full max-w-md rounded-2xl border border-white/70 bg-white/90 p-8 shadow-xl shadow-slate-900/10 backdrop-blur">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">ERP Realsoft</h1>
          <p className="mt-1 text-sm text-slate-500">RFQ-to-BOQ Pipeline</p>
        </div>

        {/* Dev Quick Login — hidden in production */}
        {IS_DEV && (
          <>
            <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
              <p className="text-xs text-amber-700 font-medium mb-2">Development Mode</p>
              <button
                onClick={handleDevLogin}
                disabled={devLoading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-2.5 text-sm font-semibold text-white shadow-sm shadow-amber-900/10 transition-all duration-200 hover:bg-amber-600 disabled:opacity-50"
              >
                <Zap className="w-4 h-4" />
                {devLoading ? 'Signing in...' : 'Quick Login as Admin'}
              </button>
            </div>

            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-2 text-slate-400">or login manually</span>
              </div>
            </div>
          </>
        )}

        {error && (
          <div className="mb-4 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-slate-900 shadow-sm transition-all duration-200 focus:border-sky-500 focus:outline-none focus:ring-4 focus:ring-sky-100"
              required
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-2">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 pr-12 text-slate-900 shadow-sm transition-all duration-200 focus:border-sky-500 focus:outline-none focus:ring-4 focus:ring-sky-100"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none"
              >
                {showPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-slate-950 py-2.5 font-semibold text-white shadow-sm shadow-slate-900/20 transition-all duration-200 hover:bg-sky-600 disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <p className="text-center mt-5 text-slate-400 text-xs">
          Contact your administrator for access.
        </p>
      </div>
    </div>
  );
}
