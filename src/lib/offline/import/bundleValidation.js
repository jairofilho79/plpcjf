/**
 * Pure validation helpers for offline zip-mãe bundles.
 * offline-manifest.json is SSOT for which part ZIPs must be present.
 */

/**
 * @param {string} entryName
 * @returns {boolean}
 */
export function isUnsafeZipPath(entryName) {
  if (!entryName || typeof entryName !== 'string') return true;
  const n = entryName.replace(/\\/g, '/');
  if (n.startsWith('/') || /^[a-zA-Z]:/.test(n)) return true;
  const parts = n.split('/');
  return parts.some((p) => p === '..');
}

/**
 * @param {string} entryName
 * @returns {string} basename only
 */
export function zipEntryBasename(entryName) {
  const n = String(entryName || '').replace(/\\/g, '/');
  const i = n.lastIndexOf('/');
  return i >= 0 ? n.slice(i + 1) : n;
}

/**
 * @param {unknown} offlineManifest
 * @returns {string[]}
 */
export function listPartFilenames(offlineManifest) {
  /** @type {string[]} */
  const names = [];
  if (!offlineManifest || typeof offlineManifest !== 'object') return names;
  const packages = /** @type {{ packages?: Record<string, { parts?: Array<{ filename?: string }> }> }} */ (
    offlineManifest
  ).packages;
  if (!packages || typeof packages !== 'object') return names;

  for (const packageData of Object.values(packages)) {
    const parts = packageData?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (part?.filename && typeof part.filename === 'string') {
        names.push(zipEntryBasename(part.filename));
      }
    }
  }
  return names;
}

/**
 * @param {unknown} offlineManifest
 * @returns {string[]}
 */
export function listCategoriesFromOfflineManifest(offlineManifest) {
  if (!offlineManifest || typeof offlineManifest !== 'object') return [];
  const packages = /** @type {{ packages?: Record<string, unknown> }} */ (offlineManifest).packages;
  if (!packages || typeof packages !== 'object') return [];
  return Object.keys(packages);
}

/**
 * @param {object} opts
 * @param {unknown} opts.offlineManifest
 * @param {unknown} opts.louvoresManifest
 * @param {Iterable<string>} opts.entryBasenames - basenames found in zip-mãe
 * @returns {{ ok: true, partFilenames: string[] } | { ok: false, errors: string[] }}
 */
export function validateBundleRoot({ offlineManifest, louvoresManifest, entryBasenames }) {
  /** @type {string[]} */
  const errors = [];

  if (!offlineManifest || typeof offlineManifest !== 'object' || !('packages' in offlineManifest)) {
    errors.push('offline-manifest.json inválido ou ausente');
  }
  if (!Array.isArray(louvoresManifest) || louvoresManifest.length === 0) {
    errors.push('louvores-manifest.json inválido ou ausente');
  }

  const partFilenames = listPartFilenames(offlineManifest);
  if (partFilenames.length === 0 && errors.length === 0) {
    errors.push('offline-manifest.json não lista nenhuma part ZIP');
  }

  const present = new Set(
    [...entryBasenames].map((n) => zipEntryBasename(n)).filter(Boolean)
  );

  for (const name of partFilenames) {
    if (!present.has(name)) {
      errors.push(`Part em falta no zip-mãe: ${name}`);
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, partFilenames };
}

/**
 * Initial concurrency from device memory heuristic.
 * @returns {1|2|3}
 */
export function initialImportConcurrency() {
  try {
    const mem =
      typeof navigator !== 'undefined' && typeof navigator.deviceMemory === 'number'
        ? navigator.deviceMemory
        : 0;
    if (mem >= 8) return 3;
    if (mem >= 4) return 2;
  } catch {
    // ignore
  }
  return 1;
}
