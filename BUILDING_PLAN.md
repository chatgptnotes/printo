# Project Printo — Upload Skill Building Plan
**Feature:** Drawing Upload with Rules Engine + Event Streamer + Toast Notification  
**Target:** POC | Coral Business Solutions | RealSoft ERP  
**Constraint:** Full pipeline must complete in under 60 seconds

---

## 1. What This Skill Does

When a construction drawing is uploaded:
1. File is received and stored
2. **Event Streamer starts — user sees each step live on screen**
3. Claude Vision AI reads the drawing and extracts fields
4. Rules Engine validates the extracted data
5. Toast notification appears showing extracted config + any errors
6. Record is saved to database with status

All of the above must complete within **60 seconds** from upload click.

---

## 2. Folder Structure to Build

```
C:\Users\ACER\Documents\Printo\
├── backend/
│   ├── main.py          ← FastAPI app (upload endpoint, SSE stream, pipeline)
│   ├── extractor.py     ← Claude Sonnet vision API call + JSON output
│   ├── rules.py         ← Rules engine (all validation logic lives here)
│   ├── database.py      ← SQLite table creation and queries
│   └── models.py        ← Pydantic data models
├── frontend/
│   └── app.py           ← Streamlit UI (uploader + event streamer + toast)
├── storage/             ← Uploaded drawing files stored here
├── printo.db            ← SQLite database (auto-created on first run)
├── .env                 ← ANTHROPIC_API_KEY=sk-ant-...
└── requirements.txt     ← All Python dependencies
```

---

## 3. Event Streamer — Live Compilation Display

### What It Is
While the drawing is being processed, the user sees a **live step-by-step feed** on screen — every pipeline stage is streamed in real-time as it happens. No black box waiting. User knows exactly what is happening at every second.

### How It Works (Technical)
- Backend: FastAPI **Server-Sent Events (SSE)** — streams one event per pipeline step
- Frontend: Streamlit polls the SSE stream and appends each event to a live log panel on screen
- Each event has: timestamp, icon, step name, result/message

### What the User Sees on Screen

```
─────────────────────────────────────────────
  PRINTO — COMPILATION IN PROGRESS
─────────────────────────────────────────────
  [10:32:01]  📁  File received: DWG-2024-001.pdf (2.4 MB)
  [10:32:01]  💾  Storing file to disk...
  [10:32:02]  ✅  File stored at /storage/DWG-2024-001.pdf
  [10:32:02]  🔍  Running pre-upload checks (R01–R03)...
  [10:32:02]  ✅  File format valid → PDF accepted
  [10:32:02]  ✅  File size OK → 2.4 MB (limit: 20 MB)
  [10:32:02]  🤖  Sending drawing to Claude Vision AI...
  [10:32:03]  ⏳  AI reading title block and drawing content...
  [10:32:14]  ✅  AI extraction complete → 9 fields found
  [10:32:14]  🔎  Running rules validation (R04–R18)...
  [10:32:14]  ✅  Drawing Number found → DWG-2024-001
  [10:32:14]  ✅  Project Name found → Tower A Phase 2
  [10:32:14]  ⚠️   Low confidence on Revision Number → 0.71 (threshold: 0.80)
  [10:32:14]  ❌  Approval Stamp not detected
  [10:32:15]  💾  Saving record to database → Drawing ID: 12
  [10:32:15]  📋  Exceptions logged → 1 error, 1 warning
  [10:32:15]  🏁  Compilation complete in 14.2 seconds
─────────────────────────────────────────────
```

Then **immediately after** the stream ends → **Toast Notification** pops up.

### Event Stream Structure (Backend SSE Format)

Each event sent from FastAPI:
```
data: {"timestamp": "10:32:02", "icon": "✅", "step": "File stored", "message": "Stored at /storage/DWG-2024-001.pdf", "type": "success"}

data: {"timestamp": "10:32:14", "icon": "⚠️", "step": "Low Confidence", "message": "Revision Number confidence 0.71 < threshold 0.80", "type": "warning"}

data: {"timestamp": "10:32:15", "icon": "🏁", "step": "Done", "message": "Compilation complete in 14.2s", "type": "done"}
```

### Event Types and Colors in Streamlit

| type | Color in UI | Icon |
|---|---|---|
| `info` | Blue | 📁 💾 🔍 🤖 ⏳ |
| `success` | Green | ✅ |
| `warning` | Orange | ⚠️ |
| `error` | Red | ❌ |
| `done` | Dark Green Bold | 🏁 |

### Pipeline Events — Full List (in order)

| # | Event | Type |
|---|---|---|
| 1 | File received: {filename} ({size}) | info |
| 2 | Storing file to disk... | info |
| 3 | File stored at {path} | success |
| 4 | Running pre-upload checks (R01–R03)... | info |
| 5 | File format valid → {format} accepted | success |
| 6 | File size OK → {size} | success |
| 7 | Sending drawing to Claude Vision AI... | info |
| 8 | AI reading title block and drawing content... | info |
| 9 | AI extraction complete → {n} fields found | success |
| 10 | Running rules validation (R04–R18)... | info |
| 11 | Per-field result (one event per field) | success / warning / error |
| 12 | Saving record to database → Drawing ID: {id} | info |
| 13 | Exceptions logged → {n} errors, {n} warnings | warning / success |
| 14 | Compilation complete in {elapsed}s | done |

### Timeout Event (if > 55 seconds)
```
  [10:33:01]  ⏱️   Timeout reached (55s) — AI extraction did not complete
  [10:33:01]  💾  Drawing saved with status: timeout
  [10:33:01]  🔁  Queued for automatic retry
```

---

## 4. Rules Engine — Complete Rule Set

File: `backend/rules.py`

### Rule Categories

#### A. Pre-Upload Rules (checked BEFORE sending to AI — instant)
| Rule ID | Rule | Error Message | Severity |
|---|---|---|---|
| R01 | File type must be PDF, JPG, JPEG, PNG, TIFF | "Unsupported file format. Use PDF or image." | ERROR |
| R02 | File size must be under 20MB | "File too large. Max size is 20MB." | ERROR |
| R03 | File must not be blank/empty | "Uploaded file is empty." | ERROR |

#### B. Extraction Rules (checked AFTER AI extracts — on JSON output)
| Rule ID | Rule | Error Message | Severity |
|---|---|---|---|
| R04 | drawing_number must be present | "Missing: Drawing Number" | ERROR |
| R05 | project_name must be present | "Missing: Project Name" | ERROR |
| R06 | revision_number must be present | "Missing: Revision Number" | WARNING |
| R07 | approval_stamp must be detected | "Missing: Approval Stamp — drawing may not be approved" | ERROR |
| R08 | dimensions must be present | "Missing: Dimensions" | WARNING |
| R09 | materials must be present | "Missing: Materials" | WARNING |
| R10 | quantities must be present | "Missing: Quantities" | WARNING |
| R11 | drawn_by or checked_by must be present | "Missing: Author / Checker name" | WARNING |

#### C. Confidence Rules (checked on AI confidence scores)
| Rule ID | Rule | Error Message | Severity |
|---|---|---|---|
| R12 | drawing_number confidence >= 0.85 | "Low confidence on Drawing Number ({score})" | WARNING |
| R13 | project_name confidence >= 0.80 | "Low confidence on Project Name ({score})" | WARNING |
| R14 | revision_number confidence >= 0.80 | "Low confidence on Revision Number ({score})" | WARNING |
| R15 | Any field confidence < 0.60 | "Very low confidence on: {field} — manual review required" | ERROR |

#### D. Format / Business Rules (checked on extracted values)
| Rule ID | Rule | Error Message | Severity |
|---|---|---|---|
| R16 | drawing_number matches pattern (letters + digits + hyphens) | "Drawing Number format invalid: {value}" | WARNING |
| R17 | revision_number is numeric or follows Rev-XX pattern | "Revision Number format unrecognised: {value}" | WARNING |
| R18 | quantities must be numeric where present | "Quantities value is not numeric: {value}" | WARNING |

---

## 5. Toast Notification Design

Shown immediately after event stream ends.

### Success Toast (all rules pass)
```
✅  DWG-2024-001 | Extracted Successfully
    Project: Tower A Phase 2
    Fields: 9 found | Rev: 03 | Sheet: 02 of 12
    Pushed to queue for ERP mapping →
```

### Warning Toast (some warnings, no errors)
```
⚠️  DWG-2024-001 | Extracted with Warnings
    Project: Tower A Phase 2
    Warnings (2):
    • Low confidence on Revision Number (0.71)
    • Missing: Quantities
    → Flagged for human review before ERP push
```

### Error Toast (one or more errors)
```
❌  Upload Failed — Validation Errors (2)
    • Missing: Approval Stamp
    • Very low confidence on Drawing Number (0.52)
    Drawing held in Exceptions queue.
    → Go to Review Dashboard to fix and resubmit
```

### Timeout Toast (> 60 seconds)
```
⏱️  Processing Timeout
    Drawing saved but AI extraction timed out (>60s).
    → Queued for retry automatically
```

---

## 6. Time Budget (must stay under 60 seconds)

| Step | Expected Time | Max Allowed |
|---|---|---|
| File upload + store to disk | 1–2 sec | 5 sec |
| Pre-upload rules check (R01–R03) | < 1 sec | 2 sec |
| Claude Vision API call (extraction) | 15–30 sec | 45 sec |
| Rules Engine validation (R04–R18) | < 1 sec | 2 sec |
| Save to SQLite database | < 1 sec | 2 sec |
| Stream close + toast trigger | < 1 sec | 2 sec |
| **TOTAL** | **~20–35 sec** | **60 sec** |

### How to enforce 60-second limit
- Set `timeout=55` on the Claude API call (leaves 5 sec buffer)
- If timeout hit → save drawing with status `timeout` → auto-retry queue
- FastAPI endpoint wraps pipeline in `asyncio.wait_for(timeout=55)`

---

## 7. AI Extraction Prompt (for Claude Vision)

```
You are an expert at reading construction drawings (also called technical/engineering drawings).

Analyse the attached construction drawing and extract the following fields from the title block and drawing content.

Return ONLY a valid JSON object with this exact structure:
{
  "drawing_number": "value or null",
  "project_name": "value or null",
  "revision_number": "value or null",
  "sheet_number": "value or null",
  "total_sheets": "value or null",
  "scale": "value or null",
  "date_of_issue": "value or null",
  "drawn_by": "value or null",
  "checked_by": "value or null",
  "approved_by": "value or null",
  "approval_stamp": true or false,
  "dimensions": "summary of key dimensions or null",
  "materials": ["list", "of", "materials"] or [],
  "quantities": "summary or null",
  "client_name": "value or null",
  "contractor_name": "value or null",
  "confidence": {
    "drawing_number": 0.0 to 1.0,
    "project_name": 0.0 to 1.0,
    "revision_number": 0.0 to 1.0,
    "approval_stamp": 0.0 to 1.0
  }
}

If a field is not visible or not present in the drawing, return null for that field.
Do not include explanations — return only the JSON.
```

---

## 8. Database Tables (SQLite for POC)

```sql
CREATE TABLE drawings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending',
    drawing_number TEXT,
    project_name TEXT
);

CREATE TABLE extractions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drawing_id INTEGER REFERENCES drawings(id),
    field_name TEXT NOT NULL,
    field_value TEXT,
    confidence REAL,
    validated INTEGER DEFAULT 0,
    flagged INTEGER DEFAULT 0
);

CREATE TABLE erp_pushes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drawing_id INTEGER REFERENCES drawings(id),
    payload TEXT,
    method TEXT DEFAULT 'excel',
    status TEXT DEFAULT 'queued',
    pushed_at TIMESTAMP,
    response TEXT
);

CREATE TABLE exceptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drawing_id INTEGER REFERENCES drawings(id),
    rule_id TEXT NOT NULL,
    field_name TEXT,
    reason TEXT NOT NULL,
    severity TEXT DEFAULT 'ERROR',
    resolved INTEGER DEFAULT 0,
    resolved_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 9. API Endpoints (FastAPI)

| Method | Endpoint | What it does |
|---|---|---|
| POST | `/upload` | Accept drawing, return drawing_id immediately |
| GET | `/stream/{drawing_id}` | SSE stream — live compilation events for this drawing |
| GET | `/drawings` | List all drawings with status |
| GET | `/drawings/{id}` | Get one drawing with all extracted fields |
| GET | `/exceptions` | List all flagged exceptions |
| PATCH | `/exceptions/{id}/resolve` | Mark exception as resolved |
| GET | `/health` | Health check + DB status |

### Upload Flow (two-step)
1. `POST /upload` → returns `drawing_id` instantly (file saved)
2. Frontend opens `GET /stream/{drawing_id}` → SSE events stream in live
3. On `done` event → frontend closes stream → shows toast

---

## 10. Streamlit UI Behaviour

1. User opens `frontend/app.py`
2. Sees file uploader: *"Upload Approved Construction Drawing (PDF / Image)"*
3. User selects file → clicks Upload
4. **Event Streamer panel appears** — live log lines appear one by one as backend streams them
5. Each line auto-appends with timestamp + icon + message
6. When `done` event received → stream closes
7. **Toast notification pops up** (success / warning / error)
8. Below toast → expandable table shows all extracted fields + confidence scores
9. Exceptions listed with "Resolve" button
10. Sidebar: Total Uploaded | Done | Exceptions | Timeout

---

## 11. Python Dependencies (requirements.txt)

```
fastapi==0.111.0
uvicorn==0.29.0
anthropic==0.28.0
streamlit==1.35.0
python-multipart==0.0.9
pydantic==2.7.0
python-dotenv==1.0.1
aiofiles==23.2.1
Pillow==10.3.0
requests==2.32.3
sse-starlette==2.1.0
```

---

## 12. Build Order (Step-by-Step)

| Step | Task | File |
|---|---|---|
| 1 | Create folder structure + install requirements | setup |
| 2 | Build database tables | database.py |
| 3 | Build rules engine with all R01–R18 rules | rules.py |
| 4 | Build Claude Vision extractor with prompt | extractor.py |
| 5 | Build FastAPI upload + SSE stream endpoint | main.py |
| 6 | Build Streamlit UI with file uploader | frontend/app.py |
| 7 | Add live event streamer panel to Streamlit | frontend/app.py |
| 8 | Add toast notification logic | frontend/app.py |
| 9 | Test with a sample drawing | test run |
| 10 | Verify 60-second constraint is met | timing test |
| 11 | Connect to RealData Hub (Excel push) | main.py |

---

## 13. How to Run (Once Built)

```bash
# Terminal 1 — start backend
cd C:\Users\ACER\Documents\Printo
uvicorn backend.main:app --reload --port 8000

# Terminal 2 — start frontend
streamlit run frontend/app.py
```

Open browser → `http://localhost:8501`

---

*Document: Printo Upload Skill Building Plan | Coral Business Solutions | June 2026*
