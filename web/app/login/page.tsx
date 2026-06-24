"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!identifier.trim() || !password) {
      setError("Enter your user ID / email and password.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), password, remember }),
      });
      if (r.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      if (r.status === 429) setError("Too many attempts. Please wait and try again.");
      else setError("Invalid credentials.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 shadow-hero">
        <div className="mb-6 text-center">
          <div className="text-2xl font-black tracking-wide">
            ERP <span className="text-accent-orange">RealSoft</span>
          </div>
          <p className="mt-1 text-sm text-muted">
            AI Drawing-to-ERP Compliance Gateway
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">
              User ID or Email
            </label>
            <input
              className="w-full rounded-[10px] border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none focus:border-accent-orange"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">
              Password
            </label>
            <input
              type={showPw ? "text" : "password"}
              className="w-full rounded-[10px] border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none focus:border-accent-orange"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-muted">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showPw}
                onChange={(e) => setShowPw(e.target.checked)}
              />
              Show password
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Remember me
            </label>
          </div>

          {error && (
            <p className="rounded-[10px] border border-result-fail/40 bg-result-fail/10 px-3 py-2 text-sm text-[#fca5a5]">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" fullWidth disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
