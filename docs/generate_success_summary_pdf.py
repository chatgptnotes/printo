from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


OUT = Path(__file__).with_name("ERP_RealSoft_Successful_Integration_Summary_2026-06-26.pdf")


def p(text: str, style):
    return Paragraph(text, style)


def build():
    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "Title",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        textColor=colors.HexColor("#111827"),
        spaceAfter=10,
    )
    h2 = ParagraphStyle(
        "H2",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=15,
        textColor=colors.HexColor("#EA580C"),
        spaceBefore=10,
        spaceAfter=6,
    )
    body = ParagraphStyle(
        "Body",
        parent=styles["BodyText"],
        fontSize=9.5,
        leading=13,
        textColor=colors.HexColor("#1F2937"),
    )
    small = ParagraphStyle(
        "Small",
        parent=body,
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#4B5563"),
    )

    story = [
        p("ERP RealSoft - Successful Integration Summary", title),
        p("Date: 26 June 2026", small),
        p("Prepared for: ERP RealSoft BOQ extraction workflow", small),
        Spacer(1, 6 * mm),
        p(
            "Today the ERP RealSoft workflow was moved from a validation-style drawing checker to a working "
            "AI BOQ extraction workflow. The production system now performs fresh extraction for "
            "each upload, generates detailed BOQs, supports review/approval, and exports reports "
            "without silently falling back to mock/demo data.",
            body,
        ),
    ]

    story += [
        p("Production Status", h2),
        Table(
            [
                ["Frontend", "Production Vercel frontend"],
                ["Backend API", "Production VPS API"],
                ["AI Provider", "Codex Vision via VPS Codex CLI"],
                ["Mock Extraction", "Disabled in production"],
                ["Upload Limit", "Raised to 100 MB"],
                ["Reference Test", "P-379 POWER.pdf generated 201 BOQ rows across 27 sections"],
            ],
            colWidths=[40 * mm, 130 * mm],
            style=[
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D1D5DB")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#FFF7ED")),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ],
        ),
    ]

    sections = [
        (
            "1. Login And Production Access",
            [
                "Fixed backend login behavior and confirmed admin login works.",
                "Verified production API health checks after each deployment.",
                "Kept frontend and backend connected through the existing Vercel proxy flow.",
            ],
        ),
        (
            "2. Fresh Report Regeneration",
            [
                "Added regeneration endpoints for single drawings and all drawings.",
                "Cleared stale generated report data, extractions, corrections, exceptions, and ERP push rows before regeneration.",
                "Ensured every upload/regeneration performs a fresh AI extraction rather than reusing old report data.",
            ],
        ),
        (
            "3. BOQ Quality Improvements",
            [
                "Compared the bad demo BOQ against the corrected P-379 POWER reference workbook.",
                "Added BOQ quality gates that reject mock/demo output and weak electrical BOQs.",
                "Expanded BOQ fields to include tag, rating, cable size, from/to references, and richer electrical sections.",
                "Updated Excel/report/ERP mapping paths to carry the richer BOQ line data.",
            ],
        ),
        (
            "4. Codex Vision Extraction Provider",
            [
                "Verified Codex CLI is logged in on the VPS and usable non-interactively.",
                "Added AI_PROVIDER=codex backend provider path.",
                "Codex now receives rendered drawing sheets as image attachments and returns structured extraction JSON.",
                "Kept fail-closed behavior: no real provider means no fake BOQ.",
            ],
        ),
        (
            "5. JSON Recovery And Reliability",
            [
                "Added retry/recovery handling for malformed Codex JSON output.",
                "Added a second-pass JSON repair fallback while preserving all BOQ rows and fields.",
                "Verified the BOQ smoke test still rejects mock output and accepts detailed electrical BOQ.",
            ],
        ),
        (
            "6. Approval And Export Flow",
            [
                "Verified the review screen loads generated BOQ data.",
                "Fixed production disk pressure that caused SQLite writes and approval to fail.",
                "Confirmed approval works end-to-end on drawing 30 with 201 BOQ items.",
                "Approved BOQs can be exported as PDF/Excel and recorded for ERP transfer.",
            ],
        ),
        (
            "7. Upload Size Increase",
            [
                "Raised backend upload limit from 20 MB to 100 MB.",
                "Kept chunked frontend upload flow for larger files so Vercel request body limits are avoided.",
                "Made the limit configurable with MAX_FILE_SIZE_MB.",
            ],
        ),
        (
            "8. UI Cleanup: BOQ-Only Product Language",
            [
                "Removed obsolete validation/compliance/18-rule wording from the active UI.",
                "Updated cards to: Upload, AI Extract, Generate BOQ, Review & Approve.",
                "Removed unused frontend exceptions proxy route and old backend validation exception endpoints.",
                "Kept internal schema and BOQ quality checks because they protect extraction quality, not drawing validation.",
            ],
        ),
        (
            "9. Reusable Codex Skill",
            [
                "Created local Codex skill: erp-realsoft-boq-extraction workflow notes.",
                "Captured the proven production workflow, health checks, regeneration flow, approval checks, deployment commands, and known failure patterns.",
                "Validated the skill successfully.",
            ],
        ),
    ]

    for heading, bullets in sections:
        story.append(p(heading, h2))
        for item in bullets:
            story.append(p(f"- {item}", body))
        story.append(Spacer(1, 2 * mm))

    story += [
        p("Important Operational Note", h2),
        p(
            "The VPS disk was critically full during testing. Safe cleanup restored several GB of free space, "
            "but disk capacity should still be monitored because uploads, rendered sheets, Codex temporary files, "
            "SQLite writes, reports, and logs all require free space.",
            body,
        ),
        p("Commits Pushed Today", h2),
        p("932be44 - feat: regenerate stored drawing reports", body),
        p("b245275 - fix: fail closed on weak BOQ extraction", body),
        p("a4219a6 - fix: fail closed when AI provider auth fails", body),
        p("11019ea - feat: add Codex vision extraction provider", body),
        p("02cc8ec - fix: harden Codex output and raise upload limit", body),
        p("132c5f5 - refactor: remove obsolete validation workflow copy", body),
        Spacer(1, 5 * mm),
        p(f"Generated at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", small),
    ]

    doc = SimpleDocTemplate(
        str(OUT),
        pagesize=A4,
        rightMargin=16 * mm,
        leftMargin=16 * mm,
        topMargin=14 * mm,
        bottomMargin=14 * mm,
    )
    doc.build(story)
    print(OUT)


if __name__ == "__main__":
    build()
