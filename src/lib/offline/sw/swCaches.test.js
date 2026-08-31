/**
 * Testes dos nomes de cache do Service Worker.
 * O caso que importa: `plpc-pdfs` guarda os PDFs baixados pelo usuário e
 * jamais pode ser apagado pelo `activate`, nem na primeira ativação após a
 * migração de `plpc-v5-app` para `plpc-<version>-app`.
 *
 * Run: node --test src/lib/offline/sw/swCaches.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  appCacheName,
  isObsoleteCacheName,
  isRecoverableShellCacheName,
  PDF_CACHE_NAME,
  PDF_IMPORT_STAGING_CACHE_NAME
} from './swCaches.js';

describe('appCacheName', () => {
  it('atrela o nome do cache à versão do deploy', () => {
    assert.equal(appCacheName('1735689600000'), 'plpc-1735689600000-app');
    assert.equal(appCacheName('abc.123-def'), 'plpc-abc.123-def-app');
  });
});

describe('isObsoleteCacheName', () => {
  const current = appCacheName('1735689600000');

  it('nunca apaga o cache de PDFs do usuário', () => {
    assert.equal(isObsoleteCacheName(PDF_CACHE_NAME, current), false);
    // Mesmo se o nome do cache atual vier errado ou vazio.
    assert.equal(isObsoleteCacheName(PDF_CACHE_NAME, ''), false);
    assert.equal(isObsoleteCacheName(PDF_CACHE_NAME, undefined), false);
  });

  it('nunca apaga o staging da importação de bundle', () => {
    assert.equal(isObsoleteCacheName(PDF_IMPORT_STAGING_CACHE_NAME, current), false);
  });

  it('apaga o cache do deploy anterior, inclusive o legado plpc-v5', () => {
    assert.equal(isObsoleteCacheName('plpc-v5-app', current), true);
    assert.equal(isObsoleteCacheName('plpc-v5-pdfjs', current), true);
    assert.equal(isObsoleteCacheName(appCacheName('1735603200000'), current), true);
  });

  it('não apaga o cache do deploy atual', () => {
    assert.equal(isObsoleteCacheName(current, current), false);
  });

  it('não toca em caches de terceiros', () => {
    assert.equal(isObsoleteCacheName('workbox-precache', current), false);
    assert.equal(isObsoleteCacheName('outra-app-plpc-pdfs', current), false);
  });

  it('ignora entradas que não são string', () => {
    assert.equal(isObsoleteCacheName(null, current), false);
    assert.equal(isObsoleteCacheName(42, current), false);
  });
});

describe('isRecoverableShellCacheName', () => {
  it('reconhece o shell antigo e o novo', () => {
    assert.equal(isRecoverableShellCacheName('plpc-v5-app'), true);
    assert.equal(isRecoverableShellCacheName('plpc-1735689600000-app'), true);
    assert.equal(isRecoverableShellCacheName('plpc-v5-pdfjs'), true);
  });

  it('nunca inclui os caches protegidos', () => {
    assert.equal(isRecoverableShellCacheName(PDF_CACHE_NAME), false);
    assert.equal(isRecoverableShellCacheName(PDF_IMPORT_STAGING_CACHE_NAME), false);
  });

  it('não inclui nomes fora do padrão', () => {
    assert.equal(isRecoverableShellCacheName('plpc-alguma-coisa'), false);
    assert.equal(isRecoverableShellCacheName('app'), false);
  });
});
