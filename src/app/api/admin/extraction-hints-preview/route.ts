/**
 * GET /api/admin/extraction-hints-preview
 *
 * Returns the current extraction-prior-hints snippet that gets injected into
 * `extractProjectInfo`'s Sonnet prompt (Phase 9). Lets the operator see
 * exactly what augmentation the AI was given on its last extraction call.
 *
 * The snippet is built by `getExtractionPriorHints()` from sabi_corrections;
 * empty string when no actionable corrections exist (≥3 of any field in last
 * 90 days). UI shows "AI prompt is being augmented with N field warnings"
 * when non-empty.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/shared/api-auth';
import { getExtractionPriorHints } from '@/lib/ai/extraction-hints';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const snippet = await getExtractionPriorHints();
  // Count of `- **field**` lines = number of fields warned about
  const fieldsWarned = (snippet.match(/^- \*\*[a-z_]+\*\*:/gm) ?? []).length;

  return NextResponse.json({
    enabled: snippet.length > 0,
    fields_warned: fieldsWarned,
    snippet,
  });
}
