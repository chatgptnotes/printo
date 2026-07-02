import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { analyzeDuctRouteDrawing, AttachmentFile } from '@/lib/ai/ai-provider';
import { calculateDuctRouteEstimate } from '@/lib/pipeline/estimation-engine';
import { getAttachmentBuffer } from '@/lib/storage/attachment-storage';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { project_id } = body;

    if (!project_id) {
      return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
    }

    // Fetch project info
    const { data: project, error: projErr } = await supabaseAdmin
      .from('sabi_projects')
      .select('*')
      .eq('id', project_id)
      .single();

    if (projErr || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get all HVAC-related attachments
    const { data: allAtts } = await supabaseAdmin
      .from('sabi_attachments')
      .select('*')
      .eq('project_id', project_id);

    const hvacFiles: AttachmentFile[] = [];
    let hvacText = '';

    for (const att of (allAtts || [])) {
      if (!att.attachment_id || !att.message_id) continue;
      const disc = att.discipline || '';
      const fname = (att.filename || '').toLowerCase();
      if (disc === 'hvac' || fname.includes('hvac') || fname.includes('ac') ||
          fname.includes('duct') || fname.includes('ventil') || fname.includes('cooling') ||
          fname.includes('mech') || fname.includes('floor plan') || fname.includes('layout')) {
        try {
          const buffer = await getAttachmentBuffer(att.message_id, att.attachment_id);
          if (fname.endsWith('.pdf')) {
            hvacFiles.push({ filename: att.filename, mimeType: 'application/pdf', buffer });
          } else if (fname.endsWith('.png') || fname.endsWith('.jpg') || fname.endsWith('.jpeg')) {
            hvacFiles.push({ filename: att.filename, mimeType: fname.endsWith('.png') ? 'image/png' : 'image/jpeg', buffer });
          }
        } catch { /* skip */ }
      }
      if (att.extracted_data && (att.extracted_data as any).text) {
        hvacText += (att.extracted_data as any).text.substring(0, 5000) + '\n';
      }
    }

    // Fallback: send ALL PDFs if no HVAC-specific ones found
    if (hvacFiles.length === 0) {
      for (const att of (allAtts || [])) {
        if (!att.attachment_id || !att.message_id) continue;
        const fname = (att.filename || '').toLowerCase();
        if (fname.endsWith('.pdf') || fname.endsWith('.png') || fname.endsWith('.jpg')) {
          try {
            const buffer = await getAttachmentBuffer(att.message_id, att.attachment_id);
            const mimeType = fname.endsWith('.pdf') ? 'application/pdf' : fname.endsWith('.png') ? 'image/png' : 'image/jpeg';
            hvacFiles.push({ filename: att.filename, mimeType, buffer });
          } catch { /* skip */ }
        }
      }
    }

    if (hvacFiles.length === 0) {
      return NextResponse.json({ error: 'No drawing files found for this project' }, { status: 400 });
    }

    // Run duct route analysis
    const ductRouteData = await analyzeDuctRouteDrawing(
      hvacFiles, hvacText,
      { floors: project.floors, area_sqft: project.total_area_sqft, building_type: project.building_type, typical_height_m: project.typical_height_m }
    );

    // Convert to BOQ line items
    const typicalFloors = Math.max(1, (project.floors || 5) - 2);
    const lineItems = calculateDuctRouteEstimate(ductRouteData, typicalFloors);

    // Per-floor summary
    const floorSummary = ductRouteData.floors.map((f: any) => ({
      floor_label: f.floor_label,
      floor_code: f.floor_code,
      supply_m: Math.round(f.supply_ducts.reduce((s: number, d: any) => s + d.length_m, 0)),
      return_m: Math.round(f.return_ducts.reduce((s: number, d: any) => s + d.length_m, 0)),
      exhaust_m: Math.round(f.exhaust_ducts.reduce((s: number, d: any) => s + d.length_m, 0)),
      fresh_air_m: Math.round(f.fresh_air_ducts.reduce((s: number, d: any) => s + d.length_m, 0)),
      fittings: f.fittings.bends_90 + f.fittings.bends_45 + f.fittings.tees + f.fittings.reducers,
      terminals: f.terminals.supply_diffusers + f.terminals.linear_diffusers + f.terminals.return_grilles + f.terminals.exhaust_grilles,
      accessories: f.accessories.volume_dampers + f.accessories.fire_dampers + f.accessories.sound_attenuators + f.accessories.flexible_connections,
    }));

    const totalBoqAed = lineItems.reduce((s, i) => s + i.total_aed, 0);

    return NextResponse.json({
      project_id,
      project_name: project.project_name || project.email_subject,
      drawings_analyzed: hvacFiles.length,
      duct_routes: ductRouteData,
      floor_summary: floorSummary,
      line_items: lineItems,
      total_boq_aed: totalBoqAed,
      confidence: ductRouteData.confidence,
      reasoning: ductRouteData.reasoning,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Duct route analysis failed', details: message }, { status: 500 });
  }
}
