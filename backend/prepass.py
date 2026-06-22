"""
Pre-pass: extract text from PDF text layer + regex-pull common title block fields.
Runs BEFORE Claude Vision — extracted facts are injected into the AI prompt as ground truth.
"""

import re
from pathlib import Path


def extract_pdf_text(file_path: str) -> str | None:
    """Extract raw text from a PDF's text layer. Returns None if not a PDF or no text."""
    if Path(file_path).suffix.lower() != ".pdf":
        return None
    try:
        import pdfplumber
        with pdfplumber.open(file_path) as pdf:
            pages_text = []
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    pages_text.append(t)
        text = "\n".join(pages_text).strip()
        return text if text else None
    except Exception:
        return None


def prepass_extract(text: str) -> dict:
    """
    Run regex patterns over PDF text to extract common title block fields.
    Only returns fields where a pattern confidently matched.
    """
    if not text:
        return {}
    result = {}

    # Drawing number — patterns like DWG-001, A-101, D-001/R0, DRAWING NO: X
    dn_patterns = [
        r'(?:DWG|DRG|DRAWING)\s*(?:NO\.?|NUMBER|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-/\.]{2,20})',
        r'\b([A-Z]{1,3}-\d{3,5}(?:[/-][A-Z0-9]+)?)\b',
    ]
    for pat in dn_patterns:
        m = re.search(pat, text, re.IGNORECASE | re.MULTILINE)
        if m:
            result["drawing_number"] = m.group(1).strip()
            break

    # Scale — 1:50, 1:100, 1 : 200
    scale_m = re.search(r'(?:SCALE|SCL)\s*[:\-]?\s*(1\s*:\s*\d+)', text, re.IGNORECASE)
    if scale_m:
        result["scale"] = re.sub(r'\s+', '', scale_m.group(1))  # normalise spaces → "1:100"

    # Date — DD/MM/YYYY or YYYY-MM-DD or Month YYYY
    date_m = re.search(
        r'(?:DATE|DATED?)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})',
        text, re.IGNORECASE
    )
    if date_m:
        result["date_of_issue"] = date_m.group(1).strip()

    # Revision — Rev A, Rev 0, Rev-01, Revision: B
    rev_m = re.search(
        r'(?:REV(?:ISION)?)\s*[:\-]?\s*([A-Z0-9]{1,4})\b',
        text, re.IGNORECASE
    )
    if rev_m:
        val = rev_m.group(1).strip()
        if val.upper() not in {"NO", "BY", "DATE", "REV"}:
            result["revision_number"] = val

    # Sheet number — Sheet 1 of 10, SH 2/12
    sheet_m = re.search(
        r'(?:SHEET|SH\.?)\s*(\d+)\s*(?:OF|/)\s*(\d+)',
        text, re.IGNORECASE
    )
    if sheet_m:
        result["sheet_number"] = sheet_m.group(1)
        result["total_sheets"] = sheet_m.group(2)

    # Project name — PROJECT: <text up to newline>
    proj_m = re.search(
        r'(?:PROJECT|PROJ\.?)\s*[:\-]\s*(.+)',
        text, re.IGNORECASE
    )
    if proj_m:
        val = proj_m.group(1).strip()[:100]
        if len(val) > 3:
            result["project_name"] = val

    # Client name
    client_m = re.search(r'(?:CLIENT|OWNER)\s*[:\-]\s*(.+)', text, re.IGNORECASE)
    if client_m:
        val = client_m.group(1).strip()[:100]
        if len(val) > 2:
            result["client_name"] = val

    # Drawn by
    drawn_m = re.search(r'(?:DRAWN\s*BY|DRWN\s*BY)\s*[:\-]?\s*([A-Za-z\s\.]{2,30})', text, re.IGNORECASE)
    if drawn_m:
        result["drawn_by"] = drawn_m.group(1).strip()

    # Checked by
    checked_m = re.search(r'(?:CHECKED?\s*BY|CHK\s*BY)\s*[:\-]?\s*([A-Za-z\s\.]{2,30})', text, re.IGNORECASE)
    if checked_m:
        result["checked_by"] = checked_m.group(1).strip()

    # Approved by
    approved_m = re.search(r'(?:APPROVED?\s*BY|APPRVD?\s*BY)\s*[:\-]?\s*([A-Za-z\s\.]{2,30})', text, re.IGNORECASE)
    if approved_m:
        result["approved_by"] = approved_m.group(1).strip()

    return result


def build_known_facts_block(prepass: dict) -> str:
    """Build XML block to inject into Claude prompt as pre-verified ground truth."""
    if not prepass:
        return ""
    lines = "\n".join(f"  {k}: {v}" for k, v in prepass.items())
    return f"<known_facts>\n{lines}\n</known_facts>"
