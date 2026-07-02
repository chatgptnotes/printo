'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import {
  LayoutDashboard,
  FileText,
  Ruler,
  Settings,
  LogOut,
  Menu,
  X,
  Building2,
  BookOpen,
  FolderTree,
  Moon,
  Sun,
  Tag,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useTheme } from '@/contexts/theme-context';
import NotificationBell from './notification-bell';

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  comingSoon?: boolean;
}

const navItems: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/bids', label: 'Projects', icon: FileText },
  { href: '/keywords', label: 'RFQ Rules', icon: Tag },
  { href: '/yardstick', label: 'Yardstick Rates', icon: Ruler },
  { href: '/price-library', label: 'Price Library', icon: BookOpen },
  { href: '/master', label: 'Document Master', icon: FolderTree },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout, loading } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Desktop-only collapse to an icon rail; persisted so it survives reloads.
  // Initialised after mount (not in useState) to avoid an SSR/CSR hydration mismatch.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setCollapsed(localStorage.getItem('sidebarCollapsed') === '1'); }, []);
  const toggleCollapsed = () => setCollapsed((c) => {
    const next = !c;
    localStorage.setItem('sidebarCollapsed', next ? '1' : '0');
    return next;
  });

  const isAuthPage = pathname?.startsWith('/auth');
  // Public marketing pages render without the app sidebar. /landing is always
  // public; '/' is the landing page only when unauthenticated.
  const isLandingPage = pathname === '/landing' || (pathname === '/' && !user);
  if (isAuthPage || loading || isLandingPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#eef2f8]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-[#103b7e] text-white transform transition-all duration-200 ease-in-out shadow-2xl shadow-slate-950/20 ${
          collapsed ? 'lg:w-16' : 'lg:w-64'
        } ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Logo */}
        <div className={`flex items-center gap-3 py-5 border-b border-white/10 px-5 ${collapsed ? 'lg:px-0 lg:justify-center' : ''}`}>
          <div className={`h-9 w-9 rounded-lg bg-[#1b5fc4] flex items-center justify-center shadow-lg shadow-blue-950/20 ${collapsed ? 'lg:hidden' : ''}`}>
            <Building2 className="h-5 w-5 text-white flex-shrink-0" />
          </div>
          <div className={collapsed ? 'lg:hidden' : ''}>
            <div className="text-base font-bold tracking-tight">ERP Realsoft</div>
            <p className="text-xs text-blue-100">AI BOQ workspace</p>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto lg:hidden text-gray-400 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
          {/* Desktop collapse toggle */}
          <button
            onClick={toggleCollapsed}
            className={`hidden lg:flex text-gray-400 hover:text-white ${collapsed ? '' : 'ml-auto'}`}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const isActive =
              item.href === '/'
                ? pathname === '/'
                : pathname?.startsWith(item.href);

            if (item.comingSoon) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  title={collapsed ? item.label : undefined}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                    collapsed ? 'lg:justify-center' : ''
                  } ${
                    isActive
                      ? 'bg-[#1b4a92] text-white shadow-sm'
                      : 'text-blue-100/80 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <item.icon className="h-5 w-5 flex-shrink-0" />
                  <span className={collapsed ? 'lg:hidden' : ''}>{item.label}</span>
                  <span className={`ml-auto text-[9px] font-bold bg-white/10 text-slate-400 px-1.5 py-0.5 rounded ${collapsed ? 'lg:hidden' : ''}`}>
                    SOON
                  </span>
                </Link>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  collapsed ? 'lg:justify-center' : ''
                } ${
                  isActive
                    ? 'bg-[#1b4a92] text-white shadow-sm shadow-black/10'
                    : 'text-blue-100/85 hover:bg-white/10 hover:text-white'
                }`}
              >
                <item.icon className="h-5 w-5 flex-shrink-0" />
                <span className={collapsed ? 'lg:hidden' : ''}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        {user && (
          <div className="px-3 py-4 border-t border-white/10 pb-safe">
            <div className={`px-3 py-2 text-sm text-gray-400 truncate ${collapsed ? 'lg:hidden' : ''}`}>
              {user.email}
            </div>
            <div className={`flex items-center gap-2 ${collapsed ? 'lg:flex-col' : ''}`}>
              <button
                onClick={toggleTheme}
              className={`flex items-center gap-2 flex-1 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-all duration-200 ${collapsed ? 'lg:justify-center' : ''}`}
                title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              >
                {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                <span className={collapsed ? 'lg:hidden' : ''}>{theme === 'light' ? 'Dark' : 'Light'}</span>
              </button>
              <button
                onClick={logout}
                className={`flex items-center gap-2 flex-1 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-all duration-200 ${collapsed ? 'lg:justify-center' : ''}`}
                title="Sign Out"
              >
                <LogOut className="h-4 w-4" />
                <span className={collapsed ? 'lg:hidden' : ''}>Sign Out</span>
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-[#e3e9f2] px-4 py-3.5 flex items-center gap-4 lg:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-gray-600 hover:text-gray-900"
          >
            <Menu className="h-6 w-6" />
          </button>
          <div className="flex-1">
            <h2 className="text-sm font-medium text-gray-500">
              {navItems.find(item => item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href))?.label || 'ERP Realsoft'}
            </h2>
          </div>
          <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-1 text-[10px] text-gray-400 bg-gray-100 rounded border border-gray-200 font-mono cursor-pointer hover:bg-gray-200"
            onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}>
            ⌘K
          </kbd>
          <NotificationBell />
          <div className="text-xs text-gray-400">
            v0.1.0
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-5 lg:p-7">
          {children}
        </main>
      </div>
    </div>
  );
}
