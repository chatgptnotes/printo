import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

// DELETE: remove a single item from a folder. The referenced file/row is
// left untouched — folder items are only references.
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { error } = await supabaseAdmin
      .from('sabi_folder_items')
      .delete()
      .eq('id', params.itemId)
      .eq('folder_id', params.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to delete item', details: message }, { status: 500 });
  }
}
