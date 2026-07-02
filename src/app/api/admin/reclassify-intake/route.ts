import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { decideIntake } from '@/lib/email/intake-filter';
import { logActivity } from '@/lib/storage/activity-logger';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Backfill: re-run the intake filter over already-classified bids so junk that
 * was admitted before the Gmail-label gate existed gets moved to 'ignore'.
 *
 * Only touches rows still at status='classified' — anything a human has already
 * moved forward (extracted, bid decision, etc.) is left untouched.
 */
export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { data: projects, error } = await supabaseAdmin
      .from('sabi_projects')
      .select('id, email_id, email_from, email_subject, email_snippet, priority')
      .eq('status', 'classified')
      .limit(1000);

    if (error) throw new Error(error.message);
    if (!projects || projects.length === 0) {
      return NextResponse.json({ scanned: 0, changed: 0, ignored_now: 0 });
    }

    // Batch-load the source emails (labels + body) for projects that have one.
    const emailIds = projects.map(p => p.email_id).filter(Boolean) as string[];
    const emailById = new Map<string, { labels: string[] | null; subject: string | null; body_text: string | null; body_html: string | null }>();
    if (emailIds.length > 0) {
      const { data: emails } = await supabaseAdmin
        .from('sabi_emails')
        .select('id, labels, subject, body_text, body_html')
        .in('id', emailIds);
      for (const e of emails || []) emailById.set(e.id, e);
    }

    let changed = 0;
    let ignoredNow = 0;

    for (const p of projects) {
      const email = p.email_id ? emailById.get(p.email_id) : undefined;
      const subject = email?.subject || p.email_subject || '';
      const body = email?.body_html || email?.body_text || p.email_snippet || '';
      const labels = email?.labels ?? null;

      const decision = await decideIntake({ from: p.email_from || '', subject, body, labels });
      if (decision.priority === p.priority) continue;

      await supabaseAdmin
        .from('sabi_projects')
        .update({
          priority: decision.priority,
          ai_classification: { ...decision, _provider: decision.classifier },
          updated_at: new Date().toISOString(),
        })
        .eq('id', p.id);

      await logActivity(p.id, 0, 'Auto-Filter', 'completed', {
        reclassified: true,
        decision: decision.priority === 'ignore' ? 'ejected' : 'admitted',
        classifier: decision.classifier,
        reasoning: decision.reasoning,
        from_priority: p.priority,
        to_priority: decision.priority,
      });

      changed++;
      if (decision.priority === 'ignore') ignoredNow++;
    }

    return NextResponse.json({ scanned: projects.length, changed, ignored_now: ignoredNow });
  } catch (err: any) {
    console.error('Reclassify-intake error:', err);
    return NextResponse.json({ error: 'Reclassify failed', details: err.message }, { status: 500 });
  }
}
