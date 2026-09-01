/**
 * Índice de PDFs em cache. Correspondência **exata** de caminho, e só ela.
 *
 * Até #22.3 havia um segundo Set indexado por nome de arquivo: se o caminho não
 * batesse, o índice aceitava qualquer entrada em cache com o mesmo basename.
 * Como 3311 dos 4629 caminhos do acervo partilham nome de arquivo — 1036 se
 * chamam `Cifra I.pdf` —, isso fazia o índice responder "tem" para milhares de
 * louvores que não estavam baixados. Era o falso positivo de maior alcance do
 * sistema, e `stores/offline.js` já o evitava de propósito.
 *
 * Quem precisa casar caixa, acento e forma Unicode passa `options.normalize`
 * (use `PdfPathManager.normalizeForStorage`), que é aplicado aos dois lados.
 *
 * Só importa por caminho relativo — precisa rodar sob `node --test`.
 */

import { decodeUrlUtf8Multiple } from './urlEncoding.js';

/**
 * Converte URL completa ou caminho em uma forma comparável:
 * sem origem, sem barra inicial, com percent-encoding desfeito.
 * @param {string} url
 * @returns {string}
 */
export function toComparablePath(url) {
  if (!url || typeof url !== 'string') return '';

  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    const match = url.match(/https?:\/\/[^/]+(\/.*)/);
    if (match) pathname = match[1];
  }

  pathname = pathname.replace(/^\/+/, '');
  if (!pathname) return '';

  try {
    return decodeUrlUtf8Multiple(pathname, 3);
  } catch {
    return pathname;
  }
}

/**
 * @typedef {{ size: number, has: (candidate: string) => boolean }} PdfCacheIndex
 */

/**
 * @param {string[] | null | undefined} cachedUrls
 * @param {{ normalize?: (path: string) => string }} [options]
 * @returns {PdfCacheIndex}
 */
export function buildPdfCacheIndex(cachedUrls, options = {}) {
  const normalize =
    typeof options.normalize === 'function' ? options.normalize : (/** @type {string} */ p) => p;

  /** @type {Set<string>} */
  const byPath = new Set();

  const list = Array.isArray(cachedUrls) ? cachedUrls : [];

  for (const url of list) {
    const path = normalize(toComparablePath(url));
    if (!path) continue;
    byPath.add(path);
  }

  return {
    size: byPath.size,
    has(candidate) {
      // #22.3: só caminho exato. O fallback por nome de arquivo saiu daqui.
      const path = normalize(toComparablePath(candidate));
      if (!path) return false;
      return byPath.has(path);
    }
  };
}
