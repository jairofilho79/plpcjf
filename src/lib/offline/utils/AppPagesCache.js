/**
 * App Pages Cache Utility
 * Handles caching of all application pages for offline access
 */

import { createLogger } from './OfflineLogger.js';
import { browser } from '$app/environment';

const logger = createLogger('AppPagesCache');

// Cache name must match the one used in service worker
// From sw.js: const APP_CACHE = `${CACHE_VERSION}-app`;
// CACHE_VERSION = 'plpc-v3-dev'
const APP_CACHE_NAME = 'plpc-v3-dev-app';

// All application routes that should be cached
const APP_ROUTES = [
  '/',
  '/biblioteca',
  '/leitor',
  '/listas',
  '/offline',
  '/sobre'
];

/**
 * Cache all application pages
 * @param {Object} [options] - Options
 * @param {Function} [options.onProgress] - Progress callback (route, index, total)
 * @returns {Promise<{success: number, failed: number, total: number, errors: string[]}>}
 */
export async function cacheAppPages(options = {}) {
  if (!browser) {
    logger.warn('Not in browser environment, skipping page caching');
    return {
      success: 0,
      failed: 0,
      total: APP_ROUTES.length,
      errors: ['Not in browser environment']
    };
  }

  if (typeof caches === 'undefined') {
    logger.warn('Cache API not available, skipping page caching');
    return {
      success: 0,
      failed: 0,
      total: APP_ROUTES.length,
      errors: ['Cache API not available']
    };
  }

  logger.info('AppPagesCache', `Starting to cache ${APP_ROUTES.length} application pages`);

  try {
    const cache = await caches.open(APP_CACHE_NAME);
    const results = await Promise.allSettled(
      APP_ROUTES.map(async (route, index) => {
        try {
          const url = new URL(route, window.location.origin);
          const request = new Request(url, {
            mode: 'navigate',
            cache: 'no-cache'
          });

          // Call progress callback if provided
          if (options.onProgress) {
            options.onProgress(route, index, APP_ROUTES.length);
          }

          // Fetch the page
          const response = await fetch(request);

          if (response && response.status === 200) {
            // Clone the response before caching (responses can only be read once)
            const responseClone = response.clone();
            await cache.put(request, responseClone);
            logger.debug('AppPagesCache', `Cached page: ${route}`);
            return { success: true, route };
          } else {
            throw new Error(`HTTP ${response.status} for ${route}`);
          }
        } catch (error) {
          logger.warn('AppPagesCache', `Failed to cache page ${route}:`, error);
          return { success: false, route, error: error.message };
        }
      })
    );

    // Count successes and failures
    let success = 0;
    let failed = 0;
    const errors = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (result.value.success) {
          success++;
        } else {
          failed++;
          errors.push(`${result.value.route}: ${result.value.error || 'Unknown error'}`);
        }
      } else {
        failed++;
        errors.push(`${APP_ROUTES[index]}: ${result.reason?.message || 'Unknown error'}`);
      }
    });

    logger.info('AppPagesCache', `Page caching complete: ${success} successful, ${failed} failed`);

    return {
      success,
      failed,
      total: APP_ROUTES.length,
      errors
    };
  } catch (error) {
    logger.error('AppPagesCache', 'Error caching application pages:', error);
    return {
      success: 0,
      failed: APP_ROUTES.length,
      total: APP_ROUTES.length,
      errors: [error.message || 'Unknown error']
    };
  }
}

/**
 * Check if a specific route is cached
 * @param {string} route - Route to check
 * @returns {Promise<boolean>} True if route is cached
 */
export async function isRouteCached(route) {
  if (!browser || typeof caches === 'undefined') {
    return false;
  }

  try {
    const cache = await caches.open(APP_CACHE_NAME);
    const url = new URL(route, window.location.origin);
    const request = new Request(url, { mode: 'navigate' });
    const cached = await cache.match(request);
    return !!cached;
  } catch (error) {
    logger.warn('AppPagesCache', `Error checking if route is cached: ${route}`, error);
    return false;
  }
}

/**
 * Get list of cached routes
 * @returns {Promise<string[]>} Array of cached route paths
 */
export async function getCachedRoutes() {
  if (!browser || typeof caches === 'undefined') {
    return [];
  }

  try {
    const cache = await caches.open(APP_CACHE_NAME);
    const requests = await cache.keys();
    const origin = window.location.origin;
    const cachedRoutes = [];
    
    // Check each route to see if it's cached
    for (const route of APP_ROUTES) {
      try {
        const url = new URL(route, origin);
        const request = new Request(url, { mode: 'navigate' });
        const cached = await cache.match(request);
        if (cached) {
          cachedRoutes.push(route);
        }
      } catch (error) {
        logger.debug('AppPagesCache', `Error checking route ${route}:`, error);
      }
    }
    
    return cachedRoutes;
  } catch (error) {
    logger.warn('AppPagesCache', 'Error getting cached routes:', error);
    return [];
  }
}

export default {
  cacheAppPages,
  isRouteCached,
  getCachedRoutes
};

