# taskID: `DRAWTOBOQ_EXTRACT_PROJECT`

Title-block + email project-info extractor. Called by `extractProjectInfo()` in
`src/lib/ai/claude-api.ts`. Pulls structured project metadata (client, area, floors,
services, consultant, drawing-set numbers) from the email body + any PDF attachments.

> The app runs a regex fallback first and **merges** the AI result over it (AI `null`
> never overwrites a regex hit). It also content-hash caches results, so this task is
> only invoked on a cache miss with at least one attachment present.

## Settings
```yaml
model:        claude-sonnet-4-6
temperature:  0
max_tokens:   4096
vision:       true         # PDF attachments sent as vision input
useJson:      true
```

## Input (from the app's `payload` + attached files)
- `payload.systemPrompt` → system message (canonical copy below)
- `payload.userText`     → fully-rendered user prompt (variables already filled)
- `files[]`              → PDF attachments (vision)

Template variables (already injected into `userText` by the app):

| Variable | Meaning | Source |
|---|---|---|
| `{{PRIOR_HINTS}}` | 90-day human-correction hints, or empty | `getExtractionPriorHints()` |
| `{{SUBJECT}}` | email subject | synced email |
| `{{EMAIL_BODY}}` | cleaned email body (HTML stripped, quoted replies removed), first 8,000 chars | synced email |
| `{{ATTACHMENT_NAMES}}` | comma-joined attachment filenames, or `None` | `sabi_attachments` |

---

## System prompt
```
You are an MEP project data extractor for SABI, an MEP contractor in Dubai, UAE. Respond with valid JSON only.
```

## User prompt template
```
Extract ALL structured project information from this email and its PDF attachment content.

IMPORTANT: PDF attachment content contains the most accurate data. Always prioritize values from PDF over email body.

{{PRIOR_HINTS}}Email Subject: {{SUBJECT}}
Content (email body + PDF attachments):
{{EMAIL_BODY}}

Attachment filenames: {{ATTACHMENT_NAMES}}

Extract and respond in JSON format:
{
  "client_name": "company or developer name, or null",
  "project_name": "project name, or null",
  "location": "city/area in UAE, or null",
  "floors": total number of floors (count ALL: basement + ground + typical + roof), or null,
  "parking_floors": number of basement/parking floors or null,
  "typical_floors": number of typical/office floors or null,
  "area_per_floor_sqft": area per floor in sqft or null,
  "total_area_sqft": total built-up area in sqft (this is critical - extract exact number from PDF), or null,
  "typical_height_m": floor-to-floor height in meters or null,
  "building_type": one of "office"|"retail"|"residential"|"warehouse"|"villa"|"hotel"|"hospital"|"restaurant" or null,
  "deadline": submission deadline as ISO date string (e.g. "2026-05-03"), or null,
  "services_mentioned": array of ALL MEP services mentioned: "hvac"|"electrical"|"plumbing"|"fire_fighting"|"fire_alarm"|"bms"|"lpg"|"drainage",
  "hvac_tonnage": HVAC cooling load in TR (tons of refrigeration) if specified, or null,
  "hvac_system": HVAC system type if specified (e.g. "VRF", "Chiller", "Split", "Package Unit", "VRF with FAHU"), or null,
  "consultant": consultant/engineer firm name, or null,
  "plot_no": plot number from drawing title block (e.g. "6731315"), or null,
  "architect": lead architect name + registration if shown (e.g. "Engr. Samer Mahmoud Ajami (Reg. 105181)"), or null,
  "structural_engineer": structural engineer name + registration if shown, or null,
  "drawing_set": drawing set range/series, e.g. "P-001…P-300 (14 sheets, Power Layout)", or null,
  "job_no": job/file number from title block (e.g. "FA_P379"), or null
}

CRITICAL extraction rules:
- total_area_sqft: Look for "Built-Up Area", "Total Area", "GFA", "BUA" values. This MUST be extracted if present.
- Convert sqm to sqft (1 sqm = 10.764 sqft) if area given in metric
- If total_area_sqft not mentioned but area_per_floor and floors are, calculate it
- floors: Count ALL levels including basement, ground, mezzanine, typical, and roof
- services_mentioned: Include ALL MEP services found. Look for fire alarm separately from fire fighting.
- If drawing files are attached, analyze them visually for MEP equipment schedules, room layouts, floor plans.
```

---

## Output contract
- Single JSON object matching the schema above — no markdown, no prose.
- Use `null` for any field not found; `services_mentioned` defaults to `[]`.
- Prefer values read from the PDF title block over the email body.
- The app overlays this on its regex fallback, so partial results are still useful —
  return whatever you can read, `null` for the rest (do not guess).
