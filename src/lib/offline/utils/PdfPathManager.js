/**
 * PDF Path Manager
 * Single source of truth for PDF path normalization
 * Preserves original encoding (case and accents) to ensure compatibility
 * between saving and retrieving PDFs from cache
 */

// Caminho relativo, não `$lib`: este módulo precisa carregar sob `node --test`,
// e o alias `$lib` só existe dentro do Vite. De src/lib/offline/utils/ para
// src/lib/utils/ são dois níveis acima.
import { decodeUrlUtf8Multiple, createUrlUtf8 } from '../../utils/urlEncoding.js';

/**
 * PDF Path Manager
 * Provides unified path normalization that preserves case and accents
 */
class PdfPathManager {
  /**
   * Normalize PDF path for storage
   * Preserves case and accents, only cleans format
   * 
   * @param {string} pdfPath - PDF path to normalize
   * @returns {string} Normalized path in format 'assets/...' (without leading slash)
   */
  static normalizeForStorage(pdfPath) {
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
   * Create Request URL from PDF path
   * Creates full URL using UTF-8 encoding for Request object
   * 
   * @param {string} pdfPath - PDF path (will be normalized)
   * @param {string} origin - Base origin URL (defaults to window.location.origin)
   * @returns {string} Full URL string with UTF-8 encoding
   */
  static createRequestUrl(pdfPath, origin = null) {
    if (!pdfPath || typeof pdfPath !== 'string') {
      return '';
    }

    // Normalize path first
    const normalizedPath = this.normalizeForStorage(pdfPath);
    if (!normalizedPath) {
      return '';
    }

    // Determine origin
    let baseOrigin = origin;
    if (!baseOrigin && typeof window !== 'undefined' && window.location) {
      baseOrigin = window.location.origin;
    }
    if (!baseOrigin) {
      baseOrigin = 'http://localhost'; // Fallback
    }

    // Create URL with UTF-8 encoding
    return createUrlUtf8(`/${normalizedPath}`, baseOrigin);
  }

  /**
   * Create search variations for PDF path
   * Generates multiple URL variations for fallback search
   * 
   * @param {string} pdfPath - PDF path (will be normalized)
   * @param {string} origin - Base origin URL (defaults to window.location.origin)
   * @returns {string[]} Array of URL variations to try
   */
  static createSearchVariations(pdfPath, origin = null) {
    if (!pdfPath || typeof pdfPath !== 'string') {
      return [];
    }

    // Normalize path first
    const normalizedPath = this.normalizeForStorage(pdfPath);
    if (!normalizedPath) {
      return [];
    }

    // Determine origin
    let baseOrigin = origin;
    if (!baseOrigin && typeof window !== 'undefined' && window.location) {
      baseOrigin = window.location.origin;
    }
    if (!baseOrigin) {
      baseOrigin = 'http://localhost'; // Fallback
    }

    // Generate variations
    const variations = [
      // Primary: normalized path with UTF-8 encoding
      createUrlUtf8(`/${normalizedPath}`, baseOrigin),
      // With leading slash and UTF-8 encoding
      createUrlUtf8(`/${normalizedPath}`, baseOrigin),
      // Explicit UTF-8 encoding
      createUrlUtf8(encodeURI(`/${normalizedPath}`), baseOrigin),
      // Fallback: without encoding (for compatibility)
      normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`,
      normalizedPath
    ];

    // Remove duplicates
    return [...new Set(variations.filter(Boolean))];
  }
}

/**
 * Instrumentação temporária da Fase 1 (#22.1).
 *
 * Conta como cada PDF foi encontrado no cache: pela chave canônica (`direto`),
 * por alguma das variações difusas de `createSearchVariations` (`variacao`), ou
 * não encontrado (`miss`). Depois desta tarefa, `variacao` tem de ficar em zero
 * — é esse zero que autoriza a remoção das estratégias na Tarefa 9.
 *
 * A Tarefa 9 apaga este bloco inteiro.
 */
export const pdfMatchStats = { direto: 0, variacao: 0, miss: 0 };

/** @param {'direto' | 'variacao' | 'miss'} tipo */
export function registrarAcertoPdf(tipo, detalhe = '') {
  if (tipo in pdfMatchStats) pdfMatchStats[tipo] += 1;
  if (tipo === 'variacao') {
    console.warn('[F1] acerto por variação:', detalhe);
  }
  const escopo = typeof self !== 'undefined' ? self : globalThis;
  escopo.__plpcPdfMatchStats = pdfMatchStats;
}

export default PdfPathManager;

