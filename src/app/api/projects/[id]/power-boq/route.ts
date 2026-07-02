import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';
import { generateElectricalPowerBOQ } from '@/lib/pdf/boq-pdf-generator';
import { generateDubaiIndustryBoqXlsx } from '@/lib/excel/dubai-industry-boq-xlsx';
import { tryLoadFixturePdf, tryLoadFixtureXlsx } from '@/lib/ai/test-fixture-replay';
import { enrichElectricalResult } from '@/lib/electrical/derive-cable-paths';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST: regenerate Power BOQ deliverables (PDF + Dubai industry XLSX) without
// going through Gate 14 again. Idempotent — safe to call repeatedly.
// The Gate 14 approval flow in /api/projects/[id]/gate also generates these
// artefacts; this endpoint is for re-rendering after BOQ inputs change.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = params;
  try {
    const { data: project, error: projErr } = await supabaseAdmin
      .from('sabi_projects')
      .select('*')
      .eq('id', id)
      .single();
    if (projErr || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // ── 1. Regenerate the 12-section consultant PDF ────────────────────
    // Fixture replay: if estimate ran from a captured fixture, serve the
    // captured PDF instead of rendering. Stamped into notes.fixture_key.
    let fixtureKey: string | null = null;
    try {
      const n = project.notes ? JSON.parse(project.notes) : {};
      fixtureKey = typeof n.fixture_key === 'string' ? n.fixture_key : null;
    } catch { /* notes not JSON */ }
    const fixturePdf = fixtureKey ? await tryLoadFixturePdf(fixtureKey) : null;
    const pdfBuffer = fixturePdf ?? await generateElectricalPowerBOQ(project, id);
    if (fixturePdf) {
      console.log(`[power-boq] FIXTURE PDF replay key=${fixtureKey!.slice(0, 12)}…`);
    }
    const pdfPath = `boq/${id}/power-boq.pdf`;
    const { error: pdfErr } = await supabaseAdmin.storage
      .from('sabi-attachments')
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });
    if (pdfErr) {
      return NextResponse.json({ error: 'PDF upload failed', details: pdfErr.message }, { status: 500 });
    }

    // ── 2. Regenerate the Dubai industry 13-bill XLSX (best-effort) ────
    let xlsxPath: string | null = null;
    let xlsxError: string | null = null;
    try {
      const { data: svc } = await supabaseAdmin
        .from('sabi_services')
        .select('ai_extraction')
        .eq('project_id', id)
        .eq('service_type', 'electrical')
        .single();
      const electricalRaw = (svc?.ai_extraction as Record<string, unknown> | null)?.['raw_electrical_procedure'] || null;
      // Enrich on read: derives lv_to_smdb_cables / smdb_to_db_cables from
      // cable_schedule and itemizes aggregated DB rows (DB-T01 to DB-T15).
      // Lets old bids — scanned before this enrichment landed — produce the
      // improved 56-row Bill 4 / itemized Step 13 BOQ on regeneration without
      // needing a re-extraction.
      const electrical = electricalRaw ? enrichElectricalResult(electricalRaw as Parameters<typeof enrichElectricalResult>[0]) : null;

      const fixtureXlsx = fixtureKey ? await tryLoadFixtureXlsx(fixtureKey) : null;
      const xlsxBuffer = fixtureXlsx ?? await generateDubaiIndustryBoqXlsx({
        project,
        electrical,
        overrides: {},
        options: {
          contingency_pct: 0.10,
          vat_pct: 0.05,
          currency: 'AED',
          status: 'PRICED (INDICATIVE) — Dubai 2026 market rates · review before submission',
        },
      });
      if (fixtureXlsx) {
        console.log(`[power-boq] FIXTURE XLSX replay key=${fixtureKey!.slice(0, 12)}…`);
      }
      xlsxPath = `boq/${id}/power-boq-industry.xlsx`;
      const { error: xlsxErr } = await supabaseAdmin.storage
        .from('sabi-attachments')
        .upload(xlsxPath, xlsxBuffer, {
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          upsert: true,
        });
      if (xlsxErr) {
        console.error(`Industry XLSX upload failed for ${id}:`, xlsxErr.message);
        xlsxPath = null;
        xlsxError = `Excel upload failed: ${xlsxErr.message}`;
      } else {
        // Activate the existing "Download BOQ (Excel)" UI button.
        // project_id has no DB-level UNIQUE constraint so onConflict upsert
        // silently fails; use SELECT-then-update/insert instead.
        const { data: existing } = await supabaseAdmin
          .from('sabi_estimations')
          .select('id')
          .eq('project_id', id)
          .maybeSingle();
        if (existing) {
          await supabaseAdmin
            .from('sabi_estimations')
            .update({ generated_boq_url: xlsxPath, updated_at: new Date().toISOString() })
            .eq('id', existing.id);
        } else {
          await supabaseAdmin
            .from('sabi_estimations')
            .insert({ project_id: id, generated_boq_url: xlsxPath });
        }
      }
    } catch (xlsxGenErr) {
      const message = xlsxGenErr instanceof Error ? xlsxGenErr.message : 'Unknown error';
      console.error(`Industry XLSX generation failed for ${id} (PDF still uploaded):`, message);
      xlsxPath = null;
      xlsxError = `Excel generation failed: ${message}`;
    }

    // ── 3. Merge boq paths into existing notes ─────────────────────────
    // Don't overwrite approval_gate — the gate route owns gate progression.
    // If this endpoint is called *after* the project has moved past gate 14
    // (e.g. status='sending' or 'consent_pending'), regenerating the PDF
    // shouldn't drag the UI back to a stale "Approve Gate 14" card.
    let existingNotes: Record<string, unknown> = {};
    try { existingNotes = project.notes ? JSON.parse(project.notes) : {}; } catch { /* not JSON */ }
    const mergedNotes = {
      ...existingNotes,
      boq_pdf_path: pdfPath,
      ...(xlsxPath ? { boq_xlsx_path: xlsxPath } : {}),
      ...(fixtureKey ? { fixture_key: fixtureKey } : {}),
    };
    await supabaseAdmin
      .from('sabi_projects')
      .update({
        notes: JSON.stringify(mergedNotes),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    return NextResponse.json({
      ok: true,
      pdf_path: pdfPath,
      xlsx_path: xlsxPath,
      xlsx_generated: !!xlsxPath,
      ...(xlsxError ? { xlsx_error: xlsxError } : {}),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Power BOQ regeneration failed', details: message }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { data: project, error } = await supabaseAdmin
      .from('sabi_projects')
      .select('notes, status')
      .eq('id', params.id)
      .single();

    if (error || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    let boqPath: string | null = null;
    if (project.notes) {
      try {
        const notes = JSON.parse(project.notes);
        boqPath = notes.boq_pdf_path || null;
      } catch {
        // notes is not JSON
      }
    }

    if (!boqPath) {
      return NextResponse.json(
        { error: 'No Power BOQ PDF found — approve Gate 14 first' },
        { status: 404 }
      );
    }

    const { data: signedData, error: signErr } = await supabaseAdmin.storage
      .from('sabi-attachments')
      .createSignedUrl(boqPath, 300);

    if (signErr || !signedData?.signedUrl) {
      return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 });
    }

    return NextResponse.redirect(signedData.signedUrl);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Download failed', details: message }, { status: 500 });
  }
}
