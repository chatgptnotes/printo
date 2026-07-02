/**
 * Demo fixture replay layer — file-bytes-only SHA-256 lookup that pre-empts
 * the AI cache for known test PDFs. Lets you re-upload `P-379_POWER_BOQ.pdf`
 * (or any file you've captured) and get an instant identical result instead
 * of waiting for the Claude scan.
 *
 *   Activation:  SABI_TEST_FIXTURES=1
 *   Storage:     tests/fixtures/index.json + per-fixture result.json + power-boq.pdf
 *   Capture:     scripts/capture-fixture.mjs  (run after one real successful run)
 *
 * Different file → key not in index → null → real pipeline runs untouched.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AttachmentFile, ElectricalProcedureResult } from '@/lib/ai/ai-provider';

interface FixtureIndexEntry {
  label: string;
  result: string;
  pdf?: string;
  xlsx?: string;
}
type FixtureIndex = Record<string, FixtureIndexEntry>;

export const FIXTURE_DIR = path.join(process.cwd(), 'tests', 'fixtures');
const INDEX_PATH = path.join(FIXTURE_DIR, 'index.json');

let _indexCache: { mtimeMs: number; index: FixtureIndex } | null = null;
let _warnedProd = false;

export function fixturesEnabled(): boolean {
  return process.env.SABI_TEST_FIXTURES === '1';
}

function maybeWarnProd(): void {
  if (process.env.NODE_ENV === 'production' && !_warnedProd) {
    console.warn('[fixture-replay] SABI_TEST_FIXTURES=1 in production — demo fixtures will be served for matching uploads. UNSET this in prod.');
    _warnedProd = true;
  }
}

async function loadIndex(): Promise<FixtureIndex> {
  try {
    const stat = await fs.stat(INDEX_PATH);
    if (_indexCache && _indexCache.mtimeMs === stat.mtimeMs) return _indexCache.index;
    const raw = await fs.readFile(INDEX_PATH, 'utf-8');
    const index = JSON.parse(raw) as FixtureIndex;
    _indexCache = { mtimeMs: stat.mtimeMs, index };
    return index;
  } catch {
    return {};
  }
}

/**
 * SHA-256 of sorted (filename + bytes). Deliberately excludes model and
 * building metadata so the same file matches across fresh test projects.
 */
export function computeFixtureKey(files: AttachmentFile[]): string {
  const hash = createHash('sha256');
  const sorted = [...files].sort((a, b) => a.filename.localeCompare(b.filename));
  for (const f of sorted) {
    hash.update('|FILE|');
    hash.update(f.filename);
    hash.update(f.buffer);
  }
  return hash.digest('hex');
}

export async function tryLoadFixtureResult(key: string): Promise<ElectricalProcedureResult | null> {
  if (!fixturesEnabled()) return null;
  maybeWarnProd();
  const entry = (await loadIndex())[key];
  if (!entry) return null;
  try {
    const raw = await fs.readFile(path.join(FIXTURE_DIR, entry.result), 'utf-8');
    return JSON.parse(raw) as ElectricalProcedureResult;
  } catch (e) {
    console.warn(`[fixture-replay] result load failed for key ${key.slice(0, 12)}…: ${(e as Error).message}`);
    return null;
  }
}

export async function tryLoadFixturePdf(key: string): Promise<Buffer | null> {
  if (!fixturesEnabled()) return null;
  maybeWarnProd();
  const entry = (await loadIndex())[key];
  if (!entry?.pdf) return null;
  try {
    return await fs.readFile(path.join(FIXTURE_DIR, entry.pdf));
  } catch (e) {
    console.warn(`[fixture-replay] pdf load failed for key ${key.slice(0, 12)}…: ${(e as Error).message}`);
    return null;
  }
}

export async function tryLoadFixtureXlsx(key: string): Promise<Buffer | null> {
  if (!fixturesEnabled()) return null;
  maybeWarnProd();
  const entry = (await loadIndex())[key];
  if (!entry?.xlsx) return null;
  try {
    return await fs.readFile(path.join(FIXTURE_DIR, entry.xlsx));
  } catch (e) {
    console.warn(`[fixture-replay] xlsx load failed for key ${key.slice(0, 12)}…: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Lookup a fixture entry by key. Used by the capture script to detect when
 * the same hash is already registered under a different label.
 */
export async function getFixtureEntry(key: string): Promise<FixtureIndexEntry | null> {
  return (await loadIndex())[key] ?? null;
}
