/**
 * App Pages Cache Utility
 * Handles caching of all application pages for offline access
 */

import { createLogger } from './OfflineLogger.js';
import { browser } from '$app/environment';
import { getConfig } from '../core/OfflineConfig.js';

const logger = createLogger('AppPagesCache');

// Precisa ser o mesmo nome que o Service Worker usa.
// Fonte única: OfflineConfig.APP_CACHE_NAME, derivado de `appCacheName(version)`
// em src/lib/offline/sw/swCaches.js — o worker deriva do mesmo `version`.
const APP_CACHE_NAME = getConfig('APP_CACHE_NAME');

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
        // Declare url outside try block so it's available in catch
        let url;
        let request;
        
        try {
          url = new URL(route, window.location.origin);
          
          // Create a single request object that we'll use for both fetch and cache
          // Note: Cannot use mode: 'navigate' in manual Request construction
          // Use 'same-origin' instead, which works for same-origin requests
          request = new Request(url.href, {
            method: 'GET',
            mode: 'same-origin',
            cache: 'no-cache',
            credentials: 'same-origin',
            redirect: 'follow'
          });

          // Call progress callback if provided
          if (options.onProgress) {
            options.onProgress(route, index, APP_ROUTES.length);
          }

          logger.debug('AppPagesCache', `Fetching page: ${route} (${url.href})`);
          logger.debug('AppPagesCache', `Request details for ${route}:`, {
            url: url.href,
            method: request.method,
            mode: request.mode,
            credentials: request.credentials,
            cache: request.cache
          });

          // Fetch the page
          // Note: Service Worker may intercept this, but we can still cache the response
          let response;
          try {
            response = await fetch(request);
            logger.debug('AppPagesCache', `Fetch completed for ${route}`);
          } catch (fetchError) {
            // Log fetch error to console for visibility
            console.error(`[AppPagesCache] ❌ Fetch failed for ${route}:`, {
              error: fetchError,
              message: fetchError.message,
              name: fetchError.name,
              stack: fetchError.stack,
              url: url.href
            });
            
            logger.error('AppPagesCache', `Fetch failed for ${route}:`, {
              error: fetchError.message,
              name: fetchError.name,
              stack: fetchError.stack
            });
            throw new Error(`Fetch failed: ${fetchError.message}`);
          }

          logger.debug('AppPagesCache', `Response for ${route}: status=${response?.status}, ok=${response?.ok}, type=${response?.type}, url=${response?.url}`);
          
          // Check if response came from service worker cache
          if (response.type === 'opaque' || response.type === 'opaqueredirect') {
            logger.warn('AppPagesCache', `Response for ${route} is opaque - may not be cacheable`);
          }
          
          // Log response details
          if (!response) {
            throw new Error('Response is null or undefined');
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
              const altRequest = new Request(url.href, { mode: 'same-origin' });
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
            const statusText = response?.statusText || 'unknown';
            logger.error('AppPagesCache', `Invalid response for ${route}:`, {
              status,
              statusText,
              ok: response?.ok,
              type: response?.type,
              url: response?.url
            });
            throw new Error(`HTTP ${status} ${statusText} for ${route}`);
          }
        } catch (error) {
          // Log detailed error information to console for visibility
          console.error(`[AppPagesCache] ❌ Failed to cache page: ${route}`, {
            error: error,
            message: error.message,
            name: error.name,
            stack: error.stack,
            route: route,
            url: url?.href
          });
          
          // Also log via logger
          const errorDetails = {
            message: error.message,
            stack: error.stack,
            name: error.name,
            route: route,
            url: url?.href
          };
          logger.error('AppPagesCache', `Failed to cache page ${route}:`, errorDetails);
          
          return { 
            success: false, 
            route, 
            error: error.message || 'Unknown error', 
            errorDetails: {
              message: error.message,
              name: error.name,
              stack: error.stack?.split('\n').slice(0, 3).join(' | ') // First 3 lines of stack
            }
          };
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
          const errorMsg = `${result.value.route}: ${result.value.error || 'Unknown error'}`;
          errors.push(errorMsg);
          // Log failed route details
          if (result.value.errorDetails) {
            console.error(`[AppPagesCache] ❌ Failed route: ${result.value.route}`, result.value.errorDetails);
          }
        }
      } else {
        failed++;
        const errorMsg = `${APP_ROUTES[index]}: ${result.reason?.message || 'Unknown error'}`;
        errors.push(errorMsg);
        // Log rejected promise details
        console.error(`[AppPagesCache] ❌ Rejected promise for: ${APP_ROUTES[index]}`, {
          reason: result.reason,
          message: result.reason?.message,
          stack: result.reason?.stack
        });
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
    const request = new Request(url.href, { mode: 'same-origin' });
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
        const request = new Request(url.href, { mode: 'same-origin' });
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

