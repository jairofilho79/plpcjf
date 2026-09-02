/**
 * Versão de cache em `localStorage`: o que acontece quando o storage lê mas
 * recusa gravar, e quando ele lança em tudo. Run:
 * node --test src/lib/utils/cacheSync.test.js
 */

import { register } from 'node:module';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

/**
 * `cacheSync.js` importa `$lib/offline/core/OfflineConfig.js`, que por sua vez
 * importa `$app/environment` — os dois são especificadores que só existem
 * dentro do bundler do SvelteKit/Vite. Fora dele (aqui, sob `node --test` puro)
 * a resolução falha e derruba o arquivo antes de qualquer teste correr.
 *
 * O hook abaixo resolve os dois, e só os dois: `$lib/` vira o caminho real de
 * `src/lib/`, e `$app/environment` vira um stub inerte. Em produção (browser,
 * service worker, build do Vite) nada disto entra em ação. É o mesmo padrão
 * já usado em `src/lib/offline/utils/OfflineLogger.test.js`, e não custa
 * dependência nenhuma: `register` vem de `node:module`.
 */
const raizLib = fileURLToPath(new URL('../', import.meta.url));
const hookAliasesSvelteKit = `
const raizLib = ${JSON.stringify(raizLib)};
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '$app/environment') {
    return {
      url: 'data:text/javascript,export const version = "test";export const browser = true;export const dev = true;export const building = false;',
      shortCircuit: true
    };
  }
  if (specifier.startsWith('$lib/')) {
    return nextResolve(new URL(specifier.slice('$lib/'.length), 'file://' + raizLib).href, context);
  }
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(hookAliasesSvelteKit)}`, import.meta.url);

const { checkCacheVersionChanged, clearCacheVersion, updateCacheVersion } =
  await import('./cacheSync.js');
const { criarFakeStorage, criarStorageSomenteLeitura, criarStorageQueLanca } =
  await import('../testing/fakeStorage.js');

const CACHE_VERSION_KEY = 'pdfCacheVersion';

/**
 * `getCacheVersion()` lê o Cache Storage e devolve `<contagem>-<hash das URLs>`.
 * Mudar a lista de URLs muda a versão — é assim que se simula "o cache mudou".
 * @param {string[]} urls
 */
function instalarCaches(urls) {
  globalThis.caches = /** @type {any} */ ({
    open: async () => ({ keys: async () => urls.map((url) => ({ url })) })
  });
}

describe('cacheSync — versão do cache em storage degradado', () => {
  /** @type {any[][]} */
  let erros;
  /** @type {any[][]} */
  let logs;
  /** @type {typeof console.error} */
  let errorOriginal;
  /** @type {typeof console.log} */
  let logOriginal;

  beforeEach(() => {
    globalThis.window = /** @type {any} */ ({});
    instalarCaches(['https://exemplo/a.pdf']);
    erros = [];
    logs = [];
    errorOriginal = console.error;
    logOriginal = console.log;
    console.error = (/** @type {any[]} */ ...args) => { erros.push(args); };
    console.log = (/** @type {any[]} */ ...args) => { logs.push(args); };
  });

  afterEach(() => {
    console.error = errorOriginal;
    console.log = logOriginal;
    delete globalThis.localStorage;
    delete globalThis.caches;
    delete globalThis.window;
  });

  it('storage saudável: primeira visita grava a versão e não reporta mudança', async () => {
    const storage = criarFakeStorage();
    globalThis.localStorage = storage;

    assert.equal(await checkCacheVersionChanged(), false);
    assert.notEqual(storage.getItem(CACHE_VERSION_KEY), null);
    assert.equal(erros.length, 0);
  });

  it('storage saudável: versão diferente reporta mudança e regrava', async () => {
    const storage = criarFakeStorage({ [CACHE_VERSION_KEY]: 'versao-antiga' });
    globalThis.localStorage = storage;

    assert.equal(await checkCacheVersionChanged(), true);
    assert.notEqual(storage.getItem(CACHE_VERSION_KEY), 'versao-antiga');
  });

  // O ponto desta suíte. `true` promete que a versão nova ficou registada; se a
  // gravação falha, a promessa é falsa e quem chama remarcaria "precisa
  // sincronizar" a cada foco de janela, para sempre. O `setItem` cru lançava e
  // caía no `catch`, devolvendo `false`; `safeSet` engole, então a checagem do
  // retorno tem de estar lá.
  it('storage que lê e recusa gravar: NÃO reporta mudança, porque não gravou', async () => {
    globalThis.localStorage = criarStorageSomenteLeitura({
      [CACHE_VERSION_KEY]: 'versao-antiga'
    });

    assert.equal(await checkCacheVersionChanged(), false);
    assert.equal(erros.length, 1, 'a recusa de gravação tem de deixar rasto');
    assert.equal(
      logs.some((args) => String(args[0]).includes('Cache version changed')),
      false,
      'não pode anunciar mudança que não chegou a ser registada'
    );
  });

  it('storage que lança em tudo: devolve false e não lança', async () => {
    globalThis.localStorage = criarStorageQueLanca();

    assert.equal(await checkCacheVersionChanged(), false);
    await updateCacheVersion();
  });

  // A segunda forma de bloqueio, e a única que a guarda `typeof` não sobrevivia:
  // é a própria linha da guarda que lança, antes de qualquer `try`. É o Firefox
  // com "bloquear cookies e dados de sites" no estrito.
  it('getter global que lança: as três funções devolvem/saem sem lançar', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        const e = new Error('storage bloqueado');
        e.name = 'SecurityError';
        throw e;
      }
    });

    assert.equal(await checkCacheVersionChanged(), false);
    await updateCacheVersion();
    clearCacheVersion();
  });

  // O cenário-alvo da fase é justamente este, e é onde a consola não pode ficar
  // muda: Firefox estrito, utilizador a limpar dados, nada a acontecer.
  it('clearCacheVersion deixa rasto na consola quando o storage está bloqueado', () => {
    globalThis.localStorage = criarStorageQueLanca();

    clearCacheVersion();

    assert.equal(erros.length, 1);
    assert.match(String(erros[0][0]), /Failed to clear cache version/);
  });

  it('clearCacheVersion remove a chave e loga o sucesso quando dá', () => {
    const storage = criarFakeStorage({ [CACHE_VERSION_KEY]: 'x' });
    globalThis.localStorage = storage;

    clearCacheVersion();

    assert.equal(storage.getItem(CACHE_VERSION_KEY), null);
    assert.equal(erros.length, 0);
    assert.equal(logs.some((args) => String(args[0]).includes('cleared')), true);
  });

  it('sem window (SSR) nada é tocado', async () => {
    delete globalThis.window;
    const storage = criarFakeStorage({ [CACHE_VERSION_KEY]: 'versao-antiga' });
    globalThis.localStorage = storage;

    assert.equal(await checkCacheVersionChanged(), false);
    clearCacheVersion();

    assert.equal(storage.getItem(CACHE_VERSION_KEY), 'versao-antiga');
    assert.equal(erros.length, 0);
    assert.equal(logs.length, 0);
  });
});
