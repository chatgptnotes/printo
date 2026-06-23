# Printo Web (Next.js frontend)

The Next.js / Vercel frontend for Printo. It replaces the Streamlit UI with full
feature parity and talks to the **existing Python FastAPI backend** (on the VPS) —
the backend is unchanged.

## Architecture

```
Browser ──(same-origin, HttpOnly cookie)──▶ Next.js (this app, on Vercel)
                                              app/api/*  →  BFF proxy
                                              attaches Authorization: Bearer <JWT cookie>
                                              ▼
                                     FastAPI backend (VPS) — SQLite, storage, AI pipeline
```

- The browser only ever calls **same-origin** `/api/*` routes. Those proxy to the
  Python backend server-side and attach the JWT (kept in an **HttpOnly cookie**, never
  exposed to client JS). This also lets the report HTML render in an `<iframe>` and PDFs/
  Excel download without putting a token in the URL.
- SSE upload streaming is proxied through `/api/upload` (route has `maxDuration = 300`).

## Local development

Prereqs: Node ≥ 20, and the Python backend running (e.g.
`python -m uvicorn main:app --app-dir backend --port 8000` from the repo root).

```bash
cd web
cp .env.local.example .env.local       # set PRINTO_API_URL=http://127.0.0.1:8000
npm install
npm run dev                            # http://localhost:3000
```

Log in with the backend's seeded admin (default `Admin` / `Admin@123` — change in prod).

## Deploy to Vercel

1. Import the Git repo into Vercel; set **Root Directory = `web`** (framework auto-detects Next.js).
2. Set environment variables:
   - `PRINTO_API_URL` — the VPS backend base URL (use **https**), e.g. `https://api.printo.example.com`.
   - `SESSION_COOKIE` — optional; defaults to `printo_session`.
3. Deploy. `npm run build` must pass (strict TypeScript).

### Backend prerequisites (one-time, on the VPS)
- Serve the FastAPI backend over **HTTPS** (domain + certbot) so `Secure` cookies work.
- Set **`ALLOWED_ORIGINS`** on the backend to the Vercel domain(s), e.g.
  `ALLOWED_ORIGINS=https://printo.vercel.app,http://localhost:3000` (CORS is otherwise `*`).
- Set a strong `AUTH_SECRET` and change the seeded `ADMIN_PASSWORD`.
- ⚠️ `maxDuration = 300` on `/api/upload` requires Vercel **Pro**; on Hobby (60s cap) a long
  extraction can be cut off — see the SSE fallback note in the migration plan.

## Structure

```
web/
  app/
    (app)/            # authenticated route group (sidebar shell)
      page.tsx        # Upload (hero + 3D + samples + uploader + live SSE log)
      results/[id]/   # extraction results, heatmap, validation, corrections, exports
      report/[id]/    # inline report iframe + PDF (id="project" → project report)
      history/        # drawings list
    api/              # BFF proxy routes (auth, upload-SSE, drawings, report, export, health)
    login/            # login page
  components/         # ui / nav / upload / pipeline / results
  lib/                # api (proxy), auth (cookie/JWT), store (zustand), types, constants, format
  middleware.ts       # redirects unauthenticated page requests to /login
```
