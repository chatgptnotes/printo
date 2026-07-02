import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { generateBOQPDF, generateElectricalPowerBOQ } from '@/lib/pdf/boq-pdf-generator';
import { generateBOQ } from '@/lib/pipeline/boq-generator';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET: Generate and download BOQ as PDF
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = params;

    const [projectRes, servicesRes, estRes, attRes] = await Promise.all([
      supabaseAdmin.from('sabi_projects').select('*').eq('id', id).single(),
      supabaseAdmin.from('sabi_services').select('*').eq('project_id', id).eq('is_required', true),
      supabaseAdmin.from('sabi_estimations').select('*').eq('project_id', id).limit(1).single(),
      supabaseAdmin.from('sabi_attachments').select('*').eq('project_id', id),
    ]);

    if (projectRes.error || !projectRes.data) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const project = projectRes.data;
    const services = servicesRes.data || [];
    const attachments = attRes.data || [];
    let estimation = estRes.data;

    // Detailed-electrical path: services have raw_electrical_procedure but no
    // total_aed (pricing happens via Gate 12 → 12-section Power BOQ PDF, not
    // via the rate-card path that populates total_aed). Hand the user the
    // Power BOQ PDF directly so the same "Download BOQ (PDF)" button works
    // on both paths.
    const hasElectricalExtraction = services.some(
      (s: any) => (s.ai_extraction as any)?.raw_electrical_procedure
    );
    const hasPricedService = services.some((s: any) => s.is_required && s.total_aed);

    if (hasElectricalExtraction && !hasPricedService) {
      const projectName = (project.project_name || 'project').replace(/[^a-zA-Z0-9]/g, '_');
      const date = new Date().toISOString().split('T')[0];
      const pdfBuffer = await generateElectricalPowerBOQ(project, id);
      const filename = `Power_BOQ_${projectName}_${date}.pdf`;
      return new NextResponse(pdfBuffer as any, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'X-BOQ-Source': 'electrical-procedure',
        },
      });
    }

    // Synthesize estimation from services if no row exists yet
    if (!estimation) {
      const requiredServices = services.filter((s: any) => s.is_required && s.total_aed);
      if (requiredServices.length === 0) {
        return NextResponse.json(
          { error: 'No services with pricing found. Run estimation first.' },
          { status: 400 }
        );
      }
      const subtotal = requiredServices.reduce((sum: number, s: any) => sum + (s.total_aed || 0), 0);
      const marginPct = 15;
      const finalQuote = subtotal * (1 + marginPct / 100);
      const area = project.total_area_sqft || 1;
      estimation = {
        id: 'synthetic',
        project_id: id,
        total_aed: subtotal,
        cost_per_sqft_aed: subtotal / area,
        margin_percent: marginPct,
        final_quote_aed: finalQuote,
      } as any;
    }

    const projectName = (project.project_name || 'project').replace(/[^a-zA-Z0-9]/g, '_');
    const date = new Date().toISOString().split('T')[0];

    // Try PDF first. If pdfkit fails (commonly due to missing .afm font files
    // on Vercel serverless), fall back to the Excel BOQ so the user always
    // gets a downloadable quotation.
    try {
      const pdfBuffer = await generateBOQPDF(project, services, estimation, attachments);
      const filename = `BOQ_${projectName}_${date}.pdf`;
      return new NextResponse(pdfBuffer as any, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    } catch (pdfErr: any) {
      console.error('PDF generation failed, falling back to Excel:', pdfErr.message, pdfErr.stack);
      const xlsxBuffer = await generateBOQ(project, services, estimation, attachments);
      const filename = `BOQ_${projectName}_${date}.xlsx`;
      return new NextResponse(xlsxBuffer as any, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'X-PDF-Fallback': 'true',
          'X-PDF-Error': pdfErr.message?.substring(0, 200) || 'unknown',
        },
      });
    }
  } catch (error: any) {
    console.error('BOQ PDF route error:', error);
    return NextResponse.json(
      { error: 'BOQ generation failed', details: error.message },
      { status: 500 }
    );
  }
}
