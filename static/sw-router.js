/**
 * Roteamento do fetch handler do Service Worker.
 *
 * Script simples, sem ES modules — carregado por importScripts, igual a sw-utils.js.
 * A ordem das regras é significativa e é a única definição dela no projeto:
 * a primeira que casar vence.
 */

const SW_APP_SHELL_PATHS = [
  '/',
  '/manifest.json',
  '/louvores-manifest.json',
  '/offline-manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png'
];

/**
 * @param {string} pathname
 * @param {{ isNavigation?: boolean }} [ctx]
 * @returns {'navigation'|'pdfjs'|'pdf'|'checksum'|'package-zip'|'hashed-asset'|'app-shell'|'default'}
 */
function matchSwRoute(pathname, ctx) {
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

  // Igualdade exata. Usar startsWith aqui fazia '/' casar com tudo (defeito #01).
  if (SW_APP_SHELL_PATHS.indexOf(pathname) !== -1) return 'app-shell';

  return 'default';
}

// Exporta no escopo global do Service Worker (mesmo padrão de sw-utils.js).
if (typeof self !== 'undefined') {
  self.matchSwRoute = matchSwRoute;
  self.SW_APP_SHELL_PATHS = SW_APP_SHELL_PATHS;
}
