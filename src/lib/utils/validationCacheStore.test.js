/**
 * Cache de validação em registro único.
 * Run: node --test src/lib/utils/validationCacheStore.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  VALIDATION_CACHE_KEY,
  VALIDATION_CACHE_TTL,
  readValidationEntry,
  writeValidationEntry,
  removeValidationEntry,
  clearValidationCache,
  migrateLegacyValidationKeys
} from './validationCacheStore.js';

/**
 * Storage de memória com a mesma interface de window.localStorage.
 *
 * Devolve `any` de propósito: é um duplo de teste com um `_dump()` a mais, não
 * um `Storage`. Sem a anotação, cada teste que o usa passava a contar erros de
 * `implicitly has an 'any' type` no `svelte-check`.
 *
 * @param {Record<string, string>} [initial]
 * @returns {any}
 */
function createStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    /** @param {number} i */
    key(i) { return [...map.keys()][i] ?? null; },
    /** @param {string} k */
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    /** @param {string} k @param {string} v */
    setItem(k, v) { map.set(k, String(v)); },
    /** @param {string} k */
    removeItem(k) { map.delete(k); },
    _dump() { return Object.fromEntries(map); }
  };
}

describe('validationCacheStore', () => {
  /** @type {any} */
  let storage;
  const NOW = 1_700_000_000_000;

  beforeEach(() => {
    storage = createStorage();
  });

  it('grava e lê uma entrada', () => {
    writeValidationEntry(storage, 'abc', { available: true, url: '/assets/x.pdf' }, NOW);
    assert.deepEqual(readValidationEntry(storage, 'abc', NOW), {
      available: true,
      url: '/assets/x.pdf'
    });
  });

  it('usa uma única chave de storage para muitas entradas', () => {
    writeValidationEntry(storage, 'a', { available: true, url: '/a.pdf' }, NOW);
    writeValidationEntry(storage, 'b', { available: false, url: '/b.pdf' }, NOW);
    writeValidationEntry(storage, 'c', { available: true, url: '/c.pdf' }, NOW);
    assert.deepEqual(Object.keys(storage._dump()), [VALIDATION_CACHE_KEY]);
  });

  it('devolve null para entrada inexistente', () => {
    assert.equal(readValidationEntry(storage, 'nao-existe', NOW), null);
  });

  it('devolve null e descarta entrada expirada', () => {
    writeValidationEntry(storage, 'abc', { available: true, url: '/x.pdf' }, NOW);
    const depois = NOW + VALIDATION_CACHE_TTL + 1;
    assert.equal(readValidationEntry(storage, 'abc', depois), null);
    assert.equal(readValidationEntry(storage, 'abc', NOW), null);
  });

  it('remove uma entrada sem afetar as outras', () => {
    writeValidationEntry(storage, 'a', { available: true, url: '/a.pdf' }, NOW);
    writeValidationEntry(storage, 'b', { available: true, url: '/b.pdf' }, NOW);
    removeValidationEntry(storage, 'a');
    assert.equal(readValidationEntry(storage, 'a', NOW), null);
    assert.notEqual(readValidationEntry(storage, 'b', NOW), null);
  });

  it('limpa tudo', () => {
    writeValidationEntry(storage, 'a', { available: true, url: '/a.pdf' }, NOW);
    clearValidationCache(storage);
    assert.equal(storage.getItem(VALIDATION_CACHE_KEY), null);
  });

  it('migra e apaga as chaves antigas pdfValidation_*', () => {
    const legacy = createStorage({
      'pdfValidation_a': JSON.stringify({ available: true, url: '/a.pdf', timestamp: NOW }),
      'pdfValidation_b': JSON.stringify({ available: false, url: '/b.pdf', timestamp: NOW }),
      'outraCoisa': 'preservar'
    });
    const { removidas, restantes } = migrateLegacyValidationKeys(legacy);
    assert.equal(removidas, 2);
    assert.equal(restantes, 0);
    assert.equal(legacy.getItem('pdfValidation_a'), null);
    assert.equal(legacy.getItem('outraCoisa'), 'preservar');
    assert.deepEqual(readValidationEntry(legacy, 'a', NOW), { available: true, url: '/a.pdf' });
  });

  it('não encontrar chaves antigas conta como migração completa', () => {
    const { removidas, restantes } = migrateLegacyValidationKeys(createStorage({ x: '1' }));
    assert.equal(removidas, 0);
    assert.equal(restantes, 0);
  });

  // O contrato anterior era o oposto — "não apaga as chaves antigas se a
  // gravação final falhar" — e era ele que trancava o aparelho cheio: quem tem
  // milhares de chaves antigas é quem está no teto de ~5 MB, logo é sempre
  // nele que a gravação consolidada estoura, logo era sempre nele que nada era
  // libertado. A troca é deliberada: perder entradas de um cache com TTL de
  // 24 h contra manter megabytes presos para sempre.
  it('apaga as chaves antigas mesmo quando a gravação consolidada estoura a cota', () => {
    const legacy = createStorage({
      'pdfValidation_a': JSON.stringify({ available: true, url: '/a.pdf', timestamp: NOW }),
      'pdfValidation_b': JSON.stringify({ available: false, url: '/b.pdf', timestamp: NOW }),
      'outraCoisa': 'preservar'
    });
    const originalSetItem = legacy.setItem.bind(legacy);
    /** @param {string} key @param {string} value */
    legacy.setItem = (key, value) => {
      if (key === VALIDATION_CACHE_KEY) {
        throw new Error('quota estourada');
      }
      originalSetItem(key, value);
    };

    const { removidas, restantes } = migrateLegacyValidationKeys(legacy);

    assert.equal(removidas, 2, 'o espaço tem de ser libertado mesmo sem gravação');
    assert.equal(restantes, 0);
    assert.equal(legacy.getItem('pdfValidation_a'), null);
    assert.equal(legacy.getItem('pdfValidation_b'), null);
    assert.equal(legacy.getItem('outraCoisa'), 'preservar', 'não é vassoura geral');
  });

  it('uma chave que resiste a ser apagada é contada em restantes, para se tentar de novo', () => {
    const legacy = createStorage({
      'pdfValidation_a': JSON.stringify({ available: true, url: '/a.pdf', timestamp: NOW }),
      'pdfValidation_b': JSON.stringify({ available: true, url: '/b.pdf', timestamp: NOW })
    });
    const originalRemove = legacy.removeItem.bind(legacy);
    /** @param {string} key */
    legacy.removeItem = (key) => {
      if (key === 'pdfValidation_b') throw new Error('removeItem recusado');
      originalRemove(key);
    };

    const { removidas, restantes } = migrateLegacyValidationKeys(legacy);

    assert.equal(removidas, 1);
    assert.equal(restantes, 1, 'restantes > 0 é o sinal de não marcar como feita');
    assert.notEqual(legacy.getItem('pdfValidation_b'), null);
  });

  it('migra por lotes: mais chaves do que o tamanho do lote sai tudo', () => {
    // 450 > 200, portanto três lotes. É o caso do aparelho real (milhares de
    // chaves), e é a passagem por lotes que faz cada apagamento libertar
    // espaço para a gravação seguinte, em vez de um pico único que não cabe.
    /** @type {Record<string, string>} */
    const inicial = {};
    for (let i = 0; i < 450; i++) {
      inicial[`pdfValidation_k${i}`] = JSON.stringify({
        available: true,
        url: `/k${i}.pdf`,
        timestamp: NOW
      });
    }
    const legacy = createStorage(inicial);

    const { removidas, restantes } = migrateLegacyValidationKeys(legacy);

    assert.equal(removidas, 450);
    assert.equal(restantes, 0);
    assert.deepEqual(Object.keys(legacy._dump()), [VALIDATION_CACHE_KEY]);
    assert.deepEqual(readValidationEntry(legacy, 'k0', NOW), { available: true, url: '/k0.pdf' });
    assert.deepEqual(readValidationEntry(legacy, 'k449', NOW), {
      available: true,
      url: '/k449.pdf'
    });
  });

  it('sobrevive a JSON corrompido no registro', () => {
    storage.setItem(VALIDATION_CACHE_KEY, '{corrompido');
    assert.equal(readValidationEntry(storage, 'a', NOW), null);
    writeValidationEntry(storage, 'a', { available: true, url: '/a.pdf' }, NOW);
    assert.notEqual(readValidationEntry(storage, 'a', NOW), null);
  });
});
