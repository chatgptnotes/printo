import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

// GET: folder + its items (grouped client-side by kind).
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = params;

    const [folderRes, itemsRes] = await Promise.all([
      supabaseAdmin
        .from('sabi_project_folders')
        .select('id, name, description, created_at, updated_at')
        .eq('id', id)
        .single(),
      supabaseAdmin
        .from('sabi_folder_items')
        .select('id, folder_id, kind, label, mime_type, size_bytes, storage_path, gmail_message_id, gmail_attachment_id, ref_project_id, ref_email_id, source_table, source_id, added_at')
        .eq('folder_id', id)
        .order('kind', { ascending: true })
        .order('added_at', { ascending: true }),
    ]);

    if (folderRes.error) throw folderRes.error;

    return NextResponse.json({
      folder: { ...folderRes.data, items: itemsRes.data || [] },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to fetch folder', details: message }, { status: 500 });
  }
}

// DELETE: remove a folder (items cascade; underlying files are untouched).
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { error } = await supabaseAdmin
      .from('sabi_project_folders')
      .delete()
      .eq('id', params.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to delete folder', details: message }, { status: 500 });
  }
}
