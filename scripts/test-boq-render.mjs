// Render the Power BOQ for project P-379 locally so we see the actual error.
import { readFileSync, writeFileSync } from 'node:fs';
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

// Force-import via tsx since the generator is TS
const { generateElectricalPowerBOQ } = await import('../src/lib/pdf/boq-pdf-generator.ts');
const { createClient } = await import('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: project } = await supabase.from('sabi_projects').select('*').eq('id', '16cd9625-3d9f-46ce-a63d-2324c03bd43d').single();

if (!project) { console.error('no project'); process.exit(1); }

console.log('Project:', project.project_name || project.email_subject);
try {
  const buf = await generateElectricalPowerBOQ(project, project.id);
  writeFileSync('test-boq.pdf', buf);
  console.log(`✅ Rendered ${buf.length} bytes → test-boq.pdf`);
} catch (err) {
  console.error('❌ Render failed:');
  console.error(err);
}
