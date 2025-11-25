/**
 * Download Manager
 * Orchestrates downloads of categories and individual PDFs using new architecture
 */

import packageDownloader from './PackageDownloader.js';
import DownloadProgressTracker from './DownloadProgress.js';
import DownloadQueue from './DownloadQueue.js';
import cacheStorageAdapter from '../storage/CacheStorageAdapter.js';
import manifestRepository from '../manifest/ManifestRepository.js';
import { findMissingPdfs, findRequiredPackages } from '$lib/utils/pdfValidation.js';
import { atobUTF8 } from '$lib/utils/pathUtils.js';
import { louvores } from '$lib/stores/louvores.js';
import { get } from 'svelte/store';
import offlineEvents, { EVENTS } from '../core/OfflineEvents.js';
import { createLogger } from '../utils/OfflineLogger.js';
import { browser } from '$app/environment';
import { notifyCacheUpdate, updateCacheVersion } from '$lib/utils/cacheSync.js';
import { invalidateCategory, invalidateCategories } from '$lib/utils/statsCache.js';
import statsCalculator from '../stats/StatsCalculator.js';
import cacheSync from '../storage/CacheSync.js';

const logger = createLogger('DownloadManager');

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
 * Download Manager
 * Manages downloads using new architecture modules
 */
export class DownloadManager {
  /**
   * @param {Object} [options] - Manager options
   * @param {number} [options.maxConcurrent=2] - Max concurrent downloads
   */
  constructor(options = {}) {
    this.maxConcurrent = options.maxConcurrent || 2;
    this.queue = new DownloadQueue({ maxConcurrent: this.maxConcurrent });
    this.progress = null;
    this.abortController = null;
    this.isDownloading = false;
  }

  /**
   * Download categories
   * @param {string[]} categories - Categories to download
   * @param {Object} [options] - Download options
   * @param {Array} [options.louvoresData] - Louvores data (if not provided, will be fetched)
   * @param {Function} [options.onProgress] - Progress callback
   * @returns {Promise<DownloadResult>} Download result
   */
  async downloadCategories(categories, options = {}) {
    if (!browser) {
      throw new Error('Download only available in browser');
    }

    if (this.isDownloading) {
      throw new Error('Download already in progress');
    }

    if (!categories || categories.length === 0) {
      return {
        success: true,
        completed: 0,
        failed: 0,
        total: 0,
        categories: []
      };
    }

    this.isDownloading = true;
    this.abortController = new AbortController();

    try {
      logger.info('DownloadManager', `Starting download for ${categories.length} categories`);

      // Emit start event
      offlineEvents.emit(EVENTS.DOWNLOAD_STARTED, { categories });

      // Update offline store state for UI compatibility
      this._updateOfflineState({
        downloading: true,
        progress: 0,
        completed: 0,
        failed: 0,
        total: 0,
        selectedCategories: categories,
        error: null
      });

      // Get louvores data
      const louvoresData = options.louvoresData || get(louvores);
      if (!louvoresData || louvoresData.length === 0) {
        throw new Error('No louvores data available');
      }

      // Expand categories to include variants (e.g., "Cifra" includes "Cifra nível I" and "Cifra nível II")
      const categoryVariantsMap = new Map();
      categories.forEach(cat => {
        const normalized = this._normalizeCategory(cat);
        const variants = this._getCategoryVariants(normalized);
        categoryVariantsMap.set(normalized, variants);
      });
      const allCategoryVariants = Array.from(categoryVariantsMap.values()).flat();

      // Filter louvores by categories (using expanded variants)
      const filteredLouvores = louvoresData.filter(louvor =>
        allCategoryVariants.includes(louvor.categoria)
      );

      if (filteredLouvores.length === 0) {
        return {
          success: true,
          completed: 0,
          failed: 0,
          total: 0,
          categories,
          errors: ['No PDFs found for selected categories']
        };
      }

      // Get cached PDFs (using getCachedPDFsFast for compatibility)
      // Note: We could use cacheStorageAdapter.listPdfs() but getCachedPDFsFast
      // is faster and already used throughout the codebase
      let cachedPdfs = [];
      try {
        const { getCachedPDFsFast } = await import('$lib/utils/swRegistration.js');
        cachedPdfs = await getCachedPDFsFast();
      } catch (error) {
        logger.warn('DownloadManager', 'Could not get cached PDFs, using empty array', error);
        cachedPdfs = [];
      }

      // Identify missing PDFs
      const missingPdfs = findMissingPdfs(filteredLouvores, cachedPdfs);
      
      logger.info('DownloadManager', `Found ${missingPdfs.length} missing PDFs out of ${filteredLouvores.length} total`);

      if (missingPdfs.length === 0) {
        return {
          success: true,
          completed: 0,
          failed: 0,
          total: filteredLouvores.length,
          categories
        };
      }

      // Get offline manifest
      const manifest = await manifestRepository.getOfflineManifest();
      if (!manifest || !manifest.packages) {
        throw new Error('Offline manifest not available');
      }

      // Find required packages
      const requiredParts = findRequiredPackages(missingPdfs, manifest);
      
      if (requiredParts.length === 0) {
        logger.warn('DownloadManager', 'No packages found for missing PDFs, falling back to full category download');
        return await this._downloadFullCategories(categories, filteredLouvores);
      }

      logger.info('DownloadManager', `Identified ${requiredParts.length} package parts needed`);

      // Group parts by category
      const partsByCategory = {};
      for (const part of requiredParts) {
        if (!partsByCategory[part.category]) {
          partsByCategory[part.category] = [];
        }
        partsByCategory[part.category].push(part);
      }

      // Get PDF URLs for validation
      const pdfUrls = filteredLouvores
        .map(louvor => this._getPdfUrl(louvor))
        .filter(url => url !== null);

      // Update total in offline state
      this._updateOfflineState({
        total: pdfUrls.length
      });

      // Download packages with progress callback that updates offline state
      const result = await this._downloadPackages(
        Object.keys(partsByCategory),
        pdfUrls,
        partsByCategory,
        (progress) => {
          // Call user's progress callback if provided
          if (options.onProgress) {
            options.onProgress(progress);
          }
          
          // Update offline store state for UI
          this._updateOfflineState({
            progress: progress.percentage || 0,
            completed: progress.completed || 0,
            failed: progress.failed || 0
          });
        }
      );

      // Sync cache after download
      await this._syncCacheAfterDownload(categories);

      // Update final state
      const finalProgress = pdfUrls.length > 0 
        ? Math.floor((result.completed / pdfUrls.length) * 100) 
        : 100;
      
      this._updateOfflineState({
        downloading: false,
        progress: finalProgress,
        completed: result.completed,
        failed: result.failed
      });

      return {
        success: result.failed === 0,
        completed: result.completed,
        failed: result.failed,
        total: pdfUrls.length,
        categories
      };
    } catch (error) {
      logger.error('DownloadManager', 'Error downloading categories', error);
      
      // Update state with error
      this._updateOfflineState({
        downloading: false,
        error: error.message === 'DOWNLOAD_CANCELLED' 
          ? 'Download cancelado pelo usuário.' 
          : error.message || 'Erro ao baixar pacotes ZIP.'
      });
      
      if (error.message === 'DOWNLOAD_CANCELLED') {
        return {
          success: false,
          completed: this.progress?.completed || 0,
          failed: this.progress?.failed || 0,
          total: this.progress?.total || 0,
          categories,
          errors: ['Download cancelled']
        };
      }

      throw error;
    } finally {
      this.isDownloading = false;
      this.abortController = null;
      this.progress = null;
    }
  }

  /**
   * Download individual PDFs
   * @param {string[]} pdfPaths - PDF paths to download
   * @param {Function} [onProgress] - Progress callback
   * @returns {Promise<DownloadResult>} Download result
   */
  async downloadPdfs(pdfPaths, onProgress = null) {
    if (!browser) {
      throw new Error('Download only available in browser');
    }

    if (this.isDownloading) {
      throw new Error('Download already in progress');
    }

    if (!pdfPaths || pdfPaths.length === 0) {
      return {
        success: true,
        completed: 0,
        failed: 0,
        total: 0
      };
    }

    this.isDownloading = true;
    this.abortController = new AbortController();

    try {
      logger.info('DownloadManager', `Starting download for ${pdfPaths.length} PDFs`);

      offlineEvents.emit(EVENTS.DOWNLOAD_STARTED, { pdfCount: pdfPaths.length });

      // TODO: Implement individual PDF download
      // For now, this would require a different approach (not using packages)
      throw new Error('Individual PDF download not yet implemented');

    } catch (error) {
      logger.error('DownloadManager', 'Error downloading PDFs', error);
      throw error;
    } finally {
      this.isDownloading = false;
      this.abortController = null;
    }
  }

  /**
   * Cancel current download
   */
  async cancel() {
    if (!this.isDownloading) {
      return;
    }

    logger.info('DownloadManager', 'Cancelling download');

    if (this.abortController) {
      this.abortController.abort();
    }

    this.queue.cancel();
    this.isDownloading = false;

    // Update offline state
    this._updateOfflineState({
      downloading: false,
      error: 'Download cancelado pelo usuário.'
    });

    offlineEvents.emit(EVENTS.DOWNLOAD_ERROR, { error: 'Download cancelled' });
  }

  /**
   * Get current progress
   * @returns {DownloadProgress|null} Current progress or null
   */
  getProgress() {
    return this.progress?.getProgress() || null;
  }

  /**
   * Check if downloading
   * @returns {boolean} True if downloading
   */
  isDownloadingNow() {
    return this.isDownloading;
  }

  /**
   * Download packages for categories
   * @param {string[]} categories - Categories to download
   * @param {string[]} pdfUrls - Expected PDF URLs
   * @param {Object} partsByCategory - Parts grouped by category
   * @param {Function} [onProgress] - Progress callback
   * @returns {Promise<{completed: number, failed: number}>} Download result
   * @private
   */
  async _downloadPackages(categories, pdfUrls, partsByCategory, onProgress = null) {
    // Initialize progress
    this.progress = new DownloadProgressTracker(pdfUrls.length);
    this.progress.start();

    let completed = 0;
    let failed = 0;

    try {
      // Process each category
      for (const category of categories) {
        if (this.abortController?.aborted) {
          throw new Error('DOWNLOAD_CANCELLED');
        }

        const parts = partsByCategory[category] || [];
        if (parts.length === 0) {
          continue;
        }

        logger.debug('DownloadManager', `Downloading ${parts.length} parts for category: ${category}`);

        // Download each part
        for (const part of parts) {
          if (this.abortController?.aborted) {
            throw new Error('DOWNLOAD_CANCELLED');
          }

          try {
            // Download and extract package
            const result = await packageDownloader.downloadAndExtract(
              part.url || part.filename,
              pdfUrls,
              this.abortController?.signal
            );

            // Store PDFs in cache
            const stored = await packageDownloader.storePdfsInCache(result.pdfs);
            
            completed += stored;
            this.progress.incrementCompleted(stored, result.bytesDownloaded);

            if (onProgress) {
              onProgress(this.progress.getProgress());
            }

            logger.debug('DownloadManager', `Stored ${stored} PDFs from package: ${part.filename}`);
          } catch (error) {
            if (error.message === 'DOWNLOAD_CANCELLED') {
              throw error;
            }

            logger.error('DownloadManager', `Error downloading package: ${part.filename}`, error);
            failed++;
            this.progress.incrementFailed();
          }
        }
      }

      // FASE 4: Invalidate stats for affected categories before emitting event
      // This ensures stats are invalidated and will be recalculated on next access
      if (categories && categories.length > 0) {
        logger.debug('DownloadManager', `Invalidating stats for ${categories.length} categories`);
        invalidateCategories(categories);
        // Also invalidate via StatsCalculator to clear memory cache
        categories.forEach(category => {
          statsCalculator.invalidateCategory(category);
        });
      }

      // Sync cache after download
      await cacheSync.sync();

      // Emit complete event with categories info
      offlineEvents.emit(EVENTS.DOWNLOAD_COMPLETE, {
        completed,
        failed,
        total: pdfUrls.length,
        categories: categories || []
      });

      return { completed, failed };
    } catch (error) {
      if (error.message === 'DOWNLOAD_CANCELLED') {
        offlineEvents.emit(EVENTS.DOWNLOAD_ERROR, { error: 'Download cancelled' });
      } else {
        offlineEvents.emit(EVENTS.DOWNLOAD_ERROR, { error: error.message });
      }
      throw error;
    }
  }

  /**
   * Download full categories (fallback)
   * @param {string[]} categories - Categories
   * @param {Array} louvores - Louvores data
   * @returns {Promise<DownloadResult>} Download result
   * @private
   */
  async _downloadFullCategories(categories, louvores) {
    // This is a fallback - would need to implement full category download
    // For now, return error
    logger.warn('DownloadManager', 'Full category download fallback not yet implemented');
    return {
      success: false,
      completed: 0,
      failed: 0,
      total: louvores.length,
      categories,
      errors: ['Full category download not yet implemented']
    };
  }

  /**
   * Update offline store state for UI compatibility
   * @param {Object} updates - State updates
   * @private
   */
  _updateOfflineState(updates) {
    try {
      // Use dynamic import but don't await - we want this to be fire-and-forget
      // to avoid blocking the download process
      import('$lib/stores/offline.js').then(({ offline }) => {
        // Update state using the exposed updateState method
        if (offline.updateState) {
          offline.updateState(updates);
        } else {
          logger.warn('DownloadManager', 'Offline store updateState method not available');
        }
      }).catch(error => {
        logger.warn('DownloadManager', 'Could not update offline state', error);
      });
    } catch (error) {
      logger.warn('DownloadManager', 'Could not update offline state', error);
    }
  }

  /**
   * Sync cache after download
   * @param {string[]} categories - Categories that were downloaded
   * @private
   */
  async _syncCacheAfterDownload(categories) {
    try {
      // Sync cache storage
      await cacheStorageAdapter.sync();

      // Update cache version
      await updateCacheVersion();

      // Notify other tabs
      notifyCacheUpdate({
        categories,
        source: 'download'
      });

      // Invalidate stats cache for affected categories
      invalidateCategories(categories);

      // Emit cache synced event
      offlineEvents.emit(EVENTS.CACHE_SYNCED, {
        categories,
        timestamp: Date.now()
      });

      logger.info('DownloadManager', `Cache synced for ${categories.length} categories`);
    } catch (error) {
      logger.error('DownloadManager', 'Error syncing cache', error);
    }
  }


  /**
   * Normalize category name - aggregates subcategories into main category
   * Maps "Cifra nível I" and "Cifra nível II" to "Cifra"
   * @param {string} category - Category name to normalize
   * @returns {string} Normalized category name
   * @private
   */
  _normalizeCategory(category) {
    if (!category) return category;
    if (category === 'Cifra nível I' || category === 'Cifra nível II') {
      return 'Cifra';
    }
    return category;
  }

  /**
   * Get all categories that should be aggregated into a normalized category
   * @param {string} normalizedCategory - Normalized category name
   * @returns {string[]} Array of category names that map to this normalized category
   * @private
   */
  _getCategoryVariants(normalizedCategory) {
    if (normalizedCategory === 'Cifra') {
      return ['Cifra', 'Cifra nível I', 'Cifra nível II'];
    }
    return [normalizedCategory];
  }

  /**
   * Get PDF URL from louvor
   * @param {Object} louvor - Louvor object
   * @returns {string|null} PDF URL or null
   * @private
   */
  _getPdfUrl(louvor) {
    if (!louvor || !louvor.pdfId) {
      return null;
    }

    try {
      // CRÍTICO: Usar atobUTF8 (UTF-8), NÃO atob() (latin-1)
      // pdfId está codificado em base64 UTF-8, não latin-1
      const decoded = atobUTF8(louvor.pdfId);
      // Normalize removing leading slashes
      let path = decoded.replace(/^\/+/, '').trim();
      
      if (!path) {
        return null;
      }
      
      return path.startsWith('/') ? path : `/${path}`;
    } catch {
      return null;
    }
  }
}

// Create default instance
const downloadManager = new DownloadManager();

export default downloadManager;

