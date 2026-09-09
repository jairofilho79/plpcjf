/**
 * Checksum do louvores-manifest.json: janela de 24 h e backoff.
 * Run: node --test src/lib/utils/louvoresManifestChecksum.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MANIFEST_SYNC_RETRY_DELAYS_MIN,
  clearManifestBodySha256,
  hasLouvoresManifestBaseline,
  isManifestSyncBlocked,
  parseExpectedChecksumFromResponseBody,
  readChecksumLastOkAt,
  readManifestBodySha256,
  readManifestSyncPenalty,
  recordManifestSyncFailure,
  resetManifestSyncPenalty,
  resyncManifestBodySha256WithCatalog,
  sha256HexUtf8,
  shouldFetchExpectedChecksum,
  writeChecksumLastOkAt,
  writeManifestBodySha256
} from './louvoresManifestChecksum.js';
import { criarStorageQueLanca } from '../testing/fakeStorage.js';

/** Storage de memória com a mesma interface de window.localStorage. */
function criarStorage() {
  const mapa = new Map();
  return {
    get length() { return mapa.size; },
    key(i) { return [...mapa.keys()][i] ?? null; },
    getItem(k) { return mapa.has(k) ? mapa.get(k) : null; },
    setItem(k, v) { mapa.set(k, String(v)); },
    removeItem(k) { mapa.delete(k); }
  };
}

describe('louvoresManifestChecksum', () => {
  beforeEach(() => {
    // O módulo lê o `localStorage` global, não um parâmetro injetado.
    globalThis.localStorage = criarStorage();
  });

  afterEach(() => {
    delete globalThis.localStorage;
  });

  it('sha256HexUtf8 bate com o digest conhecido da string vazia', async () => {
    assert.equal(
      await sha256HexUtf8(''),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('parseExpectedChecksumFromResponseBody aceita 64 hex e devolve minúsculo', () => {
    const maiusculo = 'ABCDEF0123456789'.repeat(4);
    assert.equal(parseExpectedChecksumFromResponseBody(`  ${maiusculo}  `), maiusculo.toLowerCase());
    assert.equal(parseExpectedChecksumFromResponseBody('not-hex'), null);
    assert.equal(parseExpectedChecksumFromResponseBody(''), null);
  });

  it('shouldFetchExpectedChecksum exige baseline, estar online e a janela de 24 h', async () => {
    const corpo = '[{"pdfId":"x"}]';
    writeManifestBodySha256(await sha256HexUtf8(corpo));
    const agora = 1_000_000_000_000;

    assert.equal(shouldFetchExpectedChecksum(agora, false), false);
    assert.equal(shouldFetchExpectedChecksum(agora, true), true);

    writeChecksumLastOkAt(agora);
    assert.equal(shouldFetchExpectedChecksum(agora + 1, true), false);
    assert.equal(shouldFetchExpectedChecksum(agora + 24 * 60 * 60 * 1000, true), true);
  });

  it('recordManifestSyncFailure aplica 1–2–4–8–16 min e depois 24 h de espera', () => {
    const t0 = 10_000_000_000_000;
    resetManifestSyncPenalty();

    let t = t0;
    for (let i = 0; i < 4; i++) {
      recordManifestSyncFailure(t);
      const p = readManifestSyncPenalty();
      assert.equal(p.failStreak, i + 1);
      assert.equal(p.cooldownUntil, 0);
      assert.equal(p.nextRetryAt, t + MANIFEST_SYNC_RETRY_DELAYS_MIN[i] * 60_000);
      t = p.nextRetryAt;
    }

    recordManifestSyncFailure(t);
    const final = readManifestSyncPenalty();
    assert.equal(final.failStreak, 0);
    assert.equal(final.nextRetryAt, 0);
    assert.equal(final.cooldownUntil, t + 24 * 60 * 60 * 1000);
  });
});

/** @param {string | null} texto */
function fakeCachesComCatalogo(texto) {
  return {
    async open() {
      return {
        async match(/** @type {string} */ path) {
          if (path !== '/louvores-manifest.json' || texto == null) return undefined;
          return { text: async () => texto };
        }
      };
    }
  };
}

describe('resyncManifestBodySha256WithCatalog', () => {
  beforeEach(() => {
    globalThis.localStorage = criarStorage();
  });

  afterEach(() => {
    delete globalThis.localStorage;
  });

  it('sem hash local, não faz nada (baseline ainda não existe)', async () => {
    await resyncManifestBodySha256WithCatalog({ cachesImpl: fakeCachesComCatalogo('[]') });
    assert.equal(readManifestBodySha256(), null);
  });

  it('hash local já bate com o persistido: não muda nada', async () => {
    const texto = '[{"pdfId":"a"}]';
    writeManifestBodySha256(await sha256HexUtf8(texto));
    await resyncManifestBodySha256WithCatalog({ cachesImpl: fakeCachesComCatalogo(texto) });
    assert.equal(readManifestBodySha256(), await sha256HexUtf8(texto));
  });

  it('hash local mentiroso (bug antigo): corrige para o que está de fato persistido', async () => {
    // O caso real: uma sincronização por checksum antiga avançou o hash local
    // para bater com o que o servidor reportou, mas a escrita no cache
    // protegido falhou por cota — o que sobrou persistido é conteúdo velho.
    const persistido = '[{"pdfId":"velho"}]';
    writeManifestBodySha256('f'.repeat(64)); // hash que o servidor reportou, nunca gravado de fato
    await resyncManifestBodySha256WithCatalog({ cachesImpl: fakeCachesComCatalogo(persistido) });
    assert.equal(readManifestBodySha256(), await sha256HexUtf8(persistido));
  });

  it('nada persistido: limpa o hash local para forçar baseline nova', async () => {
    writeManifestBodySha256('a'.repeat(64));
    await resyncManifestBodySha256WithCatalog({ cachesImpl: fakeCachesComCatalogo(null) });
    assert.equal(readManifestBodySha256(), null);
  });

  it('clearManifestBodySha256 remove o hash', () => {
    writeManifestBodySha256('a'.repeat(64));
    clearManifestBodySha256();
    assert.equal(readManifestBodySha256(), null);
  });

  it('nunca lança: sem Cache API não faz nada', async () => {
    writeManifestBodySha256('a'.repeat(64));
    await resyncManifestBodySha256WithCatalog({ cachesImpl: undefined });
    assert.equal(readManifestBodySha256(), 'a'.repeat(64));
  });

  it('nunca lança: cache que estoura mantém o hash como estava', async () => {
    writeManifestBodySha256('a'.repeat(64));
    const cs = { async open() { throw new Error('boom'); } };
    await resyncManifestBodySha256WithCatalog({ cachesImpl: cs });
    assert.equal(readManifestBodySha256(), 'a'.repeat(64));
  });
});

/**
 * Estas funções rodam dentro de `loadLouvores()`, no mount de `/`, `/listas`,
 * `/biblioteca` e `/offline`. Um throw aqui não fica confinado: a rota não abre.
 * Os dois cenários abaixo são as duas formas reais de storage bloqueado, e a
 * guarda `typeof localStorage === 'undefined'` que existia antes falhava nas
 * duas — na segunda, a própria linha da guarda lançava.
 */
describe('louvoresManifestChecksum com storage bloqueado', () => {
  afterEach(() => {
    delete globalThis.localStorage;
  });

  /** Faz `globalThis.localStorage` ser um getter que lança — Firefox estrito. */
  function instalarGetterQueLanca() {
    delete globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        const e = new Error('storage bloqueado');
        e.name = 'SecurityError';
        throw e;
      }
    });
  }

  /** Toda leitura devolve o mesmo default de storage ausente; nada lança. */
  function verificarDefaults() {
    assert.equal(readChecksumLastOkAt(), null);
    assert.equal(readManifestBodySha256(), null);
    assert.equal(hasLouvoresManifestBaseline(), false);
    assert.deepEqual(readManifestSyncPenalty(), {
      failStreak: 0,
      nextRetryAt: 0,
      cooldownUntil: 0
    });
    assert.equal(shouldFetchExpectedChecksum(1_000, true), false);
    assert.equal(isManifestSyncBlocked(1_000), false);
    // As escritas não lançam nem sinalizam falha ao chamador (contrato do módulo).
    writeChecksumLastOkAt(1_000);
    writeManifestBodySha256('a'.repeat(64));
    recordManifestSyncFailure(1_000);
    resetManifestSyncPenalty();
  }

  it('objeto presente cujos membros lançam: devolve os defaults, não lança', () => {
    globalThis.localStorage = criarStorageQueLanca();
    verificarDefaults();
  });

  it('getter global que lança (Firefox estrito): devolve os defaults, não lança', () => {
    instalarGetterQueLanca();
    verificarDefaults();
  });
});
