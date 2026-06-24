"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePrintoStore } from "@/lib/store";
import type { CurrentUser, Health } from "@/lib/types";
import { Button } from "@/components/ui/Button";

function Logo() {
  return (
    <div className="text-xl font-black tracking-wide">
      ERP <span className="text-accent-orange">RealSoft</span>
    </div>
  );
}

function HealthWidget() {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let on = true;
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => on && setH(d))
      .catch(() => on && setErr(true));
    return () => {
      on = false;
    };
  }, []);
  if (err) return <p className="text-xs text-result-fail">Backend offline</p>;
  if (!h) return <p className="text-xs text-muted">Checking server…</p>;
  return (
    <div className="space-y-1 text-xs text-muted">
      <p className="text-[#6ee7b7]">● Server online · v{h.version}</p>
      <p>ERP: {h.erp_mode}</p>
      <p>AI: {h.ai_provider} ({h.ai_model})</p>
      <p>
        {h.completed}/{h.total_drawings} drawings done
      </p>
    </div>
  );
}

const NAV = [
  { tab: "Upload", icon: "📤", href: () => "/" },
  { tab: "Results", icon: "📊", href: (id?: number) => (id ? `/results/${id}` : "/results") },
  { tab: "Report", icon: "📄", href: (id?: number) => (id ? `/report/${id}` : "/report") },
  { tab: "History", icon: "🗂️", href: () => "/history" },
];

export function AppShell({
  user,
  children,
}: {
  user: CurrentUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const lastId = usePrintoStore((s) => s.lastResult?.drawing_id);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  function isActive(tab: string) {
    if (tab === "Upload") return pathname === "/";
    return pathname.startsWith(`/${tab.toLowerCase()}`);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-[1280px] gap-6 px-4 py-6">
      <aside className="hidden w-60 shrink-0 flex-col gap-6 md:flex">
        <Logo />

        <nav className="flex flex-col gap-1">
          {NAV.map((n) => {
            const active = isActive(n.tab);
            return (
              <Link
                key={n.tab}
                href={n.href(lastId)}
                className={`flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-accent-orange text-[#0b1326]"
                    : "text-muted hover:bg-surface hover:text-text"
                }`}
              >
                <span>{n.icon}</span>
                {n.tab}
              </Link>
            );
          })}
        </nav>

        <div className="rounded-xl border border-border bg-surface p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-dim">
            Dashboard
          </p>
          <HealthWidget />
        </div>

        <div className="mt-auto rounded-xl border border-border bg-surface p-3">
          <p className="text-sm font-semibold text-text">👤 {user.username}</p>
          <p className="mb-3 text-xs text-muted">{user.role}</p>
          <Button variant="secondary" fullWidth onClick={logout}>
            Log out
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
