import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

// GET: list all project-master folders with their item counts.
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const [foldersRes, itemsRes] = await Promise.all([
      supabaseAdmin
        .from('sabi_project_folders')
        .select('id, name, description, created_at, updated_at')
        .order('created_at', { ascending: false }),
      // Only folder_id — counts are aggregated in JS so we avoid N per-folder
      // count queries while keeping egress to a single tiny column.
      supabaseAdmin.from('sabi_folder_items').select('folder_id'),
    ]);

    if (foldersRes.error) throw foldersRes.error;

    const counts: Record<string, number> = {};
    for (const row of itemsRes.data || []) {
      const fid = (row as { folder_id: string }).folder_id;
      counts[fid] = (counts[fid] || 0) + 1;
    }

    const folders = (foldersRes.data || []).map((f: Record<string, unknown>) => ({
      ...f,
      item_count: counts[f.id as string] || 0,
    }));

    return NextResponse.json({ folders });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to fetch folders', details: message }, { status: 500 });
  }
}

// POST: create a folder { name, description? }
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const name = (body?.name || '').toString().trim();
    if (!name) {
      return NextResponse.json({ error: 'Folder name is required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('sabi_project_folders')
      .insert({ name, description: body?.description?.toString().trim() || null })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ folder: { ...data, item_count: 0 } }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to create folder', details: message }, { status: 500 });
  }
}
