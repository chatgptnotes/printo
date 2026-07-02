'use client';

import { useEffect, useState } from 'react';
import { FileText, Download, Archive, AlertCircle, Zap } from 'lucide-react';

export interface FileData {
  id: string;
  project_id: string;
  project_name: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  file_type: string | null;
  discipline: string | null;
  text: string | null;
  pages: number | null;
  identified_as: string | null;
  contents: string[] | null;
  preview_svg: string | null;
  attachment_id: string | null;
  message_id: string | null;
  storage_path: string | null;
}

interface ExcelSheet {
  name: string;
  rows: (string | number | null)[][];
  rowCount: number;
  colCount: number;
}

const FILE_TYPE_ICONS: Record<string, { icon: string; color: string; bg: string }> = {
  drawing_pdf: { icon: 'PDF', color: 'text-red-600', bg: 'bg-red-50' },
  drawing_autocad: { icon: 'DWG', color: 'text-blue-600', bg: 'bg-blue-50' },
  schedule_excel: { icon: 'XLS', color: 'text-green-600', bg: 'bg-green-50' },
  specification: { icon: 'DOC', color: 'text-indigo-600', bg: 'bg-indigo-50' },
  archive_zip: { icon: 'ZIP', color: 'text-amber-600', bg: 'bg-amber-50' },
  image: { icon: 'IMG', color: 'text-cyan-600', bg: 'bg-cyan-50' },
  other: { icon: 'FILE', color: 'text-gray-600', bg: 'bg-gray-50' },
};

interface Props {
  projectId: string;
  attachmentId: string;
  /** When true, hide outer max-width and reduce padding so the viewer fits in a modal */
  compact?: boolean;
}

export default function FileViewerContent({ projectId, attachmentId, compact = false }: Props) {
  const [file, setFile] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [excelSheets, setExcelSheets] = useState<ExcelSheet[] | null>(null);
  const [excelLoading, setExcelLoading] = useState(false);
  const [excelError, setExcelError] = useState<string | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [fontSize] = useState(13);
  const [binaryReady, setBinaryReady] = useState<boolean | null>(null);
  const [binaryError, setBinaryError] = useState<{ hint?: string; tried?: string[] } | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [docxLoading, setDocxLoading] = useState(false);
  const [docxError, setDocxError] = useState<string | null>(null);
  const [dxfSvg, setDxfSvg] = useState<string | null>(null);
  const [dxfEntityCount, setDxfEntityCount] = useState(0);
  const [dxfLoading, setDxfLoading] = useState(false);
  const [dxfError, setDxfError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setFile(null);
    setExcelSheets(null);
    setExcelError(null);
    setActiveSheet(0);
    setBinaryReady(null);
    setBinaryError(null);

    fetch(`/api/files/${projectId}/${attachmentId}`)
      .then((res) => {
        if (!res.ok) throw new Error('File not found');
        return res.json();
      })
      .then(setFile)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId, attachmentId, reloadKey]);

  // Probe the binary endpoint with HEAD to know whether to render the iframe/img
  // or show the friendly "not yet downloaded" card.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setBinaryReady(null);
    setBinaryError(null);

    fetch(`/api/files/${projectId}/${attachmentId}/download`, { method: 'HEAD' })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          setBinaryReady(true);
        } else {
          // HEAD doesn't return body; do a GET to read the JSON error
          const errRes = await fetch(`/api/files/${projectId}/${attachmentId}/download`);
          let parsed: { hint?: string; tried?: string[] } = {};
          try { parsed = await errRes.json(); } catch { /* ignore */ }
          if (!cancelled) {
            setBinaryReady(false);
            setBinaryError(parsed);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBinaryReady(false);
          setBinaryError({ hint: 'Network error while loading file binary' });
        }
      });

    return () => { cancelled = true; };
  }, [file, projectId, attachmentId, reloadKey]);

  const runExtractStep = async () => {
    setExtracting(true);
    try {
      await fetch(`/api/projects/${projectId}/extract`, { method: 'POST' });
    } catch { /* ignore — user will see the result */ }
    setExtracting(false);
    setReloadKey((k) => k + 1);
  };

  // Auto-load Excel data when file is identified as a spreadsheet
  useEffect(() => {
    if (!file) return;
    const ext = file.filename.split('.').pop()?.toLowerCase();
    const isExcel = ext === 'xlsx' || ext === 'xls' || file.file_type === 'schedule_excel';
    if (!isExcel || excelSheets || excelLoading) return;

    setExcelLoading(true);
    fetch(`/api/files/${projectId}/${attachmentId}/excel`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load Excel file');
        return res.json();
      })
      .then((data) => setExcelSheets(data.sheets || []))
      .catch((err) => setExcelError(err.message))
      .finally(() => setExcelLoading(false));
  }, [file, projectId, attachmentId, excelSheets, excelLoading]);

  // Auto-load DOCX → HTML
  useEffect(() => {
    if (!file) return;
    const ext = file.filename.split('.').pop()?.toLowerCase();
    if (ext !== 'docx') return;
    if (docxHtml !== null || docxLoading) return;

    setDocxLoading(true);
    setDocxError(null);
    fetch(`/api/files/${projectId}/${attachmentId}/docx`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to convert DOCX');
        return res.json();
      })
      .then((data) => setDocxHtml(data.html || ''))
      .catch((err) => setDocxError(err.message))
      .finally(() => setDocxLoading(false));
  }, [file, projectId, attachmentId, docxHtml, docxLoading]);

  // Auto-load DXF → SVG
  useEffect(() => {
    if (!file) return;
    const ext = file.filename.split('.').pop()?.toLowerCase();
    if (ext !== 'dxf') return;
    if (dxfSvg !== null || dxfLoading) return;

    setDxfLoading(true);
    setDxfError(null);
    fetch(`/api/files/${projectId}/${attachmentId}/dxf`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to parse DXF');
        return res.json();
      })
      .then((data) => {
        setDxfSvg(data.svg || '');
        setDxfEntityCount(data.entityCount || 0);
      })
      .catch((err) => setDxfError(err.message))
      .finally(() => setDxfLoading(false));
  }, [file, projectId, attachmentId, dxfSvg, dxfLoading]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    );
  }

  if (error || !file) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-white">
        <div className="text-center">
          <p className="text-lg font-bold">File Not Found</p>
          <p className="text-sm text-gray-400 mt-2">{error || 'The requested file could not be loaded.'}</p>
        </div>
      </div>
    );
  }

  const meta = FILE_TYPE_ICONS[file.file_type || 'other'] || FILE_TYPE_ICONS.other;
  const ext = file.filename.split('.').pop()?.toUpperCase() || '';
  const extLower = ext.toLowerCase();
  const isDrawing = file.file_type === 'drawing_pdf' || file.file_type === 'drawing_autocad';
  const isZip = file.file_type === 'archive_zip';
  const isPdf = file.mime_type === 'application/pdf' || extLower === 'pdf';
  // CSV is text, NOT excel — must come before isExcel check
  const isCsv = extLower === 'csv';
  const isExcel = (extLower === 'xlsx' || extLower === 'xls' || file.file_type === 'schedule_excel') && !isCsv;
  const isDocx = extLower === 'docx';
  const isDxf = extLower === 'dxf';
  const isSvg = extLower === 'svg';
  const isImage =
    file.file_type === 'image' ||
    ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'].includes(extLower);
  const isPlainText = ['txt', 'csv', 'log', 'md', 'json', 'xml', 'html', 'eml'].includes(extLower);
  const isAudio = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(extLower);
  const isVideo = ['mp4', 'webm', 'mov', 'm4v', 'avi'].includes(extLower);
  // Universal binary URL — tries storage first, then Gmail
  const binaryUrl = `/api/files/${projectId}/${attachmentId}/download`;
  const pdfUrl = isPdf ? binaryUrl : null;

  const wrapperMaxW = compact ? '' : 'max-w-7xl mx-auto';
  const wrapperPad = compact ? 'p-3' : 'p-6';

  // Friendly card shown when the binary endpoint returns 404 — the file is
  // registered but its bytes haven't been downloaded yet.
  const renderMissingBinaryCard = () => (
    <div className="flex items-center justify-center min-h-[60vh] p-8">
      <div className="text-center max-w-lg">
        <div className="w-20 h-20 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-5">
          <AlertCircle className="h-10 w-10 text-amber-400" />
        </div>
        <h2 className="text-lg font-bold text-white mb-2">File contents not yet downloaded</h2>
        <p className="text-gray-400 text-sm mb-1">
          <span className="font-mono text-gray-300">{file.filename}</span>
        </p>
        <p className="text-gray-500 text-xs mb-6">
          {binaryError?.hint || 'The pipeline hasn\'t fetched this attachment yet. Run the extract step to download it from Gmail.'}
        </p>
        <div className="flex items-center justify-center gap-3 mb-6">
          <button
            onClick={runExtractStep}
            disabled={extracting}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {extracting ? (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
            ) : (
              <Zap className="h-4 w-4" />
            )}
            {extracting ? 'Running extract step…' : 'Run Extract Step'}
          </button>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="px-4 py-2 bg-gray-700 text-white rounded-lg text-sm font-medium hover:bg-gray-600 transition-colors"
          >
            Retry
          </button>
        </div>
        {binaryError?.tried && binaryError.tried.length > 0 && (
          <details className="text-left mt-4 bg-gray-800/50 rounded-lg p-3">
            <summary className="text-[11px] text-gray-500 cursor-pointer">Lookup details</summary>
            <ul className="text-[10px] text-gray-500 font-mono mt-2 space-y-1">
              {binaryError.tried.map((t, i) => (
                <li key={i}>· {t}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );

  // While we don't yet know if the binary is reachable, show a brief loader
  // for the file types that need a binary URL (PDF, Image, plain text, audio, video).
  // Excel/DOCX/DXF/ZIP fetch their own parsed JSON and surface their own errors.
  const needsBinary = isPdf || isImage || isPlainText || isAudio || isVideo;
  if (needsBinary && binaryReady === null) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    );
  }
  if (needsBinary && binaryReady === false) {
    return renderMissingBinaryCard();
  }

  // PDF inline
  if (pdfUrl) {
    return (
      <div className="h-full">
        <iframe
          src={pdfUrl}
          className={`w-full border-0 ${compact ? 'min-h-[80vh]' : 'min-h-[85vh]'}`}
          title={file.filename}
        />
      </div>
    );
  }

  // Audio (browser-native)
  if (isAudio) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-8">
        <div className="max-w-2xl w-full text-center">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center mb-5">
            <span className="text-2xl">♪</span>
          </div>
          <h2 className="text-lg font-bold text-white mb-1">{file.filename}</h2>
          <p className="text-gray-400 text-xs mb-6">Audio file</p>
          <audio controls src={binaryUrl} className="w-full">
            Your browser does not support the audio element.
          </audio>
        </div>
      </div>
    );
  }

  // Video (browser-native)
  if (isVideo) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-4">
        <div className="max-w-5xl w-full">
          <video controls src={binaryUrl} className="w-full rounded-lg shadow-xl bg-black">
            Your browser does not support the video element.
          </video>
          <p className="text-center text-gray-400 text-xs mt-3">{file.filename}</p>
        </div>
      </div>
    );
  }

  // DOCX → HTML via mammoth
  if (isDocx) {
    return (
      <div className={`${wrapperMaxW} ${wrapperPad}`}>
        {docxLoading ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400 mx-auto" />
              <p className="text-gray-400 text-sm mt-3">Converting Word document…</p>
            </div>
          </div>
        ) : docxError ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center max-w-md">
              <div className="w-20 h-20 mx-auto rounded-2xl bg-red-50 flex items-center justify-center mb-4">
                <AlertCircle className="h-10 w-10 text-red-500" />
              </div>
              <p className="text-white font-bold mb-1">Could not convert document</p>
              <p className="text-gray-400 text-sm">{docxError}</p>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-2xl overflow-hidden">
            <div className="bg-indigo-50 border-b border-indigo-200 px-6 py-3 flex items-center justify-between">
              <p className="text-xs font-semibold text-indigo-900">{file.filename}</p>
              <a
                href={binaryUrl}
                download={file.filename}
                className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                <Download className="h-3 w-3" /> Download original
              </a>
            </div>
            <div
              className={`docx-prose px-8 py-6 ${compact ? 'max-h-[75vh]' : 'min-h-[60vh]'} overflow-auto`}
              style={{
                fontFamily: 'Calibri, Arial, sans-serif',
                fontSize: '14px',
                lineHeight: 1.6,
                color: '#1e293b',
              }}
              dangerouslySetInnerHTML={{ __html: docxHtml || '<p class="text-gray-400">Empty document</p>' }}
            />
          </div>
        )}
      </div>
    );
  }

  // DXF → SVG via dxf-parser
  if (isDxf) {
    return (
      <div className={`${wrapperMaxW} ${wrapperPad}`}>
        {dxfLoading ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400 mx-auto" />
              <p className="text-gray-400 text-sm mt-3">Parsing DXF drawing…</p>
            </div>
          </div>
        ) : dxfError ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center max-w-md">
              <div className="w-20 h-20 mx-auto rounded-2xl bg-red-50 flex items-center justify-center mb-4">
                <AlertCircle className="h-10 w-10 text-red-500" />
              </div>
              <p className="text-white font-bold mb-1">Could not parse DXF</p>
              <p className="text-gray-400 text-sm">{dxfError}</p>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-2xl overflow-hidden">
            <div className="bg-blue-50 border-b border-blue-200 px-6 py-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-blue-900">{file.filename}</p>
                <p className="text-[10px] text-blue-600">{dxfEntityCount} entities · AutoCAD DXF</p>
              </div>
              <a
                href={binaryUrl}
                download={file.filename}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                <Download className="h-3 w-3" /> Download original
              </a>
            </div>
            <div className={`bg-slate-50 ${compact ? 'h-[70vh]' : 'h-[75vh]'} flex items-center justify-center p-4`}>
              <div
                className="w-full h-full"
                dangerouslySetInnerHTML={{ __html: dxfSvg || '' }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // Excel
  if (isExcel) {
    return (
      <div className={`${wrapperMaxW} ${wrapperPad}`}>
        {excelLoading ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-400 mx-auto" />
              <p className="text-gray-400 text-sm mt-3">Loading spreadsheet…</p>
            </div>
          </div>
        ) : excelError ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center max-w-md">
              <div className="w-20 h-20 mx-auto rounded-2xl bg-red-50 flex items-center justify-center mb-4">
                <span className="text-2xl font-black text-red-600">!</span>
              </div>
              <p className="text-white font-bold mb-1">Could not load spreadsheet</p>
              <p className="text-gray-400 text-sm">{excelError}</p>
            </div>
          </div>
        ) : excelSheets && excelSheets.length > 0 ? (
          <div className="bg-white rounded-xl overflow-hidden shadow-2xl">
            {excelSheets.length > 1 && (
              <div className="flex items-center gap-1 bg-gray-100 border-b border-gray-200 px-3 pt-2 overflow-x-auto">
                {excelSheets.map((sheet, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveSheet(idx)}
                    className={`px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap transition-colors ${
                      activeSheet === idx
                        ? 'bg-white text-green-700 border-t-2 border-green-500'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {sheet.name}
                    <span className="ml-1.5 text-[10px] text-gray-400">
                      {sheet.rowCount}×{sheet.colCount}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {(() => {
              const sheet = excelSheets[activeSheet];
              if (!sheet || sheet.rows.length === 0) {
                return <div className="p-8 text-center text-gray-400 text-sm">Empty sheet</div>;
              }
              const [headerRow, ...dataRows] = sheet.rows;
              return (
                <div className={`overflow-auto ${compact ? 'max-h-[70vh]' : 'max-h-[75vh]'}`}>
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-green-50">
                        <th className="px-2 py-2 text-[10px] text-gray-400 font-medium border-b border-r border-green-200 w-10 text-center bg-gray-50">
                          #
                        </th>
                        {headerRow.map((cell, i) => (
                          <th
                            key={i}
                            className="px-3 py-2 text-left font-bold text-green-900 border-b border-r border-green-200 whitespace-nowrap"
                          >
                            {cell != null ? String(cell) : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dataRows.map((row, ri) => (
                        <tr key={ri} className="hover:bg-blue-50/50 even:bg-gray-50/40">
                          <td className="px-2 py-1.5 text-[10px] text-gray-400 border-b border-r border-gray-200 text-center bg-gray-50/60">
                            {ri + 2}
                          </td>
                          {Array.from({ length: headerRow.length }).map((_, ci) => {
                            const cell = row[ci];
                            const isNumber = typeof cell === 'number';
                            return (
                              <td
                                key={ci}
                                className={`px-3 py-1.5 text-gray-700 border-b border-r border-gray-100 ${
                                  isNumber ? 'text-right tabular-nums font-mono' : ''
                                }`}
                              >
                                {cell != null ? String(cell) : ''}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}

            <div className="bg-gray-50 border-t border-gray-200 px-4 py-2 flex items-center justify-between text-[11px] text-gray-500">
              <span>
                {excelSheets.length} sheet{excelSheets.length !== 1 ? 's' : ''} ·{' '}
                {excelSheets[activeSheet]?.rowCount || 0} rows ·{' '}
                {excelSheets[activeSheet]?.colCount || 0} cols
              </span>
              {binaryUrl && (
                <a
                  href={binaryUrl}
                  download={file.filename}
                  className="flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium"
                >
                  <Download className="h-3 w-3" /> Download original
                </a>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center text-gray-400 py-20">No data in spreadsheet</div>
        )}
      </div>
    );
  }

  // Image (incl. SVG)
  if (isImage) {
    return (
      <div className={`flex items-center justify-center min-h-[60vh] ${compact ? 'p-4' : 'p-8'}`}>
        <div className="max-w-5xl w-full">
          <div className={`rounded-lg shadow-xl border border-gray-700 overflow-hidden ${isSvg ? 'bg-white p-6' : 'bg-gray-800'}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={binaryUrl}
              alt={file.filename}
              className="w-full h-auto block mx-auto"
            />
          </div>
          <p className="text-center text-gray-400 text-xs mt-3">
            {file.filename}
            {file.size_bytes && ` — ${(file.size_bytes / 1024 / 1024).toFixed(2)} MB`}
            {isSvg && ' · vector image'}
          </p>
        </div>
      </div>
    );
  }

  // Plain text / CSV / JSON / XML / HTML
  if (isPlainText) {
    return (
      <div className={`${wrapperMaxW} ${wrapperPad}`}>
        <div className="bg-white rounded-xl overflow-hidden shadow-2xl">
          <iframe
            src={binaryUrl}
            className={`w-full border-0 ${compact ? 'min-h-[70vh]' : 'min-h-[75vh]'}`}
            title={file.filename}
          />
        </div>
        <p className="text-center text-gray-400 text-xs mt-3">{file.filename}</p>
      </div>
    );
  }

  // ZIP contents listing
  if (isZip && file.contents) {
    return (
      <div className={`${compact ? '' : 'max-w-4xl mx-auto mt-8'} bg-white rounded-xl overflow-hidden shadow-xl`}>
        <div className="bg-amber-50 px-8 py-6 border-b border-amber-200">
          <div className="flex items-center gap-4">
            <Archive className="h-12 w-12 text-amber-500" />
            <div>
              <h2 className="text-xl font-bold text-amber-800">{file.filename}</h2>
              <p className="text-sm text-amber-600">{file.contents.length} files in archive</p>
            </div>
          </div>
        </div>
        <div className="divide-y divide-gray-100 max-h-[70vh] overflow-auto">
          {file.contents.map((path, i) => {
            const name = path.split('/').pop() || path;
            const folder = path.split('/').slice(0, -1).join('/');
            const fileExt = name.split('.').pop()?.toLowerCase() || '';
            const typeColor =
              fileExt === 'pdf'
                ? 'text-red-500'
                : fileExt === 'dwg'
                ? 'text-blue-500'
                : fileExt === 'xlsx'
                ? 'text-green-500'
                : 'text-gray-400';
            return (
              <div key={i} className="flex items-center gap-3 px-8 py-2.5 hover:bg-gray-50">
                <FileText className={`h-4 w-4 flex-shrink-0 ${typeColor}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-700 truncate">{name}</p>
                  {folder && <p className="text-[10px] text-gray-400">{folder}</p>}
                </div>
                <span className="text-[10px] font-bold text-gray-400 uppercase">{fileExt}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Text-based viewer (extracted text from PDF/DOCX) — when nothing more visual is available
  if (file.text) {
    return (
      <div className={compact ? '' : 'max-w-5xl mx-auto'}>
        <div className={`${meta.bg} border-b border-gray-700 px-8 py-6`}>
          <div className="flex items-start gap-4">
            <div className={`w-16 h-16 rounded-xl ${meta.bg} border-2 border-current ${meta.color} flex items-center justify-center`}>
              <span className="text-xl font-black">{ext}</span>
            </div>
            <div>
              <h2 className={`text-xl font-bold ${meta.color}`}>{file.filename}</h2>
              <p className="text-sm text-gray-600 mt-1">
                {isDrawing
                  ? 'MEP Drawing'
                  : file.file_type === 'specification'
                  ? 'Specification Document'
                  : file.file_type === 'schedule_excel'
                  ? 'Schedule / BOQ'
                  : 'Document'}
                {file.pages && ` — ${file.pages} page${file.pages > 1 ? 's' : ''}`}
              </p>
              {file.identified_as && (
                <span className="inline-block mt-2 px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-xs font-bold uppercase">
                  {file.identified_as.replace(/_/g, ' ')}
                </span>
              )}
            </div>
          </div>
        </div>

        {file.preview_svg && (
          <div className="bg-white px-8 py-6 border-b border-gray-200">
            <div
              className="w-full rounded-lg overflow-hidden border border-gray-300 shadow-md"
              dangerouslySetInnerHTML={{ __html: file.preview_svg }}
            />
          </div>
        )}

        <div className={`bg-white px-8 py-6 shadow-xl ${compact ? 'max-h-[70vh] overflow-auto' : 'min-h-[60vh]'}`}>
          <pre
            className="text-gray-800 whitespace-pre-wrap font-mono leading-relaxed"
            style={{ fontSize: `${fontSize}px` }}
          >
            {file.text}
          </pre>
        </div>

        <div className="bg-gray-100 px-8 py-3 text-xs text-gray-400 flex items-center justify-between">
          <span>Extracted text — original formatting may differ from source document</span>
          <span>{file.text.length.toLocaleString()} characters</span>
        </div>
      </div>
    );
  }

  // Fallback — info card with download
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-md">
        <div className={`w-24 h-24 mx-auto rounded-2xl ${meta.bg} flex items-center justify-center mb-6`}>
          <span className={`text-3xl font-black ${meta.color}`}>{ext}</span>
        </div>
        <h2 className="text-xl font-bold text-white mb-2">{file.filename}</h2>
        <p className="text-gray-400 text-sm mb-6">
          {file.file_type === 'drawing_autocad'
            ? (ext.toLowerCase() === 'dxf'
                ? 'DXF files are parsed automatically — layers, panel labels, and drawing text feed into the electrical procedure. Use the inline preview or open in AutoCAD for full geometry.'
                : 'DWG is a binary AutoCAD format. The pipeline cannot read it directly — export to PDF (File → Print → PDF/Plot) or DXF (File → Save As → DXF) before upload, or open with AutoCAD Web below.')
            : `Click Download to save this ${ext} file to your device.`}
        </p>
        <div className="flex items-center justify-center gap-3">
          {binaryUrl && (
            <a
              href={binaryUrl}
              download={file.filename}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Download
            </a>
          )}
          {file.file_type === 'drawing_autocad' && (
            <a
              href="https://web.autocad.com"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Open AutoCAD Web
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
