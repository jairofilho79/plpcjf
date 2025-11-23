/**
 * PDF Validator Interface
 * Base interface for PDF validation strategies
 */

import { createLogger } from '../utils/OfflineLogger.js';

const logger = createLogger('PdfValidator');

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
 * @typedef {Object} ValidationOptions
 * @property {boolean} [checkNetwork] - Whether to check network (default: true if online)
 * @property {boolean} [useIndex] - Whether to use index for fast validation (default: true)
 * @property {string} [pdfId] - PDF ID for index lookup
 */

/**
 * Base PDF Validator Class
 * Provides interface and common functionality for validation strategies
 */
export class PdfValidator {
  /**
   * Validate PDF availability
   * @param {string} pdfPath - PDF path to validate
   * @param {ValidationOptions} [options] - Validation options
   * @returns {Promise<ValidationResult>} Validation result
   */
  async validate(pdfPath, options = {}) {
    throw new Error('validate must be implemented by subclass');
  }

  /**
   * Get validator name for logging
   * @returns {string} Validator name
   */
  getName() {
    return this.constructor.name;
  }

  /**
   * Log validation attempt
   * @param {string} pdfPath - PDF path
   * @param {ValidationResult} result - Validation result
   * @protected
   */
  _logValidation(pdfPath, result) {
    logger.debug(
      this.getName(),
      `Validation result for ${pdfPath}:`,
      {
        available: result.available,
        source: result.source,
        needsDownload: result.needsDownload
      }
    );
  }
}

export default PdfValidator;

