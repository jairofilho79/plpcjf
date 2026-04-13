/**
 * Manifest Cache
 * Cache for manifest files with TTL support
 */

import { getConfig } from '../core/OfflineConfig.js';
import { createLogger } from '../utils/OfflineLogger.js';
import { browser } from '$app/environment';

const logger = createLogger('ManifestCache');

/**
 * Manifest Cache
 * Stores manifest data in localStorage with TTL
 */
class ManifestCache {
  /**
   * @param {number} [ttl] - Time to live in milliseconds
   */
  constructor(ttl = null) {
    this.ttl = ttl || getConfig('MANIFEST_CACHE_TTL') || 5 * 60 * 1000;
    this.prefix = 'offline_manifest_';
  }

  /**
   * Get manifest from cache
   * @param {string} type - Manifest type ('louvores' or 'offline')
   * @returns {Promise<Object|null>} Cached manifest or null if expired/not found
   */
  async get(type) {
    if (!browser) {
      return null;
    }

    try {
      const key = this._getKey(type);
      const stored = localStorage.getItem(key);
      
      if (!stored) {
        return null;
      }

      const { data, timestamp } = JSON.parse(stored);
      
      // Check if expired
      if (this.isExpired(type)) {
        logger.debug('ManifestCache', `Cache expired for ${type}, removing`);
        this.remove(type);
        return null;
      }

      logger.debug('ManifestCache', `Retrieved ${type} manifest from cache`);
      return data;
    } catch (error) {
      logger.warn('ManifestCache', `Error reading ${type} manifest from cache`, error);
      return null;
    }
  }

  /**
   * Set manifest in cache
   * @param {string} type - Manifest type ('louvores' or 'offline')
   * @param {Object} data - Manifest data
   */
  async set(type, data) {
    if (!browser) {
      return;
    }

    try {
      const key = this._getKey(type);
      const cacheEntry = {
        data,
        timestamp: Date.now()
      };
      
      localStorage.setItem(key, JSON.stringify(cacheEntry));
      logger.debug('ManifestCache', `Cached ${type} manifest`);
    } catch (error) {
      logger.error('ManifestCache', `Error caching ${type} manifest`, error);
      
      // If quota exceeded, try to clear expired entries
      if (error.name === 'QuotaExceededError') {
        logger.warn('ManifestCache', 'localStorage quota exceeded, clearing expired entries');
        this.clearExpired();
      }
    }
  }

  /**
   * Check if manifest cache is expired
   * @param {string} type - Manifest type
   * @returns {boolean} True if expired
   */
  isExpired(type) {
    if (!browser) {
      return true;
    }

    try {
      const key = this._getKey(type);
      const stored = localStorage.getItem(key);
      
      if (!stored) {
        return true;
      }

      const { timestamp } = JSON.parse(stored);
      const age = Date.now() - timestamp;
      
      return age > this.ttl;
    } catch (error) {
      logger.warn('ManifestCache', `Error checking expiration for ${type}`, error);
      return true;
    }
  }

  /**
   * Remove manifest from cache
   * @param {string} type - Manifest type
   */
  remove(type) {
    this._remove(type);
  }

  /**
   * @param {string} type - Manifest type
   * @private
   */
  _remove(type) {
    if (!browser) {
      return;
    }

    try {
      const key = this._getKey(type);
      localStorage.removeItem(key);
    } catch (error) {
      logger.warn('ManifestCache', `Error removing ${type} from cache`, error);
    }
  }

  /**
   * Clear all manifest cache
   */
  clear() {
    if (!browser) {
      return;
    }

    try {
      localStorage.removeItem(this._getKey('louvores'));
      localStorage.removeItem(this._getKey('offline'));
      logger.info('ManifestCache', 'All manifest cache cleared');
    } catch (error) {
      logger.error('ManifestCache', 'Error clearing cache', error);
    }
  }

  /**
   * Clear expired entries
   */
  clearExpired() {
    if (!browser) {
      return;
    }

    const types = ['louvores', 'offline'];
    let cleared = 0;

    for (const type of types) {
      if (this.isExpired(type)) {
        this.remove(type);
        cleared++;
      }
    }

    if (cleared > 0) {
      logger.info('ManifestCache', `Cleared ${cleared} expired manifest(s)`);
    }
  }

  /**
   * Validate manifest integrity
   * Basic validation - checks if manifest has required structure
   * @param {string} type - Manifest type
   * @param {Object} data - Manifest data to validate
   * @returns {boolean} True if valid
   */
  validateIntegrity(type, data) {
    if (!data || typeof data !== 'object') {
      return false;
    }

    if (type === 'louvores') {
      // Louvores manifest should be an array
      return Array.isArray(data);
    }

    if (type === 'offline') {
      // Offline manifest should have packages object
      return data.packages && typeof data.packages === 'object';
    }

    return false;
  }

  /**
   * Get cache key for manifest type
   * @param {string} type - Manifest type
   * @returns {string} Cache key
   * @private
   */
  _getKey(type) {
    return `${this.prefix}${type}`;
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getStats() {
    if (!browser) {
      return { louvores: null, offline: null };
    }

    const stats = {
      louvores: null,
      offline: null
    };

    for (const type of ['louvores', 'offline']) {
      try {
        const key = this._getKey(type);
        const stored = localStorage.getItem(key);
        
        if (stored) {
          const { timestamp } = JSON.parse(stored);
          const age = Date.now() - timestamp;
          const expired = age > this.ttl;
          
          stats[type] = {
            cached: true,
            age: age,
            expired: expired,
            ttl: this.ttl
          };
        } else {
          stats[type] = {
            cached: false
          };
        }
      } catch (error) {
        stats[type] = {
          cached: false,
          error: error.message
        };
      }
    }

    return stats;
  }
}

// Create singleton instance
const manifestCache = new ManifestCache();

export default manifestCache;

// Export class for testing
export { ManifestCache };

