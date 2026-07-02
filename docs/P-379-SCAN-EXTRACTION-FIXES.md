# P-379 POWER — Scan / Extraction / BOQ Fixes

**Date:** 2026-06-24
**Trigger:** Hard re-scan of `P-379 POWER (1).pdf` (Proposed B+G+8+R, Al Barsha South, Dubai) against our extracted output, then "fix all".
**Method:** Extracted the PDF's vector **text layer** (pdfjs-dist) from the two Single Line Diagrams — **P-200** (LV panel + transformers) and **P-201** (SMDB/DB schedules) — which is more reliable than a vision scan for reading tables, and reconciled it against `tests/fixtures/p379-result.json`.

---

## 1. What was wrong

The distribution side (SMDB inventory, DB inventory, SMDB→DB cable schedule) was **correct**. The failures were concentrated at the **source side** and in two **cable specs**:

### Missing sections (extracted as `[]`/`null`, dropped from the BOQ)
| # | Item on the drawing | Was | BOQ section |
|---|---|---|---|
| 1 | **2× DEWA transformers** — 1000 kVA + 1500 kVA (11 kV/400 V) | `transformers: []` | Bill 2 |
| 2 | **Standby diesel generator** 300 kVA + **ATS** 400 A (interlock + manual bypass) | `generator/ats: null` | Bill 2 |
| 3 | **Capacitor / PF-correction banks** 275 kVAR + 375 kVAR (multi-step auto) | absent | Bill 2 |
| 4 | **Two LV panels** — LVP-01 2500 A/65 kA, LVP-02 1600 A/40 kA | `lv_panels: []` | Bill 2/3 |
| 5 | **Mechanical equipment** — FAHU 174.66 kW, fire pump 98 kW, 3× lifts, 4× 22 kW EV chargers, pool/sauna/pumps | `mechanical_equipment: []` | Bill 4/6 |

### Cable-spec errors
| # | Cable | Was | Should be |
|---|---|---|---|
| 6 | **ESMDB-G** emergency main (400 A) | `4C 70mm² FR` | **`1×4C 300mm² FR + 1×1C 150mm² ECC`** — the 70mm² was the downstream ESMDB-G→ESMDB-RF link, miscopied onto the incomer |
| 7 | **DB-T** apartment feeders (×120) | `4C 16mm² XLPE/SWA/PVC` | **`4×1C 16mm² CU/PVC/WIRES + 1C 16mm² ECC`** — single-core wires in conduit, not armoured |

### Root causes
- **Sections 2/3/6 were described in the prompt but not marked `MANDATORY`** (unlike containment/earthing/metering), so under output pressure on a dense 14-page scan they were dropped.
- The **gap-fill re-read was gated on `!passed`** (error-severity only). Sections 2/3/6 are *warning*-severity, so the safety-net re-read never fired for them.
- `mechanical_equipment` was **extracted but rendered nowhere** in the BOQ generator.
- The cable derivations (`deriveSmdbToDbCables`/`deriveLvToSmdbCables`) **dropped `circuit_description`/`type`**, so even a corrected cable spec couldn't reach the Bill 5 size column.

---

## 2. Fixes applied

### Extractor (so real scans capture them)
- **Promoted Sections 2 (incoming supply), 3 (LV panels + capacitor banks), 6 (mechanical equipment) to `MANDATORY non-empty`** with SLD-grounded read instructions — in **all three prompt copies**:
  - `src/lib/ai/claude-api.ts` (in-process Vercel path)
  - `worker/server.js` (VPS long-scan worker — the one that actually runs prod scans)
  - `gateway-prompts/DRAWTOBOQ_ELECTRICAL_EXTRACT.md` (source-of-truth doc)
- **`CABLE ACCURACY RULE`** added to all three: record cores/insulation/type *as drawn* (CU/PVC single-core wires ≠ XLPE/SWA armoured); a board's incomer cable is its **own** incomer line, not a downstream tie; cross-check incomer size against breaker amps.
- **`NO DUPLICATION` rule** added to all three: each physical item once; `mechanical_equipment` = terminal loads only (never a DB/SMDB or a repeated cable-schedule feeder).

### Safety net
- **Decoupled the gap-fill re-read trigger from `passed`** → `if (missingFillable.length > 0)` in both `estimate/route.ts` and `worker/server.js`, so warning-severity missing sections (incoming supply / LV panels / mechanical) also get the one focused re-read.
- **Cache bumped** `electrical-v4 → electrical-v5` (`src/lib/ai/result-cache.ts`) so the new prompt actually runs (otherwise the stale cached result replays).

### BOQ rendering
- **Bill 2** now lists **every** transformer from `incoming_supply.transformers` (was one synthesized MD-sized line); falls back to the synthesized line when none extracted.
- **Bill 4.2 — "Mechanical & Service Equipment — Power Connections"** added: renders `mechanical_equipment`, scoped to the **electrical termination only** (isolator + glanding + connection) with "cable & DB measured separately" — so it does **not** double-count Bill 5 cables or Bill 3/4.1 boards.
- **`cableSizeLabel`** now renders single-core CU/PVC wires distinctly (e.g. `4×1C×16mm² CU/PVC (single-core, in conduit)`).
- **`deriveSmdbToDbCables`/`deriveLvToSmdbCables`** now carry `circuit_description`+`type` through (added as optional fields on the two cable-array types) so the real cable spec reaches Bill 5.

### Anti-duplication guards (code)
- **Transformers** deduped by kVA + voltage ratio (summing counts) — the SLD labels two units "Transformer #1".
- **LV panels** deduped by tag; **capacitor banks** deduped by kVAR.
- **Mechanical equipment** excludes any description matching a `db_inventory`/`smdb_inventory` tag, and dedupes identical rows.

### Data corrections (P-379 demo output)
- `tests/fixtures/p379-result.json`: ESMDB-G → 300mm² FR, DB-T → 4×1C 16mm² CU/PVC singles (in `smdb_inventory`/`db_inventory` + `cable_schedule`).

### Offline `.mjs` copies (kept in sync)
- `scripts/lib/dubai-industry-boq-xlsx.mjs`: ported Bill 2 transformer-listing + dedupe and Bill 4.2 mechanical band. *(The `.mjs` Bill 5 predates the Cable-Size column, so it has no `cableSizeLabel` — nothing to port there.)*
- `scripts/generate-p379-industry-boq.mjs`: added the two transformers (1000 + 1500 kVA) to the inline fixture (it already had the ESMDB-G 300mm² and fire-pump reconciliation notes).

---

## 3. Files changed
```
src/lib/ai/claude-api.ts                         prompt: MANDATORY 2/3/6 + cable-accuracy + no-dup; cable types +circuit_description/type
src/lib/ai/result-cache.ts                       PROCEDURE_VERSION v4 → v5
src/lib/electrical/derive-cable-paths.ts         carry circuit_description/type through cable derivations
src/lib/excel/dubai-industry-boq-xlsx.ts         Bill 2 tx listing + dedupe; Bill 4.2 mechanical; cableSizeLabel singles
src/app/api/projects/[id]/estimate/route.ts      gap-fill trigger decoupled from passed
worker/server.js                                 prompt sync (2/3/6 + cable-accuracy + no-dup) + gap-fill trigger
gateway-prompts/DRAWTOBOQ_ELECTRICAL_EXTRACT.md  prompt sync (doc)
tests/fixtures/p379-result.json                  ESMDB-G 300mm² FR; DB-T CU/PVC singles
scripts/lib/dubai-industry-boq-xlsx.mjs          offline port: Bill 2 + Bill 4.2 + dedupe
scripts/generate-p379-industry-boq.mjs           inline fixture: 2 transformers
```

## 4. Verification (all green)
- `npx tsc --noEmit` — clean
- `node --check worker/server.js` — OK
- `npx tsx scripts/verify-p379-improvements.ts` — **10/10 assertions pass**
- `npm run boq:p379-industry` — generates; Bill 2 lists both transformers + both capacitor banks + genset/ATS; Bill 4.2 mechanical present
- Injected-duplicates test — 3 transformers→2, dup panel/bank collapsed, dup FAHU→1, a board planted in mechanical correctly excluded
- Bill 5 cable labels: DB-T `4×1C×16mm² CU/PVC (single-core, in conduit)` · ESMDB-G `4C×300mm² FR/LSZH` · DB-G (control) `4C×16mm² XLPE/SWA/PVC`

> The power-boq route re-runs the TS `enrichElectricalResult` + `generateDubaiIndustryBoqXlsx`, so worker-produced scans get all fixes at BOQ-generation time.

## 5. Still to do (manual — needs repo/VPS access)
1. **Deploy Vercel:** push `src/**` → auto-deploy.
2. **Rebuild VPS worker:** `git pull` + `docker compose -p drawtoboq up -d --force-recreate drawtoboq-estimate-worker` (real prod scans run on the worker).
3. **Re-run the P-379 scan** — `electrical-v5` auto-invalidates the cache (or pass `force_refresh`).
