/**
 * Preferências persistidas do leitor de PDF em localStorage.
 * Run: node --test src/lib/pdf-reader/readerPreferences.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  BRIGHTNESS_PRESETS,
  DEFAULT_BRIGHTNESS,
  getBrightness,
  setBrightness,
  getFitMode,
  setFitMode
} from './readerPreferences.js';

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

describe('readerPreferences — brilho', () => {
  beforeEach(() => {
    // O módulo lê `window`/`localStorage` globais, não parâmetros injetados.
    globalThis.window = {};
    globalThis.localStorage = criarStorage();
  });

  afterEach(() => {
    delete globalThis.window;
    delete globalThis.localStorage;
  });

  it('sem window (SSR), devolve o padrão sem tocar em localStorage', () => {
    delete globalThis.window;
    assert.equal(getBrightness(), DEFAULT_BRIGHTNESS);
  });

  it('sem valor salvo, devolve o padrão (100)', () => {
    assert.equal(getBrightness(), 100);
    assert.equal(DEFAULT_BRIGHTNESS, 100);
  });

  it('grava e lê uma predefinição válida', () => {
    setBrightness(60);
    assert.equal(getBrightness(), 60);
  });

  it('persiste na chave pdfReaderBrightness', () => {
    setBrightness(130);
    assert.equal(localStorage.getItem('pdfReaderBrightness'), '130');
  });

  it('ignora valor salvo fora das predefinições e cai no padrão', () => {
    localStorage.setItem('pdfReaderBrightness', '999');
    assert.equal(getBrightness(), DEFAULT_BRIGHTNESS);
  });

  it('ignora lixo não numérico salvo e cai no padrão', () => {
    localStorage.setItem('pdfReaderBrightness', 'abacate');
    assert.equal(getBrightness(), DEFAULT_BRIGHTNESS);
  });

  it('expõe as três predefinições esperadas, na ordem do ciclo', () => {
    assert.deepEqual(BRIGHTNESS_PRESETS, [100, 60, 130]);
  });

  it('setBrightness sem window (SSR) não lança', () => {
    delete globalThis.window;
    assert.doesNotThrow(() => setBrightness(60));
  });

  it('não interfere na preferência de fitMode (chaves distintas)', () => {
    setFitMode('page-width');
    setBrightness(60);
    assert.equal(getFitMode(), 'page-width');
    assert.equal(getBrightness(), 60);
  });
});
