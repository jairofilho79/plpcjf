/**
 * Cache Repository Interface
 * Abstract interface for cache operations with automatic URL normalization
 */

import { createLogger } from '../utils/OfflineLogger.js';

const logger = createLogger('CacheRepository');

/**
 * @typedef {Object} CacheRepositoryInterface
 * @property {Function} getPdf - Get PDF from cache
 * @property {Function} putPdf - Store PDF in cache
 * @property {Function} hasPdf - Check if PDF exists in cache
 * @property {Function} deletePdf - Delete PDF from cache
 * @property {Function} listPdfs - List all PDFs in cache
 * @property {Function} listPdfsByCategory - List PDFs by category
 * @property {Function} clear - Clear all cache
 * @property {Function} sync - Sync cache
 */

/**
 * Base Cache Repository Class
 * Provides interface and common functionality for cache implementations
 */
export class CacheRepository {
  /**
   * Get PDF from cache
   * @param {string} pdfPath - PDF path (will be normalized automatically)
   * @returns {Promise<Response|null>} PDF Response or null if not found
   */
  async getPdf(pdfPath) {
    throw new Error('getPdf must be implemented by subclass');
  }

  /**
   * Store PDF in cache
   * @param {string} pdfPath - PDF path (will be normalized automatically)
   * @param {Blob|Response} pdfData - PDF data to store
   * @returns {Promise<void>}
   */
  async putPdf(pdfPath, pdfData) {
    throw new Error('putPdf must be implemented by subclass');
  }

  /**
   * Check if PDF exists in cache
   * @param {string} pdfPath - PDF path (will be normalized automatically)
   * @returns {Promise<boolean>} True if PDF exists in cache
   */
  async hasPdf(pdfPath) {
    throw new Error('hasPdf must be implemented by subclass');
  }

  /**
   * Delete PDF from cache
   * @param {string} pdfPath - PDF path (will be normalized automatically)
   * @returns {Promise<boolean>} True if PDF was deleted
   */
  async deletePdf(pdfPath) {
    throw new Error('deletePdf must be implemented by subclass');
  }

  /**
   * List all PDFs in cache
   * @returns {Promise<string[]>} Array of normalized PDF paths
   */
  async listPdfs() {
    throw new Error('listPdfs must be implemented by subclass');
  }

  /**
   * List PDFs by category
   * @param {string} category - Category name
   * @returns {Promise<string[]>} Array of normalized PDF paths in category
   */
  async listPdfsByCategory(category) {
    throw new Error('listPdfsByCategory must be implemented by subclass');
  }

  /**
   * Clear all cache
   * @returns {Promise<void>}
   */
  async clear() {
    throw new Error('clear must be implemented by subclass');
  }

  /**
   * Sync cache (implementation specific)
   * @returns {Promise<void>}
   */
  async sync() {
    throw new Error('sync must be implemented by subclass');
  }

  /**
   * Convert Blob to Response if needed
   * @param {Blob|Response} data - Data to convert
   * @returns {Response} Response object
   * @protected
   */
  _toResponse(data) {
    if (data instanceof Response) {
      return data;
    }

    if (data instanceof Blob) {
      return new Response(data, {
        headers: {
          'Content-Type': data.type || 'application/pdf'
        }
      });
    }

    throw new Error('Invalid data type: expected Blob or Response');
  }
}

export default CacheRepository;

