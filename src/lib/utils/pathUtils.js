/**
 * Decodifica base64 para UTF-8 corretamente
 * 
 * CRÍTICO: Esta função deve SEMPRE ser usada para decodificar pdfId.
 * NÃO use atob() diretamente, pois atob() decodifica para latin-1, não UTF-8.
 * 
 * A função atob() nativa do JavaScript decodifica base64 para uma string
 * binária usando codificação latin-1, o que quebra caracteres UTF-8 como
 * acentos (á, é, ã, etc.) e caracteres especiais.
 * 
 * Esta implementação:
 * 1. Usa atob() para obter a string binária
 * 2. Converte cada caractere para byte usando charCodeAt()
 * 3. Usa TextDecoder('utf-8') para decodificar corretamente os bytes como UTF-8
 * 
 * @param {string} base64 - String base64 a ser decodificada
 * @returns {string} String decodificada em UTF-8
 * @throws {Error} Se a decodificação falhar
 */
export function atobUTF8(base64) {
  if (!base64 || typeof base64 !== 'string') {
    throw new Error('atobUTF8: base64 must be a non-empty string');
  }
  
  // atob() decodifica para latin-1, não UTF-8
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  // TextDecoder('utf-8') decodifica corretamente os bytes como UTF-8
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(bytes);
}

// Retorna caminho relativo sem barra inicial, ex: "assets/ColAdultos/arquivo.pdf"
// CRÍTICO: Esta função NÃO normaliza o caminho (não converte para minúsculas, não remove acentos)
// O caminho é usado exatamente como está no pdfId decodificado em base64 UTF-8
export function getPdfRelPath(louvor) {
  if (!louvor || !louvor.pdfId) {
    return null;
  }
  
  try {
    // CRÍTICO: Usar atobUTF8 (UTF-8), NÃO atob() (latin-1)
    // pdfId está codificado em base64 UTF-8, não latin-1
    const decoded = atobUTF8(louvor.pdfId);
    // Remove apenas barras iniciais, preservando o resto do caminho original
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
    
    // Verifica se começa com "assets/" (case-sensitive para preservar o caminho original)
    // Mas aceita variações de case para compatibilidade
    const lowerPath = path.toLowerCase();
    if (lowerPath.startsWith('assets/')) {
      // Se já começa com assets/, retorna o path original (preservando case)
      return path;
    }
    
    // Se não começa com assets/, adiciona o prefixo preservando o case original
    return `assets/${path}`;
  } catch (_) {
    return null;
  }
}

/**
 * Normalize accented characters to ASCII equivalents
 * This ensures consistent matching regardless of encoding differences
 * @param {string} str - String to normalize
 * @returns {string} - String with accented characters replaced
 * @private
 */
function normalizeAccents(str) {
  if (!str) return str;
  
  // Map of accented characters to ASCII equivalents
  // This handles common Portuguese characters
  const accentMap = {
    'á': 'a', 'à': 'a', 'ã': 'a', 'â': 'a', 'ä': 'a',
    'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
    'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
    'ó': 'o', 'ò': 'o', 'õ': 'o', 'ô': 'o', 'ö': 'o',
    'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
    'ç': 'c', 'ñ': 'n',
    'Á': 'a', 'À': 'a', 'Ã': 'a', 'Â': 'a', 'Ä': 'a',
    'É': 'e', 'È': 'e', 'Ê': 'e', 'Ë': 'e',
    'Í': 'i', 'Ì': 'i', 'Î': 'i', 'Ï': 'i',
    'Ó': 'o', 'Ò': 'o', 'Õ': 'o', 'Ô': 'o', 'Ö': 'o',
    'Ú': 'u', 'Ù': 'u', 'Û': 'u', 'Ü': 'u',
    'Ç': 'c', 'Ñ': 'n'
  };
  
  return str.replace(/[áàãâäéèêëíìîïóòõôöúùûüçñÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇÑ]/g, (char) => accentMap[char] || char);
}

/**
 * Normalize PDF URL for consistent comparison and caching
 * Centralized function to ensure consistent normalization across all PDF operations
 * 
 * Steps:
 * 1. Remove protocol and domain if present
 * 2. Remove leading/trailing slashes
 * 3. Decode URI encoding (up to 3 times for multiple encodings)
 * 4. Normalize accented characters to ASCII (nível → nivel, Coletânea → Coletanea)
 * 5. Convert to lowercase
 * 6. Normalize path separators (Windows vs Unix)
 * 7. Ensure starts with 'assets/'
 * 8. Return consistent format: 'assets/...' (without initial '/')
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
    
    // Normalize accented characters to ASCII (CRITICAL for Cifra nivel I/II)
    // This ensures "nível" becomes "nivel" consistently
    normalized = normalizeAccents(normalized);
    
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
    // Apply accent normalization in fallback too
    fallback = normalizeAccents(fallback);
    if (!fallback.startsWith('assets/')) {
      fallback = `assets/${fallback}`;
    }
    return fallback.replace(/^\/+/, '');
  }
}

