"""
Generate the "Printo - Project Overview" PDF from the branded HTML.

Pure-Python (xhtml2pdf) - no system libraries required.

Usage:
    python docs/generate_overview_pdf.py

Fallback if generation fails for any reason: open docs/printo_overview.html in a
browser and use Print -> Save as PDF.
"""

from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "printo_overview.html"
OUT = HERE / "Printo_Project_Overview.pdf"


def main() -> int:
    from xhtml2pdf import pisa
    html = SRC.read_text(encoding="utf-8")
    with open(OUT, "wb") as f:
        result = pisa.CreatePDF(html, dest=f, encoding="utf-8")
    if result.err:
        print(f"PDF generation reported {result.err} error(s).")
        return 1
    print(f"PDF written: {OUT}  ({OUT.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
