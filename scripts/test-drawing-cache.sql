-- ============================================================================
-- Drawing Analysis Cache — Test & Verification SQL
-- ============================================================================
--
-- Run these blocks one at a time in the Supabase SQL editor to verify the
-- cache is working. Each block is independent and labeled.
--
-- Migration to apply first (only once):
--   supabase/migrations/20260504_drawing_analysis_cache.sql
-- ============================================================================


-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 1 · Sanity check — confirm table + RPC function exist            │
-- └────────────────────────────────────────────────────────────────────────┘
select
  (select count(*) from information_schema.tables
   where table_name = 'sabi_drawing_analysis_cache') as table_exists,
  (select count(*) from pg_proc
   where proname = 'bump_drawing_cache_hit') as rpc_exists;
-- Expected: both columns = 1


-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 2 · Pick a project to test the cache with                        │
-- └────────────────────────────────────────────────────────────────────────┘
-- Find a project that already produced a BOQ — you'll roll it back, click
-- "Run to BOQ" again, and confirm the second run skips Claude entirely.
select id, project_name, status, updated_at
from sabi_projects
where status = 'boq_ready'
order by updated_at desc
limit 5;
-- Copy one of the IDs into BLOCK 3 below.


-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 3 · Roll a project back so /estimate re-runs on the same files   │
-- └────────────────────────────────────────────────────────────────────────┘
-- ⚠ DESTRUCTIVE — replace the placeholder UUID with a real one from BLOCK 2.
update sabi_projects
set status = 'extracted',
    notes = null,
    updated_at = now()
where id = '00000000-0000-0000-0000-000000000000'   -- ← paste project id here
returning id, status;
--
-- Now: open the bid page in the browser and click "Run to BOQ".
-- The estimate step should finish in ~2 seconds (was 2-5 minutes).
-- Then run BLOCK 4 to confirm the cache hit was recorded.


-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 4 · Verify cache hit was logged                                  │
-- └────────────────────────────────────────────────────────────────────────┘
select created_at,
       details->>'cache_key'        as cache_key_prefix,
       details->>'model'             as model,
       details->>'file_count'        as file_count,
       details->>'est_savings_usd'   as saved_usd,
       details->>'message'           as message
from sabi_activity_log
where step_name = 'Drawing Cache Hit'
order by created_at desc
limit 10;
-- Expected: at least one row with the dollar amount you saved.


-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 5 · Inspect the cache table                                      │
-- └────────────────────────────────────────────────────────────────────────┘
select cache_key,
       model,
       procedure_version,
       hit_count,
       est_savings_usd,
       (input_summary->>'file_count')::int  as files,
       (input_summary->>'total_bytes')::int as total_bytes,
       created_at,
       last_used_at
from sabi_drawing_analysis_cache
order by last_used_at desc
limit 20;
-- After 1 fresh run + 1 cache hit, hit_count should be 1.
-- After N re-runs on the same drawings, hit_count = N - 1.


-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 6 · Total Claude savings to date                                 │
-- └────────────────────────────────────────────────────────────────────────┘
select
  count(*)                                            as total_cache_hits,
  round(sum((details->>'est_savings_usd')::numeric), 2) as total_saved_usd
from sabi_activity_log
where step_name = 'Drawing Cache Hit';


-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 7 · Per-project Claude token spend (cost visibility)             │
-- └────────────────────────────────────────────────────────────────────────┘
select project_id,
       count(*)                                            as claude_calls,
       sum((details->>'input_tokens')::int)                as total_input_tokens,
       sum((details->>'output_tokens')::int)               as total_output_tokens,
       round(sum((details->>'est_cost_usd')::numeric), 4)  as total_spent_usd
from sabi_activity_log
where step_name = 'Claude Token Usage'
group by project_id
order by total_spent_usd desc
limit 20;


-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 8 · API alerts received (Claude disruption notifications)        │
-- └────────────────────────────────────────────────────────────────────────┘
select created_at,
       details->>'kind'    as alert_kind,
       details->>'message' as message,
       project_id
from sabi_activity_log
where step_name = 'API Alert'
order by created_at desc
limit 10;
-- Empty = no Claude API problems. Rows = WhatsApp alerts that fired.


-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 9 · Verify no duplicate / overlapping / legacy step entries      │
-- └────────────────────────────────────────────────────────────────────────┘
-- 9a · Step rows > 2 per project+step+sub_pipeline (normal = started+completed)
select project_id,
       step,
       sub_pipeline,
       count(*) as rows,
       string_agg(distinct step_name, ' | ') as names_seen
from sabi_activity_log
where step between 1 and 15
group by project_id, step, sub_pipeline
having count(*) > 2
order by project_id, step;
-- Expected: empty.

-- 9b · Legacy step numbers (>15) still being written. v6 only uses 0-15
-- (step 0 = Auto-Filter / Cache Hit / API Alert; steps 1-15 = MAIN pipeline).
select step, step_name, count(*) as rows
from sabi_activity_log
where step > 15
group by step, step_name
order by rows desc
limit 20;
-- Expected: only old rows from before this de-dup commit. New rows = 0.

-- 9c · Step / name mismatches against MAIN_PIPELINE_STEPS — flags rows where
-- the step number doesn't match the canonical step name.
select step,
       step_name,
       sub_pipeline,
       count(*) as rows
from sabi_activity_log
where sub_pipeline is null
  and (
    (step = 1  and step_name not in ('Read Email', 'Pipeline Restart'))
    or (step = 2  and step_name <> 'Register New Enquiry')
    or (step = 3  and step_name <> 'Open Tender Folder')
    or (step = 4  and step_name <> 'Unload Attachments')
    or (step = 5  and step_name <> 'Extract Attachment Archive')
    or (step = 6  and step_name <> 'List Available Documents')
    or (step = 7  and step_name <> 'List Drawings')
    or (step = 8  and step_name <> 'Extract Building + Reputation')
    or (step = 9  and step_name <> 'Documents Sufficient')
    or (step = 10 and step_name <> 'Bid Decision')
    or (step = 11 and step_name <> 'Run Pricing')
    or (step = 12 and step_name <> 'Confirm Quantities')
    or (step = 13 and step_name <> 'Prepare Yardstick Ratios')
    or (step = 14 and step_name <> 'Confirm Total')
    or (step = 15 and step_name <> 'Consent Received & Send')
  )
group by step, step_name, sub_pipeline
order by step, rows desc;
-- Expected: rows here = stale activity from before the fix. New rows = 0.


-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 10 · OPTIONAL — clear the cache (start fresh)                    │
-- └────────────────────────────────────────────────────────────────────────┘
-- ⚠ DESTRUCTIVE — uncomment only if you want every future run to re-call
-- Claude again (deletes all cached drawing analyses).
-- truncate table sabi_drawing_analysis_cache;
