import { generateBOQPDF } from '../lib/boq-pdf-generator';
import fs from 'fs';

const project = {
  id: 'test-1',
  project_name: 'Test Villa Jumeirah',
  client_name: 'Test Client',
  email_from: 'test@example.com',
  email_subject: 'RFQ — Villa MEP',
  status: 'quotation_ready',
  priority: 'priority_top',
  total_area_sqft: 12000,
  floors: 3,
  parking_floors: 1,
  building_type: 'villa',
  location: 'Jumeirah, Dubai',
  created_at: new Date().toISOString(),
};

const services = [
  { id: 's1', project_id: 'test-1', service_type: 'hvac', is_required: true, system_type: 'vrf', tonnage: 45, total_aed: 189000, unit_rate_aed: 4200, quantity: 45, calculation_notes: 'VRF system, 45 TR' },
  { id: 's2', project_id: 'test-1', service_type: 'electrical', is_required: true, total_aed: 360000, unit_rate_aed: 30, quantity: 12000, calculation_notes: '12000 sqft × 30 AED/sqft' },
  { id: 's3', project_id: 'test-1', service_type: 'plumbing', is_required: true, total_aed: 360000, unit_rate_aed: 30, quantity: 12000, calculation_notes: '12000 sqft × 30 AED/sqft' },
];

const estimation = {
  id: 'e1',
  project_id: 'test-1',
  total_aed: 909000,
  cost_per_sqft_aed: 75.75,
  margin_percent: 15,
  final_quote_aed: 1045350,
};

async function main() {
  try {
    const pdf = await generateBOQPDF(project as any, services as any, estimation as any, []);
    fs.writeFileSync('/tmp/test-boq.pdf', pdf);
    console.log('SUCCESS — PDF bytes:', pdf.length);
  } catch (e: any) {
    console.error('FAILED:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}
main();
