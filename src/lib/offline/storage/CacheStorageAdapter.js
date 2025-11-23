/**
 * Cache Storage Adapter
 * Implementation of CacheRepository using Cache Storage API
 */

import { CacheRepository } from './CacheRepository.js';
import { getConfig } from '../core/OfflineConfig.js';
import offlineEvents, { EVENTS } from '../core/OfflineEvents.js';
import { createLogger } from '../utils/OfflineLogger.js';
import { browser } from '$app/environment';

const logger = createLogger('CacheStorageAdapter');

/**
 * Cache Storage Adapter
 * Implements CacheRepository using browser Cache Storage API
 */
export class CacheStorageAdapter extends CacheRepository {
  /**
   * @param {string} [cacheName] - Cache name (defaults to config)
   */
  constructor(cacheName = null) {
    super();
    this.cacheName = cacheName || getConfig('DEFAULT_PDF_CACHE_FALLBACK');
    this._cachePromise = null;
    
    // Cache de variações testadas para otimizar performance
    // Estrutura: Map<normalizedPath, {found: boolean, url: string, timestamp: number}>
    this._variationCache = new Map();
    this._variationCacheTTL = 5 * 60 * 1000; // 5 minutos
    this._missCache = new Set(); // Cache de "misses" para evitar tentativas repetidas
    this._missCacheTTL = 1 * 60 * 1000; // 1 minuto
  }
  
  /**
   * Clear variation cache (called when cache is updated)
   * @private
   */
  _clearVariationCache() {
    this._variationCache.clear();
    this._missCache.clear();
  }
  
  /**
   * Clean expired entries from variation cache
   * @private
   */
  _cleanExpiredCache() {
    const now = Date.now();
    
    // Clean variation cache
    for (const [key, value] of this._variationCache.entries()) {
      if (now - value.timestamp > this._variationCacheTTL) {
        this._variationCache.delete(key);
      }
    }
    
    // Miss cache is cleared entirely on TTL (simpler)
    // It will be repopulated as needed
  }

  /**
   * Open PDF cache with fallback
   * @returns {Promise<Cache>} Cache instance
   * @private
   */
  async _openCache() {
    if (!browser || typeof caches === 'undefined') {
      throw new Error('Cache Storage API not available');
    }

    // Return cached promise if available
    if (this._cachePromise) {
      return this._cachePromise;
    }

    // Create promise for cache
    this._cachePromise = (async () => {
      try {
        // Try to open with configured cache name
        const cache = await caches.open(this.cacheName);
        logger.debug('CacheStorageAdapter', `Opened cache: ${this.cacheName}`);
        return cache;
      } catch (error) {
        logger.warn('CacheStorageAdapter', `Failed to open cache ${this.cacheName}, trying fallback`, error);
        
        // Try fallback cache names
        const fallbackNames = getConfig('ALLOWED_CACHE_NAMES') || [];
        for (const fallbackName of fallbackNames) {
          if (fallbackName !== this.cacheName) {
            try {
              const cache = await caches.open(fallbackName);
              logger.info('CacheStorageAdapter', `Using fallback cache: ${fallbackName}`);
              this.cacheName = fallbackName; // Update cache name
              return cache;
            } catch (fallbackError) {
              logger.debug('CacheStorageAdapter', `Fallback cache ${fallbackName} also failed`);
            }
          }
        }
        
        throw new Error(`Failed to open any cache. Tried: ${this.cacheName} and fallbacks`);
      }
    })();

    return this._cachePromise;
  }

  /**
   * Get PDF from cache with optimized two-stage verification
   * @param {string} pdfPath - PDF path (will be normalized)
   * @returns {Promise<Response|null>} PDF Response or null if not found
   */
  async getPdf(pdfPath) {
    if (!browser) {
      return null;
    }

    try {
      const normalizedPath = this._normalizePath(pdfPath);
      if (!normalizedPath) {
        return null;
      }

      // Clean expired cache entries periodically
      this._cleanExpiredCache();

      // Check variation cache first (fast path)
      const cached = this._variationCache.get(normalizedPath);
      if (cached && (Date.now() - cached.timestamp) < this._variationCacheTTL) {
        if (cached.found) {
          // We know this path exists, try to get it
          try {
            const cache = await this._openCache();
            const request = new Request(cached.url);
            const response = await cache.match(request);
            if (response) {
              logger.debug('CacheStorageAdapter', `PDF found via variation cache: ${normalizedPath}`);
              return response;
            }
          } catch (e) {
            // Cache entry may be stale, continue to full verification
            this._variationCache.delete(normalizedPath);
          }
        } else {
          // We know this path doesn't exist (cached miss)
          logger.debug('CacheStorageAdapter', `PDF not found (cached miss): ${normalizedPath}`);
          return null;
        }
      }

      // Check miss cache (avoid repeated failed attempts)
      if (this._missCache.has(normalizedPath)) {
        logger.debug('CacheStorageAdapter', `PDF in miss cache, skipping: ${normalizedPath}`);
        return null;
      }

      const cache = await this._openCache();
      
      // STAGE 1 (Fast): Try most common variations (3 attempts)
      const stage1Variations = [
        normalizedPath,
        normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`,
        new URL(normalizedPath, window.location.origin).toString()
      ];

      for (const url of stage1Variations) {
        try {
          const request = new Request(url);
          const response = await cache.match(request);
          if (response) {
            // Cache successful result
            this._variationCache.set(normalizedPath, {
              found: true,
              url: url,
              timestamp: Date.now()
            });
            logger.debug('CacheStorageAdapter', `PDF found in cache (stage 1): ${normalizedPath}`);
            return response;
          }
        } catch (e) {
          // Continue to next variation
        }
      }

      // STAGE 2 (Slow): Try additional variations only if stage 1 failed
      // These are less common but may be needed for edge cases
      const stage2Variations = [
        // Try with different encodings
        encodeURI(normalizedPath),
        decodeURIComponent(normalizedPath),
        // Try filename-only matching as last resort (less reliable)
        normalizedPath.split('/').pop()
      ].filter(Boolean);

      for (const url of stage2Variations) {
        try {
          const request = new Request(url);
          const response = await cache.match(request);
          if (response) {
            // Cache successful result
            this._variationCache.set(normalizedPath, {
              found: true,
              url: url,
              timestamp: Date.now()
            });
            logger.debug('CacheStorageAdapter', `PDF found in cache (stage 2): ${normalizedPath}`);
            return response;
          }
        } catch (e) {
          // Continue to next variation
        }
      }

      // Not found - cache the miss to avoid repeated attempts
      this._missCache.add(normalizedPath);
      this._variationCache.set(normalizedPath, {
        found: false,
        url: null,
        timestamp: Date.now()
      });
      
      // Clear miss cache after TTL
      setTimeout(() => {
        this._missCache.delete(normalizedPath);
      }, this._missCacheTTL);

      logger.debug('CacheStorageAdapter', `PDF not found in cache: ${normalizedPath}`);
      return null;
    } catch (error) {
      logger.error('CacheStorageAdapter', `Error getting PDF: ${pdfPath}`, error);
      return null;
    }
  }

  /**
   * Store PDF in cache
   * @param {string} pdfPath - PDF path (will be normalized)
   * @param {Blob|Response} pdfData - PDF data to store
   * @returns {Promise<void>}
   */
  async putPdf(pdfPath, pdfData) {
    if (!browser) {
      throw new Error('Cache Storage API not available');
    }

    try {
      const normalizedPath = this._normalizePath(pdfPath);
      if (!normalizedPath) {
        throw new Error('Invalid PDF path');
      }

      const cache = await this._openCache();
      const response = this._toResponse(pdfData);
      
      // Create request URL
      const requestUrl = new URL(normalizedPath, window.location.origin).toString();
      const request = new Request(requestUrl);

      await cache.put(request, response);
      
      logger.info('CacheStorageAdapter', `PDF stored in cache: ${normalizedPath}`);
      
      // Invalidate variation cache for this path (new PDF may match)
      this._variationCache.delete(normalizedPath);
      this._missCache.delete(normalizedPath);
      
      // Cache the successful storage for future lookups
      this._variationCache.set(normalizedPath, {
        found: true,
        url: requestUrl,
        timestamp: Date.now()
      });
      
      // Emit event
      offlineEvents.emit(EVENTS.PDF_DOWNLOADED, {
        path: normalizedPath,
        originalPath: pdfPath
      });
      
      offlineEvents.emit(EVENTS.CACHE_UPDATED, {
        type: 'pdf-added',
        path: normalizedPath
      });
    } catch (error) {
      logger.error('CacheStorageAdapter', `Error storing PDF: ${pdfPath}`, error);
      throw error;
    }
  }

  /**
   * Check if PDF exists in cache
   * @param {string} pdfPath - PDF path (will be normalized)
   * @returns {Promise<boolean>} True if PDF exists in cache
   */
  async hasPdf(pdfPath) {
    if (!browser) {
      return false;
    }

    const response = await this.getPdf(pdfPath);
    return response !== null;
  }

  /**
   * Delete PDF from cache
   * @param {string} pdfPath - PDF path (will be normalized)
   * @returns {Promise<boolean>} True if PDF was deleted
   */
  async deletePdf(pdfPath) {
    if (!browser) {
      return false;
    }

    try {
      const normalizedPath = this._normalizePath(pdfPath);
      if (!normalizedPath) {
        return false;
      }

      const cache = await this._openCache();
      
      // Try multiple URL variations
      const urlVariations = [
        normalizedPath,
        normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`,
        new URL(normalizedPath, window.location.origin).toString()
      ];

      let deleted = false;
      for (const url of urlVariations) {
        try {
          const request = new Request(url);
          const result = await cache.delete(request);
          if (result) {
            deleted = true;
          }
        } catch (e) {
          // Continue to next variation
        }
      }

      if (deleted) {
        logger.info('CacheStorageAdapter', `PDF deleted from cache: ${normalizedPath}`);
        
        // Emit event
        offlineEvents.emit(EVENTS.PDF_DELETED, {
          path: normalizedPath,
          originalPath: pdfPath
        });
        
        offlineEvents.emit(EVENTS.CACHE_UPDATED, {
          type: 'pdf-deleted',
          path: normalizedPath
        });
      }

      return deleted;
    } catch (error) {
      logger.error('CacheStorageAdapter', `Error deleting PDF: ${pdfPath}`, error);
      return false;
    }
  }

  /**
   * List all PDFs in cache
   * @returns {Promise<string[]>} Array of normalized PDF paths
   */
  async listPdfs() {
    if (!browser) {
      return [];
    }

    try {
      const cache = await this._openCache();
      const keys = await cache.keys();
      
      const pdfPaths = [];
      for (const request of keys) {
        try {
          const url = new URL(request.url);
          const path = url.pathname;
          
          // Normalize the path
          const normalized = this._normalizePath(path);
          if (normalized) {
            pdfPaths.push(normalized);
          }
        } catch (e) {
          logger.debug('CacheStorageAdapter', `Error processing cache key: ${request.url}`, e);
        }
      }

      // Remove duplicates
      const uniquePaths = [...new Set(pdfPaths)];
      logger.debug('CacheStorageAdapter', `Listed ${uniquePaths.length} PDFs from cache`);
      
      return uniquePaths;
    } catch (error) {
      logger.error('CacheStorageAdapter', 'Error listing PDFs', error);
      return [];
    }
  }

  /**
   * List PDFs by category
   * @param {string} category - Category name
   * @returns {Promise<string[]>} Array of normalized PDF paths in category
   */
  async listPdfsByCategory(category) {
    if (!category) {
      return [];
    }

    const allPdfs = await this.listPdfs();
    
    // Filter PDFs that match category pattern
    // Category is typically in path like: assets/CategoryName/filename.pdf
    const categoryLower = category.toLowerCase();
    return allPdfs.filter(path => {
      const pathLower = path.toLowerCase();
      return pathLower.includes(categoryLower);
    });
  }

  /**
   * Clear all cache
   * @returns {Promise<void>}
   */
  async clear() {
    if (!browser) {
      return;
    }

    try {
      const cache = await this._openCache();
      await cache.delete(this.cacheName);
      
      // Reset cache promise to force reopen
      this._cachePromise = null;
      
      // Clear variation cache
      this._clearVariationCache();
      
      logger.info('CacheStorageAdapter', `Cache cleared: ${this.cacheName}`);
      
      // Emit event
      offlineEvents.emit(EVENTS.CACHE_CLEARED, {
        cacheName: this.cacheName
      });
    } catch (error) {
      logger.error('CacheStorageAdapter', 'Error clearing cache', error);
      throw error;
    }
  }

  /**
   * Sync cache (no-op for Cache Storage, but required by interface)
   * @returns {Promise<void>}
   */
  async sync() {
    // Cache Storage doesn't need explicit sync
    // But we can emit an event to notify listeners
    offlineEvents.emit(EVENTS.CACHE_SYNCED, {
      cacheName: this.cacheName,
      timestamp: Date.now()
    });
  }
}

// Create default instance
const cacheStorageAdapter = new CacheStorageAdapter();

export default cacheStorageAdapter;

