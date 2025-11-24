/**
 * Service Worker Utilities
 * Standalone functions for PDF path normalization in Service Worker
 * Replicates PdfPathManager logic but without ES6 module dependencies
 * 
 * NOTE: Service Workers cannot import ES6 modules, so these are vanilla JS functions
 */

/**
 * Decode multiple levels of URL encoding (handles double/triple encoding)
 * @param {string} encoded - Potentially multiply-encoded string
 * @param {number} maxIterations - Maximum number of decoding iterations (default: 3)
 * @returns {string} Fully decoded string
 */
function decodeUrlUtf8Multiple(encoded, maxIterations = 3) {
  if (!encoded || typeof encoded !== 'string') {
    return '';
  }

  let decoded = encoded;
  let previousDecoded = '';
  let iterations = 0;

  while (iterations < maxIterations && decoded.includes('%')) {
    previousDecoded = decoded;
    try {
      decoded = decodeURIComponent(decoded);
      // If decoding didn't change anything, we're done
      if (decoded === previousDecoded) {
        break;
      }
      iterations++;
    } catch (e) {
      // If decoding fails, return the last successful decode
      break;
    }
  }

  return decoded;
}

/**
 * Encode URL path with UTF-8 support
 * @param {string} path - URL path to encode
 * @returns {string} Encoded URL path
 */
function encodeUrlUtf8(path) {
  if (!path || typeof path !== 'string') {
    return '';
  }

  try {
    return encodeURI(path);
  } catch (error) {
    return path;
  }
}

/**
 * Create URL with UTF-8 encoding
 * @param {string} path - URL path (relative or absolute)
 * @param {string} base - Base URL
 * @returns {string} Full URL string with UTF-8 encoding
 */
function createUrlUtf8(path, base) {
  if (!path || typeof path !== 'string') {
    return '';
  }

  try {
    if (!base) {
      base = self.location.origin;
    }

    // Ensure path starts with / if it's a relative path
    let normalizedPath = path;
    if (!normalizedPath.startsWith('/') && !normalizedPath.startsWith('http')) {
      normalizedPath = '/' + normalizedPath;
    }

    // Encode the path with UTF-8
    const encodedPath = encodeUrlUtf8(normalizedPath);

    // Create URL object
    try {
      const url = new URL(encodedPath, base);
      return url.toString();
    } catch (e) {
      // If URL constructor fails, manually construct the URL
      const cleanBase = base.replace(/\/+$/, '');
      return `${cleanBase}${encodedPath}`;
    }
  } catch (error) {
    // Fallback: return path with base if possible
    if (base) {
      const cleanBase = base.replace(/\/+$/, '');
      const cleanPath = path.startsWith('/') ? path : '/' + path;
      return `${cleanBase}${cleanPath}`;
    }
    return path;
  }
}

/**
 * Normalize PDF path for cache storage
 * Preserves case and accents, only cleans format
 * Replicates PdfPathManager.normalizeForStorage() logic
 * 
 * @param {string} pdfPath - PDF path to normalize
 * @returns {string} Normalized path in format 'assets/...' (without leading slash)
 */
function normalizePdfPathForCache(pdfPath) {
  if (!pdfPath || typeof pdfPath !== 'string') {
    return '';
  }

  try {
    // Remove protocol and domain if present
    let normalized = pdfPath.replace(/^https?:\/\/[^/]+/, '');
    
    // Remove leading/trailing slashes
    normalized = normalized.replace(/^\/+/, '').replace(/\/+$/, '');
    
    // Decode URI encoding (handle multiple encodings) but preserve case and accents
    // Use UTF-8 explicit decoding
    try {
      if (normalized.includes('%')) {
        normalized = decodeUrlUtf8Multiple(normalized, 3);
      }
    } catch {
      // If decoding fails, continue with original
    }
    
    // Normalize path separators (Windows vs Unix)
    normalized = normalized.replace(/\\/g, '/');
    
    // Ensure starts with 'assets/' (case-insensitive check, but preserve original case)
    const lowerNormalized = normalized.toLowerCase();
    if (!lowerNormalized.startsWith('assets/')) {
      normalized = `assets/${normalized}`;
    }
    
    // Return without leading slash (consistent format: 'assets/...')
    return normalized.replace(/^\/+/, '');
  } catch {
    // Fallback: simple preparation
    let fallback = pdfPath.replace(/^\/+/, '').replace(/\\/g, '/');
    const lowerFallback = fallback.toLowerCase();
    if (!lowerFallback.startsWith('assets/')) {
      fallback = `assets/${fallback}`;
    }
    return fallback.replace(/^\/+/, '');
  }
}

/**
 * Create PDF request URL variations for search
 * Generates multiple URL variations for fallback search
 * Replicates PdfPathManager.createSearchVariations() logic
 * 
 * @param {string} pdfPath - PDF path (will be normalized)
 * @param {string} origin - Base origin URL (defaults to self.location.origin)
 * @returns {string[]} Array of URL variations to try
 */
function createPdfRequestVariations(pdfPath, origin = null) {
  if (!pdfPath || typeof pdfPath !== 'string') {
    return [];
  }

  // Normalize path first
  const normalizedPath = normalizePdfPathForCache(pdfPath);
  if (!normalizedPath) {
    return [];
  }

  // Determine origin
  let baseOrigin = origin;
  if (!baseOrigin && typeof self !== 'undefined' && self.location) {
    baseOrigin = self.location.origin;
  }
  if (!baseOrigin) {
    baseOrigin = 'http://localhost'; // Fallback
  }

  // Generate variations
  const variations = [
    // Primary: normalized path with UTF-8 encoding
    createUrlUtf8(`/${normalizedPath}`, baseOrigin),
    // With leading slash and UTF-8 encoding (duplicate but explicit)
    createUrlUtf8(`/${normalizedPath}`, baseOrigin),
    // Explicit UTF-8 encoding
    createUrlUtf8(encodeUrlUtf8(`/${normalizedPath}`), baseOrigin),
    // Fallback: without encoding (for compatibility)
    normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`,
    normalizedPath
  ];

  // Remove duplicates
  return [...new Set(variations.filter(Boolean))];
}

// Export functions for Service Worker use
// In Service Worker context, these will be available globally
if (typeof self !== 'undefined') {
  self.normalizePdfPathForCache = normalizePdfPathForCache;
  self.createPdfRequestVariations = createPdfRequestVariations;
  self.createUrlUtf8 = createUrlUtf8;
}

