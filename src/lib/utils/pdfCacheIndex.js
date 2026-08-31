/**
 * Índice de PDFs em cache.
 *
 * Substitui as três cópias da "Estratégia 3" (Array.from(set).some(...) dentro do
 * laço principal) por duas consultas O(1). O Set de nomes de arquivo é um
 * superconjunto estrito daquela estratégia: para caminhos que terminam em nome de
 * arquivo, `a.endsWith(b)` implica basename(a) === basename(b).
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
 * @param {string} path
 * @returns {string}
 */
export function basenameOf(path) {
  if (!path) return '';
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
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
  /** @type {Set<string>} */
  const byBasename = new Set();

  const list = Array.isArray(cachedUrls) ? cachedUrls : [];

  for (const url of list) {
    const path = normalize(toComparablePath(url));
    if (!path) continue;
    byPath.add(path);
    const base = basenameOf(path);
    if (base) byBasename.add(base);
  }

  return {
    size: byPath.size,
    has(candidate) {
      const path = normalize(toComparablePath(candidate));
      if (!path) return false;
      if (byPath.has(path)) return true;
      const base = basenameOf(path);
      return base ? byBasename.has(base) : false;
    }
  };
}
