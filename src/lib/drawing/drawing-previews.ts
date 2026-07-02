// SVG drawing previews for demo attachments
// Returns inline SVG strings that render floor plan visuals

const GROUND_FLOOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 840 600" font-family="Arial,sans-serif">
  <defs>
    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e5e7eb" stroke-width="0.5"/></pattern>
  </defs>
  <rect width="840" height="600" fill="#f8fafc"/>
  <rect width="840" height="600" fill="url(#grid)"/>
  <!-- Title block -->
  <rect x="10" y="10" width="820" height="40" fill="#1e293b" rx="4"/>
  <text x="25" y="36" fill="white" font-size="14" font-weight="bold">ARCH-GF-01 — GROUND FLOOR PLAN</text>
  <text x="620" y="36" fill="#94a3b8" font-size="11">Creek Vista Residences | Scale 1:100</text>
  <!-- Building outline -->
  <rect x="60" y="70" width="720" height="480" fill="none" stroke="#334155" stroke-width="3" rx="2"/>
  <!-- Main Entrance -->
  <rect x="280" y="70" width="280" height="30" fill="#dbeafe" stroke="#3b82f6" stroke-width="1.5"/>
  <text x="420" y="90" text-anchor="middle" font-size="10" fill="#1e40af" font-weight="bold">MAIN ENTRANCE (North)</text>
  <!-- Lobby -->
  <rect x="260" y="100" width="320" height="160" fill="#eff6ff" stroke="#3b82f6" stroke-width="2" rx="2"/>
  <text x="420" y="145" text-anchor="middle" font-size="16" fill="#1e40af" font-weight="bold">MAIN LOBBY</text>
  <text x="420" y="165" text-anchor="middle" font-size="11" fill="#3b82f6">280 sqm — Double Height 6.0m</text>
  <text x="420" y="182" text-anchor="middle" font-size="9" fill="#6b7280">Marble floor | Reception | Chandelier</text>
  <!-- Retail 1 -->
  <rect x="60" y="100" width="200" height="120" fill="#fef3c7" stroke="#d97706" stroke-width="1.5"/>
  <text x="160" y="150" text-anchor="middle" font-size="13" fill="#92400e" font-weight="bold">RETAIL 1</text>
  <text x="160" y="168" text-anchor="middle" font-size="10" fill="#b45309">125 sqm</text>
  <!-- Retail 2 -->
  <rect x="580" y="100" width="200" height="120" fill="#fef3c7" stroke="#d97706" stroke-width="1.5"/>
  <text x="680" y="150" text-anchor="middle" font-size="13" fill="#92400e" font-weight="bold">RETAIL 2</text>
  <text x="680" y="168" text-anchor="middle" font-size="10" fill="#b45309">130 sqm</text>
  <!-- Retail 3 -->
  <rect x="60" y="220" width="200" height="100" fill="#fef3c7" stroke="#d97706" stroke-width="1.5"/>
  <text x="160" y="265" text-anchor="middle" font-size="13" fill="#92400e" font-weight="bold">RETAIL 3</text>
  <text x="160" y="283" text-anchor="middle" font-size="10" fill="#b45309">95 sqm</text>
  <!-- Retail 4 -->
  <rect x="580" y="220" width="200" height="100" fill="#fef3c7" stroke="#d97706" stroke-width="1.5"/>
  <text x="680" y="265" text-anchor="middle" font-size="13" fill="#92400e" font-weight="bold">RETAIL 4</text>
  <text x="680" y="283" text-anchor="middle" font-size="10" fill="#b45309">110 sqm</text>
  <!-- Elevator Core -->
  <rect x="340" y="260" width="160" height="90" fill="#e0e7ff" stroke="#4f46e5" stroke-width="2" rx="2"/>
  <text x="420" y="295" text-anchor="middle" font-size="11" fill="#3730a3" font-weight="bold">ELEVATOR LOBBY</text>
  <text x="420" y="312" text-anchor="middle" font-size="9" fill="#4f46e5">3 Pass + 1 Svc + 1 FF</text>
  <!-- Lift boxes -->
  <rect x="350" y="272" width="18" height="22" fill="#c7d2fe" stroke="#6366f1" stroke-width="1" rx="1"/><text x="359" y="287" text-anchor="middle" font-size="7" fill="#4338ca">L1</text>
  <rect x="372" y="272" width="18" height="22" fill="#c7d2fe" stroke="#6366f1" stroke-width="1" rx="1"/><text x="381" y="287" text-anchor="middle" font-size="7" fill="#4338ca">L2</text>
  <rect x="394" y="272" width="18" height="22" fill="#c7d2fe" stroke="#6366f1" stroke-width="1" rx="1"/><text x="403" y="287" text-anchor="middle" font-size="7" fill="#4338ca">L3</text>
  <rect x="440" y="272" width="18" height="22" fill="#fde68a" stroke="#d97706" stroke-width="1" rx="1"/><text x="449" y="287" text-anchor="middle" font-size="7" fill="#92400e">SV</text>
  <rect x="462" y="272" width="18" height="22" fill="#fecaca" stroke="#dc2626" stroke-width="1" rx="1"/><text x="471" y="287" text-anchor="middle" font-size="7" fill="#991b1b">FF</text>
  <!-- Service corridor -->
  <rect x="260" y="350" width="320" height="40" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,3"/>
  <text x="420" y="375" text-anchor="middle" font-size="10" fill="#64748b">SERVICE CORRIDOR — 2.4m wide</text>
  <!-- Mgmt Office -->
  <rect x="60" y="320" width="200" height="100" fill="#f0fdf4" stroke="#16a34a" stroke-width="1.5"/>
  <text x="160" y="365" text-anchor="middle" font-size="12" fill="#166534" font-weight="bold">MGMT OFFICE</text>
  <text x="160" y="382" text-anchor="middle" font-size="10" fill="#22863a">65 sqm</text>
  <!-- Electrical Room -->
  <rect x="580" y="320" width="200" height="100" fill="#fef2f2" stroke="#dc2626" stroke-width="1.5"/>
  <text x="680" y="360" text-anchor="middle" font-size="12" fill="#991b1b" font-weight="bold">ELECTRICAL RM</text>
  <text x="680" y="377" text-anchor="middle" font-size="10" fill="#b91c1c">45 sqm — MDB+SMDB</text>
  <!-- Bottom row -->
  <rect x="60" y="420" width="140" height="100" fill="#f1f5f9" stroke="#475569" stroke-width="1"/>
  <text x="130" y="465" text-anchor="middle" font-size="10" fill="#334155" font-weight="bold">SECURITY</text>
  <text x="130" y="480" text-anchor="middle" font-size="9" fill="#64748b">25 sqm</text>
  <rect x="200" y="420" width="120" height="100" fill="#f1f5f9" stroke="#475569" stroke-width="1"/>
  <text x="260" y="465" text-anchor="middle" font-size="10" fill="#334155" font-weight="bold">TELECOM</text>
  <text x="260" y="480" text-anchor="middle" font-size="9" fill="#64748b">18 sqm</text>
  <rect x="320" y="420" width="240" height="100" fill="#fecaca" stroke="#dc2626" stroke-width="1.5"/>
  <text x="440" y="460" text-anchor="middle" font-size="12" fill="#991b1b" font-weight="bold">FIRE PUMP ROOM</text>
  <text x="440" y="478" text-anchor="middle" font-size="10" fill="#b91c1c">120 sqm — FFP + Jockey</text>
  <rect x="560" y="420" width="220" height="100" fill="#fef9c3" stroke="#ca8a04" stroke-width="1.5"/>
  <text x="670" y="460" text-anchor="middle" font-size="12" fill="#854d0e" font-weight="bold">GENERATOR RM</text>
  <text x="670" y="478" text-anchor="middle" font-size="10" fill="#a16207">85 sqm — 500 kVA</text>
  <!-- Parking ramp -->
  <rect x="60" y="520" width="720" height="30" fill="#e2e8f0" stroke="#64748b" stroke-width="1" stroke-dasharray="6,3"/>
  <text x="420" y="540" text-anchor="middle" font-size="10" fill="#475569">↓ PARKING RAMP DOWN — Basement 1 (120 cars)</text>
  <!-- Dimensions -->
  <line x1="60" y1="565" x2="780" y2="565" stroke="#9ca3af" stroke-width="1" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
  <text x="420" y="580" text-anchor="middle" font-size="10" fill="#6b7280">42.0 m</text>
  <line x1="800" y1="70" x2="800" y2="550" stroke="#9ca3af" stroke-width="1"/>
  <text x="815" y="310" text-anchor="middle" font-size="10" fill="#6b7280" transform="rotate(90,815,310)">28.0 m</text>
  <!-- Column grid dots -->
  ${[0,1,2,3,4,5].map(i => [0,1,2,3].map(j => `<circle cx="${100+i*140}" cy="${90+j*140}" r="4" fill="#94a3b8" opacity="0.4"/>`).join('')).join('')}
  <!-- North arrow -->
  <g transform="translate(770,80)"><polygon points="0,-20 -8,5 0,-5 8,5" fill="#1e293b"/><text x="0" y="18" text-anchor="middle" font-size="11" fill="#1e293b" font-weight="bold">N</text></g>
</svg>`;

const TYPICAL_FLOOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 840 600" font-family="Arial,sans-serif">
  <defs><pattern id="grid2" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e5e7eb" stroke-width="0.5"/></pattern></defs>
  <rect width="840" height="600" fill="#f8fafc"/>
  <rect width="840" height="600" fill="url(#grid2)"/>
  <rect x="10" y="10" width="820" height="40" fill="#1e293b" rx="4"/>
  <text x="25" y="36" fill="white" font-size="14" font-weight="bold">ARCH-TF-01 — TYPICAL FLOOR PLAN (Floors 1–20)</text>
  <text x="620" y="36" fill="#94a3b8" font-size="11">Creek Vista Residences | Scale 1:100</text>
  <!-- Building outline -->
  <rect x="60" y="70" width="720" height="480" fill="none" stroke="#334155" stroke-width="3" rx="2"/>
  <!-- North label -->
  <rect x="200" y="70" width="440" height="22" fill="#dbeafe" stroke="#3b82f6" stroke-width="1"/>
  <text x="420" y="87" text-anchor="middle" font-size="9" fill="#1e40af" font-weight="bold">NORTH FACADE — Creek View (Balconies)</text>
  <!-- APT 01 - 3BR -->
  <rect x="60" y="92" width="260" height="190" fill="#dbeafe" stroke="#2563eb" stroke-width="2" rx="2"/>
  <text x="190" y="115" text-anchor="middle" font-size="14" fill="#1e40af" font-weight="bold">APT 01 — 3BR</text>
  <text x="190" y="132" text-anchor="middle" font-size="11" fill="#3b82f6">1,450 sqft + Maid Room</text>
  <!-- Rooms inside apt 01 -->
  <rect x="70" y="140" width="80" height="60" fill="#bfdbfe" stroke="#60a5fa" stroke-width="1" rx="1"/>
  <text x="110" y="165" text-anchor="middle" font-size="9" fill="#1e40af" font-weight="bold">Master BR</text>
  <text x="110" y="177" text-anchor="middle" font-size="8" fill="#3b82f6">18 sqm</text>
  <rect x="155" y="140" width="55" height="60" fill="#e0f2fe" stroke="#60a5fa" stroke-width="1" rx="1"/>
  <text x="182" y="165" text-anchor="middle" font-size="9" fill="#1e40af">BR 2</text>
  <text x="182" y="177" text-anchor="middle" font-size="8" fill="#3b82f6">14m²</text>
  <rect x="215" y="140" width="55" height="60" fill="#e0f2fe" stroke="#60a5fa" stroke-width="1" rx="1"/>
  <text x="242" y="165" text-anchor="middle" font-size="9" fill="#1e40af">BR 3</text>
  <text x="242" y="177" text-anchor="middle" font-size="8" fill="#3b82f6">12m²</text>
  <rect x="70" y="205" width="240" height="55" fill="#eff6ff" stroke="#60a5fa" stroke-width="1" rx="1"/>
  <text x="190" y="230" text-anchor="middle" font-size="11" fill="#1e40af" font-weight="bold">Living + Dining 42 sqm</text>
  <rect x="70" y="262" width="100" height="16" fill="#f0fdf4" stroke="#86efac" stroke-width="0.5" rx="1"/>
  <text x="120" y="273" text-anchor="middle" font-size="7" fill="#166534">Kitchen 14m²</text>
  <!-- APT 02 - 2BR -->
  <rect x="320" y="92" width="200" height="190" fill="#dcfce7" stroke="#16a34a" stroke-width="2" rx="2"/>
  <text x="420" y="115" text-anchor="middle" font-size="14" fill="#166534" font-weight="bold">APT 02 — 2BR</text>
  <text x="420" y="132" text-anchor="middle" font-size="11" fill="#22c55e">1,100 sqft</text>
  <rect x="330" y="140" width="70" height="50" fill="#bbf7d0" stroke="#4ade80" stroke-width="1" rx="1"/>
  <text x="365" y="163" text-anchor="middle" font-size="9" fill="#166534">Master</text>
  <text x="365" y="175" text-anchor="middle" font-size="8" fill="#16a34a">16m²</text>
  <rect x="405" y="140" width="55" height="50" fill="#d1fae5" stroke="#4ade80" stroke-width="1" rx="1"/>
  <text x="432" y="163" text-anchor="middle" font-size="9" fill="#166534">BR 2</text>
  <text x="432" y="175" text-anchor="middle" font-size="8" fill="#16a34a">12m²</text>
  <rect x="330" y="195" width="180" height="55" fill="#ecfdf5" stroke="#4ade80" stroke-width="1" rx="1"/>
  <text x="420" y="225" text-anchor="middle" font-size="10" fill="#166534">Living + Dining 32 sqm</text>
  <!-- APT 03 - 1BR -->
  <rect x="520" y="92" width="160" height="190" fill="#fef3c7" stroke="#d97706" stroke-width="2" rx="2"/>
  <text x="600" y="115" text-anchor="middle" font-size="14" fill="#92400e" font-weight="bold">APT 03 — 1BR</text>
  <text x="600" y="132" text-anchor="middle" font-size="11" fill="#d97706">680 sqft</text>
  <rect x="530" y="140" width="65" height="50" fill="#fde68a" stroke="#fbbf24" stroke-width="1" rx="1"/>
  <text x="562" y="165" text-anchor="middle" font-size="9" fill="#92400e">Master</text>
  <text x="562" y="177" text-anchor="middle" font-size="8" fill="#b45309">14m²</text>
  <rect x="530" y="195" width="140" height="55" fill="#fefce8" stroke="#fbbf24" stroke-width="1" rx="1"/>
  <text x="600" y="225" text-anchor="middle" font-size="10" fill="#92400e">Living 28 sqm</text>
  <!-- Balconies (north) -->
  <rect x="60" y="70" width="260" height="22" fill="#bae6fd" stroke="#0284c7" stroke-width="0.5" opacity="0.6" rx="1"/>
  <rect x="320" y="70" width="200" height="22" fill="#bae6fd" stroke="#0284c7" stroke-width="0.5" opacity="0.6" rx="1"/>
  <rect x="520" y="70" width="160" height="22" fill="#bae6fd" stroke="#0284c7" stroke-width="0.5" opacity="0.6" rx="1"/>
  <!-- Corridor -->
  <rect x="60" y="282" width="720" height="50" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="4,3"/>
  <text x="150" y="312" font-size="10" fill="#475569" font-weight="bold">CORRIDOR 2.0m</text>
  <!-- Elevator Core (center) -->
  <rect x="320" y="282" width="200" height="50" fill="#e0e7ff" stroke="#4f46e5" stroke-width="2" rx="2"/>
  <text x="420" y="305" text-anchor="middle" font-size="10" fill="#3730a3" font-weight="bold">ELEVATOR CORE</text>
  <text x="420" y="318" text-anchor="middle" font-size="8" fill="#4f46e5">3P + 1SV + 1FF | Stair A + B</text>
  <!-- APT 04 - 2BR (mirror of 02) -->
  <rect x="60" y="332" width="260" height="190" fill="#dcfce7" stroke="#16a34a" stroke-width="2" rx="2"/>
  <text x="190" y="355" text-anchor="middle" font-size="14" fill="#166534" font-weight="bold">APT 04 — 2BR</text>
  <text x="190" y="372" text-anchor="middle" font-size="11" fill="#22c55e">1,100 sqft (mirror)</text>
  <!-- APT 05 - 2BR -->
  <rect x="320" y="332" width="200" height="190" fill="#dcfce7" stroke="#16a34a" stroke-width="2" rx="2"/>
  <text x="420" y="355" text-anchor="middle" font-size="14" fill="#166534" font-weight="bold">APT 05 — 2BR</text>
  <text x="420" y="372" text-anchor="middle" font-size="11" fill="#22c55e">1,100 sqft (mirror)</text>
  <!-- APT 06 - 1BR -->
  <rect x="520" y="332" width="160" height="190" fill="#fef3c7" stroke="#d97706" stroke-width="2" rx="2"/>
  <text x="600" y="355" text-anchor="middle" font-size="14" fill="#92400e" font-weight="bold">APT 06 — 1BR</text>
  <text x="600" y="372" text-anchor="middle" font-size="11" fill="#d97706">680 sqft (mirror)</text>
  <!-- South label -->
  <rect x="200" y="522" width="440" height="22" fill="#fce7f3" stroke="#db2777" stroke-width="1"/>
  <text x="420" y="537" text-anchor="middle" font-size="9" fill="#9d174d" font-weight="bold">SOUTH FACADE — City View (Balconies)</text>
  <!-- Balconies (south) -->
  <rect x="60" y="522" width="260" height="22" fill="#bae6fd" stroke="#0284c7" stroke-width="0.5" opacity="0.6" rx="1"/>
  <rect x="320" y="522" width="200" height="22" fill="#bae6fd" stroke="#0284c7" stroke-width="0.5" opacity="0.6" rx="1"/>
  <rect x="520" y="522" width="160" height="22" fill="#bae6fd" stroke="#0284c7" stroke-width="0.5" opacity="0.6" rx="1"/>
  <!-- Unit summary -->
  <rect x="60" y="555" width="720" height="35" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1" rx="4"/>
  <text x="80" y="577" font-size="10" fill="#334155" font-weight="bold">Per Floor: 1×3BR (1,450sf) + 3×2BR (1,100sf ea) + 2×1BR (680sf ea) = 6 units | 6,810sf net + 1,690sf common = 8,500sf gross</text>
  <!-- North arrow -->
  <g transform="translate(770,80)"><polygon points="0,-20 -8,5 0,-5 8,5" fill="#1e293b"/><text x="0" y="18" text-anchor="middle" font-size="11" fill="#1e293b" font-weight="bold">N</text></g>
  <!-- Column grid dots -->
  ${[0,1,2,3,4,5].map(i => [0,1,2,3,4].map(j => `<circle cx="${100+i*140}" cy="${100+j*120}" r="3" fill="#94a3b8" opacity="0.3"/>`).join('')).join('')}
</svg>`;

const BUILDING_SECTION_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 840 600" font-family="Arial,sans-serif">
  <rect width="840" height="600" fill="#f8fafc"/>
  <rect x="10" y="10" width="820" height="40" fill="#1e293b" rx="4"/>
  <text x="25" y="36" fill="white" font-size="14" font-weight="bold">ARCH-SEC-01 — BUILDING SECTION A-A</text>
  <text x="640" y="36" fill="#94a3b8" font-size="11">Creek Vista | Scale 1:200</text>
  <!-- Ground level line -->
  <line x1="50" y1="430" x2="790" y2="430" stroke="#16a34a" stroke-width="2" stroke-dasharray="8,4"/>
  <text x="55" y="443" font-size="9" fill="#16a34a" font-weight="bold">± 0.000 GL</text>
  <!-- Basement 2 -->
  <rect x="200" y="470" width="440" height="35" fill="#fef2f2" stroke="#dc2626" stroke-width="1.5"/>
  <text x="420" y="492" text-anchor="middle" font-size="10" fill="#991b1b" font-weight="bold">BASEMENT 2 — Parking 110 cars | Water Tanks</text>
  <text x="650" y="492" font-size="9" fill="#64748b">−6.500</text>
  <!-- Basement 1 -->
  <rect x="200" y="435" width="440" height="35" fill="#fff7ed" stroke="#ea580c" stroke-width="1.5"/>
  <text x="420" y="457" text-anchor="middle" font-size="10" fill="#9a3412" font-weight="bold">BASEMENT 1 — Parking 120 cars | MEP Plant</text>
  <text x="650" y="457" font-size="9" fill="#64748b">−3.500</text>
  <!-- Ground floor -->
  <rect x="200" y="395" width="440" height="35" fill="#ecfdf5" stroke="#16a34a" stroke-width="2"/>
  <text x="420" y="417" text-anchor="middle" font-size="10" fill="#166534" font-weight="bold">GROUND — Lobby 6.0m | Retail | Entrance</text>
  <text x="650" y="417" font-size="9" fill="#64748b">+0.300</text>
  <!-- Podium -->
  <rect x="180" y="360" width="480" height="35" fill="#fef3c7" stroke="#d97706" stroke-width="1.5"/>
  <text x="420" y="382" text-anchor="middle" font-size="10" fill="#92400e" font-weight="bold">PODIUM — Gym | Pool | Amenity Deck</text>
  <text x="670" y="382" font-size="9" fill="#64748b">+5.000</text>
  <!-- Typical floors (stacked) -->
  ${Array.from({length: 10}, (_, i) => {
    const y = 350 - (i + 1) * 18;
    const floor = i + 1;
    const isLabel = floor === 1 || floor === 5 || floor === 10;
    return `<rect x="200" y="${y}" width="440" height="17" fill="${floor % 2 === 0 ? '#eff6ff' : '#f8fafc'}" stroke="#94a3b8" stroke-width="0.5"/>
    ${isLabel ? `<text x="420" y="${y + 13}" text-anchor="middle" font-size="8" fill="#475569">${floor === 10 ? '10F–20F Typical' : floor === 5 ? '5th Floor' : '1st Floor'} — 6 Apartments</text>` : ''}
    <text x="650" y="${y + 12}" font-size="7" fill="#94a3b8">+${(8.5 + floor * 3.2).toFixed(1)}</text>`;
  }).join('')}
  <!-- Floors 11-20 label block -->
  <rect x="200" y="100" width="440" height="70" fill="#dbeafe" stroke="#3b82f6" stroke-width="1"/>
  <text x="420" y="130" text-anchor="middle" font-size="12" fill="#1e40af" font-weight="bold">FLOORS 11–20</text>
  <text x="420" y="148" text-anchor="middle" font-size="9" fill="#3b82f6">10 Typical Floors × 3.2m = 32.0m</text>
  <text x="650" y="148" font-size="8" fill="#94a3b8">+40.5 to +72.5</text>
  <!-- Roof plant -->
  <rect x="220" y="65" width="400" height="35" fill="#e2e8f0" stroke="#475569" stroke-width="2"/>
  <text x="420" y="87" text-anchor="middle" font-size="10" fill="#1e293b" font-weight="bold">ROOF PLANT — Chillers | FAHU | Pumps</text>
  <text x="630" y="87" font-size="9" fill="#64748b">+73.6</text>
  <!-- Equipment on roof -->
  <rect x="240" y="55" width="50" height="12" fill="#93c5fd" stroke="#3b82f6" stroke-width="1" rx="2"/>
  <text x="265" y="64" text-anchor="middle" font-size="7" fill="#1e40af">CH-1</text>
  <rect x="300" y="55" width="40" height="12" fill="#93c5fd" stroke="#3b82f6" stroke-width="1" rx="2"/>
  <text x="320" y="64" text-anchor="middle" font-size="7" fill="#1e40af">CH-2</text>
  <rect x="360" y="55" width="60" height="12" fill="#fed7aa" stroke="#ea580c" stroke-width="1" rx="2"/>
  <text x="390" y="64" text-anchor="middle" font-size="7" fill="#9a3412">FAHU-1</text>
  <rect x="430" y="55" width="60" height="12" fill="#fed7aa" stroke="#ea580c" stroke-width="1" rx="2"/>
  <text x="460" y="64" text-anchor="middle" font-size="7" fill="#9a3412">FAHU-2</text>
  <!-- Height dimension -->
  <line x1="170" y1="65" x2="170" y2="505" stroke="#6b7280" stroke-width="1"/>
  <text x="160" y="290" text-anchor="middle" font-size="10" fill="#475569" font-weight="bold" transform="rotate(-90,160,290)">82.8m Total Height</text>
  <!-- Foundation -->
  <rect x="160" y="505" width="520" height="20" fill="#d6d3d1" stroke="#78716c" stroke-width="2"/>
  <text x="420" y="519" text-anchor="middle" font-size="9" fill="#57534e" font-weight="bold">RAFT FOUNDATION — 1.2m thick | Bored piles 600mm × 20m</text>
  <!-- Perforated screen -->
  <line x1="220" y1="55" x2="220" y2="65" stroke="#475569" stroke-width="2"/>
  <line x1="620" y1="55" x2="620" y2="65" stroke="#475569" stroke-width="2"/>
  <text x="520" y="52" font-size="7" fill="#64748b">Perforated screen wall 2.4m</text>
</svg>`;

// Map attachment IDs to SVG previews
export const DRAWING_PREVIEWS: Record<string, string> = {
  'att-arch-gf': GROUND_FLOOR_SVG,
  'att-arch-tf': TYPICAL_FLOOR_SVG,
  'att-arch-sec': BUILDING_SECTION_SVG,
};

export function getDrawingPreview(attachmentId: string): string | null {
  return DRAWING_PREVIEWS[attachmentId] || null;
}
