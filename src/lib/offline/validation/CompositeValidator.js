/**
 * Composite Validator
 * Combines multiple validation strategies with fallback
 */

import { PdfValidator } from './PdfValidator.js';
import cacheValidator from './CacheValidator.js';
import indexValidator from './IndexValidator.js';
import networkValidator from './NetworkValidator.js';
import PdfPathManager from '../utils/PdfPathManager.js';
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
   * Order: Index (fastest) -> Cache (reliable) -> Network (fallback)
   * 
   * @param {string} pdfPath - PDF path to validate
   * @param {Object} [options] - Validation options
   * @param {boolean} [options.useIndex] - Whether to use index (default: true)
   * @param {boolean} [options.checkNetwork] - Whether to check network (default: true if online)
   * @param {string} [options.pdfId] - PDF ID for index lookup
   * @returns {Promise<ValidationResult>} Validation result
   */
  async validate(pdfPath, options = {}) {
    const startTime = performance.now();
    
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
    
    // Normalize path once using PdfPathManager (used for final result if all strategies fail)
    const normalizedPath = PdfPathManager.normalizeForStorage(pdfPath);

    // Strategy 1: Index (fastest, if available and enabled)
    if (useIndex && options.pdfId) {
      const indexStartTime = performance.now();
      try {
        const indexResult = await indexValidator.validate(pdfPath, options);
        const indexDuration = performance.now() - indexStartTime;
        
        logger.debug('CompositeValidator', `Index validation: ${indexResult.available ? 'FOUND' : 'NOT FOUND'} (${indexDuration.toFixed(2)}ms)`);
        
        // If index is available and gives a definitive answer, use it
        if (indexResult.error !== 'Index not available') {
          if (indexResult.available) {
            // Index says available - trust it
            const totalDuration = performance.now() - startTime;
            logger.debug('CompositeValidator', `PDF validated via Index in ${totalDuration.toFixed(2)}ms: ${pdfPath}`);
            return indexResult;
          }
          // Index says not available - continue to cache check to be sure
        }
      } catch (error) {
        const indexDuration = performance.now() - indexStartTime;
        logger.debug('CompositeValidator', `Index validation failed after ${indexDuration.toFixed(2)}ms, continuing to cache`, error);
      }
    }

    // Strategy 2: Cache (reliable, always checked)
    const cacheStartTime = performance.now();
    try {
      const cacheResult = await cacheValidator.validate(pdfPath, options);
      const cacheDuration = performance.now() - cacheStartTime;
      
      logger.debug('CompositeValidator', `Cache validation: ${cacheResult.available ? 'FOUND' : 'NOT FOUND'} (${cacheDuration.toFixed(2)}ms)`);
      
      if (cacheResult.available) {
        // Found in cache - return immediately
        const totalDuration = performance.now() - startTime;
        logger.debug('CompositeValidator', `PDF validated via Cache in ${totalDuration.toFixed(2)}ms: ${pdfPath}`);
        return cacheResult;
      }
      
      // Not in cache - continue to network check if enabled
    } catch (error) {
      const cacheDuration = performance.now() - cacheStartTime;
      logger.debug('CompositeValidator', `Cache validation failed after ${cacheDuration.toFixed(2)}ms, continuing to network`, error);
    }

    // Strategy 3: Network (fallback, only if online and enabled)
    if (checkNetwork) {
      const networkStartTime = performance.now();
      try {
        const networkResult = await networkValidator.validate(pdfPath, { checkNetwork: true });
        const networkDuration = performance.now() - networkStartTime;
        
        logger.debug('CompositeValidator', `Network validation: ${networkResult.available ? 'FOUND' : 'NOT FOUND'} (${networkDuration.toFixed(2)}ms)`);
        
        // Network check gives definitive answer
        const totalDuration = performance.now() - startTime;
        logger.debug('CompositeValidator', `PDF validated via Network in ${totalDuration.toFixed(2)}ms: ${pdfPath}`);
        return networkResult;
      } catch (error) {
        const networkDuration = performance.now() - networkStartTime;
        logger.debug('CompositeValidator', `Network validation failed after ${networkDuration.toFixed(2)}ms`, error);
      }
    }

    // If all strategies failed or were skipped, return not available
    const totalDuration = performance.now() - startTime;
    logger.debug('CompositeValidator', `PDF validation failed after ${totalDuration.toFixed(2)}ms: ${pdfPath}`);
    
    return {
      available: false,
      source: 'unknown',
      normalizedPath: normalizedPath || '',
      needsDownload: navigator.onLine,
      error: 'All validation strategies failed or were skipped'
    };
  }
}

// Create default singleton instance
const compositeValidator = new CompositeValidator();

export default compositeValidator;

