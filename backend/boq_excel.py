"""
Industry-format Bill of Quantities (BOQ) workbook generator.

Turns a single drawing's extracted data (title block + trade-grouped
`boq_items`) into a polished, multi-sheet Excel workbook in the layout a
real tender BOQ uses:

    Cover  ->  one "Bill" sheet per trade section  ->  Summary of Bills

Each Bill sheet carries Item / Description / Reference / Unit / Qty / Rate /
Amount columns. `Amount` is a **live Excel formula** (= Qty x Rate), the
Summary totals each Bill via a **cross-sheet formula**, and adds
Contingency, VAT and a Grand Total. The estimator just types rates and the
whole workbook re-totals itself — no rates are invented here.

Deliberately cleaner than a hand-made BOQ: frozen header rows, repeated
print titles, auto-filter, zebra striping, a single disciplined brand
palette, real number formats, and A4 fit-to-width print setup.
"""

from __future__ import annotations

import datetime
import io
import re

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.properties import PageSetupProperties

# ── Brand palette (matches the web app / PDF report) ────────────────────────
NAVY = "1A2744"        # headers / titles
NAVY_SOFT = "243456"   # sub-headers
ORANGE = "F7941D"      # accents / grand total
ZEBRA = "F4F6FA"       # alternating row fill
RATE_FILL = "FFF7EC"   # "enter a rate here" tint
GREY_TEXT = "64748B"
LINE = "D9DEE7"        # borders

_THIN = Side(style="thin", color=LINE)
_MED = Side(style="medium", color=NAVY)
BORDER = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)

CURRENCY_FMT = "#,##0.00"
QTY_FMT = "#,##0.###"

# Bill sheet columns (1-indexed): widths tuned for readability.
COLS = [
    ("Item", 9),
    ("Description", 64),
    ("Reference", 20),
    ("Unit", 9),
    ("Qty", 10),
    ("Rate\n(AED)", 13),
    ("Amount\n(AED)", 15),
]
N_COLS = len(COLS)
LAST_COL = get_column_letter(N_COLS)  # "G"


# ── small helpers ───────────────────────────────────────────────────────────
def _val(v) -> str:
    if v is None:
        return "—"
    s = str(v).strip()
    return s or "—"


def _num(v):
    """Leading numeric value from a quantity string, else None ("—", "12 nos")."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"-?\d[\d,]*\.?\d*", str(v))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def _boq_items(extracted: dict) -> list[dict]:
    return [b for b in (extracted.get("boq_items") or []) if isinstance(b, dict)]


def _sections(items: list[dict]) -> list[str]:
    """Trade sections in first-seen order."""
    out: list[str] = []
    for it in items:
        s = (it.get("section") or "General").strip() or "General"
        if s not in out:
            out.append(s)
    return out


def _sheet_title(prefix: str, name: str, used: set[str]) -> str:
    """Excel-safe (<=31 chars, no []:*?/\\), unique sheet title."""
    clean = re.sub(r"[\[\]:*?/\\]", " ", name).strip()
    title = f"{prefix} {clean}".strip()
    title = title[:31].rstrip()
    base, n = title, 2
    while title.lower() in used:
        suffix = f" ({n})"
        title = base[: 31 - len(suffix)].rstrip() + suffix
        n += 1
    used.add(title.lower())
    return title


def _project_line(extracted: dict, meta: dict) -> str:
    parts = [
        extracted.get("project_name") or meta.get("file_name") or "Project",
        extracted.get("project_location"),
        f"Drawing {extracted.get('drawing_number')}" if extracted.get("drawing_number") else None,
    ]
    return "  |  ".join(p for p in parts if p)


# ── styling primitives ──────────────────────────────────────────────────────
def _fill(color: str) -> PatternFill:
    return PatternFill("solid", fgColor=color)


def _title_band(ws, row: int, text: str, *, fill=NAVY, size=14, height=26):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=N_COLS)
    c = ws.cell(row=row, column=1, value=text)
    c.font = Font(color="FFFFFF", bold=True, size=size)
    c.fill = _fill(fill)
    c.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.row_dimensions[row].height = height


def _subtle_band(ws, row: int, text: str):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=N_COLS)
    c = ws.cell(row=row, column=1, value=text)
    c.font = Font(color=GREY_TEXT, italic=True, size=9.5)
    c.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.row_dimensions[row].height = 16


def _print_setup(ws, header_rows: int):
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.print_title_rows = f"1:{header_rows}"
    ws.print_options.horizontalCentered = True
    ws.sheet_view.showGridLines = False


# ── Cover sheet ─────────────────────────────────────────────────────────────
def _build_cover(wb, extracted: dict, meta: dict, sections: list[str],
                 *, approved: bool, approved_by, approved_at, generated_at: str):
    ws = wb.create_sheet("Cover")
    ws.sheet_view.showGridLines = False
    widths = [3, 26, 26, 18, 14, 14, 16]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    ws.merge_cells("B2:G3")
    t = ws.cell(row=2, column=2, value="ERP RealSoft  —  BILL OF QUANTITIES")
    t.font = Font(color="FFFFFF", bold=True, size=20)
    t.fill = _fill(NAVY)
    t.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.row_dimensions[2].height = 22
    ws.row_dimensions[3].height = 22

    ws.merge_cells("B4:G4")
    s = ws.cell(row=4, column=2,
                value=(extracted.get("drawing_title") or "Construction Works — Bill of Quantities"))
    s.font = Font(color="1A2744", bold=True, size=11)
    s.fill = _fill(ORANGE)
    s.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.row_dimensions[4].height = 18

    def kv(row, label, value):
        lc = ws.cell(row=row, column=2, value=label)
        lc.font = Font(bold=True, color=NAVY, size=10)
        lc.alignment = Alignment(vertical="center")
        ws.merge_cells(start_row=row, start_column=3, end_row=row, end_column=7)
        vc = ws.cell(row=row, column=3, value=_val(value))
        vc.font = Font(size=10)
        vc.alignment = Alignment(vertical="center", wrap_text=True)
        ws.row_dimensions[row].height = 16

    def header(row, text):
        ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=7)
        c = ws.cell(row=row, column=2, value=text)
        c.font = Font(bold=True, color="FFFFFF", size=10.5)
        c.fill = _fill(NAVY_SOFT)
        c.alignment = Alignment(vertical="center", indent=1)
        ws.row_dimensions[row].height = 18

    r = 6
    header(r, "PROJECT DETAILS"); r += 1
    for label, key in (
        ("Project", "project_name"), ("Client", "client_name"),
        ("Location", "project_location"), ("Consultant / Contractor", "contractor_name"),
        ("Drawing No.", "drawing_number"), ("Building Type", "building_type"),
        ("Total Floor Area", "total_floor_area"), ("Date of Issue", "date_of_issue"),
    ):
        kv(r, label, extracted.get(key)); r += 1

    r += 1
    header(r, "TENDER STATUS"); r += 1
    kv(r, "Currency", "AED (UAE Dirham) — rates exclusive of VAT"); r += 1
    kv(r, "VAT Rate", "5%"); r += 1
    status = ("APPROVED — pushed to RealSoft" if approved else "DRAFT — for pricing / review")
    kv(r, "BOQ Status", status); r += 1
    if approved and approved_by:
        when = str(approved_at or "")[:16].replace("T", " ")
        kv(r, "Approved By", f"{approved_by}{(' on ' + when) if when else ''}"); r += 1
    kv(r, "Generated", generated_at); r += 1

    r += 1
    header(r, "LIST OF BILLS"); r += 1
    head = ["Bill", "Description", "Sheet"]
    for j, h in enumerate(head):
        col = 2 if j == 0 else (3 if j == 1 else 7)
        if j == 1:
            ws.merge_cells(start_row=r, start_column=3, end_row=r, end_column=6)
        c = ws.cell(row=r, column=col, value=h)
        c.font = Font(bold=True, color=NAVY, size=9.5)
        c.fill = _fill(ZEBRA)
        c.border = BORDER
    # fill the merged description header border
    for col in range(2, 8):
        ws.cell(row=r, column=col).border = BORDER
    r += 1
    for i, sec in enumerate(sections, 1):
        ws.cell(row=r, column=2, value=i).alignment = Alignment(horizontal="center")
        ws.merge_cells(start_row=r, start_column=3, end_row=r, end_column=6)
        ws.cell(row=r, column=3, value=sec).alignment = Alignment(wrap_text=True, vertical="center")
        ws.cell(row=r, column=7, value=f"Bill {i}").alignment = Alignment(horizontal="center")
        for col in range(2, 8):
            cell = ws.cell(row=r, column=col)
            cell.border = BORDER
            cell.font = Font(size=10)
            if i % 2 == 0:
                cell.fill = _fill(ZEBRA)
        r += 1

    r += 1
    note = ("Note: rate columns are intentionally blank — enter unit rates on each Bill "
            "sheet and Amounts, Bill totals and the Grand Total compute automatically. "
            "Quantities are taken off the approved drawing; verify before pricing.")
    ws.merge_cells(start_row=r, start_column=2, end_row=r + 1, end_column=7)
    nc = ws.cell(row=r, column=2, value=note)
    nc.font = Font(italic=True, color=GREY_TEXT, size=9)
    nc.alignment = Alignment(wrap_text=True, vertical="top")

    ws.page_setup.orientation = "portrait"
    ws.page_setup.fitToWidth = 1
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)


# ── one Bill sheet per trade section ────────────────────────────────────────
def _build_bill_sheet(wb, used: set, bill_no: int, section: str,
                      items: list[dict], extracted: dict, meta: dict):
    """Returns (sheet_title, total_cell_ref) for the Summary to reference."""
    title = _sheet_title(f"Bill {bill_no} -", section, used)
    ws = wb.create_sheet(title)
    for i, (_, w) in enumerate(COLS, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    _title_band(ws, 1, f"BILL No. {bill_no} — {section.upper()}")
    _subtle_band(ws, 2, _project_line(extracted, meta))

    header_row = 3
    for i, (name, _) in enumerate(COLS, 1):
        c = ws.cell(row=header_row, column=i, value=name)
        c.font = Font(bold=True, color="FFFFFF", size=9.5)
        c.fill = _fill(NAVY_SOFT)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BORDER
    ws.row_dimensions[header_row].height = 28

    reference = extracted.get("drawing_number") or "—"
    first_item = header_row + 1
    row = first_item
    for k, it in enumerate(items, 1):
        qty = _num(it.get("quantity"))
        cells = [
            (1, f"{bill_no}.{k}", "center"),
            (2, _val(it.get("description")), "left"),
            (3, it.get("reference") or reference, "left"),
            (4, _val(it.get("unit")), "center"),
            (5, qty if qty is not None else _val(it.get("quantity")), "center"),
            (6, None, "right"),                       # Rate — estimator enters
            (7, f"=IFERROR(E{row}*F{row},\"\")", "right"),  # Amount — live
        ]
        for col, value, align in cells:
            c = ws.cell(row=row, column=col, value=value)
            c.border = BORDER
            c.alignment = Alignment(
                horizontal=align, vertical="top",
                wrap_text=(col in (2, 3)))
            c.font = Font(size=10)
            if col == 5 and qty is not None:
                c.number_format = QTY_FMT
            if col in (6, 7):
                c.number_format = CURRENCY_FMT
            if col == 6:
                c.fill = _fill(RATE_FILL)
            elif k % 2 == 0:
                c.fill = _fill(ZEBRA)
        ws.row_dimensions[row].height = 30
        row += 1

    last_item = row - 1
    if last_item < first_item:                        # empty section guard
        ws.cell(row=first_item, column=2, value="No line items in this section.")
        last_item = first_item
        row = first_item + 1

    # Bill total — carried to Summary.
    total_row = row + 1
    ws.merge_cells(start_row=total_row, start_column=1, end_row=total_row, end_column=6)
    lab = ws.cell(row=total_row, column=1,
                  value=f"BILL {bill_no} — TOTAL CARRIED TO SUMMARY (excl. VAT)")
    lab.font = Font(bold=True, color="FFFFFF", size=10)
    lab.fill = _fill(NAVY)
    lab.alignment = Alignment(horizontal="right", vertical="center", indent=1)
    tot = ws.cell(row=total_row, column=7, value=f"=SUM(G{first_item}:G{last_item})")
    tot.font = Font(bold=True, color="FFFFFF", size=10)
    tot.fill = _fill(NAVY)
    tot.number_format = CURRENCY_FMT
    tot.border = BORDER
    for col in range(1, N_COLS + 1):
        ws.cell(row=total_row, column=col).border = BORDER
    ws.row_dimensions[total_row].height = 20

    ws.auto_filter.ref = f"A{header_row}:{LAST_COL}{last_item}"
    ws.freeze_panes = f"A{first_item}"
    _print_setup(ws, header_row)
    return title, f"$G${total_row}"


# ── Summary of Bills ────────────────────────────────────────────────────────
def _build_summary(wb, bill_refs: list[tuple], extracted: dict, meta: dict):
    ws = wb.create_sheet("Summary of Bills")
    widths = [8, 52, 14, 18, 8]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    last = 5
    LASTC = get_column_letter(last)

    def band(row, text, fill=NAVY, size=14, height=24, color="FFFFFF"):
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=last)
        c = ws.cell(row=row, column=1, value=text)
        c.font = Font(bold=True, color=color, size=size)
        c.fill = _fill(fill)
        c.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        ws.row_dimensions[row].height = height

    band(1, "BILL OF QUANTITIES — SUMMARY OF BILLS")
    band(2, _project_line(extracted, meta), fill=ORANGE, size=10, height=16, color="1A2744")

    hr = 4
    for i, h in enumerate(["Bill", "Description", "Sheet", "Bill Total (AED)", ""], 1):
        c = ws.cell(row=hr, column=i, value=h)
        c.font = Font(bold=True, color="FFFFFF", size=10)
        c.fill = _fill(NAVY_SOFT)
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.border = BORDER
    ws.row_dimensions[hr].height = 20

    row = hr + 1
    first = row
    for n, (sheet_title, ref, desc) in enumerate(bill_refs, 1):
        ws.cell(row=row, column=1, value=n).alignment = Alignment(horizontal="center")
        ws.cell(row=row, column=2, value=desc).alignment = Alignment(wrap_text=True, vertical="center")
        ws.cell(row=row, column=3, value=f"Bill {n}").alignment = Alignment(horizontal="center")
        amt = ws.cell(row=row, column=4, value=f"='{sheet_title}'!{ref}")
        amt.number_format = CURRENCY_FMT
        amt.alignment = Alignment(horizontal="right")
        for col in range(1, last + 1):
            cell = ws.cell(row=row, column=col)
            cell.border = BORDER
            cell.font = cell.font.copy(size=10) if cell.value is not None else Font(size=10)
            if n % 2 == 0:
                cell.fill = _fill(ZEBRA)
        ws.row_dimensions[row].height = 18
        row += 1
    last_bill = row - 1

    def totline(label, formula, *, bold=False, fill=None, color=None, big=False):
        nonlocal row
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=3)
        lc = ws.cell(row=row, column=1, value=label)
        lc.font = Font(bold=True, color=(color or NAVY), size=(11 if big else 10))
        lc.alignment = Alignment(horizontal="right", vertical="center", indent=1)
        vc = ws.cell(row=row, column=4, value=formula)
        vc.number_format = CURRENCY_FMT
        vc.font = Font(bold=bold or big, color=(color or "000000"), size=(11 if big else 10))
        vc.alignment = Alignment(horizontal="right")
        for col in range(1, last + 1):
            cell = ws.cell(row=row, column=col)
            cell.border = BORDER
            if fill:
                cell.fill = _fill(fill)
        ws.row_dimensions[row].height = 19 if not big else 24
        this = row
        row += 1
        return this

    sub = totline("SUB-TOTAL OF BILLS (excl. VAT)",
                  f"=SUM(D{first}:D{last_bill})", bold=True, fill=ZEBRA)
    cont = totline("Contingency (10%)", f"=D{sub}*0.1")
    excl = totline("TOTAL — Excluding VAT", f"=D{sub}+D{cont}", bold=True, fill=ZEBRA)
    vat = totline("VAT (5%) — UAE Federal Tax Authority", f"=D{excl}*0.05")
    totline("GRAND TOTAL — Including VAT", f"=D{excl}+D{vat}",
            big=True, fill=ORANGE, color="1A2744")

    # Form of tender.
    row += 1
    band(row, "FORM OF TENDER", fill=NAVY_SOFT, size=11, height=20); row += 1
    for line in (
        "We, the undersigned, having examined the drawings, specifications and this "
        "bill of quantities, offer to execute the works for the Grand Total stated above.",
        "Validity period: 90 days from tender submission.",
        "Defects Liability Period: 12 months from handover.",
        "Signature & Stamp: ____________________________     Date: ______________",
    ):
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=last)
        c = ws.cell(row=row, column=1, value=line)
        c.font = Font(size=9.5, color="334155")
        c.alignment = Alignment(wrap_text=True, vertical="center", indent=1)
        ws.row_dimensions[row].height = 26
        row += 1

    ws.freeze_panes = f"A{first}"
    ws.print_title_rows = f"1:{hr}"
    ws.page_setup.orientation = "portrait"
    ws.page_setup.fitToWidth = 1
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.sheet_view.showGridLines = False


# ── public entry points ─────────────────────────────────────────────────────
def build_boq_workbook(report_data: dict, *, approved: bool = False,
                       approved_by: str | None = None,
                       approved_at: str | None = None) -> bytes:
    """Build the industry-format BOQ workbook for one drawing. Returns .xlsx bytes."""
    extracted = dict(report_data.get("extracted") or {})
    meta = report_data.get("drawing_meta") or {}
    items = _boq_items(extracted)
    sections = _sections(items) or ["General"]
    generated_at = datetime.datetime.now().strftime("%d %b %Y, %H:%M")

    wb = openpyxl.Workbook()
    wb.remove(wb.active)  # drop the default empty sheet

    _build_cover(wb, extracted, meta, sections, approved=approved,
                 approved_by=approved_by, approved_at=approved_at,
                 generated_at=generated_at)

    used: set[str] = {"cover"}
    bill_refs: list[tuple] = []
    for i, sec in enumerate(sections, 1):
        sec_items = [it for it in items
                     if ((it.get("section") or "General").strip() or "General") == sec]
        title, ref = _build_bill_sheet(wb, used, i, sec, sec_items, extracted, meta)
        bill_refs.append((title, ref, sec))

    _build_summary(wb, bill_refs, extracted, meta)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()


def build_project_workbook(drawings: list[dict]) -> bytes:
    """Combined workbook across many drawings: an Overview sheet + one consolidated,
    filterable line-item sheet (Drawing / Section / Item / Description / Unit / Qty /
    Rate / Amount) so a whole portfolio can be priced in one place."""
    generated_at = datetime.datetime.now().strftime("%d %b %Y, %H:%M")
    wb = openpyxl.Workbook()

    ov = wb.active
    ov.title = "Overview"
    ov.sheet_view.showGridLines = False
    for i, w in enumerate((8, 22, 40, 22, 14, 12), 1):
        ov.column_dimensions[get_column_letter(i)].width = w
    ov.merge_cells("A1:F1")
    t = ov.cell(row=1, column=1, value="ERP RealSoft — PROJECT BILL OF QUANTITIES")
    t.font = Font(color="FFFFFF", bold=True, size=16)
    t.fill = _fill(NAVY)
    t.alignment = Alignment(vertical="center", indent=1)
    ov.row_dimensions[1].height = 24
    ov.merge_cells("A2:F2")
    ov.cell(row=2, column=2)
    sub = ov.cell(row=2, column=1,
                  value=f"{len(drawings)} drawing(s)  |  generated {generated_at}")
    sub.font = Font(italic=True, color=GREY_TEXT, size=9.5)
    sub.alignment = Alignment(vertical="center", indent=1)

    hr = 4
    for i, h in enumerate(["ID", "Drawing No.", "Title", "Project", "Floor", "BOQ Lines"], 1):
        c = ov.cell(row=hr, column=i, value=h)
        c.font = Font(bold=True, color="FFFFFF", size=10)
        c.fill = _fill(NAVY_SOFT)
        c.alignment = Alignment(horizontal="center")
        c.border = BORDER

    # Consolidated line items.
    cons = wb.create_sheet("Consolidated BOQ")
    cons.sheet_view.showGridLines = False
    cons_cols = [("Drawing", 16), ("Section", 22), ("Item", 8), ("Description", 56),
                 ("Reference", 16), ("Unit", 9), ("Qty", 10), ("Rate\n(AED)", 13),
                 ("Amount\n(AED)", 15)]
    for i, (_, w) in enumerate(cons_cols, 1):
        cons.column_dimensions[get_column_letter(i)].width = w
    cons.merge_cells(f"A1:{get_column_letter(len(cons_cols))}1")
    ct = cons.cell(row=1, column=1, value="CONSOLIDATED BILL OF QUANTITIES — ALL DRAWINGS")
    ct.font = Font(color="FFFFFF", bold=True, size=13)
    ct.fill = _fill(NAVY)
    ct.alignment = Alignment(vertical="center", indent=1)
    cons.row_dimensions[1].height = 22
    chr_ = 2
    for i, (name, _) in enumerate(cons_cols, 1):
        c = cons.cell(row=chr_, column=i, value=name)
        c.font = Font(bold=True, color="FFFFFF", size=9.5)
        c.fill = _fill(NAVY_SOFT)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BORDER
    cons.row_dimensions[chr_].height = 26

    crow = chr_ + 1
    orow = hr + 1
    z = 0
    for d in drawings:
        extracted = dict(d.get("extracted") or {})
        items = _boq_items(extracted)
        drawing_label = extracted.get("drawing_number") or d.get("file_name") or f"#{d.get('id')}"
        reference = extracted.get("drawing_number") or "—"
        # overview row
        for col, value in (
            (1, d.get("id")), (2, _val(extracted.get("drawing_number"))),
            (3, _val(extracted.get("drawing_title"))),
            (4, _val(extracted.get("project_name"))),
            (5, _val(d.get("floor_category"))), (6, len(items)),
        ):
            c = ov.cell(row=orow, column=col, value=value)
            c.border = BORDER
            c.font = Font(size=10)
            c.alignment = Alignment(wrap_text=(col in (3, 4)), vertical="center",
                                    horizontal=("center" if col in (1, 5, 6) else "left"))
            if z % 2 == 0:
                c.fill = _fill(ZEBRA)
        orow += 1
        z += 1
        # consolidated lines
        for k, it in enumerate(items, 1):
            qty = _num(it.get("quantity"))
            vals = [
                drawing_label, (it.get("section") or "General"), k,
                _val(it.get("description")), it.get("reference") or reference,
                _val(it.get("unit")),
                qty if qty is not None else _val(it.get("quantity")),
                None, f"=IFERROR(G{crow}*H{crow},\"\")",
            ]
            for col, value in enumerate(vals, 1):
                c = cons.cell(row=crow, column=col, value=value)
                c.border = BORDER
                c.font = Font(size=10)
                c.alignment = Alignment(
                    horizontal=("left" if col in (1, 2, 4, 5) else
                                ("right" if col in (8, 9) else "center")),
                    vertical="top", wrap_text=(col in (2, 4, 5)))
                if col == 7 and qty is not None:
                    c.number_format = QTY_FMT
                if col in (8, 9):
                    c.number_format = CURRENCY_FMT
                if col == 8:
                    c.fill = _fill(RATE_FILL)
            cons.row_dimensions[crow].height = 28
            crow += 1

    last_line = crow - 1
    if last_line >= chr_ + 1:
        gt_row = crow + 1
        cons.merge_cells(start_row=gt_row, start_column=1, end_row=gt_row, end_column=8)
        lab = cons.cell(row=gt_row, column=1, value="GRAND TOTAL — ALL DRAWINGS (excl. VAT)")
        lab.font = Font(bold=True, color="1A2744", size=11)
        lab.fill = _fill(ORANGE)
        lab.alignment = Alignment(horizontal="right", vertical="center", indent=1)
        gt = cons.cell(row=gt_row, column=9, value=f"=SUM(I{chr_ + 1}:I{last_line})")
        gt.font = Font(bold=True, color="1A2744", size=11)
        gt.fill = _fill(ORANGE)
        gt.number_format = CURRENCY_FMT
        cons.auto_filter.ref = f"A{chr_}:{get_column_letter(len(cons_cols))}{last_line}"
        cons.freeze_panes = f"A{chr_ + 1}"
    _print_setup(cons, chr_)

    ov.freeze_panes = f"A{hr + 1}"
    ov.page_setup.orientation = "landscape"
    ov.page_setup.fitToWidth = 1
    ov.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()
