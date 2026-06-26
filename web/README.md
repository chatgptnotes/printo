# ERP RealSoft Web (Next.js frontend)

The Next.js / Vercel frontend for ERP RealSoft. It talks to the Python FastAPI
backend on the VPS and provides drawing upload, fresh AI extraction, BOQ review,
approval, Excel export, and ERP handoff.

## Architecture

```text
Browser -- same-origin HttpOnly cookie --> Next.js on Vercel
                                        app/api/* BFF proxy
                                        attaches Authorization: Bearer <JWT cookie>
                                        FastAPI backend on VPS
```

- The browser calls same-origin `/api/*` routes only.
- The BFF proxy attaches the JWT from the HttpOnly cookie server-side.
- Upload streaming is proxied through `/api/upload`; large files use chunked upload.

## Local Development

Prereqs: Node 20 or newer, and the Python backend running:

```bash
python -m uvicorn main:app --app-dir backend --port 8000
```

Frontend:

```bash
cd web
cp .env.local.example .env.local
npm install
npm run dev
```

Set `ERP_REALSOFT_API_URL=http://127.0.0.1:8000` in `.env.local`.

Log in with the backend seeded admin credentials, then change them for production.

## Deploy To Vercel

1. Import the Git repo into Vercel.
2. Set Root Directory to `web`.
3. Set environment variables:
   - `ERP_REALSOFT_API_URL`: VPS backend base URL, preferably HTTPS.
   - `SESSION_COOKIE`: optional; defaults to `erp_realsoft_session`.
   - `PRINTO_API_URL`: legacy fallback only, retained for existing deployments.
4. Deploy after `npm run build` passes.

## Backend Prerequisites

- Serve the FastAPI backend over HTTPS so Secure cookies work.
- Set `ALLOWED_ORIGINS` to the Vercel domain and local development origin.
- Set a strong `AUTH_SECRET` and change the seeded `ADMIN_PASSWORD`.
- Keep `/api/upload` on a Vercel plan that allows enough function duration for
  long drawing extraction jobs.

## Structure

```text
web/
  app/
    (app)/            authenticated route group
      page.tsx        upload, samples, uploader, live SSE log
      results/[id]/   extraction results, BOQ review, corrections, exports
      report/[id]/    inline report iframe and PDF
      history/        drawings list
    api/              BFF proxy routes
    login/            login page
  components/         UI, navigation, upload, pipeline, results
  lib/                API proxy, auth, store, types, constants, formatting
  middleware.ts       redirects unauthenticated page requests to /login
```
