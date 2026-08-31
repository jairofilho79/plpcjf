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

/** Storage de memória com a mesma interface de window.localStorage. */
function createStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    _dump() { return Object.fromEntries(map); }
  };
}

describe('validationCacheStore', () => {
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
    const removidas = migrateLegacyValidationKeys(legacy);
    assert.equal(removidas, 2);
    assert.equal(legacy.getItem('pdfValidation_a'), null);
    assert.equal(legacy.getItem('outraCoisa'), 'preservar');
    assert.deepEqual(readValidationEntry(legacy, 'a', NOW), { available: true, url: '/a.pdf' });
  });

  it('sobrevive a JSON corrompido no registro', () => {
    storage.setItem(VALIDATION_CACHE_KEY, '{corrompido');
    assert.equal(readValidationEntry(storage, 'a', NOW), null);
    writeValidationEntry(storage, 'a', { available: true, url: '/a.pdf' }, NOW);
    assert.notEqual(readValidationEntry(storage, 'a', NOW), null);
  });
});
