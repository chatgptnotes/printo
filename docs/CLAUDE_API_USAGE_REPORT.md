# Claude API Usage & Library-Replacement Report

_Generated: 2026-05-05 · Scope: SABI RFQ→BOQ pipeline (realsoft.example)_

---

## Table 1 — Setup & routing

| Item | Value |
|---|---|
| SDK | `@anthropic-ai/sdk@^0.90.0` |
| Wrapper | `callClaude()` in `src/lib/ai/claude-api.ts:117` |
| Provider router | `src/lib/ai/ai-provider.ts` (re-export shim — Claude only) |
| Model — fast/text | `claude-haiku-4-5-20251001` |
| Model — vision | `claude-sonnet-4-6` |
| Cost logging | `src/lib/notifications/api-alert.ts` |

---

## Table 2 — Where Claude API is called in the pipeline

| # | MAIN step | Sub-step | Function | File:line | Model | Input | Purpose |
|---|---|---|---|---|---|---|---|
| 1 | 1 Read Email | — | `classifyEmail` | claude-api.ts:312 | Haiku 4.5 | text | RFQ detection + priority tier |
| 2 | 2 Register / 8 Extract Building | — | `extractProjectInfo` | claude-api.ts:411 | Sonnet 4.6 | text + PDF/img | Client, location, floors, area, services, deadline |
| 3 | 6 List Documents | — | `analyzeSpecifications` | claude-api.ts:689 | Sonnet 4.6 | text + PDF/img | Approved makes, BS/ASTM/DIN/EN, brand refs |
| 4 | 11 Run Pricing (Detailed) | Electrical 1–13 | `analyzeElectricalProcedure` | claude-api.ts:1512 | Sonnet 4.6 | text + PDF/img | 14-step electrical BOQ — MDB/SMDB, cables, DBs, outlets, containment, earthing |
| 5 | 11 Run Pricing (lighter) | — | `analyzeElectricalDrawing` | claude-api.ts:1290 | Sonnet 4.6 | text + PDF/img | Lighter electrical extraction — DBs, transformers, gensets, ATS |
| 6 | (out-of-scope) | — | `analyzeHVACProcedure` | claude-api.ts:995 | Sonnet 4.6 | text + PDF/img | 37-step HVAC procedure (kept, not active in electrical-only pipeline) |
| 7 | (out-of-scope) | — | `analyzeDuctRouteDrawing` | claude-api.ts:897 | Sonnet 4.6 | text + PDF/img | HVAC duct routing |
| 8 | (out-of-scope) | — | `analyzeWaterSupplyDrawing` | claude-api.ts:807 | Sonnet 4.6 | text + PDF/img | Plumbing risers / pumps |
| 9 | (out-of-scope) | — | `analyzeMEPDrawing` | claude-api.ts:1155 | Sonnet 4.6 | text + PDF/img | Generic multi-discipline MEP |

---

## Table 3 — Functions in `claude-api.ts` that already use NO API

| Function | File:line | Implementation |
|---|---|---|
| `classifyDrawingDiscipline` | claude-api.ts:647 | Keyword scoring on filename + extracted text |
| `classifyReputation` | claude-api.ts:668 | Area / client keyword heuristic |

---

## Table 4 — Existing cost guardrails

| Tier | Mechanism | Where |
|---|---|---|
| 1 | Naive Bayes pre-filter for emails | `classifyEmail` |
| 1 | Brand-dictionary pre-filter for specs | `analyzeSpecifications` |
| 1 | Keyword scoring (no API) | `classifyDrawingDiscipline`, `classifyReputation` |
| 2 | SHA-256 content-hash cache on `(prompt + text)` | `callClaude` wrapper |

---

## Table 5 — Bucket A · Fully replaceable (drop the AI call entirely)

| # | Today's Claude call | Replace with | Why it works | Effort |
|---|---|---|---|---|
| A1 | `classifyEmail` | `natural` (Naive Bayes) or local DistilBERT via `@xenova/transformers` | Pre-filter already exists; train on labelled `sabi_emails` rows | S |
| A2 | `classifyDrawingDiscipline` | (already library) | Keep as-is | — |
| A3 | `classifyReputation` | (already library) | Keep as-is | — |
| A4 | Scale annotation read (electrical sub 4) | `pdfjs-dist` + regex `/1[:\s]*(50\|100\|200)/` on title-block text; `dxf-parser` for DXF | Scale is always stamped in the title block | S |
| A5 | Floor count / floor heights from title-block schedule | `pdfjs-dist` text + regex on `B1, GF, 1F…` | Title-block level schedules are deterministic text | S |
| A6 | Panel-schedule tables (native-text PDFs) | `pdf-table-extractor` or `tabula-js` | Vendor panel schedules are selectable text in a grid | M |
| A7 | DXF discipline detection by layer name | `dxf-parser` (already a dep) → `E-`, `ELEC`, `POWR`, `LITE`, `MDB`, `SMDB` | Documented in CLAUDE.md; just route DXF first | S |
| A8 | DOCX spec ingestion | `mammoth` + extended brand dictionary | Existing dictionary already short-circuits at 4+ brand hits | M |
| A9 | XLSX BOQ template ingestion | `exceljs` (already a dep) | Vendor quote spreadsheets are pure cell reads | S |

---

## Table 6 — Bucket B · Shrink the Claude prompt (library does deterministic parts, Claude only handles ambiguity)

| # | Today's Claude call | Library that pre-extracts | What Claude is still needed for |
|---|---|---|---|
| B1 | `extractProjectInfo` | `pdfjs-dist`, `mammoth`, `chrono-node`, `mailparser` | Disambiguating client vs consultant; fuzzy area phrases ("approx 18k sft") |
| B2 | `analyzeElectricalProcedure` sub-steps 1–4 | `pdfjs-dist` (title block), `dxf-parser` (metadata) | Only when title block is image-only |
| B3 | `analyzeElectricalProcedure` sub-step 5 (LV/MDB locate) | `pdf-table-extractor` for symbol legend | One-line geometry only |
| B4 | `analyzeElectricalProcedure` sub-steps 10 & 13 (cable lengths) | `pdfjs-dist` for scale + `pdf-to-img` + `@techstark/opencv-js` for pixel-run measurement | Riser routing decisions only — kill the "confidence-flagged" guesses |
| B5 | `analyzeSpecifications` for **scanned** PDFs | `tesseract.js` OCR + brand dictionary | Only when OCR confidence < threshold |
| B6 | Outlet / fixture counting on floor plans | `@techstark/opencv-js` template matching from symbol legend | Only when symbols are non-standard |

---

## Table 7 — Bucket C · Already partially replaceable, just turn the lever harder

| # | Lever | Action |
|---|---|---|
| C1 | Naive Bayes pre-classifier on `classifyEmail` | Lower forward-to-Haiku threshold once ≥500 labelled rows in `sabi_emails`; target ~80 % API-free |
| C2 | Brand-dictionary in `analyzeSpecifications` | Extend dictionary from `sabi_attachments` corpus; lower trigger from 4 brands → 2 |
| C3 | Content-hash cache | Hash a normalised PDF text (strip dates / page numbers) so re-issued spec packs hit cache |
| C4 | DXF path | Always run `dxf-parser` first; Claude only on zero electrical hits |

---

## Table 8 — Recommended sequencing

| Phase | Items | Effort | Notes |
|---|---|---|---|
| 1 — Quick wins | A4, A5, A7, A8, C1, C2, C4 | 1–2 days each | Local-library swaps against existing or tiny-add deps |
| 2 — Medium | A6, B1, B2 | ~1 week | Removes Sonnet from easy 60 % of electrical sub-steps 1–5 |
| 3 — Larger | B4, B6 | 2–4 weeks | CV/geometry; biggest accuracy win for cable schedules |

---

## Table 9 — Estimated impact

| Lever | Type | Expected impact |
|---|---|---|
| B2 (electrical sub-steps 1–5 pre-extract) | Cost | ~40 % of Sonnet token spend per project removed |
| C1 (Naive Bayes threshold) | Cost | ~80 % of Haiku calls removed at steady state |
| B4 (geometry-based cable lengths) | Accuracy | Eliminates today's "low-confidence" rows in cable schedule |
| A8 + B5 (DOCX/OCR + dictionary) | Cost | Removes Sonnet from spec ingestion in most cases |

---

## Table 10 — Files audited

| File | Role |
|---|---|
| `src/lib/ai/claude-api.ts` | All Claude functions (single provider) |
| `src/lib/ai/ai-provider.ts` | Re-export shim of `claude-api` |
| `src/app/api/projects/[id]/estimate/route.ts` | AI call site for the electrical procedure |
| `src/lib/notifications/api-alert.ts` | Token + savings logging |
| `package.json` | Confirms `@anthropic-ai/sdk@^0.90.0`, `dxf-parser`, `exceljs` installed |
