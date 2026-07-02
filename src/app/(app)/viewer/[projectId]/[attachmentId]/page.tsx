'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import FileViewerContent from '@/components/pipeline/file-viewer-content';

export default function FileViewerPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const attachmentId = params.attachmentId as string;

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header toolbar */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-2.5 flex items-center gap-4">
        <Link
          href={`/bids/${projectId}`}
          className="text-gray-400 hover:text-white transition-colors flex items-center gap-2 text-sm"
        >
          <ArrowLeft className="h-5 w-5" />
          Back to Project
        </Link>
      </header>

      {/* Content area */}
      <main className="flex-1 overflow-auto">
        <FileViewerContent projectId={projectId} attachmentId={attachmentId} />
      </main>
    </div>
  );
}
