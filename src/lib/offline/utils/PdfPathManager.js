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
   * Verdade de hoje, não aspiração: a extração de pacote ZIP em
   * `src/lib/stores/offline.js` (`:981`, `:2002`) ainda escreve no cache PDF
   * chamando `createUrlUtf8` direto, sobre um caminho normalizado por
   * `normalizeZipEntryName` — uma duplicata de `normalizeForStorage` que hoje
   * concorda com ela byte a byte, mas não é a mesma função. Unificar esse
   * quarto caminho de escrita é trabalho da Tarefa 6, não desta.
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
 * Conta como cada PDF foi encontrado, em **todos** os pontos de saída que
 * existem hoje — tanto no `handlePdf` do Service Worker quanto no `getPdf`
 * de `CacheStorageAdapter`, que tem duas camadas de estratégia difusa e um
 * atalho de memoização que os outros dois pontos não têm:
 *
 * - `direto`      — bateu na chave canônica, de primeira, sem precisar de
 *                    nenhuma estratégia difusa.
 * - `variacao`     — bateu em alguma das variações de `createSearchVariations`
 *                    (a primeira camada difusa), mas não na canônica.
 * - `variacaoFallback` — só existe em `CacheStorageAdapter`: bateu na
 *                    *segunda* camada de variações (`fallbackVariations`),
 *                    que inclui correspondência só por nome de arquivo — a
 *                    estratégia mais arriscada de todas, porque dois louvores
 *                    diferentes podem ter o mesmo nome de arquivo.
 * - `reaproveitado` — só existe em `CacheStorageAdapter`: o atalho de
 *                    `_variationCache` (TTL) devolveu uma URL já conhecida de
 *                    uma consulta anterior, sem repetir a busca. Não é
 *                    `direto` nem `variacao` porque a consulta original que
 *                    populou esse atalho pode ter sido qualquer uma das
 *                    quatro categorias — contá-lo como `direto` esconderia
 *                    reaproveitamento de um acerto que só existiu graças a
 *                    uma estratégia difusa (o mesmo falso zero do Achado 1,
 *                    só que em escala menor).
 * - `miss`         — não encontrado por nenhuma estratégia.
 *
 * O que autoriza a Tarefa 9 a apagar as estratégias difusas é `variacao`,
 * `variacaoFallback` **e** `reaproveitado` estarem em zero ao mesmo tempo —
 * um `reaproveitado` maior que zero, mesmo com os outros dois zerados, ainda
 * pode estar escondendo dependência de um acerto difuso antigo dentro do TTL
 * de memoização.
 *
 * A Tarefa 9 apaga este bloco inteiro.
 */
export const pdfMatchStats = {
  direto: 0,
  variacao: 0,
  variacaoFallback: 0,
  reaproveitado: 0,
  miss: 0
};

/** Categorias cujo acerto depende, direta ou indiretamente, de alguma estratégia difusa. */
const CATEGORIAS_DIFUSAS = new Set(['variacao', 'variacaoFallback', 'reaproveitado']);

/** @param {'direto' | 'variacao' | 'variacaoFallback' | 'reaproveitado' | 'miss'} tipo */
export function registrarAcertoPdf(tipo, detalhe = '') {
  if (tipo in pdfMatchStats) pdfMatchStats[tipo] += 1;
  if (CATEGORIAS_DIFUSAS.has(tipo)) {
    console.warn(`[F1] acerto por ${tipo}:`, detalhe);
  }
  const escopo = typeof self !== 'undefined' ? self : globalThis;
  escopo.__plpcPdfMatchStats = pdfMatchStats;
}

export default PdfPathManager;

