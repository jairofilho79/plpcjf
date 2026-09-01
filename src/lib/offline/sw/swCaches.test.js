/**
 * Testes dos nomes de cache do Service Worker.
 *
 * Dois invariantes valem dinheiro aqui:
 * 1. `plpc-pdfs` (PDFs baixados) e `plpc-catalog` (acervo importado) jamais
 *    podem ser apagados pelo `activate`, nem na primeira ativação após a
 *    migração de `plpc-v5-app` para `plpc-<version>-app`;
 * 2. a poda permite por forma conhecida em vez de negar por lista: um cache
 *    `plpc-*` novo, que ninguém lembrou de proteger, sobrevive por padrão.
 *
 * Run: node --test src/lib/offline/sw/swCaches.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  appCacheName,
  isObsoleteCacheName,
  isRecoverableShellCacheName,
  migrateCatalogManifests,
  CATALOG_CACHE_NAME,
  CATALOG_MANIFEST_PATHS,
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

  it('nunca apaga o catálogo importado', () => {
    assert.equal(isObsoleteCacheName(CATALOG_CACHE_NAME, current), false);
    assert.equal(isObsoleteCacheName(CATALOG_CACHE_NAME, ''), false);
    assert.equal(isObsoleteCacheName(CATALOG_CACHE_NAME, undefined), false);
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

  it('permite por forma conhecida: um plpc-* futuro sobrevive por padrão', () => {
    // Este é o invariante que impede o próximo "cache novo = perda de dados
    // no próximo deploy". Nada disso casa com uma forma descartável.
    assert.equal(isObsoleteCacheName('plpc-something-new', current), false);
    assert.equal(isObsoleteCacheName('plpc-playlists', current), false);
    assert.equal(isObsoleteCacheName('plpc-anotacoes-do-usuario', current), false);
    assert.equal(isObsoleteCacheName('plpc-app', current), false);
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
    assert.equal(isRecoverableShellCacheName(CATALOG_CACHE_NAME), false);
  });

  it('não inclui nomes fora do padrão', () => {
    assert.equal(isRecoverableShellCacheName('plpc-alguma-coisa'), false);
    assert.equal(isRecoverableShellCacheName('app'), false);
  });
});

// ---------------------------------------------------------------------------
// CacheStorage falso, em memória — o mesmo padrão do teste de rollback do
// importador. Só o que `migrateCatalogManifests` usa: keys/open/match/put.
// ---------------------------------------------------------------------------

const ORIGIN = 'https://plpcg.com';

/** @param {string} path */
function fakeRequest(path) {
  return { url: `${ORIGIN}${path}` };
}

class FakeCache {
  constructor() {
    /** @type {Map<string, { request: any, response: any }>} */
    this.entries = new Map();
  }
  async keys() {
    return [...this.entries.values()].map((e) => e.request);
  }
  /** @param {{ url: string }} request */
  async match(request) {
    const entry = this.entries.get(request.url);
    return entry ? entry.response : undefined;
  }
  /** @param {{ url: string }} request @param {any} response */
  async put(request, response) {
    this.entries.set(request.url, { request, response });
  }
  /** @param {{ url: string }} request */
  async delete(request) {
    return this.entries.delete(request.url);
  }
}

class FakeCacheStorage {
  /** @param {Record<string, Record<string, unknown>>} [seed] */
  constructor(seed = {}) {
    /** @type {Map<string, FakeCache>} */
    this.caches = new Map();
    for (const [name, paths] of Object.entries(seed)) {
      const cache = new FakeCache();
      for (const [path, body] of Object.entries(paths)) {
        cache.entries.set(`${ORIGIN}${path}`, {
          request: fakeRequest(path),
          response: { body }
        });
      }
      this.caches.set(name, cache);
    }
  }
  async keys() {
    return [...this.caches.keys()];
  }
  /** @param {string} name @returns {Promise<FakeCache>} */
  async open(name) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
    // set() acima garante a entrada: sempre um FakeCache, nunca undefined.
    return /** @type {FakeCache} */ (this.caches.get(name));
  }
  /** @param {string} name */
  async delete(name) {
    return this.caches.delete(name);
  }
  /** @param {string} cacheName @param {string} path */
  bodyAt(cacheName, path) {
    const cache = this.caches.get(cacheName);
    if (!cache) return undefined;
    const entry = cache.entries.get(`${ORIGIN}${path}`);
    return entry ? entry.response.body : undefined;
  }
}

const [LOUVORES_PATH, OFFLINE_PATH] = CATALOG_MANIFEST_PATHS;

describe('migrateCatalogManifests', () => {
  it('resgata o catálogo importado do cache de app antigo antes da poda', async () => {
    const storage = new FakeCacheStorage({
      'plpc-v5-app': {
        '/': 'shell antigo',
        [LOUVORES_PATH]: 'catálogo importado',
        [OFFLINE_PATH]: 'offline importado'
      },
      'plpc-pdfs': { '/assets/ColAdultos/001.pdf': 'PDF do usuário' },
      'plpc-1735689600000-app': { '/': 'shell novo' }
    });

    const migrated = await migrateCatalogManifests(/** @type {any} */ (storage));
    assert.equal(migrated, 2);

    assert.equal(storage.bodyAt(CATALOG_CACHE_NAME, LOUVORES_PATH), 'catálogo importado');
    assert.equal(storage.bodyAt(CATALOG_CACHE_NAME, OFFLINE_PATH), 'offline importado');
  });

  it('o catálogo e os PDFs sobrevivem ao activate completo (migrar, depois podar)', async () => {
    const storage = new FakeCacheStorage({
      'plpc-v5-app': {
        '/': 'shell antigo',
        [LOUVORES_PATH]: 'catálogo importado',
        [OFFLINE_PATH]: 'offline importado'
      },
      'plpc-v5-pdfjs': { '/pdfjs/web/pdf_viewer.css': 'css legado' },
      'plpc-pdfs': { '/assets/ColAdultos/001.pdf': 'PDF do usuário' },
      'plpc-pdfs-import-staging': { '/assets/ColAdultos/002.pdf': 'PDF em staging' },
      'plpc-1735689600000-app': { '/': 'shell novo' }
    });
    const current = appCacheName('1735689600000');

    // Exatamente a ordem do handler `activate`: migrar, e só então podar.
    await migrateCatalogManifests(/** @type {any} */ (storage));
    const names = await storage.keys();
    await Promise.all(
      names.filter((n) => isObsoleteCacheName(n, current)).map((n) => storage.delete(n))
    );

    const remaining = await storage.keys();
    assert.deepEqual(
      remaining.sort(),
      ['plpc-1735689600000-app', CATALOG_CACHE_NAME, 'plpc-pdfs', 'plpc-pdfs-import-staging'].sort()
    );

    // O acervo importado sobreviveu, sob o nome novo…
    assert.equal(storage.bodyAt(CATALOG_CACHE_NAME, LOUVORES_PATH), 'catálogo importado');
    assert.equal(storage.bodyAt(CATALOG_CACHE_NAME, OFFLINE_PATH), 'offline importado');
    // …e os PDFs não foram tocados.
    assert.equal(storage.bodyAt('plpc-pdfs', '/assets/ColAdultos/001.pdf'), 'PDF do usuário');
    assert.equal(
      storage.bodyAt('plpc-pdfs-import-staging', '/assets/ColAdultos/002.pdf'),
      'PDF em staging'
    );
  });

  it('é idempotente e nunca sobrescreve o que já está no cache protegido', async () => {
    const storage = new FakeCacheStorage({
      'plpc-v5-app': { [LOUVORES_PATH]: 'versão velha do app cache' },
      [CATALOG_CACHE_NAME]: { [LOUVORES_PATH]: 'versão boa já migrada' }
    });

    assert.equal(await migrateCatalogManifests(/** @type {any} */ (storage)), 0);
    assert.equal(storage.bodyAt(CATALOG_CACHE_NAME, LOUVORES_PATH), 'versão boa já migrada');

    // Uma segunda passada continua sem efeito.
    assert.equal(await migrateCatalogManifests(/** @type {any} */ (storage)), 0);
    assert.equal(storage.bodyAt(CATALOG_CACHE_NAME, LOUVORES_PATH), 'versão boa já migrada');
  });

  it('não copia nada que não seja o catálogo', async () => {
    const storage = new FakeCacheStorage({
      'plpc-v5-app': {
        '/': 'shell',
        '/manifest.json': 'webmanifest',
        '/_app/immutable/entry/start.abc.js': 'chunk'
      }
    });

    assert.equal(await migrateCatalogManifests(/** @type {any} */ (storage)), 0);
    const catalog = await storage.open(CATALOG_CACHE_NAME);
    assert.equal((await catalog.keys()).length, 0);
  });

  it('não faz nada quando não existe nenhum cache de app', async () => {
    const storage = new FakeCacheStorage({
      'plpc-pdfs': { '/assets/ColAdultos/001.pdf': 'PDF do usuário' }
    });

    assert.equal(await migrateCatalogManifests(/** @type {any} */ (storage)), 0);
    assert.deepEqual(await storage.keys(), ['plpc-pdfs']);
  });
});
