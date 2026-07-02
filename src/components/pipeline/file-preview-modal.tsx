'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { X, ExternalLink } from 'lucide-react';
import FileViewerContent from './file-viewer-content';

interface Props {
  projectId: string;
  attachmentId: string;
  filename?: string;
  onClose: () => void;
}

export default function FilePreviewModal({ projectId, attachmentId, filename, onClose }: Props) {
  // ESC closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Lock body scroll while modal open
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const ext = filename?.split('.').pop()?.toUpperCase() || '';

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-7xl max-h-[95vh] flex flex-col overflow-hidden border border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gray-800 border-b border-gray-700 px-4 py-2.5 flex items-center gap-3 flex-shrink-0">
          {ext && (
            <div className="px-2 py-1 rounded-md text-xs font-bold bg-gray-700 text-gray-200">
              {ext}
            </div>
          )}
          <h2 className="flex-1 text-sm font-semibold text-white truncate">
            {filename || 'File Preview'}
          </h2>
          <Link
            href={`/viewer/${projectId}/${attachmentId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
            title="Open in new tab"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            New tab
          </Link>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
            title="Close (ESC)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto bg-gray-900">
          <FileViewerContent projectId={projectId} attachmentId={attachmentId} compact />
        </div>
      </div>
    </div>
  );
}
