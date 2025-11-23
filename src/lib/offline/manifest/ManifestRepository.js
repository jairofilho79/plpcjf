/**
 * Manifest Repository
 * Unified interface for accessing manifests with automatic fallback and caching
 */

import r2ManifestProvider from './R2ManifestProvider.js';
import staticManifestProvider from './StaticManifestProvider.js';
import manifestCache from './ManifestCache.js';
import offlineEvents, { EVENTS } from '../core/OfflineEvents.js';
import { createLogger } from '../utils/OfflineLogger.js';

const logger = createLogger('ManifestRepository');

/**
 * Manifest Repository
 * Provides unified access to manifests with R2/Static fallback and caching
 */
class ManifestRepository {
  /**
   * Get louvores manifest
   * @param {boolean} [useCache=true] - Use cache if available
   * @returns {Promise<Array>} Louvores manifest array
   */
  async getLouvoresManifest(useCache = true) {
    return this._getManifest('louvores', useCache);
  }

  /**
   * Get offline manifest
   * @param {boolean} [useCache=true] - Use cache if available
   * @returns {Promise<Object>} Offline manifest object
   */
  async getOfflineManifest(useCache = true) {
    return this._getManifest('offline', useCache);
  }

  /**
   * Get manifest with fallback strategy
   * @param {string} type - Manifest type ('louvores' or 'offline')
   * @param {boolean} useCache - Use cache if available
   * @returns {Promise<Object|Array>} Manifest data
   * @private
   */
  async _getManifest(type, useCache) {
    // 1. Check cache first if enabled
    if (useCache) {
      const cached = await manifestCache.get(type);
      if (cached !== null) {
        logger.debug('ManifestRepository', `Using cached ${type} manifest`);
        return cached;
      }
    }

    // 2. Try R2 provider first
    logger.debug('ManifestRepository', `Fetching ${type} manifest from R2...`);
    let data = await r2ManifestProvider.fetchManifest(type);

    // 3. Fallback to static if R2 fails
    if (!data) {
      logger.debug('ManifestRepository', `R2 failed, trying static for ${type} manifest...`);
      data = await staticManifestProvider.fetchManifest(type);
    }

    // 4. If still no data, return empty structure
    if (!data) {
      logger.warn('ManifestRepository', `No ${type} manifest available from any source`);
      
      // Return appropriate empty structure
      if (type === 'louvores') {
        data = [];
      } else {
        data = { packages: {} };
      }
    }

    // 5. Validate integrity
    if (!manifestCache.validateIntegrity(type, data)) {
      logger.warn('ManifestRepository', `${type} manifest failed integrity check`);
      
      // Return empty structure
      if (type === 'louvores') {
        data = [];
      } else {
        data = { packages: {} };
      }
    }

    // 6. Cache the result
    if (useCache && data) {
      await manifestCache.set(type, data);
    }

    // 7. Emit event
    offlineEvents.emit(EVENTS.MANIFEST_LOADED, {
      type,
      source: data ? 'r2' : 'static',
      cached: useCache
    });

    return data;
  }

  /**
   * Get cached manifest (if available and not expired)
   * @param {string} type - Manifest type ('louvores' or 'offline')
   * @returns {Promise<Object|Array|null>} Cached manifest or null
   */
  async getCachedManifest(type) {
    if (!type || (type !== 'louvores' && type !== 'offline')) {
      throw new Error(`Invalid manifest type: ${type}`);
    }

    return await manifestCache.get(type);
  }

  /**
   * Invalidate manifest cache
   * @param {string} [type] - Manifest type to invalidate (optional, invalidates all)
   */
  async invalidateCache(type = null) {
    if (type) {
      if (type !== 'louvores' && type !== 'offline') {
        throw new Error(`Invalid manifest type: ${type}`);
      }
      
      // Remove specific manifest
      manifestCache.remove(type);
      logger.info('ManifestRepository', `Cache invalidated for ${type} manifest`);
    } else {
      // Clear all
      manifestCache.clear();
      logger.info('ManifestRepository', 'All manifest cache invalidated');
    }
  }

  /**
   * Validate manifest integrity
   * @param {string} type - Manifest type
   * @param {Object|Array} data - Manifest data
   * @returns {boolean} True if valid
   */
  validateIntegrity(type, data) {
    return manifestCache.validateIntegrity(type, data);
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    return manifestCache.getStats();
  }
}

// Create singleton instance
const manifestRepository = new ManifestRepository();

export default manifestRepository;

// Export class for testing
export { ManifestRepository };

