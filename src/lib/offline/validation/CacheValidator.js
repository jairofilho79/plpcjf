/**
 * Cache Validator
 * Validates PDF availability via Cache Repository
 */

import { PdfValidator } from './PdfValidator.js';
import cacheStorageAdapter from '../storage/CacheStorageAdapter.js';
import PdfPathManager from '../utils/PdfPathManager.js';
import { createLogger } from '../utils/OfflineLogger.js';

const logger = createLogger('CacheValidator');

/**
 * Cache Validator
 * Validates PDFs by checking Cache Storage via CacheRepository
 * Uses optimized two-stage verification with variation caching
 */
export class CacheValidator extends PdfValidator {
  constructor() {
    super();
    // Check if we're in development mode for debug logging
    this._isDev = typeof window !== 'undefined' && 
                  (window.location.hostname === 'localhost' || 
                   window.location.hostname === '127.0.0.1' ||
                   (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV));
  }

  /**
   * Validate PDF availability via cache
   * @param {string} pdfPath - PDF path to validate
   * @param {import('./PdfValidator.js').ValidationOptions & { debug?: boolean }} [options] - Validation options
   * @returns {Promise<import('./PdfValidator.js').ValidationResult>} Validation result
   */
  async validate(pdfPath, options = {}) {
    if (!pdfPath || typeof pdfPath !== 'string') {
      return {
        available: false,
        source: 'unknown',
        normalizedPath: '',
        needsDownload: false,
        error: 'Invalid PDF path'
      };
    }

    const debug = options.debug || this._isDev;
    const startTime = debug ? performance.now() : 0;

    try {
      // Normalize path using PdfPathManager (preserves case and accents)
      const normalizedPath = PdfPathManager.normalizeForStorage(pdfPath);
      
      if (debug) {
        logger.debug(`Validating PDF: ${pdfPath} -> ${normalizedPath}`);
      }
      
      if (!normalizedPath) {
        return {
          available: false,
          source: 'unknown',
          normalizedPath: '',
          needsDownload: false,
          error: 'Failed to normalize PDF path'
        };
      }

      // Check cache via CacheRepository (uses optimized two-stage verification)
      const hasPdf = await cacheStorageAdapter.hasPdf(normalizedPath);
      
      if (debug) {
        const duration = performance.now() - startTime;
        logger.debug(`Validation result for ${normalizedPath}: ${hasPdf ? 'FOUND' : 'NOT FOUND'} (${duration.toFixed(2)}ms)`);
      }
      
      /** @type {import('./PdfValidator.js').ValidationResult} */
      const result = {
        available: hasPdf,
        source: 'cache',
        normalizedPath: normalizedPath,
        needsDownload: !hasPdf && navigator.onLine,
        url: PdfPathManager.createRequestUrl(normalizedPath, window.location.origin)
      };

      this._logValidation(pdfPath, result);
      return result;
    } catch (error) {
      if (debug) {
        const duration = performance.now() - startTime;
        logger.error(`Error validating PDF: ${pdfPath} (${duration.toFixed(2)}ms)`, error);
      } else {
        logger.error(`Error validating PDF: ${pdfPath}`, error);
      }
      
      return {
        available: false,
        source: 'cache',
        normalizedPath: PdfPathManager.normalizeForStorage(pdfPath) || '',
        needsDownload: false,
        error: /** @type {any} */ (error).message || 'Cache validation failed'
      };
    }
  }
}

// Create singleton instance
const cacheValidator = new CacheValidator();

export default cacheValidator;

