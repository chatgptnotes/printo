# Test fixtures — instant replay for demo uploads

Files in this directory are loaded by `src/lib/ai/test-fixture-replay.ts` when
`SABI_TEST_FIXTURES=1`. When a known PDF is re-uploaded, the estimate route
serves the captured `ElectricalProcedureResult` from `<label>-result.json`
and the Power BOQ route serves the captured `<label>-power-boq.pdf` — both
in <1 second, no Claude tokens spent.

A non-matching upload (different file) returns `null` from the lookup and
the real Claude pipeline runs as normal.

## Capture a new fixture

After one real successful run end-to-end (estimate → Gate 12 approve → Power BOQ):

```bash
node scripts/capture-fixture.mjs <projectId> <label>
# example
node scripts/capture-fixture.mjs 16cd9625-3d9f-46ce-a63d-2324c03bd43d p379
```

The script:
1. fetches the project's vision attachments and computes the SHA-256 of their bytes,
2. reads `sabi_services.ai_extraction.raw_electrical_procedure`,
3. downloads `boq/<id>/power-boq.pdf` from Supabase storage,
4. writes `<label>-result.json`, `<label>-power-boq.pdf`, and an `index.json` entry.

## Replay

Set in `.env.local`:

```
SABI_TEST_FIXTURES=1
```

Restart the dev server. Upload the same PDF to a fresh project.

## index.json shape

```json
{
  "<sha256_hex_of_uploaded_file_bytes>": {
    "label": "p379",
    "result": "p379-result.json",
    "pdf": "p379-power-boq.pdf"
  }
}
```

**Production must NOT set `SABI_TEST_FIXTURES=1`.** The module logs a warning when active in production so a misconfig is loud.
