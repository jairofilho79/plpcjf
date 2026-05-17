/**
 * LegacyCacheMigrationService
 *
 * Migrates PDF blobs from the old Cache API stores to IndexedDB so that the
 * canonical inventory (OfflineInventoryRepository) becomes the single source
 * of truth.
 *
 * Key properties:
 *  - Manual: never runs automatically; must be triggered by the user.
 *  - Resumable: checkpoint saved to localStorage after every batch so an
 *    interrupted migration continues from the last saved position.
 *  - Safe: the Cache API entry is only deleted AFTER the blob is confirmed
 *    written to IndexedDB; existing IDB entries are never overwritten.
 *  - Cancellable: `cancel()` sets a flag that is checked between batches.
 *  - Progress: optional callback receives { processed, total, migrated, skipped, errors }.
 */

import { browser } from '$app/environment';
import { getConfig } from '../core/OfflineConfig.js';
import { createLogger } from '../utils/OfflineLogger.js';
import offlineInventoryRepository from '../storage/OfflineInventoryRepository.js';
import PdfPathManager from '../utils/PdfPathManager.js';

const logger = createLogger('LegacyCacheMigrationService');

const CHECKPOINT_KEY = 'legacy_cache_to_idb_migration_checkpoint_v2';
const DONE_KEY = 'legacy_cache_to_idb_migration_done_v2';

/** Cache stores that contain legacy PDF data. */
const LEGACY_PDF_CACHES = ['plpc-pdfs', 'plpc-v4-app'];

// ─── Checkpoint helpers ────────────────────────────────────────────────────

/**
 * @typedef {{
 *   caches: Record<string, number>,
 *   total: number,
 *   processed: number,
 *   migrated: number,
 *   skipped: number,
 *   errors: number,
 *   startedAt: number
 * }} MigrationCheckpoint
 */

/**
 * @returns {MigrationCheckpoint}
 */
function loadCheckpoint() {
  if (!browser) return _emptyCheckpoint();
  try {
    const raw = localStorage.getItem(CHECKPOINT_KEY);
    if (!raw) return _emptyCheckpoint();
    const parsed = JSON.parse(raw);
    return {
      caches: parsed.caches || {},
      total: Number(parsed.total || 0),
      processed: Number(parsed.processed || 0),
      migrated: Number(parsed.migrated || 0),
      skipped: Number(parsed.skipped || 0),
      errors: Number(parsed.errors || 0),
      startedAt: Number(parsed.startedAt || Date.now())
    };
  } catch {
    return _emptyCheckpoint();
  }
}

function _emptyCheckpoint() {
  return { caches: {}, total: 0, processed: 0, migrated: 0, skipped: 0, errors: 0, startedAt: 0 };
}

function saveCheckpoint(cp) {
  if (!browser) return;
  localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(cp));
}

function clearCheckpoint() {
  if (!browser) return;
  localStorage.removeItem(CHECKPOINT_KEY);
}

function isDone() {
  if (!browser) return true;
  return localStorage.getItem(DONE_KEY) === 'true';
}

function markDone() {
  if (!browser) return;
  localStorage.setItem(DONE_KEY, 'true');
  clearCheckpoint();
}

function shouldMigrateRequest(requestUrl) {
  try {
    const path = (new URL(requestUrl)).pathname.toLowerCase();
    return path.endsWith('.pdf');
  } catch {
    return false;
  }
}

/** Infer category from a PDF path like "assets/ColAdultos/001.pdf" → "ColAdultos" */
function inferCategoryFromPath(path) {
  const parts = path.replace(/^\/+/, '').split('/');
  // Expected: ["assets", "<category>", "<filename>"]
  if (parts.length >= 3 && parts[0].toLowerCase() === 'assets') {
    return parts[1] || null;
  }
  return null;
}

// ─── Service ──────────────────────────────────────────────────────────────

export class LegacyCacheMigrationService {
  constructor() {
    /** @type {boolean} */
    this.running = false;
    /** @type {boolean} */
    this._cancelled = false;
  }

  // ── Status ──────────────────────────────────────────────────────────────

  /**
   * Whether the migration has been completed.
   * @returns {boolean}
   */
  isCompleted() {
    return isDone();
  }

  /**
   * Whether the migration is currently running.
   * @returns {boolean}
   */
  isRunning() {
    return this.running;
  }

  /**
   * Returns a snapshot of the saved checkpoint (for UI display).
   * @returns {MigrationCheckpoint}
   */
  getCheckpoint() {
    return loadCheckpoint();
  }

  /**
   * Checks whether there are Cache API PDF entries that have NOT yet been
   * migrated to IndexedDB.  Used to decide whether to show the migration button.
   *
   * Performs a lightweight count (no blob reads).
   *
   * @returns {Promise<boolean>}
   */
  async isMigrationNeeded() {
    if (!browser || typeof caches === 'undefined') return false;
    if (isDone()) return false;

    for (const cacheName of LEGACY_PDF_CACHES) {
      try {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        for (const req of keys) {
          if (shouldMigrateRequest(req?.url || '')) {
            return true;
          }
        }
      } catch {
        // ignore — cache might not exist
      }
    }
    return false;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Cancel a running migration.  The cancellation takes effect between batches.
   */
  cancel() {
    this._cancelled = true;
  }

  /**
   * Reset the stored checkpoint so the next `migrate()` call starts from scratch.
   * Only useful when the user wants to re-run a completed or stalled migration.
   */
  reset() {
    if (!browser) return;
    localStorage.removeItem(DONE_KEY);
    clearCheckpoint();
  }

  // ── Core migration ───────────────────────────────────────────────────────

  /**
   * Run the migration to completion (or until cancelled).
   *
   * Safe to call multiple times: if already done it returns immediately.
   * If previously interrupted it resumes from the saved checkpoint.
   *
   * @param {{
   *   onProgress?: (progress: {
   *     processed: number,
   *     total: number,
   *     migrated: number,
   *     skipped: number,
   *     errors: number,
   *     percentage: number
   *   }) => void
   * }} [options]
   * @returns {Promise<{migrated: number, skipped: number, errors: number, cancelled: boolean}>}
   */
  async migrate(options = {}) {
    if (!browser || typeof caches === 'undefined') {
      return { migrated: 0, skipped: 0, errors: 0, cancelled: false };
    }
    if (isDone()) {
      return { migrated: 0, skipped: 0, errors: 0, cancelled: false };
    }
    if (this.running) {
      logger.warn('LegacyCacheMigrationService', 'Migration already in progress');
      return { migrated: 0, skipped: 0, errors: 0, cancelled: false };
    }

    this.running = true;
    this._cancelled = false;

    const batchSize = Number(getConfig('OFFLINE_MIGRATION_BATCH_SIZE') || 20);
    const yieldMs = Number(getConfig('OFFLINE_MIGRATION_YIELD_MS') || 16);
    const { onProgress } = options;

    const cp = loadCheckpoint();
    if (!cp.startedAt) cp.startedAt = Date.now();

    // ── Phase 1: collect all keys to migrate ──────────────────────────────
    // We build a full list upfront so we can report accurate percentages and
    // resume reliably without re-scanning already-processed caches.

    /** @type {Array<{cacheName: string, request: Request, requestUrl: string}>} */
    const queue = [];

    for (const cacheName of LEGACY_PDF_CACHES) {
      try {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        const startIndex = Number(cp.caches[cacheName] || 0);
        for (let i = startIndex; i < keys.length; i++) {
          const req = keys[i];
          if (shouldMigrateRequest(req?.url || '')) {
            queue.push({ cacheName, request: req, requestUrl: req.url, cacheIndex: i });
          }
        }
      } catch (err) {
        logger.warn('LegacyCacheMigrationService', `Could not open cache ${cacheName}`, err);
      }
    }

    cp.total = (cp.processed || 0) + queue.length;
    saveCheckpoint(cp);

    let { migrated = 0, skipped = 0, errors = 0 } = cp;

    const reportProgress = () => {
      if (!onProgress) return;
      const total = cp.total || queue.length;
      onProgress({
        processed: cp.processed,
        total,
        migrated,
        skipped,
        errors,
        percentage: total > 0 ? Math.round((cp.processed / total) * 100) : 0
      });
    };

    reportProgress();

    // ── Phase 2: migrate each entry ───────────────────────────────────────

    try {
      for (let i = 0; i < queue.length; i++) {
        if (this._cancelled) {
          logger.info('LegacyCacheMigrationService', 'Migration cancelled by user');
          break;
        }

        const { cacheName, request, requestUrl, cacheIndex } = queue[i];

        try {
          const pathRaw = new URL(requestUrl).pathname;
          const normalizedPath = PdfPathManager.normalizeForStorage(pathRaw);

          if (!normalizedPath) {
            skipped++;
          } else {
            const alreadyInIdb = await offlineInventoryRepository._repo.hasAsset(normalizedPath);

            if (!alreadyInIdb) {
              const cache = await caches.open(cacheName);
              const response = await cache.match(request);
              if (response) {
                const blob = await response.blob();
                const category = inferCategoryFromPath(normalizedPath);
                await offlineInventoryRepository.storePdf(normalizedPath, blob, {
                  category: category || undefined,
                  status: 'migrated'
                });
                migrated++;
              } else {
                skipped++;
              }
            } else {
              skipped++;
            }

            // Only delete from Cache API AFTER IDB write succeeds.
            // Failures above skip the delete so the entry remains for the next attempt.
            try {
              const cache = await caches.open(cacheName);
              await cache.delete(request);
            } catch {
              // Non-critical: stale Cache API entry; ignore.
            }
          }
        } catch (entryError) {
          errors++;
          logger.warn('LegacyCacheMigrationService', `Failed migrating ${requestUrl}`, entryError);
        }

        cp.processed = (cp.processed || 0) + 1;
        cp.migrated = migrated;
        cp.skipped = skipped;
        cp.errors = errors;
        // Save per-cache position so we can skip already-processed entries on resume.
        cp.caches[queue[i].cacheName] = (cacheIndex || 0) + 1;

        // Save checkpoint every batch and yield to main thread.
        if (i % batchSize === batchSize - 1 || i === queue.length - 1) {
          saveCheckpoint(cp);
          reportProgress();
          await new Promise((resolve) => setTimeout(resolve, yieldMs));
        }
      }

      if (!this._cancelled) {
        markDone();
        logger.info(
          'LegacyCacheMigrationService',
          `Migration complete: migrated=${migrated} skipped=${skipped} errors=${errors}`
        );
      } else {
        saveCheckpoint(cp);
        logger.info(
          'LegacyCacheMigrationService',
          `Migration interrupted: processed=${cp.processed}/${cp.total}`
        );
      }
    } finally {
      this.running = false;
    }

    return { migrated, skipped, errors, cancelled: this._cancelled };
  }
}

const legacyCacheMigrationService = new LegacyCacheMigrationService();
export default legacyCacheMigrationService;
