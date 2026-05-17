/**
 * Index Validator
 * Validates PDF availability via pre-built index (fast)
 */

import { PdfValidator } from './PdfValidator.js';
import { isPdfAvailableInIndex } from '$lib/utils/pdfIndex';
import PdfPathManager from '../utils/PdfPathManager.js';
import { createLogger } from '../utils/OfflineLogger.js';

const logger = createLogger('IndexValidator');

/**
 * Index Validator
 * Validates PDFs using pre-built availability index
 * Fast but requires index to be generated first
 */
export class IndexValidator extends PdfValidator {
  /**
   * Validate PDF availability via index
   * @param {string} pdfPath - PDF path to validate
   * @param {Object} [options] - Validation options
   * @param {string} [options.pdfId] - PDF ID for index lookup (required for index validation)
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

    // Index validator requires pdfId
    if (!options.pdfId) {
      return {
        available: false,
        source: 'index',
        normalizedPath: PdfPathManager.normalizeForStorage(pdfPath) || '',
        needsDownload: false,
        error: 'PDF ID required for index validation'
      };
    }

    try {
      // Normalize path using PdfPathManager (preserves case and accents)
      const normalizedPath = PdfPathManager.normalizeForStorage(pdfPath);
      
      if (!normalizedPath) {
        return {
          available: false,
          source: 'unknown',
          normalizedPath: '',
          needsDownload: false,
          error: 'Failed to normalize PDF path'
        };
      }

      // Check index
      const indexResult = isPdfAvailableInIndex(options.pdfId);
      
      // Index returns: true (available), false (not available), null (index unavailable)
      if (indexResult === null) {
        // Index not available - return result indicating index is unavailable
        return {
          available: false,
          source: 'index',
          normalizedPath: normalizedPath,
          needsDownload: false,
          error: 'Index not available'
        };
      }

      const result = {
        available: indexResult === true,
        source: 'index',
        normalizedPath: normalizedPath,
        needsDownload: !indexResult && navigator.onLine,
        url: PdfPathManager.createRequestUrl(normalizedPath)
      };

      this._logValidation(pdfPath, result);
      return result;
    } catch (error) {
      logger.error('IndexValidator', `Error validating PDF: ${pdfPath}`, error);
      
      return {
        available: false,
        source: 'index',
        normalizedPath: PdfPathManager.normalizeForStorage(pdfPath) || '',
        needsDownload: false,
        error: error.message || 'Index validation failed'
      };
    }
  }
}

// Create singleton instance
const indexValidator = new IndexValidator();

export default indexValidator;

