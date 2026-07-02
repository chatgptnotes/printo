// Probe: did this RFQ email get classified? What did the AI say?
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SEARCH = 'P-379';

console.log('\n--- Looking for emails matching "P-379" ---\n');

const { data: emails } = await supabase
  .from('sabi_emails')
  .select('id, subject, from_address, date, thread_id, gmail_message_id')
  .ilike('subject', `%${SEARCH}%`)
  .order('date', { ascending: false })
  .limit(5);

if (!emails || emails.length === 0) {
  console.log('No matching emails. Try searching for any email that mentions Request for Quotation:');
  const { data: alt } = await supabase
    .from('sabi_emails')
    .select('id, subject, from_address, date')
    .ilike('subject', '%Request for Quotation%')
    .order('date', { ascending: false })
    .limit(5);
  for (const e of alt || []) console.log(`  [${e.date?.slice(0, 16)}] ${e.from_address} — ${e.subject}`);
} else {
  for (const e of emails) {
    console.log(`Email: ${e.subject}`);
    console.log(`  id=${e.id}  from=${e.from_address}  date=${e.date?.slice(0, 16)}`);

    const { data: proj } = await supabase
      .from('sabi_projects')
      .select('id, status, priority, ai_classification')
      .eq('email_message_id', e.gmail_message_id)
      .maybeSingle();

    if (!proj) {
      console.log(`  ❌ NO PROJECT — email never classified. Click "Scan Inbox" on /inbox.\n`);
      continue;
    }

    console.log(`  ✅ Project: ${proj.id}`);
    console.log(`     status=${proj.status}  priority=${proj.priority}`);
    const c = proj.ai_classification;
    console.log(`     isRfq=${c?.isRfq}  confidence=${c?.confidence}  provider=${c?._provider}`);
    console.log(`     reasoning=${(c?.reasoning || '').slice(0, 200)}`);
    console.log();
  }
}
