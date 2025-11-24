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
    // Use PDF_CACHE_NAME first, fallback to DEFAULT_PDF_CACHE_FALLBACK for backward compatibility
    this.cacheName = cacheName || getConfig('PDF_CACHE_NAME') || getConfig('DEFAULT_PDF_CACHE_FALLBACK') || 'plpc-pdfs';
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
   * Prepare original path (preserves case and accents, only cleans format)
   * This is used to maintain the original URL as encoded in base64
   * @param {string} pdfPath - PDF path
   * @returns {string} Prepared path preserving original encoding
   * @private
   */
  _prepareOriginalPath(pdfPath) {
    if (!pdfPath || typeof pdfPath !== 'string') {
      return '';
    }

    try {
      // Remove protocol and domain if present
      let prepared = pdfPath.replace(/^https?:\/\/[^/]+/, '');
      
      // Remove leading/trailing slashes
      prepared = prepared.replace(/^\/+/, '').replace(/\/+$/, '');
      
      // Decode URI encoding (handle multiple encodings) but preserve case and accents
      try {
        for (let i = 0; i < 3; i++) {
          if (prepared.includes('%')) {
            const decoded = decodeURIComponent(prepared);
            if (decoded !== prepared) {
              prepared = decoded;
            } else {
              break;
            }
          } else {
            break;
          }
        }
      } catch {
        // If decoding fails, continue with original
      }
      
      // Normalize path separators (Windows vs Unix)
      prepared = prepared.replace(/\\/g, '/');
      
      // Ensure starts with 'assets/'
      if (!prepared.toLowerCase().startsWith('assets/')) {
        prepared = `assets/${prepared}`;
      }
      
      // Return without leading slash (consistent format: 'assets/...')
      return prepared.replace(/^\/+/, '');
    } catch {
      // Fallback: simple preparation
      let fallback = pdfPath.replace(/^\/+/, '').replace(/\\/g, '/');
      if (!fallback.toLowerCase().startsWith('assets/')) {
        fallback = `assets/${fallback}`;
      }
      return fallback.replace(/^\/+/, '');
    }
  }

  /**
   * Get PDF from cache with optimized two-stage verification
   * Tries original path first (as encoded in base64), then normalized path for compatibility
   * @param {string} pdfPath - PDF path
   * @returns {Promise<Response|null>} PDF Response or null if not found
   */
  async getPdf(pdfPath) {
    if (!browser) {
      return null;
    }

    try {
      // Prepare original path (preserves case and accents)
      const originalPath = this._prepareOriginalPath(pdfPath);
      if (!originalPath) {
        return null;
      }

      // Clean expired cache entries periodically
      this._cleanExpiredCache();

      // Check variation cache first (fast path) - use original path as key
      const cached = this._variationCache.get(originalPath);
      if (cached && (Date.now() - cached.timestamp) < this._variationCacheTTL) {
        if (cached.found) {
          // We know this path exists, try to get it
          try {
            const cache = await this._openCache();
            const request = new Request(cached.url);
            const response = await cache.match(request);
            if (response) {
              logger.debug('CacheStorageAdapter', `PDF found via variation cache: ${originalPath}`);
              return response;
            }
          } catch (e) {
            // Cache entry may be stale, continue to full verification
            this._variationCache.delete(originalPath);
          }
        } else {
          // We know this path doesn't exist (cached miss)
          logger.debug('CacheStorageAdapter', `PDF not found (cached miss): ${originalPath}`);
          return null;
        }
      }

      // Check miss cache (avoid repeated failed attempts)
      if (this._missCache.has(originalPath)) {
        logger.debug('CacheStorageAdapter', `PDF in miss cache, skipping: ${originalPath}`);
        return null;
      }

      const cache = await this._openCache();
      
      // STAGE 1 (Fast): Try original path with URL encoding FIRST
      // CRITICAL: Cache stores with URL encoding (new URL() does automatic encoding)
      // So we must try with encoding first to match what's actually stored
      const originalVariations = [
        // Try with URL encoding first (as stored in cache by new URL())
        new URL(originalPath, window.location.origin).toString(),
        // Also try with explicit encoding
        new URL(encodeURI(originalPath), window.location.origin).toString(),
        // Try path with leading slash and encoding
        new URL(`/${originalPath}`, window.location.origin).toString(),
        // Fallback: try without encoding (for compatibility)
        originalPath.startsWith('/') ? originalPath : `/${originalPath}`,
        originalPath
      ];

      for (const url of originalVariations) {
        try {
          const request = new Request(url);
          const response = await cache.match(request);
          if (response) {
            // Cache successful result
            this._variationCache.set(originalPath, {
              found: true,
              url: url,
              timestamp: Date.now()
            });
            logger.debug('CacheStorageAdapter', `PDF found in cache (original path): ${originalPath}`);
            return response;
          }
        } catch (e) {
          // Continue to next variation
        }
      }

      // STAGE 2 (Last resort): Try additional variations with different encodings
      // Try with encodeURIComponent (more aggressive encoding)
      const stage3Variations = [
        new URL(encodeURIComponent(originalPath), window.location.origin).toString(),
        // Try decoding and re-encoding (in case of double encoding)
        decodeURIComponent(originalPath),
        // Try filename-only matching as last resort (less reliable)
        originalPath.split('/').pop()
      ].filter(Boolean);

      for (const url of stage3Variations) {
        try {
          const request = new Request(url);
          const response = await cache.match(request);
          if (response) {
            // Cache successful result
            this._variationCache.set(originalPath, {
              found: true,
              url: url,
              timestamp: Date.now()
            });
            logger.debug('CacheStorageAdapter', `PDF found in cache (stage 3): ${originalPath}`);
            return response;
          }
        } catch (e) {
          // Continue to next variation
        }
      }

      // Not found - cache the miss to avoid repeated attempts
      this._missCache.add(originalPath);
      this._variationCache.set(originalPath, {
        found: false,
        url: null,
        timestamp: Date.now()
      });
      
      // Clear miss cache after TTL
      setTimeout(() => {
        this._missCache.delete(originalPath);
      }, this._missCacheTTL);

      logger.debug('CacheStorageAdapter', `PDF not found in cache: ${originalPath}`);
      return null;
    } catch (error) {
      logger.error('CacheStorageAdapter', `Error getting PDF: ${pdfPath}`, error);
      return null;
    }
  }

  /**
   * Store PDF in cache
   * Uses original path (as encoded in base64) to preserve case and accents
   * @param {string} pdfPath - PDF path
   * @param {Blob|Response} pdfData - PDF data to store
   * @returns {Promise<void>}
   */
  async putPdf(pdfPath, pdfData) {
    if (!browser) {
      throw new Error('Cache Storage API not available');
    }

    try {
      // Use original path (preserves case and accents) - this is the correct way
      const originalPath = this._prepareOriginalPath(pdfPath);
      if (!originalPath) {
        throw new Error('Invalid PDF path');
      }

      const cache = await this._openCache();
      const response = this._toResponse(pdfData);
      
      // Create request URL using original path (preserves encoding)
      const requestUrl = new URL(originalPath, window.location.origin).toString();
      const request = new Request(requestUrl);

      await cache.put(request, response);
      
      logger.info('CacheStorageAdapter', `PDF stored in cache: ${originalPath}`);
      
      // Invalidate variation cache for this path (new PDF may match)
      this._variationCache.delete(originalPath);
      this._missCache.delete(originalPath);
      
      // Cache the successful storage for future lookups
      this._variationCache.set(originalPath, {
        found: true,
        url: requestUrl,
        timestamp: Date.now()
      });
      
      // Emit event
      offlineEvents.emit(EVENTS.PDF_DOWNLOADED, {
        path: originalPath,
        originalPath: pdfPath
      });
      
      offlineEvents.emit(EVENTS.CACHE_UPDATED, {
        type: 'pdf-added',
        path: originalPath
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
   * Tries original path first, then normalized path for compatibility
   * @param {string} pdfPath - PDF path
   * @returns {Promise<boolean>} True if PDF was deleted
   */
  async deletePdf(pdfPath) {
    if (!browser) {
      return false;
    }

    try {
      const originalPath = this._prepareOriginalPath(pdfPath);
      if (!originalPath) {
        return false;
      }

      const cache = await this._openCache();
      
      // Try multiple URL variations (with URL encoding first, as stored in cache)
      // CRITICAL: Cache stores with URL encoding (new URL() does automatic encoding)
      const urlVariations = [
        // Try with URL encoding first (as stored in cache by new URL())
        new URL(originalPath, window.location.origin).toString(),
        // Also try with explicit encoding
        new URL(encodeURI(originalPath), window.location.origin).toString(),
        // Try path with leading slash and encoding
        new URL(`/${originalPath}`, window.location.origin).toString(),
        // Fallback: try without encoding (for compatibility)
        originalPath.startsWith('/') ? originalPath : `/${originalPath}`,
        originalPath
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
        logger.info('CacheStorageAdapter', `PDF deleted from cache: ${originalPath}`);
        
        // Invalidate variation cache
        this._variationCache.delete(originalPath);
        this._missCache.delete(originalPath);
        
        // Emit event
        offlineEvents.emit(EVENTS.PDF_DELETED, {
          path: originalPath,
          originalPath: pdfPath
        });
        
        offlineEvents.emit(EVENTS.CACHE_UPDATED, {
          type: 'pdf-deleted',
          path: originalPath
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
   * Returns paths as stored (preserving original encoding)
   * @returns {Promise<string[]>} Array of PDF paths
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
          
          // Use original path preparation (preserves case and accents)
          const prepared = this._prepareOriginalPath(path);
          if (prepared) {
            pdfPaths.push(prepared);
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

