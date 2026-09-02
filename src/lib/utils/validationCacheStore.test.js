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

  it('migra por lotes: grava mais do que uma vez, e cada gravação já encontra menos chaves antigas', () => {
    // Contar 450 migradas no fim NÃO prova lotagem nenhuma: uma passagem única
    // também migra 450. E a lotagem é o coração desta correção, porque o
    // defeito nunca foi "não migra", foi o PICO de ocupação — gravar o registo
    // consolidado inteiro com as chaves antigas todas ainda presentes, que é
    // precisamente o que não cabe no aparelho no teto de ~5 MB.
    //
    // O que se observa aqui é essa propriedade e não o resultado: quantas
    // chaves antigas ainda estavam no storage no momento de cada gravação. Com
    // lotes, a segunda gravação já encontra menos do que a primeira — ou seja,
    // o apagamento do lote anterior libertou espaço antes dela. Voltar à
    // passagem única, ou pôr o lote maior do que o acervo, faz este teste
    // falhar em vez de passar em silêncio.
    const TOTAL = 450;
    /** @type {Record<string, string>} */
    const inicial = {};
    for (let i = 0; i < TOTAL; i++) {
      inicial[`pdfValidation_k${i}`] = JSON.stringify({
        available: true,
        url: `/k${i}.pdf`,
        timestamp: NOW
      });
    }
    const legacy = createStorage(inicial);

    /** Chaves antigas ainda presentes no instante de cada gravação do registo. */
    /** @type {number[]} */
    const antigasPorGravacao = [];
    const originalSetItem = legacy.setItem.bind(legacy);
    /** @param {string} key @param {string} value */
    legacy.setItem = (key, value) => {
      if (key === VALIDATION_CACHE_KEY) {
        antigasPorGravacao.push(
          Object.keys(legacy._dump()).filter((/** @type {string} */ k) =>
            k.startsWith('pdfValidation_')
          ).length
        );
      }
      originalSetItem(key, value);
    };

    const { removidas, restantes } = migrateLegacyValidationKeys(legacy);

    assert.ok(
      antigasPorGravacao.length > 1,
      `passagem única: houve ${antigasPorGravacao.length} gravação do registo, logo o pico ` +
        'de ocupação continua a ser o total — é este o defeito que a lotagem corrige'
    );
    assert.equal(
      antigasPorGravacao[0],
      TOTAL,
      'a primeira gravação ainda vê todas as chaves antigas: é o pico'
    );
    for (let i = 1; i < antigasPorGravacao.length; i++) {
      assert.ok(
        antigasPorGravacao[i] < antigasPorGravacao[i - 1],
        `a gravação ${i + 1} tinha de encontrar menos chaves antigas do que a ${i}, ` +
          `mas viu ${antigasPorGravacao[i]} contra ${antigasPorGravacao[i - 1]}`
      );
    }

    // E o resultado, que continua a valer.
    assert.equal(removidas, TOTAL);
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
