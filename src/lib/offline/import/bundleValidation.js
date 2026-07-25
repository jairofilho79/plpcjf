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
 * @typedef {'pending' | 'active' | 'done'} ImportChecklistStatus
 * @typedef {{ ok: number, fail: number, total: number }} ImportCommitCounts
 * @typedef {{ id: string, label: string, status: ImportChecklistStatus, counts?: ImportCommitCounts }} ImportChecklistItem
 */

/**
 * Checklist rows for zip-mãe import UI.
 * @param {object} opts
 * @param {unknown} [opts.offlineManifest]
 * @param {boolean} opts.offlineManifestDone
 * @param {boolean} opts.louvoresManifestDone
 * @param {Set<string>} opts.seenParts
 * @param {string | null} [opts.currentPart]
 * @param {string} opts.phase
 * @param {ImportCommitCounts | null} [opts.commitCounts]
 * @returns {ImportChecklistItem[]}
 */
export function buildImportChecklist({
  offlineManifest,
  offlineManifestDone,
  louvoresManifestDone,
  seenParts,
  currentPart = null,
  phase,
  commitCounts = null
}) {
  /** @type {ImportChecklistItem[]} */
  const items = [
    {
      id: 'offline-manifest',
      label: 'Manifesto Offline',
      status: offlineManifestDone ? 'done' : 'active'
    },
    {
      id: 'louvores-manifest',
      label: 'Manifesto Louvores',
      status: louvoresManifestDone
        ? 'done'
        : offlineManifestDone
          ? 'active'
          : 'pending'
    }
  ];

  const packages =
    offlineManifest && typeof offlineManifest === 'object'
      ? /** @type {{ packages?: Record<string, { parts?: Array<{ filename?: string }> }> }} */ (
          offlineManifest
        ).packages
      : null;

  if (packages && typeof packages === 'object') {
    for (const [catName, pkg] of Object.entries(packages)) {
      const parts = Array.isArray(pkg?.parts) ? pkg.parts : [];
      const total = parts.length;
      const done = parts.filter((p) =>
        seenParts.has(zipEntryBasename(p?.filename || ''))
      ).length;
      const isCurrent =
        !!currentPart &&
        parts.some((p) => zipEntryBasename(p?.filename || '') === currentPart);
      /** @type {ImportChecklistStatus} */
      let status = 'pending';
      if (total > 0 && done >= total) status = 'done';
      else if (isCurrent || done > 0) status = 'active';
      items.push({
        id: `cat:${catName}`,
        label: `${catName} (${done}/${total})`,
        status
      });
    }
  }

  /** @type {ImportChecklistStatus} */
  let commitStatus = 'pending';
  if (phase === 'commit') commitStatus = 'active';
  if (phase === 'done') commitStatus = 'done';
  /** @type {ImportChecklistItem} */
  const commitItem = { id: 'commit', label: 'Confirmar no cache', status: commitStatus };
  if (commitCounts) commitItem.counts = commitCounts;
  items.push(commitItem);

  return items;
}

/**
 * Soft percentage from checklist steps (manifests + parts + commit).
 * @param {object} opts
 * @param {boolean} opts.offlineManifestDone
 * @param {boolean} opts.louvoresManifestDone
 * @param {number} opts.completedParts
 * @param {number} opts.totalParts
 * @param {string} opts.phase
 * @param {boolean} [opts.partInFlight]
 * @param {number} [opts.commitFraction] 0..1 during commit
 * @returns {number}
 */
export function importChecklistPercentage({
  offlineManifestDone,
  louvoresManifestDone,
  completedParts,
  totalParts,
  phase,
  partInFlight = false,
  commitFraction = 0
}) {
  const total = 2 + Math.max(totalParts, 0) + 1;
  if (total <= 0) return 0;
  let done =
    (offlineManifestDone ? 1 : 0) +
    (louvoresManifestDone ? 1 : 0) +
    completedParts;
  if (partInFlight) done += 0.4;
  if (phase === 'commit') done += Math.min(1, Math.max(0, commitFraction));
  if (phase === 'done') done = total;
  return Math.min(100, Math.floor((done / total) * 100));
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
