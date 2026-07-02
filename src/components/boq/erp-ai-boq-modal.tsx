'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Loader2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { Project } from '@/lib/shared/types';
import { useToast } from '@/contexts/toast-context';

type Step = 1 | 2 | 3 | 4 | 5;

const steps: Array<{ id: Step; label: string }> = [
  { id: 1, label: 'Upload' },
  { id: 2, label: 'Extract' },
  { id: 3, label: 'Resolve' },
  { id: 4, label: 'Review' },
  { id: 5, label: 'Confirm' },
];

const extractionStages = [
  'Reading drawings and schedules',
  'Detecting scope and drawing discipline',
  'Extracting quantities',
  'Pricing BOQ sections',
  'Preparing review workbook',
];

interface Props {
  open: boolean;
  projects: Project[];
  defaultProjectId?: string;
  onClose: () => void;
  onRefresh?: () => Promise<void> | void;
}

function money(value: number | null | undefined) {
  if (!value) return 'AED 0';
  return `AED ${Math.round(value).toLocaleString()}`;
}

function fileType(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || 'file';
  return ext.slice(0, 4).toUpperCase();
}

function statusCopy(status?: string) {
  if (!status) return 'No project selected';
  if (status.includes('pending')) return 'Waiting for estimator review';
  if (status.includes('extract') || status.includes('estimating')) return 'AI extraction in progress';
  if (status.includes('boq') || status.includes('ready') || status.includes('estimated')) return 'BOQ ready for review';
  return status.replaceAll('_', ' ');
}

export default function ErpAiBoqModal({ open, projects, defaultProjectId, onClose, onRefresh }: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>(1);
  const [selectedProjectId, setSelectedProjectId] = useState(defaultProjectId || '');
  const [files, setFiles] = useState<File[]>([]);
  const [newProjectName, setNewProjectName] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedProject = useMemo(
    () => projects.find((item) => item.id === selectedProjectId) || project,
    [project, projects, selectedProjectId],
  );

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setProgress(0);
    setSelectedProjectId(defaultProjectId || projects[0]?.id || '');
    setNewProjectName('');
    setNewClientName('');
    setNewLocation('');
    setNotes('');
    setFiles([]);
  }, [defaultProjectId, open, projects]);

  useEffect(() => {
    if (!selectedProjectId || !open) return;
    let cancelled = false;
    fetch(`/api/projects/${selectedProjectId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setProject(data.project || data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, selectedProjectId]);

  useEffect(() => {
    if (step !== 2 || !busy) return;
    const timer = window.setInterval(() => {
      setProgress((value) => Math.min(value + 7, 92));
    }, 900);
    return () => window.clearInterval(timer);
  }, [busy, step]);

  if (!open) return null;

  const uploadAndExtract = async () => {
    let activeProjectId = selectedProjectId;
    setBusy(true);
    setStep(2);
    setProgress(8);
    try {
      if (!activeProjectId) {
        if (!newProjectName.trim()) {
          throw new Error('Enter a project name before extraction');
        }
        const createRes = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_name: newProjectName.trim(),
            client_name: newClientName.trim() || null,
            location: newLocation.trim() || null,
            notes: notes.trim() || null,
            priority: 'new',
            status: 'new',
          }),
        });
        const createData = await createRes.json().catch(() => ({}));
        if (!createRes.ok) {
          throw new Error(createData.details || createData.error || 'Project creation failed');
        }
        activeProjectId = createData.project?.id;
        if (!activeProjectId) throw new Error('Project creation did not return an ID');
        setSelectedProjectId(activeProjectId);
      }

      if (files.length > 0) {
        const formData = new FormData();
        files.forEach((file) => formData.append('files', file));
        const uploadRes = await fetch(`/api/projects/${activeProjectId}/upload`, {
          method: 'POST',
          body: formData,
        });
        if (!uploadRes.ok) {
          const data = await uploadRes.json().catch(() => ({}));
          throw new Error(data.details || data.error || 'Upload failed');
        }
      } else {
        throw new Error('Add at least one drawing, schedule, spec, or archive');
      }

      const extractRes = await fetch(`/api/projects/${activeProjectId}/extract`, { method: 'POST' });
      if (!extractRes.ok) {
        const data = await extractRes.json().catch(() => ({}));
        throw new Error(data.details || data.error || 'Extraction failed');
      }

      setProgress(100);
      await onRefresh?.();
      const detailRes = await fetch(`/api/projects/${activeProjectId}`);
      if (detailRes.ok) {
        const data = await detailRes.json();
        setProject(data.project || data);
      }
      toast('Extraction started from uploaded files', 'success');
      setStep(3);
    } catch (error: any) {
      toast(error.message || 'Extraction failed', 'error');
      setStep(1);
    } finally {
      setBusy(false);
    }
  };

  const generateBoq = async () => {
    if (!selectedProjectId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/boq`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.details || data.error || 'BOQ generation failed');
      }
      const detailRes = await fetch(`/api/projects/${selectedProjectId}`);
      if (detailRes.ok) {
        const data = await detailRes.json();
        setProject(data.project || data);
      }
      await onRefresh?.();
      toast('BOQ workbook generated', 'success');
      setStep(5);
    } catch (error: any) {
      toast(error.message || 'BOQ generation failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!selectedProjectId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/approve`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.details || data.error || 'Approval failed');
      }
      await onRefresh?.();
      toast('BOQ approved in ERP Realsoft', 'success');
      onClose();
    } catch (error: any) {
      toast(error.message || 'Approval failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const projectName = selectedProject?.project_name || selectedProject?.email_subject || newProjectName || 'New upload project';
  const total = selectedProject?.final_quote_aed || 0;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#0f2042]/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_24px_60px_-20px_rgba(16,40,90,.35)]">
        <div className="border-b border-[#e3e9f2] px-6 pt-5">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-[#eaf1fb] text-[#1b5fc4]">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#14233b]">Generate BOQ with AI</h2>
                <p className="text-xs text-[#8a99b2]">ERP Realsoft drawing-to-BOQ workflow</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-[#e3e9f2] text-[#5a6b85] hover:bg-[#f6f8fc]"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center pb-5">
            {steps.map((item, index) => (
              <div key={item.id} className="flex flex-1 items-center last:flex-none">
                <div className="flex items-center gap-2">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${
                      item.id < step
                        ? 'border-[#103b7e] bg-[#103b7e] text-white'
                        : item.id === step
                          ? 'border-[#1b5fc4] bg-[#1b5fc4] text-white shadow-[0_0_0_4px_#eaf1fb]'
                          : 'border-[#cbd6e6] bg-white text-[#8a99b2]'
                    }`}
                  >
                    {item.id < step ? <Check className="h-4 w-4" /> : item.id}
                  </div>
                  <span className={`hidden text-xs font-semibold sm:inline ${item.id === step ? 'text-[#103b7e]' : 'text-[#8a99b2]'}`}>
                    {item.label}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <div className={`mx-3 h-px flex-1 ${item.id < step ? 'bg-[#103b7e]' : 'bg-[#cbd6e6]'}`} />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-[#f6f8fc] p-6">
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-base font-semibold text-[#14233b]">Upload drawings and specifications</h3>
                <p className="mt-1 max-w-2xl text-sm text-[#5a6b85]">
                  Create a project or select an existing one, upload drawings/specifications, then start a fresh AI extraction.
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
                <div className="rounded-[9px] border border-[#e3e9f2] bg-white p-4">
                  <label className="text-xs font-semibold text-[#14233b]">Existing project record</label>
                  <select
                    value={selectedProjectId}
                    onChange={(event) => setSelectedProjectId(event.target.value)}
                    className="mt-2 w-full rounded-[9px] border-[#cbd6e6] text-sm"
                  >
                    <option value="">Choose a project...</option>
                    {projects.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.project_name || item.email_subject || item.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                  <div className="mt-4 border-t border-[#e3e9f2] pt-4">
                    <p className="text-xs font-semibold text-[#14233b]">Or create from upload</p>
                    <div className="mt-2 space-y-2">
                      <input
                        value={newProjectName}
                        onChange={(event) => {
                          setNewProjectName(event.target.value);
                          if (event.target.value.trim()) setSelectedProjectId('');
                        }}
                        placeholder="Project name"
                        className="w-full rounded-[9px] border-[#cbd6e6] text-sm"
                      />
                      <input
                        value={newClientName}
                        onChange={(event) => setNewClientName(event.target.value)}
                        placeholder="Client name"
                        className="w-full rounded-[9px] border-[#cbd6e6] text-sm"
                      />
                      <input
                        value={newLocation}
                        onChange={(event) => setNewLocation(event.target.value)}
                        placeholder="Location"
                        className="w-full rounded-[9px] border-[#cbd6e6] text-sm"
                      />
                    </div>
                  </div>
                  <div className="mt-4 rounded-[9px] bg-[#f4f8fe] p-3 text-xs text-[#5a6b85]">
                    <b className="block text-[#14233b]">{projectName}</b>
                    <span>{statusCopy(selectedProject?.status)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-[9px] border-2 border-dashed border-[#cbd6e6] bg-white p-8 text-center hover:border-[#1b5fc4] hover:bg-[#f4f8fe]"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(event) => setFiles(Array.from(event.target.files || []))}
                  />
                  <Upload className="mx-auto mb-3 h-10 w-10 rounded-[10px] bg-[#eaf1fb] p-2 text-[#1b5fc4]" />
                  <div className="text-sm font-semibold text-[#14233b]">Add drawings, schedules, specs, ZIP/RAR packages</div>
                  <p className="mt-1 text-xs text-[#8a99b2]">PDF, DWG, DXF, XLSX, DOCX, images, and archives</p>
                </button>
              </div>
              {files.length > 0 && (
                <div className="grid gap-2 md:grid-cols-2">
                  {files.map((file) => (
                    <div key={`${file.name}-${file.size}`} className="flex items-center gap-3 rounded-[9px] border border-[#e3e9f2] bg-white p-3">
                      <span className="flex h-8 w-10 items-center justify-center rounded bg-[#1b5fc4] font-mono text-[10px] font-bold text-white">
                        {fileType(file.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[#14233b]">{file.name}</div>
                        <div className="text-xs text-[#8a99b2]">{Math.max(1, Math.round(file.size / 1024)).toLocaleString()} KB</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional extraction notes for estimator context"
                className="min-h-24 w-full rounded-[9px] border-[#cbd6e6] text-sm"
              />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="flex items-center gap-4 rounded-[9px] border border-[#e3e9f2] bg-white p-5">
                <div className="relative h-12 w-12">
                  <Loader2 className="h-12 w-12 animate-spin text-[#1b5fc4]" />
                  <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-bold text-[#103b7e]">{progress}%</span>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-[#14233b]">Running fresh extraction</h3>
                  <p className="text-sm text-[#5a6b85]">The existing production pipeline remains in control of quality gates and review status.</p>
                </div>
              </div>
              <div className="rounded-[9px] border border-[#e3e9f2] bg-white px-5 py-2">
                {extractionStages.map((label, index) => {
                  const done = progress >= (index + 1) * 20;
                  const active = !done && progress >= index * 20;
                  return (
                    <div key={label} className="flex items-center gap-3 border-b border-[#e3e9f2] py-3 last:border-b-0">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${done ? 'border-[#1e8e5a] bg-[#1e8e5a]' : active ? 'border-[#1b5fc4] bg-[#eaf1fb]' : 'border-[#cbd6e6]'}`}>
                        {done && <Check className="h-3 w-3 text-white" />}
                      </span>
                      <span className={`flex-1 text-sm ${done || active ? 'text-[#14233b]' : 'text-[#8a99b2]'}`}>{label}</span>
                      <span className="font-mono text-xs text-[#8a99b2]">{done ? 'done' : active ? 'reading' : 'queued'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex gap-3 rounded-[9px] border border-[#ebd8b0] bg-[#fbf2e1] p-4 text-sm text-[#7a5512]">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                <p>
                  Review flagged assumptions in the project detail screen if the extraction requests clarification.
                  This modal keeps the review gate mandatory before ERP write-back.
                </p>
              </div>
              {['Document sufficiency', 'Bid decision', 'Quantity/pricing review'].map((label, index) => (
                <div key={label} className="rounded-[9px] border border-[#e3e9f2] bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="rounded bg-[#e7f4ee] px-2 py-1 font-mono text-[10px] font-bold uppercase text-[#1e8e5a]">
                        Gate {index + 1}
                      </span>
                      <h4 className="mt-3 text-sm font-semibold text-[#14233b]">{label}</h4>
                      <p className="mt-1 text-xs text-[#5a6b85]">Handled by existing ERP Realsoft project gates and audit log.</p>
                    </div>
                    <CheckCircle2 className="h-5 w-5 text-[#1e8e5a]" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-[#14233b]">Preview the bill of quantities</h3>
                  <p className="text-sm text-[#5a6b85]">Use project detail for full row-level editing, lineage, cable schedules, and approvals.</p>
                </div>
                {selectedProjectId && (
                  <Link href={`/bids/${selectedProjectId}`} className="rounded-[9px] border border-[#cbd6e6] bg-white px-4 py-2 text-sm font-semibold text-[#14233b]">
                    Open full review
                  </Link>
                )}
              </div>
              <div className="overflow-hidden rounded-[10px] border border-[#cbd6e6] bg-white">
                <table className="w-full min-w-[680px] text-sm">
                  <thead className="bg-[#103b7e] text-left text-xs uppercase tracking-wide text-[#eaf1fb]">
                    <tr>
                      <th className="px-4 py-3">Section</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3 text-right">Qty</th>
                      <th className="px-4 py-3 text-right">Rate</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e3e9f2]">
                    {['Electrical power BOQ', 'HVAC / mechanical services', 'Plumbing and fire scope'].map((label, index) => (
                      <tr key={label} className="hover:bg-[#f4f8fe]">
                        <td className="px-4 py-3 font-mono text-xs text-[#5a6b85]">{index + 1}.00</td>
                        <td className="px-4 py-3 font-medium text-[#14233b]">{label}</td>
                        <td className="px-4 py-3 text-right font-mono">{index + 2}</td>
                        <td className="px-4 py-3 text-right font-mono">Review</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold">{index === 0 ? money(total) : 'Pending'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
              <div className="rounded-[9px] border border-[#e3e9f2] bg-white p-5">
                <h3 className="text-base font-semibold text-[#14233b]">Confirm and write to ERP</h3>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between gap-4"><dt className="text-[#5a6b85]">Project</dt><dd className="text-right font-semibold text-[#14233b]">{projectName}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-[#5a6b85]">Current status</dt><dd className="text-right font-semibold text-[#14233b]">{statusCopy(selectedProject?.status)}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-[#5a6b85]">Estimate value</dt><dd className="text-right font-semibold text-[#103b7e]">{money(total)}</dd></div>
                </dl>
              </div>
              <div className="rounded-[9px] border border-[#e3e9f2] bg-white p-5">
                <h3 className="text-base font-semibold text-[#14233b]">What gets written</h3>
                <div className="mt-4 space-y-3 text-sm text-[#5a6b85]">
                  <p className="flex gap-2"><Check className="h-4 w-4 text-[#1e8e5a]" /> BOQ workbook and project estimate</p>
                  <p className="flex gap-2"><Check className="h-4 w-4 text-[#1e8e5a]" /> Approval timestamp and audit activity</p>
                  <p className="flex gap-2"><Check className="h-4 w-4 text-[#1e8e5a]" /> Export-ready Excel/PDF records</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e3e9f2] bg-white px-6 py-4">
          <div className="flex items-center gap-2 text-xs text-[#5a6b85]">
            <FileText className="h-4 w-4" />
            <span>{step === 5 ? 'Approval writes to the existing ERP Realsoft project record.' : 'Nothing is approved until human review is complete.'}</span>
          </div>
          <div className="flex items-center gap-2">
            {step > 1 && step < 5 && (
              <button type="button" onClick={() => setStep((step - 1) as Step)} disabled={busy} className="rounded-[9px] px-4 py-2 text-sm font-semibold text-[#5a6b85] hover:bg-[#f6f8fc]">
                Back
              </button>
            )}
            {step === 1 && (
              <button type="button" onClick={uploadAndExtract} disabled={busy || (!selectedProjectId && !newProjectName.trim())} className="inline-flex items-center gap-2 rounded-[9px] bg-[#1b5fc4] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1850a8] disabled:opacity-50">
                <Sparkles className="h-4 w-4" /> Run extraction
              </button>
            )}
            {step === 3 && (
              <button type="button" onClick={() => setStep(4)} className="rounded-[9px] bg-[#1b5fc4] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1850a8]">
                Apply and review BOQ
              </button>
            )}
            {step === 4 && (
              <button type="button" onClick={generateBoq} disabled={busy || !selectedProjectId} className="inline-flex items-center gap-2 rounded-[9px] bg-[#1b5fc4] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1850a8] disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Generate workbook
              </button>
            )}
            {step === 5 && (
              <>
                {selectedProjectId && (
                  <a href={`/api/projects/${selectedProjectId}/boq`} className="rounded-[9px] border border-[#cbd6e6] bg-white px-4 py-2 text-sm font-semibold text-[#14233b]">
                    Download Excel
                  </a>
                )}
                <button type="button" onClick={approve} disabled={busy || !selectedProjectId} className="inline-flex items-center gap-2 rounded-[9px] bg-[#1e8e5a] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#176f46] disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
