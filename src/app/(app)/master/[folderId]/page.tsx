'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, FileText, FileBox, Paperclip, Download, Trash2, Folder as FolderIcon,
} from 'lucide-react';
import { useToast } from '@/contexts/toast-context';

interface Item {
  id: string;
  kind: 'drawing' | 'email_attachment' | 'email' | 'boq';
  label: string;
  size_bytes: number | null;
}

interface FolderDetail {
  id: string;
  name: string;
  description: string | null;
  items: Item[];
}

const GROUPS: { kind: Item['kind']; title: string; icon: React.ElementType }[] = [
  { kind: 'drawing', title: 'Drawings', icon: FileText },
  { kind: 'email_attachment', title: 'Uploaded Attachments', icon: Paperclip },
  { kind: 'boq', title: 'BOQ', icon: FileBox },
];

export default function FolderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const folderId = params.folderId as string;
  const { toast } = useToast();
  const [folder, setFolder] = useState<FolderDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchFolder = useCallback(async () => {
    try {
      const res = await fetch(`/api/folders/${folderId}`);
      const data = await res.json();
      if (res.ok) setFolder(data.folder);
    } catch {
      /* not connected */
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    fetchFolder();
  }, [fetchFolder]);

  const removeItem = async (itemId: string) => {
    setFolder((f) => (f ? { ...f, items: f.items.filter((i) => i.id !== itemId) } : f));
    try {
      await fetch(`/api/folders/${folderId}/items/${itemId}`, { method: 'DELETE' });
    } catch {
      toast('Failed to remove item', 'error');
      fetchFolder();
    }
  };

  const deleteFolder = async () => {
    if (!confirm('Delete this folder? The files themselves are not deleted — only this folder and its references.')) return;
    try {
      const res = await fetch(`/api/folders/${folderId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast('Folder deleted', 'success');
      router.push('/master');
    } catch {
      toast('Failed to delete folder', 'error');
    }
  };

  const formatSize = (b: number | null) =>
    !b ? '' : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${(b / 1e3).toFixed(0)} KB` : `${b} B`;

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-7 w-48 bg-gray-200 rounded" />
        <div className="h-40 bg-gray-100 rounded-xl border border-gray-100" />
      </div>
    );
  }

  if (!folder) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
        <FolderIcon className="h-10 w-10 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Folder not found.</p>
        <Link href="/master" className="mt-3 inline-block text-sm text-blue-600 hover:text-blue-800 font-medium">Back to Project Master</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href="/master" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mb-1">
            <ArrowLeft className="h-3.5 w-3.5" /> Project Master
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 truncate">{folder.name}</h1>
          {folder.description && <p className="text-sm text-gray-500 mt-0.5">{folder.description}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={deleteFolder}
            title="Delete folder"
            className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Items grouped by kind */}
      {folder.items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
          <Paperclip className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p className="text-sm">This folder is empty.</p>
          <p className="text-xs mt-1">Upload project files directly, then add drawings or BOQs to folders from project screens.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {GROUPS.map((group) => {
            const items = folder.items.filter((i) => i.kind === group.kind);
            if (items.length === 0) return null;
            const Icon = group.icon;
            return (
              <div key={group.kind} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                  <Icon className="h-4 w-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">{group.title}</span>
                  <span className="text-xs text-gray-400">({items.length})</span>
                </div>
                <div className="divide-y divide-gray-100">
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                      <a
                        href={`/api/folders/${folderId}/items/${item.id}/download`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 flex-1 min-w-0 text-sm text-gray-700 hover:text-blue-600"
                      >
                        <Download className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </a>
                      {item.size_bytes ? <span className="text-xs text-gray-400 whitespace-nowrap">{formatSize(item.size_bytes)}</span> : null}
                      <button
                        onClick={() => removeItem(item.id)}
                        title="Remove from folder"
                        className="p-1 text-gray-300 hover:text-red-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
