/**
 * 7-Zip (.7z) archive extraction via the 7z-wasm WebAssembly build.
 *
 * Mirrors the ZIP (adm-zip) and RAR (node-unrar-js) handling in
 * `extract/route.ts`. We use a WASM build of 7-Zip rather than spawning the
 * `7za` binary so it runs unmodified on Vercel's serverless runtime (no native
 * binary, no child process).
 *
 * A fresh module instance is created per call so the in-memory Emscripten FS
 * starts clean — archives are rare, so the ~100-300 ms init cost is acceptable
 * and avoids cross-archive file collisions in a warm lambda.
 */

export interface ArchiveEntry {
  fileName: string;
  fullPath: string;
  buffer: Buffer;
  size: number;
}

/**
 * Extract every (non-directory) file from a .7z archive buffer.
 * Throws if the archive is corrupt or the WASM module fails to extract.
 */
export async function extract7z(archiveBuffer: Buffer): Promise<ArchiveEntry[]> {
  const mod = await import('7z-wasm');
  const factory = (mod as unknown as { default: () => Promise<Sevenzip> }).default;
  const sz = await factory();

  const archiveName = 'input.7z';
  const outDir = 'out';
  sz.FS.writeFile(archiveName, archiveBuffer);
  try { sz.FS.mkdir(outDir); } catch { /* already exists */ }

  // `x` preserves the directory structure inside the archive; `-y` answers yes
  // to all prompts. Output text is silenced by the caller's log filtering.
  sz.callMain(['x', archiveName, '-o' + outDir, '-y']);

  const entries: ArchiveEntry[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of sz.FS.readdir(dir)) {
      if (name === '.' || name === '..') continue;
      const full = `${dir}/${name}`;
      const relPath = rel ? `${rel}/${name}` : name;
      const st = sz.FS.stat(full);
      if (sz.FS.isDir(st.mode)) {
        walk(full, relPath);
      } else {
        const data = sz.FS.readFile(full) as Uint8Array;
        entries.push({
          fileName: name,
          fullPath: relPath,
          buffer: Buffer.from(data),
          size: data.length,
        });
      }
    }
  };
  walk(outDir, '');

  return entries;
}

// Minimal shape of the Emscripten module surface we use.
interface Sevenzip {
  callMain(args: string[]): number;
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    mkdir(path: string): void;
    readdir(path: string): string[];
    stat(path: string): { mode: number };
    isDir(mode: number): boolean;
    readFile(path: string, opts?: { encoding?: string }): Uint8Array | string;
  };
}
