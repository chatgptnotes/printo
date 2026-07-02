// Create a NEW bid (does not touch any existing project) that shows the
// corrected P-379 POWER extraction in the web UI. Clones the known-good demo
// project row e08c8af2 (so we don't have to guess required columns), gives it a
// fresh id + name, and attaches the enriched, corrected fixture as its
// electrical sabi_services row.
//   Run: npx tsx scripts/seed-p379-new-bid.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
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

const TEMPLATE_ID = 'e08c8af2-7b4f-4518-bed0-1d3a8dd76285';
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

  // Clone the template project so we inherit all required columns.
  const { data: tpl, error: tplErr } = await supabase
    .from('sabi_projects').select('*').eq('id', TEMPLATE_ID).single();
  if (tplErr || !tpl) throw new Error('template project not found: ' + (tplErr?.message || 'none'));

  const newId = randomUUID();
  const now = new Date().toISOString();
  const newProject: Record<string, unknown> = {
    ...tpl,
    id: newId,
    project_name: 'P-379 POWER — Corrected Demo (' + now.slice(0, 10) + ')',
    email_thread_id: null,      // unique index — must not collide with template
    status: 'pricing_pending',
    notes: JSON.stringify({ approval_gate: 12 }),
    created_at: now,
    updated_at: now,
  };

  const { error: pErr } = await supabase.from('sabi_projects').insert(newProject);
  if (pErr) throw new Error('project insert failed: ' + pErr.message);

  const { error: sErr } = await supabase.from('sabi_services').insert({
    project_id: newId, service_type: 'electrical', is_required: true, ai_extraction: aiExtraction, confidence,
  });
  if (sErr) throw new Error('service insert failed: ' + sErr.message);

  console.log('✅ New bid created.');
  console.log('   id:        ' + newId);
  console.log('   name:      ' + newProject.project_name);
  console.log('   bid page:  http://localhost:3001/bids/' + newId);
  console.log('   cable runs: ' + result.cable_schedule.length + ' | transformers: ' + (result.incoming_supply?.transformers?.length ?? 0) + ' | LV panels: ' + (result.lv_panels?.length ?? 0) + ' | mechanical: ' + (result.mechanical_equipment?.length ?? 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
