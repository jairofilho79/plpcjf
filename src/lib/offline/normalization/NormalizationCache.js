/**
 * Normalization Cache
 * In-memory cache for URL normalizations with LRU eviction
 */

import { getConfig } from '../core/OfflineConfig.js';
import { createLogger } from '../utils/OfflineLogger.js';

const logger = createLogger('NormalizationCache');

/**
 * LRU Cache for URL normalizations
 */
class NormalizationCache {
  /**
   * @param {number} [maxSize] - Maximum cache size
   */
  constructor(maxSize = null) {
    this.maxSize = maxSize || getConfig('NORMALIZATION_CACHE_SIZE') || 1000;
    this.cache = new Map();
  }

  /**
   * Get normalized URL from cache
   * @param {string} url - Original URL
   * @returns {string|null} Normalized URL or null if not cached
   */
  get(url) {
    if (!url || typeof url !== 'string') {
      return null;
    }

    if (this.cache.has(url)) {
      // Move to end (most recently used)
      const value = this.cache.get(url);
      this.cache.delete(url);
      this.cache.set(url, value);
      return value;
    }

    return null;
  }

  /**
   * Set normalized URL in cache
   * @param {string} url - Original URL
   * @param {string} normalized - Normalized URL
   */
  set(url, normalized) {
    if (!url || typeof url !== 'string' || !normalized || typeof normalized !== 'string') {
      return;
    }

    // If already exists, remove it first to update position
    if (this.cache.has(url)) {
      this.cache.delete(url);
    }

    // If cache is full, remove least recently used (first item)
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      logger.debug('NormalizationCache', `Cache full, evicted: ${firstKey}`);
    }

    // Add to end (most recently used)
    this.cache.set(url, normalized);
  }

  /**
   * Check if URL is in cache
   * @param {string} url - URL to check
   * @returns {boolean} True if cached
   */
  has(url) {
    if (!url || typeof url !== 'string') {
      return false;
    }
    return this.cache.has(url);
  }

  /**
   * Clear all cached normalizations
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    logger.debug('NormalizationCache', `Cache cleared (${size} entries removed)`);
  }

  /**
   * Get cache size
   * @returns {number} Current cache size
   */
  size() {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      usage: ((this.cache.size / this.maxSize) * 100).toFixed(2) + '%'
    };
  }
}

// Create singleton instance
const normalizationCache = new NormalizationCache();

export default normalizationCache;

// Export class for testing
export { NormalizationCache };

