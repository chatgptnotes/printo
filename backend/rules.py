import re
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class RuleResult:
    rule_id: str
    passed: bool
    severity: str        # ERROR | WARNING
    field_name: str
    message: str

def run_all_rules(extracted: dict, strict: bool = False) -> list[RuleResult]:
    results = []
    conf = extracted.get("confidence", {})

    def ok(rule_id, field_name, message):
        results.append(RuleResult(rule_id, True, "INFO", field_name, message))

    def warn(rule_id, field_name, message):
        sev = "ERROR" if strict else "WARNING"
        results.append(RuleResult(rule_id, False, sev, field_name, message))

    def err(rule_id, field_name, message):
        results.append(RuleResult(rule_id, False, "ERROR", field_name, message))

    # ── B: Required Fields ────────────────────────────────────────────────────
    if extracted.get("drawing_number"):
        ok("R04", "drawing_number", f"Drawing Number found: {extracted['drawing_number']}")
    else:
        err("R04", "drawing_number", "Drawing Number is missing (mandatory field)")

    if extracted.get("project_name"):
        ok("R05", "project_name", f"Project Name found: {extracted['project_name']}")
    else:
        err("R05", "project_name", "Project Name is missing (mandatory field)")

    if extracted.get("revision_number"):
        ok("R06", "revision_number", f"Revision Number found: {extracted['revision_number']}")
    else:
        warn("R06", "revision_number", "Revision Number is missing")

    if extracted.get("approval_stamp") is True:
        ok("R07", "approval_stamp", "Approval Stamp detected on drawing")
    else:
        err("R07", "approval_stamp", "Approval Stamp NOT detected (drawing may be unapproved)")

    if extracted.get("dimensions"):
        ok("R08", "dimensions", f"Dimensions found: {extracted['dimensions']}")
    else:
        warn("R08", "dimensions", "Dimensions not found or unclear")

    mats = extracted.get("materials") or []
    if mats:
        ok("R09", "materials", f"Materials listed: {len(mats)} item(s)")
    else:
        warn("R09", "materials", "Materials list not found")

    if extracted.get("quantities"):
        ok("R10", "quantities", f"Quantities found: {extracted['quantities']}")
    else:
        warn("R10", "quantities", "Quantities not found or unclear")

    if extracted.get("drawn_by") or extracted.get("checked_by"):
        author = extracted.get("drawn_by") or extracted.get("checked_by")
        ok("R11", "drawn_by", f"Author/Checker found: {author}")
    else:
        warn("R11", "drawn_by", "Drawn By and Checked By both missing")

    # ── C: Confidence Rules ───────────────────────────────────────────────────
    dn_conf = conf.get("drawing_number", 1.0)
    if extracted.get("drawing_number"):
        if dn_conf >= 0.85:
            ok("R12", "drawing_number", f"Drawing Number confidence: {dn_conf:.2f} (≥0.85)")
        else:
            warn("R12", "drawing_number", f"Low confidence on Drawing Number: {dn_conf:.2f} (threshold: 0.85)")

    pn_conf = conf.get("project_name", 1.0)
    if extracted.get("project_name"):
        if pn_conf >= 0.80:
            ok("R13", "project_name", f"Project Name confidence: {pn_conf:.2f} (≥0.80)")
        else:
            warn("R13", "project_name", f"Low confidence on Project Name: {pn_conf:.2f} (threshold: 0.80)")

    rn_conf = conf.get("revision_number", 1.0)
    if extracted.get("revision_number"):
        if rn_conf >= 0.80:
            ok("R14", "revision_number", f"Revision Number confidence: {rn_conf:.2f} (≥0.80)")
        else:
            warn("R14", "revision_number", f"Low confidence on Revision Number: {rn_conf:.2f} (threshold: 0.80)")

    very_low = [f for f, s in conf.items() if s < 0.60]
    if very_low:
        for f in very_low:
            err("R15", f, f"Very low confidence on {f}: {conf[f]:.2f} — manual review required")
    else:
        ok("R15", "confidence", "All field confidence scores are above 0.60")

    # ── D: Format / Business Rules ────────────────────────────────────────────
    dn = extracted.get("drawing_number")
    if dn:
        if re.match(r'^[A-Za-z0-9\-]+$', dn):
            ok("R16", "drawing_number", f"Drawing Number format valid: {dn}")
        else:
            warn("R16", "drawing_number", f"Drawing Number format invalid: {dn} (use letters, digits, hyphens only)")

    rn = extracted.get("revision_number")
    if rn:
        if re.match(r'^(\d+|[Rr][Ee][Vv][-\s]?\w+|[Rr][-\s]?\w+)$', str(rn)):
            ok("R17", "revision_number", f"Revision Number format valid: {rn}")
        else:
            warn("R17", "revision_number", f"Revision Number format unrecognised: {rn} (expected numeric or Rev-XX)")

    qty = extracted.get("quantities")
    if qty:
        if re.search(r'\d', str(qty)):
            ok("R18", "quantities", "Quantities value contains numeric data")
        else:
            warn("R18", "quantities", f"Quantities value appears non-numeric: {qty}")

    return results


def verdict(results: list[RuleResult]) -> str:
    errors   = [r for r in results if not r.passed and r.severity == "ERROR"]
    warnings = [r for r in results if not r.passed and r.severity == "WARNING"]
    if errors:
        return "FAILED"
    if warnings:
        return "WARNING"
    return "PASSED"
