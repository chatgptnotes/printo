"""
Maps Printo extracted JSON → RealSoft ERP API JSON format.
Update REALSOFT_MODULE and field mappings once Coral shares the exact spec.
"""
import datetime

REALSOFT_MODULE = "DrawingMaster"   # confirm with Coral


def map_to_realsoft(extracted: dict, drawing_id: int, file_name: str,
                     validation_verdict: str, ai_confidence_avg: float) -> dict:
    materials = extracted.get("materials") or []
    if isinstance(materials, list):
        materials_str = ", ".join(materials)
    else:
        materials_str = str(materials)

    return {
        "module": REALSOFT_MODULE,
        "action": "CREATE",
        "data": {
            # ── Core Drawing Fields ─────────────────────────────────
            "DrawingNo":        extracted.get("drawing_number"),
            "ProjectName":      extracted.get("project_name"),
            "RevisionNo":       extracted.get("revision_number"),
            "SheetNo":          extracted.get("sheet_number"),
            "TotalSheets":      extracted.get("total_sheets"),
            "Scale":            extracted.get("scale"),
            "DateOfIssue":      extracted.get("date_of_issue"),
            # ── Authorship ─────────────────────────────────────────
            "DrawnBy":          extracted.get("drawn_by"),
            "CheckedBy":        extracted.get("checked_by"),
            "ApprovedBy":       extracted.get("approved_by"),
            "ApprovalStatus":   "Approved" if extracted.get("approval_stamp") else "Pending",
            # ── Technical Data ─────────────────────────────────────
            "Dimensions":       extracted.get("dimensions"),
            "Materials":        materials_str,
            "Quantities":       extracted.get("quantities"),
            # ── Parties ────────────────────────────────────────────
            "ClientName":       extracted.get("client_name"),
            "ContractorName":   extracted.get("contractor_name"),
        },
        "metadata": {
            "source":              "PRINTO_AI",
            "source_file":         file_name,
            "printo_record_id":    drawing_id,
            "ai_confidence_avg":   round(ai_confidence_avg, 3),
            "validation_status":   validation_verdict,
            "extracted_at":        datetime.datetime.now().isoformat(),
        }
    }


def average_confidence(extracted: dict) -> float:
    conf = extracted.get("confidence", {})
    scores = [v for v in conf.values() if isinstance(v, (int, float))]
    return sum(scores) / len(scores) if scores else 0.0
