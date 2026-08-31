/**
 * Roteamento do fetch handler do Service Worker.
 *
 * Só importa `swCaches.js`, que também não importa nada: é carregado pelo worker
 * (via Vite) e roda direto no `node --test`. A ordem das regras é significativa
 * e é a única definição dela no projeto: a primeira que casar vence.
 */

import { CATALOG_MANIFEST_PATHS } from './swCaches.js';

export const SW_APP_SHELL_PATHS = [
  '/',
  '/manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png'
];

/**
 * @param {string} pathname
 * @param {{ isNavigation?: boolean }} [ctx]
 * @returns {'navigation'|'pdfjs'|'pdf'|'checksum'|'package-zip'|'hashed-asset'|'catalog'|'app-shell'|'default'}
 */
export function matchSwRoute(pathname, ctx) {
  if (ctx && ctx.isNavigation) return 'navigation';

  if (pathname.indexOf('/pdfjs/') !== -1) return 'pdfjs';

  if (
    pathname.endsWith('.pdf') &&
    pathname.indexOf('/_app/') === -1 &&
    pathname.indexOf('/node_modules/') === -1
  ) {
    return 'pdf';
  }

  if (pathname === '/louvores-manifest.sha256') return 'checksum';

  if (pathname.startsWith('/packages/') && pathname.endsWith('.zip')) return 'package-zip';

  if (
    pathname.startsWith('/_app/immutable/') ||
    pathname === '/_app/version.json' ||
    pathname === '/_app/env.js'
  ) {
    return 'hashed-asset';
  }

  // Catálogo: sai do cache do app (que morre a cada deploy) para o cache
  // protegido `plpc-catalog`, porque pode ser a única cópia no dispositivo.
  if (CATALOG_MANIFEST_PATHS.indexOf(pathname) !== -1) return 'catalog';

  // Igualdade exata. Usar startsWith aqui fazia '/' casar com tudo (defeito #01).
  if (SW_APP_SHELL_PATHS.indexOf(pathname) !== -1) return 'app-shell';

  return 'default';
}
