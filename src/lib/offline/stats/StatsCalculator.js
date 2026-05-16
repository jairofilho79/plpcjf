/**
 * Stats Calculator
 * Centralized calculator for category availability statistics
 *
 * Source of truth: IndexedDB via OfflineInventoryRepository.
 * The Cache API is no longer queried for stats; only IDB entries with a valid
 * blob are counted as "persisted".
 */

import { getCachedStats, cacheStats, invalidateCategory, invalidateCategories, getAllCachedStats, isCacheValid } from '$lib/utils/statsCache.js';
import { createLogger } from '../utils/OfflineLogger.js';
import { browser } from '$app/environment';
import { getCurrentStatsRevision } from '../core/OfflineRevision.js';
import offlineInventoryRepository from '../storage/OfflineInventoryRepository.js';

const logger = createLogger('StatsCalculator');

/**
 * @typedef {Object} CategoryStats
 * @property {number} total - Total number of PDFs in category
 * @property {number} available - Number of PDFs available in cache
 * @property {number} missing - Number of PDFs missing from cache
 * @property {number} percentage - Percentage of PDFs available (0-100)
 */

/**
 * @typedef {Object} StatsOptions
 * @property {boolean} [useCache=true] - Use cached stats if available
 * @property {boolean} [forceRecalculate=false] - Force recalculation even if cached
 * @property {Array} [louvoresData] - Louvores data (if not provided, will be fetched from store)
 * @property {Set} [persistedSet] - Pre-fetched persisted lookup set (fetched internally if omitted)
 */

class StatsCalculator {
  constructor() {
    this.memoryCache = new Map();
    this.calculationInProgress = new Set();
  }

  /**
   * Get stats for a single category.
   *
   * @param {string} category
   * @param {StatsOptions} [options={}]
   * @returns {Promise<CategoryStats>}
   */
  async getCategoryStats(category, options = {}) {
    if (!category) {
      return { total: 0, available: 0, missing: 0, percentage: 0 };
    }

    const {
      useCache = true,
      forceRecalculate = false,
      louvoresData = null,
      persistedSet = null
    } = options;

    // Memory cache — valid for 60 s
    if (!forceRecalculate && useCache && this.memoryCache.has(category)) {
      const cached = this.memoryCache.get(category);
      if (cached?.timestamp && Date.now() - cached.timestamp < 60_000) {
        logger.debug('StatsCalculator', `Memory cache hit for category: ${category}`);
        return cached.stats;
      }
    }

    // Persistent localStorage cache
    if (!forceRecalculate && useCache) {
      const cached = getCachedStats(category);
      if (cached) {
        this.memoryCache.set(category, { stats: cached, timestamp: Date.now() });
        logger.debug('StatsCalculator', `Persistent cache hit for category: ${category}`);
        return cached;
      }
    }

    // Coalesce concurrent calculations for the same category
    if (this.calculationInProgress.has(category)) {
      await new Promise((resolve) => {
        const id = setInterval(() => {
          if (!this.calculationInProgress.has(category)) {
            clearInterval(id);
            resolve(undefined);
          }
        }, 50);
      });
      const cached = this.memoryCache.get(category) || getCachedStats(category);
      if (cached) return cached.stats || cached;
    }

    this.calculationInProgress.add(category);

    try {
      const startTime = performance.now();

      // Resolve louvores data
      let louvores = louvoresData;
      if (!louvores) {
        const { louvores: louvoresStore } = await import('$lib/stores/louvores.js');
        const { get } = await import('svelte/store');
        louvores = get(louvoresStore);
      }

      if (!louvores || !Array.isArray(louvores)) {
        logger.warn('StatsCalculator', 'No louvores data available');
        return { total: 0, available: 0, missing: 0, percentage: 0 };
      }

      // Fetch persisted set once per getAllStats call (shared via options.persistedSet)
      let set = persistedSet;
      if (!set && browser) {
        set = await offlineInventoryRepository.getPersistedLookupSet();
      } else if (!set) {
        set = new Set();
      }

      // Aggregate subcategories (e.g., "Cifra nível I/II" → "Cifra")
      const categoryVariants = this._getCategoryVariants(this._normalizeCategory(category));
      const categoryLouvores = louvores.filter((l) => categoryVariants.includes(l.categoria));
      const total = categoryLouvores.filter((l) => l.pdfId).length;

      if (total === 0) {
        const result = { total: 0, available: 0, missing: 0, percentage: 0 };
        this._cacheResult(category, result);
        return result;
      }

      // Compute missing PDFs against IndexedDB inventory (synchronous, set already loaded)
      const missing = offlineInventoryRepository.computeMissingPdfs(categoryLouvores, set);

      const available = total - missing.length;
      const percentage = total > 0 ? Math.round((available / total) * 100) : 0;
      const result = { total, available, missing: missing.length, percentage };

      this._cacheResult(category, result);

      const elapsed = performance.now() - startTime;
      logger.debug('StatsCalculator', `Calculated stats for ${category} in ${elapsed.toFixed(2)}ms`);

      return result;
    } catch (error) {
      logger.error('StatsCalculator', `Error calculating stats for ${category}:`, error);
      return { total: 0, available: 0, missing: 0, percentage: 0 };
    } finally {
      this.calculationInProgress.delete(category);
    }
  }

  /**
   * Get stats for all categories.
   *
   * Fetches the persisted set once and reuses it across all category calculations
   * to avoid N round-trips to IndexedDB.
   *
   * @param {StatsOptions} [options={}]
   * @returns {Promise<Record<string, CategoryStats>>}
   */
  async getAllStats(options = {}) {
    const { useCache = true, forceRecalculate = false, louvoresData = null } = options;

    let louvores = louvoresData;
    if (!louvores) {
      const { louvores: louvoresStore } = await import('$lib/stores/louvores.js');
      const { get } = await import('svelte/store');
      louvores = get(louvoresStore);
    }

    if (!louvores || !Array.isArray(louvores)) {
      logger.warn('StatsCalculator', 'No louvores data available');
      return {};
    }

    // Collect normalized category names
    const allRaw = [...new Set(louvores.map((l) => l.categoria).filter(Boolean))];
    const categories = [...new Set(allRaw.map((c) => this._normalizeCategory(c)))];

    // Pre-populate memory cache from localStorage if available
    if (useCache && !forceRecalculate) {
      const allCached = getAllCachedStats();
      Object.entries(allCached).forEach(([cat, stats]) => {
        this.memoryCache.set(cat, { stats, timestamp: Date.now() });
      });
    }

    // Fetch the persisted set ONCE and share it with all per-category calls
    const persistedSet = browser ? await offlineInventoryRepository.getPersistedLookupSet() : new Set();

    const allStats = /** @type {Record<string, CategoryStats>} */ ({});
    await Promise.all(
      categories.map(async (category) => {
        const stats = await this.getCategoryStats(category, {
          ...options,
          louvoresData: louvores,
          persistedSet
        });
        allStats[category] = stats;
      })
    );

    return allStats;
  }

  invalidateCategory(category) {
    if (!category) return;
    this.memoryCache.delete(category);
    invalidateCategory(category);
    logger.debug('StatsCalculator', `Invalidated stats for category: ${category}`);
  }

  invalidateAll() {
    this.memoryCache.clear();
    const allCached = getAllCachedStats();
    invalidateCategories(Object.keys(allCached));
    logger.debug('StatsCalculator', 'Invalidated all stats');
  }

  async sync() {
    logger.debug('StatsCalculator', 'Syncing stats with inventory state');
    if (!isCacheValid()) {
      this.invalidateAll();
      logger.debug('StatsCalculator', `Stats invalidated — revision=${getCurrentStatsRevision()}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  _normalizeCategory(category) {
    if (!category) return category;
    if (category === 'Cifra nível I' || category === 'Cifra nível II') return 'Cifra';
    return category;
  }

  _getCategoryVariants(normalizedCategory) {
    if (normalizedCategory === 'Cifra') return ['Cifra', 'Cifra nível I', 'Cifra nível II'];
    return [normalizedCategory];
  }

  _cacheResult(category, stats) {
    this.memoryCache.set(category, {
      stats,
      timestamp: Date.now(),
      statsRevision: getCurrentStatsRevision()
    });

    // Cap memory cache at 50 entries
    if (this.memoryCache.size > 50) {
      this.memoryCache.delete(this.memoryCache.keys().next().value);
    }

    cacheStats(category, stats, {});
  }
}

const statsCalculator = new StatsCalculator();

export default statsCalculator;
