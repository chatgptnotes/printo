// Refresh the electrical extraction on an existing bid from the corrected
// fixture (now incl. provisional per-floor lighting). Updates ONLY the given
// bid's sabi_services row — does not create or modify any other project.
//   Run: npx tsx scripts/update-p379-bid.ts [bidId]
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { enrichElectricalResult } from '../src/lib/electrical/derive-cable-paths';
import type { ElectricalProcedureResult } from '../src/lib/ai/ai-provider';

for (const f of ['.env.local', '.env']) {
  try {
    for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
}

const BID_ID = process.argv[2] || 'e718bf00-fbb5-4ff7-8e58-965150bcfdaf';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const raw = JSON.parse(readFileSync(resolve('tests/fixtures/p379-result.json'), 'utf8')) as ElectricalProcedureResult;
  const result = enrichElectricalResult(raw);
  const aiExtraction = {
    raw_electrical_procedure: result,
    cable_schedule: result.cable_schedule,
    smdb_inventory: result.smdb_inventory,
    db_inventory: result.db_inventory,
    mdb_info: result.mdb_info,
    incoming_supply: result.incoming_supply,
    lv_panels: result.lv_panels,
    mechanical_equipment: result.mechanical_equipment,
    power_outlets: result.power_outlets,
    lighting_fixtures: (result as any).lighting_fixtures ?? [],
    containment: result.containment,
    earthing: result.earthing,
    metering: result.metering,
    load_summary: result.load_summary,
  };
  const confidence = result.confidence >= 0.7 ? 'high' : result.confidence >= 0.4 ? 'medium' : 'low';

  const { data: existing } = await supabase
    .from('sabi_services').select('id').eq('project_id', BID_ID).eq('service_type', 'electrical').maybeSingle();
  if (!existing) throw new Error('no electrical service row for bid ' + BID_ID);

  const { error } = await supabase.from('sabi_services')
    .update({ ai_extraction: aiExtraction, confidence, updated_at: new Date().toISOString() })
    .eq('id', existing.id);
  if (error) throw new Error('update failed: ' + error.message);

  const lf = (result as any).lighting_fixtures ?? [];
  console.log('✅ Updated bid ' + BID_ID);
  console.log('   lighting rows: ' + lf.length + ' (all provisional=' + lf.every((x: any) => x.provisional) + ')');
  console.log('   bid page: http://localhost:3001/bids/' + BID_ID);
}

main().catch((e) => { console.error(e); process.exit(1); });
