"""Smoke tests for BOQ quality gates.

Run from the repository root:
    python tools/boq_quality_smoketest.py
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from boq_quality import BoqQualityError, validate_boq_quality  # noqa: E402


def _mock_like_boq():
    return {
        "drawing_number": "CT-A-GF",
        "project_name": "CORAL TOWERS RESIDENTIAL COMPLEX",
        "boq_items": [
            {"section": "Concrete / RCC", "description": "RCC M25", "unit": "cu.m", "quantity": "-"},
            {"section": "Masonry", "description": "AAC block walls", "unit": "sq.m", "quantity": "-"},
            {"section": "Finishes", "description": "Ceramic tiling", "unit": "sq.m", "quantity": "420"},
            {"section": "Doors & Windows", "description": "UPVC windows", "unit": "nos", "quantity": "12"},
            {"section": "Lighting", "description": "Recessed LED panel", "unit": "nos", "quantity": "60"},
        ],
    }


def _good_electrical_boq():
    sections = [
        ("Incoming Supply", "DEWA HV incoming coordination and service connection"),
        ("HV / LV Main Distribution", "1000 kVA transformer and MDB incomer"),
        ("Sub-Main Distribution Boards (SMDBs)", "SMDB-1F 300A TP MCCB incomer"),
        ("Distribution Boards & Consumer Units", "DB-A1 final distribution board"),
        ("LV Cables", "4C x 16 sq.mm XLPE/SWA/PVC feeder MDB to SMDB-1F"),
        ("Containment (Trunking/Conduit/Tray)", "GI cable tray 300mm"),
        ("Wiring Devices / Small Power", "13A twin switched socket outlets"),
        ("Lighting Fixtures", "LED panel luminaire 600x600"),
        ("Earthing & Lightning Protection", "Earth pit with inspection chamber"),
        ("Metering", "DEWA kWh meter cabinet"),
        ("Test & Commissioning", "Testing, commissioning and as-built documentation"),
    ]
    items = []
    for i in range(30):
        section, desc = sections[i % len(sections)]
        items.append({
            "section": section,
            "description": f"{desc} item {i + 1}",
            "unit": "Nr" if i % 3 else "m",
            "quantity": "1" if i % 3 else "25",
            "reference": "P-379",
            "tag": f"DB-{i + 1}" if "Board" in section else None,
            "rating": "300A TP MCCB" if "SMDB" in section else None,
            "cable_size": "4C x 16 sq.mm XLPE/SWA/PVC" if "Cables" in section else None,
        })
    return {"drawing_number": "P-379", "drawing_title": "POWER", "boq_items": items}


def main() -> int:
    try:
        validate_boq_quality(_mock_like_boq(), source_name="P-379 POWER.pdf", discipline="electrical")
    except BoqQualityError:
        pass
    else:
        print("FAIL: mock-like electrical BOQ was accepted")
        return 1

    validate_boq_quality(_good_electrical_boq(), source_name="P-379 POWER.pdf", discipline="electrical")
    print("OK: BOQ quality gates reject mock output and accept detailed electrical BOQ")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
