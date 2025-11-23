/**
 * Local Storage Adapter
 * Implementation for metadata storage using localStorage with TTL
 */

import { CacheRepository } from './CacheRepository.js';
import { getConfig } from '../core/OfflineConfig.js';
import { createLogger } from '../utils/OfflineLogger.js';
import { browser } from '$app/environment';

const logger = createLogger('LocalStorageAdapter');

/**
 * Local Storage Adapter
 * Stores metadata about cached PDFs in localStorage
 * Note: This is a partial implementation - actual PDFs are stored in Cache Storage
 */
export class LocalStorageAdapter extends CacheRepository {
  /**
   * @param {string} [prefix] - Key prefix for localStorage
   */
  constructor(prefix = 'offline_cache_') {
    super();
    this.prefix = prefix;
    this.cachedPdfsKey = getConfig('CACHED_PDFS_KEY') || 'cachedPdfsList';
  }

  /**
   * Get PDF metadata from localStorage
   * Note: This doesn't return the actual PDF, just metadata
   * @param {string} pdfPath - PDF path
   * @returns {Promise<Response|null>} Always returns null (PDFs not stored here)
   */
  async getPdf(pdfPath) {
    // PDFs are not stored in localStorage, only metadata
    return null;
  }

  /**
   * Store PDF metadata in localStorage
   * @param {string} pdfPath - PDF path (will be normalized)
   * @param {Blob|Response} pdfData - PDF data (not stored, only metadata)
   * @returns {Promise<void>}
   */
  async putPdf(pdfPath, pdfData) {
    if (!browser) {
      return;
    }

    try {
      const normalizedPath = this._normalizePath(pdfPath);
      if (!normalizedPath) {
        return;
      }

      // Get current list
      const cachedPdfs = this._getCachedPdfsList();
      
      // Add if not already present
      if (!cachedPdfs.includes(normalizedPath)) {
        cachedPdfs.push(normalizedPath);
        this._setCachedPdfsList(cachedPdfs);
        logger.debug('LocalStorageAdapter', `Added PDF to metadata: ${normalizedPath}`);
      }
    } catch (error) {
      logger.error('LocalStorageAdapter', `Error storing PDF metadata: ${pdfPath}`, error);
    }
  }

  /**
   * Check if PDF metadata exists
   * @param {string} pdfPath - PDF path (will be normalized)
   * @returns {Promise<boolean>} True if metadata exists
   */
  async hasPdf(pdfPath) {
    if (!browser) {
      return false;
    }

    try {
      const normalizedPath = this._normalizePath(pdfPath);
      if (!normalizedPath) {
        return false;
      }

      const cachedPdfs = this._getCachedPdfsList();
      return cachedPdfs.includes(normalizedPath);
    } catch (error) {
      logger.error('LocalStorageAdapter', `Error checking PDF metadata: ${pdfPath}`, error);
      return false;
    }
  }

  /**
   * Delete PDF metadata
   * @param {string} pdfPath - PDF path (will be normalized)
   * @returns {Promise<boolean>} True if metadata was deleted
   */
  async deletePdf(pdfPath) {
    if (!browser) {
      return false;
    }

    try {
      const normalizedPath = this._normalizePath(pdfPath);
      if (!normalizedPath) {
        return false;
      }

      const cachedPdfs = this._getCachedPdfsList();
      const index = cachedPdfs.indexOf(normalizedPath);
      
      if (index !== -1) {
        cachedPdfs.splice(index, 1);
        this._setCachedPdfsList(cachedPdfs);
        logger.debug('LocalStorageAdapter', `Removed PDF from metadata: ${normalizedPath}`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error('LocalStorageAdapter', `Error deleting PDF metadata: ${pdfPath}`, error);
      return false;
    }
  }

  /**
   * List all PDFs in metadata
   * @returns {Promise<string[]>} Array of normalized PDF paths
   */
  async listPdfs() {
    if (!browser) {
      return [];
    }

    try {
      return this._getCachedPdfsList();
    } catch (error) {
      logger.error('LocalStorageAdapter', 'Error listing PDFs', error);
      return [];
    }
  }

  /**
   * List PDFs by category
   * @param {string} category - Category name
   * @returns {Promise<string[]>} Array of normalized PDF paths in category
   */
  async listPdfsByCategory(category) {
    if (!category) {
      return [];
    }

    const allPdfs = await this.listPdfs();
    const categoryLower = category.toLowerCase();
    
    return allPdfs.filter(path => {
      const pathLower = path.toLowerCase();
      return pathLower.includes(categoryLower);
    });
  }

  /**
   * Clear all metadata
   * @returns {Promise<void>}
   */
  async clear() {
    if (!browser) {
      return;
    }

    try {
      localStorage.removeItem(this.cachedPdfsKey);
      logger.info('LocalStorageAdapter', 'Metadata cleared');
    } catch (error) {
      logger.error('LocalStorageAdapter', 'Error clearing metadata', error);
      throw error;
    }
  }

  /**
   * Sync metadata (no-op for localStorage)
   * @returns {Promise<void>}
   */
  async sync() {
    // localStorage doesn't need explicit sync
    logger.debug('LocalStorageAdapter', 'Sync called (no-op for localStorage)');
  }

  /**
   * Get cached PDFs list from localStorage
   * @returns {string[]} Array of PDF paths
   * @private
   */
  _getCachedPdfsList() {
    try {
      const stored = localStorage.getItem(this.cachedPdfsKey);
      if (!stored) {
        return [];
      }
      return JSON.parse(stored);
    } catch (error) {
      logger.warn('LocalStorageAdapter', 'Error reading cached PDFs list', error);
      return [];
    }
  }

  /**
   * Set cached PDFs list in localStorage
   * @param {string[]} pdfs - Array of PDF paths
   * @private
   */
  _setCachedPdfsList(pdfs) {
    try {
      localStorage.setItem(this.cachedPdfsKey, JSON.stringify(pdfs));
    } catch (error) {
      logger.error('LocalStorageAdapter', 'Error writing cached PDFs list', error);
      // If quota exceeded, try to clean up old entries
      if (error.name === 'QuotaExceededError') {
        logger.warn('LocalStorageAdapter', 'localStorage quota exceeded, attempting cleanup');
        // Could implement cleanup logic here
      }
    }
  }
}

// Create default instance
const localStorageAdapter = new LocalStorageAdapter();

export default localStorageAdapter;

