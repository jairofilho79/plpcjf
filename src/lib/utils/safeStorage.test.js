/**
 * Run: node --test src/lib/utils/safeStorage.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  criarFakeStorage,
  criarStorageQueLanca,
  criarStorageSomenteLeitura
} from '../testing/fakeStorage.js';
import {
  getStorage,
  safeGet,
  safeSet,
  safeRemove,
  safeKeys,
  safeRemoveMany
} from './safeStorage.js';

/** Instala um storage como global, do jeito que o módulo o lê. */
function instalar(storage) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true
  });
}

/** O caso real do Firefox estrito: o próprio getter global lança. */
function instalarGetterQueLanca() {
  Object.defineProperty(globalThis, 'localStorage', {
    get() {
      const e = new Error('storage bloqueado');
      e.name = 'SecurityError';
      throw e;
    },
    configurable: true
  });
}

function desinstalar() {
  delete globalThis.localStorage;
  delete globalThis.window;
}

describe('safeStorage — caminho feliz', () => {
  beforeEach(() => {
    globalThis.window = {};
    instalar(criarFakeStorage({ a: '1', b: '2', c: '3' }));
  });
  afterEach(desinstalar);

  it('getStorage devolve o storage', () => {
    assert.equal(getStorage(), globalThis.localStorage);
  });

  it('safeGet devolve o valor quando a chave existe', () => {
    assert.equal(safeGet('a'), '1');
  });

  it('safeGet devolve null quando a chave não existe', () => {
    assert.equal(safeGet('naoexiste'), null);
  });

  it('safeSet grava e devolve true', () => {
    assert.equal(safeSet('d', '4'), true);
    assert.equal(safeGet('d'), '4');
  });

  it('safeRemove devolve true ao remover e também quando a chave não existia', () => {
    assert.equal(safeRemove('a'), true);
    assert.equal(safeGet('a'), null);
    assert.equal(safeRemove('nuncaexistiu'), true);
  });

  it('safeKeys devolve todas as chaves', () => {
    assert.deepEqual(safeKeys(), ['a', 'b', 'c']);
    // O comprimento explícito é o que apanha um `i <= total`: `key(3)` devolve
    // `null` e o filtro de nulos comeria a volta extra em silêncio.
    assert.equal(safeKeys().length, 3);
  });

  it('safeRemoveMany remove todas e não reporta falha nenhuma', () => {
    assert.deepEqual(safeRemoveMany(['a', 'b', 'c']), { removed: ['a', 'b', 'c'], failed: [] });
    assert.deepEqual(safeKeys(), []);
  });
});

describe('safeStorage — storage que lança em toda operação (Firefox estrito)', () => {
  beforeEach(() => {
    globalThis.window = {};
    instalar(criarStorageQueLanca());
  });
  afterEach(desinstalar);

  it('getStorage devolve null sem lançar', () => {
    assert.equal(getStorage(), null);
  });

  it('safeGet devolve null sem lançar', () => {
    assert.doesNotThrow(() => safeGet('a'));
    assert.equal(safeGet('a'), null);
  });

  it('safeSet devolve false sem lançar', () => {
    assert.doesNotThrow(() => safeSet('a', '1'));
    assert.equal(safeSet('a', '1'), false);
  });

  it('safeRemove devolve false sem lançar', () => {
    assert.doesNotThrow(() => safeRemove('a'));
    assert.equal(safeRemove('a'), false);
  });

  it('safeKeys devolve [] sem lançar', () => {
    assert.doesNotThrow(() => safeKeys());
    assert.deepEqual(safeKeys(), []);
  });
});

describe('safeStorage — o getter global é que lança', () => {
  beforeEach(() => {
    globalThis.window = {};
    instalarGetterQueLanca();
  });
  afterEach(desinstalar);

  it('ler globalThis.localStorage direto realmente lança — a premissa do módulo', () => {
    assert.throws(() => globalThis.localStorage, { name: 'SecurityError' });
  });

  it('`typeof localStorage` NÃO protege — é por isso que este módulo existe', () => {
    // ECMA-262 §13.5.3: `typeof` só suprime exceção para referência não
    // resolvível. `localStorage` é resolvível; o [[Get]] dela é que lança.
    // `localStorage` cru, sem qualificador — exatamente a forma que aparece
    // hoje em cacheSync.js, pdfValidation.js e swRegistration.js.
    assert.throws(() => typeof localStorage === 'undefined', { name: 'SecurityError' });
  });

  it('getStorage devolve null sem lançar', () => {
    assert.equal(getStorage(), null);
  });

  it('todas as funções devolvem o default sem lançar', () => {
    assert.equal(safeGet('a'), null);
    assert.equal(safeSet('a', '1'), false);
    assert.equal(safeRemove('a'), false);
    assert.deepEqual(safeKeys(), []);
    assert.deepEqual(safeRemoveMany(['a', 'b']), { removed: [], failed: ['a', 'b'] });
  });
});

describe('safeStorage — storage que só lança ao gravar (cota estourada)', () => {
  beforeEach(() => {
    globalThis.window = {};
    instalar(criarStorageSomenteLeitura({ a: '1' }));
  });
  afterEach(desinstalar);

  it('safeGet continua funcionando', () => {
    assert.equal(safeGet('a'), '1');
  });

  it('getStorage devolve o storage: a sonda só recusa quem nem ler deixa', () => {
    assert.equal(getStorage(), globalThis.localStorage);
  });

  it('safeSet devolve false sem lançar', () => {
    assert.doesNotThrow(() => safeSet('b', '2'));
    assert.equal(safeSet('b', '2'), false);
  });

  it('safeRemove devolve false sem lançar', () => {
    assert.equal(safeRemove('a'), false);
  });
});

describe('safeRemoveMany — não aborta na primeira falha', () => {
  afterEach(desinstalar);

  it('com falha só na segunda de quatro chaves, remove as outras três', () => {
    // Este é o teste central da fase: é o comportamento que a Fase 2 consome
    // em `clearAllCache()`, onde hoje seis removeItem crus em sequência param
    // no primeiro que lançar e deixam o resto do estado de pé.
    const base = criarFakeStorage({ k1: '1', k2: '2', k3: '3', k4: '4' });
    globalThis.window = {};
    instalar(/** @type {any} */ ({
      ...base,
      get length() { return base.length; },
      key: (/** @type {number} */ i) => base.key(i),
      getItem: (/** @type {string} */ k) => base.getItem(k),
      removeItem(/** @type {string} */ k) {
        if (k === 'k2') {
          const e = new Error('storage bloqueado');
          e.name = 'SecurityError';
          throw e;
        }
        base.removeItem(k);
      }
    }));

    const resultado = safeRemoveMany(['k1', 'k2', 'k3', 'k4']);

    assert.deepEqual(resultado.removed, ['k1', 'k3', 'k4']);
    assert.deepEqual(resultado.failed, ['k2']);
    assert.deepEqual(safeKeys(), ['k2']);
  });

  it('com lista vazia devolve dois arrays vazios', () => {
    globalThis.window = {};
    instalar(criarFakeStorage());
    assert.deepEqual(safeRemoveMany([]), { removed: [], failed: [] });
  });
});

describe('safeStorage — SSR, sem localStorage nenhum', () => {
  beforeEach(desinstalar);
  afterEach(desinstalar);

  it('tudo devolve o default e nada lança', () => {
    assert.equal(getStorage(), null);
    assert.equal(safeGet('a'), null);
    assert.equal(safeSet('a', '1'), false);
    assert.deepEqual(safeKeys(), []);
  });

  it('safeRemove devolve true: sem storage não há o que remover', () => {
    // `false` é reservado para "o acesso lançou". Ausência não é falha —
    // senão a Fase 2 reportaria "0 de 6 chaves removidas" em SSR, onde não
    // havia chave nenhuma para começo de conversa.
    assert.equal(safeRemove('a'), true);
    assert.deepEqual(safeRemoveMany(['a', 'b']), { removed: ['a', 'b'], failed: [] });
  });
});

describe('safeStorage — entradas hostis', () => {
  afterEach(desinstalar);

  const impostores = [
    ['número', 42],
    ['string', 'abc'],
    ['booleano', true],
    ['objeto vazio', {}],
    ['getItem que não é função', { getItem: 1 }],
    ['stub sem key()', { getItem() {}, setItem() {}, removeItem() {} }]
  ];
  for (const [nome, impostor] of impostores) {
    it(`getStorage recusa ${nome}: não é Storage`, () => {
      globalThis.window = {};
      instalar(impostor);
      // Extensões de privacidade trocam `window.localStorage` por stubs assim.
      // Devolvê-los faria estourar o idioma óbvio `const s = getStorage(); s.setItem(...)`.
      assert.equal(getStorage(), null);
    });
  }

  it('safeRemoveMany não lança com lista inválida', () => {
    globalThis.window = {};
    instalar(criarFakeStorage({ a: '1' }));
    for (const invalida of [undefined, null, 42, { nao: 'iteravel' }, 'offlinePermission']) {
      assert.doesNotThrow(() => safeRemoveMany(/** @type {any} */ (invalida)));
      assert.deepEqual(safeRemoveMany(/** @type {any} */ (invalida)), { removed: [], failed: [] });
    }
    // E a chave que existia continua lá: a lista inválida não removeu nada.
    assert.equal(safeGet('a'), '1');
  });

  it('safeKeys devolve o parcial quando a enumeração lança no meio', () => {
    const base = criarFakeStorage({ k1: '1', k2: '2', k3: '3' });
    globalThis.window = {};
    instalar(/** @type {any} */ ({
      ...base,
      get length() { return base.length; },
      getItem: (/** @type {string} */ k) => base.getItem(k),
      setItem: () => {},
      removeItem: () => {},
      key(/** @type {number} */ i) {
        if (i === 2) throw new Error('storage bloqueado');
        return base.key(i);
      }
    }));
    // Descartar o parcial faria a faxina concluir "nada a limpar".
    assert.deepEqual(safeKeys(), ['k1', 'k2']);
  });
});

describe('safeRemoveMany — iteráveis que não são array', () => {
  afterEach(desinstalar);

  it('aceita Set e gerador, recusa string', () => {
    globalThis.window = {};
    instalar(criarFakeStorage({ a: '1', b: '2', ab: '3' }));

    assert.deepEqual(safeRemoveMany(new Set(['a', 'b'])), { removed: ['a', 'b'], failed: [] });
    assert.equal(safeGet('ab'), '3');

    // 'ab' como string daria removed: ['a','b'] — duas chaves que não foram
    // pedidas — e deixaria a chave 'ab', que era a pedida, de pé.
    assert.deepEqual(safeRemoveMany('ab'), { removed: [], failed: [] });
    assert.equal(safeGet('ab'), '3');
  });

  it('preserva o parcial quando o iterável lança no meio', () => {
    globalThis.window = {};
    instalar(criarFakeStorage({ a: '1', b: '2', c: '3' }));
    function* comFalha() {
      yield 'a';
      yield 'b';
      throw new Error('iterável quebrado');
    }
    assert.deepEqual(safeRemoveMany(comFalha()), { removed: ['a', 'b'], failed: [] });
    assert.equal(safeGet('c'), '3');
  });
});

describe('fakeStorage — os próprios fakes', () => {
  it('criarStorageSomenteLeitura também lança em clear', () => {
    // Sem isto o fake apagaria tudo em silêncio, provando o contrário do nome.
    const s = criarStorageSomenteLeitura({ a: '1' });
    assert.throws(() => s.clear(), { name: 'QuotaExceededError' });
    assert.equal(s.getItem('a'), '1');
  });

  it('criarStorageQueLanca lança até em length', () => {
    const s = criarStorageQueLanca();
    assert.throws(() => s.length, { name: 'SecurityError' });
  });
});
