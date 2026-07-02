'use client';

import { useEffect, useRef, useState } from 'react';
import { FolderPlus, ChevronDown, Plus, Loader2, Check } from 'lucide-react';
import { useToast } from '@/contexts/toast-context';

export type FolderDescriptor =
  | { source: 'bid'; projectId: string }
  | { source: 'email'; threadId?: string | null; messageId?: string | null };

interface Folder {
  id: string;
  name: string;
  item_count?: number;
}

/**
 * Small "Add to folder ▾" dropdown. Lists Project-Master folders, lets the
 * user pick one (or create a new one inline), and files the given source
 * descriptor into it via POST /api/folders/[id]/items. Reused on the Bid
 * List rows and the Inbox email header.
 */
export default function AddToFolderMenu({
  descriptor,
  compact = false,
  className = '',
}: {
  descriptor: FolderDescriptor;
  compact?: boolean;
  className?: string;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const loadFolders = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/folders');
      const data = await res.json();
      setFolders(data.folders || []);
    } catch {
      setFolders([]);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const next = !open;
    setOpen(next);
    if (next && folders.length === 0) loadFolders();
  };

  const addToFolder = async (folder: Folder) => {
    setBusyId(folder.id);
    try {
      const res = await fetch(`/api/folders/${folder.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(descriptor),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.details || data.error || 'Failed');
      const n = data.added ?? 0;
      toast(
        n > 0 ? `Added ${n} item${n > 1 ? 's' : ''} to "${folder.name}"` : `Already in "${folder.name}"`,
        n > 0 ? 'success' : 'info',
        { label: 'Open', href: `/master/${folder.id}` }
      );
      setOpen(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to add', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const createAndAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.details || data.error || 'Failed');
      setNewName('');
      setFolders((f) => [data.folder, ...f]);
      await addToFolder(data.folder);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create folder', 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={`relative inline-block ${className}`} ref={ref}>
      <button
        onClick={toggle}
        title="Add to a Project Master folder"
        className={`inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors ${
          compact ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'
        }`}
      >
        <FolderPlus className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        {!compact && 'Add to folder'}
        <ChevronDown className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-1 w-60 rounded-lg border border-gray-200 bg-white shadow-lg py-1"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Add to folder
          </div>

          <div className="max-h-56 overflow-y-auto">
            {loading ? (
              <div className="px-3 py-3 flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : folders.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400">No folders yet — create one below.</div>
            ) : (
              folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => addToFolder(f)}
                  disabled={busyId === f.id}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  <span className="truncate">{f.name}</span>
                  {busyId === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" /> : <Check className="h-3.5 w-3.5 text-transparent" />}
                </button>
              ))
            )}
          </div>

          <form onSubmit={createAndAdd} className="border-t border-gray-100 mt-1 p-2 flex items-center gap-1">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New folder name"
              className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
