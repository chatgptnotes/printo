interface PriceItem {
  id: string;
  discipline: string;
  category: string;
  item_name: string;
  description: string | null;
  unit: string;
  unit_rate_aed: number;
  brand: string | null;
  notes: string | null;
  updated_at: string;
}

const globalStore = globalThis as unknown as { __demoPriceLibrary?: PriceItem[] };

function getStore(): PriceItem[] {
  if (!globalStore.__demoPriceLibrary) {
    globalStore.__demoPriceLibrary = [...SEED_DATA];
  }
  return globalStore.__demoPriceLibrary;
}

export function getDemoPriceItems(discipline?: string | null, category?: string | null): PriceItem[] {
  let items = getStore();
  if (discipline) items = items.filter(i => i.discipline === discipline);
  if (category) items = items.filter(i => i.category === category);
  return items.sort((a, b) => a.discipline.localeCompare(b.discipline) || a.category.localeCompare(b.category) || a.item_name.localeCompare(b.item_name));
}

export function addDemoPriceItem(item: Omit<PriceItem, 'id' | 'updated_at'>): PriceItem {
  const newItem: PriceItem = {
    ...item,
    id: `price-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    updated_at: new Date().toISOString(),
  };
  getStore().push(newItem);
  return newItem;
}

export function updateDemoPriceItem(id: string, updates: Partial<PriceItem>): PriceItem | null {
  const store = getStore();
  const idx = store.findIndex(i => i.id === id);
  if (idx === -1) return null;
  store[idx] = { ...store[idx], ...updates, updated_at: new Date().toISOString() };
  return store[idx];
}

export function deleteDemoPriceItem(id: string): boolean {
  const store = getStore();
  const idx = store.findIndex(i => i.id === id);
  if (idx === -1) return false;
  store.splice(idx, 1);
  return true;
}

let counter = 0;
function item(discipline: string, category: string, item_name: string, unit: string, rate: number, brand: string | null = null, notes: string | null = null, description: string | null = null): PriceItem {
  return {
    id: `seed-${++counter}`,
    discipline, category, item_name, description, unit,
    unit_rate_aed: rate, brand, notes,
    updated_at: '2025-03-15T00:00:00Z',
  };
}

const SEED_DATA: PriceItem[] = [
  // ═══════════════════════════════════════
  // HVAC
  // ═══════════════════════════════════════

  // Equipment
  item('hvac', 'Equipment', 'VRF Outdoor Unit (10-16 HP)', 'nos', 18500, 'Daikin/Mitsubishi', 'Air-cooled, inverter scroll compressor, R-410A'),
  item('hvac', 'Equipment', 'VRF Outdoor Unit (20-24 HP)', 'nos', 32000, 'Daikin/Mitsubishi', 'Modular, high COP ≥3.8'),
  item('hvac', 'Equipment', 'VRF Outdoor Unit (28-30 HP)', 'nos', 42000, 'Daikin/Mitsubishi', 'Large capacity, multi-module'),
  item('hvac', 'Equipment', 'DX Split Unit (1.5 TR)', 'nos', 3500, 'Carrier/Trane', 'Wall/ceiling mounted, R-410A'),
  item('hvac', 'Equipment', 'DX Split Unit (2.5 TR)', 'nos', 5200, 'Carrier/Trane', 'Ducted, ceiling concealed'),
  item('hvac', 'Equipment', 'DX Split Unit (3.5 TR)', 'nos', 7500, 'Carrier/Trane', 'Ducted, high static'),
  item('hvac', 'Equipment', 'Package Unit (5 TR, Rooftop)', 'nos', 22000, 'Carrier/York', 'Single package, DX cooling'),
  item('hvac', 'Equipment', 'Package Unit (10 TR, Rooftop)', 'nos', 38000, 'Carrier/York', 'Large rooftop, economizer'),
  item('hvac', 'Equipment', 'Air-Cooled Chiller (150 TR)', 'nos', 180000, 'Carrier/Trane/York', 'Scroll compressor, R-134a'),
  item('hvac', 'Equipment', 'Air-Cooled Chiller (350 TR)', 'nos', 350000, 'Carrier/Trane/York', 'Screw compressor, high efficiency'),
  item('hvac', 'Equipment', 'Water-Cooled Chiller (500 TR)', 'nos', 420000, 'Carrier/Trane', 'Centrifugal, VFD, R-134a'),
  item('hvac', 'Equipment', 'Cooling Tower (200 TR)', 'nos', 65000, 'Baltimore/Marley', 'FRP, counter-flow, low noise'),
  item('hvac', 'Equipment', 'ETS — Energy Transfer Station (500 TR)', 'set', 280000, null, 'District cooling, plate HX + pumps + controls'),

  // Indoor Units
  item('hvac', 'Indoor Units', 'VRF Indoor — Wall Mount (Decorative)', 'nos', 2800, 'Daikin/Mitsubishi', '2.2-3.5 kW, wireless controller'),
  item('hvac', 'Indoor Units', 'VRF Indoor — Ceiling Cassette 4-Way', 'nos', 3200, 'Daikin/Mitsubishi', '3.5-5.6 kW, decorative panel'),
  item('hvac', 'Indoor Units', 'VRF Indoor — Ducted (Ceiling Concealed)', 'nos', 3500, 'Daikin/Mitsubishi', '5.6-14 kW, medium/high ESP'),
  item('hvac', 'Indoor Units', 'FCU — Fan Coil Unit (2-Pipe)', 'nos', 2800, 'Carrier/Trane', 'Ceiling concealed, 3-speed'),
  item('hvac', 'Indoor Units', 'FCU — Fan Coil Unit (4-Pipe)', 'nos', 3800, 'Carrier/Trane', 'Ceiling concealed, heating+cooling'),
  item('hvac', 'Indoor Units', 'AHU — Air Handling Unit (5000 CFM)', 'nos', 35000, 'Carrier/Daikin', 'Double skin, MERV 13 filter, EC fan'),
  item('hvac', 'Indoor Units', 'AHU — Air Handling Unit (10000 CFM)', 'nos', 55000, 'Carrier/Daikin', 'Double skin, energy recovery, VFD'),
  item('hvac', 'Indoor Units', 'FAHU — Fresh Air Handling Unit', 'nos', 55000, 'Carrier/Daikin', 'With enthalpy wheel energy recovery'),

  // Ductwork
  item('hvac', 'Ductwork', 'GI Ductwork — Supply + Return', 'sqft', 45, null, 'Galvanized steel, SMACNA class, flanged joints', 'Rectangular GI duct 0.8mm-1.2mm gauge'),
  item('hvac', 'Ductwork', 'GI Ductwork — Kitchen Exhaust (SS)', 'sqft', 85, null, 'Stainless steel 304, welded seams'),
  item('hvac', 'Ductwork', 'Pre-insulated Duct (Fresh Air)', 'sqft', 65, 'Daikin/Purever', 'PIR foam, aluminium faced, R-value 1.4'),
  item('hvac', 'Ductwork', 'Flexible Duct Connection', 'nos', 85, null, '200-300mm, neoprene/canvas'),
  item('hvac', 'Ductwork', 'Spiral Round Duct', 'Rmt', 55, null, '100-300mm diameter, galvanized'),

  // Duct Accessories
  item('hvac', 'Duct Accessories', 'Volume Control Damper (VCD)', 'nos', 350, null, 'Galvanized, opposed blade'),
  item('hvac', 'Duct Accessories', 'Fire Damper (Intumescent)', 'nos', 650, 'Ruskin/Actionair', 'UL listed, fusible link 72°C'),
  item('hvac', 'Duct Accessories', 'Smoke/Fire Damper (Motorized)', 'nos', 1200, 'Ruskin/Actionair', 'With actuator + end switch'),
  item('hvac', 'Duct Accessories', 'Sound Attenuator', 'nos', 1200, 'IAC/Vibro-Acoustics', 'Splitter type, 25dB insertion loss'),
  item('hvac', 'Duct Accessories', 'Sand Trap Louver', 'nos', 950, null, 'Aluminium, weather-proof, insect screen'),
  item('hvac', 'Duct Accessories', 'Non-Return Damper (Backdraft)', 'nos', 280, null, 'Gravity type, aluminium blades'),

  // Air Terminals
  item('hvac', 'Air Terminals', 'Ceiling Diffuser — Square (4-Way)', 'nos', 180, 'Titus/Anemostat', '300×300 to 600×600, adj. pattern'),
  item('hvac', 'Air Terminals', 'Ceiling Diffuser — Round (Swirl)', 'nos', 220, 'Titus/Trox', '250-400mm, fixed vane'),
  item('hvac', 'Air Terminals', 'Linear Slot Diffuser (2-Slot)', 'Rmt', 180, 'Trox/Price', '1-4 slots, adjustable, with plenum'),
  item('hvac', 'Air Terminals', 'Linear Slot Diffuser (4-Slot)', 'Rmt', 320, 'Trox/Price', '4 slots, concealed frame'),
  item('hvac', 'Air Terminals', 'Return Air Grille', 'nos', 120, null, 'Fixed core, aluminium, powder coated'),
  item('hvac', 'Air Terminals', 'Exhaust Grille (Fixed Blade)', 'nos', 100, null, 'Aluminium, 45° fixed blades'),
  item('hvac', 'Air Terminals', 'Floor-Mounted Diffuser (Swirl)', 'nos', 450, 'Trox', 'For raised floor, adjustable'),
  item('hvac', 'Air Terminals', 'Jet Nozzle (Car Park)', 'nos', 850, 'Trox/Novenco', 'Long throw, 10-20m range'),

  // Piping (Refrigerant)
  item('hvac', 'Piping', 'Copper Refrigerant Pipe — 3/8" (Liquid)', 'Rmt', 45, null, 'ACR grade, dehydrated, capped'),
  item('hvac', 'Piping', 'Copper Refrigerant Pipe — 5/8" (Gas)', 'Rmt', 75, null, 'ACR grade, dehydrated'),
  item('hvac', 'Piping', 'Copper Refrigerant Pipe — 7/8" (Gas)', 'Rmt', 95, null, 'ACR grade, brazed joints'),
  item('hvac', 'Piping', 'Copper Refrigerant Pipe — 1-1/8" (Main)', 'Rmt', 135, null, 'ACR grade, main riser'),
  item('hvac', 'Piping', 'Refrigerant Pipe Insulation (Armaflex)', 'Rmt', 35, 'Armacell', '13mm/19mm wall, Class O'),
  item('hvac', 'Piping', 'Y-Joint / Branch Header (VRF)', 'nos', 280, 'Daikin/Mitsubishi', 'Per branch point'),
  item('hvac', 'Piping', 'CHW Pipe — MS (50mm)', 'Rmt', 120, null, 'Mild steel, Schedule 40, welded'),
  item('hvac', 'Piping', 'CHW Pipe — MS (100mm)', 'Rmt', 180, null, 'Mild steel, Schedule 40, flanged'),
  item('hvac', 'Piping', 'CHW Pipe — MS (150mm)', 'Rmt', 250, null, 'Main header, Schedule 40'),
  item('hvac', 'Piping', 'CHW Pipe Insulation (50mm)', 'Rmt', 55, 'Armacell', 'Closed-cell, vapour barrier'),

  // Condensate
  item('hvac', 'Condensate', 'uPVC Condensate Drain Pipe (25mm)', 'Rmt', 35, null, 'With fittings and slope'),
  item('hvac', 'Condensate', 'uPVC Condensate Drain Pipe (40mm)', 'Rmt', 45, null, 'Main drain header'),
  item('hvac', 'Condensate', 'Condensate Drain Pump', 'nos', 650, 'Aspen/Sauermann', 'Mini pump, auto-sense'),

  // Insulation
  item('hvac', 'Insulation', 'Duct Insulation — 25mm Closed-Cell', 'sqft', 25, 'Armacell/K-Flex', 'Aluminium foil faced, Class O'),
  item('hvac', 'Insulation', 'Duct Insulation — 50mm (Outdoor)', 'sqft', 45, 'Armacell/K-Flex', 'UV resistant cladding'),

  // Ventilation
  item('hvac', 'Ventilation', 'Exhaust Fan — Toilet/Kitchen (Inline)', 'nos', 850, 'Systemair/S&P', '150-250mm, low noise <35dB'),
  item('hvac', 'Ventilation', 'Exhaust Fan — Kitchen Hood', 'nos', 2800, 'Systemair/Nicotra', 'Centrifugal, 1500-3000 CFM'),
  item('hvac', 'Ventilation', 'Car Park Jet Fan', 'nos', 4500, 'Systemair/Novenco', 'Reversible, 40m throw, F400 rated'),
  item('hvac', 'Ventilation', 'Car Park Supply/Extract Fan', 'nos', 8500, 'Systemair/Nicotra', '20,000 CFM, belt-driven, VFD'),
  item('hvac', 'Ventilation', 'Inline Fresh Air Fan', 'nos', 1800, 'Systemair/S&P', '200-400mm, EC motor'),
  item('hvac', 'Ventilation', 'Staircase Pressurisation Fan', 'nos', 12000, 'Systemair/Nicotra', '10,000 CFM, F300, VFD'),

  // Controls
  item('hvac', 'Controls', 'Thermostat — Wired (Digital)', 'nos', 180, null, '7-day programmable, LCD'),
  item('hvac', 'Controls', 'Thermostat — Wireless (Smart)', 'nos', 350, 'Honeywell/Nest', 'WiFi, app control'),
  item('hvac', 'Controls', 'VRF Central Controller (64-unit)', 'nos', 8500, 'Daikin/Mitsubishi', 'Touch screen, scheduling, BMS gateway'),
  item('hvac', 'Controls', 'BACnet Gateway (VRF to BMS)', 'nos', 4500, 'Intesis/Daikin', 'Protocol converter'),
  item('hvac', 'Controls', 'CO2 Sensor (DCV)', 'nos', 850, 'Honeywell/Siemens', 'Duct mount, 0-2000ppm, BACnet'),
  item('hvac', 'Controls', 'BTU Meter (Ultrasonic)', 'nos', 2800, 'Kamstrup/Danfoss', 'DN25-DN50, M-Bus output'),

  // Testing
  item('hvac', 'Testing & Commissioning', 'TAB — Testing, Adjusting & Balancing', 'Job', 35000, null, 'Full system, NEBB/AABC certified'),
  item('hvac', 'Testing & Commissioning', 'VRF Commissioning (per system)', 'Job', 15000, null, 'Factory startup, refrigerant charge, performance test'),
  item('hvac', 'Testing & Commissioning', 'Chiller Commissioning', 'Job', 25000, null, 'Factory engineer, performance curves, integration'),
  item('hvac', 'Testing & Commissioning', 'Duct Leakage Test', 'Job', 8000, null, 'Class B per SMACNA'),
  item('hvac', 'Testing & Commissioning', 'System Commissioning & Handover', 'Job', 25000, null, 'Full documentation, O&M manuals, training'),

  // Supports
  item('hvac', 'Supports', 'Duct Supports, Hangers & Brackets', 'LS', 65000, null, 'Threaded rod, channel, clevis, seismic bracing'),
  item('hvac', 'Supports', 'Pipe Supports & Hangers', 'LS', 35000, null, 'Clevis, riser clamps, guides, anchors'),
  item('hvac', 'Supports', 'Vibration Isolator — Spring Type', 'nos', 450, 'Mason/Kinetics', '25mm deflection, rated for equipment weight'),
  item('hvac', 'Supports', 'Vibration Isolator — Rubber Pad', 'nos', 180, null, 'Neoprene, 50 Shore A'),
  item('hvac', 'Supports', 'Equipment Foundation (Concrete Base)', 'nos', 1200, null, 'RC pad, 150mm thick, with rails'),

  // Electrical (HVAC)
  item('hvac', 'Electrical (HVAC)', 'Power Cabling — HVAC Equipment', 'LS', 85000, null, 'XLPE/SWA, from SMDB to all HVAC units'),
  item('hvac', 'Electrical (HVAC)', 'Control Wiring — BMS/VRF', 'LS', 45000, null, 'Shielded 2C/4C, comms cables'),
  item('hvac', 'Electrical (HVAC)', 'Isolator Switch (32A TPN)', 'nos', 120, 'ABB/Schneider', 'At each outdoor unit'),
  item('hvac', 'Electrical (HVAC)', 'MCB (20-63A)', 'nos', 85, 'ABB/Schneider', 'Type C, 10kA'),

  // ═══════════════════════════════════════
  // ELECTRICAL
  // ═══════════════════════════════════════
  item('electrical', 'Switchgear', 'MDB — Main Distribution Board (4000A)', 'nos', 85000, 'ABB/Schneider', 'Form 4, ACB incomer, MCCB outgoers'),
  item('electrical', 'Switchgear', 'SMDB — Sub-Main DB (800A)', 'nos', 28000, 'ABB/Schneider', 'MCCB incomer, MCB outgoers'),
  item('electrical', 'Switchgear', 'DB — Distribution Board (TPN, 12-way)', 'nos', 4500, 'ABB/Schneider', 'Per apartment/unit'),
  item('electrical', 'Switchgear', 'DB — Distribution Board (TPN, 24-way)', 'nos', 6500, 'ABB/Schneider', 'Common area/floor'),
  item('electrical', 'Switchgear', 'ATS — Automatic Transfer Switch (1000A)', 'nos', 25000, 'ABB/Socomec', 'Motorized, 4-pole'),
  item('electrical', 'Switchgear', 'Capacitor Bank (200 kVAr)', 'nos', 18000, 'ABB/Schneider', 'Auto PF correction, detuned'),
  item('electrical', 'Cables', 'XLPE/SWA Cable (4C × 16mm²)', 'Rmt', 45, 'Ducab/KEI', 'LV, copper, armoured'),
  item('electrical', 'Cables', 'XLPE/SWA Cable (4C × 70mm²)', 'Rmt', 120, 'Ducab/KEI', 'LV sub-main'),
  item('electrical', 'Cables', 'XLPE/SWA Cable (4C × 240mm²)', 'Rmt', 380, 'Ducab/KEI', 'LV main feeder'),
  item('electrical', 'Cables', 'Busbar Rising Main (1600A)', 'Rmt', 2800, 'Schneider/Siemens', 'Aluminium, fire rated'),
  item('electrical', 'Cables', 'Cable Tray — GI (300mm)', 'Rmt', 85, null, 'Perforated, hot-dip galvanized'),
  item('electrical', 'Cables', 'Cable Tray — GI (600mm)', 'Rmt', 135, null, 'Ladder type, heavy duty'),
  item('electrical', 'Fixtures', 'LED Downlight (12W, Recessed)', 'nos', 120, 'Philips/Osram', 'CRI≥80, 4000K, IP44'),
  item('electrical', 'Fixtures', 'LED Panel (40W, 600×600)', 'nos', 180, 'Philips/Osram', 'CRI≥80, 4000K, UGR<19'),
  item('electrical', 'Fixtures', 'LED Troffer (2×4, 50W)', 'nos', 220, 'Philips', 'Recessed, edge-lit'),
  item('electrical', 'Fixtures', 'LED Bulkhead (Emergency, 3hr)', 'nos', 180, 'Legrand/Eaton', 'Maintained, battery backup'),
  item('electrical', 'Fixtures', 'Exit Sign (LED, Maintained)', 'nos', 150, 'Legrand', 'Green running man, 3hr battery'),
  item('electrical', 'Accessories', 'Switch (1-Gang, 2-Way)', 'nos', 25, 'ABB/Legrand', 'White, flush mount'),
  item('electrical', 'Accessories', 'Socket (13A, Twin, Switched)', 'nos', 45, 'ABB/Legrand', 'With neon indicator'),
  item('electrical', 'Accessories', 'Socket (15A, Round, AC)', 'nos', 35, 'ABB/Legrand', 'For AC outdoor unit'),
  item('electrical', 'Accessories', 'Fan Isolator (10A)', 'nos', 28, 'ABB/Legrand', 'For exhaust fan'),
  item('electrical', 'Power', 'Transformer (1500 kVA, 11/0.4kV)', 'nos', 120000, 'ABB/Schneider', 'ONAN, DEWA approved'),
  item('electrical', 'Power', 'Diesel Generator (500 kVA)', 'nos', 180000, 'Cummins/Perkins', 'Soundproof canopy, ATS panel, day tank'),
  item('electrical', 'Power', 'UPS (30 kVA, Online)', 'nos', 35000, 'APC/Eaton', 'Double conversion, 30 min battery'),
  item('electrical', 'Power', 'Earthing System (Complete)', 'LS', 25000, null, 'Copper tape, rods, TT system'),
  item('electrical', 'Power', 'Lightning Protection System', 'LS', 35000, null, 'ESE/conventional, down conductors, earth pits'),

  // ═══════════════════════════════════════
  // PLUMBING
  // ═══════════════════════════════════════
  item('plumbing', 'Pipes', 'PPR Pipe (25mm, Hot Water)', 'Rmt', 18, 'Kalde/Wavin', 'PN20, Class 5'),
  item('plumbing', 'Pipes', 'PPR Pipe (32mm, Hot Water)', 'Rmt', 25, 'Kalde/Wavin', 'PN20, Class 5'),
  item('plumbing', 'Pipes', 'CPVC Pipe (25mm, Cold Water)', 'Rmt', 15, 'Ashirvad/Astral', 'Schedule 80'),
  item('plumbing', 'Pipes', 'CPVC Pipe (50mm, Cold Water)', 'Rmt', 35, 'Ashirvad/Astral', 'Schedule 80'),
  item('plumbing', 'Pipes', 'GI Pipe (50mm, Riser)', 'Rmt', 65, null, 'Medium class, screwed/flanged'),
  item('plumbing', 'Pipes', 'GI Pipe (100mm, Main Supply)', 'Rmt', 120, null, 'Heavy class, flanged'),
  item('plumbing', 'Tanks', 'Underground Water Tank (per m³)', 'm³', 2500, null, 'RC, waterproof coating, DM approved'),
  item('plumbing', 'Tanks', 'Roof Water Tank (GRP, 10,000L)', 'nos', 12000, 'Balmoral/Braithwaite', 'Sectional GRP, insulated'),
  item('plumbing', 'Pumps', 'Booster Pump Set (2+1, VFD)', 'set', 35000, 'Grundfos/Wilo', '10 L/s @ 50m, variable speed'),
  item('plumbing', 'Pumps', 'Transfer Pump (Submersible)', 'nos', 4500, 'Grundfos', 'For tank transfer'),
  item('plumbing', 'Fixtures', 'WC — Wall-Hung Toilet', 'nos', 1200, 'Duravit/Grohe', 'Concealed cistern, soft-close'),
  item('plumbing', 'Fixtures', 'Wash Basin (Countertop)', 'nos', 800, 'Duravit/RAK', 'With mixer tap'),
  item('plumbing', 'Fixtures', 'Kitchen Sink (SS, Double Bowl)', 'nos', 650, 'Franke/Blanco', 'With mixer + waste'),
  item('plumbing', 'Fixtures', 'Shower Mixer + Head', 'set', 450, 'Grohe/Hansgrohe', 'Thermostatic, rain head'),
  item('plumbing', 'Fixtures', 'Floor Drain (100mm, Chrome)', 'nos', 85, null, 'With trap, SS grating'),
  item('plumbing', 'Fixtures', 'Water Heater — Central Calorifier (1000L)', 'nos', 18000, 'Rheem/AO Smith', 'Electric, dual element'),
  item('plumbing', 'Fixtures', 'Water Heater — Instant (Electric)', 'nos', 1200, 'Ariston/Rheem', '3.5 kW, point-of-use'),
  item('plumbing', 'Valves', 'Gate Valve (50mm)', 'nos', 120, null, 'Brass, PN16'),
  item('plumbing', 'Valves', 'Check Valve (50mm)', 'nos', 150, null, 'Spring type, PN16'),
  item('plumbing', 'Valves', 'PRV — Pressure Reducing Valve', 'nos', 650, 'Honeywell', 'Adjustable, with gauge'),

  // ═══════════════════════════════════════
  // FIRE FIGHTING
  // ═══════════════════════════════════════
  item('fire_fighting', 'Sprinklers', 'Sprinkler Head — Pendant (K80, Concealed)', 'nos', 85, 'Viking/Tyco', '68°C, standard response'),
  item('fire_fighting', 'Sprinklers', 'Sprinkler Head — Upright (K80)', 'nos', 65, 'Viking/Tyco', '68°C, for stores/utility'),
  item('fire_fighting', 'Sprinklers', 'Sprinkler Head — Sidewall', 'nos', 95, 'Viking/Tyco', 'For corridors, horizontal throw'),
  item('fire_fighting', 'Pumps', 'Fire Pump — Electric (100 HP)', 'nos', 45000, 'Grundfos/Peerless', 'End suction, UL/FM listed'),
  item('fire_fighting', 'Pumps', 'Fire Pump — Diesel (100 HP)', 'nos', 85000, 'Clarke/Cummins', 'UL/FM listed, with controller'),
  item('fire_fighting', 'Pumps', 'Jockey Pump (5 HP)', 'nos', 8500, 'Grundfos', 'Pressure maintenance, auto'),
  item('fire_fighting', 'Pipes', 'ERW Pipe — 50mm (Schedule 40)', 'Rmt', 55, null, 'Red oxide painted, threaded'),
  item('fire_fighting', 'Pipes', 'ERW Pipe — 100mm (Schedule 40)', 'Rmt', 95, null, 'Wet riser, grooved/flanged'),
  item('fire_fighting', 'Pipes', 'ERW Pipe — 150mm (Schedule 40)', 'Rmt', 145, null, 'Main header, flanged'),
  item('fire_fighting', 'Accessories', 'Hose Reel Cabinet (30m, Complete)', 'nos', 3500, null, 'With hose, nozzle, landing valve'),
  item('fire_fighting', 'Accessories', 'Fire Hydrant — External Pillar', 'nos', 8500, null, 'DCD approved, 2-way'),
  item('fire_fighting', 'Accessories', 'Landing Valve (65mm)', 'nos', 1200, null, 'Brass, instantaneous coupling'),
  item('fire_fighting', 'Accessories', 'Fire Extinguisher (6 kg, DCP)', 'nos', 180, null, 'ABC type, wall bracket'),
  item('fire_fighting', 'Accessories', 'Fire Extinguisher (CO2, 5 kg)', 'nos', 350, null, 'For electrical rooms'),
  item('fire_fighting', 'Accessories', 'Alarm Valve Set (100mm)', 'nos', 12000, 'Viking/Tyco', 'Wet type, with trim'),
  item('fire_fighting', 'Tanks', 'Fire Water Tank (per m³)', 'm³', 2800, null, 'RC, dedicated, DCD capacity'),

  // ═══════════════════════════════════════
  // FIRE ALARM
  // ═══════════════════════════════════════
  item('fire_alarm', 'Panels', 'Fire Alarm Control Panel (4-Loop)', 'nos', 18000, 'Notifier/Honeywell', 'Addressable, networkable'),
  item('fire_alarm', 'Panels', 'Fire Alarm Repeater Panel', 'nos', 5500, 'Notifier/Honeywell', 'For fire command center'),
  item('fire_alarm', 'Detectors', 'Smoke Detector (Optical, Addressable)', 'nos', 120, 'Notifier/Honeywell', 'With base + address module'),
  item('fire_alarm', 'Detectors', 'Heat Detector (Rate of Rise)', 'nos', 95, 'Notifier/Honeywell', 'For kitchen, parking'),
  item('fire_alarm', 'Detectors', 'Multi-Sensor Detector (Smoke+Heat)', 'nos', 180, 'Notifier/Honeywell', 'Advanced algorithm'),
  item('fire_alarm', 'Detectors', 'Beam Detector (Reflective)', 'nos', 2800, 'Notifier', 'For atrium, 100m range'),
  item('fire_alarm', 'Detectors', 'Duct Smoke Detector', 'nos', 450, 'Notifier', 'For AHU/FAHU ducts'),
  item('fire_alarm', 'Accessories', 'Manual Call Point (MCP)', 'nos', 85, 'Notifier/Honeywell', 'Break glass, addressable'),
  item('fire_alarm', 'Accessories', 'Sounder/Strobe (Wall Mount)', 'nos', 120, 'Notifier/Honeywell', 'Red, 95dB @ 1m'),
  item('fire_alarm', 'Accessories', 'Voice Evacuation Speaker', 'nos', 180, null, 'Ceiling, 6W, EN54-24'),
  item('fire_alarm', 'Cables', 'Fire Alarm Cable (2C × 1.5mm², FRLSH)', 'Rmt', 18, 'Ducab', 'Fire resistant 2hr'),
  item('fire_alarm', 'Cables', 'Fire Alarm Cable (4C × 1.5mm², FRLSH)', 'Rmt', 25, 'Ducab', 'For sounder loop'),

  // ═══════════════════════════════════════
  // BMS
  // ═══════════════════════════════════════
  item('bms', 'Controllers', 'DDC Controller (32 I/O)', 'nos', 8500, 'Honeywell/Siemens', 'BACnet/IP, web interface'),
  item('bms', 'Controllers', 'DDC Controller (16 I/O)', 'nos', 5500, 'Honeywell/Siemens', 'BACnet MS/TP'),
  item('bms', 'Controllers', 'Field Panel (with enclosure)', 'nos', 12000, null, 'IP55, with DIN rail, power supply'),
  item('bms', 'Sensors', 'Temperature Sensor (Duct/Pipe)', 'nos', 280, 'Honeywell/Siemens', 'NTC/PT1000, immersion/duct'),
  item('bms', 'Sensors', 'Humidity Sensor (Duct)', 'nos', 350, 'Honeywell/Siemens', '0-100%RH, 4-20mA'),
  item('bms', 'Sensors', 'Pressure Sensor (Differential)', 'nos', 450, 'Honeywell', 'For filter status, duct pressure'),
  item('bms', 'Sensors', 'Valve Actuator (Modulating)', 'nos', 650, 'Honeywell/Belimo', '0-10V, spring return'),
  item('bms', 'Sensors', 'Damper Actuator (On/Off)', 'nos', 350, 'Belimo', '24VAC, spring return'),
  item('bms', 'Software', 'BMS Head-End Workstation', 'nos', 15000, null, 'PC + monitor + UPS + software license'),
  item('bms', 'Software', 'BMS Software License', 'nos', 25000, 'Honeywell/Siemens', 'Enterprise, 500+ points'),
  item('bms', 'Software', 'Energy Metering System', 'LS', 18000, null, 'kWh meters + M-Bus collector + software'),

  // ═══════════════════════════════════════
  // DRAINAGE
  // ═══════════════════════════════════════
  item('drainage', 'Pipes', 'uPVC Soil Pipe (100mm, SDR 41)', 'Rmt', 65, null, 'With rubber ring joints'),
  item('drainage', 'Pipes', 'uPVC Soil Pipe (150mm, SDR 41)', 'Rmt', 95, null, 'Main stack, solvent cement'),
  item('drainage', 'Pipes', 'uPVC Waste Pipe (50mm)', 'Rmt', 35, null, 'From fixtures to stack'),
  item('drainage', 'Pipes', 'uPVC Vent Pipe (75mm)', 'Rmt', 40, null, 'AAV or through roof'),
  item('drainage', 'Pipes', 'HDPE Pipe (200mm, Sub-soil)', 'Rmt', 120, null, 'Butt-welded, for underground'),
  item('drainage', 'Manholes', 'Manhole — Precast (600×600)', 'nos', 4500, null, 'With frame + cover, DM approved'),
  item('drainage', 'Manholes', 'Manhole — Precast (1000×1000)', 'nos', 8500, null, 'Deep, step irons, benching'),
  item('drainage', 'Manholes', 'Inspection Chamber', 'nos', 2800, null, 'With SS cover, for floor level'),
  item('drainage', 'Fittings', 'Grease Trap (500L)', 'nos', 8000, null, 'SS, under-sink, for kitchen'),
  item('drainage', 'Fittings', 'Grease Trap (2000L)', 'nos', 18000, null, 'Underground, GRP/concrete'),
  item('drainage', 'Accessories', 'Sewage Ejection Pump', 'nos', 12000, 'Grundfos/Wilo', 'Submersible, auto float'),
  item('drainage', 'Accessories', 'Sump Pump (Submersible)', 'nos', 4500, 'Grundfos', 'For basement pit'),
  item('drainage', 'Accessories', 'Floor Drain (100mm, HD Chrome)', 'nos', 120, null, 'With trap, anti-insect'),
  item('drainage', 'Accessories', 'Roof Drain (Flat Roof)', 'nos', 350, null, 'CI body, leaf guard'),

  // ═══════════════════════════════════════
  // LPG
  // ═══════════════════════════════════════
  item('lpg', 'Pipes', 'Gas Pipe — CS (25mm)', 'Rmt', 55, null, 'Schedule 40, butt-welded'),
  item('lpg', 'Pipes', 'Gas Pipe — CS (50mm)', 'Rmt', 95, null, 'Schedule 40, flanged'),
  item('lpg', 'Valves', 'Gas Ball Valve (25mm)', 'nos', 250, null, 'Brass, AGA approved'),
  item('lpg', 'Valves', 'Solenoid Valve (Gas, 25mm)', 'nos', 1200, 'Honeywell', 'NC, 24V, UL listed'),
  item('lpg', 'Regulators', 'Gas Pressure Regulator (1st Stage)', 'nos', 1800, 'Fisher/Elster', '10 bar → 1.5 bar'),
  item('lpg', 'Regulators', 'Gas Pressure Regulator (2nd Stage)', 'nos', 950, 'Fisher/Elster', '1.5 bar → 37 mbar'),
  item('lpg', 'Accessories', 'Gas Detector (Combustible)', 'nos', 850, 'Honeywell/MSA', 'Fixed, 4-20mA, with sounder'),
  item('lpg', 'Accessories', 'Gas Meter (Rotary, G4)', 'nos', 2800, 'Elster', 'DM approved, pulse output'),
  item('lpg', 'Accessories', 'Gas Pressure Gauge', 'nos', 180, null, '0-4 bar, glycerin filled'),
  item('lpg', 'Accessories', 'Emergency Gas Shut-Off Valve', 'nos', 1500, null, 'Manual + electric, at entry'),
];
// In-memory demo project store for local development without Supabase
// Mirrors the shape of sabi_projects + related tables

