/**
 * URL Encoding Utilities with explicit UTF-8 support
 * 
 * CRITICAL: All URL encoding/decoding operations must use UTF-8 explicitly
 * to ensure proper handling of special characters, accents, and international characters.
 * 
 * These functions guarantee UTF-8 encoding/decoding consistency across the application,
 * especially for PDF paths that may contain special characters.
 */

/**
 * Encode a URL path with explicit UTF-8 support
 * This ensures proper encoding of special characters, accents, and international characters
 * 
 * @param {string} path - URL path to encode
 * @returns {string} Encoded URL path with UTF-8 encoding
 */
export function encodeUrlUtf8(path) {
  if (!path || typeof path !== 'string') {
    return '';
  }

  try {
    // encodeURI already uses UTF-8, but we ensure it explicitly
    // by encoding the string as UTF-8 bytes first if needed
    const encoded = encodeURI(path);
    
    // Validate that the encoding preserves UTF-8 characters correctly
    // If the string contains non-ASCII characters, ensure they're properly encoded
    if (path !== encoded) {
      // The encoding changed, which is expected for special characters
      // Verify it can be decoded back correctly
      try {
        const decoded = decodeURI(encoded);
        if (decoded !== path) {
          // If decode doesn't match, there might be an issue
          // Try using TextEncoder for explicit UTF-8 encoding
          const encoder = new TextEncoder();
          const bytes = encoder.encode(path);
          // Convert bytes to percent-encoded string
          let percentEncoded = '';
          for (let i = 0; i < bytes.length; i++) {
            const byte = bytes[i];
            // Characters that don't need encoding (RFC 3986 unreserved characters)
            if ((byte >= 0x41 && byte <= 0x5A) || // A-Z
                (byte >= 0x61 && byte <= 0x7A) || // a-z
                (byte >= 0x30 && byte <= 0x39) || // 0-9
                byte === 0x2D || // -
                byte === 0x2E || // .
                byte === 0x5F || // _
                byte === 0x7E || // ~
                byte === 0x2F || // /
                byte === 0x3A) { // :
              percentEncoded += String.fromCharCode(byte);
            } else {
              percentEncoded += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
            }
          }
          return percentEncoded;
        }
      } catch (e) {
        // If decoding fails, return the encoded version
        return encoded;
      }
    }
    
    return encoded;
  } catch (error) {
    console.warn('[URL Encoding] Error encoding URL:', error);
    // Fallback to original path if encoding fails
    return path;
  }
}

/**
 * Decode a URL path with explicit UTF-8 support
 * This ensures proper decoding of special characters, accents, and international characters
 * 
 * @param {string} encoded - Encoded URL path to decode
 * @returns {string} Decoded URL path with UTF-8 decoding
 */
export function decodeUrlUtf8(encoded) {
  if (!encoded || typeof encoded !== 'string') {
    return '';
  }

  try {
    // decodeURI already uses UTF-8, but we ensure it explicitly
    const decoded = decodeURI(encoded);
    
    // Validate UTF-8 decoding
    // If the decoded string contains replacement characters, there might be an issue
    if (decoded.includes('\uFFFD')) {
      console.warn('[URL Encoding] Detected replacement character in decoded URL, may indicate encoding issue');
    }
    
    return decoded;
  } catch (error) {
    // If decodeURI fails, try decodeURIComponent as fallback
    try {
      return decodeURIComponent(encoded);
    } catch (e) {
      console.warn('[URL Encoding] Error decoding URL:', error);
      // If both fail, try manual decoding with TextDecoder
      try {
        // Extract percent-encoded bytes
        const bytes = [];
        for (let i = 0; i < encoded.length; i++) {
          if (encoded[i] === '%' && i + 2 < encoded.length) {
            const hex = encoded.substring(i + 1, i + 3);
            bytes.push(parseInt(hex, 16));
            i += 2;
          } else {
            bytes.push(encoded.charCodeAt(i));
          }
        }
        const decoder = new TextDecoder('utf-8');
        return decoder.decode(new Uint8Array(bytes));
      } catch (manualError) {
        console.warn('[URL Encoding] Manual decoding also failed:', manualError);
        return encoded; // Return original if all decoding fails
      }
    }
  }
}

/**
 * Encode a URL component with explicit UTF-8 support
 * Use this for encoding individual URL components (like path segments)
 * 
 * @param {string} component - URL component to encode
 * @returns {string} Encoded URL component with UTF-8 encoding
 */
export function encodeUrlComponentUtf8(component) {
  if (!component || typeof component !== 'string') {
    return '';
  }

  try {
    // encodeURIComponent already uses UTF-8, but we ensure it explicitly
    return encodeURIComponent(component);
  } catch (error) {
    console.warn('[URL Encoding] Error encoding URL component:', error);
    // Fallback: use TextEncoder for explicit UTF-8 encoding
    try {
      const encoder = new TextEncoder();
      const bytes = encoder.encode(component);
      let percentEncoded = '';
      for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i];
        // encodeURIComponent encoding rules (more aggressive than encodeURI)
        if ((byte >= 0x41 && byte <= 0x5A) || // A-Z
            (byte >= 0x61 && byte <= 0x7A) || // a-z
            (byte >= 0x30 && byte <= 0x39) || // 0-9
            byte === 0x2D || // -
            byte === 0x2E || // .
            byte === 0x5F || // _
            byte === 0x7E) { // ~
          percentEncoded += String.fromCharCode(byte);
        } else {
          percentEncoded += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
        }
      }
      return percentEncoded;
    } catch (fallbackError) {
      return component; // Return original if encoding fails
    }
  }
}

/**
 * Decode a URL component with explicit UTF-8 support
 * Use this for decoding individual URL components (like path segments)
 * 
 * @param {string} encoded - Encoded URL component to decode
 * @returns {string} Decoded URL component with UTF-8 decoding
 */
export function decodeUrlComponentUtf8(encoded) {
  if (!encoded || typeof encoded !== 'string') {
    return '';
  }

  try {
    // decodeURIComponent already uses UTF-8, but we ensure it explicitly
    const decoded = decodeURIComponent(encoded);
    
    // Validate UTF-8 decoding
    if (decoded.includes('\uFFFD')) {
      console.warn('[URL Encoding] Detected replacement character in decoded URL component, may indicate encoding issue');
    }
    
    return decoded;
  } catch (error) {
    console.warn('[URL Encoding] Error decoding URL component:', error);
    // Try manual decoding with TextDecoder
    try {
      const bytes = [];
      for (let i = 0; i < encoded.length; i++) {
        if (encoded[i] === '%' && i + 2 < encoded.length) {
          const hex = encoded.substring(i + 1, i + 3);
          bytes.push(parseInt(hex, 16));
          i += 2;
        } else {
          bytes.push(encoded.charCodeAt(i));
        }
      }
      const decoder = new TextDecoder('utf-8');
      return decoder.decode(new Uint8Array(bytes));
    } catch (manualError) {
      console.warn('[URL Encoding] Manual decoding also failed:', manualError);
      return encoded; // Return original if all decoding fails
    }
  }
}

/**
 * Create a URL with explicit UTF-8 encoding support
 * Equivalent to new URL() but with guaranteed UTF-8 encoding
 * 
 * @param {string} path - URL path (relative or absolute)
 * @param {string} base - Base URL (defaults to window.location.origin if available)
 * @returns {string} Full URL string with UTF-8 encoding
 */
export function createUrlUtf8(path, base = null) {
  if (!path || typeof path !== 'string') {
    return '';
  }

  try {
    // Determine base URL
    let baseUrl = base;
    if (!baseUrl && typeof window !== 'undefined' && window.location) {
      baseUrl = window.location.origin;
    }
    if (!baseUrl) {
      baseUrl = 'http://localhost'; // Fallback
    }

    // Ensure path is properly encoded
    // If path already starts with http:// or https://, use it directly
    if (path.startsWith('http://') || path.startsWith('https://')) {
      try {
        const url = new URL(path);
        // Re-encode pathname to ensure UTF-8
        const encodedPath = encodeUrlUtf8(url.pathname);
        return `${url.protocol}//${url.host}${encodedPath}${url.search}${url.hash}`;
      } catch (e) {
        return path; // Return original if URL parsing fails
      }
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
      const url = new URL(encodedPath, baseUrl);
      return url.toString();
    } catch (e) {
      // If URL constructor fails, manually construct the URL
      // Ensure base doesn't have trailing slash
      const cleanBase = baseUrl.replace(/\/+$/, '');
      return `${cleanBase}${encodedPath}`;
    }
  } catch (error) {
    console.warn('[URL Encoding] Error creating URL:', error);
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
 * Decode multiple levels of URL encoding (handles double/triple encoding)
 * Useful when dealing with paths that may have been encoded multiple times
 * 
 * @param {string} encoded - Potentially multiply-encoded string
 * @param {number} maxIterations - Maximum number of decoding iterations (default: 3)
 * @returns {string} Fully decoded string
 */
export function decodeUrlUtf8Multiple(encoded, maxIterations = 3) {
  if (!encoded || typeof encoded !== 'string') {
    return '';
  }

  let decoded = encoded;
  let previousDecoded = '';
  let iterations = 0;

  while (iterations < maxIterations && decoded.includes('%')) {
    previousDecoded = decoded;
    try {
      decoded = decodeUrlComponentUtf8(decoded);
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

