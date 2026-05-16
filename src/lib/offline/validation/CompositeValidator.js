/**
 * Composite Validator
 *
 * Strategy order (most authoritative first):
 *   0. IndexedDB inventory — only this counts as "persisted offline"
 *   1. Index (pdfIndex) — fast secondary check for pre-built index
 *   2. Cache API — legacy / migration window only
 *   3. Network — signals "downloadable", not "persisted"
 */

import { PdfValidator } from './PdfValidator.js';
import cacheValidator from './CacheValidator.js';
import indexValidator from './IndexValidator.js';
import networkValidator from './NetworkValidator.js';
import PdfPathManager from '../utils/PdfPathManager.js';
import { createLogger } from '../utils/OfflineLogger.js';
import offlineInventoryRepository from '../storage/OfflineInventoryRepository.js';
import { browser } from '$app/environment';

const logger = createLogger('CompositeValidator');

export class CompositeValidator extends PdfValidator {
  /**
   * @param {Array<PdfValidator>} [validators] - Custom validators for strategies 1-3
   */
  constructor(validators = null) {
    super();
    this.validators = validators || [indexValidator, cacheValidator, networkValidator];
  }

  /**
   * Validate PDF availability.
   *
   * @param {string} pdfPath - PDF path to validate
   * @param {{
   *   useIndex?: boolean,
   *   checkNetwork?: boolean,
   *   pdfId?: string,
   *   skipInventory?: boolean
   * }} [options]
   * @returns {Promise<import('./PdfValidator.js').ValidationResult>}
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

    const normalizedPath = PdfPathManager.normalizeForStorage(pdfPath);
    const useIndex = options.useIndex !== false;
    const checkNetwork = options.checkNetwork !== false && typeof navigator !== 'undefined' && navigator.onLine;

    // ── Strategy 0: IndexedDB inventory ──────────────────────────────────────
    // This is the ONLY source that means "persisted offline". If IDB has the
    // blob, we return immediately without touching Cache API or network.
    if (!options.skipInventory && browser) {
      try {
        const hasInIdb = options.pdfId
          ? await offlineInventoryRepository._repo.hasByPdfId(options.pdfId)
          : await offlineInventoryRepository._repo.hasAsset(pdfPath);

        if (hasInIdb) {
          const elapsed = performance.now() - startTime;
          logger.debug('CompositeValidator', `IDB hit in ${elapsed.toFixed(2)}ms: ${pdfPath}`);
          return {
            available: true,
            source: 'indexeddb',
            normalizedPath: normalizedPath || '',
            needsDownload: false
          };
        }
      } catch (err) {
        logger.debug('CompositeValidator', 'IDB check failed, continuing', err);
      }
    }

    // ── Strategy 1: Pre-built PDF index ──────────────────────────────────────
    if (useIndex && options.pdfId) {
      try {
        const indexResult = await indexValidator.validate(pdfPath, options);
        if (indexResult.error !== 'Index not available' && indexResult.available) {
          const elapsed = performance.now() - startTime;
          logger.debug('CompositeValidator', `Index hit in ${elapsed.toFixed(2)}ms: ${pdfPath}`);
          return indexResult;
        }
      } catch (err) {
        logger.debug('CompositeValidator', 'Index validation failed, continuing', err);
      }
    }

    // ── Strategy 2: Cache API (legacy / migration window) ────────────────────
    // A Cache API hit does NOT mean "persistently offline"; it could be evicted.
    // We return it but mark source as 'cache' so callers can treat it differently.
    try {
      const cacheResult = await cacheValidator.validate(pdfPath, options);
      if (cacheResult.available) {
        const elapsed = performance.now() - startTime;
        logger.debug('CompositeValidator', `Cache hit in ${elapsed.toFixed(2)}ms: ${pdfPath}`);
        return cacheResult;
      }
    } catch (err) {
      logger.debug('CompositeValidator', 'Cache validation failed, continuing', err);
    }

    // ── Strategy 3: Network (downloadable, not persisted) ───────────────────
    if (checkNetwork) {
      try {
        const networkResult = await networkValidator.validate(pdfPath, { checkNetwork: true });
        const elapsed = performance.now() - startTime;
        logger.debug('CompositeValidator', `Network result in ${elapsed.toFixed(2)}ms: ${pdfPath}`);
        return networkResult;
      } catch (err) {
        logger.debug('CompositeValidator', 'Network validation failed', err);
      }
    }

    const elapsed = performance.now() - startTime;
    logger.debug('CompositeValidator', `All strategies failed in ${elapsed.toFixed(2)}ms: ${pdfPath}`);

    return {
      available: false,
      source: 'unknown',
      normalizedPath: normalizedPath || '',
      needsDownload: typeof navigator !== 'undefined' ? navigator.onLine : false,
      error: 'All validation strategies failed or were skipped'
    };
  }
}

const compositeValidator = new CompositeValidator();

export default compositeValidator;
