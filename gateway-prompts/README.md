# Gateway Prompt Templates (Nexaproc AI-aas)

These are the prompt/output-rule templates the **ERP Realsoft** app expects its VPS
Claude gateway to expose. When `USE_AI_GATEWAY=true`, every AI call in
`src/lib/ai/claude-api.ts` is routed through `callViaGateway()` to a registered
`taskID` on the gateway (`chatgptnotes/AI-aas`, `src/templates.ts`).

## How the app calls the gateway

- **Text task:** `POST {NEXAPROC_GATEWAY_URL}/api/invoke`
  body `{ taskID, payload, useJson:true }`
- **Vision task (PDF/PNG/JPG attached):** `POST {NEXAPROC_GATEWAY_URL}/api/invoke-vision`
  multipart: `taskID`, `payload` (JSON string), `useJson`, one or more `files`
- Auth header on both: `X-Nexaproc-Key: {DRAWTOBOQ_AIAS_KEY}`. The env key keeps its legacy name until the gateway tenant and task prefixes are migrated together.
- **`payload` shape the app sends:** `{ systemPrompt, userText, maxTokens }`
  - `systemPrompt` → the Claude system message
  - `userText` → the fully-rendered user prompt (the app builds it; see each template)
  - `maxTokens` → output cap to forward to Claude
- Gateway must return JSON: `{ ok, taskID, parsed?, stdout, tokensIn, tokensOut, timedOut, ... }`
  - If `parsed` is present the app uses it directly; otherwise it parses `stdout` as JSON.

> The app already renders the full prompt and sends it as `systemPrompt` + `userText`.
> A new gateway template can therefore **pass these through verbatim** to Claude, OR
> hold its own canonical copy and treat the passthrough as fallback. The canonical
> copies live in this folder so the gateway owns the authoritative output rules.

## Task ID manifest

| taskID | App function | Vision? | model | max_tokens | Status |
|---|---|---|---|---|---|
| `DRAWTOBOQ_ELECTRICAL_EXTRACT` | `analyzeElectricalProcedure` | ✅ | claude-sonnet-4-6 | 32000 | **core — primary scanner** |
| `DRAWTOBOQ_EXTRACT_PROJECT` | `extractProjectInfo` | ✅ | claude-sonnet-4-6 | 4096 | active |
| `DRAWTOBOQ_FIX_JSON` | (JSON-repair fallback) | ❌ | claude-sonnet-4-6 | — | active |
| `DRAWTOBOQ_SPEC_ANALYZE` | `analyzeSpecifications` | ✅ | claude-sonnet-4-6 | — | active |
| `DRAWTOBOQ_ELECTRICAL_DRAWING` | `analyzeElectricalDrawing` | ✅ | claude-sonnet-4-6 | — | legacy/aux |
| `DRAWTOBOQ_MEP_DRAWING` | `analyzeMEPDrawing` | ✅ | claude-sonnet-4-6 | — | legacy (multi-discipline) |
| `DRAWTOBOQ_HVAC_PROCEDURE` | `analyzeHVACProcedure` | ✅ | claude-sonnet-4-6 | — | legacy (HVAC off) |
| `DRAWTOBOQ_WATER_SUPPLY` | `analyzeWaterSupplyDrawing` | ✅ | claude-sonnet-4-6 | — | legacy (plumbing off) |
| `DRAWTOBOQ_DUCT_ROUTE` | `analyzeDuctRouteDrawing` | ✅ | claude-sonnet-4-6 | — | legacy (HVAC off) |

This project runs **Electrical (Power) only**, so the tasks that matter for live
scanning are `DRAWTOBOQ_ELECTRICAL_EXTRACT` (+ `DRAWTOBOQ_EXTRACT_PROJECT` for the
text/title-block extraction, and `DRAWTOBOQ_FIX_JSON` as the parse-failure fallback).

### Canonical templates in this folder
- [`DRAWTOBOQ_ELECTRICAL_EXTRACT.md`](./DRAWTOBOQ_ELECTRICAL_EXTRACT.md) — primary 14-step drawing scanner (vision, 32K)
- [`DRAWTOBOQ_EXTRACT_PROJECT.md`](./DRAWTOBOQ_EXTRACT_PROJECT.md) — email + title-block project-info extractor (vision, 4K)
- [`DRAWTOBOQ_FIX_JSON.md`](./DRAWTOBOQ_FIX_JSON.md) — JSON-repair fallback (text only; payload is `{ malformedText }`)

Register at minimum these three on a new gateway. The remaining legacy/aux task IDs
(`SPEC_ANALYZE`, `MEP_DRAWING`, `HVAC_PROCEDURE`, `WATER_SUPPLY`, `DUCT_ROUTE`,
`ELECTRICAL_DRAWING`) only fire on code paths this electrical-only build does not use;
add templates for them only if you re-enable multi-discipline analysis.

## Common settings for every task
- `temperature: 0`
- `useJson: true` (gateway should parse model output to JSON and return it as `parsed`)
- On JSON-parse failure the app retries once via `DRAWTOBOQ_FIX_JSON`, so a strict
  "JSON only, no markdown" system instruction is required on all tasks.
