'use client';

/**
 * <FieldSource> — renders an always-visible inline lineage chip showing where
 * a value came from. The chip text is the actual source reference:
 *
 *   from Thermal_Load.pdf       (ai_vision)
 *   from email                  (gmail)
 *   calc: 311 ÷ 3.517            (computed)
 *   SABI rate table              (rate_table)
 *   test-rfq-al_reem.json        (fixture)
 *
 * No clicks. Hover the chip for the full popover (set_by, set_at, formula,
 * raw value, full ref).
 *
 * Lookup modes:
 *   <FieldSource projectId={id} field="floors" />                       → project lineage
 *   <FieldSource projectId={id} serviceId={s.id} field="tonnage" />     → service lineage
 *   <FieldSource projectId={id} attachmentId={a.id} field="discipline"/> → attachment lineage
 *   <FieldSource projectId={id} specField="materials" />                → spec lineage
 *   <FieldSource projectId={id} boqField="subtotal" />                  → BOQ lineage
 *
 * Render modes:
 *   <FieldSource ... />                                       → chip only
 *   <FieldSource ... block>{value}</FieldSource>              → value + chip on a new line
 *   <FieldSource ... >{value}</FieldSource>                   → value + chip inline
 */

import { useState, useRef } from 'react';
import { useLineage } from '@/hooks/use-lineage';
import { SOURCE_LABELS, SOURCE_COLORS, type LineageEntry } from '@/lib/pipeline/lineage';

interface FieldSourceProps {
  projectId: string;
  field?: string;
  serviceId?: string;
  attachmentId?: string;
  specField?: string;
  boqField?: string;
  /** Render the chip on a new line below children, instead of beside. */
  block?: boolean;
  className?: string;
  children?: React.ReactNode;
  /** Maximum chip text length before truncation (default 36). */
  maxLength?: number;
}

function formatTimestamp(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatRaw(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v.length > 200 ? v.slice(0, 200) + '…' : v;
  try {
    const json = JSON.stringify(v, null, 2);
    return json.length > 500 ? json.slice(0, 500) + '\n…' : json;
  } catch {
    return String(v);
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export default function FieldSource({
  projectId,
  field,
  serviceId,
  attachmentId,
  specField,
  boqField,
  block = false,
  className = '',
  children,
  maxLength = 36,
}: FieldSourceProps) {
  const { lineage } = useLineage(projectId);
  const [hovered, setHovered] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  let entry: LineageEntry | undefined;
  let resolvedField: string | undefined;
  if (lineage) {
    if (specField) {
      entry = lineage.spec[specField];
      resolvedField = specField;
    } else if (boqField) {
      entry = lineage.boq[boqField];
      resolvedField = boqField;
    } else if (attachmentId && field) {
      const att = lineage.attachments.find((a) => a.id === attachmentId);
      entry = att?.lineage[field];
      resolvedField = field;
    } else if (serviceId && field) {
      const svc = lineage.services.find((s) => s.id === serviceId);
      entry = svc?.lineage[field];
      resolvedField = field;
    } else if (field) {
      entry = lineage.project[field];
      resolvedField = field;
    }
  }

  // No lineage data — render children only (or nothing)
  if (!entry) {
    return children ? <>{children}</> : null;
  }

  const source = entry.source;
  const colors = SOURCE_COLORS[source];

  // Chip text: prefer source_ref, fall back to the source label
  const chipText = entry.source_ref || SOURCE_LABELS[source];
  const displayText = truncate(chipText, maxLength);
  const chip = (
    <span
      className={`inline-flex items-center gap-0.5 text-[9px] font-medium px-1 py-px rounded border ${colors.bg} ${colors.text} ${colors.border} cursor-help select-none whitespace-nowrap`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={chipText}
    >
      {displayText}
    </span>
  );

  const popover = hovered && (
    <div
      className="absolute z-50 top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-xl p-3 text-left pointer-events-none"
      style={{ minWidth: '18rem' }}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${colors.bg} ${colors.text} ${colors.border}`}>
          {SOURCE_LABELS[source]}
        </span>
        <span className="text-[10px] text-gray-400 ml-auto font-mono">{resolvedField}</span>
      </div>

      {entry.source_ref && (
        <p className="text-[11px] text-gray-700 leading-snug font-mono mb-2 break-words">
          {entry.source_ref}
        </p>
      )}

      {entry.detail && (
        <p className="text-xs text-gray-700 leading-snug mb-2">{entry.detail}</p>
      )}

      {entry.formula && (
        <div className="text-[11px] text-gray-700 bg-gray-50 rounded p-1.5 mb-2 font-mono">
          {entry.formula}
        </div>
      )}

      <dl className="text-[10px] grid grid-cols-3 gap-x-2 gap-y-0.5 text-gray-600">
        {entry.set_by && (
          <>
            <dt className="text-gray-400">set by</dt>
            <dd className="col-span-2 truncate">{entry.set_by}</dd>
          </>
        )}
        {entry.set_at && (
          <>
            <dt className="text-gray-400">set at</dt>
            <dd className="col-span-2">{formatTimestamp(entry.set_at)}</dd>
          </>
        )}
      </dl>

      {entry.raw_value !== undefined && typeof entry.raw_value !== 'object' && (
        <p className="mt-1.5 text-[10px] text-gray-500 font-mono truncate" title={String(entry.raw_value)}>
          raw: {formatRaw(entry.raw_value)}
        </p>
      )}
    </div>
  );

  return (
    <span ref={containerRef} className={`relative ${block ? 'inline-block' : 'inline-flex items-center gap-1'} ${className}`}>
      {children}
      {block && children && <br />}
      {chip}
      {popover}
    </span>
  );
}
