/**
 * Cache Migration
 * Migrates existing cache entries to use normalized URLs
 */

import cacheStorageAdapter from './CacheStorageAdapter.js';
import { createLogger } from '../utils/OfflineLogger.js';
import { browser } from '$app/environment';
import { getConfig } from '../core/OfflineConfig.js';
import { decodeUrlUtf8 } from '$lib/utils/urlEncoding.js';
import { safeGet, safeSet, safeRemove } from '$lib/utils/safeStorage.js';

const logger = createLogger('CacheMigration');
const MIGRATION_COMPLETE_KEY = 'cache_migration_v1_complete';

/**
 * Cache Migration Utility
 * Migrates cache entries to use normalized URLs
 */
export class CacheMigration {
  /**
   * Check if migration is needed
   * @returns {Promise<boolean>} True if migration is needed
   */
  async needsMigration() {
    if (!browser) {
      return false;
    }

    // Check if migration was already completed
    const migrationComplete = safeGet(MIGRATION_COMPLETE_KEY);
    if (migrationComplete === 'true') {
      return false;
    }

    // Check if there are any cache entries
    try {
      const pdfs = await cacheStorageAdapter.listPdfs();
      return pdfs.length > 0;
    } catch (error) {
      logger.error('Error checking if migration needed', error);
      return false;
    }
  }

  /**
   * Migrate cache entries to normalized URLs
   * @returns {Promise<{migrated: number, errors: number}>} Migration result
   */
  async migrate() {
    if (!browser) {
      return { migrated: 0, errors: 0 };
    }

    // #22.5: esta migração nunca checava sua própria flag e reescaneava o
    // cache de PDF inteiro em toda chamada a initialize() — inclusive a cada
    // visita, já que `initialized` é só de memória. Segue o padrão de
    // `pdfCacheNfcMigration.js`: sai cedo se já concluída, e só marca a flag
    // numa saída limpa (abaixo), para que um erro deixe a próxima chamada
    // tentar de novo em vez de desistir silenciosamente.
    if (safeGet(MIGRATION_COMPLETE_KEY) === 'true') {
      logger.debug('Migração já concluída, pulando nova varredura.');
      return { migrated: 0, errors: 0 };
    }

    logger.info('Starting cache migration...');

    try {
      // Get all PDFs from cache
      const pdfs = await cacheStorageAdapter.listPdfs();
      
      if (pdfs.length === 0) {
        logger.info('No PDFs to migrate');
        const gravou = safeSet(MIGRATION_COMPLETE_KEY, 'true');
        if (!gravou) {
          logger.warn(
            'Migração concluída, mas a marca não gravou — vai repetir no próximo arranque'
          );
        }
        return { migrated: 0, errors: 0 };
      }

      let migrated = 0;
      let errors = 0;

      // Open cache directly to access all entries
      if (typeof caches === 'undefined') {
        logger.warn('Cache Storage API not available');
        return { migrated: 0, errors: 0 };
      }

      // Use centralized cache name from OfflineConfig
      const pdfCacheName = getConfig('PDF_CACHE_NAME') || getConfig('DEFAULT_PDF_CACHE_FALLBACK') || 'plpc-pdfs';
      const cache = await caches.open(pdfCacheName);
      const keys = await cache.keys();

      logger.info(`Found ${keys.length} cache entries to check`);

      for (const request of keys) {
        try {
          const url = request.url;
          const urlObj = new URL(url);
          // Decode pathname with UTF-8 to get original path
          const path = decodeUrlUtf8(urlObj.pathname);

          // Use original path (preserves case and accents) - this is the correct way
          const originalPath = path.startsWith('/') ? path : `/${path}`;

          // Get the response
          const response = await cache.match(request);
          if (!response) {
            continue;
          }

          // Store with original path (preserves encoding as in base64)
          // The CacheStorageAdapter will prepare it correctly
          await cacheStorageAdapter.putPdf(originalPath, response);

          // Try to delete old entry (may fail if URL format is different)
          try {
            await cache.delete(request);
          } catch (e) {
            // Ignore deletion errors
            logger.debug(`Could not delete old entry: ${url}`);
          }

          migrated++;
        } catch (error) {
          logger.warn(`Error migrating entry: ${request.url}`, error);
          errors++;
        }
      }

      // Só marca como concluída numa saída limpa (0 erros) — como
      // pdfCacheNfcMigration.js faz. Com erros, a flag fica ausente e a
      // próxima chamada tenta de novo, em vez de desistir para sempre.
      if (errors === 0) {
        const gravou = safeSet(MIGRATION_COMPLETE_KEY, 'true');
        if (!gravou) {
          logger.warn(
            'Migração concluída, mas a marca não gravou — vai repetir no próximo arranque'
          );
        }
      }

      logger.info(`Migration complete: ${migrated} migrated, ${errors} errors`);

      return { migrated, errors };
    } catch (error) {
      logger.error('Error during migration', error);
      return { migrated: 0, errors: 1 };
    }
  }

  /**
   * Reset migration flag (for testing)
   */
  resetMigrationFlag() {
    if (browser) {
      safeRemove(MIGRATION_COMPLETE_KEY);
    }
  }
}

// Create default instance
const cacheMigration = new CacheMigration();

export default cacheMigration;

