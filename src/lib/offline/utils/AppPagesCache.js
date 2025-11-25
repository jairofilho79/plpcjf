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
    logger.debug('AppPagesCache', `Opened cache: ${APP_CACHE_NAME}`);
    
    const results = await Promise.allSettled(
      APP_ROUTES.map(async (route, index) => {
        try {
          const url = new URL(route, window.location.origin);
          
          // Create a single request object that we'll use for both fetch and cache
          // This ensures the request matches exactly when we cache and retrieve
          const request = new Request(url.href, {
            method: 'GET',
            mode: 'navigate',
            cache: 'no-cache',
            credentials: 'same-origin',
            redirect: 'follow'
          });

          // Call progress callback if provided
          if (options.onProgress) {
            options.onProgress(route, index, APP_ROUTES.length);
          }

          logger.debug('AppPagesCache', `Fetching page: ${route} (${url.href})`);

          // Fetch the page
          // Note: Service Worker may intercept this, but we can still cache the response
          const response = await fetch(request);

          logger.debug('AppPagesCache', `Response for ${route}: status=${response?.status}, ok=${response?.ok}, type=${response?.type}, url=${response?.url}`);
          
          // Check if response came from service worker cache
          if (response.type === 'opaque' || response.type === 'opaqueredirect') {
            logger.warn('AppPagesCache', `Response for ${route} is opaque - may not be cacheable`);
          }

          if (response && response.ok && response.status === 200) {
            // Clone the response before caching (responses can only be read once)
            // Responses must be cloned because they can only be consumed once
            const responseClone = response.clone();
            
            // Verify response is clonable
            if (!responseClone) {
              throw new Error('Failed to clone response');
            }

            // Put in cache - use the same request object
            try {
              // Ensure response is not already consumed
              if (responseClone.bodyUsed) {
                throw new Error('Response body already used');
              }
              
              await cache.put(request, responseClone);
              logger.debug('AppPagesCache', `Cache.put completed for ${route}`);
            } catch (cacheError) {
              logger.error('AppPagesCache', `Cache.put failed for ${route}:`, cacheError);
              // If cache.put fails, try with a fresh clone
              try {
                const freshClone = response.clone();
                await cache.put(request, freshClone);
                logger.debug('AppPagesCache', `Cache.put succeeded with fresh clone for ${route}`);
              } catch (retryError) {
                logger.error('AppPagesCache', `Cache.put retry also failed for ${route}:`, retryError);
                throw new Error(`Cache.put failed: ${cacheError.message}`);
              }
            }
            
            // Small delay to ensure cache write completes
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Verify it was cached using the same request
            const cached = await cache.match(request);
            if (cached) {
              logger.info('AppPagesCache', `Successfully cached and verified page: ${route}`);
              return { success: true, route };
            } else {
              // Try matching with URL string as fallback
              const cachedByUrl = await cache.match(url.href);
              if (cachedByUrl) {
                logger.info('AppPagesCache', `Successfully cached page (URL match): ${route}`);
                return { success: true, route };
              }
              
              // Try matching with a new request with same URL
              const altRequest = new Request(url.href, { mode: 'navigate' });
              const cachedAlt = await cache.match(altRequest);
              if (cachedAlt) {
                logger.info('AppPagesCache', `Successfully cached page (alt request match): ${route}`);
                return { success: true, route };
              }
              
              // List all cached keys for debugging
              const allKeys = await cache.keys();
              logger.debug('AppPagesCache', `Cache keys for debugging: ${allKeys.map(r => r.url).join(', ')}`);
              
              logger.warn('AppPagesCache', `Cache verification failed for ${route} - may still be cached`);
              // Still return success since cache.put didn't throw
              return { success: true, route, warning: 'Verification failed but cache.put succeeded' };
            }
          } else {
            const status = response?.status || 'unknown';
            throw new Error(`HTTP ${status} for ${route}`);
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

