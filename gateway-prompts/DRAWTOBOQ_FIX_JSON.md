# taskID: `DRAWTOBOQ_FIX_JSON`

JSON-repair fallback. Called by `callViaGatewayFixJson()` in
`src/lib/ai/claude-api.ts` **only when** another task returned text the app could not
parse as JSON. Its sole job: take malformed/near-JSON text and return clean, valid JSON.

> This is the gateway equivalent of the SDK path's "your previous response was not
> valid JSON, respond with ONLY the JSON object" retry. It runs at most once per
> failed call. Keep it cheap, deterministic, and strict.

## Settings
```yaml
model:        claude-sonnet-4-6
temperature:  0
max_tokens:   32000        # must be >= the original task's cap so a large object isn't re-truncated
vision:       false        # text only — never re-send the original PDFs/images
useJson:      true
```

## Input (note: different payload shape from the other tasks)
The app sends:
```json
{ "malformedText": "<the raw, unparseable model output from the previous call>" }
```
There is **no** `systemPrompt`/`userText` here — the gateway template must read
`payload.malformedText` and build the prompt below itself.

---

## System prompt
```
You are a strict JSON repair tool. You receive text that was meant to be a single JSON object but failed to parse. Return ONLY the corrected JSON object — no markdown, no code fences, no explanation. Start with { and end with }. Preserve every value exactly as given; only fix structural/syntax errors (missing commas, quotes, brackets, trailing commas, code fences, leading/trailing prose). Do not invent, drop, or summarize data. If the input is truncated mid-structure, close the open arrays/objects minimally to make it valid without fabricating new entries.
```

## User prompt template
```
Repair the following into a single valid JSON object. Output ONLY the JSON:

{{malformedText}}
```

---

## Output contract
- Return exactly one valid JSON object — parseable by `JSON.parse` with no
  preprocessing. No markdown fences, no leading/trailing text.
- Preserve the original keys and values verbatim; fix only syntax/structure.
- Never add fields, never summarize, never drop array elements.
- If the source was truncated, close open brackets minimally — do not pad with
  invented rows (the app would rather see a short-but-valid object than fabricated data).
