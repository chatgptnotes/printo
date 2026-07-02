-- Cache table for electrical drawing analysis results.
-- Keyed by sha256(file_contents + dxf_text + model + procedure_version + building_metadata).
-- Goal: when the same PDFs are submitted again (re-upload, demo run, another
-- project with the same drawings), skip the Claude call entirely.
--
-- Cache is global within the SABI tenant (no project_id FK) — same drawings
-- in any project share the same analysis.

create table if not exists sabi_drawing_analysis_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text unique not null,
  model text not null,
  procedure_version text not null,
  input_summary jsonb,
  result jsonb not null,
  hit_count integer not null default 0,
  est_savings_usd numeric(10, 4) not null default 0,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index if not exists idx_drawing_cache_key on sabi_drawing_analysis_cache(cache_key);
create index if not exists idx_drawing_cache_last_used on sabi_drawing_analysis_cache(last_used_at desc);

-- Atomic hit-counter increment helper. Postgres function so we don't need a
-- read-modify-write round trip from the Node side.
create or replace function bump_drawing_cache_hit(p_cache_key text)
returns void language sql as $$
  update sabi_drawing_analysis_cache
  set hit_count = hit_count + 1,
      last_used_at = now()
  where cache_key = p_cache_key;
$$;
