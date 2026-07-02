# Database Migrations — runbook (Supabase CLI)

Source of truth for the live DB schema is now the **Supabase CLI**, not hand-pasting SQL
into the dashboard. Live project ref: `osxsaqiobvpmeqckpjqp`.

> Why a baseline (not a replay): the old `migrations/` files use three naming schemes and
> several share a date prefix (`20260415`, `20260418`, `20260504` each appear twice). The CLI
> keys migrations by their version (the leading number), so those collide. They are also
> *already applied* to the live DB. So we snapshot the current live schema into **one baseline
> migration** and go forward cleanly. The old loose files are kept for history under
> `supabase/snapshots/`.

---

## Prerequisites (one-time, on your machine)

- `npx supabase --version` works (CLI 2.106.0 confirmed; no global install needed).
- A Supabase **personal access token**: https://supabase.com/dashboard/account/tokens
- The project's **database password** (Dashboard → Project Settings → Database).

```bash
# authenticate the CLI (paste the personal access token when prompted)
npx supabase login
```

---

## One-time: create the baseline from the live DB

Run these from the repo root, in order.

```bash
# 1. Link this repo to the live project (prompts for the DB password)
npx supabase link --project-ref osxsaqiobvpmeqckpjqp

# 2. (only if you still see "permission denied for table" 42501 errors)
#    apply the service_role grants to live FIRST, so the baseline captures them.
#    Either paste migrations/20260616_grant_users_table.sql into the SQL editor,
#    or:  npx supabase db push --include-all   (after step 3 it is included anyway)

# 3. Pull the entire current live schema into ONE baseline migration.
#    Writes supabase/migrations/<timestamp>_remote_schema.sql AND records it in the
#    remote migration history so local and remote are in sync.
npx supabase db pull

# 4. Now archive the old loose migrations so a future `db push` won't try to replay
#    them (they are already in the baseline). git mv keeps them in history.
mkdir -p supabase/snapshots/legacy-migrations
git mv supabase/migrations/0*.sql        supabase/snapshots/legacy-migrations/ 2>/dev/null
git mv supabase/migrations/20260414_*.sql supabase/snapshots/legacy-migrations/
git mv supabase/migrations/20260415_*.sql supabase/snapshots/legacy-migrations/
git mv supabase/migrations/20260418_*.sql supabase/snapshots/legacy-migrations/
git mv supabase/migrations/20260504_*.sql supabase/snapshots/legacy-migrations/
git mv supabase/migrations/20260505_*.sql supabase/snapshots/legacy-migrations/
git mv supabase/migrations/20260616_*.sql supabase/snapshots/legacy-migrations/
# migrations/ should now contain ONLY the <timestamp>_remote_schema.sql baseline.

# 5. Confirm local == remote (should report no pending changes)
npx supabase migration list

# 6. Commit the baseline + archived history
git add -A && git commit -m "db: baseline live schema via supabase db pull; archive legacy migrations"
git push origin main
```

---

## Day-to-day: making a schema change

Never edit the live DB by hand again. Instead:

```bash
# 1. Create an empty, correctly-timestamped migration
npx supabase migration new add_widget_table

# 2. Edit the generated file in supabase/migrations/ with your SQL

# 3. (optional) sanity-check the diff against live
npx supabase db diff

# 4. Apply to the live DB
npx supabase db push

# 5. Commit — the migration file is the record of what shipped
git add -A && git commit -m "db: add widget table" && git push origin main
```

For a brand-new environment (e.g. a staging project), `npx supabase db push` against it
replays the baseline + every later migration in order — a clean, reproducible setup.

---

## Notes

- `supabase/snapshots/` holds **reference dumps only** (`fresh_setup_v2.sql` etc.) and the
  archived legacy migrations. The CLI ignores everything outside `supabase/migrations/`.
- `fresh_setup.sql` is deprecated (wrong bucket name); `fresh_setup_v2.sql` was the last
  hand-maintained full schema. After the baseline above, the `<timestamp>_remote_schema.sql`
  file is the authoritative schema and `fresh_setup_v2.sql` becomes historical.
