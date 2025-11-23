/**
 * Cache Validator
 * Validates PDF availability via Cache Repository
 */

import { PdfValidator } from './PdfValidator.js';
import cacheStorageAdapter from '../storage/CacheStorageAdapter.js';
import urlNormalizer from '../normalization/UrlNormalizer.js';
import { createLogger } from '../utils/OfflineLogger.js';

const logger = createLogger('CacheValidator');

/**
 * Cache Validator
 * Validates PDFs by checking Cache Storage via CacheRepository
 */
export class CacheValidator extends PdfValidator {
  /**
   * Validate PDF availability via cache
   * @param {string} pdfPath - PDF path to validate
   * @param {Object} [options] - Validation options (not used by CacheValidator)
   * @returns {Promise<ValidationResult>} Validation result
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

    try {
      // Normalize path
      const normalizedPath = urlNormalizer.normalizeForCache(pdfPath);
      
      if (!normalizedPath) {
        return {
          available: false,
          source: 'unknown',
          normalizedPath: '',
          needsDownload: false,
          error: 'Failed to normalize PDF path'
        };
      }

      // Check cache via CacheRepository
      const hasPdf = await cacheStorageAdapter.hasPdf(normalizedPath);
      
      const result = {
        available: hasPdf,
        source: 'cache',
        normalizedPath: normalizedPath,
        needsDownload: !hasPdf && navigator.onLine,
        url: new URL(`/${normalizedPath}`, window.location.origin).href
      };

      this._logValidation(pdfPath, result);
      return result;
    } catch (error) {
      logger.error('CacheValidator', `Error validating PDF: ${pdfPath}`, error);
      
      return {
        available: false,
        source: 'cache',
        normalizedPath: urlNormalizer.normalizeForCache(pdfPath) || '',
        needsDownload: false,
        error: error.message || 'Cache validation failed'
      };
    }
  }
}

// Create singleton instance
const cacheValidator = new CacheValidator();

export default cacheValidator;

