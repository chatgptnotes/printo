import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';
import { requireAuth } from '@/lib/shared/api-auth';
import { resolveAttachmentBinary } from '@/lib/drawing/file-resolver';

export const dynamic = 'force-dynamic';

// GET: Convert a DOCX attachment to HTML for inline rendering
export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string; attachmentId: string } }
) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const result = await resolveAttachmentBinary(params.projectId, params.attachmentId);
  if ('error' in result) {
    return NextResponse.json(result.error, { status: result.status });
  }

  try {
    const conversion = await mammoth.convertToHtml({ buffer: result.buffer });
    return NextResponse.json({
      filename: result.filename,
      html: conversion.value,
      messages: conversion.messages.map((m) => ({ type: m.type, message: m.message })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'DOCX conversion failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
