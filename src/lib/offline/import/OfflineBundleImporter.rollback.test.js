/**
 * Lightweight commit/rollback semantics check for staging cache names.
 * Run: node --test src/lib/offline/import/OfflineBundleImporter.rollback.test.js
 *
 * Uses an in-memory fake Cache Storage (no browser).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function createMemoryCaches() {
  /** @type {Map<string, Map<string, Response>>} */
  const stores = new Map();

  return {
    /** @param {string} name */
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      // set() acima garante a entrada: sempre um Map, nunca undefined.
      const store = /** @type {Map<string, Response>} */ (stores.get(name));
      return {
        /** @param {string | { url: string }} request @param {Response} response */
        async put(request, response) {
          const key = typeof request === 'string' ? request : request.url;
          store.set(key, response);
        },
        /** @param {string | { url: string }} request */
        async match(request) {
          const key = typeof request === 'string' ? request : request.url;
          return store.get(key) || undefined;
        },
        async keys() {
          return [...store.keys()].map((url) => ({ url }));
        }
      };
    },
    /** @param {string} name */
    async delete(name) {
      return stores.delete(name);
    },
    /** @param {string} name */
    _dump(name) {
      return stores.get(name);
    }
  };
}

/**
 * Mirror of OfflineBundleImporter._commitStaging / discard
 * @param {ReturnType<typeof createMemoryCaches>} caches
 * @param {string} stagingName
 * @param {string} mainName
 */
async function commitStaging(caches, stagingName, mainName) {
  const staging = await caches.open(stagingName);
  const main = await caches.open(mainName);
  const keys = await staging.keys();
  for (const request of keys) {
    const response = await staging.match(request);
    if (response) await main.put(request, response);
  }
  await caches.delete(stagingName);
}

describe('staging commit/rollback', () => {
  const STAGING = 'plpc-pdfs-import-staging';
  const MAIN = 'plpc-pdfs';
  /** @type {ReturnType<typeof createMemoryCaches>} */
  let caches;

  beforeEach(() => {
    caches = createMemoryCaches();
  });

  it('rollback leaves main untouched when staging is discarded', async () => {
    const main = await caches.open(MAIN);
    await main.put('https://x/assets/a.pdf', new Response('OLD'));

    const staging = await caches.open(STAGING);
    await staging.put('https://x/assets/a.pdf', new Response('NEW'));
    await staging.put('https://x/assets/b.pdf', new Response('B'));

    await caches.delete(STAGING);

    assert.equal(await (/** @type {Response} */ (await main.match('https://x/assets/a.pdf'))).text(), 'OLD');
    assert.equal(caches._dump(STAGING), undefined);
  });

  it('commit overwrites main from staging then deletes staging', async () => {
    const main = await caches.open(MAIN);
    await main.put('https://x/assets/a.pdf', new Response('OLD'));

    const staging = await caches.open(STAGING);
    await staging.put('https://x/assets/a.pdf', new Response('NEW'));
    await staging.put('https://x/assets/b.pdf', new Response('B'));

    await commitStaging(caches, STAGING, MAIN);

    assert.equal(await (/** @type {Response} */ (await main.match('https://x/assets/a.pdf'))).text(), 'NEW');
    assert.equal(await (/** @type {Response} */ (await main.match('https://x/assets/b.pdf'))).text(), 'B');
    assert.equal(caches._dump(STAGING), undefined);
  });
});
