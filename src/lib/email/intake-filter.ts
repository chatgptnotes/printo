/**
 * Email intake filter — the single "is this a BOQ/RFQ enquiry, or junk?" decision.
 *
 * Used by BOTH the live inbox scan (`/api/cron/poll-inbox`) and the one-off
 * backfill (`/api/admin/reclassify-intake`) so the two can never drift.
 *
 * Decision order (first hit wins):
 *   1. Known non-RFQ sender  → ignore
 *   2. Gmail category label (Promotions / Social / Forums / Spam) → ignore
 *   3. No RFQ keyword in subject/body → ignore
 *   4. Otherwise admit — priority comes from the existing rules-only
 *      `classifyEmail()` scorer.
 *
 * The label gate (2) is the load-bearing fix: the inbox we scan is a general
 * Gmail, and Gmail already buckets newsletters/marketing/social into category
 * labels that ride along on every synced message (`sabi_emails.labels`). A
 * genuine client RFQ lands in Primary/Personal/Updates, never in those buckets,
 * so this rejects junk without dropping real enquiries.
 */
import { classifyEmail } from '@/lib/ai/ai-provider';

/**
 * Gmail category labels that mark an email as non-RFQ. Deliberately excludes
 * CATEGORY_UPDATES — legit transactional / client mail can be auto-filed there.
 */
export const IGNORE_LABELS = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS', 'SPAM'];

/**
 * RFQ keyword pre-filter list. Generous on purpose: a false positive (junk that
 * slips past here) is caught by the sender + label gates, whereas a false
 * negative (a real RFQ using none of these words) is silently lost.
 */
export const RFQ_KEYWORDS = [
  // Quote language
  'rfq', 'rfp', 'quotation', 'quotations', 'quote', 'quotes', 'requote',
  'kindly quote', 'please quote', 'request for quote', 'request for quotation',
  'request for proposal', 'tender', 'tendering', 'bid', 'bidding', 'proposal',
  'proposals', 'pricing', 'estimate', 'estimates', 'estimation', 'estimating',
  'budgetary', 'enquiry', 'enquiries', 'inquiry', 'inquiries',
  // BOQ / scope
  'boq', 'bill of quantities', 'scope of work', 'sow',
  // MEP disciplines (typical in subject/body of MEP RFQs)
  'mep', 'electrical', 'hvac', 'plumbing', 'sanitary', 'firefighting',
  'fire fighting', 'fire alarm', 'low current', 'mechanical',
  'air conditioning', 'cabling',
  // Common RFQ phrasing
  'supply and install', 'supply & install', 'design and build', 'subcontract',
  'sub-contract', 'sub contractor',
  // Drawings / submittals
  'tender drawings', 'shop drawings', 'gfc drawings', 'ifc drawings',
  'submittal',
];

/**
 * Known non-RFQ senders — auto-ignored without any keyword check. Matched as a
 * substring against the lowercased From header, so a domain fragment is enough.
 */
const AUTO_IGNORE_SENDERS = [
  // Infra / transactional
  'vercel.com', 'supabase.com', 'github.com', 'google.com', 'googlealerts',
  'noreply', 'no-reply', 'mailer-daemon',
  // Marketing / social / finance noise seen in the scanned inbox
  'linkedin', 'flipkart', 'lpu.', '@lpu', 'nipponindia', 'unstop', 'naukri',
  'sbicard.com', 'bniconnect', 'bsnl', 'indiamart', 'amazon', 'paytm',
  'phonepe', 'swiggy', 'zomato', 'facebookmail', 'instagram', 'twitter',
  'quora', 'medium.com', 'mutualfund', 'angelone', 'zerodha', 'groww',
];

export function isAutoIgnore(from: string): boolean {
  const f = (from || '').toLowerCase();
  return AUTO_IGNORE_SENDERS.some(s => f.includes(s));
}

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole-word keyword test. Uses alphanumeric lookaround instead of substring
 * `.includes()` so weak tokens (`bid`, `sow`, `mep`) don't match inside
 * unrelated words ("forbidden", "Moscow", "complete").
 */
export function hasRfqKeywords(subject: string, body: string): boolean {
  const dehtmled = (body || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ');
  const haystack = `${subject || ''} ${dehtmled.slice(0, 5000)}`.toLowerCase();
  return RFQ_KEYWORDS.some(kw => {
    const re = new RegExp(`(?<![a-z0-9])${escapeRegExp(kw.toLowerCase())}(?![a-z0-9])`);
    return re.test(haystack);
  });
}

export interface IntakeDecision {
  isRfq: boolean;
  priority: string;
  confidence: number;
  reasoning: string;
  classifier: string;
  keywordsFound?: string[];
}

/**
 * The whole admit/reject + priority decision for one email. Async because the
 * admit path delegates priority scoring to `classifyEmail()`.
 */
export async function decideIntake(input: {
  from: string;
  subject: string;
  body: string;
  labels?: string[] | null;
}): Promise<IntakeDecision> {
  const { from, subject, body } = input;
  const labels = input.labels || [];

  if (isAutoIgnore(from)) {
    return { isRfq: false, priority: 'ignore', confidence: 1, reasoning: 'Auto-ignored: known non-RFQ sender', classifier: 'auto-ignore' };
  }

  const ignoreLabel = labels.find(l => IGNORE_LABELS.includes(l));
  if (ignoreLabel) {
    return { isRfq: false, priority: 'ignore', confidence: 1, reasoning: `Auto-ignored: Gmail category ${ignoreLabel}`, classifier: 'label-filter' };
  }

  if (!hasRfqKeywords(subject, body)) {
    return { isRfq: false, priority: 'ignore', confidence: 0.9, reasoning: 'No RFQ keywords in subject/body', classifier: 'keyword-filter' };
  }

  // Admitted — score priority with the existing rules-only classifier.
  const c = await classifyEmail(subject, body, from);
  return {
    isRfq: true,
    priority: c.priority,
    confidence: c.confidence,
    reasoning: c.reasoning,
    classifier: 'rules-classify',
    keywordsFound: c.keywordsFound,
  };
}
