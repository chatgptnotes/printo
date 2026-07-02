import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { analyzeElectricalDrawing, AttachmentFile, ElectricalComponents } from '@/lib/ai/ai-provider';
import { calculateElectricalDrawingEstimate } from '@/lib/pipeline/estimation-engine';
import { getAttachmentBuffer } from '@/lib/storage/attachment-storage';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { project_id } = await request.json();
    if (!project_id) {
      return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
    }

    const { data: project, error: projErr } = await supabaseAdmin
      .from('sabi_projects')
      .select('*')
      .eq('id', project_id)
      .single();

    if (projErr || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const { data: allAtts } = await supabaseAdmin
      .from('sabi_attachments')
      .select('*')
      .eq('project_id', project_id);

    const elecFiles: AttachmentFile[] = [];
    let elecText = '';

    const ELEC_KEYWORDS = ['power', 'electrical', 'elec', 'ele-', 'ele_', 'sld', 'single line', 'distribution', 'panel', 'lighting', 'lv ', 'lv-', 'lv_'];

    for (const att of (allAtts || [])) {
      if (!att.attachment_id || !att.message_id) continue;
      const disc = att.discipline || '';
      const fname = (att.filename || '').toLowerCase();
      const isElec = disc === 'electrical' || ELEC_KEYWORDS.some(k => fname.includes(k));
      if (isElec) {
        try {
          const buffer = await getAttachmentBuffer(att.message_id, att.attachment_id);
          if (fname.endsWith('.pdf')) {
            elecFiles.push({ filename: att.filename, mimeType: 'application/pdf', buffer });
          } else if (fname.endsWith('.png') || fname.endsWith('.jpg') || fname.endsWith('.jpeg')) {
            elecFiles.push({ filename: att.filename, mimeType: fname.endsWith('.png') ? 'image/png' : 'image/jpeg', buffer });
          }
        } catch { /* skip */ }
      }
      if (att.extracted_data && (att.extracted_data as any).text) {
        elecText += (att.extracted_data as any).text.substring(0, 5000) + '\n';
      }
    }

    // Fallback: send all PDFs if no electrical-specific ones found
    if (elecFiles.length === 0) {
      for (const att of (allAtts || [])) {
        if (!att.attachment_id || !att.message_id) continue;
        const fname = (att.filename || '').toLowerCase();
        if (fname.endsWith('.pdf') || fname.endsWith('.png') || fname.endsWith('.jpg')) {
          try {
            const buffer = await getAttachmentBuffer(att.message_id, att.attachment_id);
            const mimeType = fname.endsWith('.pdf') ? 'application/pdf' : fname.endsWith('.png') ? 'image/png' : 'image/jpeg';
            elecFiles.push({ filename: att.filename, mimeType, buffer });
          } catch { /* skip */ }
        }
      }
    }

    if (elecFiles.length === 0) {
      return NextResponse.json({ error: 'No drawing files found for this project' }, { status: 400 });
    }

    const elecData = await analyzeElectricalDrawing(
      elecFiles, elecText,
      { floors: project.floors, area_sqft: project.total_area_sqft, building_type: project.building_type, typical_height_m: project.typical_height_m }
    );

    const typicalFloors = Math.max(1, (project.floors || 5) - 2);
    const lineItems = calculateElectricalDrawingEstimate(elecData, typicalFloors);

    // Per-floor outlet summary
    const floorSummary = elecData.floors.map((f: ElectricalComponents['floors'][number]) => {
      const o = f.outlets;
      const totalOutlets = o.single_13a + o.single_13a_wp + o.twin_13a + o.outlet_15a +
        o.fcu_fused_spur + o.water_heater_20a + o.washing_machine_20a +
        o.gas_ignition_13a + o.gas_detector + o.hand_dryer + o.floor_box_f1 +
        o.usb_outlet + o.industrial_16a + o.dp_switch_20a + o.control_panel;
      return {
        floor_label: f.floor_label,
        floor_code: f.floor_code,
        total_outlets: totalOutlets,
        db_tags: f.db_tags,
        outlets: f.outlets,
      };
    });

    const totalBoqAed = lineItems.reduce((s, i) => s + i.total_aed, 0);

    return NextResponse.json({
      project_id,
      project_name: project.project_name || project.email_subject,
      drawings_analyzed: elecFiles.length,
      electrical_data: elecData,
      floor_summary: floorSummary,
      line_items: lineItems,
      total_boq_aed: totalBoqAed,
      confidence: elecData.confidence,
      reasoning: elecData.reasoning,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Electrical analysis failed', details: message }, { status: 500 });
  }
}
