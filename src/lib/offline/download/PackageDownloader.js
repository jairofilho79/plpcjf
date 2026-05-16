/**
 * Package Downloader
 * Handles download and extraction of ZIP packages with normalization
 */

import { unzip } from 'fflate';
import urlNormalizer from '../normalization/UrlNormalizer.js';
import cacheStorageAdapter from '../storage/CacheStorageAdapter.js';
import offlineEvents, { EVENTS } from '../core/OfflineEvents.js';
import { createLogger } from '../utils/OfflineLogger.js';
import PdfPathManager from '../utils/PdfPathManager.js';
import {
  createQuotaExceededError,
  isQuotaExceededError
} from '../core/OfflineStorageErrors.js';
import { getConfig } from '../core/OfflineConfig.js';
import zipWorkerClient from '../workers/ZipWorkerClient.js';

const logger = createLogger('PackageDownloader');

/**
 * @typedef {Object} ExtractedPdf
 * @property {string} normalizedPath - Normalized PDF path
 * @property {string} originalName - Original filename from ZIP
 * @property {Blob} blob - PDF blob data
 */

/**
 * @typedef {Object} PackageDownloadResult
 * @property {ExtractedPdf[]} pdfs - Extracted PDFs
 * @property {number} totalEntries - Total entries in ZIP
 * @property {number} pdfsExtracted - Number of PDFs extracted
 * @property {number} bytesDownloaded - Bytes downloaded
 */

/**
 * Package Downloader
 * Downloads and extracts ZIP packages with automatic normalization
 */
export class PackageDownloader {
  /**
   * @param {Object} [options] - Downloader options
   * @param {string} [options.basePath='/packages'] - Base path for packages
   */
  constructor(options = {}) {
    this.basePath = options.basePath || '/packages';
  }

  /**
   * Download package
   * @param {string} packageUrl - Package URL or filename
   * @param {AbortSignal} [abortSignal] - Abort signal for cancellation
   * @returns {Promise<PackageDownloadResult>} Download result
   */
  async downloadPackage(packageUrl, abortSignal = null) {
    // Normalize URL: if it's an absolute URL (http:// or https://), extract the pathname
    let normalizedUrl = packageUrl;
    if (packageUrl.startsWith('http://') || packageUrl.startsWith('https://')) {
      try {
        const url = new URL(packageUrl);
        normalizedUrl = url.pathname; // Extract only the pathname (e.g., /packages/file.zip)
        logger.debug('PackageDownloader', `Normalized absolute URL: ${packageUrl} -> ${normalizedUrl}`);
      } catch (error) {
        logger.warn('PackageDownloader', `Failed to parse URL: ${packageUrl}, using as-is`, error);
        // If URL parsing fails, try to extract path manually
        const match = packageUrl.match(/https?:\/\/[^\/]+(\/.*)/);
        if (match && match[1]) {
          normalizedUrl = match[1];
        }
      }
    }
    
    const fullUrl = normalizedUrl.startsWith('/') 
      ? normalizedUrl 
      : `${this.basePath}/${normalizedUrl}`;

    logger.info('PackageDownloader', `Downloading package: ${fullUrl} (original: ${packageUrl})`);
    console.log('[PackageDownloader] Starting download:', { packageUrl, fullUrl });

    try {
      // Use absolute URL to ensure proper routing through Service Worker
      // If fullUrl is relative, make it absolute using current origin
      const absoluteUrl = fullUrl.startsWith('http://') || fullUrl.startsWith('https://')
        ? fullUrl
        : typeof window !== 'undefined' && window.location
          ? `${window.location.origin}${fullUrl}`
          : fullUrl;

      logger.debug('PackageDownloader', `Fetching package from: ${absoluteUrl}`);
      console.log('[PackageDownloader] Fetching package from:', absoluteUrl);
      console.log('[PackageDownloader] Window location:', typeof window !== 'undefined' ? window.location.href : 'N/A');
      console.log('[PackageDownloader] Service Worker available:', 'serviceWorker' in navigator);

      // For same-origin requests, don't set mode: 'cors' as it can cause issues
      // The browser will automatically use the correct mode
      const fetchOptions = {
        signal: abortSignal,
        cache: 'no-store'
      };

      console.log('[PackageDownloader] Fetch options:', fetchOptions);
      console.log('[PackageDownloader] About to call fetch...');

      const response = await fetch(absoluteUrl, fetchOptions);

      logger.debug('PackageDownloader', `Package fetch response: ${response.status} ${response.statusText}`);
      console.log('[PackageDownloader] Fetch response:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        url: response.url,
        type: response.type
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        logger.error('PackageDownloader', `Failed to download package: ${response.status} ${response.statusText}. Response: ${errorText.substring(0, 200)}`);
        throw new Error(`Failed to download package: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const bytesDownloaded = arrayBuffer.byteLength;

      logger.debug('PackageDownloader', `Package downloaded: ${bytesDownloaded} bytes`);

      return {
        blob: new Blob([arrayBuffer], { type: 'application/zip' }),
        bytesDownloaded
      };
    } catch (error) {
      if (error.name === 'AbortError' || abortSignal?.aborted) {
        throw new Error('DOWNLOAD_CANCELLED');
      }
      logger.error('PackageDownloader', `Error downloading package: ${fullUrl}`, error);
      throw error;
    }
  }

  /**
   * Extract PDFs from ZIP
   * @param {Blob} zipBlob - ZIP file blob
   * @param {string[]} expectedPdfs - Expected PDF paths (for filtering)
   * @returns {Promise<ExtractedPdf[]>} Extracted PDFs
   */
  async extractPdfsFromZip(zipBlob, expectedPdfs = []) {
    logger.info('PackageDownloader', `Extracting PDFs from ZIP (${zipBlob.size} bytes)`);

    try {
      // Convert blob to Uint8Array
      const arrayBuffer = await zipBlob.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);

      // Unzip
      const entries = await this._unzipEntries(buffer);
      const entryNames = Object.keys(entries);

      logger.debug('PackageDownloader', `ZIP contains ${entryNames.length} entries`);

      // Normalize expected PDFs for comparison
      // Use PdfPathManager to preserve case and accents (consistent with extraction)
      const expectedSet = new Set();
      const expectedSetOriginal = new Set(expectedPdfs);
      
      for (const pdf of expectedPdfs) {
        // Normalize using PdfPathManager (preserves case and accents)
        const normalized = PdfPathManager.normalizeForStorage(pdf);
        if (normalized) {
          expectedSet.add(`/${normalized}`);
          expectedSet.add(normalized);
        }
        // Also add original variations
        expectedSet.add(pdf);
        expectedSet.add(pdf.replace(/^\/+/, ''));
        // Add normalized variations for comparison
        const normalizedForComparison = PdfPathManager.normalizeForStorage(pdf);
        if (normalizedForComparison) {
          expectedSet.add(normalizedForComparison);
        }
      }

      const extractedPdfs = [];

      // Process each entry
      for (const entryName of entryNames) {
        // Normalize entry name
        const normalizedPath = this._normalizeZipEntryName(entryName);

        if (!normalizedPath || !normalizedPath.endsWith('.pdf')) {
          continue;
        }

        // Check if this PDF is expected (if expectedPdfs provided)
        if (expectedPdfs.length > 0) {
          const normalizedForComparison = `/${normalizedPath}`;
          // Also normalize originalName for comparison (preserves case and accents)
          const originalNormalized = PdfPathManager.normalizeForStorage(entryName);
          const isExpected = expectedSet.has(normalizedForComparison) ||
                            expectedSet.has(normalizedPath) ||
                            expectedSet.has(originalNormalized) ||
                            expectedSetOriginal.has(normalizedPath) ||
                            expectedSetOriginal.has(normalizedPath.replace(/^\/+/, '')) ||
                            expectedSetOriginal.has(entryName) ||
                            Array.from(expectedSetOriginal).some(url => {
                              // Use PdfPathManager for consistent normalization
                              const urlNormalized = PdfPathManager.normalizeForStorage(url);
                              return urlNormalized === normalizedPath ||
                                     urlNormalized === originalNormalized ||
                                     urlNormalized.endsWith(normalizedPath) ||
                                     normalizedPath.endsWith(urlNormalized);
                            });

          if (!isExpected) {
            logger.debug('PackageDownloader', `Skipping unexpected PDF: ${normalizedPath} (original: ${entryName})`);
            continue;
          }
        }

        const fileData = entries[entryName];
        if (!fileData) {
          continue;
        }

        const pdfBlob = new Blob([fileData], { type: 'application/pdf' });

        extractedPdfs.push({
          normalizedPath,
          originalName: entryName,
          blob: pdfBlob
        });

        logger.debug('PackageDownloader', `Extracted PDF: ${normalizedPath}`);
      }

      logger.info('PackageDownloader', `Extracted ${extractedPdfs.length} PDFs from ZIP`);

      return extractedPdfs;
    } catch (error) {
      logger.error('PackageDownloader', 'Error extracting PDFs from ZIP', error);
      throw error;
    }
  }

  /**
   * Download and extract package
   * @param {string} packageUrl - Package URL
   * @param {string[]} expectedPdfs - Expected PDF paths
   * @param {AbortSignal} [abortSignal] - Abort signal
   * @returns {Promise<PackageDownloadResult>} Download and extraction result
   */
  async downloadAndExtract(packageUrl, expectedPdfs = [], abortSignal = null) {
    const downloadResult = await this.downloadPackage(packageUrl, abortSignal);
    const extractedPdfs = await this.extractPdfsFromZip(downloadResult.blob, expectedPdfs);

    return {
      pdfs: extractedPdfs,
      totalEntries: 0, // Would need to track this during extraction
      pdfsExtracted: extractedPdfs.length,
      bytesDownloaded: downloadResult.bytesDownloaded
    };
  }

  /**
   * Safe package pipeline:
   * download -> extract -> store -> release temporary memory.
   * Ensures each block is finalized before the next one starts.
   *
   * @param {string} packageUrl
   * @param {string[]} expectedPdfs
   * @param {Object} [options]
   * @param {AbortSignal} [options.abortSignal]
   * @param {Function} [options.onProgress]
   * @param {boolean} [options.batch=true]
   * @param {Map<string, {pdfId?: string, category?: string, manifestRevision?: string}>} [options.pdfMetadataMap]
   *   Map from normalized PDF path → inventory metadata.  Passed to the IDB writer so that
   *   every stored entry carries pdfId and category for deterministic inventory queries.
   * @returns {Promise<{stored: number, extracted: number, bytesDownloaded: number}>}
   */
  async downloadExtractStorePackage(packageUrl, expectedPdfs = [], options = {}) {
    const { abortSignal = null, onProgress = null, batch = true, pdfMetadataMap = null } = options;

    const useZipWorker = getConfig('OFFLINE_IDB_ENABLED') === true &&
      getConfig('OFFLINE_WORKER_ZIP_STREAMING_ENABLED') === true &&
      typeof Worker !== 'undefined';

    if (useZipWorker) {
      logger.info('PackageDownloader', `Using ZIP worker pipeline for ${packageUrl}`);
      const result = await zipWorkerClient.ingestZip({
        packageUrl,
        expectedPdfs,
        abortSignal,
        // Serialize the Map to a plain object for postMessage transfer
        pdfMetadata: pdfMetadataMap ? Object.fromEntries(pdfMetadataMap) : null,
        onProgress: (message) => {
          if (!onProgress) return;
          const completed = Number(message?.completed || 0);
          const total = Number(message?.total || 0);
          const percentage = total > 0 ? Math.floor((completed / total) * 100) : 0;
          onProgress({
            phase: 'storing',
            completed,
            total,
            percentage
          });
        }
      });

      return {
        stored: Number(result?.stored || 0),
        extracted: Number(result?.extracted || 0),
        bytesDownloaded: Number(result?.bytesDownloaded || 0)
      };
    }

    /** @type {ExtractedPdf[]} */
    let extractedPdfs = [];
    /** @type {Blob|null} */
    let zipBlob = null;
    let bytesDownloaded = 0;

    try {
      const downloadResult = await this.downloadPackage(packageUrl, abortSignal);
      zipBlob = downloadResult.blob;
      bytesDownloaded = downloadResult.bytesDownloaded;

      extractedPdfs = await this.extractPdfsFromZip(zipBlob, expectedPdfs);
      const stored = await this.storePdfsInCache(extractedPdfs, {
        batch,
        onProgress,
        pdfMetadataMap
      });

      return {
        stored,
        extracted: extractedPdfs.length,
        bytesDownloaded
      };
    } finally {
      // Release temporary in-memory references before moving to next package.
      if (extractedPdfs.length > 0) {
        for (const pdf of extractedPdfs) {
          if (pdf && pdf.blob) {
            // @ts-ignore - explicit cleanup of large blob reference.
            pdf.blob = null;
          }
        }
      }
      extractedPdfs.length = 0;
      zipBlob = null;
    }
  }

  /**
   * Store extracted PDFs in cache.
   *
   * @param {ExtractedPdf[]} pdfs
   * @param {Object} [options]
   * @param {boolean} [options.batch=false]
   * @param {Function} [options.onProgress]
   * @param {Map<string, {pdfId?: string, category?: string, manifestRevision?: string}>} [options.pdfMetadataMap]
   * @returns {Promise<number>}
   */
  async storePdfsInCache(pdfs, options = {}) {
    const { batch = false, onProgress = null, pdfMetadataMap = null } = options;
    
    // Use batch mode for better performance when storing multiple PDFs
    if (batch && pdfs.length > 1) {
      logger.info('PackageDownloader', `Using batch mode to store ${pdfs.length} PDFs`);
      
      // Prepare PDFs for batch storage
      const pdfsToBatch = [];
      let preparedCount = 0;
      
      for (const pdf of pdfs) {
        // CRITICAL: Always use originalName first (preserves case and accents from ZIP)
        // originalName comes directly from ZIP entry and has the correct path
        // Only use normalizedPath as fallback if originalName is not available
        const originalPath = pdf.originalName || pdf.normalizedPath;
        
        // Apply PdfPathManager normalization only for format consistency (adds assets/ prefix, etc)
        // This preserves case and accents while ensuring consistent format
        const normalizedPath = PdfPathManager.normalizeForStorage(originalPath);
        
        if (!normalizedPath) {
          logger.warn('PackageDownloader', `Skipping PDF with invalid path: ${originalPath}`);
          continue;
        }
        
        // Look up inventory metadata if provided
        const meta = pdfMetadataMap?.get(`/${normalizedPath}`) ||
                     pdfMetadataMap?.get(normalizedPath) || {};

        pdfsToBatch.push({
          path: normalizedPath,
          blob: pdf.blob,
          pdfId: meta.pdfId,
          category: meta.category,
          manifestRevision: meta.manifestRevision
        });
        
        preparedCount++;
        
        // FASE 5: Report progress during preparation (lightweight operation)
        if (onProgress && preparedCount % 100 === 0) {
          onProgress({
            phase: 'preparing',
            completed: preparedCount,
            total: pdfs.length,
            percentage: Math.floor((preparedCount / pdfs.length) * 100)
          });
        }
      }
      
      // Store all PDFs in batch (no events during storage)
      // FASE 5: Progress callback will be called by internal batch storage
      let storedCount = 0;
      const progressUpdateInterval = 50; // Update every 50 PDFs
      let lastProgressUpdate = 0;
      
      for (let i = 0; i < pdfsToBatch.length; i++) {
        const { path, blob, pdfId, category, manifestRevision } = pdfsToBatch[i];
        
        try {
          await cacheStorageAdapter._putPdfInternal(path, blob, {
            emitEvents: false,
            notifyServiceWorker: false,
            pdfId,
            category,
            manifestRevision
          });
          storedCount++;
          
          // FASE 5: Update progress periodically without triggering sync
          // Always update on intervals or if we're near the end
          const shouldUpdate = storedCount % progressUpdateInterval === 0 || 
                              storedCount === pdfsToBatch.length ||
                              (pdfsToBatch.length - storedCount < progressUpdateInterval && 
                               storedCount - lastProgressUpdate >= 10); // Update every 10 PDFs near the end
          
          if (onProgress && shouldUpdate) {
            lastProgressUpdate = storedCount;
            onProgress({
              phase: 'storing',
              completed: storedCount,
              total: pdfsToBatch.length,
              percentage: Math.floor((storedCount / pdfsToBatch.length) * 100)
            });
          }
        } catch (error) {
          if (isQuotaExceededError(error) || error?.errorCode === 'QUOTA_EXCEEDED') {
            logger.error('PackageDownloader', `Quota exceeded while storing PDF: ${path}`, error);
            throw createQuotaExceededError({ causeMessage: error?.message });
          }
          logger.error('PackageDownloader', `Error storing PDF: ${path}`, error);
          // Continue with other PDFs
        }
      }
      
      // Final progress callback - ALWAYS called, even if loop completed without hitting interval
      if (onProgress) {
        // Only call final callback if we haven't already reported 100%
        if (storedCount > 0 && lastProgressUpdate < storedCount) {
          onProgress({
            phase: 'complete',
            completed: storedCount,
            total: pdfsToBatch.length,
            percentage: 100
          });
        }
      }
      
      logger.info('PackageDownloader', `Batch storage completed: ${storedCount}/${pdfs.length} PDFs stored`);
      
      return storedCount;
    }
    
    // Fallback to individual storage (for compatibility or when batch is disabled)
    let stored = 0;
    const isDev = typeof window !== 'undefined' && 
                  (window.location.hostname === 'localhost' || 
                   window.location.hostname === '127.0.0.1' ||
                   (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV));

    for (const pdf of pdfs) {
      try {
        // CRITICAL: Always use originalName first (preserves case and accents from ZIP)
        // originalName comes directly from ZIP entry and has the correct path
        // Only use normalizedPath as fallback if originalName is not available
        const originalPath = pdf.originalName || pdf.normalizedPath;
        
        // Apply PdfPathManager normalization only for format consistency (adds assets/ prefix, etc)
        // This preserves case and accents while ensuring consistent format
        const normalizedPath = PdfPathManager.normalizeForStorage(originalPath);
        
        if (!normalizedPath) {
          logger.warn('PackageDownloader', `Skipping PDF with invalid path: ${originalPath}`);
          continue;
        }
        
        if (isDev && (normalizedPath.includes('cifra') || normalizedPath.includes('nivel') || normalizedPath.includes('Cifra') || normalizedPath.includes('Nivel'))) {
          logger.debug('PackageDownloader', `Storing PDF (Cifra): ${originalPath} -> ${normalizedPath}`);
        }
        const meta = pdfMetadataMap?.get(`/${normalizedPath}`) ||
                     pdfMetadataMap?.get(normalizedPath) || {};
        await cacheStorageAdapter._putPdfInternal(normalizedPath, pdf.blob, {
          emitEvents: false,
          notifyServiceWorker: false,
          pdfId: meta.pdfId,
          category: meta.category,
          manifestRevision: meta.manifestRevision
        });
        stored++;
        
        // Call progress callback if provided
        if (onProgress && stored % 50 === 0) {
          onProgress({
            completed: stored,
            total: pdfs.length,
            percentage: Math.floor((stored / pdfs.length) * 100)
          });
        }
      } catch (error) {
        if (isQuotaExceededError(error) || error?.errorCode === 'QUOTA_EXCEEDED') {
          logger.error('PackageDownloader', `Quota exceeded while storing PDF: ${pdf.originalName || pdf.normalizedPath}`, error);
          throw createQuotaExceededError({ causeMessage: error?.message });
        }
        logger.error('PackageDownloader', `Error storing PDF: ${pdf.originalName || pdf.normalizedPath}`, error);
        // Continue with other PDFs
      }
    }

    logger.info('PackageDownloader', `Stored ${stored}/${pdfs.length} PDFs in cache`);
    
    return stored;
  }

  /**
   * Normalize ZIP entry name
   * Uses PdfPathManager to preserve case and accents (consistent with validation)
   * @param {string} entryName - Entry name from ZIP
   * @returns {string} Normalized path
   * @private
   */
  _normalizeZipEntryName(entryName) {
    if (!entryName) {
      return '';
    }

    // Use PdfPathManager to preserve case and accents (consistent with how paths are validated)
    // This ensures "Cifra nível I" stays as "Cifra nível I" instead of becoming "cifra nivel i"
    const normalized = PdfPathManager.normalizeForStorage(entryName);

    if (!normalized || normalized.endsWith('/')) {
      return '';
    }

    // Return without leading slash for consistency with CacheRepository
    return normalized;
  }

  /**
   * Unzip entries from buffer
   * @param {Uint8Array} buffer - ZIP file buffer
   * @returns {Promise<Object>} Entries object
   * @private
   */
  _unzipEntries(buffer) {
    return new Promise((resolve, reject) => {
      unzip(buffer, (err, data) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(data || {});
      });
    });
  }
}

// Create default instance
const packageDownloader = new PackageDownloader();

export default packageDownloader;

