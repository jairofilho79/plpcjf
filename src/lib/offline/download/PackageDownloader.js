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
    const fullUrl = packageUrl.startsWith('/') 
      ? packageUrl 
      : `${this.basePath}/${packageUrl}`;

    logger.info('PackageDownloader', `Downloading package: ${fullUrl}`);

    try {
      const response = await fetch(fullUrl, {
        signal: abortSignal,
        cache: 'no-store'
      });

      if (!response.ok) {
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
   * Store extracted PDFs in cache
   * Uses PdfPathManager to normalize paths consistently (preserves case and accents)
   * Always uses originalName from ZIP to preserve exact path with accents and case
   * @param {ExtractedPdf[]} pdfs - Extracted PDFs
   * @param {Object} [options] - Storage options
   * @param {boolean} [options.silent] - If true, skip notifications (for batch operations)
   * @returns {Promise<{stored: number, paths: string[]}>} Number of PDFs stored and list of paths
   */
  async storePdfsInCache(pdfs, options = {}) {
    let stored = 0;
    const savedPaths = [];
    const silent = options.silent === true;
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
        await cacheStorageAdapter.putPdf(normalizedPath, pdf.blob, { silent });
        savedPaths.push(normalizedPath);
        stored++;
      } catch (error) {
        logger.error('PackageDownloader', `Error storing PDF: ${pdf.originalName || pdf.normalizedPath}`, error);
        // Continue with other PDFs
      }
    }

    if (silent) {
      logger.debug('PackageDownloader', `Stored ${stored}/${pdfs.length} PDFs in cache (silent mode)`);
    } else {
      logger.info('PackageDownloader', `Stored ${stored}/${pdfs.length} PDFs in cache`);
    }
    
    return { stored, paths: savedPaths };
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

