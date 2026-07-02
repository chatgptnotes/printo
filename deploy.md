# Deployment - ERP Realsoft (SABI RFQ to BOQ Pipeline)

Reference for deploying this Next.js 14 app to Vercel. Read top-to-bottom before the first deploy.
`r`n## No-deploy rule for the ERP Realsoft rebrand`r`n`r`nThis rename pass is local-only. Do not run `vercel deploy`, Docker/VPS deploy or restart commands, GitHub Actions dispatches, `supabase db push`, remote pushes, or any live dashboard changes while applying the ERP Realsoft identity updates.`r`n
## Stack

- **Framework:** Next.js 14 App Router (port 3001 in dev/start)
- **Hosting:** Vercel (Fluid Compute, Node.js runtime)
- **Database/Storage:** Supabase (Postgres + Storage bucket `sabi-attachments`)
- **AI:** Anthropic Claude Sonnet 4.6 (classification, extraction, electrical drawings)
- **Email:** Gmail API via OAuth refresh-token flow
- **Package manager:** npm (see `package-lock.json` — do not switch to pnpm/yarn)

## Scripts

| Command            | Purpose                                                              |
| ------------------ | -------------------------------------------------------------------- |
| `npm run dev`      | Local dev on http://localhost:3001                                   |
| `npm run build`    | Production build (runs `prebuild` → `generate-pdfkit-fonts.mjs`)     |
| `npm run start`    | Run production build locally                                          |
| `npm run lint`     | Next.js ESLint                                                       |
| `npm run check-env`| Verify required env vars are present (uses `scripts/check-env.mjs`)  |

## Required environment variables

Set in **Vercel → Settings → Environment Variables** (Production + Preview + Development) and mirror in local `.env.local`. Run `npm run check-env` to confirm.

| Key                              | What                                                                 |
| -------------------------------- | -------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`       | Supabase project URL                                                 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | Supabase anon key (client-side reads)                                |
| `SUPABASE_SERVICE_ROLE_KEY`      | Supabase service-role key (server-side writes — never expose)        |
| `JWT_SECRET`                     | Auth cookie signing secret (required in prod)                        |
| `ANTHROPIC_API_KEY`              | Claude Sonnet 4.6 — drives classification, extraction, and electrical drawing scan (14-step sub-pipeline) |
| `GOOGLE_CLIENT_ID`               | Google OAuth client ID for Gmail API                                 |
| `GOOGLE_CLIENT_SECRET`           | Google OAuth client secret                                           |
| `GOOGLE_REFRESH_TOKEN`           | Long-lived refresh token from `scripts/get-gmail-token.mjs`          |
| `GOOGLE_DRIVE_API_KEY`           | Optional API key for importing public Google Drive folder/file links from RFQ emails |
| `GMAIL_ACCOUNT`                  | Inbox to monitor (e.g. `estimation@sabi.ae`)                         |
| `ESTIMATION_EMAIL`               | Required-recipient gate (defaults to `estimation@sabi.ae`)           |

## Recommended / optional

| Key                              | Purpose                                                              |
| -------------------------------- | -------------------------------------------------------------------- |
| `INTERNAL_API_SECRET`            | Server-to-server auth for bid-decision flow (recommended in prod)    |
| `CRON_SECRET`                    | Required if you keep Vercel cron — see *Cron* section below          |
| `NEXT_PUBLIC_ELECTRICAL_ONLY`    | `1` to hide non-electrical UI sections                               |
| `NEXT_PUBLIC_APP_URL`            | Public ERP Realsoft URL used in BOQ PDFs and webhook callbacks; keep configurable until the final domain is chosen                    |
| `NEXT_PUBLIC_GMAIL_ACCOUNT`      | Display-only label on `/settings`                                    |
| `MAX_ATTACHMENT_MB`              | Per-attachment size cap (default `500`)                              |
| `BUCKET_MAX_BYTES`               | Storage bucket cap in bytes (default `50 * 1024 * 1024`)             |
| `DEFAULT_MARGIN_PERCENT`         | Default markup % on quotes (default `15`)                            |
| `WHATSAPP_DEFAULT_NUMBER`        | Fallback WhatsApp number for `/api/whatsapp/send`                    |
| `SUPABASE_S3_REGION`             | Supabase S3-protocol region (only if using S3 client path)           |
| `SUPABASE_S3_ACCESS_KEY_ID`      | Supabase S3 access key                                               |
| `SUPABASE_S3_SECRET_ACCESS_KEY`  | Supabase S3 secret                                                   |
| `SABI_FULL_NAME` / `SABI_ADDRESS` / `SABI_PHONE` / `SABI_EMAIL` / `SABI_WEBSITE` / `SABI_TRN` | Branding shown on BOQ PDFs |
| `ALLOW_SEED_TEST_RFQ`            | `true` to enable `/api/seed-test-rfq` in production (dev-only otherwise) |
| `REGISTRATION_ENABLED`           | `true` to allow `/api/auth/register` self-signup                     |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Initial admin seed via `/api/auth/seed-admin`                        |

## Pre-deploy checklist

1. `npm run check-env` passes locally with the same values you'll set on Vercel.
2. `npm run lint` is clean.
3. `npm run build` succeeds locally (catches type errors and missing assets like PDFKit fonts).
4. Supabase migrations applied — see `supabase/migrations/` (in particular `005_pipeline_v2.sql`, `006_main_subpipeline.sql`).
5. Supabase Storage bucket `sabi-attachments` exists and is private (signed URLs only).
6. Gmail OAuth client is alive (Google Cloud → APIs & Services → Credentials). If it was deleted, run `node scripts/get-gmail-token.mjs` to mint a new refresh token before deploy — see *OAuth client deleted* below.
7. Decide **manual-only inbox sync vs. cron** — see *Cron* section.

## Deploy via Vercel CLI

```bash
# one-time: link the local repo to a Vercel project
npx vercel link

# pull current env vars into .env.local for parity
npx vercel env pull .env.local

# preview deploy (every push to non-main branches does this automatically via Git)
npx vercel deploy

# production deploy
npx vercel deploy --prod
```

## Deploy via Git (recommended)

- Push to the connected GitHub repo. Vercel auto-builds and deploys:
  - Pushes to `main` → **Production**.
  - Pushes to other branches → **Preview** (unique URL per commit).
- Promote a Preview to Production from Vercel UI → Deployments → ⋯ → **Promote to Production**.

## Cron — manual sync vs. scheduled

`vercel.json` currently ships with **no cron block** (`{}`) per the egress audit. That keeps Supabase/Anthropic spend predictable. The pipeline below describes when each route should be triggered if you want background automation; choose how to wire it (Vercel cron, GitHub Actions, cron-job.org, etc.).

### Inventory of cron-eligible routes

| Route                                  | Recommended schedule | Purpose                                                         | Phase |
| -------------------------------------- | -------------------- | --------------------------------------------------------------- | ----- |
| `/api/cron/poll-inbox`                 | manual / off         | Gmail → Supabase sync. Now driven by the **Scan Inbox** UI.     | 0     |
| `/api/cron/auto-escalate-stale`        | `0 9 * * *` (daily)  | Auto-no-bid projects sat 7 days at Gate 1 with no response.     | 0     |
| `/api/cron/ai-cost-drift`              | `0 9 * * *` (daily)  | Yesterday's AI spend vs. trailing 30d baseline; WhatsApp alert. | 3     |
| `/api/cron/cohort-drift`               | `0 9 * * *` (daily)  | Per-cohort multiplier shift > 15% over 7d vs. 30d; alert + UI.  | 8     |
| `/api/cron/nb-self-eval`               | `0 2 * * *` (daily)  | Trains NB on holdout, logs F1 trend, optionally auto-promotes.  | 8     |

All routes accept the same auth pattern: `Authorization: Bearer ${CRON_SECRET}`. Without `CRON_SECRET` they run unauthenticated.

### Option A — Vercel cron (re-enable)

Add to `vercel.json` (only if the team has decided to take the egress hit):

```json
{
  "crons": [
    { "path": "/api/cron/auto-escalate-stale", "schedule": "0 9 * * *" },
    { "path": "/api/cron/ai-cost-drift",        "schedule": "0 9 * * *" },
    { "path": "/api/cron/cohort-drift",         "schedule": "0 9 * * *" },
    { "path": "/api/cron/nb-self-eval",         "schedule": "0 2 * * *" }
  ]
}
```

Re-running the egress audit will block this. Document the rationale in the PR if going down this path.

### Option B — external scheduler (recommended)

Pick any of:

- **GitHub Actions** — workflow that runs `curl -H "Authorization: Bearer $CRON_SECRET" $NEXT_PUBLIC_APP_URL/api/cron/<route>` on a schedule. No Vercel function-invocation cost.
- **cron-job.org** — free service, web UI to schedule HTTP GETs with custom headers.
- **EasyCron / GCP Cloud Scheduler / AWS EventBridge** — same pattern, paid options for orgs with central infra.

Whichever you pick, set `CRON_SECRET` in Vercel env *and* in the scheduler.

### Option C — manual / on-demand

Hit each cron's GET URL with `Authorization: Bearer $CRON_SECRET` from a terminal when needed. Sufficient for low-volume periods (< 5 projects/week). Not recommended once cohort-drift signal becomes load-bearing.

### Auto-promote toggle

`/api/cron/nb-self-eval` reads `NB_AUTO_PROMOTE` env. Set to `1` once the operator has reviewed a few `/api/admin/nb-trend` runs and trusts the recommendation; default off keeps a human in the loop.

## First-deploy bootstrap

After the first successful production deploy:

1. Hit `https://<your-domain>/api/auth/seed-admin` (POST) with `ADMIN_EMAIL` + `ADMIN_PASSWORD` set in env. Disable `REGISTRATION_ENABLED` afterwards.
2. Log in via `/auth/login`, navigate to `/inbox`, click **Refresh** → confirm Gmail sync works (no `Token refresh failed` error).
3. Click **Scan Inbox** to verify `/api/cron/poll-inbox` runs end-to-end (RFQ keyword filter + classification + project creation).
4. Open one project, run **Extract Building** (gate 1) to verify Claude integration.
5. On a Detailed-path project, trigger Estimate to verify Claude integration on a sample electrical drawing.

## Post-deploy verification

| Check                                                         | How                                                              |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| App boots, no env-related 500s                                | `https://<domain>/inbox` loads without error banner              |
| Supabase RLS policies allow service-role writes               | Trigger Scan Inbox → projects appear                              |
| Gmail sync works                                              | Refresh button on `/inbox` → "Synced N new email(s)"             |
| Claude classification works                                   | Scan Inbox creates projects with `ai_classification._provider = "claude-sonnet-4-6"` |
| Keyword pre-filter works                                      | Send a non-RFQ test email → project shows `_provider = "keyword-filter"` and `priority = "ignore"` |
| Claude electrical scan works                                  | Run Estimate on a drawing project → cable schedule populates     |
| BOQ PDF renders                                               | Approve gate 14 → PDF lands in `boq/{id}/power-boq.pdf`          |

## Rolling back

- Vercel UI → Deployments → pick the last-known-good deploy → **Promote to Production**.
- Avoid `vercel rollback` — the UI flow is more reliable across env-var changes.

## Common issues

### "Token refresh failed: The OAuth client was deleted"

The Google Cloud OAuth client was deleted, so the refresh token is invalid.

1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** (Web application).
2. Add `http://localhost:3001/api/gmail/callback` to **Authorized redirect URIs**.
3. Add the inbox account (`GMAIL_ACCOUNT`) to **Test users** if the consent screen is in Testing.
4. Copy the new Client ID/Secret into `.env.local`.
5. `node scripts/get-gmail-token.mjs` → completes OAuth flow → prints `GOOGLE_REFRESH_TOKEN=...`.
6. Update `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` in Vercel env vars (all environments).
7. Vercel → Deployments → Redeploy latest so it picks up the new env.

### `npm run build` fails on `prebuild`

`scripts/generate-pdfkit-fonts.mjs` writes embedded fonts. Make sure `node_modules/pdfkit` is installed (`npm ci`).

### Supabase 500s in API routes

Check `SUPABASE_SERVICE_ROLE_KEY` (server) and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (client) are both set and not swapped.

### "process.env.X is not defined" in client code

Only `NEXT_PUBLIC_*` env vars are exposed to the client. Anything else must stay server-only.
