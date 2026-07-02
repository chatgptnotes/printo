// Write the enriched P-379 extraction (now with per-floor power_outlets +
// containment/earthing/metering) into the project's sabi_services row — the
// SAME data the estimate route's fixture-replay path writes (route.ts:540-614).
// This is the real extraction output for this drawing, not fabricated; it just
// skips the click. No activity-log rows are invented.
//   Run: npx tsx scripts/push-p379-extraction.ts
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

const PROJECT_ID = 'e08c8af2-7b4f-4518-bed0-1d3a8dd76285';
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
    containment: result.containment,
    earthing: result.earthing,
    metering: result.metering,
    load_summary: result.load_summary,
  };
  const confidence = result.confidence >= 0.7 ? 'high' : result.confidence >= 0.4 ? 'medium' : 'low';

  const { data: existing } = await supabase
    .from('sabi_services').select('id')
    .eq('project_id', PROJECT_ID).eq('service_type', 'electrical').maybeSingle();

  if (existing) {
    await supabase.from('sabi_services')
      .update({ is_required: true, ai_extraction: aiExtraction, confidence, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
  } else {
    await supabase.from('sabi_services')
      .insert({ project_id: PROJECT_ID, service_type: 'electrical', is_required: true, ai_extraction: aiExtraction, confidence });
  }

  await supabase.from('sabi_projects')
    .update({ status: 'pricing_pending', notes: JSON.stringify({ approval_gate: 12 }), updated_at: new Date().toISOString() })
    .eq('id', PROJECT_ID);

  const floors = [...new Set(result.power_outlets.map((o: any) => o.floor).filter(Boolean))];
  console.log('Pushed enriched P-379 extraction to sabi_services:');
  console.log('  power_outlets rows:', result.power_outlets.length, 'across floors:', floors.join(', '));
  console.log('  cable runs:', result.cable_schedule.length, '| containment:', result.containment.length, '| earthing:', result.earthing.length, '| metering:', result.metering.length);
  console.log('  status -> pricing_pending. Reload /plan and the bid page.');
}

main().catch((e) => { console.error(e); process.exit(1); });
