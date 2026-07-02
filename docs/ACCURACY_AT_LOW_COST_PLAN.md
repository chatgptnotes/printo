# Electrical Pipeline — Higher Accuracy at Lower Cost: Detailed Plan

_Project: SABI RFQ→BOQ (realsoft.example) · Discipline: Electrical (Power) · Generated 2026-05-05_

---

## Table 1 — Goals & guiding principles

| # | Principle | What it means in practice |
|---|---|---|
| G1 | Deterministic > probabilistic, when both are possible | If a value can be read with a regex / table parser / cell read, never let a vision model guess it |
| G2 | Claude is for judgment, not for OCR | Reserve Sonnet for SLD geometry, route choice, prose disambiguation. Never for "what number is in this cell" |
| G3 | Tiered fallback, not all-or-nothing | Library first → low-confidence → Haiku → low-confidence → Sonnet. Each tier is ~10× cheaper than the next |
| G4 | Cache aggressively on stable inputs | Same drawing, same revision, same prompt = served from cache forever |
| G5 | Measure before optimizing | Phase 0 instruments baseline cost + accuracy per sub-step; every later phase is judged against it |

---

## Table 2 — The accuracy/cost levers (ranked)

| Rank | Lever | Accuracy lift | Cost lift | Combined value |
|---|---|---|---|---|
| 1 | Geometry-based cable lengths (sub-steps 10, 13) | **High** — removes today's "low-confidence" rows | Medium — saves Sonnet on the longest part of the prompt | ★★★★★ |
| 2 | Pre-extract title block (sub-steps 1–4) | High — exact reads | High — kills 30–40 % of Sonnet tokens per project | ★★★★★ |
| 3 | Native-text panel/cable schedules → table parser (sub-steps 7, 11, 12) | High — exact cell values | High — replaces full-page vision passes | ★★★★★ |
| 4 | Tighten content-hash cache | Same | High — re-issued revisions hit cache | ★★★★ |
| 5 | DXF → `dxf-parser` first, Sonnet only on miss | Same | High — DXF projects become near-free | ★★★★ |
| 6 | XLSX cable/DB schedules from clients | High — exact | Medium | ★★★★ |
| 7 | Naive-Bayes email pre-classifier with confidence forward | Equal at steady state | High — ~80 % of email volume | ★★★ |
| 8 | DOCX specs via `mammoth` + brand dictionary | Same (with fallback) | Medium | ★★★ |
| 9 | OCR scanned specs via `tesseract.js` | Slight drop on bad scans → manage with quality gate | Medium | ★★ |
| 10 | Symbol-count template matching | High on standard glyphs, hybrid on non-standard | Low–medium | ★★ |

---

## Table 3 — Per-sub-step decision matrix (the core of the plan)

| Sub-step | Today | Target architecture | Claude tier | Expected token delta |
|---|---|---|---|---|
| 1 — Open the drawing | Sonnet vision | Filename routing only | None | −100 % |
| 2 — List available drawings | Sonnet vision | Filename regex + `dxf-parser` metadata | None | −100 % |
| 3 — Floors & floor heights | Sonnet vision | `pdfjs-dist` text + regex; Sonnet only if no text layer | Sonnet on miss | −80 % |
| 4 — Drawing scale | Sonnet vision | `pdfjs-dist` + regex; Sonnet only if no text layer | Sonnet on miss | −80 % |
| 5 — LV Room / MDB | Sonnet vision | Sonnet (geometry interpretation) — but with title-block legend pre-extracted to shrink prompt | Sonnet | −20 % |
| 6 — SLD availability | Sonnet vision | Filename heuristic (`SLD`, `schematic`, `single-line`) | None | −100 % |
| 7 — SMDBs from LV Panel | Sonnet vision | Table parser if SLD has a panel-schedule table; Sonnet otherwise | Sonnet conditional | −40 % |
| 8 — SMDB locations on floor plans | Sonnet vision | Sonnet (vision needed) — with floor count + scale pre-supplied | Sonnet | −15 % |
| 9 — Cable route LV→SMDB | Sonnet vision | Sonnet (judgment) | Sonnet | 0 % |
| 10 — Cable lengths LV→SMDB | Sonnet vision (guesses) | OpenCV pixel-run × scale; Sonnet only chooses route | Sonnet for route only | −60 %; **+accuracy** |
| 11 — SMDB→DB identification | Sonnet vision | Table parser if schedule exists; Sonnet otherwise | Sonnet conditional | −40 % |
| 12 — DB locations per SMDB | Sonnet vision | Template matching for DB symbol; Sonnet for non-standard glyphs | Sonnet conditional | −50 % |
| 13 — Cable size & length per DB | Sonnet vision (guesses, flagged) | OpenCV pixel-run × scale; Sonnet only chooses route | Sonnet for route only | −60 %; **+accuracy** |
| 14 — Gate / BOQ render | `generateElectricalPowerBOQ()` | (already deterministic) | None | 0 % |

**Aggregate target**: ~50 % reduction in Sonnet tokens per Detailed-path project, with measurable accuracy lift on sub-steps 3, 4, 7, 10, 11, 13.

---

## Table 4 — Tiered model strategy (cost ladder)

| Tier | Cost | Use when |
|---|---|---|
| 0 — Library only | Free | Title block, scale, floors, filenames, DXF layers, native-text tables, XLSX, DOCX brand-dictionary hits |
| 1 — Naive Bayes / heuristic | Free | Email RFQ classification, drawing discipline, reputation, brand presence |
| 2 — Haiku 4.5 | ~1× | Email triage when NB confidence is below threshold; short text classification |
| 3 — Sonnet 4.6 | ~12× Haiku | SLD geometry, MDB/SMDB tree, route choice, image-only title blocks, non-standard symbols, prose specs |

Routing rule: **always start at the lowest tier that can answer; promote on low confidence; cache the final answer.**

---

## Table 5 — Phased rollout

### Phase 0 — Instrumentation (3 days, no behavior change)

| Task | Output |
|---|---|
| Add per-sub-step token logger to `callClaude()` | A row per call: project_id, sub_step, model, input_tokens, output_tokens, hit_cache, confidence |
| Add accuracy harness: re-run last 30 completed projects through current pipeline, store output as golden | `tests/golden/electrical/<project_id>.json` |
| Compute baseline metrics | $/project, tokens/project, accuracy on cable schedule (length within ±15 %), DB count exact match |

### Phase 1 — Quick wins (1 week, library swaps that improve accuracy AND cut cost)

| Day | Task | Sub-steps affected | Library |
|---|---|---|---|
| 1 | Add `pdfjs-dist`; build `extractTitleBlock(pdfPath)` returning `{scale, floors, drawingType, drawingNumber}` | 2, 3, 4, 6 | `pdfjs-dist` |
| 2 | Wire `extractTitleBlock` into `analyzeElectricalProcedure` as preflight; pass results into Sonnet prompt as known facts | 3, 4 | — |
| 3 | Make `dxf-parser` the first pass for DXF inputs; only call Sonnet on zero electrical-layer hits | 1, 2, 4 (via R4) | `dxf-parser` ✅ |
| 4 | Replace Sonnet with `exceljs` for any `.xlsx` attachment in the cable/DB schedule path | 7, 11 | `exceljs` ✅ |
| 5 | Tighten content-hash cache: hash normalised PDF text (strip dates/page numbers/revision strings) | All | — |
| 6 | Re-run golden set; verify no regressions; record cost delta | — | — |
| 7 | Buffer / fixes | — | — |

**Expected after Phase 1**: 25–30 % cost cut, equal-or-better accuracy on sub-steps 2, 3, 4, 6.

### Phase 2 — Table parsing + hybrid specs (1 week)

| Day | Task | Sub-steps affected | Library |
|---|---|---|---|
| 1–2 | Add `pdf-table-extractor`; build `extractScheduleTable(pdfPath)` returning rows of `{tag, rating, location, cable_size}` | 7, 11, 12 | `pdf-table-extractor` |
| 3 | Wire into sub-steps 7 & 11: if table extraction returns ≥3 rows with expected columns, use it; else Sonnet | 7, 11 | — |
| 4 | Add `mammoth` for DOCX specs; extend brand dictionary from `sabi_attachments` corpus; lower trigger threshold from 4 hits → 2 | `analyzeSpecifications` | `mammoth` |
| 5 | Add `tesseract.js` lazy-loaded; only invoked when PDF has no text layer AND user requested spec analysis | `analyzeSpecifications` | `tesseract.js` |
| 6 | Re-run golden set; record delta | — | — |
| 7 | Buffer | — | — |

**Expected after Phase 2**: cumulative 40 % cost cut; accuracy lift on sub-steps 7 & 11 (exact cell values).

### Phase 3 — Geometry-based cable measurement (2–3 weeks, the accuracy flagship)

| Week | Task | Sub-steps affected | Library |
|---|---|---|---|
| 1 | Add `pdf-to-img` + `@techstark/opencv-js` (server-side); build `measureCableRun(image, scale, polyline)` returning length in metres | 10, 13 | `pdf-to-img`, `@techstark/opencv-js` |
| 1 | Build polyline detector: HoughLinesP + colour filter on cable-route layer (when DXF) or on user-selected colour | 10, 13 | OpenCV |
| 2 | Sonnet prompt change: ask only for `{from_panel, to_panel, route_polyline_color, expected_size}` — drop the length-guess output field | 10, 13 | — |
| 2 | Pipeline: Sonnet picks route → OpenCV measures → write length back to cable schedule | 10, 13 | — |
| 3 | Validate against 30-project golden set; tune polyline detector | — | — |
| 3 | Add manual override UI: estimator can drag the polyline if auto-detection fails | — | — |

**Expected after Phase 3**: cumulative 50 % cost cut; **accuracy on cable lengths goes from "flagged low-confidence" to within ±5 % when polyline auto-detected, ±15 % on Sonnet-route fallback**. This is the BOQ-quality win.

### Phase 4 — Email triage downgrade + symbol counting (1–2 weeks)

| Week | Task | Sub-steps affected | Library |
|---|---|---|---|
| 1 | Train `natural` Naive Bayes on labelled `sabi_emails` rows; expose confidence | `classifyEmail` | `natural` |
| 1 | Pipeline: NB → if confidence ≥ 0.85, accept; else Haiku | `classifyEmail` | — |
| 2 | Build template-matching for DB / outlet symbols using legend snippets | 12 + outlet counting | `@techstark/opencv-js` |
| 2 | Sonnet fallback for non-standard glyphs | 12 | — |

**Expected after Phase 4**: cumulative 55–60 % cost cut; email triage near-zero at steady state.

---

## Table 6 — Confidence & fallback rules (the rules that protect accuracy)

| Library output | Fallback to Claude when |
|---|---|
| Title-block regex | `scale` not matched OR `floors` count outside [1, 80] OR PDF has no text layer |
| DXF layer match | Zero matches against `E-, ELEC, POWR, LITE, MDB, SMDB` prefixes |
| Table extractor | Returns < 3 rows OR < 60 % of cells have expected unit suffixes (`A`, `mm²`, `kW`) |
| Brand dictionary on DOCX | < 2 brand hits across the document |
| OCR on scanned spec | Average per-word confidence < 0.75 |
| Naive Bayes email | Predicted-class probability < 0.85 |
| OpenCV polyline measurement | No polyline of expected colour found OR measured length outside [0.5×, 2×] of nearest similar run |
| Template matching | < 60 % match score against legend glyph |

**Rule of thumb**: on any fallback, also write a `confidence: 'low'` flag into the row so the operator sees it at the gate.

---

## Table 7 — Caching strategy (largest single cost lever after libraries)

| Cache | Key | Value | TTL |
|---|---|---|---|
| Title-block cache | SHA-256 of (PDF first-page text, normalised) | `{scale, floors, drawingType}` | Permanent |
| Table-extract cache | SHA-256 of (PDF page text, normalised) | Parsed rows | Permanent |
| Sonnet response cache | SHA-256 of (prompt + normalised PDF text + image perceptual hash) | Sonnet output | Permanent |
| OCR cache | SHA-256 of file bytes | OCR text | Permanent |
| Geometry cache | SHA-256 of (PDF page image perceptual hash + polyline color) | Measured lengths | Permanent |

**Normalisation**: strip dates, page numbers, revision strings (`Rev A`, `Rev 01`), printed-on timestamps. This lets re-issued spec packages and re-stamped drawings hit cache.

---

## Table 8 — Validation harness (ensures accuracy doesn't regress)

| Component | Detail |
|---|---|
| Golden set | Last 30 completed Detailed-path projects, frozen output of `analyzeElectricalProcedure` per project stored as JSON |
| Metric — schedule completeness | % of expected SMDB / DB rows present (target: ≥ 98 %) |
| Metric — cable length accuracy | RMSE vs operator-confirmed lengths (target: ≤ 10 % after Phase 3) |
| Metric — title-block accuracy | Exact-match scale + floor count (target: 100 % on text-layer PDFs) |
| Metric — cost | $ / project, tokens / project (target: ≤ 50 % of Phase-0 baseline) |
| Run cadence | Re-run on every PR that touches `src/lib/ai/*` or `src/lib/drawing/*` |
| Promotion rule | A library swap ships only if accuracy ≥ baseline AND cost ≤ baseline |

---

## Table 9 — Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| OpenCV polyline detector misses on hand-drawn risers | Medium | High (wrong cable lengths) | Manual override UI in gate review; flag low-confidence rows |
| Brand dictionary misses an unusual manufacturer | Medium | Medium (missed approved-make) | Keep Sonnet fallback when dictionary hits < 2; quarterly dictionary refresh from new project corpus |
| Naive Bayes misclassifies an unusual RFQ phrasing | Medium | Medium (RFQ goes to wrong tier) | Confidence-threshold forward to Haiku; weekly review of NB-only decisions |
| Table parser breaks on merged-cell schedules | Medium | Low (falls through to Sonnet) | Already handled by ≥3-rows fallback rule |
| `tesseract.js` slow on large scanned specs | High | Low (UI lag) | Lazy-load WASM; offload to a worker; show progress |
| Cache returns stale output after a real revision | Low | High (wrong BOQ) | Normalisation strips revision strings BUT keeps content; if drawing geometry actually changes, perceptual hash differs and cache misses |

---

## Table 10 — Out-of-scope (intentionally not in this plan)

| Item | Why excluded |
|---|---|
| Auto DWG conversion | Pipeline already rejects DWG with a clear message; CloudConvert integration is a separate ticket |
| Self-hosting an open-weights vision model | Operational cost (GPU, ops) exceeds Sonnet bill at current volume |
| Replacing the Power BOQ PDF generator | Already deterministic (`generateElectricalPowerBOQ()`); not in the cost surface |
| Switching from Sonnet to Haiku for sub-steps 5, 7, 11 | Tested previously; Haiku misses SLD relationships. Keep on Sonnet |

---

## Table 11 — Summary: where the savings come from

| Source | Share of savings |
|---|---|
| Phase 1 — title block / DXF / XLSX preflight + cache tightening | ~30 % |
| Phase 2 — table parser + DOCX dictionary | ~10 % |
| Phase 3 — geometry-based cable lengths | ~10 % cost + the headline accuracy win |
| Phase 4 — email NB downgrade + symbol templates | ~5–10 % |
| **Cumulative** | **~55–60 % token reduction with equal-or-better accuracy** |

---

## Single most important takeaway

> **Sub-steps 10 and 13 are the only sub-steps where the current pipeline already admits low confidence (length values are flagged).** Phase 3 turns those guesses into measured geometry. That single change is both the biggest accuracy lift in the entire plan AND a meaningful cost saving — do it even if nothing else gets done.
