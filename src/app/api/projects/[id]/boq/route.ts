import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';
import { runBoqGeneration } from '@/lib/pipeline/boq-orchestrator';

export const dynamic = 'force-dynamic';
// BOQ generation with ExcelJS on a 20-service project can exceed the default
// 10s limit. 300s is the Vercel Pro max.
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const result = await runBoqGeneration(params.id);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.details && { details: result.details }) },
      { status: result.httpStatus }
    );
  }

  return NextResponse.json({
    filename: result.filename,
    storagePath: result.storagePath,
    size: result.size,
  });
}

// GET: Download the generated BOQ
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = params;

    const { data: estimation } = await supabaseAdmin
      .from('sabi_estimations')
      .select('generated_boq_url')
      .eq('project_id', id)
      .limit(1)
      .single();

    if (!estimation?.generated_boq_url) {
      return NextResponse.json({ error: 'No BOQ generated yet' }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin.storage
      .from('sabi-attachments')
      .download(estimation.generated_boq_url);

    if (error || !data) {
      return NextResponse.json({ error: 'Failed to download BOQ' }, { status: 500 });
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    const filename = estimation.generated_boq_url.split('/').pop() || 'BOQ.xlsx';

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to download BOQ', details: error.message },
      { status: 500 }
    );
  }
}
