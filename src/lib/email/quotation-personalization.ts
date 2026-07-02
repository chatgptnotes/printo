/**
 * Quotation personalization helper.
 *
 * Builds the warm, recipient-specific thank-you note that goes into both the
 * outgoing email body and the PDF cover letter — so the two stay in sync.
 *
 * Everything is template-driven from existing project/services/estimation data.
 * No AI calls — deterministic, fast, auditable. The output is a structured set
 * of pieces (greeting, opening, scope line, etc.) that the email and the PDF
 * format slightly differently.
 */

import type { Project, Service, Estimation } from '@/lib/shared/types';
import { SERVICE_LABELS } from '@/lib/shared/constants';

export interface PersonalizedNote {
  /** Salutation line, e.g. "Dear John," or "Dear Sir/Madam," */
  greeting: string;
  /** Opening sentence — thanks the client and references the original RFQ + date if known */
  opening: string;
  /** One sentence describing the scope of services priced */
  scopeLine: string;
  /** One sentence putting the project in context (building type, location, floors) */
  projectContextLine: string;
  /** Optional sentence about market positioning (only when yardstick is favourable) */
  yardstickLine: string | null;
  /** Closing sentence — warmer for priority_top clients */
  closing: string;
  /** Estimator signature name */
  signatureName: string;
  /** Estimator signature title */
  signatureTitle: string;
  /** Subject line for the email reply */
  emailSubject: string;
}

export function buildPersonalizedNote(
  project: Project,
  services: Service[],
  estimation: Estimation
): PersonalizedNote {
  const required = services.filter(s => s.is_required);

  // ─── Greeting ─────────────────────────────────────────────────────────
  // Try in order: parsed first name from "Name <email>" → company contact line → generic
  const firstName = parseFirstName(project.email_from);
  let greeting: string;
  if (firstName) {
    greeting = `Dear ${firstName},`;
  } else if (project.client_name) {
    greeting = `Dear ${project.client_name} Team,`;
  } else {
    greeting = 'Dear Sir/Madam,';
  }

  // ─── Opening ──────────────────────────────────────────────────────────
  const rfqDateStr = formatLongDate(project.email_date || project.created_at);
  const daysAgo = daysSince(project.email_date || project.created_at);
  const daysPhrase = daysAgo === 0
    ? 'received earlier today'
    : daysAgo === 1
      ? 'received yesterday'
      : daysAgo > 1 && daysAgo <= 14
        ? `received ${numberWord(daysAgo)} days ago`
        : '';

  const subjectClause = project.email_subject
    ? ` regarding "${truncate(project.email_subject, 80)}"`
    : '';

  const opening = rfqDateStr
    ? `Thank you for your enquiry of ${rfqDateStr}${daysPhrase ? ' (' + daysPhrase + ')' : ''}${subjectClause}. ` +
      `It is a pleasure to have the opportunity to quote for your project, and we sincerely appreciate the time you took to share the drawings and specifications with us.`
    : `Thank you for your enquiry${subjectClause}. ` +
      `It is a pleasure to have the opportunity to quote for your project, and we sincerely appreciate the time you took to share the drawings and specifications with us.`;

  // ─── Scope line ───────────────────────────────────────────────────────
  const scopeLine = buildScopeLine(required);

  // ─── Project context ──────────────────────────────────────────────────
  const projectContextLine = buildProjectContextLine(project);

  // ─── Yardstick callout ────────────────────────────────────────────────
  let yardstickLine: string | null = null;
  if (estimation.yardstick_status === 'within_range') {
    yardstickLine =
      'We have benchmarked our pricing against current Dubai market yardsticks, ' +
      'and we are pleased to confirm that this quotation falls comfortably within ' +
      'the competitive range for projects of this size and type.';
  }

  // ─── Closing ──────────────────────────────────────────────────────────
  let closing: string;
  if (project.priority === 'priority_top') {
    closing =
      'This is a project we hold in particularly high regard, and it would be a ' +
      'genuine privilege for ERP Realsoft to be entrusted with its delivery. Our entire ' +
      'team — from estimation through to site execution — stands ready to mobilise ' +
      'at your convenience. Please do not hesitate to call us on any clarification, ' +
      'at any hour. We thank you once again for considering ERP Realsoft.';
  } else {
    closing =
      'We would welcome the opportunity to discuss any item in this quotation, ' +
      'walk you through the assumptions, or explore alternatives that may better ' +
      'suit your budget and programme. Please feel free to reach out at your ' +
      'convenience — we are committed to making this process as smooth as possible ' +
      'for you. Thank you once again for the opportunity.';
  }

  // ─── Signature ────────────────────────────────────────────────────────
  // Today the signatory is always George Varkey M (Technical Director). If the
  // project assignee model is added later, we can swap that in here.
  const signatureName = 'George Varkey M';
  const signatureTitle = 'Technical Director';

  // ─── Email subject ────────────────────────────────────────────────────
  const emailSubject = project.email_subject
    ? `Re: ${project.email_subject}`
    : `Quotation for ${project.project_name || 'your project'} — ERP Realsoft`;

  return {
    greeting,
    opening,
    scopeLine,
    projectContextLine,
    yardstickLine,
    closing,
    signatureName,
    signatureTitle,
    emailSubject,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseFirstName(emailFrom: string | null | undefined): string | null {
  if (!emailFrom) return null;
  // Common formats:
  //   "John Smith <john@x.com>"
  //   "John Smith"
  //   "john@x.com"
  //   '"Smith, John" <john@x.com>'
  let raw = emailFrom.trim();

  // Strip <email> portion if present
  const angleIdx = raw.indexOf('<');
  if (angleIdx >= 0) raw = raw.slice(0, angleIdx).trim();

  // Strip surrounding quotes
  raw = raw.replace(/^["']+|["']+$/g, '').trim();

  // If it's still an email, no name to extract
  if (!raw || raw.includes('@')) return null;

  // "Smith, John" → "John"
  if (raw.includes(',')) {
    const after = raw.split(',')[1]?.trim();
    if (after) return capitalize(after.split(/\s+/)[0]);
  }

  // "John Smith" → "John"
  const first = raw.split(/\s+/)[0];
  if (!first) return null;

  // Reject obvious non-names (department aliases, role labels)
  if (/^(team|info|admin|support|projects?|sales|estimation|procurement|tender|tenders)$/i.test(first)) {
    return null;
  }

  return capitalize(first);
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function buildScopeLine(services: Service[]): string {
  if (services.length === 0) {
    return 'Our team has prepared a complete MEP estimate for your consideration.';
  }
  const labels = services.map(s => SERVICE_LABELS[s.service_type] || s.service_type);
  return `Our team has prepared a complete estimate covering ${joinNaturally(labels)}, ` +
    `with each discipline broken down to component level so you can clearly see what is included in every line.`;
}

function buildProjectContextLine(project: Project): string {
  const pieces: string[] = [];
  const projectName = project.project_name ? `"${project.project_name}"` : 'this project';
  pieces.push(`We have built this quotation specifically around ${projectName}`);

  const typeAndLocation: string[] = [];
  if (project.building_type) typeAndLocation.push(`a ${project.building_type.toLowerCase()}`);
  if (project.location) typeAndLocation.push(`located at ${project.location}`);
  if (typeAndLocation.length > 0) {
    pieces.push(typeAndLocation.join(' '));
  }

  const sizeBits: string[] = [];
  if (project.floors) sizeBits.push(`${project.floors} floor${project.floors === 1 ? '' : 's'}`);
  if (project.total_area_sqft) sizeBits.push(`${project.total_area_sqft.toLocaleString()} sqft of built-up area`);
  if (sizeBits.length > 0) {
    pieces.push(`comprising ${joinNaturally(sizeBits)}`);
  }

  return pieces.join(', ') + '.';
}

function joinNaturally(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function formatLongDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function daysSince(iso: string | null | undefined): number {
  if (!iso) return -1;
  const then = new Date(iso).getTime();
  if (isNaN(then)) return -1;
  const now = Date.now();
  return Math.max(0, Math.floor((now - then) / (24 * 60 * 60 * 1000)));
}

function numberWord(n: number): string {
  const words = [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
    'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  ];
  return words[n] || `${n}`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}
