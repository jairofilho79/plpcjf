// Função helper para decodificar base64 para UTF-8 corretamente
export function atobUTF8(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(bytes);
}

// Retorna caminho relativo sem barra inicial, ex: "assets/ColAdultos/arquivo.pdf"
export function getPdfRelPath(louvor) {
  if (!louvor || !louvor.pdfId) {
    return null;
  }
  
  try {
    const decoded = atobUTF8(louvor.pdfId);
    // normaliza removendo barras iniciais
    let path = decoded.replace(/^\/+/, '').trim();
    
    if (!path) {
      return null;
    }
    
    // Decodifica caracteres URI-encoded se necessário (para evitar dupla codificação)
    try {
      if (path.includes('%')) {
        path = decodeURIComponent(path);
      }
    } catch (_) {
      // Se decodeURIComponent falhar, mantém o path original
    }
    
    // assegura prefixo assets/
    if (path.toLowerCase().startsWith('assets/')) {
      return path;
    }
    
    return `assets/${path}`;
  } catch (_) {
    return null;
  }
}

/**
 * Normalize PDF URL for consistent comparison and caching
 * Centralized function to ensure consistent normalization across all PDF operations
 * 
 * Steps:
 * 1. Remove protocol and domain if present
 * 2. Remove leading/trailing slashes
 * 3. Decode URI encoding (up to 3 times for multiple encodings)
 * 4. Convert to lowercase
 * 5. Normalize path separators (Windows vs Unix)
 * 6. Ensure starts with 'assets/'
 * 7. Return consistent format: 'assets/...' (without initial '/')
 * 
 * @param {string} url - URL or path to normalize
 * @returns {string} - Normalized path in format 'assets/...'
 */
export function normalizePdfUrl(url) {
  if (!url) return '';
  
  try {
    // Remove protocol and domain if present
    let normalized = url.replace(/^https?:\/\/[^/]+/, '');
    
    // Remove leading/trailing slashes
    normalized = normalized.replace(/^\/+/, '').replace(/\/+$/, '');
    
    // Decode URI encoding (handle multiple encodings)
    try {
      // Try decoding up to 3 times to handle double/triple encoding
      for (let i = 0; i < 3; i++) {
        if (normalized.includes('%')) {
          const decoded = decodeURIComponent(normalized);
          if (decoded !== normalized) {
            normalized = decoded;
          } else {
            break;
          }
        } else {
          break;
        }
      }
    } catch {
      // If decoding fails, continue with original
    }
    
    // Normalize to lowercase
    normalized = normalized.toLowerCase();
    
    // Normalize path separators (Windows vs Unix)
    normalized = normalized.replace(/\\/g, '/');
    
    // Ensure starts with 'assets/'
    if (!normalized.startsWith('assets/')) {
      normalized = `assets/${normalized}`;
    }
    
    // Return without leading slash (consistent format: 'assets/...')
    return normalized.replace(/^\/+/, '');
  } catch {
    // Fallback: simple normalization
    let fallback = url.toLowerCase().replace(/^\/+/, '').replace(/\\/g, '/');
    if (!fallback.startsWith('assets/')) {
      fallback = `assets/${fallback}`;
    }
    return fallback.replace(/^\/+/, '');
  }
}

