/**
 * Offline Path Normalization — shared between main thread and ZIP worker.
 *
 * IMPORTANT: This file must NOT import browser-only APIs, SvelteKit aliases
 * ($app, $lib), or anything that relies on the main thread module graph.
 * It runs inside a Web Worker (zipIngest.worker.js) where those imports
 * would throw. Use only standard JS globals.
 *
 * Canonical storage format:
 *   - Path  : `assets/SubPath/file.pdf`  (no leading slash)
 *   - IDB ID: `/assets/SubPath/file.pdf` (leading slash — matches IndexedDbAssetRepository._normalizeId)
 */

/**
 * Decode percent-encoded URI characters up to `maxPasses` times.
 * Works in both browser and worker contexts.
 *
 * @param {string} str
 * @param {number} [maxPasses=3]
 * @returns {string}
 */
function decodePercentEncoding(str, maxPasses = 3) {
  let result = str;
  for (let i = 0; i < maxPasses; i++) {
    if (!result.includes('%')) break;
    try {
      const decoded = decodeURIComponent(result);
      if (decoded === result) break;
      result = decoded;
    } catch {
      break;
    }
  }
  return result;
}

/**
 * Normalize a raw PDF path to canonical storage format: `assets/SubPath/file.pdf`
 * (no leading slash, always has the `assets/` prefix).
 *
 * Rules applied in order:
 *  1. Strip protocol + host (http://…)
 *  2. Strip leading/trailing slashes
 *  3. Replace backslashes with forward slashes
 *  4. Decode percent-encoding (up to 3 passes, UTF-8 compatible)
 *  5. Add `assets/` prefix when absent (case-insensitive check)
 *
 * @param {string} rawPath
 * @returns {string} Normalized path without leading slash, e.g. "assets/ColAdultos/675.pdf"
 */
export function normalizeStoragePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return '';

  let p = rawPath;

  // Strip protocol + host
  p = p.replace(/^https?:\/\/[^/]+/, '');

  // Strip leading / trailing slashes
  p = p.replace(/^\/+/, '').replace(/\/+$/, '');

  // Normalize path separators
  p = p.replace(/\\/g, '/');

  // Decode percent-encoding
  p = decodePercentEncoding(p);

  if (!p) return '';

  // Ensure `assets/` prefix (case-insensitive check, but preserve original case of the rest)
  if (!p.toLowerCase().startsWith('assets/')) {
    p = `assets/${p}`;
  }

  return p;
}

/**
 * Canonical IndexedDB primary key: `/assets/SubPath/file.pdf` (with leading slash).
 * This matches `IndexedDbAssetRepository._normalizeId()`.
 *
 * @param {string} rawPath
 * @returns {string}
 */
export function normalizeIdbId(rawPath) {
  const p = normalizeStoragePath(rawPath);
  if (!p) return '';
  return `/${p}`;
}

/**
 * Build a Set containing all recognised canonical forms for a list of raw paths.
 * Membership checks with `expectedSet.has(x)` will hit for both:
 *   - `/assets/...` (IDB-id form)
 *   - `assets/...`  (storage-path form)
 *
 * This avoids the need for callers to guess the exact variant.
 *
 * @param {string[]} paths - Raw paths (may be `/ColAdultos/675.pdf`, `assets/...`, etc.)
 * @returns {Set<string>}
 */
export function buildExpectedSet(paths) {
  const set = new Set();
  for (const p of paths) {
    if (!p) continue;

    const canonical = normalizeStoragePath(p);
    if (canonical) {
      set.add(canonical);         // assets/...
      set.add(`/${canonical}`);   // /assets/...
    }

    // Also add the raw stripped form so entries that already include assets/ still match
    const stripped = String(p).replace(/^\/+/, '').trim();
    if (stripped && stripped !== canonical) {
      set.add(stripped);
      set.add(`/${stripped}`);
    }
  }
  return set;
}

/**
 * Check whether a ZIP entry filename should be ingested, using canonical
 * normalisation for both the entry and the expected set.
 *
 * @param {string} entryName - Filename from ZIP entry
 * @param {Set<string>} expectedSet - Built with `buildExpectedSet`
 * @returns {boolean}
 */
export function shouldIngestZipEntry(entryName, expectedSet) {
  if (!entryName) return false;

  const canonical = normalizeStoragePath(entryName);
  if (!canonical || !canonical.toLowerCase().endsWith('.pdf')) return false;

  // If caller passes an empty set, accept all PDF entries
  if (!expectedSet || expectedSet.size === 0) return true;

  return expectedSet.has(canonical) || expectedSet.has(`/${canonical}`);
}
