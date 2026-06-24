"""
Mock AI sidecar for Printo — a stand-in for the real Pratyaya / Ampris AI-aaS.

It implements the exact contract Printo's SidecarProvider expects, so the whole
sidecar code path is testable end-to-end without a live vision model:

    GET  /health      → {"status":"ok","vision":true,"model":"..."}
    POST /v1/extract  → {"data": {<fields>, "confidence": {...}}}
        body: {"prompt":str,"schema":{...},"image"?:{"media_type","data"(b64)},"text"?:str}
        auth: Authorization: Bearer <key>   (accepted, not enforced here)

Run:
    python tools/mock_sidecar.py            # serves on http://localhost:8787
    # or: uvicorn mock_sidecar:app --port 8787   (from the tools/ directory)

Replace this with the real sidecar (or point SIDECAR_URL at the Pratyaya AI-aaS)
to get genuine vision extraction — Printo needs no code change to switch.
"""

from fastapi import FastAPI, Request

app = FastAPI(title="Printo Mock AI Sidecar", version="1.0.0")

# Advertise vision capability so SIDECAR_MODE=auto resolves to vision.
ADVERTISE_VISION = True

# A realistic structured extraction, returned for any request. Stands in for a
# real model's output (fields + per-field confidence).
SAMPLE_EXTRACTION = {
    "drawing_number":   "CT-A-101",
    "drawing_title":    "GROUND FLOOR PLAN",
    "project_name":     "CORAL TOWERS RESIDENTIAL COMPLEX",
    "project_location": "",
    "client_name":      "",
    "contractor_name":  "",
    "drawn_by":         "S. Kumar",
    "checked_by":       "B. K. Murali",
    "approved_by":      "M. Varghese",
    "date_of_issue":    "20/06/2026",
    "revision_number":  "Rev A",
    "sheet_number":     "1",
    "total_sheets":     "5",
    "scale":            "1:100",
    "floor_level":      "Ground Floor",
    "total_floor_area": "420 sq.m",
    "building_type":    "Residential",
    "number_of_rooms":  "6",
    "room_schedule": [
        {"name": "Living Room", "area": "28 sq.m"},
        {"name": "Master Bedroom", "area": "20 sq.m"},
        {"name": "Kitchen", "area": "12 sq.m"},
    ],
    "door_count":       "8",
    "window_count":     "12",
    "structural_notes": "RCC framed structure. Column grid 4.5m x 4.5m.",
    "materials":        ["RCC", "AAC Block", "Ceramic Tiles", "UPVC Windows"],
    "dimensions":       "22m x 19m",
    "quantities":       "Doors: 8 nos | Windows: 12 nos | Columns: 16 nos",
    "approval_stamp":   True,
    "north_arrow":      True,
    "grid_lines":       True,
    "additional_notes": "Refer structural drawings for column and beam details.",
    "confidence": {
        "drawing_number": 0.94, "drawing_title": 0.96, "project_name": 0.92,
        "floor_level": 0.95, "total_floor_area": 0.81, "scale": 0.95,
        "revision_number": 0.9, "approval_stamp": 0.88, "dimensions": 0.84,
        "materials": 0.77, "room_schedule": 0.86, "quantities": 0.72,
    },
}


@app.get("/health")
def health():
    return {"status": "ok", "vision": ADVERTISE_VISION, "model": "mock-sidecar-vision-1"}


@app.post("/v1/extract")
async def extract(request: Request):
    # Accept the documented body; we don't run a model, just return realistic data.
    try:
        body = await request.json()
    except Exception:
        body = {}
    received = "image" if body.get("image") else ("text" if body.get("text") else "none")
    return {"data": SAMPLE_EXTRACTION, "received_input": received}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8787)
