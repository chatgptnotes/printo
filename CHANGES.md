# CHANGES.md — Phases 1 through 12

Plain-English summary of every change made across the cost-reduction work, plus how to revert each piece. Read this top-to-bottom; revert from the bottom up.

---

## What this work does, in one paragraph

Replaces or skips AI calls with cheaper deterministic logic (regex, formulas, brand dictionary, Naive Bayes classifier, OCR, content-hash cache) wherever the input is predictable. Captures every time a human disagrees with the AI into a `sabi_corrections` table. Mines those corrections to auto-adjust rates, warn the AI in its prompt about its known mistakes, alert on market-rate drift, and surface the whole thing to the operator via admin endpoints + a health dashboard. Self-tunes its own NB margin once enough data accumulates.

---

## How to revert (the simple version)

1. **Easiest** — `git stash` or `git checkout .` if nothing has been committed yet. All changes vanish.
2. **If committed** — `git revert <commit-sha>` for each commit, OR just delete the new files and revert the modified files file-by-file using the table below.
3. **Database** — drop the two new tables (see "Migrations" section). Existing tables and rows are untouched.
4. **Dependencies** — `npm uninstall chrono-node tesseract.js pdfjs-dist @napi-rs/canvas`.
5. **Env vars** — none required for the existing system to keep running. The new ones (`AI_DISABLED`, `MAX_DAILY_AI_USD`, etc.) are optional with safe defaults.

---

## New files added (delete to revert)

These are entirely new — deleting them removes that piece of the system completely.

### `src/lib/ai/`
| File | What it does | Phase |
|---|---|---|
| `brand-dictionary.ts` | 100+ MEP brand names + 25 standards regex patterns | 1 |
| `spec-analyzer.ts` | Replaces Claude `analyzeSpecifications` when ≥4 brands match | 1 |
| `brand-harvest.ts` | Auto-unions brand dict with brands seen in past projects | 1 |
| `result-cache.ts` | Content-hash cache for Claude responses | 1 |
| `budget-guard.ts` | Daily AI budget kill switch (`AI_DISABLED` + `MAX_DAILY_AI_USD`) | 1 |
| `naive-bayes-classifier.ts` | NB classifier trained on past email labels | 2 |
| `nb-tune-runner.ts` | Shared core for NB margin sweep | 8 |
| `extraction-hints.ts` | Builds prompt snippet from past extraction corrections | 9 |

### `src/lib/electrical/`
| File | What it does | Phase |
|---|---|---|
| `formulas.ts` | DEWA/IEC formula functions (demand factor, cable size, earthing, etc.) | 1 |
| `pre-pass.ts` | Regex extraction of electrical Steps 2,4,5,6,7,11 from drawing text | 1 |
| `sld-spatial-parser.ts` | pdfjs-dist coordinate-aware parsing of schematic PDFs | 2 |
| `cable-schedule-diff.ts` | Diffs prior vs current cable schedules on re-run | 6 |
| `array-diff.ts` | Same pattern for power_outlets + mechanical_equipment arrays | 7 |

### `src/lib/pdf/`
| File | What it does | Phase |
|---|---|---|
| `ocr-image.ts` | tesseract.js OCR for image attachments | 2 |
| `ocr-pdf.ts` | Full PDF→OCR pipeline (pdfjs render + canvas + tesseract) | 3 |

### `src/lib/pipeline/`
| File | What it does | Phase |
|---|---|---|
| `rate-adjuster.ts` | Per-cohort rate multipliers from `sabi_corrections` | 3 |
| `correction-stats.ts` | Per-cohort rejection-rate stats | 5 |
| `yardstick-tuner.ts` | Auto-tunes `sabi_yardstick_rates` from approved estimations | 3 |

### `src/lib/storage/`
| File | What it does | Phase |
|---|---|---|
| `corrections-logger.ts` | Single helper to write `sabi_corrections` rows | 2 |

### `src/lib/notifications/`
| File | What it does | Phase |
|---|---|---|
| `api-alert.ts` | WhatsApp alert helper + token-usage logger + heuristic-saving logger | 1 |

### Admin API endpoints (`src/app/api/admin/`)
| Endpoint | What it does | Phase |
|---|---|---|
| `cost-stats/` | Rolling 7d/30d AI spend + cache hits + heuristic savings | 3 |
| `rate-adjustments/` | Per-cohort multiplier suggestions | 3 |
| `correction-stats/` | Per-cohort rejection rate + top reasons | 5 |
| `nb-eval/` | NB confusion matrix + F1 (chronological holdout split) | 4 |
| `nb-tune/` | NB margin sweep with auto-apply option | 6 |
| `nb-trend/` | NB self-eval history sparkline series | 9 |
| `cohort-intel/` | Joined rate × rejection × extraction signals per cohort | 5 |
| `cohort-drift-status/` | Latest cohort-drift cron findings | 9 |
| `extraction-accuracy/` | Per-field correction frequency for AI extraction | 8 |
| `extraction-hints-preview/` | Shows the snippet injected into the Sonnet prompt | 9 |
| `auto-adjust-services/` | POST: bulk retroactive rate adjustment | 6 |
| `cost-trend/` | Daily AI spend + cumulative savings sparkline | 10 |
| `health/` | Aggregated traffic-light health signals | 12 |

### Cron API endpoints (`src/app/api/cron/`)
| Endpoint | What it does | Phase |
|---|---|---|
| `ai-cost-drift/` | Daily check for AI spend > 2σ above 30d baseline | 3 |
| `cohort-drift/` | Daily check for cohort-multiplier shift > 15 % | 8 |
| `nb-self-eval/` | Nightly NB margin tune with stability-gated auto-promote | 8 |

### Per-project API
| Endpoint | What it does | Phase |
|---|---|---|
| `projects/[id]/savings/` | Sum of heuristic savings for one project | 11 |

### Admin UI (`src/app/admin/`)
| File | What it does | Phase |
|---|---|---|
| `page.tsx` | Single-page hub with cards for all 13 admin endpoints | 11 |
| `health/page.tsx` | 4-signal traffic-light health dashboard | 12 |

### Supabase migrations (`supabase/migrations/`)
| File | What it does | Phase |
|---|---|---|
| `20260504_drawing_analysis_cache.sql` | New `sabi_drawing_analysis_cache` table for content-hash cache | 1 |
| `20260504_sabi_corrections.sql` | New `sabi_corrections` table for human-vs-AI events | 2 |

### Top-level
| File | What it does | Phase |
|---|---|---|
| `deploy.md` | Deployment + cron registration documentation | 9 (extended) |

---

## Files modified (revert specific changes)

These existing files had additions only — no deletions of prior behaviour. Reverting means removing the marked blocks.

### `package.json`
**Added dependencies**: `chrono-node`, `tesseract.js`, `pdfjs-dist`, `@napi-rs/canvas`. Plus `package-lock.json` (was deleted previously).
**Revert**: `npm uninstall chrono-node tesseract.js pdfjs-dist @napi-rs/canvas`

### `src/lib/ai/claude-api.ts`
- Imports added: `assertAiBudget`, `analyzeSpecsHeuristicAsync`, `classifyEmailNB`, `getExtractionPriorHints`, `computeTextKey`, `getCached`, `storeCached`, `logHeuristicSaving`, `createHash`
- `callClaude()` now starts with `assertAiBudget()` and computes prompt-version SHA
- `classifyEmail()` runs NB pre-check before Haiku
- `extractProjectInfo()` rewritten — fallback-first, cache check, hint injection
- `analyzeSpecifications()` rewritten — heuristic-first, cache check, AI fallback
- New helpers: `pick`, `hashFirst16`, `sha256First16`
- New constants: `SPEC_PROCEDURE_VERSION`, `EXTRACT_PROCEDURE_VERSION`

**Revert**: easiest is `git checkout HEAD -- src/lib/ai/claude-api.ts` (loses the entire phase work on this file).

### `src/lib/email/email-utils.ts`
- `extractDeadline()` upgraded with chrono-node 3-tier parsing.
**Revert**: restore the regex-only version of `extractDeadline()`.

### `src/lib/notifications/api-alert.ts`
- New types: `cost_drift`, `cohort_drift` AlertKinds
- New functions: `logTokenUsage` (extended with `extra` param), `logHeuristicSaving`
- `withProjectContext`, `currentProjectId`, `sendApiAlert` already existed (this file was technically new in Phase 1)

### `src/lib/pdf/boq-pdf-generator.ts`
- New imports: formula derivers
- New function: `backfillWithFormulas()` — fills empty AI sections from formulas
- `generateElectricalPowerBOQ()` calls backfill before rendering

**Revert**: remove the `backfillWithFormulas` function + remove its call site.

### `src/lib/pipeline/yardstick-orchestrator.ts`
- New import: `applyAutoAdjustment`
- "Smart Skip" placeholder-rate fill now applies cohort multipliers per service.

**Revert**: remove the `applyAutoAdjustment` call + restore the simple `rate = baseRate` line.

### `src/app/api/projects/[id]/extract/route.ts`
- New imports: `runOcrOnImageBuffer`, `runOcrOnPdfBuffer`
- PDF branch: OCR fallback when pdf-parse text < 200 chars
- Image branch: OCR before AI vision

### `src/app/api/projects/[id]/estimate/route.ts`
- New imports: `runElectricalPrePass`, `parseSldSpatial`, `diffCableSchedules`, `diffMechanicalEquipment`, `diffPowerOutlets`, `logCorrection`
- Pre-pass + spatial parse before AI call
- Diff capture after AI returns

### `src/app/api/projects/[id]/services/route.ts`
- New import: `logCorrection`
- PUT logs human-vs-AI rate disagreement

### `src/app/api/projects/[id]/quick-estimate/route.ts`
- New import: `applyAutoAdjustment`
- Per-service rates auto-adjusted from cohort multiplier

### `src/app/api/projects/[id]/bid-decision/route.ts`
- New import: `logCorrection`
- Logs disagreement when human declines an AI-suggested bid

### `src/app/api/projects/[id]/gate/route.ts`
- New import: `logCorrection`
- Gate-12 / gate-14 rejections log corrections

### `src/app/api/projects/[id]/approve/route.ts`
- New imports: `waitUntil`, `tuneYardstickFromApproval`
- Approval triggers fire-and-forget yardstick tune

### `src/app/api/projects/[id]/route.ts`
- New imports: `logCorrection`
- PUT captures extraction-level corrections (`extraction.<field>` paths)
- New constant: `AI_EXTRACTED_FIELDS`
- New helper: `sameValue()`

### `src/app/inbox/page.tsx`
- New state: `savingsTotal`, `savingsSparkline`, `savingsByKind`
- New mount-time fetch from `/api/admin/cost-trend`
- New `renderSparkline()` helper
- Header subtitle now shows lifetime-savings chip with sparkline + tooltip

### `src/app/bids/[id]/page.tsx`
- New state: `cohortDrift`, `extractionHints`, `showHintsModal`, `projectSavings`
- New mount-time fetches: cohort-drift-status, extraction-hints-preview, project savings
- Per-service auto-adjust badge + revert button (Phase 5)
- Per-service cohort-drift badge (Phase 9)
- Header AI-warned button + modal (Phase 10)
- Header per-project savings chip (Phase 11)
- Per-attachment OCR provenance badges (Phase 10)

### `vercel.json` (already empty before this work)
- Deploy.md documents how to re-add crons; the file itself is unchanged.

---

## Database changes

### Tables added
1. **`sabi_drawing_analysis_cache`** (migration `20260504_drawing_analysis_cache.sql`)
   Content-hash cache so identical drawing inputs return the cached result.
2. **`sabi_corrections`** (migration `20260504_sabi_corrections.sql`)
   Stores every human-vs-AI disagreement with field path, ai value, human value, metadata.

### Tables read-only-extended (no schema change)
- **`sabi_settings`** — new keys: `nb_classifier`, `nb_self_eval_history`, `nb_self_eval_archive_yyyy_mm`, `cohort_drift_latest`. Just rows added; no column changes.
- **`sabi_activity_log`** — new step_name values written: `'Claude Token Usage'` (with `prompt_version` field after Phase 12), `'Heuristic Saving'`, `'Drawing Cache Hit'`, `'NB Self-Eval'`. No schema change.
- **`sabi_services.ai_extraction`** — new JSONB sub-keys: `auto_adjusted`, `manual_override`, `override_at`, `rate_source`. No column change.
- **`sabi_yardstick_rates`** — rows updated by yardstick-tuner cron. No schema change.

### How to revert the database
```sql
DROP TABLE IF EXISTS sabi_corrections;
DROP TABLE IF EXISTS sabi_drawing_analysis_cache;

DELETE FROM sabi_settings WHERE key IN (
  'nb_classifier',
  'nb_self_eval_history',
  'cohort_drift_latest'
);
-- monthly archive keys, if any:
DELETE FROM sabi_settings WHERE key LIKE 'nb_self_eval_archive_%';

-- Optional: clear the new activity_log step types
DELETE FROM sabi_activity_log
WHERE step = 0
  AND step_name IN ('Heuristic Saving', 'NB Self-Eval');
```

---

## Environment variables

All new env vars are **optional**. The system uses safe defaults when they're absent. No revert needed unless you set them.

| Var | Default | Purpose | Phase |
|---|---|---|---|
| `AI_DISABLED` | `false` | Master kill switch — set to `true` to fail every Claude call | 1 |
| `MAX_DAILY_AI_USD` | `10` | Per-day spend cap before budget guard throws | 1 |
| `MAX_PROJECT_AI_USD` | `3` | Per-project spend cap | 1 |
| `NB_HIGH_MARGIN` | `4` | NB log-prob margin for high-confidence skip | 6 |
| `NB_AUTO_PROMOTE` | `0` | Set `1` to let nb-self-eval cron auto-update margin (with stability gate) | 8/12 |

---

## What's still in production behaviour after revert

If you delete every new file + revert every modification listed above, the system goes back to:
- Plain Claude calls for every classification, extraction, spec analysis, electrical scan
- No deduping cache
- No budget guard
- No corrections capture
- No self-tuning anything
- Manual rate edits via existing services PUT (works exactly as before)

In other words: the system from before this work, fully restored.

---

## File map by phase (for quick reference)

| Phase | What it added |
|---|---|
| 1 | brand-dictionary, spec-analyzer, brand-harvest, result-cache, budget-guard, formulas, pre-pass, ocr-image, drawing-cache migration, chrono-node deadline parser |
| 2 | naive-bayes-classifier, sld-spatial-parser, corrections-logger, sabi_corrections migration, ocr-image wired into extract route, NB wired into classifyEmail |
| 3 | ocr-pdf, rate-adjuster, yardstick-tuner, ai-cost-drift cron, cost-stats endpoint, rate-adjustments endpoint, gate-route + bid-decision corrections capture |
| 4 | NB feedback loop, auto-apply rate adjuster (quick-estimate), BOQ Sections 6+7 backfill, NB eval endpoint |
| 5 | correction-stats, NB holdout split, yardstick-orchestrator auto-adjust, services UI revert button |
| 6 | cable-schedule-diff, bulk auto-adjust endpoint, cohort-intel, NB tune endpoint with env override |
| 7 | array-diff (outlets + mechanical), DB-backed NB margin (sabi_settings), extraction-level corrections in PUT projects, recency-weighted rate adjustment |
| 8 | extraction-accuracy endpoint, cohort-drift cron, cohort-intel extension, nb-self-eval cron, nb-tune-runner refactor |
| 9 | extraction-hints (prompt injection), nb-trend endpoint, cohort-drift-status endpoint, bid-detail drift badge UI, deploy.md cron docs |
| 10 | cost-trend endpoint, OCR provenance badges, lifetime savings banner, extraction-hints preview modal |
| 11 | per-project savings endpoint, inline SVG sparkline, /admin index page, NB history archive rotation |
| 12 | stability-gated NB auto-promote, /admin/health dashboard, prompt-version SHA capture, savings tooltip with top kinds |
