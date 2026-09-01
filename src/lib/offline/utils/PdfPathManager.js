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

      // #22.2: unifica a forma Unicode DEPOIS de decodificar — um acento pode
      // chegar como um code point (NFC) ou dois (NFD), e o `cache.match` trata
      // as duas formas como chaves diferentes. Oito caminhos do acervo chegam
      // em NFD. Alinha o cliente com normalizeR2Key, que já passa por NFD.
      normalized = normalized.normalize('NFC');

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
      let fallback = pdfPath.normalize('NFC').replace(/^\/+/, '').replace(/\\/g, '/');
      const lowerFallback = fallback.toLowerCase();
      if (!lowerFallback.startsWith('assets/')) {
        fallback = `assets/${fallback}`;
      }
      return fallback.replace(/^\/+/, '');
    }
  }

  /**
   * #22.1 — o construtor canônico de URL de PDF do cliente.
   *
   * `createRequestUrl` é a **única** função que o leitor, o Service Worker
   * (gravação em `handlePdf`) e os validadores/downloaders devem chamar para
   * transformar um caminho de PDF em URL. Ela normaliza com
   * `normalizeForStorage` (preserva caixa e acento) e codifica com
   * `createUrlUtf8` (equivalente a `encodeURI`, ponto fixo do parser `URL`
   * sobre os 4629 caminhos reais do acervo — ver
   * `PdfPathManager.encoder.test.js`). Nenhum outro código deve montar essa
   * URL de outro jeito: uma segunda forma de codificar é exatamente o defeito
   * que esta função fecha.
   *
   * #22.2 (Tarefa 6) fechou o quarto caminho de escrita que este parágrafo
   * descrevia como pendente: a extração de pacote ZIP em
   * `src/lib/stores/offline.js` agora chama `createRequestUrl` (não mais
   * `createUrlUtf8` direto) sobre um `preparedPath` que já passou por
   * `normalizeForStorage` — chamado direto desde a Tarefa 9, que apagou o
   * invólucro que só acrescentava a barra inicial. `createRequestUrl` é, de
   * fato, o único construtor de URL de PDF do cliente.
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
}

export default PdfPathManager;

