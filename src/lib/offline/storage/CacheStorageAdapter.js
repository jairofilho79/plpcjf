/**
 * Cache Storage Adapter
 * Implementation of CacheRepository using Cache Storage API
 */

import { CacheRepository } from './CacheRepository.js';
import { getConfig } from '../core/OfflineConfig.js';
import offlineEvents, { EVENTS } from '../core/OfflineEvents.js';
import { createLogger } from '../utils/OfflineLogger.js';
import { browser } from '$app/environment';
import PdfPathManager, { registrarAcertoPdf } from '../utils/PdfPathManager.js';
import { decodeUrlUtf8 } from '$lib/utils/urlEncoding.js';

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
    
    // Batch mode control
    this._inBatchMode = false;
  }
  
  /**
   * Start batch mode - disables events during batch operations
   */
  startBatchMode() {
    this._inBatchMode = true;
    logger.debug('CacheStorageAdapter', 'Batch mode started');
  }
  
  /**
   * End batch mode - re-enables events
   */
  endBatchMode() {
    this._inBatchMode = false;
    logger.debug('CacheStorageAdapter', 'Batch mode ended');
  }
  
  /**
   * Check if currently in batch mode
   * @returns {boolean} True if in batch mode
   */
  isInBatchMode() {
    return this._inBatchMode;
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
   * Tries original path first (as encoded in base64), then normalized path for compatibility
   * @param {string} pdfPath - PDF path
   * @returns {Promise<Response|null>} PDF Response or null if not found
   */
  async getPdf(pdfPath) {
    if (!browser) {
      return null;
    }

    try {
      // Normalize path using PdfPathManager (preserves case and accents)
      const normalizedPath = PdfPathManager.normalizeForStorage(pdfPath);
      if (!normalizedPath) {
        return null;
      }

      // Clean expired cache entries periodically
      this._cleanExpiredCache();

      // Check variation cache first (fast path) - use normalized path as key
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
              // Achado 1 da revisão: este atalho não é `direto` nem `variacao` — é
              // uma consulta anterior reaproveitada sem repetir a busca.
              registrarAcertoPdf('reaproveitado', cached.url);
              return response;
            }
          } catch (e) {
            // Cache entry may be stale, continue to full verification
            this._variationCache.delete(normalizedPath);
          }
        } else {
          // We know this path doesn't exist (cached miss)
          logger.debug('CacheStorageAdapter', `PDF not found (cached miss): ${normalizedPath}`);
          // Extensão além do Achado 1: também é um `miss`, só que memoizado —
          // sem contá-lo aqui o total de categorias não bateria com o total
          // de chamadas a getPdf().
          registrarAcertoPdf('miss', normalizedPath);
          return null;
        }
      }

      // Check miss cache (avoid repeated failed attempts)
      if (this._missCache.has(normalizedPath)) {
        logger.debug('CacheStorageAdapter', `PDF in miss cache, skipping: ${normalizedPath}`);
        registrarAcertoPdf('miss', normalizedPath);
        return null;
      }

      const cache = await this._openCache();
      
      // Use PdfPathManager to generate search variations
      const searchVariations = PdfPathManager.createSearchVariations(pdfPath, window.location.origin);

      for (const url of searchVariations) {
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
            logger.debug('CacheStorageAdapter', `PDF found in cache: ${normalizedPath}`);
            registrarAcertoPdf(url === searchVariations[0] ? 'direto' : 'variacao', url);
            return response;
          }
        } catch (e) {
          // Continue to next variation
        }
      }

      // #22.4: o bloco de fallback saiu. Suas três tentativas eram, medidas
      // sobre os 4629 caminhos reais: a chave canônica de novo (4629/4629
      // idêntica), a mesma chave depois de um encodeURIComponent que
      // `normalizeForStorage` desfaz (4629/4629 idêntica), e o nome do arquivo
      // nu — que `new Request` resolve contra o diretório da página, nunca
      // contra /assets/, e que só poderia acertar outro PDF: 1036 arquivos do
      // acervo se chamam `Cifra I.pdf`.

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
      registrarAcertoPdf('miss', normalizedPath);
      return null;
    } catch (error) {
      logger.error('CacheStorageAdapter', `Error getting PDF: ${pdfPath}`, error);
      return null;
    }
  }

  /**
   * Store PDF in cache (internal method without events)
   * Uses original path (as encoded in base64) to preserve case and accents
   * @param {string} pdfPath - PDF path
   * @param {Blob|Response} pdfData - PDF data to store
   * @param {Object} [options] - Storage options
   * @param {boolean} [options.emitEvents=true] - Whether to emit events
   * @param {boolean} [options.notifyServiceWorker=true] - Whether to notify service worker
   * @returns {Promise<{normalizedPath: string, requestUrl: string}>} Storage result
   * @private
   */
  async _putPdfInternal(pdfPath, pdfData, options = {}) {
    const { emitEvents = true, notifyServiceWorker = true } = options;
    
    if (!browser) {
      throw new Error('Cache Storage API not available');
    }

    // Normalize path using PdfPathManager (preserves case and accents)
    const normalizedPath = PdfPathManager.normalizeForStorage(pdfPath);
    if (!normalizedPath) {
      throw new Error('Invalid PDF path');
    }

    const cache = await this._openCache();
    const response = this._toResponse(pdfData);
    
    // Create request URL using PdfPathManager (preserves encoding)
    const requestUrl = PdfPathManager.createRequestUrl(pdfPath, window.location.origin);
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
    
    // Emit events only if requested
    if (emitEvents) {
      offlineEvents.emit(EVENTS.PDF_DOWNLOADED, {
        path: normalizedPath,
        originalPath: pdfPath
      });
      
      offlineEvents.emit(EVENTS.CACHE_UPDATED, {
        type: 'pdf-added',
        path: normalizedPath
      });
    }
    
    // Notify Service Worker only if requested and not in batch mode
    if (notifyServiceWorker && !this._inBatchMode) {
      if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) {
        try {
          navigator.serviceWorker.controller.postMessage({
            type: 'CACHE_UPDATED',
            data: {
              path: normalizedPath,
              url: requestUrl,
              type: 'pdf-added'
            }
          });
        } catch (swError) {
          logger.debug('CacheStorageAdapter', 'Could not notify Service Worker', swError);
        }
      }
    }
    
    return { normalizedPath, requestUrl };
  }

  /**
   * Store PDF in cache
   * Uses original path (as encoded in base64) to preserve case and accents
   * @param {string} pdfPath - PDF path
   * @param {Blob|Response} pdfData - PDF data to store
   * @param {Object} [options] - Storage options
   * @param {boolean} [options.emitEvents=true] - Whether to emit events
   * @param {boolean} [options.notifyServiceWorker=true] - Whether to notify service worker
   * @param {boolean} [options.batch=false] - Whether this is part of a batch operation
   * @returns {Promise<void>}
   */
  async putPdf(pdfPath, pdfData, options = {}) {
    const { emitEvents = true, notifyServiceWorker = true, batch = false } = options;
    
    try {
      await this._putPdfInternal(pdfPath, pdfData, { 
        emitEvents: batch ? false : emitEvents, 
        notifyServiceWorker: batch ? false : notifyServiceWorker 
      });
    } catch (error) {
      logger.error('CacheStorageAdapter', `Error storing PDF: ${pdfPath}`, error);
      throw error;
    }
  }
  
  /**
   * Store multiple PDFs in cache (batch operation)
   * Optimized for bulk operations - emits events only once at the end
   * @param {Array<{path: string, blob: Blob}>} pdfs - Array of PDFs to store
   * @param {Object} [options] - Batch options
   * @param {boolean} [options.emitEvents=true] - Whether to emit events at the end
   * @param {boolean} [options.notifyServiceWorker=true] - Whether to notify service worker at the end
   * @returns {Promise<number>} Number of PDFs stored successfully
   */
  async putPdfsBatch(pdfs, options = {}) {
    const { emitEvents = true, notifyServiceWorker = true } = options;
    
    if (!browser) {
      throw new Error('Cache Storage API not available');
    }
    
    if (!pdfs || pdfs.length === 0) {
      return 0;
    }
    
    logger.info('CacheStorageAdapter', `Starting batch storage of ${pdfs.length} PDFs`);
    
    let stored = 0;
    const storedPaths = [];
    
    try {
      // Store all PDFs without emitting individual events
      for (const { path, blob } of pdfs) {
        try {
          const result = await this._putPdfInternal(path, blob, { 
            emitEvents: false, 
            notifyServiceWorker: false 
          });
          stored++;
          storedPaths.push(result.normalizedPath);
        } catch (error) {
          logger.error('CacheStorageAdapter', `Error storing PDF in batch: ${path}`, error);
          // Continue with other PDFs
        }
      }
      
      logger.info('CacheStorageAdapter', `Batch storage completed: ${stored}/${pdfs.length} PDFs stored`);
      
      // Emit events once at the end if requested
      if (emitEvents && stored > 0) {
        offlineEvents.emit(EVENTS.CACHE_UPDATED, {
          type: 'batch-pdfs-added',
          batch: true,
          count: stored,
          paths: storedPaths
        });
      }
      
      // Notify Service Worker once at the end if requested
      if (notifyServiceWorker && stored > 0 && !this._inBatchMode) {
        if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) {
          try {
            navigator.serviceWorker.controller.postMessage({
              type: 'CACHE_UPDATED',
              data: {
                type: 'batch-added',
                count: stored,
                source: 'batch'
              }
            });
          } catch (swError) {
            logger.debug('CacheStorageAdapter', 'Could not notify Service Worker', swError);
          }
        }
      }
      
      return stored;
    } catch (error) {
      logger.error('CacheStorageAdapter', 'Error during batch storage', error);
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
      // Normalize path using PdfPathManager
      const normalizedPath = PdfPathManager.normalizeForStorage(pdfPath);
      if (!normalizedPath) {
        return false;
      }

      const cache = await this._openCache();
      
      // Use PdfPathManager to generate search variations for deletion
      const urlVariations = PdfPathManager.createSearchVariations(pdfPath, window.location.origin);

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
        
        // Invalidate variation cache
        this._variationCache.delete(normalizedPath);
        this._missCache.delete(normalizedPath);
        
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
          const urlObj = new URL(request.url);
          // Decode pathname with UTF-8 to get original path
          const path = decodeUrlUtf8(urlObj.pathname);
          
          // Use PdfPathManager to normalize path (preserves case and accents)
          const normalized = PdfPathManager.normalizeForStorage(path);
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
   * Sync cache and verify consistency with Service Worker
   * @returns {Promise<void>}
   */
  async sync() {
    // Verify cache consistency between CacheStorageAdapter and Service Worker
    try {
      await this._verifyCacheConsistency();
    } catch (error) {
      logger.warn('CacheStorageAdapter', 'Cache consistency check failed (non-critical)', error);
    }
    
    // Emit event to notify listeners
    offlineEvents.emit(EVENTS.CACHE_SYNCED, {
      cacheName: this.cacheName,
      timestamp: Date.now()
    });
  }

  /**
   * Verify cache consistency between CacheStorageAdapter and Service Worker
   * @returns {Promise<void>}
   * @private
   */
  async _verifyCacheConsistency() {
    if (!browser || typeof caches === 'undefined') {
      return;
    }

    try {
      const cache = await this._openCache();
      const keys = await cache.keys();
      
      // Count PDFs in cache
      const pdfCount = keys.filter(req => {
        try {
          const urlObj = new URL(req.url);
          return urlObj.pathname.endsWith('.pdf') && 
                 !urlObj.pathname.includes('/_app/') &&
                 !urlObj.pathname.includes('/node_modules/');
        } catch {
          return false;
        }
      }).length;
      
      logger.debug('CacheStorageAdapter', `Cache consistency check: ${pdfCount} PDFs in cache`);
      
      // Notify Service Worker to verify its cache matches
      if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) {
        try {
          navigator.serviceWorker.controller.postMessage({
            type: 'VERIFY_CACHE_CONSISTENCY',
            data: {
              expectedCount: pdfCount,
              cacheName: this.cacheName
            }
          });
        } catch (swError) {
          logger.debug('CacheStorageAdapter', 'Could not request Service Worker cache verification', swError);
        }
      }
    } catch (error) {
      logger.warn('CacheStorageAdapter', 'Error verifying cache consistency', error);
    }
  }
}

// Create default instance
const cacheStorageAdapter = new CacheStorageAdapter();

export default cacheStorageAdapter;

