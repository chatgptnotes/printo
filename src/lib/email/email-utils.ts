/**
 * Email parsing utilities — quoted reply stripping, signature removal,
 * charset detection, and field extraction helpers.
 */

/**
 * Strip quoted reply chains from an email body.
 * Handles common patterns from Gmail, Outlook, Apple Mail, and forwarded messages.
 * Operates on plain text (call AFTER HTML stripping).
 */
export function stripQuotedReplies(body: string): string {
  if (!body) return '';

  const lines = body.split(/\r?\n/);
  const cleaned: string[] = [];

  // Patterns that mark the start of a quoted reply chain
  const replyMarkers: RegExp[] = [
    /^On .+ wrote:\s*$/i,                                  // "On Mon, Apr 1, 2026 at 3:14 PM John wrote:"
    /^On .+,.+,.+ at .+,.+wrote:/i,                        // Gmail multi-line variant
    /^From:\s*.+/i,                                        // Outlook "From: ..." block
    /^-{2,}\s*Original Message\s*-{2,}/i,                  // Outlook divider
    /^-{2,}\s*Forwarded message\s*-{2,}/i,                 // Gmail forward divider
    /^_{5,}\s*$/,                                          // Long underscore separator (Outlook)
    /^Begin forwarded message:/i,                          // Apple Mail forward
    /^>{1,}/,                                              // Quoted lines starting with ">"
    /^Sent from my (iPhone|iPad|Android|mobile)/i,         // Mobile signature
    /^Get Outlook for (iOS|Android)/i,                     // Outlook mobile signature
  ];

  // Signature delimiter ("-- " on its own line per RFC 3676)
  const signatureMarker = /^-- ?$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Stop at signature delimiter
    if (signatureMarker.test(line.trim())) break;

    // Stop at any reply/forward marker
    if (replyMarkers.some(re => re.test(line.trim()))) break;

    cleaned.push(line);
  }

  return cleaned.join('\n').trim();
}

/**
 * Decode an email body buffer using a charset hint from MIME headers.
 * Falls back to UTF-8, then latin1.
 */
export function decodeEmailBuffer(buf: Buffer, charset?: string): string {
  const cs = (charset || 'utf-8').toLowerCase();

  // Node's Buffer supports a limited set of encodings natively.
  // Map common email charsets to supported equivalents.
  try {
    if (cs === 'utf-8' || cs === 'utf8' || cs === 'us-ascii' || cs === 'ascii') {
      return buf.toString('utf-8');
    }
    if (cs === 'iso-8859-1' || cs === 'latin1' || cs === 'latin-1') {
      return buf.toString('latin1');
    }
    if (cs === 'utf-16' || cs === 'utf16le' || cs === 'utf-16le') {
      return buf.toString('utf16le');
    }
    // For windows-1256 (Arabic), windows-1252, etc., use TextDecoder if available
    if (typeof TextDecoder !== 'undefined') {
      try {
        return new TextDecoder(cs).decode(buf);
      } catch {
        // Unknown encoding — fall through
      }
    }
    // Last resort
    return buf.toString('utf-8');
  } catch {
    return buf.toString('latin1');
  }
}

/**
 * Extract the charset value from a MIME Content-Type header value.
 * Returns null if not present.
 *   "text/html; charset=windows-1256" → "windows-1256"
 */
export function extractCharsetFromContentType(contentType?: string): string | null {
  if (!contentType) return null;
  const m = contentType.match(/charset\s*=\s*"?([^";\s]+)"?/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Extract numeric value with units from text using a list of label patterns.
 * Returns the first match, or null.
 */
function extractNumberWith(labels: string[], unit: RegExp, text: string): number | null {
  for (const label of labels) {
    const re = new RegExp(`${label}[:\\s]*([\\d,\\.]+)\\s*${unit.source}`, 'i');
    const m = text.match(re);
    if (m) {
      const num = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(num)) return num;
    }
  }
  return null;
}

/**
 * Extract HVAC tonnage in TR from text.
 * Looks for "Cooling Load: 1200 TR", "750 tons", "Total: 1500 TR", etc.
 */
export function extractHvacTonnage(text: string): number | null {
  const m = text.match(/(?:cooling\s+load|tonnage|total\s+tr|hvac\s+load)[:\s]*([\d,\.]+)\s*(?:tr|tons?|trs?)\b/i);
  if (m) {
    const num = parseFloat(m[1].replace(/,/g, ''));
    if (!isNaN(num)) return num;
  }
  // Bare "1500 TR" pattern as fallback
  const bare = text.match(/\b([\d,]+(?:\.\d+)?)\s*(?:tr|tons?|trs?)\b/i);
  if (bare) {
    const num = parseFloat(bare[1].replace(/,/g, ''));
    if (!isNaN(num) && num >= 5 && num <= 10000) return num; // sanity range
  }
  return null;
}

/**
 * Extract HVAC system type from text.
 */
export function extractHvacSystem(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes('vrf') && lower.includes('fahu')) return 'VRF with FAHU';
  if (lower.includes('vrf') || lower.includes('vrv')) return 'VRF';
  if (lower.includes('chiller')) return 'Chiller';
  if (lower.includes('package unit') || lower.includes('packaged unit')) return 'Package Unit';
  if (lower.includes('split unit') || lower.includes('split system')) return 'Split';
  if (lower.includes('dx unit') || lower.includes('dx system')) return 'DX';
  return null;
}

/**
 * Extract building type from text using common keywords.
 */
export function extractBuildingType(text: string): string | null {
  const lower = text.toLowerCase();
  // Order matters: more specific first
  const types: Array<[string, string[]]> = [
    ['hospital', ['hospital', 'medical center', 'clinic', 'healthcare facility']],
    ['hotel', ['hotel', 'resort', 'serviced apartment']],
    ['restaurant', ['restaurant', 'cafeteria', 'food court']],
    ['warehouse', ['warehouse', 'logistics', 'storage facility', 'industrial']],
    ['villa', ['villa', 'townhouse', 'compound']],
    ['retail', ['retail', 'mall', 'showroom', 'shop']],
    ['office', ['office', 'commercial tower', 'business center', 'corporate']],
    ['residential', ['residential', 'apartment', 'tower', 'building']],
  ];
  for (const [type, keywords] of types) {
    if (keywords.some(kw => lower.includes(kw))) return type;
  }
  return null;
}

/**
 * Extract a deadline date from text. Returns ISO date string (YYYY-MM-DD) or null.
 *
 * Strategy:
 *   1. Label-prefixed regex ("submission deadline: ...") — fastest, deterministic.
 *   2. chrono-node natural-language parse on the same labelled snippets — catches
 *      "by next Thursday", "before EoM May", "30 May 2026" etc. that the
 *      simple Date.parse fallback used to miss.
 *   3. Last-ditch chrono-node parse over the whole text — picks up bare dates.
 *
 * Library cost: chrono-node ≈ 220 KB, pure JS, no native deps.
 */
export function extractDeadline(text: string): string | null {
  const labels = [
    'submission deadline',
    'submission date',
    'due date',
    'closing date',
    'deadline',
    'tender closing',
    'submit by',
    'reply by',
    'before',
    'by',
  ];

  // Tier 1: label + structured date
  for (const label of labels) {
    const re = new RegExp(`${label}[:\\s]+([^\\n,;]+)`, 'i');
    const m = text.match(re);
    if (m) {
      const parsed = parseDateString(m[1].trim());
      if (parsed) return parsed;
      // Tier 2: hand the labelled snippet to chrono-node
      const fromChrono = parseWithChrono(m[1].trim());
      if (fromChrono) return fromChrono;
    }
  }

  // Tier 3: chrono over the whole haystack — last resort, only if nothing
  // else matched. Returns the FIRST date it finds; OK for short RFQ bodies
  // where the deadline is usually the only date mentioned.
  const fallback = parseWithChrono(text.substring(0, 4000));
  if (fallback) return fallback;

  return null;
}

function parseWithChrono(input: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const chrono = require('chrono-node');
    const results = chrono.parse(input, new Date(), { forwardDate: true });
    if (!results || results.length === 0) return null;
    const date: Date = results[0].start.date();
    if (isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    if (year < 2020 || year > 2100) return null;
    return date.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

/**
 * Parse a free-form date string into ISO format. Returns null on failure.
 */
function parseDateString(s: string): string | null {
  // Try direct Date.parse
  const d = new Date(s);
  if (!isNaN(d.getTime()) && d.getFullYear() > 2020 && d.getFullYear() < 2100) {
    return d.toISOString().split('T')[0];
  }
  // Try DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const day = parseInt(m[1]);
    const month = parseInt(m[2]);
    let year = parseInt(m[3]);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const iso = new Date(Date.UTC(year, month - 1, day));
      if (!isNaN(iso.getTime())) return iso.toISOString().split('T')[0];
    }
  }
  return null;
}

/**
 * Extract consultant/engineering firm name from text.
 */
export function extractConsultant(text: string): string | null {
  const m = text.match(/(?:consultant|engineer|architect)[:\s]+([^\n,;]+)/i);
  return m ? m[1].trim() : null;
}
