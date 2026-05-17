/**
 * Download Manager
 * Orchestrates downloads of categories and individual PDFs using new architecture
 */

import packageDownloader from './PackageDownloader.js';
import DownloadProgressTracker from './DownloadProgress.js';
import DownloadQueue from './DownloadQueue.js';
import cacheStorageAdapter from '../storage/CacheStorageAdapter.js';
import manifestRepository from '../manifest/ManifestRepository.js';
import { findRequiredPackages } from '$lib/utils/pdfValidation.js';
import { atobUTF8, getPdfRelPath } from '$lib/utils/pathUtils.js';
import PdfPathManager from '../utils/PdfPathManager.js';
import offlineInventoryRepository from '../storage/OfflineInventoryRepository.js';
import { louvores } from '$lib/stores/louvores.js';
import { get } from 'svelte/store';
import offlineEvents, { EVENTS } from '../core/OfflineEvents.js';
import { createLogger } from '../utils/OfflineLogger.js';
import { browser } from '$app/environment';
import { notifyCacheUpdate, updateCacheVersion } from '$lib/utils/cacheSync.js';
import { invalidateCategory, invalidateCategories } from '$lib/utils/statsCache.js';
import statsCalculator from '../stats/StatsCalculator.js';
import cacheSync from '../storage/CacheSync.js';
import {
  getCurrentStatsRevision,
  writeDownloadJobSnapshot
} from '../core/OfflineRevision.js';
import {
  checkStorageCapacity,
  createQuotaExceededError,
  isQuotaExceededError,
  requestPersistentStorage
} from '../core/OfflineStorageErrors.js';
import { getConfig } from '../core/OfflineConfig.js';
import { computePackageProgressPercentage } from './DownloadProgressMath.js';

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
    this.currentJobId = null;
    this.currentJobCategories = [];
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
    this.currentJobCategories = [...categories];
    this.currentJobId = `offline-job-${Date.now()}`;
    this._updateJobSnapshot({
      jobId: this.currentJobId,
      status: 'running',
      categories: this.currentJobCategories,
      completed: 0,
      failed: 0,
      total: 0,
      phase: 'downloading',
      progress: 0,
      error: null,
      targetStatsRevision: getCurrentStatsRevision()
    });

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
        error: null,
        errorCode: null,
        downloadPhase: 'downloading', // FASE 6: Reset phase to downloading
        phaseProgress: 0 // FASE 6: Reset phase progress
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

      // Identify missing PDFs using IndexedDB as the canonical source of truth.
      // This avoids the false-positive risk of querying the Cache API.
      const persistedSet = await offlineInventoryRepository.getPersistedLookupSet();
      const missingPdfs = offlineInventoryRepository.computeMissingPdfs(filteredLouvores, persistedSet);

      logger.info('DownloadManager', `Found ${missingPdfs.length} missing PDFs out of ${filteredLouvores.length} total (IDB-based)`);

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
      await this._runStoragePreflight(requiredParts);

      // Group parts by category
      const partsByCategory = {};
      for (const part of requiredParts) {
        if (!partsByCategory[part.category]) {
          partsByCategory[part.category] = [];
        }
        partsByCategory[part.category].push(part);
      }

      // Build a path→metadata map so each stored PDF gets pdfId/category in IDB.
      /** @type {Map<string, {pdfId: string, category: string}>} */
      const pdfMetadataMap = new Map();
      for (const louvor of filteredLouvores) {
        if (!louvor.pdfId) continue;
        const relPath = getPdfRelPath(louvor);
        if (!relPath) continue;
        const normalized = PdfPathManager.normalizeForStorage(relPath);
        if (normalized) {
          const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
          const meta = { pdfId: louvor.pdfId, category: louvor.categoria };
          pdfMetadataMap.set(withSlash, meta);
          pdfMetadataMap.set(normalized, meta);
        }
      }

      // Get PDF URLs for validation
      const pdfUrls = filteredLouvores
        .map(louvor => this._getPdfUrl(louvor))
        .filter(url => url !== null);

      // Update total in offline state
      this._updateOfflineState({
        total: pdfUrls.length
      });
      this._updateJobSnapshot({
        total: pdfUrls.length
      });

      // Download packages with progress callback that updates offline state
      const result = await this._downloadPackages(
        Object.keys(partsByCategory),
        pdfUrls,
        partsByCategory,
        pdfMetadataMap,
        (progress) => {
          // Call user's progress callback if provided
          if (options.onProgress) {
            options.onProgress(progress);
          }
          
          // Update offline store state for UI with phase information
          const stateUpdate = {
            progress: progress.percentage || 0,
            completed: progress.completed || 0,
            failed: progress.failed || 0
          };
          
          // FASE 2: Include phase information if available
          if (progress.downloadPhase) {
            stateUpdate.downloadPhase = progress.downloadPhase;
          }
          if (progress.phaseProgress !== undefined) {
            stateUpdate.phaseProgress = progress.phaseProgress;
          }
          if (progress.currentPackage !== undefined) {
            stateUpdate.currentPackage = progress.currentPackage;
          }
          if (progress.totalPackages !== undefined) {
            stateUpdate.totalPackages = progress.totalPackages;
          }
          
          this._updateOfflineState(stateUpdate);
        },
        filteredLouvores
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
        failed: result.failed,
        stillMissing: result.stillMissing || 0
      });
      this._updateJobSnapshot({
        status: 'completed',
        phase: 'complete',
        progress: finalProgress,
        completed: result.completed,
        failed: result.failed,
        total: pdfUrls.length,
        error: null
      });

      return {
        success: (result.failed === 0) && ((result.stillMissing || 0) === 0),
        completed: result.completed,
        failed: result.failed,
        stillMissing: result.stillMissing || 0,
        total: pdfUrls.length,
        categories
      };
    } catch (error) {
      logger.error('DownloadManager', 'Error downloading categories', error);
      const isCancelled = error.message === 'DOWNLOAD_CANCELLED';
      const quotaError = isQuotaExceededError(error) || error?.errorCode === 'QUOTA_EXCEEDED';
      const errorCode = quotaError ? 'QUOTA_EXCEEDED' : null;
      const message = isCancelled
        ? 'Download cancelado pelo usuário.'
        : (quotaError
          ? 'Sem espaço suficiente no navegador para concluir o download offline. Libere espaço e tente novamente.'
          : error.message || 'Erro ao baixar pacotes ZIP.');
      
      // Update state with error
      this._updateOfflineState({
        downloading: false,
        error: message,
        errorCode
      });

      this._updateJobSnapshot({
        status: isCancelled ? 'cancelled' : 'failed',
        phase: 'complete',
        error: message
      });
      
      if (isCancelled) {
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
      this.currentJobId = null;
      this.currentJobCategories = [];
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
   * @param {Map<string, {pdfId: string, category: string}>} pdfMetadataMap
   * @param {Function} [onProgress] - Progress callback
   * @returns {Promise<{completed: number, failed: number}>} Download result
   * @private
   */
  async _downloadPackages(categories, pdfUrls, partsByCategory, pdfMetadataMap, onProgress = null, filteredLouvores = null) {
    // Initialize progress
    this.progress = new DownloadProgressTracker(pdfUrls.length);
    this.progress.start();

    const totalPdfs = pdfUrls.length;
    const batchStartedAt = Date.now();
    let completed = 0;
    let failed = 0;
    let lastReportedPercentage = 0;

    // Build packagesInfo array to track each package's information
    const packagesInfo = [];
    for (const category of categories) {
      const parts = partsByCategory[category] || [];
      for (const part of parts) {
        packagesInfo.push({
          category,
          part,
          estimatedPdfCount: 0, // Will be updated after extraction
          completedPdfs: 0
        });
      }
    }

    const totalPackages = packagesInfo.length;
    logger.debug('DownloadManager', `Prepared ${totalPackages} packages for download`);

    // Start batch mode to avoid individual events during storage
    cacheStorageAdapter.startBatchMode();
    
    // FASE 6: Reset phase fields at start of batch operation
    if (onProgress) {
      onProgress({
        ...this.progress.getProgress(),
        downloadPhase: 'downloading',
        phaseProgress: 0,
        currentPackage: 0,
        totalPackages: totalPackages
      });
    }

    try {
      // Process each package using indexed loop to track package info
      for (let packageIndex = 0; packageIndex < packagesInfo.length; packageIndex++) {
        if (this.abortController?.aborted) {
          throw new Error('DOWNLOAD_CANCELLED');
        }

        const packageInfo = packagesInfo[packageIndex];
        const { category, part } = packageInfo;
        const packageStartedAt = Date.now();

        logger.debug('DownloadManager', `Downloading package ${packageIndex + 1}/${totalPackages} for category: ${category}`);
        console.log('[DownloadManager] Downloading package:', {
          packageIndex: packageIndex + 1,
          totalPackages,
          category,
          partUrl: part.url,
          partFilename: part.filename,
          urlToUse: part.url || part.filename
        });

        try {
          // Strict per-package flow:
          // download -> extract -> store -> release memory before next package.
          const result = await packageDownloader.downloadExtractStorePackage(
            part.url || part.filename,
            pdfUrls,
            {
              abortSignal: this.abortController?.signal,
              batch: true,
              pdfMetadataMap,
              contentLength: part.size || 0,
              onProgress: (progressData) => {
                const phase = progressData.phase || 'downloading';

                // Map download phase to UI phase names
                const downloadPhase =
                  phase === 'extracting' ? 'extracting' :
                  phase === 'storing'   ? 'storing' :
                  phase === 'complete'  ? 'storing' :
                  'downloading';

                const globalPercentage = computePackageProgressPercentage({
                  packagesInfo,
                  packageIndex,
                  phase,
                  phasePercentage: progressData.percentage || 0,
                  lastPercentage: lastReportedPercentage
                });
                lastReportedPercentage = globalPercentage;

                const pdfsInPreviousPackages = packagesInfo
                  .slice(0, packageIndex)
                  .reduce((sum, pkg) => sum + (pkg.completedPdfs || 0), 0);
                const globalCompleted = pdfsInPreviousPackages +
                  (phase === 'storing' ? (progressData.completed || 0) : 0);

                if (onProgress) {
                  onProgress({
                    completed: globalCompleted,
                    total: totalPdfs,
                    percentage: globalPercentage,
                    failed,
                    downloadPhase,
                    phaseProgress: globalPercentage,
                    currentPackage: packageIndex + 1,
                    totalPackages
                  });
                }
                this._updateJobSnapshot({
                  status: 'running',
                  phase: downloadPhase,
                  progress: globalPercentage,
                  completed: globalCompleted,
                  failed,
                  total: totalPdfs
                });
              }
            }
          );
          const stored = result.stored;
          
          // Update package info with actual completed count
          packageInfo.completedPdfs = stored;
          packageInfo.estimatedPdfCount = result.extracted;
          completed += stored;
          // Update progress tracker with correct total (not increment, to avoid double counting)
          // Calculate total completed: sum of all previous packages + current package
          const totalCompletedPdfs = packagesInfo
          .slice(0, packageIndex + 1)
          .reduce((sum, pkg) => sum + (pkg.completedPdfs || 0), 0);

          // Update progress tracker - use update() instead of incrementCompleted() to set correct value
          // This avoids double counting since storage callbacks no longer update this.progress.completed
          // For bytesDownloaded, we increment since it wasn't being updated in storage callbacks
          this.progress.update({
          completed: totalCompletedPdfs,
          bytesDownloaded: this.progress.bytesDownloaded + result.bytesDownloaded
          });

          // Always update progress after package completes, even if callback didn't fire.
          // Keep these values outside `if (onProgress)` because snapshot update also uses them.
          const pdfsInPreviousPackages = packagesInfo
            .slice(0, packageIndex)
            .reduce((sum, pkg) => sum + (pkg.completedPdfs || 0), 0);
          const finalGlobalCompleted = pdfsInPreviousPackages + stored;
          const finalGlobalPercentage = computePackageProgressPercentage({
            packagesInfo,
            packageIndex,
            phase: 'complete',
            phasePercentage: 100,
            lastPercentage: lastReportedPercentage
          });
          lastReportedPercentage = finalGlobalPercentage;

          if (onProgress) {
            onProgress({
              completed: finalGlobalCompleted,
              total: totalPdfs,
              percentage: finalGlobalPercentage,
              failed: failed,
              downloadPhase: 'storing', // After package completes, we're in storing phase
              phaseProgress: finalGlobalPercentage,
              currentPackage: packageIndex + 1,
              totalPackages: totalPackages
            });
          }
          this._updateJobSnapshot({
            status: 'running',
            phase: 'storing',
            progress: finalGlobalPercentage,
            completed: finalGlobalCompleted,
            failed,
            total: totalPdfs
          });

          logger.debug('DownloadManager', `Stored ${stored} PDFs from package ${packageIndex + 1}/${totalPackages}: ${part.filename}`);
          logger.debug(
            'DownloadManager',
            `Package processed ${part.filename}`,
            {
              category,
              packageIndex: packageIndex + 1,
              totalPackages,
              stored,
              extracted: result.extracted
            },
            {
              durationMs: Date.now() - packageStartedAt
            }
          );
          
          // Clean up package ZIP from cache after extraction
          // Packages are temporary and should not remain in cache storage
          try {
            const packageUrl = part.url || part.filename;
            const fullPackageUrl = packageUrl.startsWith('/') 
              ? packageUrl 
              : `${packageDownloader.basePath}/${packageUrl}`;
            
            // Remove from APP_CACHE (plpc-v4-app) where Service Worker might have cached it
            if (
              typeof caches !== 'undefined' &&
              getConfig('OFFLINE_READTHROUGH_CACHE_FALLBACK_ENABLED') !== false
            ) {
              const cache = await caches.open('plpc-v4-app');
              const packageRequest = new Request(fullPackageUrl);
              const deleted = await cache.delete(packageRequest);
              if (deleted) {
                logger.debug('DownloadManager', `Removed package ZIP from cache: ${part.filename}`);
              }
            }
          } catch (error) {
            // Non-critical error - package might not be in cache or cache API might not be available
            logger.debug('DownloadManager', `Could not remove package ZIP from cache (non-critical): ${part.filename}`, error);
          }

          // Yield before moving to next package to avoid long main-thread pressure.
          await new Promise(resolve => setTimeout(resolve, 0));
        } catch (error) {
          if (error.message === 'DOWNLOAD_CANCELLED') {
            throw error;
          }
          if (isQuotaExceededError(error) || error?.errorCode === 'QUOTA_EXCEEDED') {
            throw createQuotaExceededError({ causeMessage: error?.message });
          }

          logger.error('DownloadManager', `Error downloading package ${packageIndex + 1}/${totalPackages}: ${part.filename}`, error);
          failed++;
          this.progress.incrementFailed();
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

      // Sync cache after download (batch mode prevents intermediate syncs)
      await cacheSync.sync();

      // Post-download verification: check whether any expected PDFs are still missing.
      // This catches silent failures (stored=0, network issues, path mismatches, etc.)
      let stillMissing = 0;
      try {
        const persistedSet = await offlineInventoryRepository.getPersistedLookupSet();
        const missingAfter = offlineInventoryRepository.computeMissingPdfs(
          filteredLouvores ?? [],
          persistedSet
        );
        stillMissing = missingAfter.length;
        if (stillMissing > 0) {
          logger.warn('DownloadManager',
            `Post-download: ${stillMissing} PDFs still missing after downloading ${totalPackages} packages`);
          failed = Math.max(failed, stillMissing);
        }
      } catch (verifyError) {
        logger.warn('DownloadManager', 'Post-download verification failed (non-critical)', verifyError);
      }

      // Mark download as complete and update final progress
      if (onProgress) {
        onProgress({
          completed,
          total: totalPdfs,
          percentage: 100,
          failed,
          downloadPhase: 'complete',
          phaseProgress: 100,
          currentPackage: totalPackages,
          totalPackages
        });
      }
      this._updateJobSnapshot({
        status: 'running',
        phase: 'complete',
        progress: 100,
        completed,
        failed,
        total: totalPdfs
      });

      // Emit complete event with categories info and batch flag
      offlineEvents.emit(EVENTS.DOWNLOAD_COMPLETE, {
        completed,
        failed,
        total: pdfUrls.length,
        stillMissing,
        categories: categories || [],
        batch: true
      });

      return { completed, failed, stillMissing };
    } catch (error) {
      if (error.message === 'DOWNLOAD_CANCELLED') {
        offlineEvents.emit(EVENTS.DOWNLOAD_ERROR, { error: 'Download cancelled' });
      } else {
        offlineEvents.emit(EVENTS.DOWNLOAD_ERROR, {
          error: error.message,
          errorCode: (isQuotaExceededError(error) || error?.errorCode === 'QUOTA_EXCEEDED') ? 'QUOTA_EXCEEDED' : undefined
        });
      }
      throw error;
    } finally {
      logger.info(
        'DownloadManager',
        'Batch download pipeline finished',
        {
          categoriesCount: categories?.length || 0,
          totalPdfs,
          completed,
          failed
        },
        {
          durationMs: Date.now() - batchStartedAt
        }
      );
      // Always end batch mode, even if there was an error
      cacheStorageAdapter.endBatchMode();
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
   * @param {Array<{size?: number}>} requiredParts
   * @returns {Promise<void>}
   * @private
   */
  async _runStoragePreflight(requiredParts) {
    const estimatedBytes = requiredParts.reduce((sum, part) => sum + Number(part?.size || 0), 0);
    if (estimatedBytes <= 0) return;

    // Try to persist storage before estimating quota. This is best-effort.
    await requestPersistentStorage();

    const result = await checkStorageCapacity(estimatedBytes);
    if (result.supported && !result.ok) {
      logger.warn('DownloadManager', 'Storage preflight blocked download', {
        neededBytes: result.neededBytes,
        usageBytes: result.usageBytes,
        quotaBytes: result.quotaBytes
      });
      throw createQuotaExceededError({
        neededBytes: result.neededBytes,
        usageBytes: result.usageBytes,
        quotaBytes: result.quotaBytes
      });
    }
  }

  /**
   * Persist minimal job snapshot for recovery and UX continuity.
   * @param {Object} updates
   * @private
   */
  _updateJobSnapshot(updates) {
    try {
      const snapshot = {
        jobId: this.currentJobId || updates.jobId || `offline-job-${Date.now()}`,
        status: updates.status || 'running',
        categories: updates.categories || this.currentJobCategories || [],
        phase: updates.phase || 'downloading',
        error: updates.error ?? null,
        targetStatsRevision: updates.targetStatsRevision || getCurrentStatsRevision()
      };

      if ('completed' in updates) snapshot.completed = updates.completed ?? 0;
      if ('failed' in updates) snapshot.failed = updates.failed ?? 0;
      if ('total' in updates) snapshot.total = updates.total ?? 0;
      if ('progress' in updates) snapshot.progress = updates.progress ?? 0;

      writeDownloadJobSnapshot(snapshot);
    } catch (error) {
      logger.warn('DownloadManager', 'Could not persist download job snapshot', error);
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
