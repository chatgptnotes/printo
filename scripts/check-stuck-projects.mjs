// Probe: which projects are at/around gate 12 right now? Recent activity log?
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log('\n--- Projects in gate 12 territory ---\n');

const STUCK_STATUSES = [
  'pricing_pending', 'quantities_pending', 'boq_generating',
  'estimating', 'estimated', 'extracted',
];

const { data: projects } = await supabase
  .from('sabi_projects')
  .select('id, project_name, email_subject, status, notes, updated_at, final_quote_aed')
  .in('status', STUCK_STATUSES)
  .order('updated_at', { ascending: false })
  .limit(10);

if (!projects || projects.length === 0) {
  console.log('No projects in pricing/quantities/estimating states.');
} else {
  for (const p of projects) {
    let approvalGate = null;
    try {
      const n = p.notes ? JSON.parse(p.notes) : {};
      approvalGate = n.approval_gate ?? null;
    } catch {}
    console.log(`[${p.status}] gate=${approvalGate ?? '-'}  ${(p.project_name || p.email_subject || p.id).slice(0, 80)}`);
    console.log(`  id=${p.id}`);
    console.log(`  updated=${p.updated_at?.slice(0, 19).replace('T', ' ')}  quote=${p.final_quote_aed ?? '—'}`);

    const { data: log } = await supabase
      .from('sabi_activity_log')
      .select('step, step_name, status, details, created_at')
      .eq('project_id', p.id)
      .order('created_at', { ascending: false })
      .limit(8);
    for (const row of (log || []).reverse()) {
      const det = row.details ? JSON.stringify(row.details).slice(0, 120) : '';
      console.log(`    step ${row.step ?? '?'} [${row.status}] ${row.step_name} ${det}`);
    }
    console.log();
  }
}
