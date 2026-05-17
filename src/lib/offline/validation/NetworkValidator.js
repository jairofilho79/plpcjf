/**
 * Network Validator
 * Validates PDF availability via network request (only when online)
 */

import { PdfValidator } from './PdfValidator.js';
import PdfPathManager from '../utils/PdfPathManager.js';
import { createLogger } from '../utils/OfflineLogger.js';

const logger = createLogger('NetworkValidator');

/**
 * Network Validator
 * Validates PDFs by checking if they exist on the network
 * Only works when online
 */
export class NetworkValidator extends PdfValidator {
  /**
   * Validate PDF availability via network
   * @param {string} pdfPath - PDF path to validate
   * @param {Object} [options] - Validation options
   * @param {boolean} [options.checkNetwork] - Whether to check network (default: true if online)
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

    // Only check network if online and checkNetwork option is true
    // Treat navigator.onLine === undefined (non-browser envs) as online
    const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    const shouldCheckNetwork = options.checkNetwork !== false && isOnline;
    
    if (!shouldCheckNetwork) {
      return {
        available: false,
        source: 'network',
        normalizedPath: PdfPathManager.normalizeForStorage(pdfPath) || '',
        needsDownload: false,
        error: 'Network check skipped (offline or disabled)'
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

      // Build full URL using PdfPathManager
      const fullUrl = PdfPathManager.createRequestUrl(normalizedPath);

      // Try HEAD request to verify if PDF exists
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      let response;
      try {
        response = await fetch(fullUrl, {
          method: 'HEAD',
          cache: 'no-cache',
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const available = response.ok;
      
      const result = {
        available: available,
        source: 'network',
        normalizedPath: normalizedPath,
        needsDownload: !available,
        url: fullUrl
      };

      this._logValidation(pdfPath, result);
      return result;
    } catch (error) {
      // Network error or timeout - assume not available
      logger.debug('NetworkValidator', `Network check failed for ${pdfPath}:`, error.message);
      
      return {
        available: false,
        source: 'network',
        normalizedPath: PdfPathManager.normalizeForStorage(pdfPath) || '',
        needsDownload: false,
        error: error.message || 'Network check failed'
      };
    }
  }
}

// Create singleton instance
const networkValidator = new NetworkValidator();

export default networkValidator;

