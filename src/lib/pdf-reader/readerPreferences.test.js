/**
 * As preferências do leitor com armazenamento hostil. Este arquivo existe
 * porque as três leituras entram por inicializador de instância da rota
 * `/leitor` — um throw aqui não devolve valor errado, aborta a construção do
 * componente e deixa a página em branco.
 * Run: node --test src/lib/pdf-reader/readerPreferences.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { criarFakeStorage, criarStorageQueLanca, criarStorageSomenteLeitura } from '../testing/fakeStorage.js';
import {
  getFitMode, setFitMode,
  getNavigationMode, setNavigationMode,
  getBrightness, setBrightness,
  BRIGHTNESS_PRESETS, DEFAULT_BRIGHTNESS
} from './readerPreferences.js';

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function instalar(storage) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage, configurable: true, writable: true
  });
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else delete globalThis.localStorage;
});

describe('readerPreferences — storage que lança em tudo', () => {
  beforeEach(() => instalar(criarStorageQueLanca('SecurityError')));

  it('getFitMode devolve o padrão em vez de lançar', () => {
    assert.doesNotThrow(() => getFitMode());
    assert.equal(getFitMode(), 'page-fit');
  });

  it('getNavigationMode devolve o padrão em vez de lançar', () => {
    assert.doesNotThrow(() => getNavigationMode());
    assert.equal(getNavigationMode(), 'horizontal');
  });

  it('getBrightness devolve o padrão em vez de lançar', () => {
    assert.doesNotThrow(() => getBrightness());
    assert.equal(getBrightness(), DEFAULT_BRIGHTNESS);
  });

  it('os setters não lançam', () => {
    assert.doesNotThrow(() => setFitMode('page-width'));
    assert.doesNotThrow(() => setNavigationMode('vertical'));
    assert.doesNotThrow(() => setBrightness(60));
  });
});

describe('readerPreferences — storage ausente (SSR / node puro)', () => {
  beforeEach(() => { delete globalThis.localStorage; });

  it('devolve os três padrões', () => {
    assert.equal(getFitMode(), 'page-fit');
    assert.equal(getNavigationMode(), 'horizontal');
    assert.equal(getBrightness(), DEFAULT_BRIGHTNESS);
  });
});

describe('readerPreferences — storage que lê mas recusa gravar', () => {
  beforeEach(() => instalar(criarStorageSomenteLeitura({ pdfPreferredFitMode: 'page-width' })));

  it('a leitura continua a valer', () => {
    assert.equal(getFitMode(), 'page-width');
  });

  it('a gravação recusada não lança nem corrompe a leitura', () => {
    assert.doesNotThrow(() => setFitMode('page-fit'));
    assert.equal(getFitMode(), 'page-width');
  });
});

describe('readerPreferences — storage normal', () => {
  beforeEach(() => instalar(criarFakeStorage()));

  it('faz ida e volta dos três valores', () => {
    setFitMode('page-width');
    assert.equal(getFitMode(), 'page-width');
    setNavigationMode('vertical');
    assert.equal(getNavigationMode(), 'vertical');
    setBrightness(130);
    assert.equal(getBrightness(), 130);
  });

  it('valor inválido gravado à mão cai no padrão', () => {
    instalar(criarFakeStorage({
      pdfPreferredFitMode: 'lixo',
      pdfNavigationMode: 'diagonal',
      pdfReaderBrightness: '999'
    }));
    assert.equal(getFitMode(), 'page-fit');
    assert.equal(getNavigationMode(), 'horizontal');
    assert.equal(getBrightness(), DEFAULT_BRIGHTNESS);
  });

  it('getBrightness não aceita o "" que vira 0 no Number()', () => {
    instalar(criarFakeStorage({ pdfReaderBrightness: '' }));
    assert.equal(getBrightness(), DEFAULT_BRIGHTNESS);
  });

  it('persiste na chave pdfReaderBrightness', () => {
    setBrightness(130);
    assert.equal(globalThis.localStorage.getItem('pdfReaderBrightness'), '130');
  });

  it('não interfere na preferência de fitMode (chaves distintas)', () => {
    setFitMode('page-width');
    setBrightness(60);
    assert.equal(getFitMode(), 'page-width');
    assert.equal(getBrightness(), 60);
  });
});

describe('readerPreferences — contrato de BRIGHTNESS_PRESETS', () => {
  it('expõe as três predefinições esperadas, na ordem do ciclo', () => {
    // `cycleBrightness()` em routes/leitor/+page.svelte anda nesta lista por
    // índice — trocar a ordem muda o comportamento do botão sem que nenhum
    // outro teste avise.
    assert.deepEqual(BRIGHTNESS_PRESETS, [100, 60, 130]);
  });
});
