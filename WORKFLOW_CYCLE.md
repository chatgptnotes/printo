# Project Printo — Complete Workflow Cycle
**AI Drawing-to-ERP Extraction | Coral Business Solutions | RealSoft ERP**  
**Date:** June 2026 | **Status:** POC Build Complete

---

## 1. The Complete Workflow Cycle

```
Construction Drawing (PDF / Image / Scan)
              ↓
    POST /upload  (FastAPI Server — main.py)
              ↓
  ┌───────────────────────────────────────────────┐
  │        LIVE EVENT STREAMER (Streamlit UI)     │
  │                                               │
  │  [10:32:01]  📁  File received: DWG-001.pdf   │
  │  [10:32:01]  💾  Stored to storage folder     │
  │  [10:32:02]  ✅  R01 PASSED — PDF valid        │
  │  [10:32:02]  ✅  R02 PASSED — 2.4MB OK         │
  │  [10:32:02]  🤖  Sending to Claude Vision AI  │
  │  [10:32:14]  ✅  9 fields extracted            │
  │  [10:32:14]  ✅  R04 — Drawing Number found    │
  │  [10:32:14]  ❌  R07 — Approval Stamp missing  │
  │  [10:32:14]  ⚠️   R12 — Low confidence 0.71    │
  │  [10:32:15]  🗺️   Mapped to RealSoft format    │
  │  [10:32:15]  🚀  Pushing to RealSoft API...   │
  │  [10:32:15]  ✅  ERP Push: HTTP 200 OK         │
  │  [10:32:15]  💾  Saved to database             │
  │  [10:32:15]  🏁  Done in 14.2s                │
  └───────────────────────────────────────────────┘
              ↓
    RealSoft JSON Payload POSTed:
    {
      "module": "DrawingMaster",
      "action": "CREATE",
      "data": {
        "DrawingNo":      "DWG-2024-001",
        "ProjectName":    "Tower A Phase 2",
        "RevisionNo":     "03",
        "ApprovalStatus": "Approved",
        "Dimensions":     "10m x 20m x 5m",
        "Materials":      "Concrete, Steel",
        "DrawnBy":        "John Smith"
        ... (all 16 fields)
      },
      "metadata": {
        "source":           "PRINTO_AI",
        "ai_confidence":    0.91,
        "validation_status":"PASSED",
        "extracted_at":     "2026-06-20T10:32:15"
      }
    }
              ↓
    RealSoft Test Environment ERP Server
    → Record created in DrawingMaster module
```

---

## 2. Files Built

```
C:\Users\ACER\Documents\Printo\
├── backend/
│   ├── main.py              ← FastAPI server + SSE streaming pipeline
│   ├── extractor.py         ← Claude Sonnet vision extraction
│   ├── rules.py             ← 18 ClearSoft validation rules (R01–R18)
│   ├── realsoft_mapper.py   ← Maps extracted JSON → RealSoft ERP format
│   ├── realsoft_client.py   ← POST to RealSoft API + GET from Data API
│   └── database.py          ← SQLite schema (4 tables)
├── frontend/
│   └── app.py               ← Streamlit UI with live streamer + toast
├── storage/                 ← Uploaded drawing files stored here
├── logs/                    ← Log files
├── printo.db                ← SQLite database (auto-created on first run)
├── .env                     ← API keys (fill before running)
└── requirements.txt         ← Python dependencies
```

---

## 3. What Each File Does

| File | Role |
|---|---|
| `backend/main.py` | Receives the uploaded drawing, runs the full pipeline, streams every step as a live SSE event, returns final JSON result |
| `backend/extractor.py` | Sends the drawing to Claude Sonnet Vision API, returns extracted fields as JSON with confidence scores |
| `backend/rules.py` | Runs all 18 ClearSoft validation rules against extracted data, returns pass/warning/error per rule |
| `backend/realsoft_mapper.py` | Converts Printo extracted JSON into the exact JSON format RealSoft ERP expects |
| `backend/realsoft_client.py` | POSTs the mapped payload to RealSoft test API, also supports GET to read data from RealSoft |
| `backend/database.py` | Creates and manages SQLite tables: drawings, extractions, erp_pushes, exceptions |
| `frontend/app.py` | Streamlit web UI — file uploader, live event stream display, toast notification, extracted fields table, exceptions queue |

---

## 4. Database Tables (SQLite — printo.db)

| Table | What it stores |
|---|---|
| `drawings` | Every uploaded file — name, path, status, drawing number, project name |
| `extractions` | All AI-extracted fields — field name, value, confidence score, flagged status |
| `erp_pushes` | Every push to RealSoft — payload sent, HTTP status, response, timestamp |
| `exceptions` | Every rule violation — rule ID, field, reason, severity, resolved status |

---

## 5. ClearSoft Validation Rules (R01–R18)

| Rule | Check | Severity |
|---|---|---|
| R01 | File format must be PDF, JPG, PNG, TIFF | ERROR |
| R02 | File size must be under 20MB | ERROR |
| R03 | File must not be empty | ERROR |
| R04 | Drawing Number must be present | ERROR |
| R05 | Project Name must be present | ERROR |
| R06 | Revision Number must be present | WARNING |
| R07 | Approval Stamp must be detected | ERROR |
| R08 | Dimensions must be present | WARNING |
| R09 | Materials list must be present | WARNING |
| R10 | Quantities must be present | WARNING |
| R11 | Author or Checker name must be present | WARNING |
| R12 | Drawing Number AI confidence ≥ 0.85 | WARNING |
| R13 | Project Name AI confidence ≥ 0.80 | WARNING |
| R14 | Revision Number AI confidence ≥ 0.80 | WARNING |
| R15 | No field confidence may be below 0.60 | ERROR |
| R16 | Drawing Number format: letters, digits, hyphens only | WARNING |
| R17 | Revision Number format: numeric or Rev-XX | WARNING |
| R18 | Quantities must contain numeric data | WARNING |

---

## 6. RealSoft API Integration

### Push TO RealSoft (Drawing data → ERP)

```
Method : POST
URL    : https://test-api.realsoft-me.com/api/v1/import
Headers: Authorization: Bearer <REALSOFT_API_KEY>
         Content-Type: application/json
Body   : { RealSoft JSON payload }
```

### Extract FROM RealSoft (Read ERP data)

```
Method : GET
URL    : https://test-api.realsoft-me.com/dataapi/DrawingMaster
Headers: Authorization: Bearer <REALSOFT_API_KEY>
Params : { "DrawingNo": "DWG-2024-001" }
```

### RealSoft Integration Status

| Method | Status | Notes |
|---|---|---|
| RealData Hub — Excel/CSV | CONFIRMED | Primary path — needs Excel template from Coral |
| RealData Hub — REST API | UNCONFIRMED | Endpoint and auth needed from Coral |
| Data Portal — Data API | CONFIRMED | For reading/extracting from RealSoft |
| Webhook / Event callbacks | NOT FOUND | No evidence found — do not rely on this |

---

## 7. What You Need From Coral Business Solutions

| Required Item | Used In |
|---|---|
| RealSoft test environment base URL | `REALSOFT_BASE_URL` in `.env` |
| API key / Bearer token | `REALSOFT_API_KEY` in `.env` |
| Exact import endpoint path | `realsoft_client.py` — line 30 |
| DrawingMaster exact field names | `realsoft_mapper.py` — data block |
| RealData Hub Excel import template | Alternative to API push |
| 5–10 sample approved construction drawings | AI extraction testing (M1) |

---

## 8. API Endpoints (Printo Server)

| Method | Endpoint | What it does |
|---|---|---|
| POST | `/upload` | Upload drawing → runs full pipeline → SSE stream |
| GET | `/drawings` | List all drawings with status |
| GET | `/drawings/{id}` | Get one drawing with extractions + push history |
| GET | `/exceptions` | List all validation exceptions (unresolved) |
| PATCH | `/exceptions/{id}/resolve` | Mark an exception as resolved |
| GET | `/health` | Server health + RealSoft reachability check |

---

## 9. Environment Variables (.env)

```env
# Anthropic Claude Vision API
ANTHROPIC_API_KEY=sk-ant-YOUR_KEY_HERE

# RealSoft Test Environment (from Coral Business Solutions)
REALSOFT_BASE_URL=https://test-api.realsoft-me.com
REALSOFT_API_KEY=YOUR_TEST_API_KEY_FROM_CORAL
REALSOFT_TIMEOUT=30
```

---

## 10. How to Run

```bash
# Step 1 — Install dependencies
cd C:\Users\ACER\Documents\Printo
pip install -r requirements.txt

# Step 2 — Add your API keys to .env

# Step 3 — Start backend (Terminal 1)
uvicorn backend.main:app --reload --port 8000

# Step 4 — Start frontend (Terminal 2)
streamlit run frontend/app.py

# Step 5 — Open browser
# http://localhost:8501
```

---

## 11. POC Milestones Status

| # | Milestone | Status |
|---|---|---|
| M1 | Sample drawings + field list confirmed | ⏳ Pending — waiting for client |
| M2 | AI extraction prototype on 5 drawings | ✅ Code built — needs API key + drawings |
| M3 | Validation engine live (18 rules) | ✅ Built — rules.py complete |
| M4 | RealSoft ERP mapping + push working | ⏳ Pending — needs API creds from Coral |
| M5 | End-to-end test + accuracy report | ⏳ Pending — after M1 + M4 |

---

## 12. References

- RealSoft Website: https://www.realsoft-me.com
- RealData Hub: https://www.realsoft-me.com/realdata-hub/
- RealData Portal: https://www.realsoft-me.com/realdata-portal/
- RealData Flow: https://www.realsoft-me.com/realdata-flow/
- Project PDF: `C:\Users\ACER\Downloads\Printo_Workflow.pdf`

---

*Project Printo | Confidential | Coral Business Solutions | June 2026 | hopenagpur@gmail.com*
