// @ts-nocheck — ported from scripts/lib/*.mjs; logic identical, types enforced at API consumer.
import { billColumns } from './bill-columns';
// Dubai Approved Vendor List (AVL) — common manufacturer / origin guidance per
// category, pre-populated into column 8 ("Origin / Brand") so the tenderer sees
// the consultant-acceptable AVL band and replaces with their selected make.
//
// Pure ESM, mirrors the rate-lookup pattern in dubai-2026-rates.mjs.
//
// Source: typical Dubai consultant approved-vendor lists (Future Art, Khatib &
// Alami, Dar Al-Handasah, Atkins, AECOM submissions 2024–2026). DEWA-listed
// manufacturers only. Three or four representative names per category — not
// exhaustive; tenderer must confirm against the specific consultant's AVL.

// ─── Brand bands per category ────────────────────────────────────────────
const AVL = {
  lvPanel:        'Schneider / ABB / Siemens / Eaton',
  transformer:    'Schneider / ABB / Siemens / Trafo Union',
  generator:      'Cummins / Caterpillar / FG Wilson / Perkins',
  ats:            'ABB / Socomec / Cummins / GE',
  capBank:        'ABB / Schneider / Cirprotec / Frako',
  smdb:           'Schneider / Hager / Legrand / ABB',
  db:             'Schneider / Hager / Legrand / ABB',
  cableXlpe:      'Ducab / NCC / Oman Cables / Riyadh Cables',
  cableFr:        'Ducab FR / Pirelli / Prysmian / Nexans',
  cableLszh:      'Ducab LSZH / Prysmian / Helkama / Nexans',
  containment:    'Marshall Tufflex / Vergokan / Niedax / Eltete',
  conduit:        'Marshall Tufflex / Pemsa / Atkore / DSS',
  wiringDevice:   'MK / Schneider / Legrand / Hager',
  evCharger:      'ABB Terra / Schneider / Wallbox / Delta',
  lighting:       'Philips / Osram / Trilux / Thorn / Cooper',
  lightingExt:    'Philips Lumec / Disano / iGuzzini / Thorn',
  emergency:      'Chloride / Cooper / Tridonic / Hochiki',
  cbs:            'Chloride / Cooper / Olympia / Hochiki',
  earthing:       'Erico / Furse / DEHN / Pentair',
  lp:             'DEHN / Erico / Furse / Helita',
  smartMeter:     'Itron / Landis+Gyr / Iskra (DEWA-listed)',
  mfm:            'Schneider PowerLogic / Janitza / Carlo Gavazzi',
  faInterface:    'Notifier / Honeywell / Edwards / Hochiki',
  shuntTrip:      'Schneider / ABB / Siemens / Eaton',
  liftRecall:     'KONE / Otis / Schindler / Mitsubishi (lift OEM)',
  authority:      'DEWA / DM / DCD / RTA',
  sundry:         '— (contractor selection)',
};

// ─── Public lookup ─────────────────────────────────────────────────────────
/**
 * Returns AVL hint string for a BOQ row, or null if no confident match.
 * @param {{ desc: string, item: string, unit?: string }} row
 * @returns {string | null}
 */
export function lookupAvl(row) {
  const d = String(row?.desc || '');
  const item = String(row?.item || '');
  const dt = d.trim();

  // ─── ITEM-REF rules first (most reliable; identifies exact bill section) ──
  if (/^1\.5\./.test(item) || /^13\.3\./.test(item))                          return AVL.authority;

  // ─── EQUIPMENT — match leading equipment descriptor only ──────────────────
  // Transformer / Gen / ATS / Capacitor bank / LVP must lead the description.
  if (/^HV ?\/ ?LV distribution transformer|^Transformer\b/i.test(dt))         return AVL.transformer;
  if (/^Standby Generator|^Generator —/i.test(dt))                              return AVL.generator;
  if (/^Automatic Transfer Switch|^ATS\b/i.test(dt))                            return AVL.ats;
  if (/^Automatic PF correction|^Capacitor Bank|^.*PF correction capacitor bank/i.test(dt)) return AVL.capBank;
  if (/^LVP-?\d|^Type-tested LV switchboard|^Main LV switchboard/i.test(dt))    return AVL.lvPanel;

  // SMDBs and DBs — must START with their tag or full name.
  if (/^E?SMDB-?\w+|^Sub-?Main Distribution Board|^Floor-standing SMDB|^Wall-mounted SMDB/i.test(dt)) return AVL.smdb;
  if (/^Apartment DB|^Common.?Area.*DB|^Emergency DB|^EDB-|^DB-[A-Z]|^.*DB:.*incomer.*MCB/i.test(dt) ||
      (/consumer unit/i.test(d) && !/SMDB/.test(d)))                            return AVL.db;
  if (/^4\./.test(item))                                                         return AVL.db;

  // ─── CABLES — leading "NC × Nmm²" or "LSZH/FR/XLPE … cable" ──────────────
  const cableLeader = /^\s*\d+C\s*[×*x]?\s*\d+\s*mm[²2]?/.test(dt) ||
                      /^\s*(LSZH|XLPE|Fire.?Rated)\b/i.test(dt) ||
                      /^\s*\d+\s*[Cc]\s*×\s*\d+\s*mm/.test(dt);
  if (cableLeader && /Fire.?Rated|FR\b|BS\s*6387|IEC\s*60331/i.test(d))         return AVL.cableFr;
  if (cableLeader && /\bLSZH\b|BS\s*7211/i.test(d))                              return AVL.cableLszh;
  if (cableLeader && /XLPE|SWA|armoured|600\/1000/i.test(d))                      return AVL.cableXlpe;
  if (/^5\./.test(item)) return AVL.cableXlpe; // any other Bill 5 row defaults to XLPE band

  // Containment / conduit / trunking
  if (/cable ladder|cable tray/i.test(d))                                    return AVL.containment;
  if (/conduit|trunking/i.test(d))                                           return AVL.conduit;

  // Wiring devices
  if (/EV charger/i.test(d))                                                 return AVL.evCharger;
  if (/socket|outlet|switch|sensor|FCU|isolator|doorbell|connection unit/i.test(d) ||
      /^7\.\d/.test(item))                                                   return AVL.wiringDevice;

  // Lighting fixtures
  if (/Pole.?mounted|External wall.?mounted|Bollard|Façade|facade|step|kerb/i.test(d)) return AVL.lightingExt;
  if (/LED downlight|LED panel|LED batten|Bulkhead.*LED|Pendant.*LED|Track lighting|track.*LED/i.test(d) ||
      /Time.?clock|astronomical|Photocell|DALI/i.test(d) ||
      /^8\.\d/.test(item))                                                    return AVL.lighting;

  // Earthing & LP
  if (/earth bar|earth pit|earth conductor|MEB|bonding/i.test(d))            return AVL.earthing;
  if (/Air termination|Franklin|down conductor|lightning|\bLP\b|\bSPD\b|surge protection/i.test(d)) return AVL.lp;
  if (/^9\.\d/.test(item))                                                    return AVL.earthing;

  // Smart metering
  if (/smart kWh meter|kWh meter.*DEWA|smart meter cabinet/i.test(d))         return AVL.smartMeter;
  if (/Multi.?function.*meter|MFM|Class 0\.5|MODBUS/i.test(d))                return AVL.mfm;
  if (/Current transformers|CTs.*Class/i.test(d))                              return AVL.mfm;
  if (/^12\.\d/.test(item))                                                    return AVL.smartMeter;

  // Emergency / CBS
  if (/Central Battery System|CBS cabinet|maintained.?feed|VRLA/i.test(d))    return AVL.cbs;
  if (/emergency LED|exit sign|emergency luminaire|self.?contained.*emergency|3.?hour autonomy/i.test(d)) return AVL.emergency;

  // Fire alarm interface (Bill 10.4)
  if (/shunt.?trip/i.test(d))                                                  return AVL.shuntTrip;
  if (/Lift fire.?recall|fire.?recall interface/i.test(d))                     return AVL.liftRecall;
  if (/FA-BMS interface|FACP|FA system tie.?in|smoke damper actuator|mag.?lock release/i.test(d)) return AVL.faInterface;
  if (/^10\.4\./.test(item))                                                   return AVL.faInterface;

  // Bill 11 — ELV containment (specialist trade, conduit + fittings)
  if (/^11\./.test(item))                                                      return AVL.conduit;

  // Sundries / fire stop / labels
  if (/fire stop|intumescent|fire.?rated barrier|cable cleat|cable label|ferrules/i.test(d)) return AVL.sundry;

  // T&C and preliminaries — these are services not products
  if (/^13\./.test(item) || /^1\.[1-4]\./.test(item))                          return AVL.sundry;

  return null;
}

// ─── Apply to workbook (post-process) ─────────────────────────────────────
/**
 * Walks priceable rows and overwrites column 8 (Origin / Brand) with the AVL
 * hint when the lookup returns a confident match. Existing content is
 * intentionally replaced — column 8's meaning is "Origin / Brand", and any
 * prior context (e.g. "LVP-01" / "Roof Floor") belongs in the description,
 * not here. Returns counts for diagnostic logging.
 */
export function applyAvlToWorkbook(wb, lookup = lookupAvl) {
  let populated = 0, skipped = 0;
  wb.eachSheet(ws => {
    const col = billColumns(ws);
    for (let r = 1; r <= ws.rowCount; r++) {
      const item = ws.getRow(r).getCell(col.item).value;
      if (typeof item !== 'string') continue;
      if (!/^\d+\.\d+\.\d+|^[A-Z]\d+\.\d+/.test(item)) continue;
      const sizeText = col.size ? String(ws.getRow(r).getCell(col.size).value || '') : '';
      const desc = (sizeText ? `${sizeText} ` : '') + String(ws.getRow(r).getCell(col.desc).value || '');
      const unit = String(ws.getRow(r).getCell(col.unit).value || '');
      const hint = lookup({ item, desc, unit });
      if (typeof hint === 'string' && hint.length > 0) {
        ws.getRow(r).getCell(col.origin).value = hint;
        populated++;
      } else {
        skipped++;
      }
    }
  });
  return { populated, skipped };
}
