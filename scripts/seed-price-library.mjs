#!/usr/bin/env node
/**
 * seed-price-library.mjs
 *
 * Reads "Price Workout.xlsx" and bulk-inserts every priced line item into
 * sabi_price_library via the /api/price-library/bulk endpoint.
 *
 * Usage:
 *   node scripts/seed-price-library.mjs [path-to-xlsx]
 *
 * Defaults to "../Price Workout.xlsx" relative to the project root.
 *
 * Sheet → discipline mapping:
 *   "Fire Fighting" → fire_fighting
 *   "Drainage"      → drainage
 *   "Watersupply"   → plumbing
 *   "AC"            → hvac
 */

import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env.local manually (no dotenv dependency needed)
const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

// ── Config ──────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const SHEET_TO_DISCIPLINE = {
  'Fire Fighting': 'fire_fighting',
  'Drainage':      'drainage',
  'Watersupply':   'plumbing',
  'AC':            'hvac',
};

// ── Item Name Cleaning ──────────────────────────────────────────────────
// Turns raw Excel text like "Pipe -25mm" or "100 DIA SP UNDER GROUND"
// into clean, searchable strings the AI matcher can use.
function cleanItemName(raw) {
  let s = raw.trim();

  // Normalize dashes around sizes: "Pipe -25mm" → "Pipe 25mm"
  s = s.replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ');

  // Expand common abbreviations
  s = s.replace(/\bDIA\b/gi, 'Diameter');
  s = s.replace(/\bSP\b/g, 'Soil Pipe');
  s = s.replace(/\bWP\b/g, 'Waste Pipe');
  s = s.replace(/\bVP\b/g, 'Vent Pipe');
  s = s.replace(/\bBDP\b/g, 'Balcony Drain Pipe');
  s = s.replace(/\bRWP\b/g, 'Rain Water Pipe');
  s = s.replace(/\bRWO\b/g, 'Rain Water Outlet');
  s = s.replace(/\bGV\b/g, 'Gate Valve');
  s = s.replace(/\bNRV\b/g, 'Non Return Valve');
  s = s.replace(/\bOS&Y\b/gi, 'OS&Y');
  s = s.replace(/\bPRV\b/g, 'Pressure Reducing Valve');
  s = s.replace(/\bIV\b/g, 'Isolation Valve');
  s = s.replace(/\bFT\b/g, 'Floor Trap');
  s = s.replace(/\bFD\b/g, 'Floor Drain');
  s = s.replace(/\bBD\b/g, 'Balcony Drain');
  s = s.replace(/\bGT\b/g, 'Grease Trap');
  s = s.replace(/\bST\b/g, 'Sand Trap');
  s = s.replace(/\bFCO\b/g, 'Floor Clean Out');
  s = s.replace(/\bCO\b/g, 'Clean Out');
  s = s.replace(/\bHRC\b/g, 'Hose Reel Cabinet');
  s = s.replace(/\bZCV\b/g, 'Zone Control Valve');
  s = s.replace(/\bWC\b/g, 'Water Closet');
  s = s.replace(/\bFAHU\b/gi, 'Fresh Air Handling Unit');
  s = s.replace(/\bFAL\b/g, 'Fresh Air Louver');
  s = s.replace(/\bPPR\b/gi, 'PPR');
  s = s.replace(/\bGRP\b/gi, 'GRP');
  s = s.replace(/\bLS\b/g, 'Lump Sum');

  // Title case
  s = s.replace(/\b\w/g, c => c.toUpperCase());
  // Fix "Mm" → "mm" for millimeter sizes
  s = s.replace(/(\d)Mm\b/g, '$1mm');

  return s.replace(/\s+/g, ' ').trim();
}

// ── Category Assignment ─────────────────────────────────────────────────
// Groups items into categories based on keywords for the price library.
function assignCategory(itemName, description, discipline) {
  const combined = `${itemName} ${description || ''}`.toLowerCase();

  if (discipline === 'hvac') {
    if (/ducting|duct\b/i.test(combined)) return 'Ductwork';
    if (/equipment|vrf|fahu|fan|pump/i.test(combined)) return 'Equipment';
    if (/piping|pipe|condensate/i.test(combined)) return 'Piping';
    if (/grille|diffuser|outlet|louvre/i.test(combined)) return 'Air Terminals';
    if (/damper/i.test(combined)) return 'Fire & Smoke Dampers';
    if (/control|panel/i.test(combined)) return 'Controls';
    if (/testing|commissioning|engineering/i.test(combined)) return 'Testing & Commissioning';
    return 'General HVAC';
  }

  if (discipline === 'fire_fighting') {
    if (/pipe/i.test(combined)) return 'Piping';
    if (/sprinkler/i.test(combined)) return 'Sprinklers';
    if (/valve|nrv|os&y/i.test(combined)) return 'Valves';
    if (/pump/i.test(combined)) return 'Pumps';
    if (/hose|hrc/i.test(combined)) return 'Hose Reels';
    if (/extinguisher/i.test(combined)) return 'Fire Extinguishers';
    if (/fm200/i.test(combined)) return 'Suppression Systems';
    if (/tank/i.test(combined)) return 'Tanks';
    if (/testing|commissioning/i.test(combined)) return 'Testing & Commissioning';
    return 'General Fire Fighting';
  }

  if (discipline === 'drainage') {
    if (/pipe|riser/i.test(combined)) return 'Piping';
    if (/trap|ft\b|gt\b|st\b/i.test(combined)) return 'Traps & Drains';
    if (/manhole/i.test(combined)) return 'Manholes';
    if (/valve|prv|nrv|gate/i.test(combined)) return 'Valves';
    if (/pump|sump/i.test(combined)) return 'Pumps';
    if (/drain.*channel|grating|catch.*basin/i.test(combined)) return 'Drainage Fixtures';
    if (/vent.*cowl|rwo|clean.*out|co\b|fco/i.test(combined)) return 'Accessories';
    if (/testing|commissioning|engineering/i.test(combined)) return 'Testing & Commissioning';
    return 'General Drainage';
  }

  if (discipline === 'plumbing') {
    if (/pipe/i.test(combined)) return 'Piping';
    if (/tank|grp/i.test(combined)) return 'Tanks';
    if (/pump|booster|transfer/i.test(combined)) return 'Pumps';
    if (/heater/i.test(combined)) return 'Water Heaters';
    if (/valve|prv|gate/i.test(combined)) return 'Valves';
    if (/meter/i.test(combined)) return 'Metering';
    if (/sink|wc|basin|bath|shower|tap|hose.*cock|bip/i.test(combined)) return 'Fixtures (Installation)';
    if (/puddle|flange/i.test(combined)) return 'Accessories';
    if (/testing|commissioning|engineering/i.test(combined)) return 'Testing & Commissioning';
    return 'General Plumbing';
  }

  return 'General';
}

// ── Parse Excel ─────────────────────────────────────────────────────────
async function parseWorkbook(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const allItems = [];

  wb.eachSheet((ws) => {
    const discipline = SHEET_TO_DISCIPLINE[ws.name];
    if (!discipline) {
      console.log(`  Skipping unknown sheet: "${ws.name}"`);
      return;
    }

    console.log(`\n  Parsing sheet: "${ws.name}" → discipline: ${discipline}`);
    let count = 0;

    for (let r = 3; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);

      // Column B = Item name (required)
      const rawItem = String(row.getCell(2).value || '').trim();
      if (!rawItem || rawItem.toLowerCase() === 'total price') continue;

      // Column C = Description (optional)
      const rawDesc = String(row.getCell(3).value || '').trim();

      // Column F = Unit Price (required, must be > 0)
      const rawRate = row.getCell(6).value;
      const rate = typeof rawRate === 'object' && rawRate !== null
        ? (rawRate.result ?? 0)
        : Number(rawRate);
      if (!rate || rate <= 0) continue;

      // Column E = Unit/Measure
      const rawUnit = String(row.getCell(5).value || 'nos').trim();
      const unit = rawUnit || 'nos';

      const itemName = cleanItemName(rawItem);
      const description = rawDesc && rawDesc !== 'null' ? rawDesc.trim() : null;
      const category = assignCategory(rawItem, rawDesc, discipline);

      allItems.push({
        discipline,
        category,
        item_name: itemName,
        description,
        unit,
        unit_rate_aed: Math.round(rate * 100) / 100,
        brand: null,
        notes: `Imported from Price Workout.xlsx → ${ws.name}`,
      });
      count++;
    }

    console.log(`    → ${count} items extracted`);
  });

  return allItems;
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  const filePath = process.argv[2]
    || path.resolve(__dirname, '..', '..', 'Price Workout.xlsx');

  console.log(`\nSABI Price Library Seeder`);
  console.log(`Source: ${filePath}`);

  const items = await parseWorkbook(filePath);
  console.log(`\nTotal items to import: ${items.length}`);

  if (items.length === 0) {
    console.log('No items found. Check the file path and sheet names.');
    process.exit(1);
  }

  // Show preview
  console.log('\n  Preview (first 5 items):');
  for (const item of items.slice(0, 5)) {
    console.log(`    [${item.discipline}] ${item.category} → ${item.item_name} | ${item.unit} | ${item.unit_rate_aed} AED`);
  }

  // Clear existing imported data (only items with the import note)
  console.log('\n  Clearing previous import...');
  const { error: delError } = await supabase
    .from('sabi_price_library')
    .delete()
    .like('notes', 'Imported from Price Workout%');

  if (delError) {
    console.error('  Warning: Could not clear old imports:', delError.message);
  }

  // Insert in batches of 100
  const BATCH = 100;
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const { error } = await supabase
      .from('sabi_price_library')
      .insert(batch);

    if (error) {
      console.error(`  Batch ${Math.floor(i / BATCH) + 1} failed:`, error.message);
      failed += batch.length;
    } else {
      inserted += batch.length;
    }
  }

  console.log(`\n  Done!`);
  console.log(`    Inserted: ${inserted}`);
  if (failed > 0) console.log(`    Failed: ${failed}`);

  // Summary by discipline
  console.log('\n  By discipline:');
  const byDisc = {};
  for (const item of items) {
    byDisc[item.discipline] = (byDisc[item.discipline] || 0) + 1;
  }
  for (const [disc, count] of Object.entries(byDisc)) {
    console.log(`    ${disc}: ${count} items`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
