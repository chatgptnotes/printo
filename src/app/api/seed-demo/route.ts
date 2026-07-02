import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage/supabase';
import { requireAuth } from '@/lib/shared/api-auth';

export const dynamic = 'force-dynamic';

// Seed realistic MEP demo projects for client demonstration.
// All projects are MEP-focused (HVAC, electrical, plumbing, drainage, fire fighting, fire alarm, BMS).
// TODO: Replace demo project 3 (Marina Bay Hotel) with actual RFQ data from Haritha when forwarded.
//       The real RFQ will have accurate tonnage, consultant name, and BOQ template from the client.
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const demoProjects = [
      {
        email_thread_id: 'demo-sunrise-tower',
        email_message_id: 'demo-sunrise-msg',
        email_from: 'procurement@sunrisedevelopments.ae',
        email_subject: 'RFQ - MEP Works for Sunrise Corporate Tower, Business Bay',
        email_date: new Date().toISOString(),
        email_snippet: 'Dear ERP Realsoft Team,\n\nWe are pleased to invite you to submit your quotation for the complete MEP works for Sunrise Corporate Tower, a 25-floor commercial office building located in Business Bay, Dubai.\n\nProject Details:\n- Building Type: Commercial Office Tower\n- Total Floors: 25 (3 basement parking + G + 21 typical floors)\n- Total Built-Up Area: 450,000 sqft\n- Typical Floor Height: 3.6m floor-to-floor\n- Location: Business Bay, Dubai\n\nScope: Complete MEP including HVAC (chiller system), electrical (HV/LV), plumbing & drainage, fire fighting, fire alarm, BMS, and LPG.\n\nPlease find attached the architectural drawings, MEP tender documents, and BOQ template.\n\nDeadline for submission: 15 April 2026\n\nBest regards,\nAhmed Al Mansouri\nProcurement Manager\nSunrise Developments LLC',
        client_name: 'Sunrise Developments LLC',
        project_name: 'Sunrise Corporate Tower - MEP Works',
        location: 'Business Bay, Dubai',
        priority: 'priority_top',
        status: 'classified',
        floors: 25,
        parking_floors: 3,
        typical_floors: 21,
        area_per_floor_sqft: 18000,
        total_area_sqft: 450000,
        typical_height_m: 3.6,
        building_type: 'office',
        deadline: '2026-04-15',
        ai_classification: {
          isRfq: true,
          confidence: 0.97,
          priority: 'priority_top',
          reasoning: 'Clear MEP RFQ for a large commercial tower (450,000 sqft) in Business Bay. Contains complete scope, building details, and submission deadline. High-priority due to project size and known developer.',
          keywordsFound: ['request for quotation', 'submit your quotation', 'MEP works', 'tender documents', 'BOQ template', 'deadline for submission'],
        },
      },
      {
        email_thread_id: 'demo-palm-villas',
        email_message_id: 'demo-palm-msg',
        email_from: 'tenders@palmconstruction.ae',
        email_subject: 'Invitation to Bid - Palm Residences Villa Cluster MEP',
        email_date: new Date(Date.now() - 86400000).toISOString(),
        email_snippet: 'Dear Sir/Madam,\n\nPalm Construction LLC invites ERP Realsoft MEP to submit a competitive quotation for the MEP package for Palm Residences - a cluster of 12 luxury villas in Palm Jumeirah.\n\nEach Villa:\n- Built-Up Area: 8,500 sqft per villa (102,000 sqft total)\n- 3 floors + basement\n- Ceiling height: 3.2m\n- VRF air conditioning system\n- Smart home BMS integration\n\nScope per villa: HVAC (VRF), electrical, plumbing, drainage, fire alarm, and BMS.\n\nAttached: Architectural plans, thermal load calculations, equipment schedules.\n\nPlease quote within 10 working days.\n\nRegards,\nFatima Hassan\nSenior Estimator\nPalm Construction LLC',
        client_name: 'Palm Construction LLC',
        project_name: 'Palm Residences Villa Cluster - MEP',
        location: 'Palm Jumeirah, Dubai',
        priority: 'priority_gen',
        status: 'classified',
        floors: 4,
        parking_floors: 0,
        typical_floors: 3,
        area_per_floor_sqft: 2125,
        total_area_sqft: 102000,
        typical_height_m: 3.2,
        building_type: 'villa',
        ai_classification: {
          isRfq: true,
          confidence: 0.94,
          priority: 'priority_gen',
          reasoning: 'MEP RFQ for villa cluster in Palm Jumeirah. Specifies VRF system, includes thermal load calculations. Standard priority — clear scope but mid-sized project.',
          keywordsFound: ['invitation to bid', 'competitive quotation', 'MEP package', 'thermal load calculations', 'equipment schedules'],
        },
      },
      {
        email_thread_id: 'demo-marina-hotel',
        email_message_id: 'demo-marina-msg',
        email_from: 'projects@marinaresorts.ae',
        email_subject: 'RFQ: MEP Services - Marina Bay Hotel & Serviced Apartments',
        email_date: new Date(Date.now() - 172800000).toISOString(),
        email_snippet: 'Dear ERP Realsoft Estimation Department,\n\nWe would like to request your best price for the MEP works of Marina Bay Hotel & Serviced Apartments project in Dubai Marina.\n\nProject Overview:\n- 40-floor mixed-use tower\n- Floors 1-5: Hotel lobby, restaurants, retail\n- Floors 6-20: Hotel rooms (280 keys)\n- Floors 21-40: Serviced apartments (160 units)\n- 4 levels basement parking\n- Total area: 680,000 sqft\n- Central chiller plant\n\nMEP Scope: HVAC (central chiller + FCU), electrical (HV/LV + emergency), plumbing, drainage, fire fighting, fire alarm, BMS, LPG (kitchen gas).\n\nPlease find the tender documents in the attached zip file containing drawings, specifications, and schedules.\n\nSubmission deadline: 20 April 2026\n\nKind regards,\nKhalid Mahmoud\nDirector of Projects\nMarina Resorts & Hotels',
        client_name: 'Marina Resorts & Hotels',
        project_name: 'Marina Bay Hotel & Serviced Apartments - MEP',
        location: 'Dubai Marina, Dubai',
        priority: 'priority_top',
        status: 'classified',
        floors: 44,
        parking_floors: 4,
        typical_floors: 35,
        area_per_floor_sqft: 15450,
        total_area_sqft: 680000,
        typical_height_m: 3.6,
        building_type: 'hotel',
        deadline: '2026-04-20',
        ai_classification: {
          isRfq: true,
          confidence: 0.98,
          priority: 'priority_top',
          reasoning: 'Major MEP RFQ for a 40-floor mixed-use tower (680,000 sqft) in Dubai Marina. Includes hotel, apartments, retail — complex scope with central chiller plant. Top priority due to size, complexity, and clear deadline.',
          keywordsFound: ['request your best price', 'MEP works', 'tender documents', 'drawings', 'specifications', 'schedules', 'submission deadline'],
        },
      },
    ];

    let created = 0;

    for (const proj of demoProjects) {
      // Skip if already exists
      const { data: existing } = await supabaseAdmin
        .from('sabi_projects')
        .select('id')
        .eq('email_thread_id', proj.email_thread_id)
        .limit(1)
        .single();

      if (existing) continue;

      const { data: project, error } = await supabaseAdmin
        .from('sabi_projects')
        .insert(proj)
        .select()
        .single();

      if (error) {
        continue;
      }

      // Create demo attachments with discipline tags
      const attachments = [
        { filename: 'MEP_Tender_Documents.zip', file_type: 'archive_zip', size_bytes: 45000000, discipline: null },
        { filename: 'Architectural_Floor_Plans.pdf', file_type: 'drawing_pdf', size_bytes: 12000000, discipline: null },
        { filename: 'HVAC_Thermal_Load_Summary.pdf', file_type: 'drawing_pdf', size_bytes: 3500000, discipline: 'hvac', extracted_data: { total_kw: proj.total_area_sqft > 400000 ? 2800 : proj.total_area_sqft > 100000 ? 850 : 320, fahu_kw: proj.total_area_sqft > 400000 ? 420 : proj.total_area_sqft > 100000 ? 130 : 48, pages: 3, text: 'Thermal Load Summary - Total Cooling Load' } },
        { filename: 'HVAC_Equipment_Schedule.xlsx', file_type: 'schedule_excel', size_bytes: 850000, discipline: 'hvac', extracted_data: { system_type: proj.total_area_sqft > 200000 ? 'Chiller System' : 'VRF System' } },
        { filename: 'Electrical_Single_Line_Diagram.pdf', file_type: 'drawing_pdf', size_bytes: 5200000, discipline: 'electrical' },
        { filename: 'Plumbing_Riser_Diagram.pdf', file_type: 'drawing_pdf', size_bytes: 2800000, discipline: 'plumbing' },
        { filename: 'Fire_Fighting_Layout.dwg', file_type: 'drawing_autocad', size_bytes: 8500000, discipline: 'fire_fighting' },
        { filename: 'BOQ_Template.xlsx', file_type: 'schedule_excel', size_bytes: 120000, discipline: null },
      ];

      await supabaseAdmin.from('sabi_attachments').insert(
        attachments.map((att) => ({
          project_id: project.id,
          filename: att.filename,
          file_type: att.file_type,
          size_bytes: att.size_bytes,
          discipline: (att as any).discipline || null,
          extracted_data: (att as any).extracted_data || null,
        }))
      );

      // Create core MEP services
      const services = ['hvac', 'electrical', 'plumbing', 'fire_fighting', 'fire_alarm', 'bms'];
      if (proj.building_type === 'hotel') services.push('lpg', 'drainage');

      await supabaseAdmin.from('sabi_services').insert(
        services.map((svc) => ({
          project_id: project.id,
          service_type: svc,
          is_required: true,
        }))
      );

      // Log initial pipeline steps
      await supabaseAdmin.from('sabi_activity_log').insert([
        { project_id: project.id, step: 1, step_name: 'Identify Email', status: 'completed', details: { source: 'demo_seed' } },
        { project_id: project.id, step: 2, step_name: 'Identify Enquiry', status: 'completed', details: { keywords_matched: true } },
        { project_id: project.id, step: 3, step_name: 'Add to Bid List', status: 'completed', details: { bid_entry_created: true } },
        { project_id: project.id, step: 4, step_name: 'Classify Priority', status: 'completed', details: { confidence: (proj.ai_classification as Record<string, unknown>).confidence, priority: proj.priority } },
      ]);

      created++;
    }

    return NextResponse.json({
      seeded: created,
      message: `${created} MEP demo projects created with proper building data, attachments, and services.`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Seed failed', details: message },
      { status: 500 }
    );
  }
}
