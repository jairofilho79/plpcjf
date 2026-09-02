/**
 * Offline Manager
 * Facade that orchestrates all offline functionality
 * FASE 5: Unified interface for all offline operations
 */

import downloadManager from '../download/DownloadManager.js';
import statsCalculator from '../stats/StatsCalculator.js';
import cacheStorageAdapter from '../storage/CacheStorageAdapter.js';
import manifestRepository from '../manifest/ManifestRepository.js';
import compositeValidator from '../validation/CompositeValidator.js';
import offlineEvents, { EVENTS } from './OfflineEvents.js';
import cacheSync from '../storage/CacheSync.js';
import cacheMigration from '../storage/CacheMigration.js';
import { createLogger } from '../utils/OfflineLogger.js';
import { browser } from '$app/environment';
import { louvores } from '$lib/stores/louvores.js';
import { get } from 'svelte/store';
import { cacheAppPages } from '../utils/AppPagesCache.js';
import offlineBundleImporter from '../import/OfflineBundleImporter.js';
import PdfPathManager from '../utils/PdfPathManager.js';
import { migrarChavesPdfParaNfc, NFC_MIGRATION_FLAG } from '../storage/pdfCacheNfcMigration.js';
import { getConfig } from './OfflineConfig.js';

const logger = createLogger('OfflineManager');

/**
 * @typedef {Object} DownloadResult
 * @property {boolean} success - Whether download succeeded
 * @property {number} completed - Number of PDFs downloaded
 * @property {number} failed - Number of failed downloads
 * @property {number} total - Total PDFs to download
 * @property {string[]} [errors] - Error messages
 * @property {string[]} [categories] - Categories downloaded
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} available - Whether PDF is available
 * @property {'cache' | 'index' | 'network' | 'unknown'} source - Source of validation
 * @property {string} normalizedPath - Normalized PDF path
 * @property {boolean} needsDownload - Whether PDF needs to be downloaded
 * @property {string} [error] - Error message if validation failed
 * @property {string} [url] - Full URL for the PDF
 */

/**
 * @typedef {Object} CategoryStats
 * @property {number} total - Total number of PDFs in category
 * @property {number} available - Number of PDFs available in cache
 * @property {number} missing - Number of PDFs missing from cache
 * @property {number} percentage - Percentage of PDFs available (0-100)
 */

/**
 * @typedef {Object} CategoryValidationResult
 * @property {boolean} isComplete - Whether all PDFs in category are available
 * @property {number} total - Total PDFs in category
 * @property {number} available - Available PDFs
 * @property {number} missing - Missing PDFs
 * @property {string[]} missingPdfs - List of missing PDF paths
 */

/**
 * Offline Manager
 * Facade that provides unified interface for all offline operations
 */
class OfflineManager {
  constructor() {
    this.initialized = false;
    this.initializationPromise = null;
    this._nfcMigrationPromise = null;
  }

  /**
   * Migração de chaves de PDF em cache para a forma Unicode NFC (#22.2).
   *
   * Extraída de `initialize()` de propósito: precisa rodar em toda visita à
   * aplicação — inclusive em `/leitor`, que nunca chama `initialize()` — e
   * não pode depender do resto do bootstrap (migração V1/V2, `cacheSync`),
   * que é mais caro e desnecessário para este passo. Sem rede, no máximo
   * oito reescritas por aparelho, e sai numa leitura de `localStorage`
   * depois da primeira execução sem erros — idempotente e barata o
   * bastante para chamar sem gate de categoria selecionada.
   *
   * `initialize()` também chama este método (não duplica a lógica), então
   * quem já depende de `ensureInitialized()` continua coberto.
   *
   * @returns {Promise<void>}
   */
  async ensureNfcMigration() {
    if (!browser) return;

    if (this._nfcMigrationPromise) {
      return this._nfcMigrationPromise;
    }

    this._nfcMigrationPromise = (async () => {
      try {
        if (localStorage.getItem(NFC_MIGRATION_FLAG) === 'true') {
          return;
        }
        const cachePdfs = await caches.open(getConfig('PDF_CACHE_NAME') || 'plpc-pdfs');
        const r = await migrarChavesPdfParaNfc(cachePdfs, (url) => {
          const u = new URL(url);
          return PdfPathManager.createRequestUrl(decodeURIComponent(u.pathname), u.origin);
        });
        logger.info(
          `Migração NFC: ${r.migradas} migradas, ${r.mantidas} mantidas, ${r.preservadas} preservadas, ${r.erros} erros`
        );
        if (r.preservadas > 0) {
          // A guarda da Fase 6 recusou apagar: a chave nova mudava mais do que
          // a forma Unicode. As duas ficaram, e nenhum PDF se perdeu — mas é
          // sinal de caminho com `%` aninhado no acervo, que merece olhada.
          logger.warn(`Migração NFC preservou ${r.preservadas} chave(s) que não eram só NFC`);
        }
        if (r.erros === 0) localStorage.setItem(NFC_MIGRATION_FLAG, 'true');
      } catch (error) {
        logger.warn('Migração NFC falhou (não crítico)', error);
      } finally {
        this._nfcMigrationPromise = null;
      }
    })();

    return this._nfcMigrationPromise;
  }

  /**
   * Initialize offline manager
   * Performs one-time setup tasks like cache migration
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      try {
        logger.info('Initializing...');

        if (!browser) {
          logger.warn('Not in browser environment, skipping initialization');
          this.initialized = true;
          return;
        }

        // Run cache migration V1 if needed
        try {
          await cacheMigration.migrate();
        } catch (error) {
          logger.warn('Cache migration V1 failed (non-critical)', error);
        }

        // #22.5 / D-12: a segunda migração de cache foi aposentada. Ela
        // reescrevia entradas do cache por heurística de string
        // (`includes('cifra') && includes('nivel')`) e apagava a antiga. Com a
        // chave unificada não há o que migrar, e a migração NFC de #22.2, logo
        // abaixo, cobre o único caso real de chave divergente.

        // #22.2/correção: migração NFC extraída para `ensureNfcMigration()` —
        // ver o método acima. Chamada aqui também para cobrir quem depende
        // só de `ensureInitialized()`.
        await this.ensureNfcMigration();

        // Sync cache on initialization
        try {
          await cacheSync.sync();
        } catch (error) {
          logger.warn('Initial cache sync failed (non-critical)', error);
        }

        this.initialized = true;
        logger.info('Initialization complete');
      } catch (error) {
        logger.error('Initialization failed', error);
        throw error;
      } finally {
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  /**
   * Download categories
   * @param {string[]} categories - Categories to download
   * @param {Object} [options] - Download options
   * @param {Function} [options.onProgress] - Progress callback
   * @param {Array<Object>} [options.louvoresData] - Louvores data (if not provided, will be fetched)
   * @returns {Promise<DownloadResult>} Download result
   */
  async downloadCategories(categories, options = {}) {
    await this.ensureInitialized();

    if (!categories || categories.length === 0) {
      return {
        success: true,
        completed: 0,
        failed: 0,
        total: 0,
        categories: []
      };
    }

    logger.info(`Downloading ${categories.length} categories`);

    // Cache all application pages before starting PDF download
    // This ensures all routes are available offline
    // Run in background - don't block download if it fails
    cacheAppPages({
      /**
       * @param {string} route
       * @param {number} index
       * @param {number} total
       */
      onProgress: (route, index, total) => {
        logger.debug(`Caching page ${index + 1}/${total}: ${route}`);
      }
    }).then(result => {
      if (result.success > 0) {
        logger.info(`Cached ${result.success} application pages for offline access`);
      }
      if (result.failed > 0) {
        logger.warn(`Failed to cache ${result.failed} application pages:`, result.errors);
      }
    }).catch(error => {
      // Non-blocking error - log but don't fail the download
      logger.warn('Error caching application pages (non-blocking):', error);
    });

    try {
      const result = await downloadManager.downloadCategories(categories, options);
      return result;
    } catch (error) {
      logger.error('Error downloading categories', error);
      throw error;
    }
  }

  /**
   * Download missing PDFs
   * @param {string[]} pdfPaths - PDF paths to download
   * @param {Object} [options] - Download options
   * @param {Function} [options.onProgress] - Progress callback
   * @param {Array<Object>} [options.louvoresData] - Louvores data (if not provided, will be fetched)
   * @returns {Promise<DownloadResult>} Download result
   */
  async downloadMissingPdfs(pdfPaths, options = {}) {
    await this.ensureInitialized();

    if (!pdfPaths || pdfPaths.length === 0) {
      return {
        success: true,
        completed: 0,
        failed: 0,
        total: 0
      };
    }

    logger.info(`Downloading ${pdfPaths.length} PDFs`);

    try {
      // Note: DownloadManager.downloadPdfs() is not yet fully implemented
      // For now, we'll need to use the existing approach or implement it
      const result = await downloadManager.downloadPdfs(pdfPaths, options.onProgress);
      return result;
    } catch (error) {
      // If individual PDF download is not implemented, fall back to category-based download
      // (cast, não narrowing: preserva o comportamento atual de lançar se
      // `error` não tiver `.message`, igual ao acesso direto de antes)
      if (/** @type {any} */ (error).message.includes('not yet implemented')) {
        logger.warn('Individual PDF download not implemented, using category-based approach');
        
        // Extract categories from PDF paths
        const louvoresData = options.louvoresData || get(louvores);
        const categories = new Set();
        
        const { atobUTF8 } = await import('$lib/utils/pathUtils.js');
        
        for (const pdfPath of pdfPaths) {
          const louvor = louvoresData.find(l => {
            if (!l.pdfId) return false;
            try {
              // CRÍTICO: Usar atobUTF8 (UTF-8), NÃO atob() (latin-1)
              const decoded = atobUTF8(l.pdfId);
              return decoded.includes(pdfPath) || pdfPath.includes(decoded);
            } catch {
              return false;
            }
          });
          
          if (louvor) {
            categories.add(louvor.categoria);
          }
        }
        
        if (categories.size > 0) {
          return await this.downloadCategories(Array.from(categories), options);
        }
      }
      
      logger.error('Error downloading PDFs', error);
      throw error;
    }
  }

  /**
   * Cancel current download
   * @returns {Promise<void>}
   */
  async cancelDownload() {
    logger.info('Cancelling download/import');
    offlineBundleImporter.cancel();
    await downloadManager.cancel();
  }

  /**
   * Import offline zip-mãe (manifests + parts) without network.
   * @param {File|Blob} file
   * @param {object} [options]
   * @param {(p: { phase: string, completed: number, total: number, percentage: number, detail?: string }) => void} [options.onProgress]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<{ success: boolean, pdfsStored: number, categories: string[], cancelled?: boolean, error?: string }>}
   */
  async importOfflineBundle(file, options = {}) {
    await this.ensureInitialized();
    logger.info('Starting offline bundle import');

    cacheAppPages().catch((error) => {
      logger.warn('cacheAppPages during import (non-blocking)', error);
    });

    const result = await offlineBundleImporter.importFromFile(file, options);

    if (result.success) {
      try {
        offlineEvents.emit(EVENTS.CACHE_UPDATED, { type: 'bundle-import', pdfsStored: result.pdfsStored });
      } catch {
        // ignore
      }
    }

    return result;
  }

  /**
   * @returns {boolean}
   */
  isImportingBundle() {
    return offlineBundleImporter.isImporting();
  }

  /**
   * Validate PDF availability
   * @param {string} pdfPath - PDF path to validate
   * @param {Object} [options] - Validation options
   * @param {boolean} [options.useIndex] - Whether to use index (default: true)
   * @param {boolean} [options.checkNetwork] - Whether to check network (default: true if online)
   * @param {string} [options.pdfId] - PDF ID for index lookup
   * @returns {Promise<ValidationResult>} Validation result
   */
  async validatePdfAvailability(pdfPath, options = {}) {
    await this.ensureInitialized();

    if (!pdfPath) {
      return {
        available: false,
        source: 'unknown',
        normalizedPath: '',
        needsDownload: false,
        error: 'Invalid PDF path'
      };
    }

    logger.debug(`Validating PDF: ${pdfPath}`);

    try {
      const result = await compositeValidator.validate(pdfPath, options);
      return result;
    } catch (error) {
      logger.error('Error validating PDF', error);
      return {
        available: false,
        source: 'unknown',
        normalizedPath: pdfPath,
        needsDownload: navigator.onLine,
        error: /** @type {any} */ (error).message
      };
    }
  }

  /**
   * Validate category completeness
   * @param {string} category - Category name
   * @param {Object} [options] - Validation options
   * @param {Array<Object>} [options.louvoresData] - Louvores data
   * @returns {Promise<CategoryValidationResult>} Validation result
   */
  async validateCategory(category, options = {}) {
    await this.ensureInitialized();

    if (!category) {
      return {
        isComplete: false,
        total: 0,
        available: 0,
        missing: 0,
        missingPdfs: []
      };
    }

    logger.debug(`Validating category: ${category}`);

    try {
      const stats = await this.getCategoryStats(category, options);
      const louvoresData = options.louvoresData || get(louvores);
      
      // Get missing PDFs
      const categoryLouvores = louvoresData.filter(l => l.categoria === category);
      const missingPdfs = [];
      
      const { atobUTF8 } = await import('$lib/utils/pathUtils.js');
      
      for (const louvor of categoryLouvores) {
        if (!louvor.pdfId) continue;
        
        try {
          // CRÍTICO: Usar atobUTF8 (UTF-8), NÃO atob() (latin-1)
          const pdfPath = atobUTF8(louvor.pdfId);
          const validation = await this.validatePdfAvailability(pdfPath, {
            useIndex: true,
            pdfId: louvor.pdfId
          });
          
          if (!validation.available) {
            missingPdfs.push(pdfPath);
          }
        } catch (error) {
          logger.debug(`Error validating PDF for louvor ${louvor.id}`, error);
        }
      }

      return {
        isComplete: stats.missing === 0,
        total: stats.total,
        available: stats.available,
        missing: stats.missing,
        missingPdfs
      };
    } catch (error) {
      logger.error('Error validating category', error);
      throw error;
    }
  }

  /**
   * Get category statistics
   * @param {string} category - Category name
   * @param {Object} [options] - Stats options
   * @param {boolean} [options.useCache] - Use cached stats (default: true)
   * @param {boolean} [options.forceRecalculate] - Force recalculation (default: false)
   * @param {Array<Object>} [options.louvoresData] - Louvores data
   * @param {Array<Object>} [options.cachedPdfs] - Cached PDFs list
   * @returns {Promise<CategoryStats>} Category statistics
   */
  async getCategoryStats(category, options = {}) {
    await this.ensureInitialized();

    if (!category) {
      return { total: 0, available: 0, missing: 0, percentage: 0 };
    }

    logger.debug(`Getting stats for category: ${category}`);

    try {
      const stats = await statsCalculator.getCategoryStats(category, options);
      return stats;
    } catch (error) {
      logger.error('Error getting category stats', error);
      throw error;
    }
  }

  /**
   * Get all category statistics
   * @param {Object} [options] - Stats options
   * @param {boolean} [options.useCache] - Use cached stats (default: true)
   * @param {Array<Object>} [options.louvoresData] - Louvores data
   * @returns {Promise<Record<string, CategoryStats>>} All category statistics
   */
  async getAllStats(options = {}) {
    await this.ensureInitialized();

    logger.debug('Getting all category stats');

    try {
      const louvoresData = options.louvoresData || get(louvores);
      const categories = new Set(louvoresData.map(l => l.categoria));
      /** @type {Record<string, CategoryStats>} */
      const stats = {};

      // Get stats for each category
      for (const category of categories) {
        try {
          stats[category] = await this.getCategoryStats(category, options);
        } catch (error) {
          logger.warn(`Error getting stats for category ${category}`, error);
          stats[category] = { total: 0, available: 0, missing: 0, percentage: 0 };
        }
      }

      return stats;
    } catch (error) {
      logger.error('Error getting all stats', error);
      throw error;
    }
  }

  /**
   * Clear all cache
   * @returns {Promise<void>}
   */
  async clearCache() {
    await this.ensureInitialized();

    logger.info('Clearing cache');

    try {
      await cacheStorageAdapter.clear();
      
      // Invalidate stats cache
      statsCalculator.invalidateAll();
      
      // Emit event
      offlineEvents.emit(EVENTS.CACHE_CLEARED, {
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error('Error clearing cache', error);
      throw error;
    }
  }

  /**
   * Synchronize cache
   * @param {Object} [options] - Sync options
   * @param {boolean} [options.force] - Force sync even if recently synced
   * @returns {Promise<void>}
   */
  async syncCache(options = {}) {
    await this.ensureInitialized();

    logger.debug('Syncing cache');

    try {
      await cacheSync.sync(options);
    } catch (error) {
      logger.error('Error syncing cache', error);
      throw error;
    }
  }

  /**
   * List all cached PDFs
   * @returns {Promise<string[]>} Array of normalized PDF paths
   */
  async listCachedPdfs() {
    await this.ensureInitialized();

    logger.debug('Listing cached PDFs');

    try {
      const pdfs = await cacheStorageAdapter.listPdfs();
      return pdfs;
    } catch (error) {
      logger.error('Error listing cached PDFs', error);
      throw error;
    }
  }

  /**
   * Get louvores manifest
   * @param {boolean} [useCache=true] - Use cache if available
   * @returns {Promise<Array<Object>>} Louvores manifest array
   */
  async getLouvoresManifest(useCache = true) {
    await this.ensureInitialized();

    logger.debug('Getting louvores manifest');

    try {
      const manifest = await manifestRepository.getLouvoresManifest(useCache);
      return manifest;
    } catch (error) {
      logger.error('Error getting louvores manifest', error);
      throw error;
    }
  }

  /**
   * Get offline manifest
   * @param {boolean} [useCache=true] - Use cache if available
   * @returns {Promise<Object>} Offline manifest object
   */
  async getOfflineManifest(useCache = true) {
    await this.ensureInitialized();

    logger.debug('Getting offline manifest');

    try {
      const manifest = await manifestRepository.getOfflineManifest(useCache);
      return manifest;
    } catch (error) {
      logger.error('Error getting offline manifest', error);
      throw error;
    }
  }

  /**
   * Validate manifests integrity
   * @returns {Promise<Object>} Validation result
   */
  async validateManifests() {
    await this.ensureInitialized();

    logger.debug('Validating manifests');

    try {
      const louvoresManifest = await this.getLouvoresManifest();
      /** @type {{ packages?: Record<string, unknown> } | null} */
      const offlineManifest = await this.getOfflineManifest();

      // Basic validation
      /** @type {{ valid: boolean, errors: string[], warnings: string[] }} */
      const result = {
        valid: true,
        errors: [],
        warnings: []
      };

      if (!louvoresManifest || !Array.isArray(louvoresManifest)) {
        result.valid = false;
        result.errors.push('Louvores manifest is invalid or missing');
      }

      if (!offlineManifest || !offlineManifest.packages) {
        result.valid = false;
        result.errors.push('Offline manifest is invalid or missing');
      }

      return result;
    } catch (error) {
      logger.error('Error validating manifests', error);
      return {
        valid: false,
        errors: [/** @type {any} */ (error).message],
        warnings: []
      };
    }
  }

  /**
   * Get current download progress
   * @returns {Object|null} Progress object or null if not downloading
   */
  getDownloadProgress() {
    return downloadManager.getProgress();
  }

  /**
   * Check if currently downloading
   * @returns {boolean} True if downloading
   */
  isDownloading() {
    return downloadManager.isDownloadingNow();
  }

  /**
   * Check if initialized
   * @returns {boolean} True if initialized
   */
  isInitialized() {
    return this.initialized;
  }

  /**
   * Ensure manager is initialized
   * @private
   */
  async ensureInitialized() {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

// Create singleton instance
const offlineManager = new OfflineManager();

export default offlineManager;

