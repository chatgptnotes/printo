import ExcelJS from 'exceljs';
import { Project, Service, Estimation, Attachment, ServiceType } from '@/lib/shared/types';
import { SERVICE_LABELS } from '@/lib/shared/constants';

// ─── Company Letterhead ──────────────────────────────────────────────────────
// Defensive: if an env var is missing OR set to a placeholder string, use the
// hardcoded default. This prevents misconfigured Vercel env vars from leaking
// "100XXXXXXXXXXXXX" into the BOQ document.
function envOrDefault(envKey: string, fallback: string): string {
  const v = process.env[envKey]?.trim();
  if (!v) return fallback;
  // Reject obvious placeholder values
  if (/^(1?00X+|XXX+|TODO|TBD|placeholder)$/i.test(v)) return fallback;
  return v;
}

const SABI = {
  name: 'ERP Realsoft',
  fullName: envOrDefault('SABI_FULL_NAME', 'ERP Realsoft'),
  address: envOrDefault('SABI_ADDRESS', 'Dubai, United Arab Emirates'),
  phone: envOrDefault('SABI_PHONE', '+971 4 XXX XXXX'),
  email: envOrDefault('SABI_EMAIL', 'info@realsoft.example'),
  website: envOrDefault('SABI_WEBSITE', 'realsoft.example'),
  trn: envOrDefault('SABI_TRN', '100XXXXXXXXXXXXX'),
};

// ─── Sheet names — short forms to avoid Excel's 31-char sheet name limit ────
// Excel truncates names >31 chars, leaving us with "BMS (Building Management System"
// missing the closing parenthesis. We use these shortened forms instead.
export const SHORT_SERVICE_LABELS: Record<ServiceType, string> = {
  hvac: 'HVAC',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  fire_fighting: 'Fire Fighting',
  fire_alarm: 'Fire Alarm',
  bms: 'BMS',
  lpg: 'LPG',
  drainage: 'Drainage',
};

// ─── Standard MEP cost breakdowns ────────────────────────────────────────────
// When a service has only a total amount but no detailed line_items, we expand
// it into industry-standard component breakdowns. Each tuple is
// [description, unit, percentageOfTotal] where percentages sum to 1.0.
export const COMPONENT_TEMPLATES: Record<ServiceType, Array<[string, string, number]>> = {
  hvac: [
    ['Indoor Units (FCU / Cassette / Ducted Split)', 'set',  0.30],
    ['Outdoor Units (Condenser / VRF Outdoor)',      'set',  0.18],
    ['Refrigerant Piping & Insulation',              'lot',  0.10],
    ['Ductwork (Supply, Return, Fresh Air)',         'lot',  0.18],
    ['Air Terminals (Diffusers, Grilles, Dampers)',  'lot',  0.07],
    ['Thermal Insulation',                            'lot',  0.05],
    ['Controls & BMS Integration',                   'lot',  0.07],
    ['Testing, Commissioning & Handover',            'lot',  0.05],
  ],
  electrical: [
    ['Main Distribution Board (MDB) & Switchgear',   'set',  0.15],
    ['Sub-Distribution Boards (SMDB / DBs)',         'set',  0.12],
    ['Power Wiring & Outlets',                       'lot',  0.20],
    ['Lighting Fixtures (Internal + External)',      'lot',  0.18],
    ['Cable Tray, Trunking & Conduits',              'lot',  0.10],
    ['Earthing & Lightning Protection',              'lot',  0.05],
    ['Emergency Lighting & Exit Signs',              'lot',  0.05],
    ['UPS / Standby Power Provisions',               'lot',  0.05],
    ['Testing, Commissioning & DEWA Approval',       'lot',  0.10],
  ],
  plumbing: [
    ['Cold Water Distribution Network',              'lot',  0.25],
    ['Hot Water Distribution Network',               'lot',  0.18],
    ['Domestic Water Tanks',                         'no',   0.10],
    ['Booster Pump Set with Controls',               'set',  0.12],
    ['Sanitary Fixtures (WC, Basin, Sink, Shower)',  'lot',  0.20],
    ['Water Softener / Filtration Unit',             'set',  0.05],
    ['Valves, Fittings & Accessories',               'lot',  0.05],
    ['Testing, Sterilization & Commissioning',       'lot',  0.05],
  ],
  drainage: [
    ['Soil & Waste Pipes (uPVC / HDPE)',             'lot',  0.35],
    ['Vent Pipework',                                 'lot',  0.15],
    ['Floor Drains & Trap Gullies',                  'lot',  0.15],
    ['Manholes, Inspection Chambers',                'no',   0.15],
    ['Pipe Supports, Fixtures & Insulation',         'lot',  0.10],
    ['Testing & Commissioning',                       'lot',  0.10],
  ],
  fire_fighting: [
    ['Sprinkler System (Heads, Pipes, Fittings)',    'lot',  0.40],
    ['Fire Pump Set (Electric + Diesel + Jockey)',   'set',  0.20],
    ['Fire Hose Reels & Cabinets',                   'no',   0.12],
    ['Portable Fire Extinguishers (CO2, Foam, DCP)', 'no',   0.08],
    ['Fire Hydrants & Landing Valves',               'no',   0.08],
    ['Testing, Commissioning & Civil Defence Approval', 'lot', 0.12],
  ],
  fire_alarm: [
    ['Addressable Fire Alarm Panel',                 'set',  0.20],
    ['Smoke Detectors',                              'no',   0.30],
    ['Heat Detectors',                               'no',   0.10],
    ['Manual Call Points & Sounders',                'no',   0.15],
    ['Cabling & Containment',                        'lot',  0.15],
    ['Testing, Commissioning & Civil Defence Approval', 'lot', 0.10],
  ],
  bms: [
    ['Direct Digital Controllers (DDC)',             'no',   0.30],
    ['Field Sensors (Temp, Humidity, CO2, Occupancy)', 'no', 0.20],
    ['BMS Software & Graphics',                      'lot',  0.20],
    ['Integration with HVAC, Lighting, Fire',        'lot',  0.15],
    ['Wiring, Cabling & Containment',                'lot',  0.10],
    ['Testing, Commissioning & Training',            'lot',  0.05],
  ],
  lpg: [
    ['LPG Storage Tank',                             'no',   0.35],
    ['Distribution Piping & Manifold',               'lot',  0.30],
    ['Pressure Regulators & Safety Valves',          'set',  0.15],
    ['Gas Detection System',                         'set',  0.10],
    ['Testing, Commissioning & Civil Defence Approval', 'lot', 0.10],
  ],
};

/**
 * Turn extracted HVAC/Electrical load data into concrete component counts.
 * Currently drives HVAC indoor/outdoor unit counts from `ac_unit_kw` and
 * `tonnage`. Everything else falls back to qty=1 of the template unit,
 * preserving the old behaviour for disciplines where we don't yet have
 * quantitative extraction.
 *
 * Rules of thumb used (UAE residential):
 *   - 1 FCU / indoor unit per 5 kW of ac_unit_kw load
 *   - 1 outdoor condenser per 8 TR (typical VRF module)
 *   - 1 FAHU per 30 kW of fahu_kw (typical unit size)
 */
function deriveQuantity(
  service: Service,
  description: string,
  unit: string
): { quantity: number; unit: string } {
  if (service.service_type === 'hvac') {
    const desc = description.toLowerCase();
    if (desc.startsWith('indoor units') && service.ac_unit_kw && service.ac_unit_kw > 0) {
      return { quantity: Math.ceil(service.ac_unit_kw / 5), unit: 'no' };
    }
    if (desc.startsWith('outdoor units') && service.tonnage && service.tonnage > 0) {
      return { quantity: Math.ceil(service.tonnage / 8), unit: 'no' };
    }
  }
  return { quantity: 1, unit };
}

/**
 * Render the floors field as a clean string. Drops the "(0 basement + 0
 * typical)" breakdown when the extractor couldn't split the floor count
 * (previously emitted "22 (0 basement + 0 typical)" which reads like
 * bad data).
 */
export function formatFloorsBreakdown(project: { floors?: number | null; parking_floors?: number | null; typical_floors?: number | null }): string {
  if (!project.floors) return 'N/A';
  const parts: string[] = [];
  if (project.parking_floors && project.parking_floors > 0) parts.push(`${project.parking_floors} basement`);
  if (project.typical_floors && project.typical_floors > 0) parts.push(`${project.typical_floors} typical`);
  if (parts.length === 0) return `${project.floors} floors`;
  return `${project.floors} (${parts.join(' + ')})`;
}

/**
 * Derive a company name from a sender email address when the extractor
 * couldn't find one in the body. `ahmad@alfarabi-contracting.ae` → `Al
 * Farabi Contracting`. Used as a last-resort fallback so the Cover /
 * Quotation / Cover Letter never ship with a literal "Client Name"
 * placeholder in the TO: block.
 */
export function inferClientNameFromEmail(emailFrom: string | null | undefined): string | null {
  if (!emailFrom) return null;
  // Extract domain from address — tolerates "Name <addr@host>" and "addr@host".
  const match = emailFrom.match(/<?[^<@\s]+@([a-z0-9.-]+)>?/i);
  if (!match) return null;
  const host = match[1].toLowerCase();
  // Strip TLD(s). Treats .co.ae / .com.uk as two segments.
  const parts = host.split('.');
  const tldPublicSuffixes = new Set(['com', 'net', 'org', 'io', 'co', 'ae', 'uk', 'sa', 'qa', 'om', 'kw', 'bh']);
  while (parts.length > 1 && tldPublicSuffixes.has(parts[parts.length - 1])) {
    parts.pop();
  }
  const name = parts[parts.length - 1];
  if (!name || /^(gmail|outlook|hotmail|yahoo|icloud|protonmail|mail)$/.test(name)) {
    // Personal inbox domains carry no company signal.
    return null;
  }
  // Split on hyphen/underscore, title-case each token.
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map(tok => tok.charAt(0).toUpperCase() + tok.slice(1))
    .join(' ');
}

// Title-case helper for system_type that arrives lowercase from the AI
function titleCaseSystemType(s: string | null | undefined): string {
  if (!s) return '-';
  return s
    .split(/\s+/)
    .map(word => {
      // Preserve all-uppercase abbreviations
      if (/^(HVAC|VRF|BMS|MEP|AHU|FCU|FAHU|MDB|SMDB|DEWA|LPG|TR|KW|UPS|ELV|CO2|DCP)$/i.test(word)) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Expand a single service total into realistic component-level line items
 * using industry-standard MEP cost percentages. Returns an empty array if
 * the service already has detailed line items (in which case we use those).
 */
export function expandServiceToLineItems(service: Service): Array<{
  description: string;
  quantity: number;
  unit: string;
  unit_rate_aed: number;
  total_aed: number;
  category: string;
  price_source?: 'library' | 'ai';
}> {
  // If the AI extraction already has detailed line items, use those
  const existingItems = (service as any).ai_extraction?.line_items;
  if (Array.isArray(existingItems) && existingItems.length > 0) {
    return existingItems;
  }

  const total = service.total_aed || 0;
  if (total <= 0) return [];

  const template = COMPONENT_TEMPLATES[service.service_type];
  if (!template) {
    // Unknown service type — single line item fallback
    return [{
      description: SERVICE_LABELS[service.service_type] || service.service_type,
      quantity: 1,
      unit: 'lot',
      unit_rate_aed: total,
      total_aed: total,
      category: 'General',
    }];
  }

  const items = template.map(([description, unit, pct]) => {
    const lineTotal = Math.round(total * pct);
    const derived = deriveQuantity(service, description, unit);
    const quantity = derived.quantity;
    const finalUnit = derived.unit;
    // unit_rate_aed is the per-unit price; when quantity > 1 we spread the
    // line total across those units so Qty × Rate still equals the line total.
    const unit_rate_aed = quantity > 0 ? Math.round(lineTotal / quantity) : lineTotal;
    return {
      description,
      quantity,
      unit: finalUnit,
      unit_rate_aed,
      total_aed: lineTotal,
      category: SHORT_SERVICE_LABELS[service.service_type] || service.service_type,
    };
  });

  // Adjust last item to absorb any rounding difference so totals match exactly
  const computedSum = items.reduce((s, i) => s + i.total_aed, 0);
  const diff = total - computedSum;
  if (diff !== 0 && items.length > 0) {
    items[items.length - 1].unit_rate_aed += diff;
    items[items.length - 1].total_aed += diff;
  }

  return items;
}

const VAT_RATE = 0.05; // UAE Federal Tax Authority — 5% VAT
const QUOTE_VALIDITY_DAYS = 30;

// ─── Theme colors ────────────────────────────────────────────────────────────
const COLOR = {
  primary: 'FF1E3A5F',     // navy
  primaryLight: 'FFE8EEF5',
  accent: 'FF1B7A50',      // green (within range)
  warning: 'FFB45309',     // amber (above market)
  rowAlt: 'FFF7F9FC',
  border: 'FFCBD5E1',
};

// ─── Public entry point ──────────────────────────────────────────────────────
export async function generateBOQ(
  project: Project,
  services: Service[],
  estimation: Estimation,
  attachments?: Attachment[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = SABI.fullName;
  (workbook as ExcelJS.Workbook & { company?: string; title?: string }).company = SABI.fullName;
  workbook.created = new Date();
  (workbook as ExcelJS.Workbook & { company?: string; title?: string }).title = `BOQ - ${project.project_name || 'Project'}`;

  const requiredServices = services.filter(s => s.is_required);
  const issueDate = new Date();
  const quoteNo = generateQuoteNumber(project.id, issueDate);

  // Helper: build a sheet inside try/catch so one bad sheet doesn't crash the
  // whole BOQ. On error, we leave whatever was built before the failure intact
  // and append error rows to the same sheet (no remove/re-add — that previously
  // caused secondary failures when the worksheet name was still reserved).
  const safelyBuildSheet = (
    name: string,
    options: Partial<ExcelJS.AddWorksheetOptions> | undefined,
    builder: (sheet: ExcelJS.Worksheet) => void
  ) => {
    let sheet: ExcelJS.Worksheet;
    try {
      sheet = workbook.addWorksheet(name, options as any);
    } catch (err: any) {
      console.error(`BOQ failed to create worksheet "${name}":`, err.message);
      return;
    }
    try {
      builder(sheet);
    } catch (err: any) {
      console.error(`BOQ sheet "${name}" failed to build:`, err.message, err.stack);
      try {
        sheet.addRow([]);
        sheet.addRow([`⚠ Error building "${name}" sheet`]);
        sheet.addRow([err.message || String(err)]);
      } catch { /* sheet may be in unrecoverable state — give up on this sheet */ }
    }
  };

  // Sheet 1: Cover (one-page executive summary — print-ready)
  safelyBuildSheet('Cover', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
  }, s => addCoverSheet(s, project, requiredServices, estimation, quoteNo, issueDate));

  // Sheet 2: Cover Letter (email-ready)
  safelyBuildSheet('Cover Letter', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, margins: { left: 0.7, right: 0.7, top: 0.7, bottom: 0.7, header: 0.3, footer: 0.3 } },
  }, s => addCoverLetterSheet(s, project, requiredServices, estimation, quoteNo, issueDate));

  // Sheet 3: Quotation summary (letterhead, totals, signatures)
  safelyBuildSheet('Quotation', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
  }, s => addQuotationSheet(s, project, requiredServices, estimation, quoteNo, issueDate));

  // Sheet 4..N: per-service detailed BOQ
  // Use SHORT_SERVICE_LABELS for the tab name (Excel limit: 31 chars) so e.g.
  // "BMS (Building Management System)" doesn't get truncated to a broken
  // unclosed parenthesis.
  for (const service of requiredServices) {
    const shortLabel = SHORT_SERVICE_LABELS[service.service_type] || service.service_type;
    safelyBuildSheet(shortLabel.substring(0, 31), {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
    }, s => addServiceSheet(s, project, service));
  }

  // Sheet N+1: Floor Breakdown (HVAC) — only if HVAC has duct route data
  const hvacService = requiredServices.find(s => s.service_type === 'hvac');
  const ductRoutes = hvacService?.ai_extraction && (hvacService.ai_extraction as any).duct_routes;
  if (ductRoutes && Array.isArray((ductRoutes as any).floors) && (ductRoutes as any).floors.length > 0) {
    safelyBuildSheet('Floor Breakdown', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
    }, s => addFloorBreakdownSheet(s, project, ductRoutes as any));
  }

  // Sheet N+2: Drawing References (source drawings used for the estimate)
  if (attachments && attachments.length > 0) {
    safelyBuildSheet('Drawing References', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
    }, s => addDrawingReferencesSheet(s, attachments));
  }

  // Sheet N+3: Terms & Conditions
  safelyBuildSheet('Terms & Conditions', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
  }, s => addTermsSheet(s));

  // Sheet N+4: Assumptions & Exclusions
  safelyBuildSheet('Assumptions & Exclusions', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
  }, s => addExclusionsSheet(s));

  // Sheet N+5: Revision History
  safelyBuildSheet('Revision History', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
  }, s => addRevisionHistorySheet(s, quoteNo, issueDate));

  // Note: sheet.protect() was removed — it returns a Promise that conflicted
  // with the synchronous loop and caused BOQ generation to crash on certain
  // worksheets. The trade-off is that formula cells are now editable, but
  // since the BOQ is delivered to clients (not modified by them), this is fine.

  try {
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  } catch (err: any) {
    console.error('BOQ writeBuffer failed, falling back to minimal BOQ:', err.message);
    return generateMinimalBOQ(project, requiredServices, estimation);
  }
}

/**
 * Minimal single-sheet BOQ — guaranteed-to-work fallback when the full BOQ
 * generator fails. Contains just the essentials: project info, services table,
 * totals with VAT. No fancy formatting, no merged cells, no headers/footers.
 */
async function generateMinimalBOQ(
  project: Project,
  services: Service[],
  estimation: Estimation
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = SABI.fullName;
  wb.created = new Date();

  const sheet = wb.addWorksheet('BOQ');
  sheet.columns = [
    { width: 5 }, { width: 35 }, { width: 18 }, { width: 14 }, { width: 18 },
  ];

  sheet.addRow([SABI.fullName]);
  sheet.addRow([SABI.address]);
  sheet.addRow([`Tel: ${SABI.phone}  •  ${SABI.email}`]);
  sheet.addRow([`TRN: ${SABI.trn}`]);
  sheet.addRow([]);

  sheet.addRow(['QUOTATION — BILL OF QUANTITIES']);
  sheet.addRow([]);

  sheet.addRow(['Quote No', generateQuoteNumber(project.id, new Date())]);
  sheet.addRow(['Issue Date', formatDate(new Date())]);
  sheet.addRow(['Project', project.project_name || 'Project']);
  sheet.addRow(['Client', project.client_name || 'Client']);
  sheet.addRow(['Location', project.location || '-']);
  sheet.addRow(['Total Area', project.total_area_sqft ? `${project.total_area_sqft.toLocaleString()} sqft` : '-']);
  sheet.addRow(['Floors', project.floors || '-']);
  sheet.addRow([]);

  sheet.addRow(['#', 'MEP Service', 'System Type', 'Quantity', 'Amount (AED)']);
  let idx = 1;
  let subtotal = 0;
  for (const svc of services) {
    const amount = svc.total_aed || 0;
    subtotal += amount;
    sheet.addRow([
      idx++,
      SERVICE_LABELS[svc.service_type] || svc.service_type,
      svc.system_type || '-',
      svc.tonnage ? `${svc.tonnage} TR` : (svc.quantity ? `${svc.quantity}` : '-'),
      amount,
    ]);
  }
  sheet.addRow([]);

  const marginPct = estimation.margin_percent || 15;
  const marginAmt = subtotal * marginPct / 100;
  const net = subtotal + marginAmt;
  const vat = net * VAT_RATE;
  const grand = net + vat;

  sheet.addRow(['', 'Subtotal', '', '', subtotal]);
  sheet.addRow(['', `Margin (${marginPct}%)`, '', '', marginAmt]);
  sheet.addRow(['', 'Net Amount', '', '', net]);
  sheet.addRow(['', `VAT (${(VAT_RATE * 100).toFixed(0)}%)`, '', '', vat]);
  sheet.addRow(['', 'GRAND TOTAL (AED)', '', '', grand]);
  sheet.addRow([]);
  sheet.addRow(['', 'Amount in Words:', '', '', `AED ${numberToWords(grand)} Only`]);
  sheet.addRow([]);
  sheet.addRow(['', 'All amounts in UAE Dirhams (AED) — Inclusive of 5% VAT']);
  sheet.addRow([]);
  sheet.addRow(['', 'Generated by ERP Realsoft — minimal fallback mode (full BOQ failed to render)']);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ─── Sheet: Quotation summary ────────────────────────────────────────────────
function addQuotationSheet(
  sheet: ExcelJS.Worksheet,
  project: Project,
  services: Service[],
  estimation: Estimation,
  quoteNo: string,
  issueDate: Date
) {
  // Column widths — 6 columns for layout flexibility
  sheet.columns = [
    { width: 5 },   // A: numbering
    { width: 35 },  // B: description / labels
    { width: 15 },  // C: qty / system type
    { width: 18 },  // D: tonnage / unit
    { width: 18 },  // E: amount AED
    { width: 22 },  // F: notes / rate source
  ];

  // ─── 1. Letterhead (rows 1-4) ──────────────────────────────────────────────
  const r1 = sheet.addRow([SABI.name]);
  r1.font = { bold: true, size: 28, color: { argb: COLOR.primary } };
  r1.alignment = { horizontal: 'center' };
  sheet.mergeCells('A1:F1');
  sheet.getRow(1).height = 36;

  const r2 = sheet.addRow([SABI.fullName]);
  r2.font = { bold: true, size: 11, color: { argb: COLOR.primary } };
  r2.alignment = { horizontal: 'center' };
  sheet.mergeCells('A2:F2');

  const r3 = sheet.addRow([`${SABI.address}  •  Tel: ${SABI.phone}  •  Email: ${SABI.email}`]);
  r3.font = { size: 9, color: { argb: 'FF555555' } };
  r3.alignment = { horizontal: 'center' };
  sheet.mergeCells('A3:F3');

  const r4 = sheet.addRow([`TRN: ${SABI.trn}  •  ${SABI.website}`]);
  r4.font = { size: 9, color: { argb: 'FF555555' } };
  r4.alignment = { horizontal: 'center' };
  sheet.mergeCells('A4:F4');

  // Horizontal divider
  sheet.addRow([]);
  const dividerRow = sheet.rowCount;
  for (let c = 1; c <= 6; c++) {
    sheet.getCell(dividerRow, c).border = { bottom: { style: 'medium', color: { argb: COLOR.primary } } };
  }
  sheet.addRow([]);

  // ─── 2. Document title (row 7) ─────────────────────────────────────────────
  const titleRow = sheet.addRow(['QUOTATION — BILL OF QUANTITIES']);
  titleRow.font = { bold: true, size: 16, color: { argb: COLOR.primary } };
  titleRow.alignment = { horizontal: 'center' };
  sheet.mergeCells(`A${titleRow.number}:F${titleRow.number}`);
  sheet.addRow([]);

  // ─── 3. Quote metadata (Quote No, Date, Validity, Rev) ─────────────────────
  const validUntil = new Date(issueDate);
  validUntil.setDate(validUntil.getDate() + QUOTE_VALIDITY_DAYS);

  const meta1 = sheet.addRow([
    'Quote No:', quoteNo, '', 'Issue Date:', formatDate(issueDate), '',
  ]);
  styleMetaRow(meta1);

  const meta2 = sheet.addRow([
    'Revision:', 'Rev 0', '', 'Valid Until:', formatDate(validUntil), '',
  ]);
  styleMetaRow(meta2);
  sheet.addRow([]);

  // ─── 4. Client block ────────────────────────────────────────────────────────
  const toLabel = sheet.addRow(['TO:']);
  toLabel.font = { bold: true, size: 10, color: { argb: COLOR.primary } };

  const resolvedClient = project.client_name || inferClientNameFromEmail(project.email_from) || 'Client Name';
  const clientRow = sheet.addRow(['', resolvedClient]);
  clientRow.getCell(2).font = { bold: true, size: 11 };

  if (project.email_from) {
    const attnRow = sheet.addRow(['', `Attn: ${project.email_from}`]);
    attnRow.getCell(2).font = { size: 10, color: { argb: 'FF555555' } };
  }
  if (project.location) {
    const locRow = sheet.addRow(['', project.location]);
    locRow.getCell(2).font = { size: 10, color: { argb: 'FF555555' } };
  }
  sheet.addRow([]);

  // ─── 5. Project details ─────────────────────────────────────────────────────
  const projHeader = sheet.addRow(['PROJECT DETAILS']);
  styleSectionHeader(projHeader, sheet);
  sheet.mergeCells(`A${projHeader.number}:F${projHeader.number}`);

  addLabelValue(sheet, 'Project Name', project.project_name || 'N/A');
  addLabelValue(sheet, 'Building Type', titleCase(project.building_type) || 'N/A');
  addLabelValue(sheet, 'Location', project.location || 'N/A');
  addLabelValue(sheet, 'Total Built-Up Area', project.total_area_sqft ? `${project.total_area_sqft.toLocaleString()} sqft` : 'N/A');
  addLabelValue(sheet, 'Number of Floors', formatFloorsBreakdown(project));
  addLabelValue(sheet, 'Typical Floor Height', project.typical_height_m ? `${project.typical_height_m} m` : 'N/A');
  if (project.email_subject) {
    addLabelValue(sheet, 'RFQ Reference', project.email_subject);
  }
  if (project.deadline) {
    addLabelValue(sheet, 'Tender Deadline', formatDate(new Date(project.deadline)));
  }
  sheet.addRow([]);

  // ─── 6. Services & pricing table ────────────────────────────────────────────
  const svcHeader = sheet.addRow(['SERVICES & PRICING']);
  styleSectionHeader(svcHeader, sheet);
  sheet.mergeCells(`A${svcHeader.number}:F${svcHeader.number}`);

  const colHeader = sheet.addRow(['#', 'MEP Service', 'System Type', 'Quantity', 'Amount (AED)', 'Rate Basis']);
  styleTableHeader(colHeader);

  const svcStartRow = sheet.rowCount + 1;
  let idx = 1;
  for (const svc of services) {
    const rateSource = (svc as any).rate_source as string | undefined;
    const qty = svc.tonnage
      ? `${svc.tonnage.toLocaleString()} TR`
      : (svc.quantity ? svc.quantity.toLocaleString() : '-');
    const row = sheet.addRow([
      idx++,
      SERVICE_LABELS[svc.service_type] || svc.service_type,
      titleCaseSystemType(svc.system_type), // "VRF System" not "vrf system"
      qty,
      svc.total_aed || 0,
      rateSource || 'ERP Realsoft rate database',
    ]);
    row.getCell(5).numFmt = '"AED" #,##0.00';
    row.alignment = { vertical: 'middle' };
    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(4).alignment = { horizontal: 'right' };
    row.getCell(5).alignment = { horizontal: 'right' };
    row.getCell(6).font = { size: 9, color: { argb: 'FF666666' } };
    if (idx % 2 === 0) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.rowAlt } };
      });
    }
    row.eachCell(cell => {
      cell.border = boxBorder();
    });
  }
  const svcEndRow = sheet.rowCount;
  sheet.addRow([]);

  // ─── 7. Totals block (Subtotal → Margin → Discount → VAT → Grand Total) ────
  const subtotalRowNum = sheet.rowCount + 1;
  const subtotalRow = sheet.addRow([
    '', 'Subtotal', '', '', { formula: `SUM(E${svcStartRow}:E${svcEndRow})` }, '',
  ]);
  styleTotalRow(subtotalRow);

  const marginPct = estimation.margin_percent || 15;
  const marginRowNum = sheet.rowCount + 1;
  const marginRow = sheet.addRow([
    '', `Margin (${marginPct}%)`, '', '', { formula: `E${subtotalRowNum}*${marginPct}/100` }, '',
  ]);
  styleTotalRow(marginRow);

  // Optional discount line — defaults to 0, client/estimator can edit
  const discountRowNum = sheet.rowCount + 1;
  const discountRow = sheet.addRow([
    '', 'Discount', '', '', 0, '(editable — enter discount amount in AED)',
  ]);
  styleTotalRow(discountRow);
  discountRow.getCell(6).font = { size: 8, italic: true, color: { argb: 'FF999999' } };

  const netRowNum = sheet.rowCount + 1;
  const netRow = sheet.addRow([
    '', 'Net Amount', '', '', { formula: `E${subtotalRowNum}+E${marginRowNum}-E${discountRowNum}` }, '',
  ]);
  styleTotalRow(netRow);

  const vatRowNum = sheet.rowCount + 1;
  const vatRow = sheet.addRow([
    '', `VAT (${(VAT_RATE * 100).toFixed(0)}%)`, '', '', { formula: `E${netRowNum}*${VAT_RATE}` }, 'UAE Federal Tax Authority',
  ]);
  styleTotalRow(vatRow);
  vatRow.getCell(6).font = { size: 8, italic: true, color: { argb: 'FF999999' } };

  const grandRowNum = sheet.rowCount + 1;
  const grandTotalRow = sheet.addRow([
    '', 'GRAND TOTAL (AED)', '', '', { formula: `E${netRowNum}+E${vatRowNum}` }, '',
  ]);
  grandTotalRow.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  grandTotalRow.height = 28;
  for (let c = 1; c <= 6; c++) {
    const cell = grandTotalRow.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.primary } };
    cell.alignment = { vertical: 'middle' };
    cell.border = boxBorder();
  }
  grandTotalRow.getCell(5).numFmt = '"AED" #,##0.00';
  grandTotalRow.getCell(5).alignment = { horizontal: 'right', vertical: 'middle' };

  // ─── 8. Amount in words ────────────────────────────────────────────────────
  // Computed at generation time (not formula) using current estimation values.
  // The Excel formula for grand total reflects edits, but the words line is locked.
  const computedSubtotal = services.reduce((sum, s) => sum + (s.total_aed || 0), 0);
  const computedNet = computedSubtotal * (1 + marginPct / 100);
  const computedGrand = computedNet * (1 + VAT_RATE);

  sheet.addRow([]);
  const wordsRow = sheet.addRow([
    '', 'Amount in Words:', '', '', '', '',
  ]);
  wordsRow.getCell(2).font = { bold: true, size: 10 };
  const wordsValueRow = sheet.addRow([
    '', `AED ${numberToWords(computedGrand)} Only`, '', '', '', '',
  ]);
  wordsValueRow.getCell(2).font = { italic: true, size: 10, color: { argb: COLOR.primary } };
  sheet.mergeCells(`B${wordsValueRow.number}:F${wordsValueRow.number}`);
  wordsValueRow.getCell(2).alignment = { wrapText: true };
  wordsValueRow.height = 20;
  sheet.addRow([]);

  // Currency note
  const currencyNote = sheet.addRow(['', 'All amounts in UAE Dirhams (AED) — Inclusive of 5% VAT.']);
  currencyNote.getCell(2).font = { italic: true, size: 9, color: { argb: 'FF666666' } };
  sheet.mergeCells(`B${currencyNote.number}:F${currencyNote.number}`);
  sheet.addRow([]);

  // ─── 9. Yardstick comparison (if available) ────────────────────────────────
  if (estimation.yardstick_status) {
    const ysHeader = sheet.addRow(['YARDSTICK COMPARISON']);
    styleSectionHeader(ysHeader, sheet);
    sheet.mergeCells(`A${ysHeader.number}:F${ysHeader.number}`);

    const status = estimation.yardstick_status.replace(/_/g, ' ').toUpperCase();
    const statusColor = estimation.yardstick_status === 'within_range' ? COLOR.accent : COLOR.warning;

    addLabelValue(sheet, 'Market Status', status, statusColor);
    if (estimation.yardstick_min_aed && estimation.yardstick_max_aed) {
      addLabelValue(
        sheet,
        'Market Range (AED)',
        `${estimation.yardstick_min_aed.toLocaleString()} – ${estimation.yardstick_max_aed.toLocaleString()}`
      );
    }
    sheet.addRow([]);
  }

  // ─── 10. Signature blocks ──────────────────────────────────────────────────
  sheet.addRow([]);
  sheet.addRow([]);
  const sigHeader = sheet.addRow(['', 'Prepared By:', '', '', 'Approved By:', '']);
  sigHeader.font = { bold: true, size: 10, color: { argb: COLOR.primary } };

  sheet.addRow(['', '_________________________', '', '', '_________________________', '']);
  sheet.addRow(['', 'Estimation Department', '', '', 'George Varkey M', '']);
  sheet.addRow(['', 'ERP Realsoft Team', '', '', 'Company Owner', '']);
  sheet.addRow(['', `Date: ${formatDate(issueDate)}`, '', '', 'Date: ___________', '']);

  // ─── 11. Footer ────────────────────────────────────────────────────────────
  sheet.addRow([]);
  sheet.addRow([]);
  const footer = sheet.addRow([
    '', 'Generated by ERP Realsoft — automated MEP estimation pipeline | realsoft.example',
  ]);
  footer.font = { italic: true, size: 8, color: { argb: 'FF999999' } };
  footer.alignment = { horizontal: 'center' };
  sheet.mergeCells(`A${footer.number}:F${footer.number}`);

  // Page setup: header & footer
  sheet.headerFooter.oddHeader = `&L&"Calibri,Bold"&12${SABI.name}&R&"Calibri,Italic"&9Quote: ${quoteNo}`;
  sheet.headerFooter.oddFooter = `&L&9${SABI.fullName}&C&9Page &P of &N&R&9${formatDate(issueDate)}`;
}

// ─── Sheet 2..N: per-service detailed sheet ──────────────────────────────────
function addServiceSheet(
  sheet: ExcelJS.Worksheet,
  project: Project,
  service: Service
) {
  const label = SERVICE_LABELS[service.service_type] || service.service_type;
  const rateSource = (service as any).rate_source as string | undefined;

  sheet.columns = [
    { width: 6 },   // #
    { width: 45 },  // Description
    { width: 12 },  // Qty
    { width: 10 },  // Unit
    { width: 16 },  // Unit Rate
    { width: 18 },  // Total
    { width: 35 },  // Notes / Rate Source
  ];

  // Header bar with SABI brand
  const r1 = sheet.addRow([SABI.name + ' — ' + label.toUpperCase()]);
  r1.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  r1.alignment = { horizontal: 'center', vertical: 'middle' };
  r1.height = 26;
  sheet.mergeCells('A1:G1');
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.primary } };

  const r2 = sheet.addRow(['Project:', project.project_name || 'N/A', '', '', 'Client:', project.client_name || 'N/A', '']);
  r2.font = { size: 10 };
  r2.getCell(1).font = { bold: true };
  r2.getCell(5).font = { bold: true };
  sheet.addRow([]);

  // Column header
  const header = sheet.addRow(['#', 'Description', 'Qty', 'Unit', 'Unit Rate (AED)', 'Total (AED)', 'Source', 'Notes / Rate Source']);
  styleTableHeader(header);

  // Get line items: prefer detailed AI-extracted items, fall back to
  // industry-standard component breakdown derived from the service total.
  // This is what makes the BOQ look like a real MEP quotation instead of
  // a single "X System (Component-based)" generic row.
  const lineItems = expandServiceToLineItems(service);

  const dataRows: number[] = [];
  let rowAlt = false;

  if (lineItems.length > 0) {
    lineItems.forEach((item, idx) => {
      const rowNum = sheet.rowCount + 1;
      const sourceLabel = item.price_source === 'library' ? 'Library Match' : 'AI Estimated';
      const row = sheet.addRow([
        idx + 1,
        item.description,
        item.quantity,
        item.unit,
        item.unit_rate_aed,
        { formula: `C${rowNum}*E${rowNum}` },
        sourceLabel,
        rateSource || 'ERP Realsoft rate database (Q1 2026)',
      ]);
      dataRows.push(rowNum);
      row.getCell(3).numFmt = '#,##0';
      row.getCell(5).numFmt = '"AED" #,##0.00';
      row.getCell(6).numFmt = '"AED" #,##0.00';
      row.getCell(1).alignment = { horizontal: 'center' };
      row.getCell(3).alignment = { horizontal: 'right' };
      row.getCell(4).alignment = { horizontal: 'center' };
      row.getCell(5).alignment = { horizontal: 'right' };
      row.getCell(6).alignment = { horizontal: 'right' };
      row.getCell(7).alignment = { horizontal: 'center' };
      row.getCell(7).font = { size: 9, color: { argb: item.price_source === 'library' ? 'FF16A34A' : 'FF7C3AED' } };
      row.getCell(8).font = { size: 9, color: { argb: 'FF666666' } };
      row.getCell(8).alignment = { wrapText: true };
      row.alignment = { vertical: 'middle' };
      if (rowAlt) {
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.rowAlt } };
        });
      }
      row.eachCell(cell => { cell.border = boxBorder(); });
      rowAlt = !rowAlt;
    });
  } else {
    // Truly nothing to show — single placeholder line
    const rowNum = sheet.rowCount + 1;
    const row = sheet.addRow([
      1,
      `${label} — ${titleCaseSystemType(service.system_type) || 'Standard'}`,
      1,
      'lot',
      service.total_aed || 0,
      { formula: `C${rowNum}*E${rowNum}` },
      service.notes || rateSource || 'ERP Realsoft rate database',
    ]);
    dataRows.push(rowNum);
    row.getCell(3).numFmt = '#,##0';
    row.getCell(5).numFmt = '"AED" #,##0.00';
    row.getCell(6).numFmt = '"AED" #,##0.00';
    row.getCell(7).font = { size: 9, color: { argb: 'FF666666' } };
    row.getCell(7).alignment = { wrapText: true };
    row.eachCell(cell => { cell.border = boxBorder(); });
  }

  sheet.addRow([]);
  const sumFormula = dataRows.length > 0 ? `SUM(${dataRows.map(r => `F${r}`).join(',')})` : '0';
  const totalRow = sheet.addRow(['', `${label.toUpperCase()} TOTAL`, '', '', '', { formula: sumFormula }, '']);
  totalRow.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
  totalRow.height = 22;
  for (let c = 1; c <= 7; c++) {
    totalRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.primary } };
    totalRow.getCell(c).border = boxBorder();
    totalRow.getCell(c).alignment = { vertical: 'middle' };
  }
  totalRow.getCell(6).numFmt = '"AED" #,##0.00';
  totalRow.getCell(6).alignment = { horizontal: 'right', vertical: 'middle' };

  // Page setup
  sheet.headerFooter.oddHeader = `&L&"Calibri,Bold"&12${SABI.name}&C&"Calibri,Bold"&12${label}&R&9${project.project_name || ''}`;
  sheet.headerFooter.oddFooter = `&L&9${SABI.fullName}&C&9Page &P of &N`;
}

// ─── Terms & Conditions sheet ─────────────────────────────────────────────────
function addTermsSheet(sheet: ExcelJS.Worksheet) {
  sheet.columns = [{ width: 5 }, { width: 25 }, { width: 75 }];

  const title = sheet.addRow(['', 'TERMS & CONDITIONS']);
  title.font = { bold: true, size: 16, color: { argb: COLOR.primary } };
  sheet.mergeCells(`B1:C1`);
  sheet.addRow([]);

  const terms: Array<[string, string]> = [
    ['Validity', `This quotation is valid for ${QUOTE_VALIDITY_DAYS} days from the issue date. Prices may be revised thereafter.`],
    ['Payment Terms', '50% advance with purchase order. 40% on progress milestones. 10% retention released against handover certificate.'],
    ['Currency', 'All prices are quoted in UAE Dirhams (AED).'],
    ['VAT', '5% VAT is applicable as per UAE Federal Tax Authority regulations and is included in the Grand Total.'],
    ['Delivery Period', 'As per agreed project schedule, subject to material availability and authority approvals. Lead times for imported equipment: 8–12 weeks typical.'],
    ['Warranty', '12 months from the date of handover, against manufacturing defects. Excludes wear-and-tear, misuse, and acts of God.'],
    ['Variations', 'Any variation to scope, quantity, or specification will be quoted separately and require written client approval before execution.'],
    ['Insurance', 'Public Liability Insurance and Contractor\'s All Risk (CAR) Insurance are included for the duration of the works.'],
    ['Force Majeure', 'Neither party shall be liable for delays or failures arising from circumstances beyond reasonable control (natural disasters, government action, pandemics, etc.).'],
    ['Disputes', 'Any disputes shall be resolved amicably; failing which, subject to the exclusive jurisdiction of the courts of Dubai, United Arab Emirates.'],
    ['Authority Approvals', 'Statutory approvals (DEWA, Civil Defence, Municipality) are the responsibility of the main contractor unless explicitly included in the scope.'],
    ['Site Access', 'Site shall be available for execution during normal working hours (08:00–18:00, Sunday to Thursday). After-hours work subject to additional charges.'],
  ];

  let i = 1;
  for (const [label, text] of terms) {
    const row = sheet.addRow([`${i}.`, label, text]);
    row.getCell(1).alignment = { vertical: 'top', horizontal: 'right' };
    row.getCell(1).font = { bold: true, size: 10, color: { argb: COLOR.primary } };
    row.getCell(2).font = { bold: true, size: 10 };
    row.getCell(2).alignment = { vertical: 'top' };
    row.getCell(3).font = { size: 10 };
    row.getCell(3).alignment = { vertical: 'top', wrapText: true };
    row.height = 32;
    i++;
  }

  sheet.addRow([]);
  const accept = sheet.addRow(['', 'ACCEPTED BY CLIENT:', '']);
  accept.font = { bold: true, size: 11, color: { argb: COLOR.primary } };
  sheet.addRow([]);
  sheet.addRow(['', 'Name:', '________________________________________']);
  sheet.addRow(['', 'Designation:', '________________________________________']);
  sheet.addRow(['', 'Signature:', '________________________________________']);
  sheet.addRow(['', 'Date:', '________________________________________']);
  sheet.addRow(['', 'Stamp:', '']);
}

// ─── Assumptions & Exclusions sheet ───────────────────────────────────────────
function addExclusionsSheet(sheet: ExcelJS.Worksheet) {
  sheet.columns = [{ width: 5 }, { width: 95 }];

  const title = sheet.addRow(['', 'ASSUMPTIONS & EXCLUSIONS']);
  title.font = { bold: true, size: 16, color: { argb: COLOR.primary } };
  sheet.mergeCells('B1:B1');
  sheet.addRow([]);

  // Assumptions
  const assumptionsHeader = sheet.addRow(['', 'ASSUMPTIONS']);
  assumptionsHeader.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  assumptionsHeader.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.primary } };
  assumptionsHeader.height = 22;
  assumptionsHeader.alignment = { vertical: 'middle' };
  sheet.addRow([]);

  const assumptions = [
    'All MEP works to be carried out as per drawings, specifications, and equipment schedules provided with the RFQ.',
    'Site shall be ready and accessible for execution during normal working hours.',
    'Power, water, scaffolding, and temporary storage facilities shall be provided by the main contractor at no cost.',
    'Civil cutting, chasing, core-drilling, and making-good shall be carried out by the main contractor.',
    'Existing services (DEWA supply, drainage connections, etc.) are assumed to be in good working condition.',
    'Equipment specifications, makes, and models are as per the equipment schedule and approved vendor list.',
    'Standard manufacturer lead times apply for imported equipment (8–12 weeks typical).',
    'Material rates are valid as of the quotation issue date and subject to currency fluctuations beyond ±5%.',
    'False ceiling, floor finishes, and architectural penetrations are coordinated with the main contractor.',
    'Working drawings, shop drawings, and as-built drawings are included in the scope.',
  ];

  let i = 1;
  for (const item of assumptions) {
    const row = sheet.addRow([`${i}.`, item]);
    row.getCell(1).font = { bold: true, color: { argb: COLOR.primary } };
    row.getCell(1).alignment = { horizontal: 'right', vertical: 'top' };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(2).font = { size: 10 };
    row.height = 28;
    i++;
  }

  sheet.addRow([]);
  sheet.addRow([]);

  // Exclusions
  const exclusionsHeader = sheet.addRow(['', 'EXCLUSIONS']);
  exclusionsHeader.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  exclusionsHeader.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.warning } };
  exclusionsHeader.height = 22;
  exclusionsHeader.alignment = { vertical: 'middle' };
  sheet.addRow([]);

  const exclusions = [
    'Civil works, structural modifications, false ceilings, and architectural finishes.',
    'Building permits, NOC fees, DEWA connection charges, and authority approval fees.',
    'Builder\'s Work in Connection (BWIC) — cutting, chasing, making-good of structural elements.',
    'Statutory and regulatory inspection charges payable to authorities.',
    'Furniture, Fixtures, and Equipment (FF&E) and loose appliances.',
    'Extra Low Voltage (ELV) systems — CCTV, access control, audio-visual — unless specifically listed.',
    'External works, site development, and works beyond the building footprint.',
    'Testing & commissioning of third-party or owner-supplied equipment.',
    'Operation & Maintenance (O&M) contract beyond the warranty period.',
    'Spare parts beyond the manufacturer\'s standard first-fill set.',
    'Removal and disposal of existing equipment unless explicitly mentioned.',
    'Any items not explicitly listed in the BOQ or specifications.',
  ];

  i = 1;
  for (const item of exclusions) {
    const row = sheet.addRow([`${i}.`, item]);
    row.getCell(1).font = { bold: true, color: { argb: COLOR.warning } };
    row.getCell(1).alignment = { horizontal: 'right', vertical: 'top' };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(2).font = { size: 10 };
    row.height = 28;
    i++;
  }
}

// ─── Cover sheet (one-page executive summary) ────────────────────────────────
function addCoverSheet(
  sheet: ExcelJS.Worksheet,
  project: Project,
  services: Service[],
  estimation: Estimation,
  quoteNo: string,
  issueDate: Date
) {
  sheet.columns = [{ width: 5 }, { width: 30 }, { width: 30 }, { width: 30 }, { width: 5 }];

  // Top spacer
  sheet.addRow([]);

  // SABI big logo / title
  const r2 = sheet.addRow(['', SABI.name]);
  r2.font = { bold: true, size: 48, color: { argb: COLOR.primary } };
  r2.alignment = { horizontal: 'center' };
  r2.height = 60;
  sheet.mergeCells(`B${r2.number}:D${r2.number}`);

  const r3 = sheet.addRow(['', SABI.fullName]);
  r3.font = { bold: true, size: 12, color: { argb: COLOR.primary } };
  r3.alignment = { horizontal: 'center' };
  sheet.mergeCells(`B${r3.number}:D${r3.number}`);

  const r4 = sheet.addRow(['', SABI.address]);
  r4.font = { size: 10, color: { argb: 'FF666666' } };
  r4.alignment = { horizontal: 'center' };
  sheet.mergeCells(`B${r4.number}:D${r4.number}`);

  sheet.addRow([]);
  sheet.addRow([]);

  // Divider
  const dividerRow = sheet.rowCount + 1;
  sheet.addRow([]);
  for (let c = 2; c <= 4; c++) {
    sheet.getCell(dividerRow, c).border = { bottom: { style: 'medium', color: { argb: COLOR.primary } } };
  }
  sheet.addRow([]);

  // QUOTATION title
  const titleRow = sheet.addRow(['', 'QUOTATION FOR MEP WORKS']);
  titleRow.font = { bold: true, size: 22, color: { argb: COLOR.primary } };
  titleRow.alignment = { horizontal: 'center' };
  titleRow.height = 32;
  sheet.mergeCells(`B${titleRow.number}:D${titleRow.number}`);

  sheet.addRow([]);
  sheet.addRow([]);

  // Project name (large, prominent)
  const pn = sheet.addRow(['', project.project_name || 'Project']);
  pn.font = { bold: true, size: 16, color: { argb: 'FF000000' } };
  pn.alignment = { horizontal: 'center', wrapText: true };
  pn.height = 24;
  sheet.mergeCells(`B${pn.number}:D${pn.number}`);

  if (project.location) {
    const loc = sheet.addRow(['', project.location]);
    loc.font = { size: 11, italic: true, color: { argb: 'FF666666' } };
    loc.alignment = { horizontal: 'center' };
    sheet.mergeCells(`B${loc.number}:D${loc.number}`);
  }

  sheet.addRow([]);
  sheet.addRow([]);

  // Key facts box (3x2 grid)
  const totalArea = project.total_area_sqft || 0;
  const computedSubtotal = services.reduce((sum, s) => sum + (s.total_aed || 0), 0);
  const marginPct = estimation.margin_percent || 15;
  const computedNet = computedSubtotal * (1 + marginPct / 100);
  const computedGrand = computedNet * (1 + VAT_RATE);
  // UAE convention: headline cost/sqft is quoted inclusive of VAT so it
  // matches the grand-total figure directly above it.
  const costPerSqft = totalArea > 0 ? computedGrand / totalArea : 0;

  // Row: Quote No | Issue Date | Valid Until
  const validUntil = new Date(issueDate);
  validUntil.setDate(validUntil.getDate() + QUOTE_VALIDITY_DAYS);

  const factsRow1 = sheet.addRow(['', 'QUOTE NO.', 'ISSUE DATE', 'VALID UNTIL']);
  factsRow1.font = { bold: true, size: 9, color: { argb: 'FF888888' } };
  factsRow1.alignment = { horizontal: 'center' };
  for (let c = 2; c <= 4; c++) {
    factsRow1.getCell(c).border = { top: { style: 'thin', color: { argb: COLOR.border } } };
  }

  const factsRow2 = sheet.addRow(['', quoteNo, formatDate(issueDate), formatDate(validUntil)]);
  factsRow2.font = { bold: true, size: 12, color: { argb: COLOR.primary } };
  factsRow2.alignment = { horizontal: 'center' };
  factsRow2.height = 22;

  sheet.addRow([]);

  // Row: Built-Up Area | Cost per sqft | Total Floors
  const factsRow3 = sheet.addRow(['', 'BUILT-UP AREA', 'COST / SQFT (INCL. VAT)', 'TOTAL FLOORS']);
  factsRow3.font = { bold: true, size: 9, color: { argb: 'FF888888' } };
  factsRow3.alignment = { horizontal: 'center' };
  for (let c = 2; c <= 4; c++) {
    factsRow3.getCell(c).border = { top: { style: 'thin', color: { argb: COLOR.border } } };
  }

  const factsRow4 = sheet.addRow([
    '',
    totalArea ? `${totalArea.toLocaleString()} sqft` : 'N/A',
    costPerSqft > 0 ? `AED ${costPerSqft.toFixed(2)}` : 'N/A',
    project.floors ? `${project.floors} floors` : 'N/A',
  ]);
  factsRow4.font = { bold: true, size: 12, color: { argb: COLOR.primary } };
  factsRow4.alignment = { horizontal: 'center' };
  factsRow4.height = 22;

  sheet.addRow([]);
  sheet.addRow([]);

  // GRAND TOTAL — huge, centered, navy box
  const grandLabel = sheet.addRow(['', 'GRAND TOTAL (INCLUSIVE OF 5% VAT)']);
  grandLabel.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
  grandLabel.alignment = { horizontal: 'center' };
  grandLabel.height = 22;
  sheet.mergeCells(`B${grandLabel.number}:D${grandLabel.number}`);
  for (let c = 2; c <= 4; c++) {
    sheet.getCell(grandLabel.number, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.primary } };
  }

  const grandValue = sheet.addRow(['', `AED ${computedGrand.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`]);
  grandValue.font = { bold: true, size: 32, color: { argb: 'FFFFFFFF' } };
  grandValue.alignment = { horizontal: 'center', vertical: 'middle' };
  grandValue.height = 50;
  sheet.mergeCells(`B${grandValue.number}:D${grandValue.number}`);
  for (let c = 2; c <= 4; c++) {
    sheet.getCell(grandValue.number, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.primary } };
  }

  const wordsRow = sheet.addRow(['', `AED ${numberToWords(computedGrand)} Only`]);
  wordsRow.font = { italic: true, size: 10, color: { argb: 'FFFFFFFF' } };
  wordsRow.alignment = { horizontal: 'center', wrapText: true };
  wordsRow.height = 26;
  sheet.mergeCells(`B${wordsRow.number}:D${wordsRow.number}`);
  for (let c = 2; c <= 4; c++) {
    sheet.getCell(wordsRow.number, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.primary } };
  }

  sheet.addRow([]);
  sheet.addRow([]);

  // Yardstick status (color-coded)
  if (estimation.yardstick_status) {
    const status = estimation.yardstick_status.replace(/_/g, ' ').toUpperCase();
    const statusColor = estimation.yardstick_status === 'within_range' ? COLOR.accent : COLOR.warning;
    const ysRow = sheet.addRow(['', `MARKET STATUS: ${status}`]);
    ysRow.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    ysRow.alignment = { horizontal: 'center' };
    ysRow.height = 22;
    sheet.mergeCells(`B${ysRow.number}:D${ysRow.number}`);
    for (let c = 2; c <= 4; c++) {
      sheet.getCell(ysRow.number, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusColor } };
    }
    sheet.addRow([]);
  }

  sheet.addRow([]);

  // Pointer to next sheets
  const pointer = sheet.addRow(['', '→ See "Quotation" sheet for detailed services & pricing']);
  pointer.font = { italic: true, size: 10, color: { argb: 'FF666666' } };
  pointer.alignment = { horizontal: 'center' };
  sheet.mergeCells(`B${pointer.number}:D${pointer.number}`);

  const pointer2 = sheet.addRow(['', '→ See "Terms & Conditions" and "Assumptions & Exclusions" for full terms']);
  pointer2.font = { italic: true, size: 10, color: { argb: 'FF666666' } };
  pointer2.alignment = { horizontal: 'center' };
  sheet.mergeCells(`B${pointer2.number}:D${pointer2.number}`);

  // Footer
  sheet.addRow([]);
  sheet.addRow([]);
  const footer = sheet.addRow(['', `${SABI.email}  •  ${SABI.phone}  •  ${SABI.website}`]);
  footer.font = { size: 9, color: { argb: 'FF888888' } };
  footer.alignment = { horizontal: 'center' };
  sheet.mergeCells(`B${footer.number}:D${footer.number}`);

  // Page setup
  sheet.headerFooter.oddFooter = `&L&9${SABI.fullName}&C&9Quote: ${quoteNo}&R&9${formatDate(issueDate)}`;
}

// ─── Cover Letter sheet (email-ready) ─────────────────────────────────────────
function addCoverLetterSheet(
  sheet: ExcelJS.Worksheet,
  project: Project,
  services: Service[],
  estimation: Estimation,
  quoteNo: string,
  issueDate: Date
) {
  sheet.columns = [{ width: 5 }, { width: 95 }];

  // Letterhead (compact)
  const r1 = sheet.addRow(['', SABI.fullName]);
  r1.font = { bold: true, size: 14, color: { argb: COLOR.primary } };
  sheet.addRow(['', SABI.address]);
  sheet.addRow(['', `Tel: ${SABI.phone}  •  ${SABI.email}  •  ${SABI.website}`]);
  sheet.addRow(['', `TRN: ${SABI.trn}`]);
  sheet.addRow([]);
  sheet.addRow([]);

  // Date
  const dateRow = sheet.addRow(['', formatDate(issueDate)]);
  dateRow.font = { size: 11 };
  sheet.addRow([]);

  // Recipient block
  const clRecipient = project.client_name || inferClientNameFromEmail(project.email_from);
  if (clRecipient) {
    const cn = sheet.addRow(['', clRecipient]);
    cn.font = { bold: true, size: 11 };
  }
  if (project.email_from) {
    sheet.addRow(['', `Attn: ${project.email_from}`]);
  }
  if (project.location) {
    sheet.addRow(['', project.location]);
  }
  sheet.addRow([]);

  // Subject line
  const subjRow = sheet.addRow(['', `Subject: Quotation for MEP Works — ${project.project_name || 'Project'}  (Ref: ${quoteNo})`]);
  subjRow.font = { bold: true, size: 11, color: { argb: COLOR.primary } };
  subjRow.alignment = { wrapText: true };
  subjRow.height = 24;
  sheet.addRow([]);

  // Salutation
  const sal = sheet.addRow(['', 'Dear Sir/Madam,']);
  sal.font = { size: 11 };
  sheet.addRow([]);

  // Body paragraphs
  const totalArea = project.total_area_sqft;
  // Recompute from service totals so this figure always agrees with the Cover
  // and Quotation sheets. Using estimation.final_quote_aed directly leaks the
  // DB-rounded value and produces a cross-sheet mismatch (observed 0.26 AED
  // drift between Cover 4,175,130.49 and Cover Letter 4,175,130.75).
  const clMarginPct = estimation.margin_percent || 15;
  const clSubtotal = services.reduce((sum, s) => sum + (s.total_aed || 0), 0);
  const clNet = clSubtotal * (1 + clMarginPct / 100);
  const grandTotal = clNet * (1 + VAT_RATE);

  const bodyParagraphs: string[] = [
    `Thank you for the opportunity to quote for the Mechanical, Electrical, and Plumbing (MEP) works for the captioned project. We are pleased to submit our quotation for your kind review and consideration.`,
    `We have carefully reviewed the drawings and specifications provided${totalArea ? `, covering a total built-up area of ${totalArea.toLocaleString()} sqft` : ''}. Our quotation reflects competitive pricing based on current Dubai/UAE market rates and our extensive experience delivering MEP solutions for ${project.building_type ? project.building_type.toLowerCase() + ' ' : ''}projects of this scale.`,
    `The total quoted amount is AED ${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (inclusive of 5% VAT). Please refer to the attached BOQ for the detailed scope, services breakdown, terms & conditions, and assumptions & exclusions.`,
    `This quotation is valid for ${QUOTE_VALIDITY_DAYS} days from the date of issue. Our team is available to clarify any technical or commercial points and to arrange a site visit at your convenience.`,
    `We look forward to your favourable response and the opportunity to work with you on this exciting project.`,
  ];

  for (const para of bodyParagraphs) {
    const row = sheet.addRow(['', para]);
    row.font = { size: 11 };
    row.alignment = { wrapText: true, vertical: 'top' };
    row.height = 60;
    sheet.addRow([]);
  }

  // Closing
  const closing = sheet.addRow(['', 'Yours sincerely,']);
  closing.font = { size: 11 };
  sheet.addRow([]);
  sheet.addRow([]);
  sheet.addRow([]);
  const sigName = sheet.addRow(['', 'George Varkey M']);
  sigName.font = { bold: true, size: 11 };
  const sigTitle = sheet.addRow(['', 'Technical Director']);
  sigTitle.font = { size: 10, italic: true };
  sheet.addRow(['', SABI.fullName]);
  sheet.addRow([]);
  const enclosure = sheet.addRow(['', 'Enclosure: Bill of Quantities (this workbook)']);
  enclosure.font = { size: 9, italic: true, color: { argb: 'FF888888' } };

  // Page setup
  sheet.headerFooter.oddFooter = `&L&9${SABI.fullName}&C&9Cover Letter — ${quoteNo}&R&9Page &P of &N`;
}

// ─── Floor Breakdown sheet (HVAC duct routes per floor) ──────────────────────
function addFloorBreakdownSheet(
  sheet: ExcelJS.Worksheet,
  project: Project,
  ductRoutes: any
) {
  sheet.columns = [
    { width: 6 },   // #
    { width: 22 },  // Floor
    { width: 14 },  // Supply m
    { width: 14 },  // Return m
    { width: 14 },  // Exhaust m
    { width: 14 },  // Fresh Air m
    { width: 14 },  // Terminals
    { width: 14 },  // Fittings
    { width: 30 },  // Notes
  ];

  // Title bar
  const r1 = sheet.addRow([SABI.name + ' — HVAC FLOOR-BY-FLOOR BREAKDOWN']);
  r1.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  r1.alignment = { horizontal: 'center', vertical: 'middle' };
  r1.height = 26;
  sheet.mergeCells('A1:I1');
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.primary } };

  const r2 = sheet.addRow(['Project:', project.project_name || 'N/A']);
  r2.getCell(1).font = { bold: true, size: 10 };
  r2.getCell(2).font = { size: 10 };
  sheet.addRow([]);

  // Confidence/source line
  if (ductRoutes.confidence !== undefined) {
    const conf = sheet.addRow([
      'AI Confidence:', `${(ductRoutes.confidence * 100).toFixed(0)}%`,
      '', 'Floors Analyzed:', `${ductRoutes.floors?.length || 0}`,
    ]);
    conf.getCell(1).font = { bold: true, size: 9, color: { argb: 'FF666666' } };
    conf.getCell(4).font = { bold: true, size: 9, color: { argb: 'FF666666' } };
    conf.getCell(2).font = { size: 9 };
    conf.getCell(5).font = { size: 9 };
    sheet.addRow([]);
  }

  // Header
  const header = sheet.addRow(['#', 'Floor', 'Supply (m)', 'Return (m)', 'Exhaust (m)', 'Fresh Air (m)', 'Terminals', 'Fittings', 'Notes']);
  styleTableHeader(header);

  let totalSupply = 0, totalReturn = 0, totalExhaust = 0, totalFreshAir = 0, totalTerminals = 0, totalFittings = 0;

  ductRoutes.floors.forEach((floor: any, idx: number) => {
    const supply = (floor.supply_ducts || []).reduce((s: number, d: any) => s + (d.length_m || 0), 0);
    const ret = (floor.return_ducts || []).reduce((s: number, d: any) => s + (d.length_m || 0), 0);
    const exhaust = (floor.exhaust_ducts || []).reduce((s: number, d: any) => s + (d.length_m || 0), 0);
    const freshAir = (floor.fresh_air_ducts || []).reduce((s: number, d: any) => s + (d.length_m || 0), 0);
    const terminals = (floor.terminals?.supply_diffusers || 0)
      + (floor.terminals?.linear_diffusers || 0)
      + (floor.terminals?.return_grilles || 0)
      + (floor.terminals?.exhaust_grilles || 0);
    const fittings = (floor.fittings?.bends_90 || 0)
      + (floor.fittings?.bends_45 || 0)
      + (floor.fittings?.tees || 0)
      + (floor.fittings?.reducers || 0);

    totalSupply += supply;
    totalReturn += ret;
    totalExhaust += exhaust;
    totalFreshAir += freshAir;
    totalTerminals += terminals;
    totalFittings += fittings;

    const row = sheet.addRow([
      idx + 1,
      floor.floor_label || `Floor ${idx + 1}`,
      supply,
      ret,
      exhaust,
      freshAir,
      terminals,
      fittings,
      floor.notes || '',
    ]);
    row.getCell(1).alignment = { horizontal: 'center' };
    [3, 4, 5, 6, 7, 8].forEach(c => {
      row.getCell(c).numFmt = '#,##0';
      row.getCell(c).alignment = { horizontal: 'right' };
    });
    if (idx % 2 === 1) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.rowAlt } };
      });
    }
    row.eachCell(cell => { cell.border = boxBorder(); });
  });

  // Total row
  const totalRow = sheet.addRow(['', 'TOTAL', totalSupply, totalReturn, totalExhaust, totalFreshAir, totalTerminals, totalFittings, '']);
  totalRow.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
  totalRow.height = 22;
  for (let c = 1; c <= 9; c++) {
    totalRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.primary } };
    totalRow.getCell(c).border = boxBorder();
    totalRow.getCell(c).alignment = { vertical: 'middle' };
  }
  [3, 4, 5, 6, 7, 8].forEach(c => {
    totalRow.getCell(c).numFmt = '#,##0';
    totalRow.getCell(c).alignment = { horizontal: 'right', vertical: 'middle' };
  });

  // Reasoning footnote
  if (ductRoutes.reasoning) {
    sheet.addRow([]);
    const reasonHeader = sheet.addRow(['', 'AI Analysis Notes:']);
    reasonHeader.getCell(2).font = { bold: true, size: 10, color: { argb: COLOR.primary } };
    const reasonRow = sheet.addRow(['', String(ductRoutes.reasoning).substring(0, 500)]);
    reasonRow.getCell(2).font = { italic: true, size: 9, color: { argb: 'FF666666' } };
    reasonRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    reasonRow.height = 60;
    sheet.mergeCells(`B${reasonRow.number}:I${reasonRow.number}`);
  }

  sheet.headerFooter.oddHeader = `&L&"Calibri,Bold"&12${SABI.name}&C&"Calibri,Bold"&12HVAC Floor Breakdown&R&9${project.project_name || ''}`;
  sheet.headerFooter.oddFooter = `&L&9${SABI.fullName}&C&9Page &P of &N`;
}

// ─── Drawing References sheet (source attachments used) ──────────────────────
function addDrawingReferencesSheet(
  sheet: ExcelJS.Worksheet,
  attachments: Attachment[]
) {
  sheet.columns = [
    { width: 6 },   // #
    { width: 50 },  // Filename
    { width: 18 },  // File Type
    { width: 18 },  // Discipline
    { width: 14 },  // Size
    { width: 30 },  // Used For
  ];

  // Title bar
  const r1 = sheet.addRow([SABI.name + ' — DRAWING & DOCUMENT REFERENCES']);
  r1.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  r1.alignment = { horizontal: 'center', vertical: 'middle' };
  r1.height = 26;
  sheet.mergeCells('A1:F1');
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.primary } };

  const intro = sheet.addRow(['', 'The following drawings and documents were referenced during this estimation:']);
  intro.getCell(2).font = { italic: true, size: 10, color: { argb: 'FF666666' } };
  sheet.mergeCells('B2:F2');
  sheet.addRow([]);

  // Header
  const header = sheet.addRow(['#', 'Filename', 'File Type', 'Discipline', 'Size', 'Used For']);
  styleTableHeader(header);

  // Filter to relevant files (skip system/junk files)
  const relevant = attachments.filter(a =>
    a.filename && !a.filename.startsWith('.') && !a.filename.startsWith('__MACOSX')
  );

  // Sort by discipline then filename
  relevant.sort((a, b) => {
    const da = a.discipline || 'zzz';
    const db = b.discipline || 'zzz';
    if (da !== db) return da.localeCompare(db);
    return (a.filename || '').localeCompare(b.filename || '');
  });

  relevant.forEach((att, idx) => {
    const sizeKb = att.size_bytes ? (att.size_bytes / 1024).toFixed(1) + ' KB' : '-';
    const fileTypeLabel = friendlyFileType(att.file_type);
    const disciplineLabel = att.discipline ? titleCase(att.discipline.replace('_', ' ')) : '-';
    const usedFor = att.discipline
      ? `${titleCase(att.discipline.replace('_', ' '))} estimation`
      : 'General reference';

    const row = sheet.addRow([idx + 1, att.filename, fileTypeLabel, disciplineLabel, sizeKb, usedFor]);
    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(5).alignment = { horizontal: 'right' };
    row.getCell(6).font = { size: 9, color: { argb: 'FF666666' } };
    if (idx % 2 === 1) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.rowAlt } };
      });
    }
    row.eachCell(cell => { cell.border = boxBorder(); });
  });

  // Total row
  sheet.addRow([]);
  const totalRow = sheet.addRow(['', `TOTAL: ${relevant.length} files referenced`, '', '', '', '']);
  totalRow.font = { bold: true, size: 10, color: { argb: COLOR.primary } };

  sheet.headerFooter.oddHeader = `&L&"Calibri,Bold"&12${SABI.name}&C&"Calibri,Bold"&12Drawing References`;
  sheet.headerFooter.oddFooter = `&L&9${SABI.fullName}&C&9Page &P of &N`;
}

function friendlyFileType(t: string | null): string {
  if (!t) return 'Other';
  const map: Record<string, string> = {
    drawing_pdf: 'PDF Drawing',
    drawing_autocad: 'AutoCAD',
    drawing_revit: 'Revit',
    drawing_bim: 'BIM/IFC',
    schedule_excel: 'Excel Schedule',
    specification: 'Specification',
    archive_zip: 'Archive',
    image: 'Image',
    presentation: 'Presentation',
    other: 'Other',
  };
  return map[t] || t;
}

// ─── Revision History sheet ──────────────────────────────────────────────────
function addRevisionHistorySheet(
  sheet: ExcelJS.Worksheet,
  quoteNo: string,
  issueDate: Date
) {
  sheet.columns = [
    { width: 6 },   // #
    { width: 14 },  // Rev
    { width: 18 },  // Date
    { width: 22 },  // By
    { width: 60 },  // Description / Changes
  ];

  // Title
  const title = sheet.addRow(['', 'REVISION HISTORY']);
  title.font = { bold: true, size: 16, color: { argb: COLOR.primary } };
  sheet.mergeCells('B1:E1');
  sheet.addRow([]);

  // Quote info
  const info = sheet.addRow(['', 'Quote No:', quoteNo, 'Original Issue:', formatDate(issueDate)]);
  info.getCell(2).font = { bold: true, size: 10 };
  info.getCell(4).font = { bold: true, size: 10 };
  sheet.addRow([]);

  // Header
  const header = sheet.addRow(['#', 'Revision', 'Date', 'Issued By', 'Description of Changes']);
  styleTableHeader(header);

  // Rev 0 (initial)
  const revRow = sheet.addRow([1, 'Rev 0', formatDate(issueDate), 'ERP Realsoft Estimation', 'Initial issue']);
  revRow.alignment = { vertical: 'middle' };
  revRow.getCell(1).alignment = { horizontal: 'center' };
  revRow.eachCell(cell => { cell.border = boxBorder(); });
  revRow.height = 22;

  // Empty rows for future revisions
  for (let i = 2; i <= 6; i++) {
    const blank = sheet.addRow([i, '', '', '', '']);
    blank.alignment = { vertical: 'middle' };
    blank.getCell(1).alignment = { horizontal: 'center' };
    blank.eachCell(cell => {
      cell.border = boxBorder();
      cell.font = { color: { argb: 'FFCCCCCC' } };
    });
    blank.height = 22;
  }

  sheet.addRow([]);
  const note = sheet.addRow(['', 'Note: This document supersedes all previous revisions. Always reference the latest revision for execution.']);
  note.getCell(2).font = { italic: true, size: 9, color: { argb: 'FF666666' } };
  note.getCell(2).alignment = { wrapText: true };
  sheet.mergeCells(`B${note.number}:E${note.number}`);
}

// ─── Style helpers ────────────────────────────────────────────────────────────
function styleSectionHeader(row: ExcelJS.Row, sheet: ExcelJS.Worksheet) {
  row.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
  row.height = 22;
  row.alignment = { vertical: 'middle' };
  for (let c = 1; c <= 6; c++) {
    row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.primary } };
    row.getCell(c).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  }
}

function styleTableHeader(row: ExcelJS.Row) {
  row.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  row.height = 22;
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.primary } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = boxBorder();
  });
}

function styleMetaRow(row: ExcelJS.Row) {
  row.font = { size: 10 };
  row.getCell(1).font = { bold: true, size: 10, color: { argb: COLOR.primary } };
  row.getCell(4).font = { bold: true, size: 10, color: { argb: COLOR.primary } };
}

function styleTotalRow(row: ExcelJS.Row) {
  row.font = { bold: true, size: 10 };
  row.height = 20;
  row.getCell(5).numFmt = '"AED" #,##0.00';
  row.getCell(5).alignment = { horizontal: 'right', vertical: 'middle' };
  row.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };
  for (let c = 1; c <= 6; c++) {
    row.getCell(c).border = boxBorder();
    row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.primaryLight } };
  }
}

function addLabelValue(sheet: ExcelJS.Worksheet, label: string, value: string, valueColor?: string) {
  const row = sheet.addRow(['', label, '', '', value, '']);
  row.getCell(2).font = { bold: true, size: 10, color: { argb: 'FF555555' } };
  row.getCell(5).font = { size: 10, ...(valueColor && { bold: true, color: { argb: valueColor } }) };
  sheet.mergeCells(`E${row.number}:F${row.number}`);
}

function boxBorder(): Partial<ExcelJS.Borders> {
  return {
    top: { style: 'thin', color: { argb: COLOR.border } },
    bottom: { style: 'thin', color: { argb: COLOR.border } },
    left: { style: 'thin', color: { argb: COLOR.border } },
    right: { style: 'thin', color: { argb: COLOR.border } },
  };
}

// ─── Utility helpers ──────────────────────────────────────────────────────────
function generateQuoteNumber(projectId: string, date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const suffix = projectId.replace(/-/g, '').slice(-4).toUpperCase();
  return `RS-${yyyy}${mm}${dd}-${suffix}`;
}

function formatDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Convert a number to English words (international system).
 * Used for the "Amount in Words" line on UAE quotations.
 *   123456.50 → "One Hundred Twenty Three Thousand Four Hundred Fifty-Six and Fifty Fils"
 */
function numberToWords(num: number): string {
  if (num === 0) return 'Zero';
  if (num < 0) return 'Negative ' + numberToWords(-num);

  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function below1000(n: number): string {
    if (n === 0) return '';
    if (n < 10) return ones[n];
    if (n < 20) return teens[n - 10];
    if (n < 100) {
      const t = Math.floor(n / 10);
      const o = n % 10;
      return tens[t] + (o ? '-' + ones[o] : '');
    }
    const h = Math.floor(n / 100);
    const rem = n % 100;
    return ones[h] + ' Hundred' + (rem ? ' ' + below1000(rem) : '');
  }

  const integer = Math.floor(num);
  const fils = Math.round((num - integer) * 100);

  let result = '';
  const billion = Math.floor(integer / 1_000_000_000);
  const million = Math.floor((integer % 1_000_000_000) / 1_000_000);
  const thousand = Math.floor((integer % 1_000_000) / 1000);
  const remainder = integer % 1000;

  if (billion) result += below1000(billion) + ' Billion ';
  if (million) result += below1000(million) + ' Million ';
  if (thousand) result += below1000(thousand) + ' Thousand ';
  if (remainder) result += below1000(remainder);

  result = result.trim();
  if (!result) result = 'Zero';

  if (fils > 0) {
    result += ' and ' + below1000(fils) + ' Fils';
  }

  return result;
}
