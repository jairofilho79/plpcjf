/**
 * Cache Synchronization
 * Synchronizes multiple caches (memory, localStorage, Service Worker)
 * FASE 4: Enhanced cache synchronization system
 */

import { createLogger } from '../utils/OfflineLogger.js';
import offlineEvents, { EVENTS } from '../core/OfflineEvents.js';
import { notifyCacheUpdate, updateCacheVersion } from '$lib/utils/cacheSync.js';
import { browser } from '$app/environment';
import { getCachedPDFsFast } from '$lib/utils/swRegistration.js';

const logger = createLogger('CacheSync');

/**
 * Cache Synchronization Manager
 * Handles synchronization between multiple cache layers:
 * - Memory cache (statsCalculationCache)
 * - Persistent cache (statsCache.js)
 * - Service Worker cache
 */
class CacheSync {
  constructor() {
    this.syncListeners = [];
    this.isSyncing = false;
    this.lastSyncTime = null;
    this._setupEventListeners();
  }

  /**
   * Setup event listeners for automatic sync triggers
   * @private
   */
  _setupEventListeners() {
    if (!browser) return;

    // Listen for download complete events
    offlineEvents.on(EVENTS.DOWNLOAD_COMPLETE, () => {
      logger.debug('CacheSync', 'Download complete event received, triggering sync');
      this.sync().catch(err => {
        logger.error('CacheSync', 'Error syncing after download:', err);
      });
    });

    // Listen for cache cleared events
    offlineEvents.on(EVENTS.CACHE_CLEARED, () => {
      logger.debug('CacheSync', 'Cache cleared event received, invalidating stats');
      this.invalidate();
    });

    // Listen for PDF downloaded events
    offlineEvents.on(EVENTS.PDF_DOWNLOADED, (event) => {
      logger.debug('CacheSync', 'PDF downloaded event received', event.detail);
      // Sync after a short delay to allow cache to update
      setTimeout(() => {
        this.sync().catch(err => {
          logger.error('CacheSync', 'Error syncing after PDF download:', err);
        });
      }, 500);
    });

    // Listen for cache updated events from other tabs
    if (typeof window !== 'undefined') {
      window.addEventListener('cache-sync-required', () => {
        logger.debug('CacheSync', 'Cache sync required from another tab');
        this.sync().catch(err => {
          logger.error('CacheSync', 'Error syncing from tab event:', err);
        });
      });
    }
  }

  /**
   * Synchronize all caches
   * Ensures consistency between memory, localStorage, and Service Worker cache
   * @param {Object} [options] - Sync options
   * @param {boolean} [options.force=false] - Force sync even if recently synced
   * @param {boolean} [options.batch=false] - Whether this is during a batch operation
   * @returns {Promise<void>}
   */
  async sync(options = {}) {
    const { force = false, batch = false } = options;

    // Skip sync during batch mode (unless forced)
    if (!force && batch) {
      logger.debug('CacheSync', 'Sync skipped - batch mode active');
      return;
    }

    // Check if CacheStorageAdapter is in batch mode
    if (!force) {
      try {
        const cacheStorageAdapter = await import('./CacheStorageAdapter.js');
        if (cacheStorageAdapter.default && cacheStorageAdapter.default.isInBatchMode()) {
          logger.debug('CacheSync', 'Sync skipped - CacheStorageAdapter in batch mode');
          return;
        }
      } catch (error) {
        // Ignore import errors - proceed with sync
      }
    }

    // Prevent concurrent syncs
    if (this.isSyncing && !force) {
      logger.debug('CacheSync', 'Sync already in progress, skipping');
      return;
    }

    // Throttle syncs (max once per 2 seconds)
    if (!force && this.lastSyncTime && Date.now() - this.lastSyncTime < 2000) {
      logger.debug('CacheSync', 'Sync throttled, too soon since last sync');
      return;
    }

    this.isSyncing = true;
    const startTime = performance.now();

    try {
      logger.debug('CacheSync', 'Starting cache synchronization');

      // 1. Get current state from Service Worker (source of truth)
      let cachedPdfs = [];
      if (browser) {
        try {
          cachedPdfs = await getCachedPDFsFast();
        } catch (error) {
          logger.warn('CacheSync', 'Failed to get cached PDFs from SW:', error);
        }
      }

      // 2. Update cache version
      if (browser) {
        await updateCacheVersion();
      }

      // 3. Notify other tabs of cache update
      if (browser) {
        notifyCacheUpdate({
          cachedCount: cachedPdfs.length,
          timestamp: Date.now()
        });
      }

      // 4. Emit sync event for listeners
      offlineEvents.emit(EVENTS.CACHE_SYNCED, {
        cachedCount: cachedPdfs.length,
        timestamp: Date.now()
      });

      // 5. Notify all sync listeners
      this.syncListeners.forEach(listener => {
        try {
          listener({
            cachedPdfs,
            timestamp: Date.now()
          });
        } catch (error) {
          logger.error('CacheSync', 'Error in sync listener:', error);
        }
      });

      this.lastSyncTime = Date.now();
      const syncTime = performance.now() - startTime;
      logger.debug('CacheSync', `Cache synchronization completed in ${syncTime.toFixed(2)}ms`);

    } catch (error) {
      logger.error('CacheSync', 'Error during cache synchronization:', error);
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Sync from a specific source
   * Used when we know the source of truth (e.g., after download)
   * @param {Object} source - Source data
   * @param {Array} source.cachedPdfs - Cached PDFs from source
   * @returns {Promise<void>}
   */
  async syncFrom(source) {
    if (!source || !source.cachedPdfs) {
      logger.warn('CacheSync', 'Invalid source provided for sync');
      return;
    }

    logger.debug('CacheSync', `Syncing from source with ${source.cachedPdfs.length} cached PDFs`);

    try {
      // Update cache version
      if (browser) {
        await updateCacheVersion();
      }

      // Notify other tabs
      if (browser) {
        notifyCacheUpdate({
          cachedCount: source.cachedPdfs.length,
          timestamp: Date.now(),
          source: 'sync-from'
        });
      }

      // Emit sync event
      offlineEvents.emit(EVENTS.CACHE_SYNCED, {
        cachedPdfs: source.cachedPdfs,
        cachedCount: source.cachedPdfs.length,
        timestamp: Date.now()
      });

      // Notify listeners
      this.syncListeners.forEach(listener => {
        try {
          listener({
            cachedPdfs: source.cachedPdfs,
            timestamp: Date.now()
          });
        } catch (error) {
          logger.error('CacheSync', 'Error in sync listener:', error);
        }
      });

    } catch (error) {
      logger.error('CacheSync', 'Error syncing from source:', error);
      throw error;
    }
  }

  /**
   * Add a listener for cache update events
   * @param {Function} callback - Callback function to call on cache updates
   * @returns {Function} Unsubscribe function
   */
  onCacheUpdate(callback) {
    if (typeof callback !== 'function') {
      logger.warn('CacheSync', 'Listener must be a function');
      return () => {};
    }

    this.syncListeners.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.syncListeners.indexOf(callback);
      if (index > -1) {
        this.syncListeners.splice(index, 1);
      }
    };
  }

  /**
   * Invalidate all caches
   * Clears memory cache and invalidates persistent cache
   * @returns {Promise<void>}
   */
  async invalidate() {
    logger.debug('CacheSync', 'Invalidating all caches');

    try {
      // Clear memory cache (statsCalculationCache from offline.js)
      // This will be handled by StatsCalculator.invalidateAll()
      
      // Invalidate persistent stats cache
      const { invalidateCategories, getAllCachedStats } = await import('$lib/utils/statsCache.js');
      const allCached = getAllCachedStats();
      const categories = Object.keys(allCached);
      if (categories.length > 0) {
        invalidateCategories(categories);
      }

      // Emit invalidation event
      offlineEvents.emit(EVENTS.CACHE_UPDATED, {
        type: 'invalidation',
        timestamp: Date.now()
      });

      // Notify other tabs
      if (browser) {
        notifyCacheUpdate({
          type: 'invalidation',
          timestamp: Date.now()
        });
      }

      logger.debug('CacheSync', 'Cache invalidation completed');

    } catch (error) {
      logger.error('CacheSync', 'Error invalidating caches:', error);
      throw error;
    }
  }

  /**
   * Get sync status
   * @returns {Object} Sync status information
   */
  getStatus() {
    return {
      isSyncing: this.isSyncing,
      lastSyncTime: this.lastSyncTime,
      listenersCount: this.syncListeners.length
    };
  }
}

// Create singleton instance
const cacheSync = new CacheSync();

export default cacheSync;
