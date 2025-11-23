/**
 * R2 Manifest Provider
 * Fetches manifests from R2 bucket via application routes
 */

import { getConfig } from '../core/OfflineConfig.js';
import { createLogger } from '../utils/OfflineLogger.js';

const logger = createLogger('R2ManifestProvider');

/**
 * R2 Manifest Provider
 * Fetches manifests via application routes that access R2 bucket
 */
class R2ManifestProvider {
  /**
   * Fetch manifest from R2 via route
   * @param {string} type - Manifest type ('louvores' or 'offline')
   * @returns {Promise<Object|null>} Manifest data or null if not found
   */
  async fetchManifest(type) {
    if (!type || (type !== 'louvores' && type !== 'offline')) {
      throw new Error(`Invalid manifest type: ${type}`);
    }

    try {
      const url = type === 'louvores' 
        ? getConfig('LOUVORES_MANIFEST_URL')
        : getConfig('OFFLINE_MANIFEST_URL');

      logger.debug('R2ManifestProvider', `Fetching ${type} manifest from: ${url}`);

      const response = await fetch(url, {
        cache: 'no-cache',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          logger.warn('R2ManifestProvider', `${type} manifest not found (404)`);
          return null;
        }
        throw new Error(`Failed to fetch ${type} manifest: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      logger.info('R2ManifestProvider', `Successfully fetched ${type} manifest`);
      return data;
    } catch (error) {
      logger.error('R2ManifestProvider', `Error fetching ${type} manifest from R2`, error);
      
      // Return null instead of throwing to allow fallback
      return null;
    }
  }

  /**
   * Check if provider is available
   * @returns {Promise<boolean>} True if provider is available
   */
  async isAvailable() {
    try {
      // Try to fetch a small resource to check if routes are accessible
      const testUrl = getConfig('LOUVORES_MANIFEST_URL');
      const response = await fetch(testUrl, {
        method: 'HEAD',
        cache: 'no-cache'
      });
      
      return response.ok || response.status === 404; // 404 is ok, means route exists
    } catch (error) {
      return false;
    }
  }
}

// Create singleton instance
const r2ManifestProvider = new R2ManifestProvider();

export default r2ManifestProvider;

// Export class for testing
export { R2ManifestProvider };

