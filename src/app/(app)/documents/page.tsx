import { FolderOpen, FileText, Upload, Search } from 'lucide-react';
import Link from 'next/link';

export default function DocumentsPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4">
      <div className="relative mb-8">
        <div className="w-24 h-24 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center">
          <FolderOpen className="h-12 w-12 text-amber-400" />
        </div>
        <div className="absolute -top-2 -right-2 w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center">
          <Search className="h-4 w-4 text-blue-400" />
        </div>
        <div className="absolute -bottom-2 -left-2 w-8 h-8 rounded-lg bg-green-50 border border-green-100 flex items-center justify-center">
          <Upload className="h-4 w-4 text-green-400" />
        </div>
      </div>

      <div className="text-center max-w-md">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 border border-amber-100 rounded-full mb-4">
          <span className="text-xs font-semibold text-amber-600 uppercase tracking-wide">Coming Soon</span>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-3">Drawing Library</h1>

        <p className="text-gray-500 text-sm leading-relaxed mb-6">
          A centralized library for all project drawings, specifications, and documents.
          Search, filter, and browse across all projects.
        </p>

        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-8 text-left space-y-2.5">
          {[
            { icon: FolderOpen, text: 'Browse drawings organized by project and discipline' },
            { icon: Search, text: 'Full-text search across all extracted PDF content' },
            { icon: FileText, text: 'View drawing metadata, discipline tags, and extracted data' },
            { icon: Upload, text: 'Upload and catalogue new drawings with auto-classification' },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded bg-white border border-gray-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Icon className="h-3 w-3 text-gray-400" />
              </div>
              <p className="text-xs text-gray-600">{text}</p>
            </div>
          ))}
        </div>

        <Link
          href="/bids"
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
        >
          Back to Bid List
        </Link>
      </div>
    </div>
  );
}
