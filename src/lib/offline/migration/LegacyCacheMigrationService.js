import { browser } from '$app/environment';
import { getConfig } from '../core/OfflineConfig.js';
import { createLogger } from '../utils/OfflineLogger.js';
import indexedDbAssetRepository from '../storage/IndexedDbAssetRepository.js';

const logger = createLogger('LegacyCacheMigrationService');
const CHECKPOINT_KEY = 'legacy_cache_to_idb_migration_checkpoint_v1';
const DONE_KEY = 'legacy_cache_to_idb_migration_done_v1';

function getCheckpoint() {
  if (!browser) return {};
  try {
    return JSON.parse(localStorage.getItem(CHECKPOINT_KEY) || '{}');
  } catch {
    return {};
  }
}

function setCheckpoint(checkpoint) {
  if (!browser) return;
  localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(checkpoint));
}

function isDone() {
  if (!browser) return true;
  return localStorage.getItem(DONE_KEY) === 'true';
}

function markDone() {
  if (!browser) return;
  localStorage.setItem(DONE_KEY, 'true');
}

function shouldMigrateRequest(requestUrl) {
  try {
    const url = new URL(requestUrl);
    const path = (url.pathname || '').toLowerCase();
    return path.endsWith('.pdf') || path.endsWith('.mp3') || path.endsWith('.m4a') || path.endsWith('.aac');
  } catch {
    return false;
  }
}

export class LegacyCacheMigrationService {
  constructor() {
    this.running = false;
  }

  async runInBackground() {
    if (!browser || this.running || isDone()) return;
    this.running = true;

    // Fire-and-forget with small delay so startup remains responsive.
    setTimeout(() => {
      this.migrate()
        .catch((error) => logger.warn('LegacyCacheMigrationService', 'Background migration failed', error))
        .finally(() => {
          this.running = false;
        });
    }, 1500);
  }

  async migrate() {
    if (!browser || typeof caches === 'undefined') {
      return { migrated: 0, skipped: 0, deleted: 0, errors: 0 };
    }
    if (isDone()) {
      return { migrated: 0, skipped: 0, deleted: 0, errors: 0 };
    }

    const batchSize = Number(getConfig('OFFLINE_MIGRATION_BATCH_SIZE') || 20);
    const yieldMs = Number(getConfig('OFFLINE_MIGRATION_YIELD_MS') || 16);
    const targetCaches = ['plpc-pdfs', 'plpc-v4-app'];
    const checkpoint = getCheckpoint();

    let migrated = 0;
    let skipped = 0;
    let deleted = 0;
    let errors = 0;

    for (const cacheName of targetCaches) {
      try {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        let startIndex = Number(checkpoint[cacheName] || 0);

        for (let i = startIndex; i < keys.length; i++) {
          const request = keys[i];
          const requestUrl = request?.url || '';
          if (!shouldMigrateRequest(requestUrl)) {
            skipped++;
            continue;
          }

          try {
            const response = await cache.match(request);
            if (!response) {
              skipped++;
              continue;
            }

            const blob = await response.blob();
            const path = new URL(requestUrl).pathname;
            const alreadyExists = await indexedDbAssetRepository.hasAsset(path);

            if (!alreadyExists) {
              await indexedDbAssetRepository.putAsset(path, blob, { mimeType: blob.type });
              migrated++;
            } else {
              skipped++;
            }

            const removed = await cache.delete(request);
            if (removed) deleted++;
          } catch (entryError) {
            errors++;
            logger.warn('LegacyCacheMigrationService', `Failed migrating ${requestUrl}`, entryError);
          }

          if (i % batchSize === 0) {
            checkpoint[cacheName] = i;
            setCheckpoint(checkpoint);
            // yield between chunks to avoid blocking UI/main thread
            await new Promise((resolve) => setTimeout(resolve, yieldMs));
          }
        }

        checkpoint[cacheName] = keys.length;
        setCheckpoint(checkpoint);
      } catch (cacheError) {
        errors++;
        logger.warn('LegacyCacheMigrationService', `Failed opening cache ${cacheName}`, cacheError);
      }
    }

    markDone();
    logger.info('LegacyCacheMigrationService', `Migration done: migrated=${migrated} skipped=${skipped} deleted=${deleted} errors=${errors}`);
    return { migrated, skipped, deleted, errors };
  }
}

const legacyCacheMigrationService = new LegacyCacheMigrationService();
export default legacyCacheMigrationService;
