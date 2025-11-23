/**
 * URL Normalizer
 * Wrapper and extension of normalizePdfUrl function with additional utilities
 */

import { normalizePdfUrl as normalizePdfUrlOriginal } from '$lib/utils/pathUtils';
import normalizationCache from './NormalizationCache.js';
import { createLogger } from '../utils/OfflineLogger.js';

const logger = createLogger('UrlNormalizer');

/**
 * URL Normalizer Class
 * Provides consistent URL normalization across the offline module
 */
class UrlNormalizer {
  /**
   * Normalize a URL (generic normalization)
   * @param {string} url - URL to normalize
   * @returns {string} Normalized URL
   */
  normalize(url) {
    if (!url || typeof url !== 'string') {
      return '';
    }

    // Check cache first
    const cached = normalizationCache.get(url);
    if (cached !== null) {
      return cached;
    }

    // Use original function
    const normalized = normalizePdfUrlOriginal(url);
    
    // Cache the result
    normalizationCache.set(url, normalized);
    
    return normalized;
  }

  /**
   * Normalize PDF URL (wrapper for original function)
   * @param {string} url - PDF URL to normalize
   * @returns {string} Normalized PDF URL
   */
  normalizePdfUrl(url) {
    return this.normalize(url);
  }

  /**
   * Normalize URL for cache storage
   * Ensures consistent format for cache keys
   * @param {string} url - URL to normalize
   * @returns {string} Normalized URL for cache
   */
  normalizeForCache(url) {
    if (!url || typeof url !== 'string') {
      return '';
    }

    // Use standard normalization
    let normalized = this.normalize(url);

    // Additional cache-specific normalization if needed
    // Remove any query parameters or fragments
    try {
      const urlObj = new URL(normalized, window.location.origin);
      normalized = urlObj.pathname;
    } catch {
      // If URL parsing fails, use normalized as-is
    }

    return normalized;
  }

  /**
   * Normalize URL for HTTP request
   * Ensures URL is ready for fetch/request
   * @param {string} url - URL to normalize
   * @returns {string} Normalized URL for request
   */
  normalizeForRequest(url) {
    if (!url || typeof url !== 'string') {
      return '';
    }

    // Use standard normalization
    let normalized = this.normalize(url);

    // Ensure it's a full URL if needed
    if (normalized && !normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      // Add leading slash if missing
      if (!normalized.startsWith('/')) {
        normalized = '/' + normalized;
      }
    }

    return normalized;
  }

  /**
   * Check if two URLs are equal after normalization
   * @param {string} url1 - First URL
   * @param {string} url2 - Second URL
   * @returns {boolean} True if URLs are equal after normalization
   */
  areEqual(url1, url2) {
    if (!url1 || !url2) {
      return url1 === url2;
    }

    const normalized1 = this.normalize(url1);
    const normalized2 = this.normalize(url2);

    return normalized1 === normalized2;
  }

  /**
   * Validate if URL is valid
   * @param {string} url - URL to validate
   * @returns {boolean} True if URL is valid
   */
  isValid(url) {
    if (!url || typeof url !== 'string') {
      return false;
    }

    // Basic validation: should normalize to non-empty string
    const normalized = this.normalize(url);
    return normalized.length > 0;
  }

  /**
   * Clear normalization cache
   */
  clearCache() {
    normalizationCache.clear();
    logger.debug('UrlNormalizer', 'Normalization cache cleared');
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    return normalizationCache.getStats();
  }
}

// Create singleton instance
const urlNormalizer = new UrlNormalizer();

// Export singleton
export default urlNormalizer;

// Export class for testing
export { UrlNormalizer };

// Re-export original function for compatibility
export { normalizePdfUrlOriginal as normalizePdfUrl };

