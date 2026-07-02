/**
 * Curated brand + standards dictionary for MEP specifications.
 *
 * Replaces the Claude `analyzeSpecifications` call for the common case where
 * a spec PDF mentions known approved-makes by name. Brands and standards are
 * matched against the extracted PDF text using fast multi-pattern substring
 * scanning — see spec-analyzer.ts.
 *
 * Sourced from real SABI tender specs + UAE consultant approved-makes lists.
 * Augment by harvesting `sabi_services.ai_extraction.spec_analysis.approved_makes`
 * from past projects (D2 in the audit plan).
 */

export interface BrandEntry {
  name: string;
  service: 'electrical' | 'hvac' | 'plumbing' | 'fire_fighting' | 'fire_alarm' | 'bms' | 'general';
  category: string;
  // Aliases / spellings that should also match (case-insensitive)
  aliases?: string[];
}

export const BRAND_DICTIONARY: BrandEntry[] = [
  // --- Electrical: panels, switchgear, breakers ---
  { name: 'Schneider Electric', service: 'electrical', category: 'switchgear', aliases: ['Schneider', 'Merlin Gerin', 'Square D'] },
  { name: 'ABB', service: 'electrical', category: 'switchgear' },
  { name: 'Siemens', service: 'electrical', category: 'switchgear' },
  { name: 'Eaton', service: 'electrical', category: 'switchgear', aliases: ['Cutler-Hammer', 'Cutler Hammer', 'MEM'] },
  { name: 'Legrand', service: 'electrical', category: 'switchgear' },
  { name: 'Hager', service: 'electrical', category: 'switchgear' },
  { name: 'Mitsubishi Electric', service: 'electrical', category: 'switchgear', aliases: ['Mitsubishi'] },
  { name: 'Terasaki', service: 'electrical', category: 'switchgear' },
  { name: 'GE', service: 'electrical', category: 'switchgear', aliases: ['General Electric'] },
  { name: 'Chint', service: 'electrical', category: 'switchgear' },
  { name: 'LS Electric', service: 'electrical', category: 'switchgear', aliases: ['LSIS'] },

  // --- Electrical: wiring accessories ---
  { name: 'BTicino', service: 'electrical', category: 'accessories', aliases: ['Bticino'] },
  { name: 'MK Electric', service: 'electrical', category: 'accessories', aliases: ['MK'] },
  { name: 'Clipsal', service: 'electrical', category: 'accessories' },
  { name: 'Niko', service: 'electrical', category: 'accessories' },
  { name: 'Vimar', service: 'electrical', category: 'accessories' },
  { name: 'Anchor', service: 'electrical', category: 'accessories' },

  // --- Electrical: cables ---
  { name: 'Ducab', service: 'electrical', category: 'cables' },
  { name: 'Oman Cables', service: 'electrical', category: 'cables', aliases: ['OCI'] },
  { name: 'Riyadh Cables', service: 'electrical', category: 'cables' },
  { name: 'Polycab', service: 'electrical', category: 'cables' },
  { name: 'RR Kabel', service: 'electrical', category: 'cables' },
  { name: 'Finolex', service: 'electrical', category: 'cables' },
  { name: 'Pirelli', service: 'electrical', category: 'cables' },
  { name: 'Nexans', service: 'electrical', category: 'cables' },
  { name: 'Prysmian', service: 'electrical', category: 'cables' },
  { name: 'Draka', service: 'electrical', category: 'cables' },
  { name: 'NKT', service: 'electrical', category: 'cables' },
  { name: 'Elsewedy', service: 'electrical', category: 'cables', aliases: ['El Sewedy', 'Elsewedy Electric'] },

  // --- Electrical: cable trays / containment ---
  { name: 'Marco', service: 'electrical', category: 'containment' },
  { name: 'Legrand Cablofil', service: 'electrical', category: 'containment', aliases: ['Cablofil'] },
  { name: 'Unitrunk', service: 'electrical', category: 'containment' },
  { name: 'Vantrunk', service: 'electrical', category: 'containment' },
  { name: 'Pemsa', service: 'electrical', category: 'containment' },
  { name: 'Oglaend', service: 'electrical', category: 'containment' },
  { name: 'Gewiss', service: 'electrical', category: 'containment' },

  // --- Electrical: lighting ---
  { name: 'Philips', service: 'electrical', category: 'lighting' },
  { name: 'Osram', service: 'electrical', category: 'lighting' },
  { name: 'Wipro', service: 'electrical', category: 'lighting' },
  { name: 'Crompton', service: 'electrical', category: 'lighting', aliases: ['Crompton Greaves'] },
  { name: 'Havells', service: 'electrical', category: 'lighting' },
  { name: 'Thorn', service: 'electrical', category: 'lighting' },
  { name: 'Zumtobel', service: 'electrical', category: 'lighting' },
  { name: 'Erco', service: 'electrical', category: 'lighting' },
  { name: 'iGuzzini', service: 'electrical', category: 'lighting' },

  // --- Electrical: transformers / generators ---
  { name: 'ABB Transformers', service: 'electrical', category: 'transformer' },
  { name: 'Siemens Transformers', service: 'electrical', category: 'transformer' },
  { name: 'Voltamp', service: 'electrical', category: 'transformer' },
  { name: 'CG Power', service: 'electrical', category: 'transformer' },
  { name: 'Cummins', service: 'electrical', category: 'generator' },
  { name: 'Caterpillar', service: 'electrical', category: 'generator', aliases: ['CAT'] },
  { name: 'Perkins', service: 'electrical', category: 'generator' },
  { name: 'FG Wilson', service: 'electrical', category: 'generator' },
  { name: 'Volvo Penta', service: 'electrical', category: 'generator' },
  { name: 'MTU', service: 'electrical', category: 'generator' },

  // --- Electrical: UPS / batteries ---
  { name: 'APC', service: 'electrical', category: 'ups' },
  { name: 'Riello', service: 'electrical', category: 'ups' },
  { name: 'Socomec', service: 'electrical', category: 'ups' },
  { name: 'Emerson', service: 'electrical', category: 'ups', aliases: ['Vertiv', 'Liebert'] },

  // --- Electrical: capacitor banks ---
  { name: 'EPCOS', service: 'electrical', category: 'capacitor' },
  { name: 'Schneider Varplus', service: 'electrical', category: 'capacitor', aliases: ['Varplus'] },
  { name: 'Janitza', service: 'electrical', category: 'capacitor' },

  // --- Electrical: earthing ---
  { name: 'Furse', service: 'electrical', category: 'earthing' },
  { name: 'ERICO', service: 'electrical', category: 'earthing' },
  { name: 'Dehn', service: 'electrical', category: 'earthing' },

  // --- HVAC ---
  { name: 'Daikin', service: 'hvac', category: 'ac_unit' },
  { name: 'Mitsubishi Heavy Industries', service: 'hvac', category: 'ac_unit', aliases: ['MHI'] },
  { name: 'LG', service: 'hvac', category: 'ac_unit' },
  { name: 'Trane', service: 'hvac', category: 'chiller' },
  { name: 'Carrier', service: 'hvac', category: 'chiller' },
  { name: 'York', service: 'hvac', category: 'chiller', aliases: ['Johnson Controls', 'JCI'] },
  { name: 'McQuay', service: 'hvac', category: 'chiller' },
  { name: 'Trox', service: 'hvac', category: 'diffuser' },
  { name: 'Krueger', service: 'hvac', category: 'diffuser' },
  { name: 'Greenheck', service: 'hvac', category: 'fan' },
  { name: 'Soler & Palau', service: 'hvac', category: 'fan', aliases: ['S&P'] },
  { name: 'Fantech', service: 'hvac', category: 'fan' },

  // --- Plumbing / sanitary ---
  { name: 'Grohe', service: 'plumbing', category: 'fixture' },
  { name: 'Hansgrohe', service: 'plumbing', category: 'fixture' },
  { name: 'Kohler', service: 'plumbing', category: 'fixture' },
  { name: 'Roca', service: 'plumbing', category: 'fixture' },
  { name: 'Duravit', service: 'plumbing', category: 'fixture' },
  { name: 'Geberit', service: 'plumbing', category: 'fixture' },
  { name: 'Toto', service: 'plumbing', category: 'fixture' },
  { name: 'Villeroy & Boch', service: 'plumbing', category: 'fixture' },

  // --- Plumbing: pipes ---
  { name: 'Aquatherm', service: 'plumbing', category: 'pipe' },
  { name: 'Wavin', service: 'plumbing', category: 'pipe' },
  { name: 'Georg Fischer', service: 'plumbing', category: 'pipe', aliases: ['GF'] },
  { name: 'Rehau', service: 'plumbing', category: 'pipe' },
  { name: 'Uponor', service: 'plumbing', category: 'pipe' },

  // --- Plumbing: pumps ---
  { name: 'Grundfos', service: 'plumbing', category: 'pump' },
  { name: 'Wilo', service: 'plumbing', category: 'pump' },
  { name: 'KSB', service: 'plumbing', category: 'pump' },
  { name: 'Lowara', service: 'plumbing', category: 'pump' },
  { name: 'Pedrollo', service: 'plumbing', category: 'pump' },

  // --- Fire fighting ---
  { name: 'Tyco', service: 'fire_fighting', category: 'sprinkler', aliases: ['Tyco Fire'] },
  { name: 'Viking', service: 'fire_fighting', category: 'sprinkler' },
  { name: 'Reliable', service: 'fire_fighting', category: 'sprinkler' },
  { name: 'Victaulic', service: 'fire_fighting', category: 'fitting' },
  { name: 'Naffco', service: 'fire_fighting', category: 'pump' },
  { name: 'Patterson', service: 'fire_fighting', category: 'pump' },
  { name: 'SFFECO', service: 'fire_fighting', category: 'system' },

  // --- Fire alarm ---
  { name: 'Honeywell', service: 'fire_alarm', category: 'panel' },
  { name: 'Notifier', service: 'fire_alarm', category: 'panel' },
  { name: 'Edwards', service: 'fire_alarm', category: 'panel', aliases: ['EST'] },
  { name: 'Bosch', service: 'fire_alarm', category: 'panel' },
  { name: 'Simplex', service: 'fire_alarm', category: 'panel' },
  { name: 'Hochiki', service: 'fire_alarm', category: 'detector' },
  { name: 'Apollo', service: 'fire_alarm', category: 'detector' },
  { name: 'System Sensor', service: 'fire_alarm', category: 'detector' },

  // --- BMS ---
  { name: 'Johnson Controls', service: 'bms', category: 'controller' },
  { name: 'Honeywell BMS', service: 'bms', category: 'controller' },
  { name: 'Siemens Desigo', service: 'bms', category: 'controller', aliases: ['Desigo'] },
  { name: 'Schneider EcoStruxure', service: 'bms', category: 'controller', aliases: ['EcoStruxure'] },
  { name: 'Distech', service: 'bms', category: 'controller' },
];

/**
 * Standards / codes referenced in MEP specs. Matched as whole-token regex.
 * The `pattern` is matched against extracted PDF text; matches contribute to
 * `standards_referenced[]` in the SpecAnalysisResult.
 */
export interface StandardEntry {
  code: string;        // canonical name, e.g. 'BS EN 12845'
  pattern: RegExp;     // word-boundary regex that catches the code in text
  category: string;
}

export const STANDARDS_DICTIONARY: StandardEntry[] = [
  // British / European
  { code: 'BS EN 12845', pattern: /\bBS\s*EN\s*12845\b/i, category: 'fire_sprinkler' },
  { code: 'BS 5839', pattern: /\bBS\s*5839(?:[-:]\d+)?\b/i, category: 'fire_alarm' },
  { code: 'BS 7671', pattern: /\bBS\s*7671\b/i, category: 'electrical_wiring' },
  { code: 'BS 6004', pattern: /\bBS\s*6004\b/i, category: 'electrical_cable' },
  { code: 'BS EN 60439', pattern: /\bBS\s*EN\s*60439\b/i, category: 'switchgear' },
  // IEC
  { code: 'IEC 60364', pattern: /\bIEC\s*60364(?:[-:]\d+)*\b/i, category: 'electrical_wiring' },
  { code: 'IEC 60947', pattern: /\bIEC\s*60947(?:[-:]\d+)*\b/i, category: 'switchgear' },
  { code: 'IEC 61439', pattern: /\bIEC\s*61439(?:[-:]\d+)*\b/i, category: 'switchgear' },
  { code: 'IEC 60502', pattern: /\bIEC\s*60502(?:[-:]\d+)*\b/i, category: 'electrical_cable' },
  { code: 'IEC 60898', pattern: /\bIEC\s*60898\b/i, category: 'mcb' },
  { code: 'IEC 62305', pattern: /\bIEC\s*62305\b/i, category: 'lightning_protection' },
  { code: 'IEC 60332', pattern: /\bIEC\s*60332(?:[-:]\d+)*\b/i, category: 'cable_fire' },
  // NFPA / US
  { code: 'NFPA 13', pattern: /\bNFPA\s*13\b/i, category: 'fire_sprinkler' },
  { code: 'NFPA 14', pattern: /\bNFPA\s*14\b/i, category: 'standpipe' },
  { code: 'NFPA 20', pattern: /\bNFPA\s*20\b/i, category: 'fire_pump' },
  { code: 'NFPA 70', pattern: /\bNFPA\s*70\b/i, category: 'electrical' },
  { code: 'NFPA 72', pattern: /\bNFPA\s*72\b/i, category: 'fire_alarm' },
  { code: 'NFPA 110', pattern: /\bNFPA\s*110\b/i, category: 'generator' },
  // ASTM / DIN / ISO / UL / FM
  { code: 'ASTM A53', pattern: /\bASTM\s*A53\b/i, category: 'pipe_steel' },
  { code: 'ASTM D2241', pattern: /\bASTM\s*D2241\b/i, category: 'pipe_pvc' },
  { code: 'DIN 8077', pattern: /\bDIN\s*8077\b/i, category: 'pipe_polymer' },
  { code: 'ISO 9001', pattern: /\bISO\s*9001\b/i, category: 'quality' },
  { code: 'UL Listed', pattern: /\bUL\s*(?:Listed|listed)\b/i, category: 'certification' },
  { code: 'FM Approved', pattern: /\bFM\s*(?:Approved|approved)\b/i, category: 'certification' },
  // UAE local
  { code: 'DEWA Regulations', pattern: /\bDEWA\s*(?:Regulations?|Standards?|Code)?\b/i, category: 'utility_dubai' },
  { code: 'UAE Fire Code', pattern: /\bUAE\s*Fire\s*Code\b/i, category: 'fire_uae' },
  { code: 'Dubai Civil Defence', pattern: /\bDubai\s*Civil\s*Def[ec]nce\b/i, category: 'fire_uae' },
  { code: 'ADDC', pattern: /\bADDC\b/i, category: 'utility_abudhabi' },
  { code: 'SEWA', pattern: /\bSEWA\b/i, category: 'utility_sharjah' },
];
