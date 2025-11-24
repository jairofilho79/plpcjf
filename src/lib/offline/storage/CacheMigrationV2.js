/**
 * Cache Migration V2
 * Migrates existing PDFs in cache to new unified normalization format
 * Re-normalizes PDF paths using PdfPathManager to ensure consistency
 */

import PdfPathManager from '../utils/PdfPathManager.js';
import cacheStorageAdapter from './CacheStorageAdapter.js';
import { createLogger } from '../utils/OfflineLogger.js';
import { browser } from '$app/environment';

const logger = createLogger('CacheMigrationV2');

/**
 * Migration result
 * @typedef {Object} MigrationResult
 * @property {number} migrated - Number of PDFs migrated
 * @property {number} skipped - Number of PDFs skipped (already correct format)
 * @property {number} errors - Number of errors during migration
 * @property {string[]} errorDetails - Array of error messages
 */

/**
 * Cache Migration V2
 * Handles migration of existing cache entries to new normalization format
 */
export class CacheMigrationV2 {
  constructor() {
    this._migrationFlag = 'cache_migration_v2_completed';
  }

  /**
   * Check if migration has already been completed
   * @returns {Promise<boolean>} True if migration was completed
   */
  async isMigrationCompleted() {
    if (!browser || typeof localStorage === 'undefined') {
      return false;
    }

    try {
      const flag = localStorage.getItem(this._migrationFlag);
      return flag === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Mark migration as completed
   * @private
   */
  _markMigrationCompleted() {
    if (!browser || typeof localStorage === 'undefined') {
      return;
    }

    try {
      localStorage.setItem(this._migrationFlag, 'true');
    } catch (error) {
      logger.warn('CacheMigrationV2', 'Could not mark migration as completed', error);
    }
  }

  /**
   * Migrate PDFs in cache to new normalization format
   * @param {Object} [options] - Migration options
   * @param {boolean} [options.force] - Force migration even if already completed
   * @param {Function} [options.onProgress] - Progress callback
   * @returns {Promise<MigrationResult>} Migration result
   */
  async migrate(options = {}) {
    if (!browser) {
      return {
        migrated: 0,
        skipped: 0,
        errors: 0,
        errorDetails: ['Migration only available in browser']
      };
    }

    // Check if migration already completed
    if (!options.force && await this.isMigrationCompleted()) {
      logger.info('CacheMigrationV2', 'Migration already completed, skipping');
      return {
        migrated: 0,
        skipped: 0,
        errors: 0,
        errorDetails: ['Migration already completed']
      };
    }

    logger.info('CacheMigrationV2', 'Starting cache migration V2');

    const result = {
      migrated: 0,
      skipped: 0,
      errors: 0,
      errorDetails: []
    };

    try {
      // Get cache directly for migration
      // We need to access cache directly to read all entries
      if (typeof caches === 'undefined') {
        logger.error('CacheMigrationV2', 'Cache Storage API not available');
        result.errors++;
        result.errorDetails.push('Cache Storage API not available');
        return result;
      }

      const cacheName = cacheStorageAdapter.cacheName || 'plpc-pdfs';
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();

      // Filter for PDF files
      const pdfRequests = keys.filter(req => {
        try {
          const urlObj = new URL(req.url);
          return urlObj.pathname.endsWith('.pdf') && 
                 !urlObj.pathname.includes('/_app/') &&
                 !urlObj.pathname.includes('/node_modules/');
        } catch {
          return false;
        }
      });

      logger.info('CacheMigrationV2', `Found ${pdfRequests.length} PDFs to migrate`);

      // Process each PDF
      for (let i = 0; i < pdfRequests.length; i++) {
        const request = pdfRequests[i];
        
        try {
          // Extract pathname from URL
          const urlObj = new URL(request.url);
          let originalPath = urlObj.pathname;
          
          // Remove leading slash for comparison
          originalPath = originalPath.replace(/^\/+/, '');
          
          // Normalize using PdfPathManager
          const normalizedPath = PdfPathManager.normalizeForStorage(originalPath);
          
          if (!normalizedPath) {
            result.errors++;
            result.errorDetails.push(`Failed to normalize: ${originalPath}`);
            continue;
          }

          // Check if path needs migration
          // Compare the stored URL pathname with what it should be after normalization
          // If they differ, we need to migrate
          const storedPath = originalPath.replace(/^\/+/, '');
          const expectedPath = normalizedPath;
          
          // Path needs migration if stored path doesn't match expected normalized path
          const needsMigration = storedPath !== expectedPath;

          if (!needsMigration) {
            // Path is already in correct format
            result.skipped++;
            continue;
          }

          // Get PDF data from cache
          const response = await cache.match(request);
          if (!response) {
            result.errors++;
            result.errorDetails.push(`PDF not found in cache: ${originalPath}`);
            continue;
          }

          // Re-store with normalized path
          await cacheStorageAdapter.putPdf(normalizedPath, response);
          
          // Remove old entry if path changed
          if (originalPath !== `/${normalizedPath}`) {
            try {
              await cache.delete(request);
            } catch (deleteError) {
              logger.warn('CacheMigrationV2', `Could not delete old entry: ${originalPath}`, deleteError);
              // Non-critical, continue
            }
          }

          result.migrated++;

          // Progress callback
          if (options.onProgress) {
            options.onProgress({
              current: i + 1,
              total: pdfRequests.length,
              migrated: result.migrated,
              skipped: result.skipped,
              errors: result.errors
            });
          }

          // Log every 100 PDFs
          if ((i + 1) % 100 === 0) {
            logger.info('CacheMigrationV2', `Migration progress: ${i + 1}/${pdfRequests.length}`);
          }
        } catch (error) {
          result.errors++;
          result.errorDetails.push(`Error migrating PDF: ${error.message}`);
          logger.error('CacheMigrationV2', `Error migrating PDF: ${request.url}`, error);
        }
      }

      // Mark migration as completed
      this._markMigrationCompleted();

      logger.info('CacheMigrationV2', `Migration completed: ${result.migrated} migrated, ${result.skipped} skipped, ${result.errors} errors`);

      return result;
    } catch (error) {
      logger.error('CacheMigrationV2', 'Migration failed', error);
      result.errors++;
      result.errorDetails.push(`Migration failed: ${error.message}`);
      return result;
    }
  }

  /**
   * Validate migration by checking if migrated PDFs can be found
   * @param {Object} [options] - Validation options
   * @param {number} [options.sampleSize] - Number of PDFs to sample (default: 10)
   * @returns {Promise<Object>} Validation result
   */
  async validateMigration(options = {}) {
    if (!browser) {
      return {
        valid: false,
        checked: 0,
        found: 0,
        missing: 0,
        errors: ['Validation only available in browser']
      };
    }

    const sampleSize = options.sampleSize || 10;
    const result = {
      valid: true,
      checked: 0,
      found: 0,
      missing: 0,
      errors: []
    };

    try {
      // Get all PDFs in cache
      const allPdfs = await cacheStorageAdapter.listPdfs();
      
      if (allPdfs.length === 0) {
        logger.info('CacheMigrationV2', 'No PDFs in cache to validate');
        return result;
      }

      // Sample random PDFs
      const sample = [];
      const sampleCount = Math.min(sampleSize, allPdfs.length);
      
      for (let i = 0; i < sampleCount; i++) {
        const randomIndex = Math.floor(Math.random() * allPdfs.length);
        sample.push(allPdfs[randomIndex]);
      }

      logger.info('CacheMigrationV2', `Validating ${sample.length} PDFs`);

      // Validate each sampled PDF
      for (const pdfPath of sample) {
        result.checked++;
        
        try {
          // Try to get PDF from cache
          const response = await cacheStorageAdapter.getPdf(pdfPath);
          
          if (response) {
            result.found++;
          } else {
            result.missing++;
            result.errors.push(`PDF not found: ${pdfPath}`);
            result.valid = false;
          }
        } catch (error) {
          result.missing++;
          result.errors.push(`Error validating PDF: ${pdfPath} - ${error.message}`);
          result.valid = false;
        }
      }

      logger.info('CacheMigrationV2', `Validation completed: ${result.found}/${result.checked} found`);

      return result;
    } catch (error) {
      logger.error('CacheMigrationV2', 'Validation failed', error);
      result.valid = false;
      result.errors.push(`Validation failed: ${error.message}`);
      return result;
    }
  }

  /**
   * Reset migration flag (for testing or re-migration)
   */
  resetMigrationFlag() {
    if (!browser || typeof localStorage === 'undefined') {
      return;
    }

    try {
      localStorage.removeItem(this._migrationFlag);
      logger.info('CacheMigrationV2', 'Migration flag reset');
    } catch (error) {
      logger.warn('CacheMigrationV2', 'Could not reset migration flag', error);
    }
  }
}

// Create singleton instance
const cacheMigrationV2 = new CacheMigrationV2();

export default cacheMigrationV2;

