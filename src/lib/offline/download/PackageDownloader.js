/**
 * Package Downloader
 * Handles download and extraction of ZIP packages with normalization
 */

import { unzip } from 'fflate';
import urlNormalizer from '../normalization/UrlNormalizer.js';
import cacheStorageAdapter from '../storage/CacheStorageAdapter.js';
import offlineEvents, { EVENTS } from '../core/OfflineEvents.js';
import { createLogger } from '../utils/OfflineLogger.js';

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
      const expectedSet = new Set();
      const expectedSetOriginal = new Set(expectedPdfs);
      
      for (const pdf of expectedPdfs) {
        const normalized = urlNormalizer.normalizePdfUrl(pdf);
        if (normalized) {
          expectedSet.add(`/${normalized}`);
          expectedSet.add(normalized);
        }
        // Also add original variations
        expectedSet.add(pdf);
        expectedSet.add(pdf.replace(/^\/+/, ''));
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
          const isExpected = expectedSet.has(normalizedForComparison) ||
                            expectedSet.has(normalizedPath) ||
                            expectedSetOriginal.has(normalizedPath) ||
                            expectedSetOriginal.has(normalizedPath.replace(/^\/+/, '')) ||
                            Array.from(expectedSetOriginal).some(url => {
                              const urlNormalized = urlNormalizer.normalizePdfUrl(url);
                              return urlNormalized === normalizedPath ||
                                     urlNormalized.endsWith(normalizedPath) ||
                                     normalizedPath.endsWith(urlNormalized);
                            });

          if (!isExpected) {
            logger.debug('PackageDownloader', `Skipping unexpected PDF: ${normalizedPath}`);
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
   * @param {ExtractedPdf[]} pdfs - Extracted PDFs
   * @returns {Promise<number>} Number of PDFs stored
   */
  async storePdfsInCache(pdfs) {
    let stored = 0;
    const isDev = typeof window !== 'undefined' && 
                  (window.location.hostname === 'localhost' || 
                   window.location.hostname === '127.0.0.1' ||
                   (typeof import !== 'undefined' && import.meta && import.meta.env && import.meta.env.DEV));

    for (const pdf of pdfs) {
      try {
        if (isDev && (pdf.normalizedPath.includes('cifra') || pdf.normalizedPath.includes('nivel'))) {
          logger.debug('PackageDownloader', `Storing PDF (Cifra): ${pdf.originalName} -> ${pdf.normalizedPath}`);
        }
        await cacheStorageAdapter.putPdf(pdf.normalizedPath, pdf.blob);
        stored++;
      } catch (error) {
        logger.error('PackageDownloader', `Error storing PDF: ${pdf.normalizedPath}`, error);
        // Continue with other PDFs
      }
    }

    logger.info('PackageDownloader', `Stored ${stored}/${pdfs.length} PDFs in cache`);

    return stored;
  }

  /**
   * Normalize ZIP entry name
   * @param {string} entryName - Entry name from ZIP
   * @returns {string} Normalized path
   * @private
   */
  _normalizeZipEntryName(entryName) {
    if (!entryName) {
      return '';
    }

    // Use unified normalization function
    const normalized = urlNormalizer.normalizePdfUrl(entryName);

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

