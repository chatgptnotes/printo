import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Fetch projects (without final_quote_aed which may not exist on all DBs)
    const { data: projects, error } = await supabaseAdmin
      .from('sabi_projects')
      .select('id, client_name, email_from, project_name, email_subject, status, created_at, priority')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Fetch estimations to get quote amounts
    const { data: estimations } = await supabaseAdmin
      .from('sabi_estimations')
      .select('project_id, final_quote_aed');

    const quoteMap = new Map((estimations || []).map(e => [e.project_id, e.final_quote_aed || 0]));

    // Aggregate by client email
    const clientMap = new Map<string, {
      email: string;
      name: string;
      projects: { id: string; project_name: string | null; email_subject: string; status: string; final_quote_aed: number; created_at: string }[];
      totalQuoted: number;
      projectCount: number;
      wonCount: number;
      sentCount: number;
      lastActivity: string;
    }>();

    for (const p of projects || []) {
      const email = (p.email_from || '').toLowerCase().trim();
      if (!email) continue;
      const quote = quoteMap.get(p.id) || 0;
      const projectWithQuote = { ...p, final_quote_aed: quote };

      const existing = clientMap.get(email);
      if (existing) {
        existing.projects.push(projectWithQuote);
        existing.projectCount++;
        existing.totalQuoted += quote;
        if (p.status === 'won') existing.wonCount++;
        if (p.status === 'sent') existing.sentCount++;
        if (!existing.name && p.client_name) existing.name = p.client_name;
        if (p.created_at > existing.lastActivity) existing.lastActivity = p.created_at;
      } else {
        clientMap.set(email, {
          email,
          name: p.client_name || email,
          projects: [projectWithQuote],
          totalQuoted: quote,
          projectCount: 1,
          wonCount: p.status === 'won' ? 1 : 0,
          sentCount: p.status === 'sent' ? 1 : 0,
          lastActivity: p.created_at,
        });
      }
    }

    const clients = Array.from(clientMap.values())
      .sort((a, b) => b.projectCount - a.projectCount);

    return NextResponse.json({ clients });
  } catch (error: any) {
    return NextResponse.json({ error: error.message, clients: [] }, { status: 500 });
  }
}
