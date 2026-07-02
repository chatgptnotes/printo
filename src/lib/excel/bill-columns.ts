// Resolve a bill sheet's column layout from its header row (row 3) so the
// pricing / AVL / drawing-ref / provenance post-processors work regardless of
// how many columns a bill uses. Most bills are the standard 8-column grid
// (Item | Description | Reference | Unit | Qty | Rate | Amount | Origin); Bill 5
// inserts a "Cable Size" column after Item, shifting everything else by one.
// Falls back to the standard layout when no headers are found.

export interface BillColumnMap {
  item: number;
  size: number; // 0 when the sheet has no dedicated Cable Size column
  desc: number;
  ref: number;
  unit: number;
  qty: number;
  rate: number;
  amount: number;
  origin: number;
}

export function billColumns(ws: any): BillColumnMap {
  const idx: BillColumnMap = { item: 1, size: 0, desc: 2, ref: 3, unit: 4, qty: 5, rate: 6, amount: 7, origin: 8 };
  const hdr = ws.getRow(3);
  for (let c = 1; c <= 9; c++) {
    const v = String(hdr.getCell(c).value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!v) continue;
    if (/cable size/.test(v)) idx.size = c;
    else if (/^item/.test(v)) idx.item = c;
    else if (/^description/.test(v)) idx.desc = c;
    else if (/^reference/.test(v)) idx.ref = c;
    else if (/^unit/.test(v)) idx.unit = c;
    else if (/^qty/.test(v)) idx.qty = c;
    else if (/^rate/.test(v)) idx.rate = c;
    else if (/^amount/.test(v)) idx.amount = c;
    else if (/origin|brand/.test(v)) idx.origin = c;
  }
  return idx;
}
