/**
 * Composite Validator
 * Combines multiple validation strategies with fallback
 */

import { PdfValidator } from './PdfValidator.js';
import cacheValidator from './CacheValidator.js';
import indexValidator from './IndexValidator.js';
import networkValidator from './NetworkValidator.js';
import urlNormalizer from '../normalization/UrlNormalizer.js';
import { createLogger } from '../utils/OfflineLogger.js';

const logger = createLogger('CompositeValidator');

/**
 * Composite Validator
 * Combines multiple validation strategies in order:
 * 1. Index (fastest, if available)
 * 2. Cache (reliable, always checked)
 * 3. Network (fallback, only if online)
 */
export class CompositeValidator extends PdfValidator {
  /**
   * @param {Array<PdfValidator>} [validators] - Custom validators (defaults to standard set)
   */
  constructor(validators = null) {
    super();
    this.validators = validators || [
      indexValidator,
      cacheValidator,
      networkValidator
    ];
  }

  /**
   * Validate PDF availability using multiple strategies
   * @param {string} pdfPath - PDF path to validate
   * @param {Object} [options] - Validation options
   * @param {boolean} [options.useIndex] - Whether to use index (default: true)
   * @param {boolean} [options.checkNetwork] - Whether to check network (default: true if online)
   * @param {string} [options.pdfId] - PDF ID for index lookup
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

    const useIndex = options.useIndex !== false;
    const checkNetwork = options.checkNetwork !== false && navigator.onLine;

    // Strategy 1: Index (fastest, if available and enabled)
    if (useIndex && options.pdfId) {
      try {
        const indexResult = await indexValidator.validate(pdfPath, options);
        
        // If index is available and gives a definitive answer, use it
        if (indexResult.error !== 'Index not available') {
          if (indexResult.available) {
            // Index says available - trust it
            return indexResult;
          }
          // Index says not available - continue to cache check to be sure
        }
      } catch (error) {
        logger.debug('CompositeValidator', 'Index validation failed, continuing to cache', error);
      }
    }

    // Strategy 2: Cache (reliable, always checked)
    try {
      const cacheResult = await cacheValidator.validate(pdfPath, options);
      
      if (cacheResult.available) {
        // Found in cache - return immediately
        return cacheResult;
      }
      
      // Not in cache - continue to network check if enabled
    } catch (error) {
      logger.debug('CompositeValidator', 'Cache validation failed, continuing to network', error);
    }

    // Strategy 3: Network (fallback, only if online and enabled)
    if (checkNetwork) {
      try {
        const networkResult = await networkValidator.validate(pdfPath, { checkNetwork: true });
        
        // Network check gives definitive answer
        return networkResult;
      } catch (error) {
        logger.debug('CompositeValidator', 'Network validation failed', error);
      }
    }

    // If all strategies failed or were skipped, return not available
    const normalizedPath = urlNormalizer.normalizeForCache(pdfPath) || '';
    
    return {
      available: false,
      source: 'unknown',
      normalizedPath: normalizedPath,
      needsDownload: navigator.onLine,
      error: 'All validation strategies failed or were skipped'
    };
  }
}

// Create default singleton instance
const compositeValidator = new CompositeValidator();

export default compositeValidator;

