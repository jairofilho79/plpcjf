/**
 * Offline revision and job snapshot helpers.
 * Centralizes revision state used by manifest/cache/stats synchronization.
 */

const LS_PREFIX = 'plpcjf:offline:';

const MANIFEST_REVISION_KEY = `${LS_PREFIX}manifestRevision`;
const CACHE_REVISION_KEY = `${LS_PREFIX}cacheRevision`;
const LAST_SEEN_MANIFEST_REVISION_KEY = `${LS_PREFIX}lastSeenManifestRevision`;
const DOWNLOAD_JOB_SNAPSHOT_KEY = `${LS_PREFIX}downloadJobSnapshot`;

/**
 * @returns {Storage|null}
 */
function getStorage() {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

/**
 * @returns {string|null}
 */
export function getManifestRevision() {
  const storage = getStorage();
  if (!storage) return null;
  const value = storage.getItem(MANIFEST_REVISION_KEY);
  return value && value.trim() ? value.trim() : null;
}

/**
 * @param {string|null|undefined} revision
 */
export function setManifestRevision(revision) {
  const storage = getStorage();
  if (!storage) return;
  if (!revision) {
    storage.removeItem(MANIFEST_REVISION_KEY);
    return;
  }
  storage.setItem(MANIFEST_REVISION_KEY, String(revision).trim());
}

/**
 * @returns {number}
 */
export function getCacheRevision() {
  const storage = getStorage();
  if (!storage) return 0;
  const raw = storage.getItem(CACHE_REVISION_KEY);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

/**
 * @param {number} revision
 */
export function setCacheRevision(revision) {
  const storage = getStorage();
  if (!storage) return;
  const normalized = Number.isFinite(revision) && revision >= 0 ? Math.floor(revision) : 0;
  storage.setItem(CACHE_REVISION_KEY, String(normalized));
}

/**
 * @returns {number}
 */
export function bumpCacheRevision() {
  const next = getCacheRevision() + 1;
  setCacheRevision(next);
  return next;
}

/**
 * @returns {string}
 */
export function getCurrentStatsRevision() {
  const manifestRevision = getManifestRevision() || 'none';
  const cacheRevision = getCacheRevision();
  return `${manifestRevision}::${cacheRevision}`;
}

/**
 * @returns {string|null}
 */
export function getLastSeenManifestRevision() {
  const storage = getStorage();
  if (!storage) return null;
  const value = storage.getItem(LAST_SEEN_MANIFEST_REVISION_KEY);
  return value && value.trim() ? value.trim() : null;
}

/**
 * @param {string|null|undefined} revision
 */
export function setLastSeenManifestRevision(revision) {
  const storage = getStorage();
  if (!storage) return;
  if (!revision) {
    storage.removeItem(LAST_SEEN_MANIFEST_REVISION_KEY);
    return;
  }
  storage.setItem(LAST_SEEN_MANIFEST_REVISION_KEY, String(revision).trim());
}

/**
 * @typedef {'running'|'completed'|'failed'|'cancelled'|'interrupted'} DownloadJobStatus
 */

/**
 * @typedef {Object} DownloadJobSnapshot
 * @property {string} jobId
 * @property {DownloadJobStatus} status
 * @property {string[]} categories
 * @property {number} completed
 * @property {number} failed
 * @property {number} total
 * @property {string} phase
 * @property {number} progress
 * @property {number} updatedAt
 * @property {string|null} error
 * @property {string|null} targetStatsRevision
 */

/**
 * @returns {DownloadJobSnapshot|null}
 */
export function readDownloadJobSnapshot() {
  const storage = getStorage();
  if (!storage) return null;
  const raw = storage.getItem(DOWNLOAD_JOB_SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @param {Partial<DownloadJobSnapshot>} snapshot
 */
export function writeDownloadJobSnapshot(snapshot) {
  const storage = getStorage();
  if (!storage) return;
  const current = readDownloadJobSnapshot() || {};
  const next = {
    ...current,
    ...snapshot,
    updatedAt: Date.now()
  };
  storage.setItem(DOWNLOAD_JOB_SNAPSHOT_KEY, JSON.stringify(next));
}

export function clearDownloadJobSnapshot() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(DOWNLOAD_JOB_SNAPSHOT_KEY);
}

/**
 * Marks stale running job snapshots as interrupted.
 * Useful after tab reload/crash.
 *
 * @param {number} [maxAgeMs=300000]
 * @returns {DownloadJobSnapshot|null}
 */
export function markStaleRunningJobAsInterrupted(maxAgeMs = 5 * 60 * 1000) {
  const snapshot = readDownloadJobSnapshot();
  if (!snapshot) return null;
  if (snapshot.status !== 'running') return snapshot;

  const updatedAt = Number(snapshot.updatedAt || 0);
  const age = Date.now() - updatedAt;
  if (age < maxAgeMs) return snapshot;

  /** @type {DownloadJobSnapshot} */
  const interrupted = {
    ...snapshot,
    status: /** @type {DownloadJobStatus} */ ('interrupted'),
    error: snapshot.error || 'Download interrompido antes da conclusão.'
  };
  writeDownloadJobSnapshot(interrupted);
  return interrupted;
}

export function clearOfflineRevisionState() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(MANIFEST_REVISION_KEY);
  storage.removeItem(CACHE_REVISION_KEY);
  storage.removeItem(LAST_SEEN_MANIFEST_REVISION_KEY);
}

