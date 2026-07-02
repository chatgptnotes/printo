/**
 * Data lineage / provenance derivation.
 *
 * For every meaningful field on a project, derive WHERE the value came from
 * by inspecting the existing JSONB columns (ai_classification, ai_extraction,
 * services.ai_extraction, attachments.extracted_data) and the activity log.
 *
 * v1 is read-only: no provenance table, no DB writes. Lineage is reconstructed
 * from existing data on demand. Future versions can add an append-only
 * sabi_field_provenance table to track manual edits with user identity.
 *
 * Usage:
 *   import { deriveProjectLineage } from '@/lib/pipeline/lineage';
 *   const lineage = deriveProjectLineage({ project, services, attachments, activityLog });
 *   lineage['floors']  // → { source: 'ai_extract', confidence: 0.95, ... }
 */

import type { Project, Service, Attachment, ActivityLog } from '@/lib/shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LineageSource =
  | 'gmail' // raw email metadata
  | 'ai_classify' // Claude classifyEmail()
  | 'ai_extract' // Claude extractProjectInfo()
  | 'ai_vision' // Claude vision on a drawing
  | 'manual' // human edit via PUT route
  | 'computed' // derived by formula
  | 'rate_table' // looked up from a rates table
  | 'fixture' // seeded from a test fixture
  | 'default' // hardcoded fallback
  | 'state_machine' // set by gate transitions
  | 'unknown'; // value present, source could not be determined

export interface LineageEntry {
  /** Where this value came from. */
  source: LineageSource;
  /** Optional pointer back to the source row/file/log. */
  source_ref?: string;
  /** Confidence 0..1 if the source provides one. */
  confidence?: number;
  /** Original raw value from the source (small payloads only). */
  raw_value?: unknown;
  /** ISO timestamp the value was set (best effort). */
  set_at?: string;
  /** Who set the value — 'system', 'claude-sonnet-4-6', user email, etc. */
  set_by?: string;
  /** Human-readable explanation for the popover ("Inferred from email keyword 'office'"). */
  detail?: string;
  /** For computed fields, the formula trail. */
  formula?: string;
}

export type ProjectLineage = Record<string, LineageEntry>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fields on sabi_projects that always come from the Gmail message metadata. */
const GMAIL_FIELDS = new Set([
  'email_thread_id',
  'email_message_id',
  'email_from',
  'email_subject',
  'email_date',
  'email_snippet',
]);

/** Fields on sabi_projects that come from Claude's extractProjectInfo() output. */
const AI_EXTRACT_FIELDS = new Set([
  'client_name',
  'project_name',
  'location',
  'floors',
  'parking_floors',
  'typical_floors',
  'area_per_floor_sqft',
  'total_area_sqft',
  'typical_height_m',
  'building_type',
  'deadline',
  'consultant',
]);

/** Display labels for each source type. */
export const SOURCE_LABELS: Record<LineageSource, string> = {
  gmail: 'Gmail',
  ai_classify: 'AI Classify',
  ai_extract: 'AI Extract',
  ai_vision: 'AI Vision',
  manual: 'Manual',
  computed: 'Computed',
  rate_table: 'Rate Table',
  fixture: 'Test Fixture',
  default: 'Default',
  state_machine: 'State Machine',
  unknown: 'Unknown',
};

/** Tailwind colour classes per source. */
export const SOURCE_COLORS: Record<LineageSource, { bg: string; text: string; border: string }> = {
  gmail: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  ai_classify: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  ai_extract: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  ai_vision: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  manual: { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200' },
  computed: { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' },
  rate_table: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  fixture: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200' },
  default: { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' },
  state_machine: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
  unknown: { bg: 'bg-gray-50', text: 'text-gray-500', border: 'border-gray-200' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DeriveInput {
  project: Project;
  services?: Service[];
  attachments?: Attachment[];
  activityLog?: ActivityLog[];
}

function isPresent(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

function parseNotes(notes: string | null): Record<string, unknown> {
  if (!notes) return {};
  try {
    return JSON.parse(notes) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Find the first activity log entry that mentions a field by name in its details JSONB. */
function findLogFor(
  logs: ActivityLog[] | undefined,
  field: string
): ActivityLog | undefined {
  if (!logs) return undefined;
  return logs.find((l) => l.details && JSON.stringify(l.details).includes(`"${field}"`));
}

// ---------------------------------------------------------------------------
// Project lineage derivation
// ---------------------------------------------------------------------------

export function deriveProjectLineage(input: DeriveInput): ProjectLineage {
  const { project, services, activityLog } = input;
  const lineage: ProjectLineage = {};

  const aiClassification = (project.ai_classification || {}) as Record<string, unknown>;
  const aiExtraction = (project.ai_extraction || {}) as Record<string, unknown>;
  const notes = parseNotes(project.notes);
  // Detect test projects three ways: explicit notes flag, .example sender
  // domain (used by the seeder's fixture), or a [TEST ...] suffix in the
  // subject. Notes can be overwritten by gate transitions, so we don't rely
  // on it alone.
  const isTest =
    notes.is_test === true ||
    (project.email_from || '').toLowerCase().includes('.example') ||
    (project.email_subject || '').includes('[TEST ');
  const fixtureTemplate =
    (notes.template as string) ||
    (isTest && (project.email_from || '').toLowerCase().includes('alreem') ? 'al_reem' : null);

  // ---- Gmail-sourced fields ----
  const senderShort = (project.email_from || 'email').split('<')[0].trim() || 'email';
  for (const field of GMAIL_FIELDS) {
    const value = (project as unknown as Record<string, unknown>)[field];
    if (!isPresent(value)) continue;
    lineage[field] = {
      source: 'gmail',
      source_ref: `email from ${senderShort}`,
      raw_value: value,
      set_at: project.created_at,
      set_by: 'gmail-sync',
      detail: `Read from the Gmail message sent by ${senderShort}.`,
    };
  }

  // ---- Priority: from ai_classification ----
  if (isPresent(project.priority)) {
    const aiPriority = aiClassification.priority as string | undefined;
    const matchesAi = aiPriority === project.priority;
    lineage['priority'] = {
      source: matchesAi ? 'ai_classify' : 'manual',
      source_ref: matchesAi ? 'Claude classifier' : 'manual override',
      confidence: matchesAi ? (aiClassification.confidence as number | undefined) : undefined,
      raw_value: aiClassification,
      set_at: project.updated_at,
      set_by: matchesAi ? 'claude-sonnet-4-6' : 'system',
      detail: matchesAi
        ? (aiClassification.reasoning as string | undefined) || 'Classified by Claude.'
        : 'Overridden after classification.',
    };
  }

  // ---- AI-extracted fields ----
  for (const field of AI_EXTRACT_FIELDS) {
    const projectValue = (project as unknown as Record<string, unknown>)[field];
    if (!isPresent(projectValue)) continue;

    const aiValue = aiExtraction[field];
    const aiHadValue = isPresent(aiValue);

    if (aiHadValue) {
      // Claude extracted this value
      lineage[field] = {
        source: 'ai_extract',
        source_ref: `Claude extract (email + drawings)`,
        confidence: aiClassification.confidence as number | undefined,
        raw_value: aiValue,
        set_at: project.updated_at,
        set_by: 'claude-sonnet-4-6',
        detail: 'Extracted by Claude from the email body and attached drawings.',
      };
    } else if (isTest && fixtureTemplate) {
      // Patched from fixture fallback
      lineage[field] = {
        source: 'fixture',
        source_ref: `test-rfq-${fixtureTemplate}.json`,
        raw_value: projectValue,
        set_at: project.updated_at,
        set_by: 'seed-test-rfq',
        detail: `Seeded from the "${fixtureTemplate}" test fixture (Claude extraction returned empty).`,
      };
    } else {
      // Value present but no AI source — assume manual override or unknown
      lineage[field] = {
        source: 'manual',
        raw_value: projectValue,
        set_at: project.updated_at,
        set_by: 'unknown',
        detail: 'Set manually (no AI extraction record).',
      };
    }
  }

  // ---- building_type can also be inferred locally ----
  // lib/estimation-engine.ts:51-70 has a keyword-based fallback. If
  // ai_extraction.building_type is null but project.building_type is set, it
  // may have come from the inference. Detect this when ai_extraction was
  // attempted (i.e. ai_extraction object exists but field is null) AND no
  // fixture flag is set.
  if (
    isPresent(project.building_type) &&
    !isPresent(aiExtraction.building_type) &&
    !isTest &&
    Object.keys(aiExtraction).length > 0
  ) {
    lineage['building_type'] = {
      source: 'computed',
      source_ref: 'lib/estimation-engine.ts:inferBuildingType',
      raw_value: project.building_type,
      set_at: project.updated_at,
      set_by: 'system',
      detail: 'Inferred locally from email keywords (no Claude confidence).',
      formula: 'keyword match → typeMap',
    };
  }

  // ---- Status: from state machine ----
  if (isPresent(project.status)) {
    lineage['status'] = {
      source: 'state_machine',
      raw_value: project.status,
      set_at: project.updated_at,
      set_by: 'system',
      detail: 'Set by pipeline gate transitions.',
    };
  }

  // ---- final_quote_aed: computed from estimation ----
  if (isPresent(project.final_quote_aed)) {
    lineage['final_quote_aed'] = {
      source: 'computed',
      raw_value: project.final_quote_aed,
      set_at: project.updated_at,
      set_by: 'system',
      detail: 'Final quote = subtotal × (1 + margin%). Aggregated from sabi_estimations.',
      formula: 'sum(services.total_aed) × (1 + 0.15)',
    };
  }

  // ---- Cross-reference activity log for set_at refinement ----
  // The most recent activity log entry that touches a field is a more accurate
  // "set_at" timestamp than project.updated_at (which may have been touched by
  // unrelated updates).
  if (activityLog) {
    for (const field of Object.keys(lineage)) {
      const log = findLogFor(activityLog, field);
      if (log) {
        lineage[field] = {
          ...lineage[field],
          set_at: log.created_at,
        };
      }
    }
  }

  // Also surface known service-derived totals (cheap wins)
  if (services && services.length > 0) {
    const totalKw = services
      .map((s) => s.total_kw || 0)
      .reduce((a, b) => a + b, 0);
    if (totalKw > 0) {
      lineage['__hvac_total_kw'] = {
        source: 'computed',
        raw_value: totalKw,
        detail: `Sum of total_kw across ${services.length} service rows.`,
        formula: 'sum(services.total_kw)',
      };
    }
  }

  return lineage;
}

// ---------------------------------------------------------------------------
// Service lineage derivation (per-row)
// ---------------------------------------------------------------------------

/**
 * Find a likely source drawing name for a service. Looks at the service's
 * ai_extraction.steps[] (set by the estimation engine for HVAC) and falls back
 * to scanning the project's attachments for a matching discipline.
 */
function findSourceDrawing(
  service: Service,
  attachments: Attachment[] | undefined,
  needle: string
): string | undefined {
  const ai = (service.ai_extraction || {}) as Record<string, unknown>;
  const steps = (ai.steps as Array<Record<string, unknown>> | undefined) || [];
  for (const step of steps) {
    const result = (step.result as string | undefined) || '';
    const desc = (step.description as string | undefined) || '';
    if ((result + desc).toLowerCase().includes(needle.toLowerCase())) {
      // Try to find a quoted filename in the result string
      const m = result.match(/['"]([^'"]+\.(pdf|dwg|xlsx?|docx?|csv|txt))['"]/i);
      if (m) return m[1];
    }
  }
  // Fallback: look at attachments matching the discipline
  if (attachments) {
    const att = attachments.find(
      (a) =>
        a.discipline === service.service_type ||
        (a.filename || '').toLowerCase().includes(needle.toLowerCase())
    );
    if (att) return att.filename;
  }
  return undefined;
}

export function deriveServiceLineage(
  service: Service,
  attachments?: Attachment[]
): ProjectLineage {
  const lineage: ProjectLineage = {};
  const ai = (service.ai_extraction || {}) as Record<string, unknown>;
  const hasAi = Object.keys(ai).length > 0;
  const drawing = (att: string) => findSourceDrawing(service, attachments, att);

  if (isPresent(service.system_type)) {
    const ref = drawing('equipment schedule') || drawing('schedule') || 'equipment schedule';
    lineage['system_type'] = {
      source: hasAi ? 'ai_vision' : 'unknown',
      source_ref: hasAi ? `from ${ref}` : undefined,
      raw_value: service.system_type,
      set_at: service.updated_at,
      set_by: hasAi ? 'claude-sonnet-4-6' : 'system',
      detail: hasAi
        ? `Identified by Claude vision from ${ref}.`
        : 'Set by the estimation engine.',
    };
  }

  if (isPresent(service.total_kw)) {
    const ref = drawing('thermal load') || drawing('load summary') || 'thermal load summary';
    lineage['total_kw'] = {
      source: hasAi ? 'ai_vision' : 'unknown',
      source_ref: hasAi ? `from ${ref}` : undefined,
      raw_value: service.total_kw,
      set_at: service.updated_at,
      set_by: hasAi ? 'claude-sonnet-4-6' : 'system',
      detail: `Total calculated kW read from ${ref}.`,
    };
  }

  if (isPresent(service.fahu_kw)) {
    const ref = drawing('equipment schedule') || drawing('fahu') || 'equipment schedule';
    lineage['fahu_kw'] = {
      source: hasAi ? 'ai_vision' : 'unknown',
      source_ref: hasAi ? `from ${ref}` : undefined,
      raw_value: service.fahu_kw,
      set_at: service.updated_at,
      set_by: hasAi ? 'claude-sonnet-4-6' : 'system',
      detail: `Fresh Air Handling Unit kW read from ${ref}.`,
    };
  }

  if (isPresent(service.ac_unit_kw)) {
    lineage['ac_unit_kw'] = {
      source: 'computed',
      source_ref: 'calc: total kW − FAHU kW',
      raw_value: service.ac_unit_kw,
      detail: 'AC unit kW = total_kw − fahu_kw.',
      formula: `${service.total_kw || '?'} − ${service.fahu_kw || 0} = ${service.ac_unit_kw}`,
    };
  }

  if (isPresent(service.tonnage)) {
    lineage['tonnage'] = {
      source: 'computed',
      source_ref: 'calc: kW ÷ 3.517',
      raw_value: service.tonnage,
      detail: 'Tonnage = AC unit kW ÷ 3.517 (KW_TO_TR).',
      formula: `${service.ac_unit_kw || service.total_kw || '?'} ÷ 3.517 = ${service.tonnage}`,
    };
  }

  if (isPresent(service.unit_rate_aed)) {
    const rateSource = (ai.rate_source as string | undefined) || 'ERP Realsoft rate table';
    lineage['unit_rate_aed'] = {
      source: 'rate_table',
      source_ref: rateSource,
      raw_value: service.unit_rate_aed,
      detail: `Unit rate looked up by service_type and system_type from ${rateSource}.`,
    };
  }

  if (isPresent(service.total_aed)) {
    const formula =
      service.tonnage && service.unit_rate_aed
        ? `${service.tonnage} TR × AED ${service.unit_rate_aed}`
        : 'sum(line items)';
    lineage['total_aed'] = {
      source: 'computed',
      source_ref: `calc: ${formula}`,
      raw_value: service.total_aed,
      detail: 'Service total = quantity × unit_rate_aed (or component sum for non-HVAC).',
      formula:
        service.tonnage && service.unit_rate_aed
          ? `${service.tonnage} TR × AED ${service.unit_rate_aed} = AED ${service.total_aed}`
          : 'sum(component subtotals)',
    };
  }

  return lineage;
}

// ---------------------------------------------------------------------------
// Spec analysis lineage (project.ai_extraction.spec_analysis)
// ---------------------------------------------------------------------------

export function deriveSpecLineage(project: Project): ProjectLineage {
  const lineage: ProjectLineage = {};
  const aiExtraction = (project.ai_extraction || {}) as Record<string, unknown>;
  const spec = (aiExtraction.spec_analysis as Record<string, unknown> | undefined) || {};

  for (const key of ['materials', 'requirements', 'approved_makes', 'standards_referenced']) {
    if (isPresent(spec[key])) {
      lineage[key] = {
        source: 'ai_extract',
        source_ref: 'Claude spec analysis',
        raw_value: spec[key],
        set_at: project.updated_at,
        set_by: 'claude-sonnet-4-6',
        detail: `Extracted from the project specification documents by Claude.`,
      };
    }
  }

  return lineage;
}

// ---------------------------------------------------------------------------
// Attachment lineage (per attachment row)
// ---------------------------------------------------------------------------

export function deriveAttachmentLineage(attachment: Attachment): ProjectLineage {
  const lineage: ProjectLineage = {};

  if (isPresent(attachment.filename)) {
    lineage['filename'] = {
      source: 'gmail',
      source_ref: 'email attachment',
      raw_value: attachment.filename,
      set_at: attachment.created_at,
      set_by: 'gmail-sync',
      detail: 'Filename from the original Gmail message attachment.',
    };
  }

  if (isPresent(attachment.file_type)) {
    lineage['file_type'] = {
      source: 'computed',
      source_ref: 'calc: by extension',
      raw_value: attachment.file_type,
      detail: 'Classified by file extension (.pdf → drawing_pdf, .xlsx → schedule_excel, etc.).',
      formula: `extension(${attachment.filename}) → ${attachment.file_type}`,
    };
  }

  if (isPresent(attachment.discipline)) {
    lineage['discipline'] = {
      source: 'ai_vision',
      source_ref: `Claude vision (${attachment.filename})`,
      raw_value: attachment.discipline,
      set_at: attachment.created_at,
      set_by: 'claude-sonnet-4-6',
      detail: `Discipline classified by Claude vision on ${attachment.filename}.`,
    };
  }

  if (attachment.extracted_data) {
    lineage['extracted_data'] = {
      source: 'ai_vision',
      source_ref: `Claude vision (${attachment.filename})`,
      raw_value: '[extracted text + tables]',
      set_at: attachment.created_at,
      set_by: 'claude-sonnet-4-6',
      detail: `Text and tables extracted by Claude vision from ${attachment.filename}.`,
    };
  }

  return lineage;
}

// ---------------------------------------------------------------------------
// BOQ lineage (estimation totals)
// ---------------------------------------------------------------------------

export function deriveBoqLineage(
  project: Project,
  services: Service[]
): ProjectLineage {
  const lineage: ProjectLineage = {};
  const required = services.filter((s) => s.is_required && s.total_aed);
  const subtotal = required.reduce((sum, s) => sum + (s.total_aed || 0), 0);
  const margin = 15;

  if (subtotal > 0) {
    lineage['subtotal'] = {
      source: 'computed',
      source_ref: `calc: sum of ${required.length} services`,
      raw_value: subtotal,
      detail: `Subtotal = sum of ${required.length} required service totals.`,
      formula: required.map((s) => `${s.service_type}: ${s.total_aed}`).join(' + '),
    };

    lineage['margin_percent'] = {
      source: 'default',
      source_ref: 'lib/constants.ts',
      raw_value: margin,
      detail: 'Default margin from DEFAULT_MARGIN_PERCENT constant.',
    };

    lineage['final_quote_aed'] = {
      source: 'computed',
      source_ref: `calc: subtotal × 1.${margin}`,
      raw_value: subtotal * (1 + margin / 100),
      detail: 'Final quote = subtotal × (1 + margin%).',
      formula: `${subtotal} × ${1 + margin / 100} = ${subtotal * (1 + margin / 100)}`,
    };
  }

  if (isPresent(project.total_area_sqft) && subtotal > 0) {
    lineage['cost_per_sqft_aed'] = {
      source: 'computed',
      source_ref: `calc: subtotal ÷ ${project.total_area_sqft} sqft`,
      raw_value: subtotal / project.total_area_sqft!,
      detail: 'Cost per square foot = subtotal ÷ total area.',
      formula: `${subtotal} ÷ ${project.total_area_sqft} = ${(subtotal / project.total_area_sqft!).toFixed(2)}`,
    };
  }

  return lineage;
}
