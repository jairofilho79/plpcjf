/**
 * Stats Calculator
 * Centralized calculator for category availability statistics
 * FASE 4: Refactored from offline.js to dedicated module
 */

import cacheStorageAdapter from '../storage/CacheStorageAdapter.js';
import { findMissingPdfs } from '$lib/utils/pdfValidation.js';
import { getCachedStats, cacheStats, invalidateCategory, invalidateCategories, getAllCachedStats } from '$lib/utils/statsCache.js';
import { createLogger } from '../utils/OfflineLogger.js';
import { browser } from '$app/environment';
import { getCachedPDFsFast } from '$lib/utils/swRegistration.js';

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
 * @property {Array} [cachedPdfs] - Cached PDFs list (if not provided, will be fetched)
 */

/**
 * Stats Calculator
 * Calculates category availability statistics with intelligent caching
 */
class StatsCalculator {
  constructor() {
    this.cacheAdapter = cacheStorageAdapter;
    this.memoryCache = new Map(); // In-memory cache for quick access
    this.calculationInProgress = new Set(); // Track calculations in progress to avoid duplicates
  }

  /**
   * Get stats for a single category
   * @param {string} category - Category name
   * @param {StatsOptions} [options={}] - Calculation options
   * @returns {Promise<CategoryStats>} Category statistics
   */
  async getCategoryStats(category, options = {}) {
    if (!category) {
      return { total: 0, available: 0, missing: 0, percentage: 0 };
    }

    const {
      useCache = true,
      forceRecalculate = false,
      louvoresData = null,
      cachedPdfs = null
    } = options;

    // Check memory cache first (fastest)
    if (!forceRecalculate && useCache && this.memoryCache.has(category)) {
      const cached = this.memoryCache.get(category);
      // Check if cache is still valid (basic check)
      if (cached && cached.timestamp && Date.now() - cached.timestamp < 60000) {
        logger.debug('StatsCalculator', `Memory cache hit for category: ${category}`);
        return cached.stats;
      }
    }

    // Check persistent cache
    if (!forceRecalculate && useCache) {
      const cached = getCachedStats(category);
      if (cached) {
        // Update memory cache
        this.memoryCache.set(category, {
          stats: cached,
          timestamp: Date.now()
        });
        logger.debug('StatsCalculator', `Persistent cache hit for category: ${category}`);
        return cached;
      }
    }

    // Prevent duplicate calculations
    if (this.calculationInProgress.has(category)) {
      // Wait for existing calculation
      await new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (!this.calculationInProgress.has(category)) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 50);
      });
      
      // Try cache again after waiting
      const cached = this.memoryCache.get(category) || getCachedStats(category);
      if (cached) {
        return cached.stats || cached;
      }
    }

    // Mark as in progress
    this.calculationInProgress.add(category);

    try {
      const startTime = performance.now();

      // Get louvores data
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

      // Get cached PDFs
      let cachedPdfsList = cachedPdfs;
      if (!cachedPdfsList) {
        if (browser) {
          cachedPdfsList = await getCachedPDFsFast();
        } else {
          cachedPdfsList = [];
        }
      }

      // Normalize category and get all variants (e.g., "Cifra" includes "Cifra nível I" and "Cifra nível II")
      const normalizedCategory = this._normalizeCategory(category);
      const categoryVariants = this._getCategoryVariants(normalizedCategory);
      
      // Filter louvores by category and its variants
      const categoryLouvores = louvores.filter(l => categoryVariants.includes(l.categoria));
      const total = categoryLouvores.length;

      if (total === 0) {
        const result = { total: 0, available: 0, missing: 0, percentage: 0 };
        this._cacheResult(category, result, louvores.length, cachedPdfsList.length);
        return result;
      }

      // Calculate missing PDFs
      let missing;
      if (categoryLouvores.length > 100) {
        // Process in chunks for large categories to avoid blocking UI
        missing = [];
        const chunkSize = 50;
        for (let i = 0; i < categoryLouvores.length; i += chunkSize) {
          const chunk = categoryLouvores.slice(i, i + chunkSize);
          const chunkMissing = findMissingPdfs(chunk, cachedPdfsList);
          missing.push(...chunkMissing);
          
          // Yield to UI if needed
          if (i + chunkSize < categoryLouvores.length) {
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
      } else {
        missing = findMissingPdfs(categoryLouvores, cachedPdfsList);
      }

      const available = total - missing.length;
      const percentage = total > 0 ? Math.round((available / total) * 100) : 0;

      const result = { total, available, missing: missing.length, percentage };

      // Cache the result
      this._cacheResult(category, result, louvores.length, cachedPdfsList.length);

      const calculationTime = performance.now() - startTime;
      logger.debug('StatsCalculator', `Calculated stats for ${category} in ${calculationTime.toFixed(2)}ms`);

      return result;
    } catch (error) {
      logger.error('StatsCalculator', `Error calculating stats for ${category}:`, error);
      return { total: 0, available: 0, missing: 0, percentage: 0 };
    } finally {
      this.calculationInProgress.delete(category);
    }
  }

  /**
   * Get stats for all categories
   * @param {StatsOptions} [options={}] - Calculation options
   * @returns {Promise<Record<string, CategoryStats>>} Map of category -> stats
   */
  async getAllStats(options = {}) {
    const {
      useCache = true,
      forceRecalculate = false,
      louvoresData = null,
      cachedPdfs = null
    } = options;

    // Get louvores data
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

      // Get all unique categories and normalize them
      const allCategories = [...new Set(louvores.map(l => l.categoria).filter(Boolean))];
      const categories = [...new Set(allCategories.map(cat => this._normalizeCategory(cat)))];

    // Load all cached stats if available
    if (useCache && !forceRecalculate) {
      const allCached = getAllCachedStats();
      if (Object.keys(allCached).length > 0) {
        // Update memory cache
        Object.entries(allCached).forEach(([category, stats]) => {
          this.memoryCache.set(category, {
            stats,
            timestamp: Date.now()
          });
        });
      }
    }

    // Calculate stats for all categories
    const allStats = {};
    const statsPromises = categories.map(async (category) => {
      const stats = await this.getCategoryStats(category, {
        ...options,
        louvoresData: louvores,
        cachedPdfs
      });
      allStats[category] = stats;
    });

    await Promise.all(statsPromises);

    return allStats;
  }

  /**
   * Invalidate stats for a specific category
   * @param {string} category - Category to invalidate
   */
  invalidateCategory(category) {
    if (!category) return;

    // Remove from memory cache
    this.memoryCache.delete(category);

    // Invalidate persistent cache
    invalidateCategory(category);

    logger.debug('StatsCalculator', `Invalidated stats for category: ${category}`);
  }

  /**
   * Invalidate stats for all categories
   */
  invalidateAll() {
    // Clear memory cache
    this.memoryCache.clear();

    // Invalidate all persistent cache
    const allCached = getAllCachedStats();
    const categories = Object.keys(allCached);
    invalidateCategories(categories);

    logger.debug('StatsCalculator', 'Invalidated all stats');
  }

  /**
   * Sync stats with current cache state
   * Invalidates and recalculates stats if cache has changed
   * @param {Array} [cachedPdfs] - Current cached PDFs list
   * @returns {Promise<void>}
   */
  async sync(cachedPdfs = null) {
    logger.debug('StatsCalculator', 'Syncing stats with cache state');

    // Get current cached PDFs if not provided
    let currentCachedPdfs = cachedPdfs;
    if (!currentCachedPdfs && browser) {
      currentCachedPdfs = await getCachedPDFsFast();
    }

    // Get cached stats metadata to compare
    const allCached = getAllCachedStats();
    
    // For now, we'll invalidate all and let them be recalculated on demand
    // This is simpler and ensures consistency
    // In the future, we could do incremental sync
    this.invalidateAll();

    logger.debug('StatsCalculator', 'Stats sync completed');
  }

  /**
   * Normalize category name - aggregates subcategories into main category
   * @param {string} category - Category name to normalize
   * @returns {string} Normalized category name
   * @private
   */
  _normalizeCategory(category) {
    if (!category) return category;
    if (category === 'Cifra nível I' || category === 'Cifra nível II') {
      return 'Cifra';
    }
    return category;
  }

  /**
   * Get all categories that should be aggregated into a normalized category
   * @param {string} normalizedCategory - Normalized category name
   * @returns {string[]} Array of category names that map to this normalized category
   * @private
   */
  _getCategoryVariants(normalizedCategory) {
    if (normalizedCategory === 'Cifra') {
      return ['Cifra', 'Cifra nível I', 'Cifra nível II'];
    }
    return [normalizedCategory];
  }

  /**
   * Cache calculation result
   * @param {string} category - Category name
   * @param {CategoryStats} stats - Stats to cache
   * @param {number} louvoresCount - Total louvores count
   * @param {number} cachedPdfsCount - Total cached PDFs count
   * @private
   */
  _cacheResult(category, stats, louvoresCount, cachedPdfsCount) {
    // Cache in memory
    this.memoryCache.set(category, {
      stats,
      timestamp: Date.now(),
      louvoresCount,
      cachedPdfsCount
    });

    // Limit memory cache size (keep last 50)
    if (this.memoryCache.size > 50) {
      const firstKey = this.memoryCache.keys().next().value;
      this.memoryCache.delete(firstKey);
    }

    // Cache persistently
    cacheStats(category, stats, {
      louvoresCount,
      cachedPdfsCount
    });
  }
}

// Create singleton instance
const statsCalculator = new StatsCalculator();

export default statsCalculator;
