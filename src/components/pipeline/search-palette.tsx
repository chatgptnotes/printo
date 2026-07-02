'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, FileText, Mail, Settings, Ruler, BookOpen, Users, ArrowRight } from 'lucide-react';

interface SearchResult {
  id: string;
  label: string;
  sublabel: string;
  href: string;
  type: 'project' | 'page';
}

const PAGES: SearchResult[] = [
  { id: 'dashboard', label: 'Dashboard', sublabel: 'Overview & stats', href: '/', type: 'page' },
  { id: 'bids', label: 'Bid List', sublabel: 'All projects', href: '/bids', type: 'page' },
  { id: 'inbox', label: 'Inbox', sublabel: 'Email management', href: '/inbox', type: 'page' },
  { id: 'clients', label: 'Clients', sublabel: 'Client database', href: '/clients', type: 'page' },
  { id: 'yardstick', label: 'Yardstick Rates', sublabel: 'Market benchmarks', href: '/yardstick', type: 'page' },
  { id: 'price-library', label: 'Price Library', sublabel: 'MEP pricing', href: '/price-library', type: 'page' },
  { id: 'settings', label: 'Settings', sublabel: 'Configuration', href: '/settings', type: 'page' },
];

export default function SearchPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [projects, setProjects] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Cmd+K to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      setQuery('');
      setSelectedIdx(0);
      // Fetch projects for search
      if (projects.length === 0) {
        fetch('/api/projects').then(r => r.json()).then(d => {
          const projs = (d.projects || []).map((p: any) => ({
            id: p.id,
            label: p.project_name || p.email_subject,
            sublabel: p.client_name || p.email_from,
            href: `/bids/${p.id}`,
            type: 'project' as const,
          }));
          setProjects(projs);
        }).catch(() => {});
      }
    }
  }, [open]);

  // Filter results
  useEffect(() => {
    if (!query.trim()) {
      setResults(PAGES);
      setSelectedIdx(0);
      return;
    }
    const q = query.toLowerCase();
    const pageMatches = PAGES.filter(p => p.label.toLowerCase().includes(q) || p.sublabel.toLowerCase().includes(q));
    const projectMatches = projects.filter(p => p.label.toLowerCase().includes(q) || p.sublabel.toLowerCase().includes(q)).slice(0, 8);
    setResults([...pageMatches, ...projectMatches]);
    setSelectedIdx(0);
  }, [query, projects]);

  const navigate = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && results[selectedIdx]) { navigate(results[selectedIdx].href); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]">
      <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <Search className="h-5 w-5 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search projects, pages..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 text-sm outline-none placeholder-gray-400"
          />
          <kbd className="px-1.5 py-0.5 text-[10px] text-gray-400 bg-gray-100 rounded border border-gray-200 font-mono">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">No results</div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.id}
                onClick={() => navigate(r.href)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === selectedIdx ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'
                }`}
              >
                {r.type === 'project' ? <FileText className="h-4 w-4 text-gray-400 flex-shrink-0" /> : <ArrowRight className="h-4 w-4 text-gray-300 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{r.label}</p>
                  <p className="text-[10px] text-gray-400 truncate">{r.sublabel}</p>
                </div>
                {r.type === 'project' && <span className="text-[9px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">Project</span>}
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-gray-100 flex items-center gap-4 text-[10px] text-gray-400">
          <span><kbd className="px-1 py-0.5 bg-gray-100 rounded border border-gray-200 font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="px-1 py-0.5 bg-gray-100 rounded border border-gray-200 font-mono">↵</kbd> open</span>
          <span><kbd className="px-1 py-0.5 bg-gray-100 rounded border border-gray-200 font-mono">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
