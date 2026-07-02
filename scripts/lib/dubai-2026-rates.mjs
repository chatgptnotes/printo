// Dubai 2026 indicative MEP-electrical unit rates (AED).
//
// Purpose: produce a fully-priced BOQ rather than a blank tender form. Every
// rate here is INDICATIVE — based on Dubai 2026 market knowledge for SABI-tier
// quality (DEWA-listed equipment, BS/IEC compliance, mid-range manufacturers).
// Margin is ±15 % from typical supplier quotations; rates exclude main-
// contractor preliminaries and overheads.
//
// Use by walking each priceable BOQ row and calling `lookupRate(row)`. Returns
// either a number (AED per unit) or `null` when no confident match exists. The
// caller is expected to leave F blank when null is returned, so the tenderer
// sees clearly what still needs pricing.
//
// Pure ESM, no runtime deps.

const NUM = (s) => {
  if (typeof s === 'number') return s;
  if (s == null) return NaN;
  const m = String(s).match(/[-+]?[\d,]*\.?\d+/);
  if (!m) return NaN;
  return Number(m[0].replace(/,/g, ''));
};

// ─── Cable rates per metre (AED/m, 4C XLPE/SWA/PVC 600/1000 V) ────────────
// Bench source: Dubai cable suppliers' 2026 indicative quotations for
// non-FR copper armoured cable. Multipliers below adjust for cores / FR / LSZH.
const CABLE_4C_XLPE_PER_M = {
  1.5:    6,
  2.5:    8,
  4:     11,
  6:     14,
  10:    22,
  16:    32,
  25:    48,
  35:    62,
  50:    85,
  70:   110,
  95:   135,
  120:  160,
  150:  195,
  185:  245,
  240:  310,
  300:  385,
  400:  510,
  500:  640,
};

function cableSizeFromText(t) {
  // Match "150 mm²" / "150mm²" / "150 mm2" / "150sqmm" — return mm² as number.
  const m = t.match(/(\d+(?:\.\d+)?)\s*mm[²2]?/i);
  return m ? Number(m[1]) : null;
}

function cableCoresFromText(t) {
  // Match "4C" / "3C" / "1C" / "1×4C" / "2×4C" — first leading "NCx" wins.
  const direct = t.match(/(\d+)\s*[Cc]\s*[×*]/);
  if (direct) return Number(direct[1]);
  const trailing = t.match(/(\d+)\s*[Cc]\b/);
  return trailing ? Number(trailing[1]) : 4; // default to 4-core for power
}

function cableParallelRunsFromText(t) {
  const m = t.match(/(\d+)\s*[×*x]\s*\d+\s*[Cc]/);
  return m ? Number(m[1]) : 1;
}

// Map a cable's mm² to one of the three plan-page gauge buckets.
// KEEP IN SYNC with bucketFor() in src/lib/plan/cost.ts (≥50 heavy, ≥16 submain, else final).
function bucketForSize(sizeMm2) {
  if (sizeMm2 >= 50) return 'heavy';
  if (sizeMm2 >= 16) return 'submain';
  return 'final';
}

// XLPE cable rate (AED/m), accounting for cores, FR, LSZH, and parallel runs.
// When `overrides` (the user-edited plan-page rate map { heavy, submain, final })
// supplies a positive per-metre rate for this cable's gauge bucket, that flat
// rate wins — no cores/FR/LSZH multipliers — so the Excel matches the on-screen
// "length × bucket-rate" preview exactly.
function cableRate(desc, overrides = null) {
  const size = cableSizeFromText(desc);
  if (!size) return null;
  if (overrides) {
    const override = overrides[bucketForSize(size)];
    if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
      return Math.round(override);
    }
  }
  // Find the closest known size at or above the requested mm².
  const sizes = Object.keys(CABLE_4C_XLPE_PER_M).map(Number).sort((a, b) => a - b);
  let key = sizes.find(s => s >= size);
  if (key == null) key = sizes[sizes.length - 1];
  let rate = CABLE_4C_XLPE_PER_M[key];

  // Cores: 4C reference. Adjust for 3C / 2C / 1C (per-metre on a single cable).
  const cores = cableCoresFromText(desc);
  if (cores === 1)      rate *= 0.27;       // single-core (e.g. ECC bare)
  else if (cores === 2) rate *= 0.55;
  else if (cores === 3) rate *= 0.78;
  // 4C: base rate.

  // Parallel runs (e.g. "2×4C 150mm²"): rate per metre of bundle.
  const runs = cableParallelRunsFromText(desc);
  if (runs > 1) rate *= runs;

  // Fire-rated jacket adds ~60 % material premium.
  if (/\bfire[- ]?rated\b|\bFR\b|BS\s*6387|IEC\s*60331/i.test(desc)) rate *= 1.60;

  // LSZH outer adds ~30 % material premium (vs PVC).
  if (/\bLSZH\b|BS\s*7211|IEC\s*60332-3/i.test(desc) && !/fire[- ]?rated/i.test(desc)) rate *= 1.30;

  // ECC bare copper reference — already covered by 1C × 0.27 multiplier above.

  return Math.round(rate);
}

// ─── SMDB rates by incomer rating (AED each) ──────────────────────────────
function smdbRate(desc) {
  // Match SMDB / ESMDB tags; "Sub-Main Distribution Board" — NOT generic
  // "LV switchboard" (which is the LVP main panel and is far more expensive).
  if (!/\b(E?SMDB|Sub.?Main Distribution Board)\b/i.test(desc)) return null;
  const ampMatch = desc.match(/(\d+)\s*A\s*TP/i);
  const amp = ampMatch ? Number(ampMatch[1]) : null;
  const isOutdoorIp65 = /IP65|stainless.?steel|outdoor/i.test(desc);
  const isPlantIp54  = /IP54/i.test(desc);
  const isEmerg      = /\bE?SMDB\b.*\bemerg/i.test(desc) || /\bESMDB\b/.test(desc) || /generator.?backed/i.test(desc);

  // Base by current rating
  let base;
  if (amp == null)         base = 12000;
  else if (amp <= 50)       base = 6000;
  else if (amp <= 100)      base = 9000;
  else if (amp <= 160)      base = 14000;
  else if (amp <= 250)      base = 22000;
  else if (amp <= 400)      base = 32000;
  else if (amp <= 630)      base = 48000;
  else                      base = 65000;

  if (isOutdoorIp65) base *= 1.65;     // stainless 316L + sun-shield premium
  else if (isPlantIp54) base *= 1.18;  // splash-proof premium
  if (isEmerg)        base *= 1.15;    // FR terminations + ATS interlock prep

  return Math.round(base);
}

// ─── LV panel / generator / ATS / capacitor bank rates ────────────────────
function lvPanelRate(desc) {
  // Match: explicit LVP-01/LVP-02 tag, "LV switchboard / Main switchboard",
  // "Type-tested LV switchboard (TTA)", "metal-clad", or "main ACB ≥ N kA".
  const isLvp = /^LVP-?\d|^LVP\s|Type.?tested LV switchboard|main LV switchboard|TTA|IEC 61439|main ACB/i.test(desc.trim());
  if (!isLvp) return null;
  // Find the main ACB rating — try "2000A 4P main ACB" / "2000 A main ACB" / "2000A drawout"
  const ampMatch = desc.match(/(\d{3,4})\s*A\s*4P\s*main|(\d{3,4})\s*A\s*main\s*ACB|(\d{3,4})\s*A\s*drawout|(\d{3,4})\s*A\s*ACB/i);
  const amp = ampMatch ? Number(ampMatch[1] || ampMatch[2] || ampMatch[3] || ampMatch[4]) : null;
  if (amp == null) return null;
  if (amp >= 2000) return 600000;
  if (amp >= 1600) return 450000;
  if (amp >= 1250) return 360000;
  if (amp >= 1000) return 280000;
  if (amp >= 800)  return 210000;
  return Math.round(amp * 200);
}

function transformerRate(desc) {
  if (!/transformer/i.test(desc)) return null;
  const kvaMatch = desc.match(/(\d+)\s*kVA/i);
  const kva = kvaMatch ? Number(kvaMatch[1]) : null;
  if (!kva) return null;
  // Cast-resin K-13 indicative AED ~120/kVA
  return Math.round(kva * 120);
}

function generatorRate(desc) {
  if (!/standby generator|diesel generator/i.test(desc) || !/^.*Generator/.test(desc)) return null;
  const kvaMatch = desc.match(/(\d+)\s*kVA/i);
  const kva = kvaMatch ? Number(kvaMatch[1]) : null;
  if (!kva) return null;
  // Diesel canopied gen ~800-900 AED/kVA installed
  return Math.round(kva * 850);
}

function atsRate(desc) {
  if (!/Automatic Transfer Switch|ATS/i.test(desc)) return null;
  const ampMatch = desc.match(/(\d+)\s*A/i);
  const amp = ampMatch ? Number(ampMatch[1]) : 400;
  if (amp >= 1600) return 180000;
  if (amp >= 800)  return 120000;
  if (amp >= 400)  return 80000;
  return Math.round(amp * 200);
}

function capacitorBankRate(desc) {
  if (!/capacitor bank|PF correction/i.test(desc)) return null;
  const kvarMatch = desc.match(/(\d+)\s*kVAR/i);
  const kvar = kvarMatch ? Number(kvarMatch[1]) : null;
  if (!kvar) return null;
  // Auto-step capacitor bank ~210 AED/kVAR
  return Math.round(kvar * 210);
}

// ─── DB rates (AED each) ──────────────────────────────────────────────────
function dbRate(desc) {
  if (!/\bDB\b|distribution board|consumer unit/i.test(desc)) return null;
  if (/apartment/i.test(desc))                       return 1800;
  if (/common.?area|corridor/i.test(desc))           return 2200;
  if (/emergency|EDB-/i.test(desc))                  return 3500;
  if (/lift|elevator|EV-/i.test(desc))                return 3800;
  if (/mechanical|plant|roof|RF-/i.test(desc))        return 3200;
  if (/retail|shop|SH-/i.test(desc))                 return 2400;
  if (/lobby|car ?park|services|fire control|BMS|services/i.test(desc)) return 2600;
  // Fallback for "Distribution Board" generic
  return 2400;
}

// ─── Containment rates (AED/m) ────────────────────────────────────────────
function containmentRate(desc) {
  // Cable ladder — width-driven
  if (/cable ladder/i.test(desc)) {
    if (/500\s*mm/.test(desc)) return 165;
    if (/450\s*mm/.test(desc)) return 145;
    if (/300\s*mm/.test(desc)) return 110;
    if (/200\s*mm/.test(desc)) return 85;
    return 110;
  }
  // Cable tray
  if (/cable tray/i.test(desc)) {
    if (/600\s*mm/.test(desc)) return 130;
    if (/450\s*mm/.test(desc)) return 105;
    if (/300\s*mm/.test(desc)) return 95;
    if (/200\s*mm/.test(desc)) return 65;
    if (/100\s*mm/.test(desc)) return 45;
    return 65;
  }
  // Conduit
  if (/conduit/i.test(desc)) {
    if (/uPVC|PVC/i.test(desc)) {
      if (/32\s*mm/.test(desc)) return 16;
      if (/25\s*mm/.test(desc)) return 12;
      if (/20\s*mm/.test(desc)) return 9;
    }
    if (/GI|galvanised/i.test(desc)) {
      if (/32\s*mm/.test(desc)) return 35;
      if (/25\s*mm/.test(desc)) return 28;
      return 24;
    }
    return 14;
  }
  if (/trunking/i.test(desc)) {
    if (/100\s*[×x]\s*100/.test(desc)) return 95;
    if (/50\s*[×x]\s*50/.test(desc))   return 55;
    return 65;
  }
  return null;
}

// ─── Wiring devices (AED each) ────────────────────────────────────────────
function deviceRate(desc) {
  // Sockets
  if (/twin\s*socket|DP twin/i.test(desc))         return 75;
  if (/USB/i.test(desc) && /socket/i.test(desc))   return 180;
  if (/EV charger.*22\s*kW/i.test(desc))           return 8500;
  if (/EV charger.*7\s*kW/i.test(desc))            return 3500;
  if (/floor.?mounted service box|floor service/i.test(desc)) return 280;
  if (/cooker outlet|32\s*A.*outlet/i.test(desc))  return 165;
  if (/IP55.*socket|weatherproof.*socket/i.test(desc)) return 95;
  if (/20\s*A.*DP|DP switched outlet/i.test(desc)) return 85;
  if (/13\s*A.*SP|SP switched|13\s*A SSO/i.test(desc)) return 45;
  if (/single.*socket/i.test(desc))                return 45;
  if (/shaver/i.test(desc))                        return 95;
  // Switches
  if (/dimmer/i.test(desc))                        return 120;
  if (/2.?way|intermediate/i.test(desc))           return 30;
  if (/lighting switch/i.test(desc))               return 25;
  // Sensors / control
  if (/\bPIR\b|occupancy sensor|occupancy detector|presence sensor/i.test(desc)) return 95;
  if (/doorbell/i.test(desc))                      return 150;
  if (/connection unit|FCU/i.test(desc))           return 60;
  // Isolators
  if (/isolator.*4P\s*32/i.test(desc))             return 125;
  if (/isolator.*2P/i.test(desc))                  return 75;
  if (/isolator/i.test(desc))                      return 110;
  return null;
}

// ─── Lighting fixtures (AED each) ─────────────────────────────────────────
function lightingRate(desc) {
  if (/Recessed.*LED downlight|LED downlight/i.test(desc))   return 85;
  if (/LED panel.*600.*600/i.test(desc))                      return 165;
  if (/Linear LED batten/i.test(desc))                        return 125;
  if (/Bulkhead.*LED/i.test(desc))                            return 95;
  if (/Wall.?mounted LED/i.test(desc) && /external/i.test(desc)) return 280;
  if (/Wall.?mounted LED|wall.?mount LED/i.test(desc))         return 150;
  if (/Pendant.*LED/i.test(desc))                              return 450;
  if (/Track lighting|track.*LED/i.test(desc))                 return 140;
  if (/Pole.?mounted/i.test(desc))                             return 1800;
  if (/Step.*LED|Kerb.*LED|Step \/ kerb/i.test(desc))          return 95;
  if (/Bollard.*LED/i.test(desc))                              return 580;
  if (/Façade|facade.*LED/i.test(desc))                        return 85000;
  if (/Time.?clock|astronomical/i.test(desc))                  return 3500;
  if (/Photocell|daylight sensor/i.test(desc))                 return 250;
  if (/DALI|0-10V dimmer/i.test(desc))                         return 25000;
  return null;
}

// ─── Earthing & LP (AED) ──────────────────────────────────────────────────
function earthingRate(desc, unit) {
  if (/Main earth bar|MEB/i.test(desc))                       return 1200;
  if (/Earth pit|earth electrode/i.test(desc))                 return 3500;
  if (/95\s*mm.*bare copper|95\s*mm.*earth/i.test(desc))       return 85;
  if (/50\s*mm.*PVC.*earth|50\s*mm.*green.?yellow PVC/i.test(desc)) return 32;
  if (/35\s*mm.*XLPE.*earth|35\s*mm.*green.?yellow XLPE/i.test(desc)) return 22;
  if (/10\s*mm.*PVC.*earth|10\s*mm.*green.?yellow/i.test(desc)) return 8;
  if (/Supplementary bonding/i.test(desc))                     return 5000;
  if (/Air termination|Franklin|ESE/i.test(desc))              return 1800;
  if (/Down conductor.*50\s*mm/i.test(desc))                   return 75;
  if (/Test point chamber|disconnector/i.test(desc))           return 1200;
  if (/Earth electrode for LP|LP.*electrode/i.test(desc))      return 2800;
  if (/Surge protection|SPD/i.test(desc))                      return 4500;
  if (/Lightning protection design|risk assessment/i.test(desc)) return 8000;
  if (/LP testing|earthing testing|DEWA acceptance/i.test(desc)) return 6500;
  return null;
}

// ─── Emergency luminaires + life-safety feeders ──────────────────────────
function emergencyRate(desc) {
  if (/Self.?contained.*emergency LED downlight/i.test(desc)) return 280;
  if (/Self.?contained.*bulkhead/i.test(desc))                 return 380;
  if (/exit sign.*single.?sided/i.test(desc))                  return 320;
  if (/exit sign.*double.?sided/i.test(desc))                  return 480;
  if (/fire pump panel/i.test(desc) && /power supply/i.test(desc)) return 25000;
  if (/stair pressuris/i.test(desc) && /power/i.test(desc))    return 15000;
  if (/smoke.?extract/i.test(desc) && /power/i.test(desc))     return 18000;
  if (/sprinkler.*pump|jockey pump/i.test(desc))               return 22000;
  if (/fire.?fighter.?s lift/i.test(desc))                     return 28000;
  return null;
}

// ─── ELV containment provisional (AED/m) ─────────────────────────────────
function elvRate(desc) {
  if (/Telephone|data containment/i.test(desc))            return 14;
  if (/CCTV containment/i.test(desc))                       return 22;
  if (/Access Control containment|ACS containment/i.test(desc)) return 28;
  if (/MATV/i.test(desc))                                   return 16;
  if (/Fire Alarm containment/i.test(desc))                 return 38;
  if (/BMS field cabling/i.test(desc))                      return 35;
  if (/Audio.?Video|Door.?entry/i.test(desc))               return 24;
  if (/ELV main risers|GI trunking with separators/i.test(desc)) return 95;
  return null;
}

// ─── Metering (AED each / item) ──────────────────────────────────────────
function meteringRate(desc) {
  if (/single.?phase/i.test(desc) && /smart kWh meter|kWh meter/i.test(desc)) return 850;
  if (/three.?phase/i.test(desc)  && /smart kWh meter|kWh meter/i.test(desc)) return 2400;
  if (/smart meter cabinet|meter cabinet/i.test(desc))          return 3200;
  if (/Current transformers|CTs/i.test(desc))                   return 12000;
  if (/AMI head.?end|data.?concentrator/i.test(desc))           return 28000;
  if (/Multi.?function.*meter|MFM/i.test(desc))                 return 2800;
  if (/Energy.?monitoring software|SCADA package/i.test(desc))  return 85000;
  if (/MDM.*integration|Meter Data Management/i.test(desc))     return 25000;
  if (/Wiring, terminations, CT secondar/i.test(desc))          return 18000;
  if (/DEWA.?witnessed.*sealing/i.test(desc))                   return 12000;
  return null;
}

// ─── Testing & Commissioning (AED per item / sum) ────────────────────────
function tncRate(desc) {
  if (/Insulation resistance test/i.test(desc))            return 18000;
  if (/Continuity.*polarity test/i.test(desc))             return 12000;
  if (/Earth fault loop impedance/i.test(desc))            return 8500;
  if (/Phase rotation/i.test(desc))                        return 6500;
  if (/RCD test/i.test(desc))                              return 5500;
  if (/ATS changeover test/i.test(desc))                   return 12000;
  if (/Standby generator full.?load|generator.*load test/i.test(desc)) return 28000;
  if (/Power.?factor correction verif/i.test(desc))        return 8500;
  if (/Earthing system resistance test/i.test(desc))       return 6500;
  if (/Lightning protection continuity|LP.*continuity/i.test(desc)) return 5500;
  if (/Emergency lighting 3.?hour/i.test(desc))            return 4500;
  if (/DEWA Inspection Coordination/i.test(desc))          return 35000;
  if (/DEWA Final Approval/i.test(desc))                   return 50000;
  if (/Dubai Municipality.*inspection/i.test(desc))        return 18000;
  if (/DCD.*electrical clearance|Civil Defence.*clearance/i.test(desc)) return 22000;
  if (/As-Built Drawings.*Consultant Approval/i.test(desc)) return 28000;
  if (/As-Built Drawings.*DEWA Approval/i.test(desc))      return 32000;
  if (/Energising application/i.test(desc))                return 12000;
  if (/Final commissioning report/i.test(desc))            return 22000;
  if (/Operator training/i.test(desc))                     return 8500;
  if (/Witnessed handover walk/i.test(desc))               return 4500;
  return null;
}

// ─── Authority Fees, NOCs & Permits (Bill 1.5) — AED per item / sum ──────
function authorityFeeRate(desc) {
  if (/DEWA.*HV.?LV connection capacity|connection capacity charges/i.test(desc)) return 350000;
  if (/DEWA.*load.?letter|load.?letter application/i.test(desc))                   return 8000;
  if (/DEWA.*energising application/i.test(desc))                                  return 12000;
  if (/RTA.*road.?cutting|road.?cutting permit|reinstatement/i.test(desc))         return 45000;
  if (/Dubai Municipality.*completion.?certificate|DM.*completion/i.test(desc))    return 18000;
  if (/Dubai Civil Defence.*NOC|DCD.*NOC fee|DCD.*clearance NOC/i.test(desc))      return 12000;
  return null;
}

// ─── Central Battery System + FA / MEP Integration (Bill 10.3, 10.4) ─────
function cbsAndFaIntegrationRate(desc) {
  // 10.3 CBS
  if (/CBS cabinet|Central Battery System.*cabinet/i.test(desc))                   return 85000;
  if (/Maintained.?feed.*sub.?circuit.*CBS|CBS.*maintained.?feed/i.test(desc))     return 38;
  if (/CBS.*testing.*3.?h discharge|CBS.*witness/i.test(desc))                     return 8500;
  // 10.4 FA-MEP integration
  if (/Shunt.?trip relay.*FAHU/i.test(desc))                                       return 1800;
  if (/Shunt.?trip relay.*AHU isolation/i.test(desc))                              return 1800;
  if (/Lift fire.?recall interface/i.test(desc))                                   return 6500;
  if (/Smoke.*fire damper actuator|damper actuator power supply/i.test(desc))      return 1200;
  if (/Mag.?lock door release|mag.?lock release.*relay/i.test(desc))               return 950;
  if (/FA.?BMS interface relay rack/i.test(desc))                                  return 18000;
  if (/FA system tie.?in cabling|tie.?in cabling.*FACP/i.test(desc))               return 65;
  return null;
}

// ─── Preliminaries (AED — sum / item) ────────────────────────────────────
function prelimRate(desc) {
  if (/Mobilisation to site/i.test(desc))                          return 125000;
  if (/Site offices/i.test(desc))                                  return 85000;
  if (/Site hoarding|fencing|security/i.test(desc))                return 35000;
  if (/Health.?Safety plan|PPE|fall.?arrest/i.test(desc))          return 18000;
  if (/Coordination with main contractor|MEP trades/i.test(desc))  return 25000;
  if (/Contractor.?s All Risks|CAR.*insurance/i.test(desc))        return 85000;
  if (/Workmen.?s Compensation|Public Liability|WC.*insurance/i.test(desc)) return 45000;
  if (/Performance bond/i.test(desc))                              return 18000;
  if (/Advance payment guarantee/i.test(desc))                     return 12000;
  if (/Temporary power supply/i.test(desc))                        return 85000;
  if (/Temporary lighting/i.test(desc))                            return 25000;
  if (/testing instruments|Megger.*earth tester/i.test(desc))      return 28000;
  if (/Shop drawings/i.test(desc))                                 return 85000;
  if (/Material approval submittals/i.test(desc))                  return 35000;
  if (/As-Built drawings.*4 hard copies|As-Built drawings.*hard copies/i.test(desc)) return 45000;
  if (/Operation.*Maintenance manuals|O&M Manuals/i.test(desc))    return 38000;
  if (/Defects Liability Period support|DLP support/i.test(desc))  return 95000;
  return null;
}

// ─── Sundries — fire stop, labels, cleats, etc. ──────────────────────────
function sundriesRate(desc) {
  if (/Cable identification labels|self.?adhesive ferrules/i.test(desc))           return 18000;
  if (/Cable cleats and ties|stainless steel cleats/i.test(desc))                  return 22000;
  if (/Fire stopping|intumescent compound|fire.?rated penetration/i.test(desc))    return 28000;
  if (/Smoke.?\/.?fire barrier|fire-rated barrier system/i.test(desc))             return 4500;
  return null;
}

// ─── HV / DEWA scope items ────────────────────────────────────────────────
function hvRate(desc) {
  if (/DEWA HV incoming service connection|RMU.*DEWA/i.test(desc)) return 0; // DEWA-supplied; allow 0 for coordination line
  if (/HV cable.*RMU.*transformer|11 kV HV cable/i.test(desc))     return 320; // per metre
  if (/Transformer room civil|MEP coordination/i.test(desc))       return 35000;
  return null;
}

// ─── Master lookup ────────────────────────────────────────────────────────
/**
 * Returns AED unit rate for a BOQ row, or null when no confident match.
 * @param {{ item: string, desc: string, unit: string, qty: any }} row
 * @param {{ heavy?: number, submain?: number, final?: number } | null} overrides
 *        Optional plan-page rate map; when present, cable rows are priced from it.
 * @returns {number | null}
 */
export function lookupRate(row, overrides = null) {
  const desc = String(row?.desc || '');
  const unit = String(row?.unit || '').trim().toLowerCase();
  const item = String(row?.item || '');

  // Try category-by-category. Order matters — most specific first.
  // LVP main panel must be tried before SMDB (LVP descriptions can mention
  // "switchboard" which would otherwise fall through to the SMDB rate book).
  const candidates = [
    cableRate(desc, overrides),
    transformerRate(desc),
    generatorRate(desc),
    atsRate(desc),
    capacitorBankRate(desc),
    lvPanelRate(desc),
    smdbRate(desc),
    dbRate(desc),
    containmentRate(desc),
    deviceRate(desc),
    lightingRate(desc),
    earthingRate(desc, unit),
    cbsAndFaIntegrationRate(desc),  // Bill 10.3 + 10.4 — try BEFORE generic emergency
    emergencyRate(desc),
    elvRate(desc),
    meteringRate(desc),
    authorityFeeRate(desc),          // Bill 1.5 — try BEFORE prelim and tnc
    tncRate(desc),
    prelimRate(desc),
    sundriesRate(desc),
    hvRate(desc),
  ];
  for (const r of candidates) {
    if (typeof r === 'number' && Number.isFinite(r) && r >= 0) return r;
  }
  return null;
}

// ─── Apply to ExcelJS workbook in-place ───────────────────────────────────
// Walks every priceable row (Item like "X.Y.Z" or "1.2.3") and populates F.
// Returns { populated, skipped } counts for diagnostic logging.
export function applyRatesToWorkbook(wb, lookup = lookupRate) {
  let populated = 0, skipped = 0;
  wb.eachSheet(ws => {
    // Only price the priced "Bill N — …" sheets. Cover / Preamble / Summary
    // carry no priceable rows, and the per-floor "Floor - …" appendix tabs are
    // an unpriced memorandum — never touch them.
    if (!/^Bill\b/.test(ws.name)) return;
    for (let r = 1; r <= ws.rowCount; r++) {
      const item = ws.getRow(r).getCell(1).value;
      if (typeof item !== 'string') continue;
      // Match X.Y.Z numeric (industry: "1.2.3") or Letter+digit ("A1.1") tender format.
      if (!/^\d+\.\d+\.\d+|^[A-Z]\d+\.\d+/.test(item)) continue;
      const desc = String(ws.getRow(r).getCell(2).value || '');
      const unit = String(ws.getRow(r).getCell(4).value || '');
      const qty  = ws.getRow(r).getCell(5).value;
      const rate = lookup({ item, desc, unit, qty });
      if (typeof rate === 'number' && Number.isFinite(rate) && rate >= 0) {
        ws.getRow(r).getCell(6).value = rate;
        // Don't override numFmt here — the BOQ generator already set the
        // accounting format on this cell, and ExcelJS shares style objects
        // across the row, so writing here propagates to Qty/Amount too.
        populated++;
      } else {
        skipped++;
      }
    }
  });
  return { populated, skipped };
}
