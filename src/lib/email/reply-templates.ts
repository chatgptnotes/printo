// Reply templates for project emails
// Templates use {placeholders} that get replaced with project data at runtime
// Stored in sabi_settings as plain strings, editable from Settings page

export interface ProjectData {
  project_name?: string | null;
  email_subject: string;
  email_from: string;
  client_name?: string | null;
  location?: string | null;
  total_area_sqft?: number | null;
  floors?: number | null;
  typical_height_m?: number | null;
  building_type?: string | null;
  deadline?: string | null;
  services?: { service_type: string }[];
  attachments?: { id: string }[];
  estimation?: {
    final_quote_aed?: number | null;
    generated_boq_url?: string | null;
    sent_at?: string | null;
    cost_per_sqft_aed?: number | null;
    margin_percent?: number | null;
  } | null;
}

// Saveable template format (stored in DB as JSON)
export interface SavedTemplate {
  key: string;
  label: string;
  emoji: string;
  body: string; // plain text with {placeholders}
  attachBoq?: boolean;
}

// Runtime template (with resolved body)
export interface ReplyTemplate extends SavedTemplate {
  resolvedBody: string;
  resolvedSubject: string;
}

const SIG = `Best regards,
ERP Realsoft Estimation Team
info@realsoft.example`;

// Default templates — used as fallback if DB has none
export const DEFAULT_REPLY_TEMPLATES: SavedTemplate[] = [
  // ── Category 1: Initial Response ──
  {
    key: 'acknowledge',
    label: 'Acknowledge',
    emoji: '✅',
    body: `Dear {client_name},

Thank you for your enquiry regarding {project_name}.

We confirm receipt of your RFQ and {attachment_count} tender documents. Our estimation team is currently reviewing the scope and drawings.

${SIG}`,
  },
  {
    key: 'missing_info',
    label: 'Missing Info',
    emoji: '❓',
    body: `Dear {client_name},

Thank you for the tender documents for {project_name}.

To proceed with our estimation, we require the following information which appears to be missing:

1. [List missing item — e.g. equipment schedule, thermal load calculation]
2. [List missing item]
3. [List missing item]

Please note that missing information may impact the accuracy of our pricing and could result in provisional rates being applied.

Kindly provide the above at your earliest convenience so we can finalise our quotation before {deadline}.

${SIG}`,
  },

  // ── Category 2: Technical Clarification ──
  {
    key: 'missing_drawings',
    label: 'Missing Drawings',
    emoji: '📐',
    body: `Dear {client_name},

We have reviewed the tender package for {project_name} ({building_type}, {floors} floors, {area}).

The following MEP drawings appear to be missing or incomplete:

- [ ] HVAC layout / thermal load summary
- [ ] Electrical single-line diagram (SLD)
- [ ] Plumbing riser diagram
- [ ] Fire fighting sprinkler layout
- [ ] Equipment schedule

Without these drawings, we will be unable to provide an accurate detailed estimate and may need to rely on area-based (AED/sqft) pricing instead. This typically results in higher quotation values as we must include contingency allowances.

Please share the missing drawings so we can offer our most competitive price.

${SIG}`,
  },
  {
    key: 'missing_specs',
    label: 'Missing Specs',
    emoji: '📊',
    body: `Dear {client_name},

Regarding {project_name}, we note that the following specifications are not included in the tender package:

1. MEP general specifications (material grades, testing requirements)
2. HVAC equipment specifications (brand preferences, efficiency ratings)
3. Electrical specifications (cable type, switchgear rating)
4. Fire fighting system specifications (sprinkler type, pump capacity)

Without specifications, we will base our pricing on standard Dubai market materials and practices. If the consultant requires specific brands or higher-grade materials, the pricing may differ significantly.

Please confirm if specifications will be issued, or if we should proceed with standard assumptions.

${SIG}`,
  },
  {
    key: 'conflicting_data',
    label: 'Conflicting Data',
    emoji: '🔢',
    body: `Dear {client_name},

During our review of {project_name}, we identified the following discrepancies between the drawings and specifications:

1. [Drawing shows X but specification states Y]
2. [Floor area on architectural drawing differs from MEP layout]
3. [Equipment schedule tonnage does not match thermal load calculation]

These discrepancies will directly affect our pricing. Please clarify which document takes precedence, or issue revised drawings/specifications.

We recommend resolving these before we finalise our quotation to avoid variations during execution.

${SIG}`,
  },
  {
    key: 'building_details',
    label: 'Building Details',
    emoji: '🏗️',
    body: `Dear {client_name},

To proceed with our estimation for {project_name}{location}, we require confirmation of the following building details:

- Total number of floors: {floors} [please confirm]
- Area per floor: [please confirm]
- Total built-up area: {area} [please confirm]
- Typical floor-to-floor height: {typical_height} [please confirm]
- Building type/usage: {building_type} [please confirm]
- Basement levels and usage: [please confirm]

These details directly impact our HVAC sizing, electrical load calculations, and plumbing design. Incorrect building data will result in inaccurate pricing.

${SIG}`,
  },

  // ── Category 3: Scope & Pricing Impact ──
  {
    key: 'scope_confirm',
    label: 'Confirm Scope',
    emoji: '📋',
    body: `Dear {client_name},

We have reviewed the tender documents for {project_name}{location} ({building_type}, {area}).

We confirm our quotation will cover the following MEP services:

{service_list}

Submission deadline: {deadline}

Please confirm if the above scope is correct, or advise of any additions/exclusions before we proceed with our detailed estimation.

${SIG}`,
  },
  {
    key: 'value_engineering',
    label: 'Value Engineering',
    emoji: '💡',
    body: `Dear {client_name},

Further to our review of {project_name}, we would like to propose the following value engineering options that could reduce the overall MEP cost without compromising quality or performance:

1. HVAC: [e.g. Replace chiller system with VRF — saves approx. AED X]
2. Electrical: [e.g. Use standard cable tray instead of galvanised — saves approx. AED X]
3. Plumbing: [e.g. PPR piping instead of copper for hot water — saves approx. AED X]
4. Fire Fighting: [e.g. Pre-action system only where required — saves approx. AED X]

Current estimated total: {quote_amount} ({cost_per_sqft})
Estimated savings with VE: [AED X — to be filled]

These alternatives meet Dubai Municipality / Civil Defence requirements and are commonly accepted by consultants in the UAE market.

Would you like us to prepare a revised quotation incorporating these options?

${SIG}`,
  },
  {
    key: 'scope_reduction',
    label: 'Scope Reduction',
    emoji: '📉',
    body: `Dear {client_name},

Thank you for your feedback on our quotation for {project_name}.

As discussed, we have revised our scope to exclude/reduce the following:

1. [Service/item excluded or reduced]
2. [Service/item excluded or reduced]

Original quotation: {quote_amount}
Revised quotation: [AED X — to be filled]
Savings: [AED X — to be filled]

Please note the following items are NOT included in the revised scope and will be treated as variations if required during execution:
- [Excluded item 1]
- [Excluded item 2]

Please confirm your acceptance so we can issue the revised BOQ.

${SIG}`,
  },
  {
    key: 'quotation',
    label: 'Quotation',
    emoji: '💰',
    attachBoq: true,
    body: `Dear {client_name},

Thank you for the opportunity. Please find attached our quotation for {project_name} ({building_type}, {area}{location}).

Quoted Amount: {quote_amount}
Rate: {cost_per_sqft}

MEP Services Included:
{service_list}

The BOQ includes a detailed breakdown of all services, quantities, and unit rates. Our quotation is valid for 30 days from the date of this email.

Please do not hesitate to contact us should you require any clarifications.

${SIG}`,
  },

  // ── Category 4: Post-Quote Negotiation ──
  {
    key: 'followup',
    label: 'Follow Up',
    emoji: '🔄',
    body: `Dear {client_name},

We are following up on our quotation for {project_name}, submitted on {sent_date}.

Quoted amount: {quote_amount}

We would appreciate your feedback on our proposal. Should you have any queries, require scope adjustments, or wish to discuss alternative pricing options, we are happy to arrange a meeting.

Looking forward to your response.

${SIG}`,
  },
  {
    key: 'price_revision',
    label: 'Price Revision',
    emoji: '💸',
    body: `Dear {client_name},

Further to our discussion regarding {project_name}, we are pleased to offer the following revised pricing:

Previous quotation: {quote_amount}
Revised quotation: [AED X — to be filled]
Discount: [X% — to be filled]

This revised offer is based on:
- [Reason for revision — e.g. volume commitment, long-term relationship, market adjustment]

The revised pricing is valid for 15 days. All other terms and conditions remain unchanged.

Please confirm your acceptance to proceed.

${SIG}`,
  },
  {
    key: 'best_final',
    label: 'Best & Final',
    emoji: '🏆',
    body: `Dear {client_name},

Thank you for the opportunity to participate in the tender for {project_name}.

After careful review of our costs and margins, we are pleased to submit our best and final offer:

Final Amount: [AED X — to be filled]
Original Quote: {quote_amount}

This represents our most competitive pricing for the full MEP scope. We have optimised our procurement and labour costs to arrive at this figure.

This offer is valid for 7 days and is subject to:
- No changes to the original scope of work
- Standard payment terms (as per our quotation)
- Project award within the validity period

We trust this meets your expectations and look forward to working together.

${SIG}`,
  },
  {
    key: 'revised_quotation',
    label: 'Revised Quote',
    emoji: '📝',
    attachBoq: true,
    body: `Dear {client_name},

Please find attached our revised quotation for {project_name}.

Changes from previous submission:
1. [Describe scope change — e.g. added BMS scope per revised drawings]
2. [Describe scope change — e.g. updated HVAC tonnage per corrected thermal load]
3. [Describe price adjustment — e.g. reduced electrical scope as per client request]

Revised Amount: [AED X — to be filled]
Previous Amount: {quote_amount}

All changes are highlighted in the attached BOQ. Please review and confirm.

${SIG}`,
  },

  // ── Category 5: Administrative ──
  {
    key: 'site_visit',
    label: 'Site Visit',
    emoji: '🏢',
    body: `Dear {client_name},

We would like to request/confirm a site visit for {project_name}{location} to:

- Verify site conditions and access routes
- Confirm plant room locations and available space
- Review existing MEP infrastructure (if renovation)
- Discuss coordination requirements with other trades

Proposed date: [Date — to be filled]
Proposed time: [Time — to be filled]
ERP Realsoft representatives: [Names — to be filled]

Please confirm the above schedule or suggest an alternative date. Kindly arrange site access and safety induction if required.

${SIG}`,
  },
  {
    key: 'custom',
    label: 'Custom',
    emoji: '✏️',
    body: `Dear Sir/Madam,



${SIG}`,
  },
];

// Resolve placeholders in a template body using project data
export function resolveTemplate(template: SavedTemplate, p: ProjectData): ReplyTemplate {
  const projectName = p.project_name || p.email_subject || 'your project';
  const clientName = p.client_name || 'Sir/Madam';
  const quoteAmount = p.estimation?.final_quote_aed
    ? `AED ${p.estimation.final_quote_aed.toLocaleString()}`
    : 'as per attached BOQ';
  const serviceList = p.services?.length
    ? p.services.map((s, i) => `${i + 1}. ${s.service_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`).join('\n')
    : '1. HVAC\n2. Electrical\n3. Plumbing\n4. Fire Fighting';
  const area = p.total_area_sqft ? `${p.total_area_sqft.toLocaleString()} sqft` : '[area TBC]';
  const location = p.location ? `, ${p.location}` : '';
  const sentDate = p.estimation?.sent_at
    ? new Date(p.estimation.sent_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '[date]';
  const deadline = p.deadline
    ? new Date(p.deadline).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '[deadline TBC]';
  const buildingType = p.building_type
    ? p.building_type.charAt(0).toUpperCase() + p.building_type.slice(1)
    : '[building type TBC]';
  const floors = p.floors ? `${p.floors}` : '[floors TBC]';
  const typicalHeight = p.typical_height_m ? `${p.typical_height_m}m` : '[height TBC]';
  const costPerSqft = p.estimation?.cost_per_sqft_aed
    ? `AED ${p.estimation.cost_per_sqft_aed.toFixed(0)}/sqft`
    : '[rate TBC]';
  const margin = p.estimation?.margin_percent
    ? `${p.estimation.margin_percent}%`
    : '15%';
  const attachmentCount = p.attachments?.length
    ? `${p.attachments.length} file${p.attachments.length > 1 ? 's' : ''}`
    : 'tender documents';

  const resolved = template.body
    .replace(/\{project_name\}/g, projectName)
    .replace(/\{client_name\}/g, clientName)
    .replace(/\{quote_amount\}/g, quoteAmount)
    .replace(/\{service_list\}/g, serviceList)
    .replace(/\{area\}/g, area)
    .replace(/\{location\}/g, location)
    .replace(/\{sent_date\}/g, sentDate)
    .replace(/\{email_subject\}/g, p.email_subject)
    .replace(/\{email_from\}/g, p.email_from)
    .replace(/\{deadline\}/g, deadline)
    .replace(/\{building_type\}/g, buildingType)
    .replace(/\{floors\}/g, floors)
    .replace(/\{typical_height\}/g, typicalHeight)
    .replace(/\{cost_per_sqft\}/g, costPerSqft)
    .replace(/\{margin\}/g, margin)
    .replace(/\{attachment_count\}/g, attachmentCount);

  return {
    ...template,
    resolvedBody: resolved,
    resolvedSubject: `Re: ${p.email_subject}`,
  };
}

// Available placeholders for the settings UI
export const AVAILABLE_PLACEHOLDERS = [
  { key: '{project_name}', description: 'Project name or email subject' },
  { key: '{client_name}', description: 'Client name or "Sir/Madam"' },
  { key: '{quote_amount}', description: 'AED amount or "as per attached BOQ"' },
  { key: '{service_list}', description: 'Numbered list of MEP services' },
  { key: '{area}', description: 'Total area in sqft' },
  { key: '{location}', description: 'Project location' },
  { key: '{deadline}', description: 'Tender submission deadline' },
  { key: '{building_type}', description: 'Building type (office, villa, hotel, etc.)' },
  { key: '{floors}', description: 'Total number of floors' },
  { key: '{typical_height}', description: 'Typical floor height in meters' },
  { key: '{cost_per_sqft}', description: 'Cost per sqft (AED X/sqft)' },
  { key: '{margin}', description: 'Margin percentage' },
  { key: '{attachment_count}', description: 'Number of tender documents' },
  { key: '{sent_date}', description: 'Date quotation was sent' },
  { key: '{email_subject}', description: 'Original email subject' },
  { key: '{email_from}', description: 'Sender email address' },
];
