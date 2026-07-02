# Cable BOQ Accuracy — Fix Plan (execute later)

_Source: methodology review by BK Murali (George Varkey's electrical take-off procedure). This plan addresses the **quantity-correctness** gaps, which are separate from the run-to-run **consistency** work already shipped (deterministic sort + de-improvised prompt + truncation flag, commit 204a7eb)._

---

## Context — what's wrong and why

The cable BOQ total doesn't match the reference, and "data from another project (Indian) seems mixed in." The code audit confirmed the cause is **two real gaps**, not the consistency issue:

- **A. Another-project data leaks in** — (A1) the prompt hands the model one reference building's quantities as "examples," and (A2) the BOQ silently fills generic template lists when a section comes back empty.
- **B. Typical-floor multiplication is fragile** — the "read one floor × 8/16" logic exists but skips partial floors, dies on a row cap, and needs a fully-read template floor.

Goal: make the take-off **project-specific and quantity-correct**, with any estimate clearly flagged and never silently inflating the matched total.

## Decisions needed before/at start

- **D1 — Golden reference.** Is there a human-verified BOQ for one real drawing to validate "matching" against? If not, step zero is creating one — otherwise we tune blind. (Candidate: P-379, if its total is trusted.)
- **D2 — Fallbacks (A2): drop or flag?** Recommendation: **flag + segregate, don't drop.** Dropping re-introduces the old "blank section" problem. Instead keep generic allowances but (a) mark every fallback row `provisional`, (b) banner it "GENERIC — not read from drawing," (c) keep it in a separate allowance sub-total so it never inflates the "read" cable total.

---

## Work items

Each item notes **Code vs Prompt**, files, and the precise change. Mostly code — code fixes are guaranteed/repeatable; prompt fixes only nudge the model.

### A1 — Remove leaked reference quantities  ·  PROMPT  ·  ~½ hr
**Files:** `worker/server.js` (Step 14, ~`buildElectricalProcedurePrompt`), `src/lib/ai/claude-api.ts` (sibling), `gateway-prompts/DRAWTOBOQ_ELECTRICAL_EXTRACT.md`. Keep all three in sync.
**Change:** delete the P-379 magnitudes ("~12,000 m / 6,000 m / 2,400 m / 1,800 m") from the `bulk_cables` instruction. Replace with a method-only directive: *derive final-circuit lengths from THIS building's floor count × per-floor circuit counts read from the drawing; never reuse reference figures; set `provisional=true`.* Keep the `bulk_cables` structure.

### A2 — Stop silent generic fallbacks inflating the total  ·  CODE  ·  ~½ day
**Files:** `src/lib/excel/dubai-industry-boq-xlsx.ts` (Bill 8 lighting fallback ~1595–1634, plus the `?.length ? … : [defaults]` fallbacks for power_outlets / containment / earthing / metering), `src/lib/pdf/boq-pdf-generator.ts` (`backfillWithFormulas`).
**Change (per D2 = flag+segregate):**
- Every fallback row → `provisional: true` + a visible "GENERIC ESTIMATE — not read from drawing" band (Bill 8 already has this banner; extend the same treatment to the other sections that lack it).
- Put generic allowances in a clearly-labelled provisional sub-total, kept **out of** the headline "read" totals so they never make a wrong total look matched.
- Remove any P-379-specific default magnitudes from these lists.

### B2 — Raise/remove the typical-floor row cap  ·  CODE  ·  ~15 min
**File:** `src/lib/electrical/derive-cable-paths.ts` (`expandTypicalFloorFeeders`, the `empty.length * templateCables.length > 400` guard) + worker mirror if/when ported.
**Change:** raise the guard to a realistic tower bound (e.g. 2000) so an 8–22-floor building isn't silently skipped; keep a guard to prevent pathological runaway.

### B1 — Multiply typical floors including PARTIAL floors  ·  CODE  ·  ~½ day
**File:** `src/lib/electrical/derive-cable-paths.ts` (`expandTypicalFloorFeeders`) + worker mirror.
**Today:** only fills floors with **zero** feeders, so a floor read with 8 of 15 DBs stays under-counted and isn't topped up.
**Change:** for each typical floor in `deriveTypicalFloors()`, compare its DB set against the template floor's DB set by **canonical floor-agnostic DB tag** (reuse `canonTag` from `canonicalize.ts`); add the **missing** DBs' feeders, re-tagged to that floor, marked `confidence:'low'` + "(typical-floor replica)". Dedupe by canonical key so existing DBs aren't doubled. Only touch floors in the typical set `T` — never force Ground/Podium/Basement to the typical template.

### B3 — Handle "no fully-read template floor"  ·  CODE  ·  ~2 hr
**File:** same function.
**Today:** if no typical floor is fully enumerated, nothing happens (silent under-count).
**Change:** if no usable template floor exists, synthesize the expected per-floor DB set from `db_groups[]` rollup (`tag_pattern` × `per_floor_qty` × `floors`) when present; otherwise emit a clear validation warning ("typical-floor multiplication could not run — no template floor") instead of silently producing a low total.

### B4 — Enforce the LV→SMDB length formula in code  ·  CODE (move out of prompt)  ·  ~½ day
**Files:** `src/lib/electrical/derive-cable-paths.ts` (+ worker mirror); trim the now-redundant prompt sentence in the 3 copies.
**Today:** the formula `4m + floor_index × typical_floor_height_m + 0.5m` lives only in the prompt → model-dependent, drifts.
**Change:** add a deterministic pass — for each `lv_to_smdb_cables` row whose length is missing or low-confidence **and** scale not detected, compute the length from the SMDB's floor index × `typical_floor_height_m`. Only override absent/flagged values; never overwrite a confident read. If `typical_floor_height_m` is null, leave as-is + `provisional`.

---

## Sequencing & rollout

1. **A1** (prompt) — quick win, kills the leaked numbers.
2. **B2** (cap) — trivial, unblocks tall towers.
3. **B1 + B3** (the multiplication core) — the biggest quantity mover.
4. **B4** (LV→SMDB length in code).
5. **A2** (fallback flag+segregate) — needs D2 confirmed.

Bundle into **one** worker rebuild + one app push (avoid repeated deploys). Keep the `src` TS, the `worker/server.js` JS mirror, and the gateway-prompt copy in sync each time (the project's recurring triple-copy gotcha). Run `/egress-audit` before deploy.

## Verification

- **Offline (per item, no gateway cost):** unit tests for B1/B2/B3 (partial-floor top-up multiplies correctly, dedupes, respects the typical set, no double-count; cap honored), and A2 (fallback rows are `provisional` + excluded from the read total). Extend `scripts/canonicalize.test.mjs`-style harness. `tsc --noEmit` + `node --check worker/server.js`.
- **End-to-end (gated on D1):** deploy → one real scan on the gateway (5–25 min, serial, real $) → compare cable total + per-floor DB counts against the golden reference. Iterate.
- **Consistency regression:** confirm the determinism sort still holds (same drawing → same ordering) after these changes.

## Effort

- **Code/prompt implementation:** ~2 focused days (sum of items above).
- **"Matching total" validation/tuning:** ~3–5 days wall-clock, gated on D1 (a trusted reference) and bounded by gateway scan latency. Some residual difference is inherent (the model must read the drawing right) — the human who prepared the reference may need to confirm procedure for any explainable gap.

## Final deliverable — PDF output

After the fixes are implemented and validated, the result must be produced as a **PDF file** for review/sign-off (by George Varkey / BK Murali), not just on-screen:

1. **Corrected Power BOQ PDF** — already generated by `generateElectricalPowerBOQ()` → `boq/{id}/power-boq.pdf` in Supabase. Confirm it now reflects the fixed quantities.
2. **Verification report PDF** (new, short) — so the reviewer can confirm the procedure was followed:
   - LV→SMDB list: every SMDB with its cable size + length, ground-floor baseline + per-floor height addition shown.
   - SMDB→DB: per-floor schedule with the typical-floor multiplication made explicit ("1 floor × N floors = total").
   - Lighting: per-floor breakup by the project's own fixture references → total.
   - **Total vs golden reference**, with any difference explained.
   - A clearly-marked list of every `provisional` / generic-allowance row (so estimated values are never mistaken for read ones).

   Build it with the project's existing PDF stack (`pdfkit`, same as `src/lib/pdf/boq-pdf-generator.ts`) so it matches the house format.

## Out of scope (explicitly)

- The 5-agent ensemble (separate consistency lever; shelved pending the Step-0 eval).
- OpenCV geometry-based cable measurement (the bigger accuracy flagship in `docs/ACCURACY_AT_LOW_COST_PLAN.md` Phase 3) — these fixes are the cheaper, deterministic first pass.
