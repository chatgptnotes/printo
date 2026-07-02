# Deployment - ERP Realsoft

Reference for deploying the ERP Realsoft Next.js app to Vercel.

## Stack

- **Framework:** Next.js 14 App Router
- **Hosting:** Vercel
- **Database/Storage:** Supabase Postgres and private Storage bucket `sabi-attachments`
- **AI:** Anthropic or Nexaproc gateway, depending on environment
- **Intake:** Users create projects and upload drawings/specifications directly

## Required Environment Variables

Set these in Vercel production and mirror them locally when testing:

| Key | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client-side Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase writes |
| `JWT_SECRET` | Auth cookie signing secret |
| `ANTHROPIC_API_KEY` | Direct Claude path, if not using gateway |
| `USE_AI_GATEWAY` | Enables the Nexaproc gateway path |
| `NEXAPROC_GATEWAY_URL` | Gateway URL |
| `DRAWTOBOQ_AIAS_KEY` | Gateway tenant key |
| `NEXT_PUBLIC_APP_URL` | Public app URL |

Optional production keys include `INTERNAL_API_SECRET`, `CRON_SECRET`, `MAX_ATTACHMENT_MB`, `DEFAULT_MARGIN_PERCENT`, and `SABI_*` branding values.

## Pre-Deploy Checklist

1. `npm run build` succeeds locally.
2. Supabase migrations are applied.
3. Supabase Storage bucket `sabi-attachments` exists and is private.
4. Production mock/demo extraction remains disabled.
5. Direct project creation and file upload are verified in staging or production.

## Deploy

```bash
npm ci
npm run build
vercel --prod --yes
```

## Post-Deploy Verification

| Check | How |
| --- | --- |
| App boots | Open `https://<domain>/` after login |
| Direct intake works | Click **Generate BOQ with AI** and create a project |
| Upload works | Upload drawing/spec/archive files into the project |
| Extraction works | Run extraction and confirm review gates populate |
| BOQ export works | Generate workbook/PDF after review |

## Removed Email Integration

Gmail inbox sync, email reading, email attachment fallback, reply templates, and quotation email sending are disabled. Users should upload files directly into ERP Realsoft projects.
