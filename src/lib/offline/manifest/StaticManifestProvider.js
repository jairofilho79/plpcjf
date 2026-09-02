/**
 * Static Manifest Provider
 * Fetches manifests from static files as fallback
 */

import { getConfig } from '../core/OfflineConfig.js';
import { createLogger } from '../utils/OfflineLogger.js';

const logger = createLogger('StaticManifestProvider');

/**
 * Static Manifest Provider
 * Fetches manifests from static files when R2 is not available
 */
class StaticManifestProvider {
  /**
   * Fetch manifest from static files
   * @param {string} type - Manifest type ('louvores' or 'offline')
   * @returns {Promise<Object|null>} Manifest data or null if not found
   */
  async fetchManifest(type) {
    if (!type || (type !== 'louvores' && type !== 'offline')) {
      throw new Error(`Invalid manifest type: ${type}`);
    }

    try {
      const url = type === 'louvores'
        ? getConfig('STATIC_LOUVORES_MANIFEST_URL')
        : getConfig('STATIC_OFFLINE_MANIFEST_URL');

      logger.debug(`Fetching ${type} manifest from static: ${url}`);

      const response = await fetch(url, {
        cache: 'no-cache',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          logger.warn(`${type} manifest not found in static (404)`);
          return null;
        }
        throw new Error(`Failed to fetch ${type} manifest from static: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      logger.info(`Successfully fetched ${type} manifest from static`);
      return data;
    } catch (error) {
      logger.error(`Error fetching ${type} manifest from static`, error);
      
      // Return null instead of throwing to allow graceful degradation
      return null;
    }
  }

  /**
   * Check if provider is available
   * @returns {Promise<boolean>} True if provider is available
   */
  async isAvailable() {
    try {
      // Try to fetch a small resource to check if static files are accessible
      const testUrl = getConfig('STATIC_LOUVORES_MANIFEST_URL');
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
const staticManifestProvider = new StaticManifestProvider();

export default staticManifestProvider;

// Export class for testing
export { StaticManifestProvider };

