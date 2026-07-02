# Claude API — Electrical Pipeline Usage & Free-Library Replacement List

_Project: SABI RFQ→BOQ (realsoft.example) · Discipline: Electrical (Power) · Generated 2026-05-05_

---

## Table 1 — Every Claude API call in the electrical pipeline

| # | Pipeline step | Function | File:line | Model | What it does today |
|---|---|---|---|---|---|
| 1 | MAIN 1 — Read Email | `classifyEmail` | claude-api.ts:312 | Haiku 4.5 | Decides if an inbox email is an electrical RFQ; assigns priority tier |
| 2 | MAIN 2 + 8 — Register / Extract Building | `extractProjectInfo` | claude-api.ts:411 | Sonnet 4.6 | Pulls client, location, floors, area, deadline from email + attachments |
| 3 | MAIN 6 — List Documents | `analyzeSpecifications` | claude-api.ts:689 | Sonnet 4.6 | Extracts approved makes, BS/ASTM/DIN standards, brand refs from electrical spec PDFs |
| 4 | MAIN 11 — Run Pricing (Detailed) | `analyzeElectricalProcedure` | claude-api.ts:1512 | Sonnet 4.6 | Runs all 13 sub-steps of the electrical procedure on uploaded drawings |
| 5 | MAIN 11 — Run Pricing (lighter) | `analyzeElectricalDrawing` | claude-api.ts:1290 | Sonnet 4.6 | Pulls DBs, transformers, gensets, ATS, capacitor banks, cable schedules, outlet counts |

---

## Table 2 — Electrical sub-pipeline (sub-steps 1–13 inside call #4)

| Sub-step | Task today (Sonnet 4.6) |
|---|---|
| 1 | Open the drawing — locate all electrical drawings in attachment set |
| 2 | List available drawings — classify (floor_plan / schematic / riser / schedule) |
| 3 | Establish floors and floor heights — count and name every level |
| 4 | Find drawing scale — read scale annotation or scale bar |
| 5 | Identify LV Room / MDB — find Main LV Panel / MDB; tag, rating, location |
| 6 | Check schematic / SLD availability |
| 7 | Note SMDBs from LV Panel — list every SMDB fed from MDB |
| 8 | Identify SMDBs in floor drawings — confirm SMDB locations basement→roof |
| 9 | Establish cable route LV Panel → SMDBs |
| 10 | Estimate cable lengths & sizes (LV → SMDBs) |
| 11 | Establish SMDB → DB identification |
| 12 | Identify DB locations per SMDB on floor plans |
| 13 | Estimate cable size & length per DB |

---

## Table 3 — What can be replaced FREELY (no API cost) by a library

"Freely" = open-source library, runs locally, deterministic answer, no per-call charge.

| # | Today's Claude work | Sub-step / function it lives in | Free library replacement | Already in `package.json`? | Replaces Claude **fully** or **partly**? |
|---|---|---|---|---|---|
| R1 | Read drawing scale from title block | sub-step 4 | `pdfjs-dist` + regex `/1[:\s]*(50\|100\|200)/` | No (add) | **Fully** |
| R2 | Count floors / list level names | sub-step 3 | `pdfjs-dist` text + regex on `B1, GF, 1F, 2F…` | No (add) | **Fully** |
| R3 | List available electrical drawings | sub-step 2 | Filename regex + `dxf-parser` for DXF metadata | `dxf-parser` ✅ | **Fully** |
| R4 | Confirm a file is electrical (vs other disciplines that arrive in the same RFQ pack) | preflight to `analyzeElectricalProcedure` | `dxf-parser` matching `E-`, `ELEC`, `POWR`, `LITE`, `MDB`, `SMDB` layer prefixes | ✅ | **Fully** |
| R5 | Read native-text panel-schedule tables (DB schedules in vendor PDFs) | sub-steps 11, 12 | `pdf-table-extractor` or `tabula-js` | No (add) | **Fully** (when text layer exists) |
| R6 | Ingest XLSX cable / DB schedules supplied by client | feeds sub-steps 7, 11 | `exceljs` | ✅ | **Fully** |
| R7 | Ingest DOCX electrical specs | `analyzeSpecifications` | `mammoth` to extract text + brand-dictionary scan | No (add `mammoth`) | **Partly** (covers ~70 % — Claude only on scanned/image-only specs) |
| R8 | OCR scanned electrical spec PDFs | `analyzeSpecifications` | `tesseract.js` + brand-dictionary | No (add) | **Partly** (covers scanned tail) |
| R9 | Electrical RFQ email classification | `classifyEmail` | `natural` (Naive Bayes) trained on labelled `sabi_emails` rows | No (add) | **Partly → Fully** once ≥500 labelled rows exist |
| R10 | Project metadata cleanup before Claude | `extractProjectInfo` | `mailparser` (clean email body) + `chrono-node` (parse "by next Tuesday" → date) + `pdfjs-dist` (PDF text) | No (add) | **Partly** — deadlines / floors / area become free; Claude only disambiguates client vs consultant |
| R11 | Cable-length math (LV→SMDB and SMDB→DB) | sub-steps 10, 13 | `pdfjs-dist` (read scale) + `pdf-to-img` + `@techstark/opencv-js` (measure pixel runs along polylines) → `pixels × scale` | No (add) | **Partly** — replaces today's guess-based output; Claude still picks the route |
| R12 | Outlet / fixture / DB symbol counting on floor plans | sub-step 12 + outlet counting in `analyzeElectricalDrawing` | `@techstark/opencv-js` template matching against the symbol legend | No (add) | **Partly** — works for standard glyphs; Claude for non-standard |
| R13 | `classifyDrawingDiscipline` (already heuristic, used to filter electrical drawings in) | preflight | (already library — keyword scoring) | — | **Fully** (no change needed) |
| R14 | `classifyReputation` (already heuristic) | reputation tier | (already library — keyword heuristic) | — | **Fully** (no change needed) |

---

## Table 4 — What stays on Claude (cannot be sensibly replaced)

| # | Claude work that stays | Why a library can't do it |
|---|---|---|
| K1 | SLD / one-line geometry interpretation — building the MDB→SMDB→DB tree | sub-steps 5, 7, 11 | Requires understanding hand-drawn schematic conventions and tag relationships |
| K2 | Image-only title blocks (no PDF text layer, poor OCR) | sub-steps 3, 4 | Vision still wins on low-quality scans |
| K3 | Cable-route decisions — which path the riser actually takes | sub-steps 9, 10, 13 | Multiple valid routes; needs judgment. Geometry only handles math once route is picked |
| K4 | Disambiguating client vs consultant vs architect on RFQ emails | `extractProjectInfo` | Names overlap; needs language understanding |
| K5 | Spec text where electrical brand standards are written in prose (not lists) | `analyzeSpecifications` | Free-form sentences need NLP-grade reading |

---

## Table 5 — Project impact if all "freely replaceable" rows are done

| Replacement | Current call | After swap | Net effect |
|---|---|---|---|
| R1 + R2 + R3 | Sonnet vision pass for sub-steps 1–4 of every electrical drawing | Local PDF/DXF text reads | ~30–40 % cut in Sonnet tokens per project |
| R4 | Sonnet pass on DXF files | `dxf-parser` first, Sonnet only on miss | DXF-based projects become near-free for first-pass triage |
| R5 + R6 | Sonnet reading vendor panel / cable schedules and client XLSX | Direct table parse | Vendor-supplied data becomes deterministic and instant |
| R7 + R8 | Sonnet on every electrical spec doc | Library first, Sonnet only on scanned image-only | ~70 % drop in spec-related Sonnet calls |
| R9 | Haiku on every inbox email | Local Naive Bayes for high-confidence majority | Email triage near-zero cost at steady state |
| R10 | Sonnet sees full raw email + attachment text | Sonnet sees only the disambiguation question | Smaller prompts, lower cost, faster |
| R11 | Sonnet guesses cable lengths (today's "confidence-flagged" rows) | Library measures cable lengths | Accuracy win — removes today's flagged rows from the Power BOQ |

---

## Table 6 — Suggested install set (free, MIT/Apache, npm)

| Package | For rows | Size note |
|---|---|---|
| `pdfjs-dist` | R1, R2, R10, R11 | Mature, ~2 MB |
| `mammoth` | R7 | Tiny |
| `pdf-table-extractor` | R5 | Tiny |
| `tesseract.js` | R8 | Large (~10 MB WASM) — load lazily |
| `natural` | R9 | Tiny |
| `mailparser` | R10 | Tiny |
| `chrono-node` | R10 | Tiny |
| `pdf-to-img` | R11 | Wraps `pdfjs-dist` |
| `@techstark/opencv-js` | R11, R12 | Large (~8 MB WASM) — server-side only |

Already installed: `dxf-parser`, `exceljs`, `@anthropic-ai/sdk`, `@google/generative-ai`.

---

## Sequencing for the electrical pipeline

| Phase | Items | Effort | Outcome on the electrical pipeline |
|---|---|---|---|
| 1 — Quick wins | R1, R2, R3, R4, R6, R13, R14 | 1–2 days each | Electrical sub-steps 1–4 stop calling Sonnet on text-layer PDFs and on all DXFs |
| 2 — Medium | R5, R7, R10 | ~1 week | Vendor panel schedules, electrical specs, and project-metadata prep run library-first |
| 3 — Larger | R9, R11, R12 | 2–4 weeks | Email triage moves local; cable-length math becomes deterministic; symbol counts become deterministic |
