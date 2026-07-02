'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Folder, FolderPlus, Plus, Loader2, FileText } from 'lucide-react';
import { useToast } from '@/contexts/toast-context';

interface FolderItem {
  id: string;
  name: string;
  description: string | null;
  item_count: number;
  updated_at: string;
}

export default function ProjectMasterPage() {
  const { toast } = useToast();
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchFolders = async () => {
    try {
      const res = await fetch('/api/folders');
      const data = await res.json();
      setFolders(data.folders || []);
    } catch {
      /* not connected */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFolders();
  }, []);

  const createFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.details || data.error || 'Failed');
      setFolders((f) => [data.folder, ...f]);
      setName('');
      setDescription('');
      setShowForm(false);
      toast(`Folder "${data.folder.name}" created`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create folder', 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Project Master</h1>
          <p className="text-sm text-gray-500 mt-1">
            {folders.length} folder{folders.length !== 1 ? 's' : ''} — one place for each project&apos;s drawings, mail, and BOQ
          </p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-2 px-3 py-2 text-sm font-bold bg-gradient-to-r from-emerald-600 to-green-600 text-white rounded-lg hover:from-emerald-700 hover:to-green-700 shadow-md shadow-emerald-200 transition-all"
        >
          <Plus className="h-4 w-4" /> New Folder
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={createFolder} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-end">
          <div className="flex-1 w-full">
            <label className="block text-xs font-medium text-gray-500 mb-1">Folder name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Marina Tower"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex-1 w-full">
            <label className="block text-xs font-medium text-gray-500 mb-1">Description (optional)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short note"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />} Create
          </button>
        </form>
      )}

      {/* Folder grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 bg-gray-100 rounded-xl border border-gray-100 animate-pulse" />
          ))}
        </div>
      ) : folders.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
          <Folder className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No folders yet.</p>
          <button onClick={() => setShowForm(true)} className="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium">
            Create your first folder
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {folders.map((f) => (
            <Link
              key={f.id}
              href={`/master/${f.id}`}
              className="group bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-md transition-all"
            >
              <div className="flex items-start gap-3">
                <div className="p-2 bg-amber-50 rounded-lg">
                  <Folder className="h-6 w-6 text-amber-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-gray-900 truncate group-hover:text-blue-600">{f.name}</h3>
                  {f.description && <p className="text-xs text-gray-500 truncate mt-0.5">{f.description}</p>}
                  <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                    <FileText className="h-3.5 w-3.5" />
                    {f.item_count} item{f.item_count !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
