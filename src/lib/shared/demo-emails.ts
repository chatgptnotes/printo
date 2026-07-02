// Demo email store for local development without Gmail connection

export interface DemoEmail {
  threadId: string;
  messageId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  body: string;
  contentType: string;
  labels: string[];
  messageCount: number;
  attachments: {
    filename: string;
    mimeType: string;
    size: number;
    attachmentId: string;
  }[];
  images: string[]; // base64 data URLs for inline images
}

// In-memory store — persists for the duration of the dev server process
const store: DemoEmail[] = [
  {
    threadId: 'demo-001',
    messageId: 'msg-001',
    from: 'rahim.charife@ridgeengg.com',
    to: 'estimation@realsoft.example',
    subject: 'RFQ — HVAC Works for 2B+G+M+SF+R Residential & Commercial Building, Wadi Al Safa 3th, Plot 6457918',
    date: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    snippet: 'Dear ERP Realsoft Estimation Team, On behalf of our client Mohamad Madi, we invite you to submit your best price for HVAC works for the above-mentioned project...',
    body: `<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <div style="border-bottom: 3px solid #1a56db; padding-bottom: 12px; margin-bottom: 16px;">
    <p style="font-size: 11px; color: #666; margin: 0;">RIDGE ENGINEERING CONSULTANTS</p>
    <p style="font-size: 11px; color: #666; margin: 0;">Consulting Engineers · Dubai, UAE</p>
  </div>

  <p>Dear ERP Realsoft Estimation Team,</p>

  <p>On behalf of our client, we are pleased to invite you to submit your <strong>best price quotation</strong> for the <strong>HVAC works</strong> for the following project:</p>

  <table style="border-collapse: collapse; margin: 16px 0; width: 100%;">
    <tr style="background: #1a56db; color: white;"><td colspan="2" style="padding: 10px 12px; font-weight: bold; font-size: 14px;">PROJECT INFORMATION</td></tr>
    <tr style="background: #f0f4f8;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold; width: 200px;">Project</td><td style="padding: 8px 12px; border: 1px solid #ddd;">2B+G+M+SF+R Residential &amp; Commercial Building</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Plot No.</td><td style="padding: 8px 12px; border: 1px solid #ddd;">6457918</td></tr>
    <tr style="background: #f0f4f8;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Location</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Wadi Al Safa 3th, Dubai</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Client/Owner</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Mohamad Madi, Abulahad Madi, Rahim Charife</td></tr>
    <tr style="background: #f0f4f8;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Configuration</td><td style="padding: 8px 12px; border: 1px solid #ddd;">2 Basements + Ground + Mezzanine + 5 Floors + Roof</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Total Area</td><td style="padding: 8px 12px; border: 1px solid #ddd;">3,184.30 sqm (103 rooms/zones)</td></tr>
    <tr style="background: #f0f4f8;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Building Type</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Residential &amp; Commercial (Retail + Apartments)</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Consultant</td><td style="padding: 8px 12px; border: 1px solid #ddd;">RIDGE Engineering Consultants</td></tr>
    <tr style="background: #f0f4f8;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Document Status</td><td style="padding: 8px 12px; border: 1px solid #ddd;">FINAL — September 2025</td></tr>
  </table>

  <p><strong>AC SYSTEM OVERVIEW (from Thermal Load Calculation):</strong></p>
  <table style="border-collapse: collapse; margin: 16px 0; width: 100%;">
    <tr style="background: #e8f0fe;"><td style="padding: 6px 10px; border: 1px solid #ddd; font-weight: bold;">AC System Type</td><td style="padding: 6px 10px; border: 1px solid #ddd;"><strong>DX (Direct Expansion)</strong> — All zones</td></tr>
    <tr><td style="padding: 6px 10px; border: 1px solid #ddd; font-weight: bold;">Indoor Unit Types</td><td style="padding: 6px 10px; border: 1px solid #ddd;">Ducted (majority) + Decorative (select rooms)</td></tr>
    <tr style="background: #e8f0fe;"><td style="padding: 6px 10px; border: 1px solid #ddd; font-weight: bold;">Total Calculated AC Load</td><td style="padding: 6px 10px; border: 1px solid #ddd;">639.03 kW (Total Sensible + Latent)</td></tr>
    <tr><td style="padding: 6px 10px; border: 1px solid #ddd; font-weight: bold;">Total Outdoor Air</td><td style="padding: 6px 10px; border: 1px solid #ddd;">4,531 L/s</td></tr>
    <tr style="background: #e8f0fe;"><td style="padding: 6px 10px; border: 1px solid #ddd; font-weight: bold;">FAHU</td><td style="padding: 6px 10px; border: 1px solid #ddd;">Yes — DX type, serving swimming pool &amp; pump room (144.78 kW)</td></tr>
    <tr><td style="padding: 6px 10px; border: 1px solid #ddd; font-weight: bold;">Total Electric Power</td><td style="padding: 6px 10px; border: 1px solid #ddd;">Indoor: 18.29 kW / Outdoor: 272.23 kW / Total: 88.71 W/m²</td></tr>
    <tr style="background: #e8f0fe;"><td style="padding: 6px 10px; border: 1px solid #ddd; font-weight: bold;">Green Building</td><td style="padding: 6px 10px; border: 1px solid #ddd;">Al Sa'fat — Silver rating. Energy recovery required for &gt;1000 L/s outdoor air</td></tr>
  </table>

  <p><strong>FLOOR BREAKDOWN:</strong></p>
  <table style="border-collapse: collapse; margin: 16px 0; width: 100%; font-size: 12px;">
    <tr style="background: #1a56db; color: white;">
      <td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Floor</td>
      <td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Zones</td>
      <td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Key Rooms</td>
      <td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Indoor Type</td>
    </tr>
    <tr style="background: #f8f9fa;"><td style="padding: 5px 8px; border: 1px solid #ddd;">Basement (2B)</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Pump Room, Water Tanks</td><td style="padding: 5px 8px; border: 1px solid #ddd;">AC-BF-01 (Pump Room 57.20 sqm)</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Decorative</td></tr>
    <tr><td style="padding: 5px 8px; border: 1px solid #ddd;">Ground Floor</td><td style="padding: 5px 8px; border: 1px solid #ddd;">11 Retail units + Watchman + Generator + CCTV</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Retail 1-11 (44-85 sqm each), Lobby, Services</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Ducted (Retail), Decorative (Watchman, Garbage)</td></tr>
    <tr style="background: #f8f9fa;"><td style="padding: 5px 8px; border: 1px solid #ddd;">Mezzanine</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Retail extensions</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Continuation of GF retail spaces</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Ducted</td></tr>
    <tr><td style="padding: 5px 8px; border: 1px solid #ddd;">1st-4th Floors (Typical)</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Kitchen/Living, M.Bed, Bed, Corridor per floor</td><td style="padding: 5px 8px; border: 1px solid #ddd;">AC-TYP-01 to AC-TYP-OG (15 zones/floor)</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Ducted (Bed, Kitchen) + Decorative (Corridor)</td></tr>
    <tr style="background: #f8f9fa;"><td style="padding: 5px 8px; border: 1px solid #ddd;">5th Floor (SF)</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Swimming pool, gym, lobby, kids room</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Pool deck, Male/Female gym, Changing rooms</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Ducted</td></tr>
    <tr><td style="padding: 5px 8px; border: 1px solid #ddd;">Roof</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Male/Female toilet, OSM Rm, Terrace</td><td style="padding: 5px 8px; border: 1px solid #ddd;">AC-RF-01 to AC-RF-03</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Ducted</td></tr>
    <tr style="background: #fff3cd;"><td style="padding: 5px 8px; border: 1px solid #ddd; font-weight: bold;">FAHU</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Swimming Pool &amp; Pump Room</td><td style="padding: 5px 8px; border: 1px solid #ddd;">AC-RF-01 (144.78 sqm, 1.23 L/s occupancy)</td><td style="padding: 5px 8px; border: 1px solid #ddd;">DX FAHU</td></tr>
  </table>

  <p><strong>ATTACHED DRAWINGS (16 sheets):</strong></p>
  <ol style="font-size: 12px; line-height: 2;">
    <li><strong>AC 000</strong> — Green Building General Notes (Al Sa'fat compliance, DM credits, plumbing fixture rates)</li>
    <li><strong>AC 001</strong> — AC Standard Details-01 (duct connections, diffusers, fire dampers, insulation, GI ductwork)</li>
    <li><strong>AC 002</strong> — AC Standard Details-02 (condensate drain, refrigerant pipes, vibration isolators, pipe sleeves)</li>
    <li><strong>AC 005</strong> — <span style="color: #dc2626; font-weight: bold;">Summary of Thermal Load Calculation</span> (full schedule: 103 rooms, DX system, Ducted/Decorative breakdown, kW per zone, electric power)</li>
    <li><strong>AC 006</strong> — Window Glazing Schedule (fenestration U-values, shading coefficients per orientation — N/NE/E/SE/S/SW/W/NW)</li>
    <li><strong>AC 007</strong> — U-Value Section Details (wall/floor/roof thermal transmittance, Silver Al Sa'fat rating)</li>
    <li><strong>AC 100</strong> — Basement Pump Room Floor Plan — AC Layout (water tanks, pump room, sewage, valve chambers)</li>
    <li><strong>AC 101</strong> — Basement 2 Floor Plan — AC Layout (parking: 22 bays, ramps, lifts, services)</li>
    <li><strong>AC 102</strong> — Basement 1 Floor Plan — AC Layout (parking: 19 bays + preferred EV charging)</li>
    <li><strong>AC 103</strong> — Ground Floor Plan — AC Layout (11 retail units, lobby, generator room, services)</li>
    <li><strong>AC 104</strong> — Mezzanine Floor Plan — AC Layout (retail extensions, CCTV room, entrance lobby)</li>
    <li><strong>AC 105</strong> — 1st Floor Plan — AC Layout (residential: living, bedrooms, kitchen, balconies)</li>
    <li><strong>AC 106</strong> — 2nd to 4th Floor Plan — AC Layout (typical residential floors)</li>
    <li><strong>AC 107</strong> — 5th Floor Plan — AC Layout (swimming pool, gym, kids room, service areas)</li>
    <li><strong>AC 108</strong> — Roof Floor Plan — AC Layout (toilets, pool deck, BBQ area)</li>
    <li><strong>AC 109</strong> — Top Roof Floor Plan — AC Layout (outdoor condensing units, roof allocated for MEP)</li>
  </ol>

  <p><strong>SCOPE OF WORK:</strong></p>
  <ul>
    <li>Supply and installation of DX split AC system (ducted + decorative indoor units)</li>
    <li>All outdoor condensing units on top roof</li>
    <li>FAHU for swimming pool &amp; pump room areas</li>
    <li>GI ductwork, insulation (25mm closed-cell), fire dampers</li>
    <li>Refrigerant piping (copper), condensate drain piping</li>
    <li>Diffusers (square ceiling, linear slot, floor-mounted)</li>
    <li>Vibration isolators, flexible duct connections</li>
    <li>Testing, commissioning, and DM/DEWA approvals</li>
    <li>All works to comply with Dubai Municipality Green Building (Al Sa'fat Silver) requirements</li>
  </ul>

  <p><strong>Important Notes:</strong></p>
  <ul style="color: #666;">
    <li>HVAC equipment must comply with minimum energy efficiency requirements (Dubai Municipality Credit 501.01)</li>
    <li>Demand Controlled Ventilation (DCV) required — CO2 below 800 ppm (Credit 502.02)</li>
    <li>MERV 13 filters minimum for all air handling units</li>
    <li>Consultant is fully responsible for the thermal load calculation and selection</li>
  </ul>

  <p><strong>Submission Deadline:</strong> <span style="color: #dc2626; font-weight: bold;">15 April 2026</span></p>

  <p>Please find all 16 HVAC drawings attached as a single ZIP file. Kindly quote itemized rates for supply and installation.</p>

  <p>Best regards,<br/>
  <strong>Rahim Charife</strong><br/>
  Senior MEP Engineer<br/>
  RIDGE Engineering Consultants<br/>
  Dubai, UAE<br/>
  Tel: +971 4 xxx xxxx</p>
</div>`,
    contentType: 'text/html',
    labels: ['INBOX', 'UNREAD'],
    messageCount: 1,
    attachments: [
      { filename: 'RIDGE_dooc-HVAC_Plot6457918.zip', mimeType: 'application/zip', size: 52000000, attachmentId: 'att-001a' },
      { filename: 'AC005_Thermal_Load_Summary.pdf', mimeType: 'application/pdf', size: 4800000, attachmentId: 'att-001b' },
      { filename: 'AC006_Window_Glazing_Schedule.pdf', mimeType: 'application/pdf', size: 2200000, attachmentId: 'att-001c' },
      { filename: 'AC007_UValue_Section_Details.pdf', mimeType: 'application/pdf', size: 3100000, attachmentId: 'att-001d' },
    ],
    images: [],
  },
  {
    threadId: 'demo-002',
    messageId: 'msg-002',
    from: 'projects@rak-developers.ae',
    to: 'estimation@realsoft.example',
    subject: 'Tender Invitation: Marina View Residences — Plumbing & Fire Fighting',
    date: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    snippet: 'We invite ERP Realsoft to participate in the tender for plumbing and fire fighting works at Marina View Residences, Ras Al Khaimah...',
    body: `<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <p>Dear Sir/Madam,</p>

  <p>We invite <strong>ERP Realsoft</strong> to participate in the tender for plumbing and fire fighting works at our flagship project:</p>

  <h3 style="color: #1a56db;">Marina View Residences — Ras Al Khaimah</h3>

  <table style="border-collapse: collapse; margin: 16px 0; width: 100%;">
    <tr style="background: #f0f4f8;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Configuration</td><td style="padding: 8px 12px; border: 1px solid #ddd;">G + 1P + 14 Floors (3 Blocks)</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Total Area</td><td style="padding: 8px 12px; border: 1px solid #ddd;">180,000 sqft per block</td></tr>
    <tr style="background: #f0f4f8;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Units per Floor</td><td style="padding: 8px 12px; border: 1px solid #ddd;">8 apartments (1BR, 2BR, 3BR mix)</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Scope</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Plumbing + Fire Fighting only</td></tr>
  </table>

  <p><strong>Key Requirements:</strong></p>
  <ul>
    <li>Cold & hot water supply (central calorifiers)</li>
    <li>Drainage — soil, waste, and vent systems</li>
    <li>Rainwater drainage</li>
    <li>Fire fighting — wet riser, sprinklers, hose reels, fire pump room</li>
    <li>Water tanks — underground + roof level</li>
  </ul>

  <p>Drawings and BOQ template attached. Please submit by <strong>18 April 2026</strong>.</p>

  <p>Regards,<br/>
  <strong>Fatima Al Hashimi</strong><br/>
  Project Director<br/>
  RAK Developers</p>
</div>`,
    contentType: 'text/html',
    labels: ['INBOX', 'IMPORTANT'],
    messageCount: 1,
    attachments: [
      { filename: 'Marina_View_Plumbing_Drawings.pdf', mimeType: 'application/pdf', size: 18700000, attachmentId: 'att-002a' },
      { filename: 'Fire_Fighting_Layout.pdf', mimeType: 'application/pdf', size: 9500000, attachmentId: 'att-002b' },
      { filename: 'BOQ_Template_Plumbing_FF.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 245000, attachmentId: 'att-002c' },
    ],
    images: [],
  },
  {
    threadId: 'demo-005',
    messageId: 'msg-005',
    from: 'mep@khatib-alami.ae',
    to: 'estimation@realsoft.example',
    subject: 'RFQ — Complete MEP Works for Al Khail Gateway Office Tower, Al Quoz (B+G+M+12F+Roof), Chiller System',
    date: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    snippet: 'Dear ERP Realsoft Estimation, Khatib & Alami invites you to submit your competitive quotation for the complete MEP package for Al Khail Gateway...',
    body: `<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <div style="border-bottom: 3px solid #0d6939; padding-bottom: 12px; margin-bottom: 16px;">
    <p style="font-size: 13px; font-weight: bold; color: #0d6939; margin: 0;">KHATIB &amp; ALAMI</p>
    <p style="font-size: 11px; color: #666; margin: 0;">Consolidated Engineering Company · Dubai Office</p>
  </div>

  <p>Dear ERP Realsoft Estimation Team,</p>

  <p>On behalf of <strong>Al Khail Gateway Development LLC</strong>, Khatib &amp; Alami invites you to submit your competitive quotation for the <strong>complete MEP package</strong> for the following project:</p>

  <table style="border-collapse: collapse; margin: 16px 0; width: 100%;">
    <tr style="background: #0d6939; color: white;"><td colspan="2" style="padding: 10px 12px; font-weight: bold; font-size: 14px;">PROJECT INFORMATION</td></tr>
    <tr style="background: #f0f8f4;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold; width: 200px;">Project Name</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Al Khail Gateway — Grade A Office Tower</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Plot No.</td><td style="padding: 8px 12px; border: 1px solid #ddd;">DM-2024-78456</td></tr>
    <tr style="background: #f0f8f4;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Location</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Al Quoz Industrial Area 3, adjacent to Al Khail Road, Dubai</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Developer</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Al Khail Gateway Development LLC</td></tr>
    <tr style="background: #f0f8f4;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Consultant</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Khatib &amp; Alami (K&amp;A)</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Configuration</td><td style="padding: 8px 12px; border: 1px solid #ddd;">1 Basement + Ground + Mezzanine + 12 Typical Floors + Roof</td></tr>
    <tr style="background: #f0f8f4;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Gross Floor Area</td><td style="padding: 8px 12px; border: 1px solid #ddd;">22,500 sqm (242,188 sqft)</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Typical Floor Area</td><td style="padding: 8px 12px; border: 1px solid #ddd;">1,450 sqm (15,608 sqft) per floor</td></tr>
    <tr style="background: #f0f8f4;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Floor-to-Floor Height</td><td style="padding: 8px 12px; border: 1px solid #ddd;">3.6m (typical office), 4.8m (ground lobby), 3.0m (basement)</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Building Type</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Commercial — Grade A Office Space + Ground Floor Retail</td></tr>
    <tr style="background: #f0f8f4;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Green Building</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Al Sa'fat Gold — LEED Silver equivalent</td></tr>
  </table>

  <p><strong>HVAC SYSTEM SUMMARY:</strong></p>
  <table style="border-collapse: collapse; margin: 16px 0; width: 100%;">
    <tr style="background: #e8f5e9;"><td style="padding: 6px 10px; border: 1px solid #ddd; font-weight: bold;">AC System Type</td><td style="padding: 6px 10px; border: 1px solid #ddd;"><strong>Air-Cooled Chiller System</strong></td></tr>
    <tr><td style="padding: 6px 10px; border: 1px solid #ddd; font-weight: bold;">Chillers</td><td style="padding: 6px 10px; border: 1px solid #ddd;">2 × Air-cooled scroll chillers, 350 TR each (2+0, no standby)</td></tr>
    <tr style="background: #e8f5e9;"><td style="padding: 6px 10px; border: 1px solid #ddd; font-weight: bold;">Total Cooling Load</td><td style="padding: 6px 10px; border: 1px solid #ddd;">1,850 kW (526 TR) — Peak August design day</td></tr>
    <tr><td style="padding: 6px 10px; border: 1px solid #ddd; font-weight: bold;">AHU / FCU Distribution</td><td style="padding: 6px 10px; border: 1px solid #ddd;">4 × Central AHUs (lobby, retail, core) + 48 × Ceiling FCUs (typical floors, 4/floor)</td></tr>
    <tr style="background: #e8f5e9;"><td style="padding: 6px 10px; border: 1px solid #ddd; font-weight: bold;">FAHU</td><td style="padding: 6px 10px; border: 1px solid #ddd;">2 × FAHU (12,000 CFM each) with enthalpy wheel energy recovery</td></tr>
    <tr><td style="padding: 6px 10px; border: 1px solid #ddd; font-weight: bold;">Chilled Water Piping</td><td style="padding: 6px 10px; border: 1px solid #ddd;">Primary-secondary loop, variable flow, ΔT = 5.5°C</td></tr>
    <tr style="background: #e8f5e9;"><td style="padding: 6px 10px; border: 1px solid #ddd; font-weight: bold;">Indoor Unit Type</td><td style="padding: 6px 10px; border: 1px solid #ddd;">Ducted (ceiling concealed FCUs, 4-pipe)</td></tr>
    <tr><td style="padding: 6px 10px; border: 1px solid #ddd; font-weight: bold;">Condenser Location</td><td style="padding: 6px 10px; border: 1px solid #ddd;">Roof — dedicated plant room with acoustic enclosure</td></tr>
  </table>

  <p><strong>FLOOR-BY-FLOOR BREAKDOWN:</strong></p>
  <table style="border-collapse: collapse; margin: 16px 0; width: 100%; font-size: 12px;">
    <tr style="background: #0d6939; color: white;">
      <td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Floor</td>
      <td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Usage</td>
      <td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Area (sqm)</td>
      <td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Cooling Load</td>
      <td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">AC Equipment</td>
    </tr>
    <tr style="background: #f8f9fa;"><td style="padding: 5px 8px; border: 1px solid #ddd;">Basement</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Parking (180 cars), MEP rooms</td><td style="padding: 5px 8px; border: 1px solid #ddd;">2,800</td><td style="padding: 5px 8px; border: 1px solid #ddd;">—</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Jet fans for ventilation only</td></tr>
    <tr><td style="padding: 5px 8px; border: 1px solid #ddd;">Ground Floor</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Main lobby + 4 retail units</td><td style="padding: 5px 8px; border: 1px solid #ddd;">1,600</td><td style="padding: 5px 8px; border: 1px solid #ddd;">185 kW</td><td style="padding: 5px 8px; border: 1px solid #ddd;">AHU-01 (lobby), FCU × 4 (retail)</td></tr>
    <tr style="background: #f8f9fa;"><td style="padding: 5px 8px; border: 1px solid #ddd;">Mezzanine</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Lobby double-height, services</td><td style="padding: 5px 8px; border: 1px solid #ddd;">800</td><td style="padding: 5px 8px; border: 1px solid #ddd;">65 kW</td><td style="padding: 5px 8px; border: 1px solid #ddd;">AHU-02 (continuation)</td></tr>
    <tr><td style="padding: 5px 8px; border: 1px solid #ddd;">1st–12th Floor</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Open-plan office (shell &amp; core)</td><td style="padding: 5px 8px; border: 1px solid #ddd;">1,450/floor</td><td style="padding: 5px 8px; border: 1px solid #ddd;">120 kW/floor</td><td style="padding: 5px 8px; border: 1px solid #ddd;">4 × Ducted FCU per floor (4-pipe)</td></tr>
    <tr style="background: #f8f9fa;"><td style="padding: 5px 8px; border: 1px solid #ddd;">Roof</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Chiller plant, cooling towers, FAHU</td><td style="padding: 5px 8px; border: 1px solid #ddd;">1,450</td><td style="padding: 5px 8px; border: 1px solid #ddd;">—</td><td style="padding: 5px 8px; border: 1px solid #ddd;">2 × Chillers, 2 × FAHU, pumps</td></tr>
    <tr style="background: #fff3cd;"><td colspan="2" style="padding: 5px 8px; border: 1px solid #ddd; font-weight: bold;">TOTAL</td><td style="padding: 5px 8px; border: 1px solid #ddd; font-weight: bold;">22,500</td><td style="padding: 5px 8px; border: 1px solid #ddd; font-weight: bold;">1,850 kW (526 TR)</td><td style="padding: 5px 8px; border: 1px solid #ddd;"></td></tr>
  </table>

  <p><strong>COMPLETE MEP SCOPE:</strong></p>
  <table style="border-collapse: collapse; margin: 16px 0; width: 100%; font-size: 12px;">
    <tr style="background: #0d6939; color: white;">
      <td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Service</td>
      <td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Key Equipment / Scope</td>
    </tr>
    <tr style="background: #f0f8f4;"><td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">HVAC</td><td style="padding: 6px 8px; border: 1px solid #ddd;">2 × Air-cooled chillers (350 TR), 48 FCUs, 4 AHUs, 2 FAHUs (12,000 CFM each), CHW piping, ductwork, BMS integration</td></tr>
    <tr><td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Electrical</td><td style="padding: 6px 8px; border: 1px solid #ddd;">2 × 2000 kVA transformers (DEWA 11kV), MDB/SMDB/DB, busbar rising mains, LED lighting, 500 kVA generator, UPS for IT floor, lightning protection</td></tr>
    <tr style="background: #f0f8f4;"><td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Plumbing</td><td style="padding: 6px 8px; border: 1px solid #ddd;">300,000L underground tank, 2+1 booster pumps, PPR/CPVC piping, central gas water heater, grease trap, condensate recovery</td></tr>
    <tr><td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Drainage</td><td style="padding: 6px 8px; border: 1px solid #ddd;">Soil/waste/vent uPVC, rainwater drainage, sump pumps, sewage ejection pump for basement</td></tr>
    <tr style="background: #f0f8f4;"><td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Fire Fighting</td><td style="padding: 6px 8px; border: 1px solid #ddd;">Wet sprinkler (OH2 for office), 150 HP electric + diesel fire pumps, 200,000L fire tank, hose reels + landing valves, external hydrants</td></tr>
    <tr><td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Fire Alarm</td><td style="padding: 6px 8px; border: 1px solid #ddd;">Addressable loop system (Notifier/Honeywell), smoke/heat detectors, MCP, voice evacuation, fireman's intercom, stairwell pressurisation</td></tr>
    <tr style="background: #f0f8f4;"><td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">BMS</td><td style="padding: 6px 8px; border: 1px solid #ddd;">Full DDC system — chiller plant optimisation, AHU/FCU control, lighting control, energy metering, BACnet/IP backbone</td></tr>
    <tr><td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">ELV</td><td style="padding: 6px 8px; border: 1px solid #ddd;">Structured cabling (Cat 6A), CCTV (IP cameras), access control, intercom, IPTV/MATV, parking guidance</td></tr>
  </table>

  <p><strong>ATTACHED DOCUMENTS (32 sheets + specs):</strong></p>
  <ul style="font-size: 12px; line-height: 1.8; columns: 2;">
    <li>HVAC-001 to HVAC-008: AC layouts (Basement through Roof)</li>
    <li>HVAC-009: Chiller plant room layout</li>
    <li>HVAC-010: Schematic &amp; riser diagram</li>
    <li>HVAC-011: Thermal load calculation summary</li>
    <li>HVAC-012: Equipment schedule</li>
    <li>ELEC-001 to ELEC-006: Electrical layouts</li>
    <li>ELEC-007: Single line diagram</li>
    <li>ELEC-008: Lighting layout (typical)</li>
    <li>PLB-001 to PLB-004: Plumbing layouts</li>
    <li>PLB-005: Water supply schematic</li>
    <li>FF-001 to FF-004: Fire fighting layouts</li>
    <li>FA-001 to FA-002: Fire alarm layouts</li>
    <li>BMS-001: BMS schematic</li>
    <li>MEP Specifications (HVAC + Elec + Plumb + FF)</li>
    <li>BOQ template (4 sheets)</li>
  </ul>

  <p style="background: #fff3cd; padding: 12px; border-radius: 8px; border: 1px solid #ffc107; font-size: 13px;">
    <strong>⚠ Submission Deadline:</strong> <span style="color: #dc2626; font-weight: bold;">22 April 2026</span><br/>
    <strong>Pre-Bid Meeting:</strong> 10 April 2026, 10:00 AM at K&amp;A Dubai office<br/>
    <strong>Site Visit:</strong> Available on request — contact Eng. Nabil (below)
  </p>

  <p>Please provide itemized rates and lump-sum totals per MEP discipline. All works shall comply with Dubai Municipality, DEWA, DCD, and Etisalat regulations.</p>

  <p>Best regards,<br/>
  <strong>Eng. Nabil Al-Khatib</strong><br/>
  Senior MEP Project Manager<br/>
  Khatib &amp; Alami — Dubai Office<br/>
  Tel: +971 4 391 xxxx | Mob: +971 50 xxx xxxx<br/>
  <span style="color: #0d6939;">www.khatibalami.com</span></p>
</div>`,
    contentType: 'text/html',
    labels: ['INBOX', 'UNREAD', 'IMPORTANT'],
    messageCount: 1,
    attachments: [
      { filename: 'KA_AlKhail_Gateway_MEP_Drawings.zip', mimeType: 'application/zip', size: 85000000, attachmentId: 'att-005a' },
      { filename: 'HVAC-011_Thermal_Load_Summary.pdf', mimeType: 'application/pdf', size: 5200000, attachmentId: 'att-005b' },
      { filename: 'HVAC-012_Equipment_Schedule.pdf', mimeType: 'application/pdf', size: 3800000, attachmentId: 'att-005c' },
      { filename: 'ELEC-007_Single_Line_Diagram.pdf', mimeType: 'application/pdf', size: 4100000, attachmentId: 'att-005d' },
      { filename: 'MEP_Specifications_Complete.pdf', mimeType: 'application/pdf', size: 12800000, attachmentId: 'att-005e' },
      { filename: 'BOQ_Template_All_MEP.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 520000, attachmentId: 'att-005f' },
    ],
    images: [],
  },
  {
    threadId: 'demo-003',
    messageId: 'msg-003',
    from: 'info@realsoft.example',
    to: 'estimation@realsoft.example',
    subject: 'Re: Alcazar Tower — Priority Top, proceed with detailed estimation',
    date: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    snippet: 'Team, this is a priority-top enquiry. Client is Alcazar Properties, repeat customer. Proceed with detailed estimation for all MEP services...',
    body: `<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <p>Team,</p>

  <p>This is a <span style="color: #dc2626; font-weight: bold;">PRIORITY-TOP</span> enquiry.</p>

  <p>Client: <strong>Alcazar Properties</strong> — repeat customer, Tier-A reputation. They gave us the Al Wasl project last year.</p>

  <p>Please proceed with <strong>detailed estimation</strong> for all MEP services:</p>
  <ul>
    <li>HVAC — check if VRF or chiller based on thermal load</li>
    <li>Electrical — full scope</li>
    <li>Plumbing — water supply + drainage</li>
    <li>Fire Fighting — sprinkler + hose reels</li>
    <li>Fire Alarm — addressable system</li>
    <li>BMS — basic DDC integration</li>
  </ul>

  <p>Total area is 285,000 sqft. VRF system expected. Check thermal load drawing for exact KW.</p>

  <p><strong>Deadline: Submit by 14 April</strong> — one day before client deadline.</p>

  <p>Regards,<br/>
  <strong>George Varkey M</strong><br/>
  Technical Director<br/>
  ERP Realsoft LLC</p>
</div>`,
    contentType: 'text/html',
    labels: ['INBOX', 'STARRED'],
    messageCount: 2,
    attachments: [],
    images: [],
  },
  {
    threadId: 'demo-004',
    messageId: 'msg-004',
    from: 'design@emiratesengineers.ae',
    to: 'estimation@realsoft.example',
    subject: 'RFQ: HVAC Package Unit Supply & Install — Warehouse Complex, DIP',
    date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    snippet: 'Please quote for HVAC package units for a warehouse complex in Dubai Investment Park. Total cooling load: 450 TR...',
    body: `<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <p>Dear ERP Realsoft,</p>

  <p>Please quote for the supply and installation of <strong>HVAC package units</strong> for a new warehouse complex:</p>

  <table style="border-collapse: collapse; margin: 16px 0; width: 100%;">
    <tr style="background: #f0f4f8;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Project</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Logistics Hub — Phase 2</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Location</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Dubai Investment Park (DIP)</td></tr>
    <tr style="background: #f0f4f8;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Area</td><td style="padding: 8px 12px; border: 1px solid #ddd;">120,000 sqft warehouse + 15,000 sqft office</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Cooling Load</td><td style="padding: 8px 12px; border: 1px solid #ddd;">450 TR (total calculated)</td></tr>
    <tr style="background: #f0f4f8;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">System Type</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Rooftop Package Units (warehouse) + Split Units (office)</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Height</td><td style="padding: 8px 12px; border: 1px solid #ddd;">12m (warehouse), 3.5m (office)</td></tr>
  </table>

  <p><strong>Scope:</strong> HVAC only — supply, install, ductwork, controls, testing & commissioning.</p>

  <p>Thermal load calculation and equipment schedule attached.</p>

  <p>Quote deadline: <strong>20 April 2026</strong></p>

  <p>Thanks,<br/>
  <strong>Eng. Rashid Al Muhairi</strong><br/>
  MEP Design Lead<br/>
  Emirates Engineers Consultancy</p>
</div>`,
    contentType: 'text/html',
    labels: ['INBOX'],
    messageCount: 1,
    attachments: [
      { filename: 'Thermal_Load_Calc_DIP_Warehouse.pdf', mimeType: 'application/pdf', size: 5400000, attachmentId: 'att-004a' },
      { filename: 'Equipment_Schedule.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 178000, attachmentId: 'att-004b' },
      { filename: 'HVAC_Layout_Rev01.dwg', mimeType: 'application/acad', size: 22000000, attachmentId: 'att-004c' },
    ],
    images: [],
  },
  {
    threadId: 'demo-new-001',
    messageId: 'msg-new-001',
    from: 'procurement@damacdevelopments.ae',
    to: 'estimation@realsoft.example',
    subject: 'RFQ — HVAC Works for DAMAC Lagoons Townhouses Phase 3, Dubailand (146 Villas, VRF System)',
    date: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 mins ago — very recent
    snippet: 'Dear ERP Realsoft, DAMAC Properties invites you to submit your best price for HVAC supply and installation for 146 townhouse villas in Lagoons Phase 3...',
    body: `<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <div style="background: linear-gradient(135deg, #1a1a2e, #16213e); color: white; padding: 16px 20px; border-radius: 8px 8px 0 0; margin-bottom: 16px;">
    <p style="font-size: 14px; font-weight: bold; margin: 0;">DAMAC PROPERTIES</p>
    <p style="font-size: 11px; opacity: 0.8; margin: 4px 0 0 0;">Luxury Living · Dubai, UAE</p>
  </div>

  <p>Dear ERP Realsoft Estimation Team,</p>

  <p>DAMAC Properties is pleased to invite you to submit your <strong>best competitive quotation</strong> for HVAC works for the following villa community project:</p>

  <table style="border-collapse: collapse; margin: 16px 0; width: 100%;">
    <tr style="background: #1a1a2e; color: white;"><td colspan="2" style="padding: 10px 12px; font-weight: bold;">PROJECT DETAILS</td></tr>
    <tr style="background: #f0f4f8;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold; width: 200px;">Project</td><td style="padding: 8px 12px; border: 1px solid #ddd;">DAMAC Lagoons — Townhouses Phase 3</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Location</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Dubailand, Dubai</td></tr>
    <tr style="background: #f0f4f8;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Configuration</td><td style="padding: 8px 12px; border: 1px solid #ddd;">146 Townhouse Villas (G+1, 3BR and 4BR mix)</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Villa Area (3BR)</td><td style="padding: 8px 12px; border: 1px solid #ddd;">2,200 sqft (76 units)</td></tr>
    <tr style="background: #f0f4f8;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Villa Area (4BR)</td><td style="padding: 8px 12px; border: 1px solid #ddd;">2,800 sqft (70 units)</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Total Built-Up Area</td><td style="padding: 8px 12px; border: 1px solid #ddd;">363,200 sqft (146 villas)</td></tr>
    <tr style="background: #f0f4f8;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Building Type</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Villa Community — Townhouse</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">AC System</td><td style="padding: 8px 12px; border: 1px solid #ddd;"><strong>VRF System</strong> — 1 outdoor unit per villa on roof</td></tr>
    <tr style="background: #f0f4f8;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Typical Villa Cooling</td><td style="padding: 8px 12px; border: 1px solid #ddd;">3BR: 4.5 TR (15.8 kW) | 4BR: 6.0 TR (21.1 kW)</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Total Cooling Load</td><td style="padding: 8px 12px; border: 1px solid #ddd;">762 TR (2,679 kW) — all 146 villas</td></tr>
    <tr style="background: #f0f4f8;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Indoor Units Per Villa</td><td style="padding: 8px 12px; border: 1px solid #ddd;">3BR: 4 units (3 wall-mount decorative + 1 ducted) | 4BR: 5 units (4 wall-mount + 1 ducted)</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Deadline</td><td style="padding: 8px 12px; border: 1px solid #ddd; color: #dc2626; font-weight: bold;">20 April 2026</td></tr>
  </table>

  <p><strong>SCOPE OF WORK (per villa × 146):</strong></p>
  <ul>
    <li>VRF outdoor condensing unit — roof mounted (1 per villa)</li>
    <li>Wall-mounted decorative indoor units — bedrooms, living room</li>
    <li>Ceiling ducted indoor unit — corridor/common area (1 per villa)</li>
    <li>Refrigerant copper piping (liquid + gas lines)</li>
    <li>Condensate drain piping to nearest floor drain</li>
    <li>Wired remote controllers per indoor unit</li>
    <li>Electrical power connection to outdoor unit</li>
    <li>Testing, commissioning, and handover per villa</li>
  </ul>

  <p><strong>ATTACHED:</strong></p>
  <ol>
    <li>HVAC drawings — typical 3BR villa layout (AC-V3-01)</li>
    <li>HVAC drawings — typical 4BR villa layout (AC-V4-01)</li>
    <li>Thermal load calculation (per villa type)</li>
    <li>Equipment schedule (VRF models + capacities)</li>
    <li>BOQ template (per villa rates × 146 quantity)</li>
  </ol>

  <p>Best regards,<br/>
  <strong>Khalid Al Maktoum</strong><br/>
  Senior Procurement Manager<br/>
  DAMAC Properties · Dubai</p>
</div>`,
    contentType: 'text/html',
    labels: ['INBOX', 'UNREAD', 'IMPORTANT'],
    messageCount: 1,
    attachments: [
      { filename: 'DAMAC_Lagoons_P3_HVAC_Drawings.zip', mimeType: 'application/zip', size: 28000000, attachmentId: 'att-new1a' },
      { filename: 'Thermal_Load_Villa_3BR_4BR.pdf', mimeType: 'application/pdf', size: 2800000, attachmentId: 'att-new1b' },
      { filename: 'Equipment_Schedule_VRF.pdf', mimeType: 'application/pdf', size: 1900000, attachmentId: 'att-new1c' },
      { filename: 'BOQ_Template_146_Villas.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 380000, attachmentId: 'att-new1d' },
    ],
    images: [],
  },
  {
    threadId: 'demo-new-002',
    messageId: 'msg-new-002',
    from: 'mep.tenders@arabtec.ae',
    to: 'estimation@realsoft.example',
    subject: 'Tender — Full MEP Package for Jumeirah Living, JVC (3 Towers: B+G+P+18F+R), District Cooling Connection',
    date: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 mins ago
    snippet: 'Dear ERP Realsoft, Arabtec Construction invites your competitive bid for complete MEP works across 3 residential towers in JVC, served by Empower district cooling...',
    body: `<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <div style="background: #b91c1c; color: white; padding: 16px 20px; border-radius: 8px 8px 0 0; margin-bottom: 16px;">
    <p style="font-size: 14px; font-weight: bold; margin: 0;">ARABTEC CONSTRUCTION LLC</p>
    <p style="font-size: 11px; opacity: 0.8; margin: 4px 0 0 0;">Main Contractor · Dubai, UAE</p>
  </div>

  <p>Dear ERP Realsoft Estimation Team,</p>

  <p>Arabtec Construction LLC invites you to submit your <strong>competitive quotation</strong> for the <strong>complete MEP package</strong> (all disciplines) for the following residential development:</p>

  <table style="border-collapse: collapse; margin: 16px 0; width: 100%;">
    <tr style="background: #b91c1c; color: white;"><td colspan="2" style="padding: 10px 12px; font-weight: bold;">PROJECT INFORMATION</td></tr>
    <tr style="background: #fef2f2;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold; width: 200px;">Project</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Jumeirah Living — 3 Residential Towers</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Location</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Jumeirah Village Circle (JVC), Dubai</td></tr>
    <tr style="background: #fef2f2;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Developer</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Nakheel Properties</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Main Contractor</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Arabtec Construction LLC</td></tr>
    <tr style="background: #fef2f2;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Configuration</td><td style="padding: 8px 12px; border: 1px solid #ddd;">3 Towers × (B + G + P + 18 Typical + Roof) = 69 floors total</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Apartments Per Floor</td><td style="padding: 8px 12px; border: 1px solid #ddd;">8 units (Studio, 1BR, 2BR, 3BR mix)</td></tr>
    <tr style="background: #fef2f2;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Typical Floor Area</td><td style="padding: 8px 12px; border: 1px solid #ddd;">12,000 sqft per floor per tower</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Total Area (3 Towers)</td><td style="padding: 8px 12px; border: 1px solid #ddd;">780,000 sqft (260,000 sqft per tower)</td></tr>
    <tr style="background: #fef2f2;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Floor Height</td><td style="padding: 8px 12px; border: 1px solid #ddd;">3.0m typical, 4.5m ground lobby, 3.5m podium</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">AC System</td><td style="padding: 8px 12px; border: 1px solid #ddd;"><strong>District Cooling</strong> — Empower connection (4-pipe FCU per apartment)</td></tr>
    <tr style="background: #fef2f2;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Cooling Load (per tower)</td><td style="padding: 8px 12px; border: 1px solid #ddd;">850 TR | Total 3 towers: 2,550 TR (8,968 kW)</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">District Cooling Provider</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Empower (Emirates Central Cooling)</td></tr>
    <tr style="background: #fff3cd;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold; color: #dc2626;">Submission Deadline</td><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold; color: #dc2626;">25 April 2026</td></tr>
  </table>

  <p><strong>HVAC — DISTRICT COOLING SYSTEM:</strong></p>
  <table style="border-collapse: collapse; margin: 16px 0; width: 100%; font-size: 12px;">
    <tr style="background: #b91c1c; color: white;">
      <td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Component</td>
      <td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Specification</td>
      <td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Qty (per tower)</td>
    </tr>
    <tr style="background: #fef2f2;"><td style="padding: 5px 8px; border: 1px solid #ddd;">ETS (Energy Transfer Station)</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Plate heat exchanger, 850 TR capacity</td><td style="padding: 5px 8px; border: 1px solid #ddd;">1 set</td></tr>
    <tr><td style="padding: 5px 8px; border: 1px solid #ddd;">Primary CHW Pumps</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Variable speed, 30 kW each</td><td style="padding: 5px 8px; border: 1px solid #ddd;">2+1 (duty/standby)</td></tr>
    <tr style="background: #fef2f2;"><td style="padding: 5px 8px; border: 1px solid #ddd;">Secondary CHW Pumps</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Variable speed, 15 kW each</td><td style="padding: 5px 8px; border: 1px solid #ddd;">2+1</td></tr>
    <tr><td style="padding: 5px 8px; border: 1px solid #ddd;">FCU (per apartment)</td><td style="padding: 5px 8px; border: 1px solid #ddd;">4-pipe ceiling concealed, ducted</td><td style="padding: 5px 8px; border: 1px solid #ddd;">144 per tower</td></tr>
    <tr style="background: #fef2f2;"><td style="padding: 5px 8px; border: 1px solid #ddd;">AHU (lobby/common)</td><td style="padding: 5px 8px; border: 1px solid #ddd;">CHW AHU, double skin</td><td style="padding: 5px 8px; border: 1px solid #ddd;">2</td></tr>
    <tr><td style="padding: 5px 8px; border: 1px solid #ddd;">FAHU (fresh air)</td><td style="padding: 5px 8px; border: 1px solid #ddd;">8,000 CFM with energy recovery wheel</td><td style="padding: 5px 8px; border: 1px solid #ddd;">1</td></tr>
    <tr style="background: #fef2f2;"><td style="padding: 5px 8px; border: 1px solid #ddd;">CHW Piping</td><td style="padding: 5px 8px; border: 1px solid #ddd;">MS pipes, pre-insulated risers, 2-way valves</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Full building</td></tr>
    <tr><td style="padding: 5px 8px; border: 1px solid #ddd;">GI Ductwork</td><td style="padding: 5px 8px; border: 1px solid #ddd;">SMACNA standard, 25mm insulation</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Full building</td></tr>
    <tr style="background: #fef2f2;"><td style="padding: 5px 8px; border: 1px solid #ddd;">BTU Meters</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Ultrasonic, per apartment</td><td style="padding: 5px 8px; border: 1px solid #ddd;">144 per tower</td></tr>
  </table>

  <p><strong>FULL MEP SCOPE (all 3 towers):</strong></p>
  <ul>
    <li><strong>HVAC:</strong> District cooling ETS, CHW pumps, FCUs (432 total), AHUs, FAHUs, ductwork, BTU metering</li>
    <li><strong>Electrical:</strong> 3 × 2500 kVA transformer, MDB/SMDB/DB, busbar risers, LED lighting, generator per tower</li>
    <li><strong>Plumbing:</strong> Domestic water (underground + roof tanks), booster pumps, hot water calorifiers, PPR/CPVC piping</li>
    <li><strong>Drainage:</strong> Soil/waste/vent, rainwater, condensate recovery, sump pumps</li>
    <li><strong>Fire Fighting:</strong> Sprinkler system, fire pump set (electric + diesel), hose reels, landing valves, hydrants</li>
    <li><strong>Fire Alarm:</strong> Addressable loop, voice evacuation, stairwell pressurisation, fireman's intercom</li>
    <li><strong>BMS:</strong> Full DDC integration with Empower district cooling metering</li>
  </ul>

  <p><strong>ATTACHED (per tower — multiply × 3):</strong></p>
  <ol>
    <li>HVAC drawings (Basement through Roof) — 12 sheets per tower</li>
    <li>ETS Room layout and piping schematic</li>
    <li>Thermal load calculation summary</li>
    <li>Electrical SLD and layouts — 8 sheets per tower</li>
    <li>Plumbing layouts — 6 sheets per tower</li>
    <li>Fire Fighting layouts — 6 sheets per tower</li>
    <li>MEP Specifications (all disciplines)</li>
    <li>BOQ template (separate sheet per discipline per tower)</li>
  </ol>

  <p style="background: #fef2f2; padding: 12px; border-radius: 8px; border: 1px solid #fca5a5; font-size: 13px;">
    <strong>⚠ Note:</strong> This is a <strong>priority tender</strong> — Arabtec requires all MEP bids by <strong>25 April 2026</strong>.<br/>
    Pre-bid meeting: 12 April 2026 at JVC site office.<br/>
    Contact: Eng. Hassan Al-Rashid, +971 50 xxx xxxx
  </p>

  <p>Best regards,<br/>
  <strong>Eng. Hassan Al-Rashid</strong><br/>
  MEP Tender Manager<br/>
  Arabtec Construction LLC<br/>
  Dubai, UAE</p>
</div>`,
    contentType: 'text/html',
    labels: ['INBOX', 'UNREAD', 'STARRED'],
    messageCount: 1,
    attachments: [
      { filename: 'Arabtec_JumeirahLiving_MEP_Tower_A.zip', mimeType: 'application/zip', size: 95000000, attachmentId: 'att-new2a' },
      { filename: 'Arabtec_JumeirahLiving_MEP_Tower_B.zip', mimeType: 'application/zip', size: 92000000, attachmentId: 'att-new2b' },
      { filename: 'Arabtec_JumeirahLiving_MEP_Tower_C.zip', mimeType: 'application/zip', size: 91000000, attachmentId: 'att-new2c' },
      { filename: 'ETS_Layout_District_Cooling.pdf', mimeType: 'application/pdf', size: 6200000, attachmentId: 'att-new2d' },
      { filename: 'Thermal_Load_Summary_3Towers.pdf', mimeType: 'application/pdf', size: 5800000, attachmentId: 'att-new2e' },
      { filename: 'MEP_Specifications_Complete.pdf', mimeType: 'application/pdf', size: 15000000, attachmentId: 'att-new2f' },
      { filename: 'BOQ_Template_3Towers_All_MEP.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 720000, attachmentId: 'att-new2g' },
    ],
    images: [],
  },
  {
    threadId: 'demo-hvac-test',
    messageId: 'msg-hvac-test',
    from: 'mep.design@alfaraengineers.ae',
    to: 'estimation@realsoft.example',
    subject: 'RFQ — HVAC Works for Business Bay Office Tower (B+G+14F+R), VRF System — Complete Thermal Load Attached',
    date: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    snippet: 'Dear ERP Realsoft, Please quote HVAC works for a 14-floor office tower in Business Bay. Total thermal load 486 kW (VRF system). Thermal load drawing and equipment schedule attached...',
    body: `<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <div style="border-bottom: 3px solid #2563eb; padding-bottom: 12px; margin-bottom: 16px;">
    <p style="font-size: 14px; font-weight: bold; margin: 0; color: #2563eb;">AL FARA ENGINEERS</p>
    <p style="font-size: 11px; color: #666; margin: 4px 0 0 0;">MEP Consultants · Business Bay, Dubai</p>
  </div>

  <p>Dear ERP Realsoft Estimation Team,</p>

  <p>We invite you to submit your <strong>best price quotation</strong> for <strong>HVAC supply and installation</strong> for the following commercial project:</p>

  <table style="border-collapse: collapse; margin: 16px 0; width: 100%;">
    <tr style="background: #2563eb; color: white;"><td colspan="2" style="padding: 10px 12px; font-weight: bold; font-size: 14px;">PROJECT DETAILS</td></tr>
    <tr style="background: #eff6ff;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold; width: 220px;">Project Name</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Bay Square Business Tower — Phase 2</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Location</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Business Bay, Dubai</td></tr>
    <tr style="background: #eff6ff;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Client</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Bay Square Developments LLC</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Configuration</td><td style="padding: 8px 12px; border: 1px solid #ddd;">1 Basement + Ground + 14 Office Floors + Roof</td></tr>
    <tr style="background: #eff6ff;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Office Floor Area</td><td style="padding: 8px 12px; border: 1px solid #ddd;">4,800 sqft per floor</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Total Built-Up Area</td><td style="padding: 8px 12px; border: 1px solid #ddd;">82,000 sqft</td></tr>
    <tr style="background: #eff6ff;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Typical Floor Height</td><td style="padding: 8px 12px; border: 1px solid #ddd;">3.6m floor-to-floor</td></tr>
  </table>

  <table style="border-collapse: collapse; margin: 16px 0; width: 100%;">
    <tr style="background: #dc2626; color: white;"><td colspan="2" style="padding: 10px 12px; font-weight: bold; font-size: 14px;">THERMAL LOAD SUMMARY (from drawing HVAC-TL-01)</td></tr>
    <tr style="background: #fef2f2;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold; width: 220px;">Total Calculated KW</td><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold; font-size: 16px; color: #dc2626;">486 kW</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">FAHU Load (Fresh Air)</td><td style="padding: 8px 12px; border: 1px solid #ddd;">62 kW (2 × FAHU units, 3,500 CFM each = 7,000 CFM total)</td></tr>
    <tr style="background: #fef2f2;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">AC Unit Load (486 − 62)</td><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">424 kW</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Total Tonnage (÷ 3.517)</td><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold; color: #2563eb;">138.2 TR</td></tr>
    <tr style="background: #eff6ff;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">AC System Type</td><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold; color: #2563eb;">VRF System (Daikin VRV-IV)</td></tr>
  </table>

  <table style="border-collapse: collapse; margin: 16px 0; width: 100%; font-size: 12px;">
    <tr style="background: #2563eb; color: white;">
      <td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Indoor Unit Type</td>
      <td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Count</td>
      <td style="padding: 6px 8px; border: 1px solid #ddd; font-weight: bold;">Location</td>
    </tr>
    <tr style="background: #eff6ff;"><td style="padding: 5px 8px; border: 1px solid #ddd;">Ceiling Ducted</td><td style="padding: 5px 8px; border: 1px solid #ddd;">42</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Office floors (3 per floor × 14)</td></tr>
    <tr><td style="padding: 5px 8px; border: 1px solid #ddd;">4-Way Cassette (Decorative)</td><td style="padding: 5px 8px; border: 1px solid #ddd;">14</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Ground lobby + reception areas</td></tr>
    <tr style="background: #eff6ff;"><td style="padding: 5px 8px; border: 1px solid #ddd;">Wall Mount Split</td><td style="padding: 5px 8px; border: 1px solid #ddd;">4</td><td style="padding: 5px 8px; border: 1px solid #ddd;">Server room, security, electrical rooms</td></tr>
    <tr><td style="padding: 5px 8px; border: 1px solid #ddd;"><strong>Total Indoor Units</strong></td><td style="padding: 5px 8px; border: 1px solid #ddd;"><strong>60</strong></td><td style="padding: 5px 8px; border: 1px solid #ddd;"> </td></tr>
  </table>

  <p><strong>Scope:</strong> HVAC only — VRF outdoor units (roof), indoor units (all floors), refrigerant piping, condensate drain, ductwork, diffusers/grilles, FAHU units, controls, testing &amp; commissioning.</p>

  <p><strong>Deadline:</strong> <span style="color: #dc2626; font-weight: bold;">18 April 2026</span></p>

  <p>Best regards,<br/>
  <strong>Eng. Ahmed Al Fara</strong><br/>
  Senior MEP Consultant<br/>
  Al Fara Engineers · Dubai<br/>
  Tel: +971 4 556 xxxx</p>
</div>`,
    contentType: 'text/html',
    labels: ['INBOX', 'UNREAD', 'IMPORTANT'],
    messageCount: 1,
    attachments: [
      { filename: 'HVAC-TL-01_Thermal_Load_Summary.pdf', mimeType: 'application/pdf', size: 4200000, attachmentId: 'att-hvac-1a' },
      { filename: 'HVAC-ES-01_Equipment_Schedule.pdf', mimeType: 'application/pdf', size: 2800000, attachmentId: 'att-hvac-1b' },
      { filename: 'HVAC_Typical_Floor_Layout.dwg', mimeType: 'application/acad', size: 18000000, attachmentId: 'att-hvac-1c' },
      { filename: 'HVAC_Roof_Plant_Layout.dwg', mimeType: 'application/acad', size: 12000000, attachmentId: 'att-hvac-1d' },
      { filename: 'VRF_Schematic_Piping.pdf', mimeType: 'application/pdf', size: 3500000, attachmentId: 'att-hvac-1e' },
    ],
    images: [],
  },
  {
    threadId: 'demo-hospital',
    messageId: 'msg-hospital',
    from: 'mep.procurement@adhealth.ae',
    to: 'estimation@realsoft.example',
    subject: 'Urgent RFQ — Full MEP for Al Ain Specialty Hospital Extension (B+G+3F), Chiller + Medical Gas + Fire Alarm',
    date: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    snippet: 'Dear ERP Realsoft, Abu Dhabi Health Services invites urgent quotation for full MEP works for the new specialty hospital extension in Al Ain. Total 42,000 sqft, chiller system...',
    body: `<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <div style="background: linear-gradient(135deg, #065f46, #047857); color: white; padding: 16px 20px; border-radius: 8px 8px 0 0; margin-bottom: 16px;">
    <p style="font-size: 14px; font-weight: bold; margin: 0;">ABU DHABI HEALTH SERVICES (ADHS)</p>
    <p style="font-size: 11px; opacity: 0.8; margin: 4px 0 0 0;">Healthcare Infrastructure · Al Ain, UAE</p>
  </div>

  <p>Dear ERP Realsoft Estimation Team,</p>

  <p>Abu Dhabi Health Services invites you to submit your <strong>urgent competitive quotation</strong> for the <strong>complete MEP package</strong> for a healthcare facility extension:</p>

  <table style="border-collapse: collapse; margin: 16px 0; width: 100%;">
    <tr style="background: #065f46; color: white;"><td colspan="2" style="padding: 10px 12px; font-weight: bold; font-size: 14px;">PROJECT DETAILS</td></tr>
    <tr style="background: #ecfdf5;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold; width: 220px;">Project Name</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Al Ain Specialty Hospital — New Wing Extension</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Location</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Al Ain, Abu Dhabi</td></tr>
    <tr style="background: #ecfdf5;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Client</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Abu Dhabi Health Services (ADHS)</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Consultant</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Dar Al-Handasah (Shair & Partners)</td></tr>
    <tr style="background: #ecfdf5;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Configuration</td><td style="padding: 8px 12px; border: 1px solid #ddd;">1 Basement + Ground + 3 Floors</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Ground Floor</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Emergency Dept (24/7), Radiology, Pharmacy, Reception — 12,000 sqft</td></tr>
    <tr style="background: #ecfdf5;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">1st Floor</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Operating Theatres (4 nos), CSSD, Recovery — 10,000 sqft</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">2nd Floor</td><td style="padding: 8px 12px; border: 1px solid #ddd;">ICU (12 beds), HDU (8 beds), Nurse Station — 10,000 sqft</td></tr>
    <tr style="background: #ecfdf5;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">3rd Floor</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Patient Wards (40 beds, mix private/shared), Admin — 10,000 sqft</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Total Area</td><td style="padding: 8px 12px; border: 1px solid #ddd;"><strong>42,000 sqft</strong></td></tr>
    <tr style="background: #ecfdf5;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Floor Height</td><td style="padding: 8px 12px; border: 1px solid #ddd;">4.2m (all floors — hospital standard)</td></tr>
  </table>

  <table style="border-collapse: collapse; margin: 16px 0; width: 100%;">
    <tr style="background: #dc2626; color: white;"><td colspan="2" style="padding: 10px 12px; font-weight: bold;">HVAC THERMAL LOAD</td></tr>
    <tr style="background: #fef2f2;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold; width: 220px;">Total Cooling Load</td><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold; font-size: 16px; color: #dc2626;">527 kW</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">FAHU Load</td><td style="padding: 8px 12px; border: 1px solid #ddd;">85 kW (3 × FAHU units, 5,000 CFM each = 15,000 CFM total)</td></tr>
    <tr style="background: #fef2f2;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">AC Unit Load (527 − 85)</td><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">442 kW</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Tonnage (÷ 3.517)</td><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold; color: #065f46;">150 TR</td></tr>
    <tr style="background: #ecfdf5;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">AC System</td><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold; color: #065f46;">Chiller System — Air-cooled (hospital-grade, N+1 redundancy)</td></tr>
  </table>

  <p><strong>SPECIAL MEP REQUIREMENTS (Healthcare):</strong></p>
  <ul>
    <li><strong>HVAC:</strong> 100% fresh air for OT &amp; CSSD, HEPA filtration Class 10,000, positive/negative pressure rooms in ICU, humidity control 40-60% RH</li>
    <li><strong>Medical Gas:</strong> Oxygen, nitrous oxide, medical air, vacuum — piped to all beds, OT, and emergency bays</li>
    <li><strong>Electrical:</strong> Essential power (UPS for OT, ICU, emergency), normal power, IPS panels for each OT, isolated earth</li>
    <li><strong>Nurse Call:</strong> IP-based nurse call system, patient-to-nurse, emergency pull cords in toilets</li>
    <li><strong>Fire Alarm:</strong> Addressable, voice evacuation, defend-in-place strategy (patients cannot evacuate)</li>
    <li><strong>Plumbing:</strong> Hot water with TMV valves, RO water for CSSD, grease trap for kitchen</li>
  </ul>

  <p style="background: #fef2f2; padding: 12px; border-radius: 8px; border: 1px solid #fca5a5; font-size: 13px;">
    <strong>⚠ URGENT:</strong> Client requires MEP bids by <strong>15 April 2026</strong>. Healthcare compliance documentation (JCI/DHA standards) must be included with submission.
  </p>

  <p>Best regards,<br/>
  <strong>Dr. Fatima Al Dhaheri</strong><br/>
  Director of Infrastructure Projects<br/>
  Abu Dhabi Health Services<br/>
  Tel: +971 3 707 xxxx</p>
</div>`,
    contentType: 'text/html',
    labels: ['INBOX', 'UNREAD', 'STARRED', 'IMPORTANT'],
    messageCount: 1,
    attachments: [
      { filename: 'HVAC_Thermal_Load_Hospital.pdf', mimeType: 'application/pdf', size: 6200000, attachmentId: 'att-hosp-1a' },
      { filename: 'HVAC_Equipment_Schedule_Hospital.pdf', mimeType: 'application/pdf', size: 3400000, attachmentId: 'att-hosp-1b' },
      { filename: 'Medical_Gas_Piping_Layout.pdf', mimeType: 'application/pdf', size: 4800000, attachmentId: 'att-hosp-1c' },
      { filename: 'ARCH_Ground_Floor_Emergency.pdf', mimeType: 'application/pdf', size: 9500000, attachmentId: 'att-hosp-1d' },
      { filename: 'ARCH_1F_Operating_Theatres.pdf', mimeType: 'application/pdf', size: 8800000, attachmentId: 'att-hosp-1e' },
      { filename: 'ARCH_2F_ICU_Layout.pdf', mimeType: 'application/pdf', size: 7600000, attachmentId: 'att-hosp-1f' },
      { filename: 'ELEC_Essential_Power_SLD.pdf', mimeType: 'application/pdf', size: 5100000, attachmentId: 'att-hosp-1g' },
      { filename: 'Fire_Alarm_Hospital_Layout.pdf', mimeType: 'application/pdf', size: 4200000, attachmentId: 'att-hosp-1h' },
      { filename: 'MEP_Spec_Healthcare.pdf', mimeType: 'application/pdf', size: 22000000, attachmentId: 'att-hosp-1i' },
      { filename: 'BOQ_Hospital_MEP.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 480000, attachmentId: 'att-hosp-1j' },
    ],
    images: [],
  },
  {
    threadId: 'demo-arch-plans',
    messageId: 'msg-arch-plans',
    from: 'design@emaarprojects.ae',
    to: 'estimation@realsoft.example',
    subject: 'RFQ — Full MEP Package for Creek Vista Residences, Dubai Creek Harbour (2B+G+P+20F+R), Architecture + MEP Drawings Attached',
    date: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    snippet: 'Dear ERP Realsoft, Emaar invites you to quote for full MEP works. Architecture drawings, floor plans, sections, and MEP drawings attached. Chiller system, 350 TR...',
    body: `<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <div style="background: linear-gradient(135deg, #0c4a6e, #164e63); color: white; padding: 16px 20px; border-radius: 8px 8px 0 0; margin-bottom: 16px;">
    <p style="font-size: 14px; font-weight: bold; margin: 0;">EMAAR PROPERTIES</p>
    <p style="font-size: 11px; opacity: 0.8; margin: 4px 0 0 0;">Developer · Dubai Creek Harbour</p>
  </div>

  <p>Dear ERP Realsoft Estimation Team,</p>

  <p>Emaar Properties invites you to submit your <strong>competitive quotation</strong> for the <strong>complete MEP package</strong> for the following premium residential development:</p>

  <table style="border-collapse: collapse; margin: 16px 0; width: 100%;">
    <tr style="background: #0c4a6e; color: white;"><td colspan="2" style="padding: 10px 12px; font-weight: bold; font-size: 14px;">PROJECT DETAILS</td></tr>
    <tr style="background: #f0f9ff;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold; width: 220px;">Project Name</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Creek Vista Residences — Tower A</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Location</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Dubai Creek Harbour, Dubai</td></tr>
    <tr style="background: #f0f9ff;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Client / Developer</td><td style="padding: 8px 12px; border: 1px solid #ddd;">Emaar Properties PJSC</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Architect</td><td style="padding: 8px 12px; border: 1px solid #ddd;">SOM (Skidmore, Owings & Merrill)</td></tr>
    <tr style="background: #f0f9ff;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Configuration</td><td style="padding: 8px 12px; border: 1px solid #ddd;">2 Basements + Ground + Podium + 20 Typical + Roof</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Typical Floor Area</td><td style="padding: 8px 12px; border: 1px solid #ddd;">8,500 sqft per floor (6 apartments)</td></tr>
    <tr style="background: #f0f9ff;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Total Built-Up Area</td><td style="padding: 8px 12px; border: 1px solid #ddd;">215,000 sqft</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Floor Height</td><td style="padding: 8px 12px; border: 1px solid #ddd;">3.2m typical, 4.5m ground, 3.0m basement</td></tr>
    <tr style="background: #f0f9ff;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">AC System</td><td style="padding: 8px 12px; border: 1px solid #ddd;"><strong>Chiller System</strong> — Air-cooled scroll chillers on roof</td></tr>
    <tr><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">Total Cooling Load</td><td style="padding: 8px 12px; border: 1px solid #ddd;"><strong>1,231 kW (350 TR)</strong></td></tr>
    <tr style="background: #f0f9ff;"><td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;">FAHU</td><td style="padding: 8px 12px; border: 1px solid #ddd;">2 units × 8,000 CFM = 16,000 CFM total (148 kW)</td></tr>
  </table>

  <p><strong>IMPORTANT:</strong> Architecture drawings (floor plans, sections, elevations) are included alongside MEP drawings. Please review the architectural layout before pricing ductwork and piping routes.</p>

  <p><strong>ATTACHED DRAWINGS:</strong></p>
  <ol>
    <li><strong>Architecture:</strong> Ground floor plan, typical floor plan, roof plan, building section, elevation</li>
    <li><strong>HVAC:</strong> Thermal load summary, equipment schedule, typical floor layout, roof plant layout</li>
    <li><strong>Electrical:</strong> Single line diagram, typical floor power layout</li>
    <li><strong>Plumbing:</strong> Water supply schematic, drainage layout</li>
    <li><strong>Fire Fighting:</strong> Sprinkler layout, fire pump room</li>
    <li><strong>Specifications:</strong> Complete MEP spec document</li>
  </ol>

  <p><strong>Deadline:</strong> <span style="color: #dc2626; font-weight: bold;">22 April 2026</span></p>

  <p>Best regards,<br/>
  <strong>Eng. Saif Al Suwaidi</strong><br/>
  MEP Projects Manager<br/>
  Emaar Properties PJSC · Dubai Creek Harbour</p>
</div>`,
    contentType: 'text/html',
    labels: ['INBOX', 'UNREAD', 'STARRED', 'IMPORTANT'],
    messageCount: 1,
    attachments: [
      { filename: 'ARCH-GF-01_Ground_Floor_Plan.pdf', mimeType: 'application/pdf', size: 12500000, attachmentId: 'att-arch-1a' },
      { filename: 'ARCH-TF-01_Typical_Floor_Plan.pdf', mimeType: 'application/pdf', size: 11800000, attachmentId: 'att-arch-1b' },
      { filename: 'ARCH-RF-01_Roof_Plan.pdf', mimeType: 'application/pdf', size: 8200000, attachmentId: 'att-arch-1c' },
      { filename: 'ARCH-SEC-01_Building_Section.pdf', mimeType: 'application/pdf', size: 9500000, attachmentId: 'att-arch-1d' },
      { filename: 'ARCH-ELV-01_Building_Elevations.pdf', mimeType: 'application/pdf', size: 14000000, attachmentId: 'att-arch-1e' },
      { filename: 'ARCH-TF-01_Typical_Floor.dwg', mimeType: 'application/acad', size: 25000000, attachmentId: 'att-arch-1f' },
      { filename: 'HVAC-TL-01_Thermal_Load_Summary.pdf', mimeType: 'application/pdf', size: 5200000, attachmentId: 'att-arch-2a' },
      { filename: 'HVAC-ES-01_Equipment_Schedule.pdf', mimeType: 'application/pdf', size: 3100000, attachmentId: 'att-arch-2b' },
      { filename: 'HVAC-TF-01_Typical_Floor_Layout.dwg', mimeType: 'application/acad', size: 22000000, attachmentId: 'att-arch-2c' },
      { filename: 'ELEC-SLD-01_Single_Line_Diagram.pdf', mimeType: 'application/pdf', size: 4500000, attachmentId: 'att-arch-3a' },
      { filename: 'MEP_Specifications_Creek_Vista.pdf', mimeType: 'application/pdf', size: 18000000, attachmentId: 'att-arch-4a' },
      { filename: 'BOQ_Template_All_MEP.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 650000, attachmentId: 'att-arch-5a' },
    ],
    images: [],
  },
];

export function getDemoEmails(): DemoEmail[] {
  return [...store].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export function getDemoEmail(threadId: string): DemoEmail | undefined {
  return store.find((e) => e.threadId === threadId);
}

// Built-in test RFQ emails — always available, persist across server restarts
const TEST_RFQ_EMAILS: DemoEmail[] = [
  {
    threadId: 'test-rfq-001',
    messageId: 'msg-test-rfq-001',
    from: 'procurement@alzahra-properties.ae',
    to: 'estimation@realsoft.example',
    subject: 'RFQ — MEP Works for Al Zahra Commercial Tower, JLT (B+2P+18F), Please Quote',
    date: new Date(Date.now() - 20 * 60000).toISOString(),
    snippet: 'Dear ERP Realsoft Team, Please quote best price for MEP supply and installation. Project: Al Zahra Commercial Tower, JLT Dubai. 21 floors, 72,000 sqft...',
    body: 'Dear ERP Realsoft Estimation Team,\n\nPlease quote your best price for MEP supply and installation:\n\nProject: Al Zahra Commercial Tower\nLocation: JLT (Jumeirah Lake Towers), Dubai\nClient: Al Zahra Properties LLC\nConsultant: KEO International Consultants\n\nBuilding Details:\n- Type: Office / Commercial Tower\n- Configuration: Basement + 2 Parking + 18 Typical Floors + Roof\n- Total Floors: 21 (including 2 parking levels)\n- Area per Floor: 3,200 sqft\n- Total Built-Up Area: 72,000 sqft\n- Typical Floor Height: 3.4m\n\nScope of Work:\n1. HVAC Supply & Installation (VRF System)\n2. Electrical Works (LV & ELV)\n3. Plumbing & Drainage\n4. Fire Fighting & Fire Alarm\n5. BMS Integration\n\nDeadline: 25 April 2026.\n\nMohammed Al Rashid\nAl Zahra Properties LLC',
    contentType: 'text/plain',
    labels: ['INBOX', 'UNREAD'],
    messageCount: 1,
    attachments: [
      { filename: 'MEP_Tender_Drawings.zip', mimeType: 'application/zip', size: 45000000, attachmentId: 'att-test-001-0' },
      { filename: 'HVAC_Equipment_Schedule.pdf', mimeType: 'application/pdf', size: 2400000, attachmentId: 'att-test-001-1' },
      { filename: 'Thermal_Load_Calculation.pdf', mimeType: 'application/pdf', size: 1800000, attachmentId: 'att-test-001-2' },
      { filename: 'Electrical_SLD.dwg', mimeType: 'application/acad', size: 8500000, attachmentId: 'att-test-001-3' },
      { filename: 'Plumbing_Layout.dwg', mimeType: 'application/acad', size: 6200000, attachmentId: 'att-test-001-4' },
    ],
    images: [],
  },
  {
    threadId: 'test-rfq-002',
    messageId: 'msg-test-rfq-002',
    from: 'projects@dubai-villas.ae',
    to: 'estimation@realsoft.example',
    subject: 'Tender Invitation — MEP for Luxury Villa, Emirates Hills (G+1)',
    date: new Date(Date.now() - 25 * 60000).toISOString(),
    snippet: 'Please submit competitive price. Project: Al Maktoum Luxury Villa, Emirates Hills. Villa, 2 floors, 9,000 sqft...',
    body: 'Dear Estimation Team,\n\nPlease submit your competitive price:\n\nProject: Al Maktoum Luxury Villa\nLocation: Emirates Hills, Dubai\nClient: Dubai Luxury Villas LLC\n\nBuilding Details:\n- Type: Villa (Residential)\n- Configuration: Ground + First Floor\n- Total Floors: 2\n- Area per Floor: 4,500 sqft\n- Total Built-Up Area: 9,000 sqft\n- Typical Floor Height: 3.8m\n\nScope:\n1. HVAC - Split/VRF System\n2. Electrical Works\n3. Plumbing & Drainage\n4. Fire Alarm System\n\nDeadline: 20 April 2026.\n\nFatima Al Hashimi\nDubai Luxury Villas LLC',
    contentType: 'text/plain',
    labels: ['INBOX', 'UNREAD'],
    messageCount: 1,
    attachments: [
      { filename: 'Villa_MEP_Drawings.pdf', mimeType: 'application/pdf', size: 8500000, attachmentId: 'att-test-002-0' },
      { filename: 'Villa_Floor_Plans.dwg', mimeType: 'application/acad', size: 3200000, attachmentId: 'att-test-002-1' },
    ],
    images: [],
  },
  {
    threadId: 'test-rfq-003',
    messageId: 'msg-test-rfq-003',
    from: 'tenders@arabian-hospitality.com',
    to: 'estimation@realsoft.example',
    subject: 'URGENT RFQ — Full MEP Package, Marina Beach Hotel (2B+G+30F), Best Price Required',
    date: new Date(Date.now() - 30 * 60000).toISOString(),
    snippet: 'URGENT Request for Quotation. Marina Beach Hotel, Dubai Marina. 33 floors, 185,000 sqft. Full MEP package including chiller, HV/LV, plumbing...',
    body: 'Dear ERP Realsoft Estimation Department,\n\nRequest for Quotation - URGENT\n\nProject: Marina Beach Hotel & Residences\nLocation: Dubai Marina, Dubai\nClient: Arabian Hospitality Group\nConsultant: Atkins International\n\nBuilding Details:\n- Type: Hotel / Mixed-Use\n- Configuration: 2 Basements + Ground + 30 Floors + Roof\n- Total Floors: 33 (including 2 basement parking)\n- Parking Floors: 2\n- Area per Floor: 5,800 sqft\n- Total Built-Up Area: 185,000 sqft\n- Typical Floor Height: 3.2m\n\nScope of Work (Full MEP):\n1. HVAC - Chiller System with AHUs\n2. Electrical (HV, LV, ELV)\n3. Plumbing, Drainage & Water Supply\n4. Fire Fighting (Sprinkler + Hydrant)\n5. Fire Alarm & Detection\n6. BMS Integration\n7. LPG System (Kitchen)\n\nPriority project. Deadline: 15 April 2026.\n\nAhmed Al Mansoori\nArabian Hospitality Group',
    contentType: 'text/plain',
    labels: ['INBOX', 'UNREAD'],
    messageCount: 1,
    attachments: [
      { filename: 'Hotel_MEP_Complete.zip', mimeType: 'application/zip', size: 120000000, attachmentId: 'att-test-003-0' },
      { filename: 'Thermal_Load_Summary.pdf', mimeType: 'application/pdf', size: 4500000, attachmentId: 'att-test-003-1' },
      { filename: 'HVAC_Equipment_Schedule.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 890000, attachmentId: 'att-test-003-2' },
      { filename: 'Electrical_SLD_Riser.dwg', mimeType: 'application/acad', size: 15000000, attachmentId: 'att-test-003-3' },
      { filename: 'Fire_Fighting_Layout.dwg', mimeType: 'application/acad', size: 9800000, attachmentId: 'att-test-003-4' },
    ],
    images: [],
  },
  {
    threadId: 'test-rfq-004',
    messageId: 'msg-test-rfq-004',
    from: 'ops@gulf-logistics.ae',
    to: 'estimation@realsoft.example',
    subject: 'RFQ for HVAC and Electrical — New Warehouse, JAFZA South',
    date: new Date(Date.now() - 35 * 60000).toISOString(),
    snippet: 'Please quote for MEP works. Gulf Logistics Warehouse Phase 3, JAFZA South. Warehouse, 40,000 sqft. HVAC, Electrical, Fire Fighting...',
    body: 'Hi ERP Realsoft,\n\nPlease quote for MEP works:\n\nProject: Gulf Logistics Warehouse Phase 3\nLocation: JAFZA South, Dubai\nClient: Gulf Logistics & Warehousing LLC\n\nBuilding Details:\n- Type: Warehouse / Industrial\n- Configuration: Ground Floor + Mezzanine + Office Block\n- Total Floors: 2\n- Total Area: 40,000 sqft\n- Clear Height: 10m (warehouse), 3.2m (office)\n\nScope:\n1. HVAC - Package Units for office, ventilation for warehouse\n2. Electrical - Power distribution, lighting\n3. Fire Fighting - Sprinkler system\n\nNeed competitive pricing. Deadline: 30 April 2026.\n\nRajesh Kumar\nGulf Logistics LLC',
    contentType: 'text/plain',
    labels: ['INBOX', 'UNREAD'],
    messageCount: 1,
    attachments: [
      { filename: 'Warehouse_Layout.pdf', mimeType: 'application/pdf', size: 5500000, attachmentId: 'att-test-004-0' },
      { filename: 'Electrical_Layout.pdf', mimeType: 'application/pdf', size: 2100000, attachmentId: 'att-test-004-1' },
    ],
    images: [],
  },
  {
    threadId: 'test-rfq-005',
    messageId: 'msg-test-rfq-005',
    from: 'procurement@healthcity-uae.com',
    to: 'estimation@realsoft.example',
    subject: 'Invitation to Bid — MEP Works, HealthCity Medical Center, Al Quoz (B+G+8F)',
    date: new Date(Date.now() - 40 * 60000).toISOString(),
    snippet: 'HealthCity UAE invites ERP Realsoft to submit quotation for MEP works. Hospital, Al Quoz, 82,000 sqft, 10 floors. Full MEP with medical gas...',
    body: 'Dear Sir/Madam,\n\nHealthCity UAE invites ERP Realsoft to submit a quotation for MEP works:\n\nProject: HealthCity Medical Center\nLocation: Al Quoz Industrial Area 3, Dubai\nClient: HealthCity UAE Holdings\nConsultant: WSP Middle East\n\nBuilding Details:\n- Type: Hospital / Medical Facility\n- Configuration: Basement + Ground + 8 Floors\n- Total Floors: 10 (including basement)\n- Parking Floors: 1 (basement)\n- Area per Floor: 8,200 sqft\n- Total Built-Up Area: 82,000 sqft\n- Typical Floor Height: 4.0m\n\nScope of Work:\n1. HVAC - Chiller system with precision cooling for OTs and labs\n2. Electrical - Full HV/LV including UPS for critical areas\n3. Plumbing - Including medical gas piping\n4. Fire Fighting - Full sprinkler, hydrant, FM200 for server rooms\n5. Fire Alarm - Addressable system\n6. BMS - Full building management\n\nHospital-grade DHA compliant. Deadline: 22 April 2026.\n\nDr. Sarah Khan\nHealthCity UAE',
    contentType: 'text/plain',
    labels: ['INBOX', 'UNREAD'],
    messageCount: 1,
    attachments: [
      { filename: 'Hospital_MEP_Tender.zip', mimeType: 'application/zip', size: 95000000, attachmentId: 'att-test-005-0' },
      { filename: 'HVAC_Thermal_Load_Report.pdf', mimeType: 'application/pdf', size: 6800000, attachmentId: 'att-test-005-1' },
      { filename: 'Medical_Gas_Layout.dwg', mimeType: 'application/acad', size: 7200000, attachmentId: 'att-test-005-2' },
      { filename: 'Fire_Protection_Specs.pdf', mimeType: 'application/pdf', size: 8900000, attachmentId: 'att-test-005-3' },
    ],
    images: [],
  },
];

// Use globalThis to persist across HMR / module re-evaluations in dev
const globalKey = '__sabi_manual_emails__' as const;
declare global {
  // eslint-disable-next-line no-var
  var __sabi_manual_emails__: DemoEmail[] | undefined;
}
if (!globalThis[globalKey]) {
  globalThis[globalKey] = [...TEST_RFQ_EMAILS];
}
const manuallyAdded: DemoEmail[] = globalThis[globalKey];

export function getManuallyAddedEmails(): DemoEmail[] {
  return [...manuallyAdded].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export function addDemoEmail(email: Omit<DemoEmail, 'threadId' | 'messageId'>): DemoEmail {
  const id = `demo-${Date.now()}`;
  const newEmail: DemoEmail = {
    ...email,
    threadId: id,
    messageId: `msg-${id}`,
  };
  store.unshift(newEmail);
  manuallyAdded.push(newEmail);
  return newEmail;
}
// In-memory price library for local development — Dubai MEP market rates Q1 2025
// Editable at runtime, persists for dev server session
