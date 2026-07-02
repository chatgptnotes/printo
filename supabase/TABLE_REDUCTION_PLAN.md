# Table Reduction Plan — do tomorrow

> Goal: reduce the number of Supabase tables **without breaking the pipeline**.
> Current state: new Supabase project `osxsaqiobvpmeqckpjqp` is live with **14 tables**
> (schema = `supabase/snapshots/fresh_setup_v2.sql`). Everything works.

## ⚠️ Read first
Every table you remove means **rewriting the app code that queries it**, then running a
migration on the live DB and redeploying. The DB schema is already minimal — "fewer tables"
only comes from merging *working* tables. So weigh count-reduction against risk.

**Important context:** you said you'll **build out the mail feature later**. That means the two
email tables (`sabi_emails`, `sabi_email_attachments`) are about to get MORE use, not less.
👉 **Do NOT merge the attachment tables.** Skip that option (it was the highest-risk one anyway).

---

## The 14 tables today
Core: `sabi_emails`, `sabi_projects`, `sabi_attachments`, `sabi_services`, `sabi_estimations`,
`sabi_activity_log`, `sabi_yardstick_rates`, `sabi_email_attachments`, `sabi_price_library`,
`sabi_settings`, `sabi_no_bid_log`, `sabi_corrections`, `sabi_drawing_analysis_cache`,
`public.users`.

---

## ✅ RECOMMENDED (low risk): 14 → 13
**Merge `sabi_no_bid_log` into `sabi_activity_log`.**
A no-bid decision is just a terminal pipeline event, so it can live as a normal activity row
(`step = 13`, `status = 'no_bid'`) with the reason stored in the existing `details` JSONB.

### Why it's safe
- Only **2 write sites** and a few admin read sites.
- `sabi_activity_log` already has a `details JSONB` column — no schema change needed there.
- No data loss: `reason_code`, `reason_text`, `decided_by`, `source` all fit inside `details`.

### Steps
1. **Code — writes** (replace the `sabi_no_bid_log` insert with an activity_log insert):
   - `src/app/api/projects/[id]/bid-decision/route.ts` (~line 133)
   - `src/app/api/cron/auto-escalate-stale/route.ts` (~line 78)

   New shape:
   ```ts
   await supabaseAdmin.from('sabi_activity_log').insert({
     project_id: id,
     step: 13,
     step_name: 'Bid Decision — No Bid',
     status: 'no_bid',
     details: { reason_code, reason_text, decided_by, source }, // 'human' | 'auto_escalation'
   });
   ```
2. **Code — reads** (anywhere that does `.from('sabi_no_bid_log')`): change to read
   `sabi_activity_log` where `status = 'no_bid'` and pull fields out of `details`.
   Grep first: search `sabi_no_bid_log` across `src/` and fix each hit (~2–4 sites).
3. **Migration** (run via SQL Editor or the Management API once code is updated):
   ```sql
   -- optional: backfill existing no-bid rows into activity_log first if you have any data
   -- INSERT INTO sabi_activity_log (project_id, step, step_name, status, details)
   -- SELECT project_id, 13, 'Bid Decision — No Bid', 'no_bid',
   --        jsonb_build_object('reason_code',reason_code,'reason_text',reason_text,
   --                           'decided_by',decided_by,'source',source)
   -- FROM sabi_no_bid_log;

   DROP TABLE IF EXISTS sabi_no_bid_log;
   ```
4. Redeploy. Verify a No-Bid decision still records and shows in the timeline/admin views.

**Result: 13 tables.**

---

## 🟡 OPTIONAL (medium risk): 13 → 11
**Fold `sabi_price_library` + `sabi_yardstick_rates` into `sabi_settings` as JSONB.**
`sabi_settings` is already a generic `key`/`value JSONB` store.

- `sabi_price_library` is **not yet wired into production** (BOQ costing path is still "future"),
  so moving it is low-impact *today* — but you lose easy SQL filtering by discipline/category.
- `sabi_yardstick_rates` **is** queried with SQL filters
  (`.eq('building_type', …)`, `.eq('service_type', …)`) in:
  - `src/lib/pricing/yardstick-tuner.ts` (~line 27)
  - `src/app/api/yardstick/route.ts` (~lines 13, 38, 71)

  Folding it into a JSONB blob means rewriting those reads to load one settings row and filter
  in JS. Doable, but it trades a clean relational table for in-app filtering.

### Steps (only if you want it)
1. Move seed data into settings rows:
   ```sql
   INSERT INTO sabi_settings (key, value)
   SELECT 'yardstick_rates', jsonb_agg(to_jsonb(y) - 'id') FROM sabi_yardstick_rates y
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

   INSERT INTO sabi_settings (key, value)
   SELECT 'price_library', jsonb_agg(to_jsonb(p) - 'id') FROM sabi_price_library p
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
   ```
2. Rewrite the 4 yardstick read sites to `getSetting('yardstick_rates')` then `.filter(...)` in JS.
3. Drop the tables:
   ```sql
   DROP TABLE IF EXISTS sabi_price_library;
   DROP TABLE IF EXISTS sabi_yardstick_rates;
   ```
**Result: 11 tables.** Recommend doing this **only after** the no-bid merge is verified.

---

## ❌ DO NOT DO (for now)
**Merge `sabi_email_attachments` into `sabi_attachments`.**
- Highest churn: ~7 files, ~56 call sites.
- You're about to expand the mail feature, so these two tables will diverge further, not converge.
- Keep them separate.

**Keep `sabi_corrections` and `sabi_drawing_analysis_cache` as-is.**
- `sabi_corrections` = ML training signal (queried by field/cohort) — distinct.
- `sabi_drawing_analysis_cache` = content-hash cache with an RPC (`bump_drawing_cache_hit`) — distinct.

---

## Tomorrow's checklist
- [ ] Grep `sabi_no_bid_log` in `src/`, list every call site.
- [ ] Update the 2 write sites → insert into `sabi_activity_log` (step 13, status `no_bid`).
- [ ] Update the read sites → query activity_log where `status='no_bid'`.
- [ ] Run the `DROP TABLE sabi_no_bid_log;` migration.
- [ ] Test a No-Bid decision end-to-end; confirm it appears in the timeline + admin pages.
- [ ] (Optional, later) Do the yardstick/price_library fold for 11 tables.

When you're ready, ping me and I'll do any of these for you — just say which level
(13, 11) and I'll handle the code + migration.
