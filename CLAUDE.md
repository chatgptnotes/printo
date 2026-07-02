# CLAUDE.md - ERP Realsoft SABI RFQ-to-BOQ Pipeline

## PROJECT
Automated RFQ processing and MEP estimation pipeline for SABI (MEP contractor, Dubai, UAE).
Product identity: ERP Realsoft. Public domain is configured through `NEXT_PUBLIC_APP_URL` and is not hardcoded yet. Single discipline: **Electrical (Power)**.

## TECH STACK
- React 18 + TypeScript
- Next.js 14 (App Router)
- Tailwind CSS
- Supabase (PostgreSQL + Storage)
- Vercel deployment
- Anthropic Claude Sonnet 4.6 (classification, extraction, electrical drawing scanning sub-steps 1–14)
- OpenClaw CLI (WhatsApp notifications)
- gog CLI (Gmail access)
- ExcelJS (BOQ generation)

## PIPELINE ARCHITECTURE — MAIN + ELECTRICAL SUB

The workflow follows the SABI RFQ→Quote pipeline (4 phases · 5 gates) shown in
`d:\work\data\sabi-workflow.pdf`, restricted to the Electrical discipline. Phase 3
take-off is the 14-step electrical cable-schedule procedure — no HVAC step 12 a–h,
no plumbing/firefighting take-off.

### MAIN pipeline — 15 steps · 5 gates (`MAIN_PIPELINE_STEPS` in `lib/shared/constants.ts`)

**Phase 1 · Information Sufficiency** (steps 1–9)
1. Read Email · 2. Register Enquiry · 3. Open Folder · 4. Unload Attachments
5. Extract Archive · 6. List Documents · 7. List Drawings · 8. Extract Building
9. **Gate 1 — Documents Sufficient?**

**Phase 2 · Bid / No-Bid** (step 10)
10. **Gate 2 — Bid Decision** (2-way: No-Bid · Detailed) — handled by `/api/projects/[id]/bid-decision`

**Phase 3 · Quantities** (steps 11–12)
11. Run Pricing — enters the **Electrical Sub-pipeline** below for detailed take-off
12. **Gate 3 — Confirm Quantities?** (= sub-pipeline gate 14)

**Phase 4 · Final Quote** (steps 13–15)
13. Yardstick Check
14. **Gate 4 — Confirm Total?**
15. **Gate 5 — Consent → Send** → END · SENT

### ELECTRICAL SUB-PIPELINE — 14 steps (within MAIN step 11, Detailed path)

Runs via `POST /api/projects/[id]/estimate`. Claude Sonnet 4.6 scans uploaded drawings.

1.  Open the Drawing — locate all electrical drawings in the attachment set
2.  List Available Drawings — classify each drawing: floor_plan / schematic / riser / schedule / other
3.  Establish Floors and Floor Height — count and name every level; note typical floor height
4.  Find Drawing Scale — read scale annotation or scale bar (e.g. 1:100)
5.  Identify LV Room / MDB — find Main LV Panel / MDB (most probably Ground Floor); note tag, rating, location
6.  Check Schematic Drawing Availability — confirm if SLD or schematic exists
7.  Note SMDBs from LV Panel — from schematic: list every SMDB fed from MDB, tag, floor, rating, cable size
8.  Identify SMDBs in Floor Drawings — confirm SMDB locations on floor plans, Basement → Roof
9.  Establish Cable Route LV Panel → SMDBs — riser drawing or annotations; note probable route
10. Estimate Cable Lengths & Sizes (LV → SMDBs) — cable size mm², estimated length m, confidence level
11. Establish SMDB → DB Identification — from schematic: list every DB fed from each SMDB
12. Identify DB Locations per SMDB — from floor plans, confirm DB locations floor by floor
13. Estimate Cable Size & Length per DB — scaled floor plan measurement; confidence flagged
14. **Gate — Cable Schedule Review** (= MAIN Gate 12 on the Detailed path)
    → On approval: `generateElectricalPowerBOQ()` runs → 12-section Power BOQ PDF stored in Supabase → status: `boq_ready`

### Gate routing
- Binary gates (`9, 12, 14, 15`) go through `POST /api/projects/[id]/gate` (approve / reject / revert).
- Gate 14 is overloaded by `previousStatus`:
  - `pricing_pending` → cable-schedule review → renders Power BOQ PDF.
  - `confirm_total_pending` → MAIN Confirm Total → advances to `consent_pending`.
- Gate 10 (2-way Bid Decision: No-Bid · Detailed) uses its own endpoint `/bid-decision`.
- PDF stored at `boq/{id}/power-boq.pdf` in `sabi-attachments` bucket.

### Accepted drawing formats (estimate route)
| Format | How it's processed |
|---|---|
| **PDF · PNG · JPG / JPEG** | Sent to Claude as vision input. Full geometric understanding. |
| **DXF** | Parsed server-side via `dxf-parser` (`src/lib/drawing/dxf-text-extractor.ts`). Layer table, block names, and TEXT/MTEXT entities feed the AI procedure as additional context. Layer prefixes (`E-`, `ELEC`, `POWR`, `LITE`, `MDB`, `SMDB`) act as a strong discipline signal. |
| **DWG** | Binary AutoCAD format — auto-converted. **Free path:** LibreDWG-WASM (`@mlightcad/libredwg-web`) converts DWG→DXF in-process via `lib/drawing/dwg-converter.ts`, then the existing DXF summary (layers + TEXT/MTEXT) feeds the procedure (text-grade, no geometry vision). **Paid fallback:** if the WASM path yields no usable text and `CLOUDCONVERT_API_KEY` is set, CloudConvert renders DWG→PDF for full vision scanning (`lib/drawing/cloudconvert.ts`). If both fail, the file is skipped with the manual-conversion guidance. |

Discipline detection runs in two passes: (1) the extract phase tags each attachment via `classifyDrawingDiscipline()` (filename + extracted text keyword scoring), (2) the estimate route re-classifies live and rejects files whose stored OR detected discipline is in `NON_ELECTRICAL_DISCIPLINES = {hvac, plumbing, fire_fighting, fire_alarm, bms, lpg, drainage}`. Skipped files are returned in the 422 response body so the operator can see exactly why each file was excluded.

### Email auto-intake (Step 00 + Phase 1 entry)
Vercel cron schedule in `vercel.json`:
- `/api/cron/poll-inbox` every 15 minutes — polls Gmail (`GMAIL_ACCOUNT`), syncs new emails into `sabi_emails`, classifies RFQ candidates into `sabi_projects` with `status='classified'`.
- `/api/cron/auto-escalate-stale` daily 09:00 UTC — escalates No-Bid candidates that sat 7 days without action.

Required env vars for the cron to work in production:
- `CRON_SECRET` — Vercel sends `Authorization: Bearer <CRON_SECRET>`. **Without this, the GET endpoint runs unauthenticated.** Set in Vercel project settings AND `.env.local`.
- `GMAIL_ACCOUNT`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` — OAuth credentials for the inbox to monitor.
- `ESTIMATION_EMAIL` — defaults to `estimation@sabi.ae`; only mail addressed here is treated as a quotation request.

Manual trigger from the UI uses `POST /api/cron/poll-inbox` (no auth needed — gated by app login).

### Power BOQ PDF sections (matches P-379_POWER_BOQ.pdf format)
1. Project Summary
2. Incoming Supply & Transformers
3. LV Panels
4. Sub-Main Distribution Boards (SMDB)
5. Distribution Boards (DB)
6. Mechanical & Service Equipment
7. Power Outlets & Accessories
8. Cables — Main Distribution (cable schedule)
9. Containment (cable tray, trunking, conduit)
10. Earthing & Lightning Protection
11. Metering & Monitoring
12. Summary of Electrical Loads

Email polling (`/api/cron/poll-inbox`) and stale escalation (`/api/cron/auto-escalate-stale`) are **disabled** — pipeline is triggered manually via the UI.

## DATABASE TABLES
- sabi_projects — bid list with status tracking + bid_decision, critical_drawings_status, boq_quality, scale_detection (added in 005_pipeline_v2.sql)
- sabi_attachments — cataloged email attachments
- sabi_services — MEP services per project + confidence (high/medium/low) and pricing_source (library/ai_estimate/manual)
- sabi_estimations — calculation results and approval status
- sabi_activity_log — audit trail per step. Column `sub_pipeline` (added in 006_main_subpipeline.sql) discriminates MAIN (NULL) vs sub-pipeline rows ('electrical'). Step range covers MAIN 1..15 and ELECTRICAL sub 1..14 (DB constraint kept at 0..33 for migration headroom).
- sabi_yardstick_rates — market benchmark rates
- sabi_no_bid_log — terminal-exit audit (Gate 13 No-Bid + 7-day auto-escalation)

## KEY PEOPLE
- George Varkey M — Technical Director, approval authority (george@sabi.ae)


## QUALITY BARS
- Zero TypeScript errors
- Every AI step has manual override
- 5 confirmation gates (Documents Sufficient, Bid Decision, Confirm Quantities, Confirm Total, Consent Received) — Standard path enforces all 5. **INSTANT BOQ lane** (the "Run to BOQ" button on the bid detail page) auto-approves Gates 1–4 and stops at Gate 5 (Send to Client) — Gate 5 always remains a human checkpoint, never collapse.
- All estimations compared against yardstick values


## Ironbark

This project uses automatic skill harvesting powered by the Ironbark learning loop.

- **Auto-harvest**: After complex sessions (15+ tool calls), you'll be nudged to run `/ironbark`
- **Manual harvest**: Run `/ironbark` at any time to extract reusable patterns from the current session
- **Cross-project**: Skills are saved to `~/.claude/skills/harvested/` and shared across all projects
- **What gets harvested**: Non-trivial approaches, trial-and-error discoveries, debugging patterns, integration quirks
- **Existing skills**: `/learn`, `/learn-eval`, and instincts continue working alongside Ironbark

## Karpathy Coding Guidelines

> Source: https://github.com/forrestchang/andrej-karpathy-skills
> Derived from Andrej Karpathy's observations on LLM coding pitfalls.

### 1. Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — do not pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that was not requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

### 3. Surgical Changes
- Do not improve adjacent code, comments, or formatting.
- Do not refactor things that are not broken.
- Match existing style, even if you would do it differently.
- Only remove imports/variables/functions that YOUR changes made unused.
- Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution
- Transform tasks into verifiable goals before starting.
- For multi-step tasks, state a brief plan with a verify step for each.
- Define success criteria concretely — weak criteria require constant clarification.

## AI gateway routing

All Claude calls route through the Nexaproc AI Gateway via
`src/lib/ai/nexaproc-client.ts` when `USE_AI_GATEWAY=true`. The gateway is a
self-hosted HTTP wrapper around the Claude CLI that gives single-point
egress control across tenants. The legacy direct `@anthropic-ai/sdk` path
remains in `src/lib/ai/claude-api.ts` behind the same flag for the rollback
window; once a week of prod traffic is clean we delete the SDK path and the
flag. To add a new prompt, register a new `DRAWTOBOQ_*` taskID on the
gateway side (`chatgptnotes/AI-aas`, `src/templates.ts`) — do not inline
prompts at the call site.

