import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { DEFAULT_REPLY_TEMPLATES } from '@/lib/email/reply-templates';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

// GET: return current reply templates (from DB if available, else defaults)
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { data } = await supabaseAdmin
      .from('sabi_settings')
      .select('value')
      .eq('key', 'reply_templates')
      .single();

    if (data?.value) {
      const templates = (data.value as any).templates;
      if (Array.isArray(templates) && templates.length > 0) {
        return NextResponse.json({ source: 'database', templates });
      }
    }
  } catch {
    // Table doesn't exist yet or no entry — use defaults
  }

  return NextResponse.json({ source: 'defaults', templates: DEFAULT_REPLY_TEMPLATES });
}

// POST: save updated templates to DB
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { templates } = await request.json();

    if (!Array.isArray(templates)) {
      return NextResponse.json({ error: 'templates must be an array' }, { status: 400 });
    }

    // Validate each template has required fields
    for (const t of templates) {
      if (!t.key || !t.label || !t.body) {
        return NextResponse.json({ error: 'Each template needs key, label, and body' }, { status: 400 });
      }
    }

    const { error } = await supabaseAdmin
      .from('sabi_settings')
      .upsert(
        { key: 'reply_templates', value: { templates }, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );

    if (error) throw error;

    return NextResponse.json({ saved: true, count: templates.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
