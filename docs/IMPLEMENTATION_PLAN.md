# Electrical Pipeline — Detailed Implementation Plan

_Project: SABI RFQ→BOQ (realsoft.example) · Discipline: Electrical (Power) · Generated 2026-05-05_

This plan maps every step to **real files that already exist** in `src/lib/ai/` and `src/lib/drawing/`. Existing modules to extend (not rewrite):

| Existing module | Reuse for |
|---|---|
| `src/lib/ai/result-cache.ts` | All new caching layers |
| `src/lib/ai/naive-bayes-classifier.ts` | Phase 4 email triage |
| `src/lib/ai/brand-dictionary.ts` | Phase 2 spec analysis |
| `src/lib/ai/spec-analyzer.ts` | Phase 2 spec orchestration |
| `src/lib/ai/budget-guard.ts` | Tier promotion + cost ceiling |
| `src/lib/ai/extraction-hints.ts` | Phase 1 inject pre-extracted facts into Sonnet prompt |
| `src/lib/drawing/detect-drawing-scale.ts` | Phase 1 sub-step 4 (extend) |
| `src/lib/drawing/dxf-text-extractor.ts` | Phase 1 DXF preflight (extend) |
| `src/lib/drawing/drawing-scale.ts` | Phase 3 pixel→metres conversion |
| `src/lib/drawing/drawing-previews.ts` | Phase 3 page-to-image |

---

## Table 1 — New files to create (one row per new module)

| # | New file | Purpose | Phase |
|---|---|---|---|
| N1 | `src/lib/drawing/title-block-extractor.ts` | `extractTitleBlock(pdfPath) → {scale, floors, drawingNumber, drawingType}` | 1 |
| N2 | `src/lib/drawing/floor-counter.ts` | `extractFloors(text) → string[]` (B1, GF, 1F, 2F…) | 1 |
| N3 | `src/lib/drawing/panel-schedule-parser.ts` | `extractScheduleTable(pdfPath) → ScheduleRow[]` | 2 |
| N4 | `src/lib/drawing/xlsx-schedule-parser.ts` | `extractXlsxSchedule(buf) → ScheduleRow[]` | 1 |
| N5 | `src/lib/ai/spec-doc-loader.ts` | `loadSpecDoc(buf, mime) → string` (DOCX/PDF/scanned) | 2 |
| N6 | `src/lib/drawing/cable-route-measurer.ts` | `measureCableRun(pageImage, scale, polylineHint) → {metres, confidence}` | 3 |
| N7 | `src/lib/drawing/symbol-counter.ts` | `countSymbols(pageImage, legendGlyph) → {count, confidence}` | 4 |
| N8 | `src/lib/ai/electrical-preflight.ts` | Orchestrator: runs N1–N4 before Sonnet, builds the "known facts" hint block | 1 |
| N9 | `src/lib/ai/tier-router.ts` | `runTier(input, tiers[]) → {result, tier_used, confidence}` — promotes Tier 0→1→2→3 | 1 |
| N10 | `tests/golden/electrical/run-golden.ts` | Replays last 30 projects against current pipeline; produces baseline JSON | 0 |
| N11 | `tests/golden/electrical/compare.ts` | Diffs current pipeline output against golden; promotes/blocks PRs | 0 |

---

## Table 2 — Existing files to modify (one row per touchpoint)

| # | Existing file | Change |
|---|---|---|
| M1 | `src/lib/ai/claude-api.ts:1512` (`analyzeElectricalProcedure`) | Call `electrical-preflight.ts` first; inject `extractionHints` into the Sonnet prompt; remove length-guess fields from output schema (Phase 3) |
| M2 | `src/lib/ai/claude-api.ts:117` (`callClaude` wrapper) | Add per-sub-step token tagging to log (`subStep` arg); already has token logging |
| M3 | `src/lib/ai/result-cache.ts` | Add `normaliseForHash()` that strips dates, page numbers, `Rev XX` strings before hashing |
| M4 | `src/lib/ai/result-cache.ts` | Add a perceptual-hash key variant for image inputs (Phase 3) |
| M5 | `src/lib/drawing/dxf-text-extractor.ts` | Export `hasElectricalLayers(parsed) → boolean`; used by N8 to short-circuit Sonnet on DXF |
| M6 | `src/lib/drawing/detect-drawing-scale.ts` | Add `detectScaleFromTitleBlock(pdfText)` returning `{ratio, confidence}` |
| M7 | `src/lib/ai/spec-analyzer.ts` | Lower brand-dictionary trigger from 4 hits → 2; route through N5 for non-PDF inputs |
| M8 | ~~`src/lib/ai/naive-bayes-classifier.ts`~~ | **Done — not needed.** Email classification is now rules-only (see M9) |
| M9 | `src/lib/ai/claude-api.ts` (`classifyEmail`) | **Done 2026-05-05.** Switched to pure rules — no AI call. Curated inbox makes AI verification redundant |
| M10 | `src/app/api/projects/[id]/estimate/route.ts:311` | Pass `subStep` through to `callClaude`; surface `tier_used` in response for UI confidence display |
| M11 | `src/lib/ai/budget-guard.ts` | Enforce per-project ceiling and refuse Sonnet promotion when budget is exhausted (fail open with library result) |

---

## Table 3 — Day-by-day work schedule

### Phase 0 · Instrumentation (3 days)

| Day | Task | Files touched | Done-when |
|---|---|---|---|
| 0.1 | Add `subStep` arg to `callClaude` and persist in token log | M2 | Every call in claude-api.ts logs which sub-step it served |
| 0.2 | Build `tests/golden/electrical/run-golden.ts` — replay 30 last completed projects | N10 | `tests/golden/electrical/<project_id>.json` exist for 30 projects |
| 0.3 | Build `compare.ts` with thresholds (schedule completeness ≥ 98 %, length RMSE ≤ baseline, exact title-block match on text-layer PDFs, cost ≤ baseline × 1.0) | N11 | `npm run golden:check` returns pass/fail |

### Phase 1 · Title-block + DXF + XLSX preflight (1 week)

| Day | Task | Files touched | Done-when |
|---|---|---|---|
| 1.1 | Add `pdfjs-dist` to deps; build `title-block-extractor.ts` returning `{scale, floors, drawingNumber, drawingType}`; unit test on 10 sample PDFs | N1, package.json | Returns correct values on ≥9/10 sample PDFs |
| 1.2 | Build `floor-counter.ts`: regex over `B[1-9], GF, [1-9]+F, ROOF, MEZZ` with de-dup | N2 | Extracts levels from sample title blocks |
| 1.3 | Extend `detect-drawing-scale.ts` with `detectScaleFromTitleBlock(text)` matching `/1\s*[:\-]\s*(20\|25\|50\|100\|200\|500)/` | M6 | Returns matched ratio + confidence for sample title blocks |
| 1.4 | Extend `dxf-text-extractor.ts` with `hasElectricalLayers(parsed)`; use existing prefix list (`E-, ELEC, POWR, LITE, MDB, SMDB`) | M5 | Returns true for sample electrical DXF, false for arch DXF |
| 1.5 | Build `xlsx-schedule-parser.ts` using `exceljs` (already a dep); detect header row by column names (`Tag/Reference/From/To/Cable Size/Length`) | N4 | Parses sample client cable schedule into rows |
| 1.6 | Build `electrical-preflight.ts` (orchestrator): for each attachment, route to N1/N2/N4 or M5; return `{knownFacts, skippedSonnet[], remainingForSonnet[]}` | N8 | Returns hints structure for sample project bundle |
| 1.7 | Modify `analyzeElectricalProcedure` to call N8 first, inject `knownFacts` into the prompt as `<known_facts>…</known_facts>` block, remove sub-steps 1, 2, 3, 4, 6 from Sonnet output schema when known | M1 | Sonnet prompt size drops; golden set still passes |
| 1.8 | Tighten cache: add `normaliseForHash` that strips `Rev [A-Z0-9]+`, `Date: …`, `Printed: …`, `Page \d+ of \d+` | M3 | Re-hashing a re-stamped sample PDF produces same hash |
| 1.9 | Wire `tier-router.ts` (initial version: just Tier 0 library → Tier 3 Sonnet on miss) | N9 | Returns `tier_used` per call |
| 1.10 | Re-run golden; verify ≥ baseline accuracy and ≥ 25 % cost reduction; ship behind `ELECTRICAL_PREFLIGHT=on` env flag | M10 | Flag-on run passes golden, flag-off unchanged |

### Phase 2 · Table parser + spec hybrid (1 week)

| Day | Task | Files touched | Done-when |
|---|---|---|---|
| 2.1 | Add `pdf-table-extractor`; build `panel-schedule-parser.ts` → returns `ScheduleRow[]` with `{tag, rating, cable_size, from, to}` | N3, package.json | Parses 5 sample schedules with ≥80 % field fill |
| 2.2 | Wire N3 into preflight (N8): if a PDF page text looks like a schedule (heuristic: ≥5 lines containing `mm²` or `A` units), try N3; fall back to Sonnet if < 3 rows returned | N8 | Sub-steps 7 + 11 served by table parser when applicable |
| 2.3 | Add `mammoth` dep; build `spec-doc-loader.ts` handling DOCX (mammoth) + PDF (pdfjs-dist) → plain text | N5, package.json | Returns text for DOCX and PDF samples |
| 2.4 | Lower brand-dictionary trigger in `spec-analyzer.ts` from 4 → 2 hits; extend dictionary by harvesting brands from existing `sabi_attachments` corpus | M7, brand-dictionary.ts | Dictionary covers ≥90 % of historical brands |
| 2.5 | Add `tesseract.js` lazy-loaded in N5; only invoked when PDF has no text layer; cache OCR per-file-hash | N5 | Scanned spec PDF returns text via OCR; cache hit on second run |
| 2.6 | Re-run golden; verify ≥ baseline accuracy + cumulative ≥ 40 % cost cut | — | Golden passes |
| 2.7 | Buffer / fixes | — | — |

### Phase 3 · Geometry-based cable lengths (2–3 weeks · the accuracy flagship)

| Week.Day | Task | Files touched | Done-when |
|---|---|---|---|
| 3.W1.1 | Add `pdf-to-img` + `@techstark/opencv-js` deps; build page-to-image helper extending `drawing-previews.ts` to return raw RGBA buffer at known DPI | N6, drawing-previews.ts | Sample PDF page renders to 300-DPI buffer |
| 3.W1.2 | Build `cable-route-measurer.ts` skeleton: takes `(pageImage, scale, polylineHint)`; returns metres + confidence | N6 | Stub returns deterministic value on hardcoded input |
| 3.W1.3 | Implement HoughLinesP polyline detection on cable-route layer (input: colour mask hint or DXF layer name) | N6 | Detects polyline on 5/8 sample riser images |
| 3.W1.4 | Add pixel→metres using scale from M6 (e.g. 1:100 at 300 DPI → 1 px = 8.47 mm at paper, × 100 = 0.847 m at site) | N6, drawing-scale.ts | Length on calibration grid PDF accurate to ±2 % |
| 3.W2.1 | Sonnet prompt change for sub-steps 10 & 13: drop `length_metres` from output schema; add `route_polyline_color` field; ask Sonnet to identify the route, not measure it | M1 | Schema updated; output is route metadata only |
| 3.W2.2 | Pipeline: Sonnet picks route → N6 measures → write length back into cable schedule row; mark `confidence: low` if N6 returns confidence < 0.7 | M1, N8 | End-to-end measured lengths on sample project |
| 3.W2.3 | Add per-page geometry cache (M4) keyed on perceptual hash of page image + polyline color | M4, result-cache.ts | Re-running measurement on identical page is instant |
| 3.W3.1 | Add manual-override UI in gate-review screen: estimator drags polyline; saved length overrides auto-measurement | (frontend) | Operator can correct any length |
| 3.W3.2 | Validate against golden 30-project set: lengths within ±10 % vs operator-confirmed | N11 | RMSE on lengths drops vs Phase-2 baseline |
| 3.W3.3 | Ship behind `ELECTRICAL_GEOMETRY=on` flag | M10 | Flag-on run passes golden |

### Phase 4 · Symbol matching (1 week)

Email classification is **already done** — `classifyEmail` in `claude-api.ts` was switched to rules-only (no AI) on 2026-05-05. The estimation inbox is curated for BOQ traffic, so Haiku verification was redundant. Naive Bayes tier (`nb-tune-runner.ts`, `naive-bayes-classifier.ts`) is no longer needed for the email path.

| Day | Task | Files touched | Done-when |
|---|---|---|---|
| 4.1 | Build `symbol-counter.ts` using OpenCV `matchTemplate` against legend glyphs cropped from drawing legend page | N7 | Counts DB / outlet symbols on 5 sample floor plans within ±2 |
| 4.2 | Wire N7 into sub-step 12: if confidence ≥ 0.6, accept; else Sonnet | M1, N8 | Symbol counts populate cable-schedule rows |
| 4.3 | Re-run golden; verify cumulative ≥ 55 % cost cut | — | Golden passes |

---

## Table 4 — Function signatures (the contract for each new module)

| Module | Signature |
|---|---|
| N1 `title-block-extractor.ts` | `extractTitleBlock(pdfBuf: Buffer): Promise<{scale: string \| null, floors: string[], drawingNumber: string \| null, drawingType: 'floor_plan'\|'schematic'\|'riser'\|'schedule'\|'other', confidence: number}>` |
| N2 `floor-counter.ts` | `extractFloors(text: string): string[]` |
| N3 `panel-schedule-parser.ts` | `extractScheduleTable(pdfBuf: Buffer): Promise<ScheduleRow[]>` where `ScheduleRow = {tag, rating?, cable_size?, from?, to?, location?}` |
| N4 `xlsx-schedule-parser.ts` | `extractXlsxSchedule(buf: Buffer): Promise<ScheduleRow[]>` |
| N5 `spec-doc-loader.ts` | `loadSpecDoc(buf: Buffer, mime: string): Promise<{text: string, source: 'docx'\|'pdf-text'\|'pdf-ocr', confidence: number}>` |
| N6 `cable-route-measurer.ts` | `measureCableRun(pageImage: Buffer, scaleRatio: number, hint: {color?: string, dxfLayer?: string}): Promise<{metres: number, confidence: number}>` |
| N7 `symbol-counter.ts` | `countSymbols(pageImage: Buffer, glyph: Buffer): Promise<{count: number, confidence: number}>` |
| N8 `electrical-preflight.ts` | `runElectricalPreflight(attachments: AttachmentFile[]): Promise<{knownFacts: ExtractionHints, skippedSonnet: string[], remainingForSonnet: AttachmentFile[]}>` |
| N9 `tier-router.ts` | `runTier<T>(input, tiers: TierFn<T>[]): Promise<{result: T, tierUsed: number, confidence: number}>` |

---

## Table 5 — Code patterns (what each new module looks like internally)

| Pattern | Skeleton |
|---|---|
| Cache-wrapped library call | Compute SHA-256 of normalised input → check `result-cache.ts` → on miss, call library → write back to cache |
| Tier router (N9) | `for (const tier of tiers) { const r = await tier(input); if (r.confidence >= tier.threshold) return r; } return tiers.at(-1)(input)` |
| Preflight injection (N8 → M1) | Build `<known_facts>` XML block from N1/N2/N4 results → prepend to Sonnet user message → trim Sonnet output schema to fields not in known facts |
| Confidence flag write-back | Any row whose value came from a fallback OR from low-confidence library result gets `confidence: 'low'` so the gate-review UI surfaces it |

---

## Table 6 — Environment flags (rollout safety)

| Flag | Default | When to flip |
|---|---|---|
| `ELECTRICAL_PREFLIGHT` | `off` initially | After Phase 1 golden passes |
| `ELECTRICAL_TABLE_PARSER` | `off` initially | After Phase 2 golden passes |
| `ELECTRICAL_GEOMETRY` | `off` initially | After Phase 3 golden passes |
| ~~`EMAIL_NB_TIER`~~ | n/a | Email classification is now unconditional rules-only |
| `SYMBOL_TEMPLATE_MATCH` | `off` initially | After Phase 4 template-match validated |
| `BUDGET_PER_PROJECT_USD` | existing budget-guard.ts ceiling | Lower as cost drops to lock in savings |

Each flag is independently shippable — flipping back is one env var change. No code rollback needed.

---

## Table 7 — Validation gates (what blocks a phase from shipping)

| Gate | Metric | Threshold |
|---|---|---|
| G-Accuracy | Schedule completeness vs golden | ≥ 98 % |
| G-Accuracy | Title-block exact match (text-layer PDFs) | 100 % |
| G-Accuracy | Cable length RMSE vs operator-confirmed | ≤ Phase-0 baseline (Phase 3 target: 50 % of baseline) |
| G-Cost | $ / project | ≤ Phase-0 baseline (target per phase listed in Table 3) |
| G-Latency | p95 estimate-route response | ≤ Phase-0 baseline + 10 % |
| G-Crash | Sonnet 5xx rate | unchanged or lower |

A phase ships only when **all** gates green on the golden set.

---

## Table 8 — Dependencies to install (consolidated)

| Phase | Package | Purpose | Size |
|---|---|---|---|
| 1 | `pdfjs-dist` | Title-block text extraction | ~2 MB |
| 2 | `pdf-table-extractor` | Native-text panel schedules | tiny |
| 2 | `mammoth` | DOCX spec ingestion | tiny |
| 2 | `tesseract.js` | OCR scanned specs | ~10 MB WASM (lazy) |
| 3 | `pdf-to-img` | PDF page → image buffer | thin wrapper on `pdfjs-dist` |
| 3 | `@techstark/opencv-js` | Polyline detection + measurement + template match | ~8 MB WASM (server-side only) |
| 4 | (none new) | NB classifier already exists in `naive-bayes-classifier.ts` | — |

Already installed: `dxf-parser`, `exceljs`, `@anthropic-ai/sdk`, `@google/generative-ai`.

---

## Table 9 — Order of implementation (a single concrete TODO list)

| Order | Task | Estimated effort |
|---|---|---|
| 1 | Phase 0 — instrumentation + golden set | 3 days |
| 2 | Phase 1 day 1.1 — `title-block-extractor.ts` | 1 day |
| 3 | Phase 1 day 1.2 — `floor-counter.ts` | ½ day |
| 4 | Phase 1 day 1.3 — extend `detect-drawing-scale.ts` | ½ day |
| 5 | Phase 1 day 1.4 — extend `dxf-text-extractor.ts` (`hasElectricalLayers`) | ½ day |
| 6 | Phase 1 day 1.5 — `xlsx-schedule-parser.ts` | 1 day |
| 7 | Phase 1 days 1.6–1.7 — `electrical-preflight.ts` + wire into `analyzeElectricalProcedure` | 2 days |
| 8 | Phase 1 day 1.8 — cache normalisation | ½ day |
| 9 | Phase 1 days 1.9–1.10 — tier router + flag rollout + golden re-run | 1 day |
| 10 | Phase 2 days 2.1–2.2 — `panel-schedule-parser.ts` + wire | 2 days |
| 11 | Phase 2 days 2.3–2.5 — `spec-doc-loader.ts` + dictionary tightening + OCR | 2 days |
| 12 | Phase 2 day 2.6 — golden re-run | ½ day |
| 13 | Phase 3 W1 — `cable-route-measurer.ts` foundations | 1 week |
| 14 | Phase 3 W2 — Sonnet prompt rewrite + integration | 1 week |
| 15 | Phase 3 W3 — manual override UI + golden | 1 week |
| 16 | Phase 4 days 4.1–4.3 — NB tier wrap + retrain | 2 days |
| 17 | Phase 4 days 4.4–4.6 — `symbol-counter.ts` + golden | 3 days |

**Total**: ~6 weeks elapsed. Phase 1 alone (≈8 working days) gets you 25–30 % cost cut and equal accuracy.

---

## Table 10 — Risk-coupled go/no-go checkpoints

| Checkpoint | Decision rule |
|---|---|
| End of Phase 0 | Ship instrumentation always — no risk. If baseline cost/accuracy lower than expected, scope back later phases |
| End of Phase 1 | Ship if golden ≥ baseline accuracy AND cost ≤ 0.75× baseline. Otherwise keep flag off, debug |
| End of Phase 2 | Ship if golden ≥ baseline AND cost ≤ 0.60× baseline |
| Mid-Phase 3 (after week 1) | Build/no-build decision: if polyline detection works on ≥ 70 % of sample risers, continue; if ≤ 40 %, defer Phase 3 — keep Sonnet length guesses with the existing low-confidence flag |
| End of Phase 3 | Ship if cable-length RMSE ≤ 0.50× Phase-0 baseline AND no schedule-completeness regression |
| End of Phase 4 | Ship NB independently from symbol-match if either passes its gate |

---

## Table 11 — What this plan does NOT change

| Out of scope | Reason |
|---|---|
| `analyzeHVACProcedure`, `analyzeDuctRouteDrawing`, `analyzeWaterSupplyDrawing`, `analyzeMEPDrawing` | Not invoked in the electrical-only pipeline; cost = 0 today |
| Power BOQ PDF generator (`generateElectricalPowerBOQ`) | Already deterministic |
| Gate routing (`/api/projects/[id]/gate`, `/bid-decision`) | Unrelated to AI cost |
| DWG conversion | Separate ticket if needed |
| Switching to a self-hosted vision model | Operational cost > current Sonnet bill at this volume |

---

## Single execution rule

> **Ship Phase 0 first, no matter what.** Without a golden set + instrumentation, every later "improvement" is unmeasurable. Three days of Phase 0 unlocks every later go/no-go decision.

> **Ship Phase 3 even if everything else slips.** Cable lengths in sub-steps 10 & 13 are the only place the BOQ already admits low confidence. Fixing them is the headline accuracy win and a real cost saving — it justifies the project on its own.
