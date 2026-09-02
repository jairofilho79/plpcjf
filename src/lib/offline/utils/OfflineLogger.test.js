/**
 * Logger do módulo offline. Run:
 * node --test src/lib/offline/utils/OfflineLogger.test.js
 */

import { register } from 'node:module';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `OfflineLogger.js` importa `getConfig` de `../core/OfflineConfig.js`, que
 * por sua vez importa `$app/environment` — módulo virtual que só existe
 * dentro do bundler do SvelteKit/Vite. Fora dele (aqui, sob `node --test`
 * puro) essa resolução falha e derruba o arquivo inteiro antes de qualquer
 * teste rodar — pré-existente, sem relação com o bug dos argumentos do
 * logger, e fora do escopo desta tarefa mexer em `OfflineConfig.js` (linha
 * seria cache-key de `APP_CACHE_NAME`). O hook abaixo intercepta só esse um
 * especificador, devolvendo um stub inerte; em produção (browser, service
 * worker, build do Vite) `$app/environment` resolve normalmente e este hook
 * nunca entra em ação — zero efeito em código real, só destrava o teste.
 * @type {string}
 */
const hookSveltekitAppEnvironmentStub = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '$app/environment') {
    return {
      url: 'data:text/javascript,export const version = "test";export const browser = false;export const dev = true;export const building = false;',
      shortCircuit: true
    };
  }
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(hookSveltekitAppEnvironmentStub)}`, import.meta.url);

const { createLogger } = await import('./OfflineLogger.js');

describe('createLogger', () => {
  /** @type {any[][]} */
  let capturado;
  /** @type {typeof console.error} */
  let errorOriginal;

  beforeEach(() => {
    capturado = [];
    errorOriginal = console.error;
    console.error = (/** @type {any[]} */ ...args) => { capturado.push(args); };
  });

  afterEach(() => {
    console.error = errorOriginal;
  });

  it('entrega o objeto de erro ao console — o que o argumento redundante quebrava', () => {
    const logger = createLogger('CacheStorageAdapter');
    const erro = new Error('boom');

    logger.error('Failed to open cache', erro);

    assert.equal(capturado.length, 1);
    const [formatado, segundo] = capturado[0];
    assert.match(formatado, /\[Offline:CacheStorageAdapter\] \[ERROR\] Failed to open cache/);
    assert.equal(segundo, erro, 'o objeto de erro tem de chegar ao console.error');
  });

  it('não imprime o nome do módulo no lugar da mensagem', () => {
    const logger = createLogger('OfflineManager');

    logger.error('Migração falhou', new Error('x'));

    const [formatado] = capturado[0];
    assert.doesNotMatch(
      formatado,
      /\[ERROR\] OfflineManager/,
      'a mensagem não pode ser o nome do módulo repetido'
    );
  });

  it('não passa segundo argumento quando não há erro', () => {
    createLogger('CacheSync').error('só a mensagem');
    assert.equal(capturado[0].length, 1);
  });
});

describe('conformidade dos sítios de chamada', () => {
  /**
   * @param {string} dir
   * @returns {string[]}
   */
  function arquivosJs(dir) {
    return readdirSync(dir).flatMap((entrada) => {
      const caminho = join(dir, entrada);
      if (statSync(caminho).isDirectory()) return arquivosJs(caminho);
      return caminho.endsWith('.js') && !caminho.endsWith('.test.js') ? [caminho] : [];
    });
  }

  it('nenhuma chamada repassa o nome do módulo já vinculado', () => {
    // `fileURLToPath`, não `.pathname`: `.pathname` devolve o caminho ainda
    // percent-encoded (este repositório mora sob um diretório com espaço no
    // nome), e `readdirSync('%20...')` não existe no disco.
    const raiz = fileURLToPath(new URL('../', import.meta.url));
    /** @type {string[]} */
    const ofensores = [];

    // Global (não `.match` simples) e aceitando aspas simples ou duplas: um
    // arquivo pode ter mais de um `createLogger(...)` vinculado, e nem todo
    // sítio usa aspas simples.
    const padraoVinculo = /createLogger\(\s*(['"])([^'"]+)\1\s*\)/g;

    for (const caminho of arquivosJs(raiz)) {
      const fonte = readFileSync(caminho, 'utf8');
      /** @type {Set<string>} */
      const modulos = new Set();
      for (const vinculo of fonte.matchAll(padraoVinculo)) {
        modulos.add(vinculo[2]);
      }
      if (modulos.size === 0) continue;

      for (const modulo of modulos) {
        const moduloEscapado = modulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const padrao = new RegExp(
          `logger\\.(error|warn|info|debug)\\(\\s*(['"])${moduloEscapado}\\2\\s*,`,
          'g'
        );
        for (const achado of fonte.matchAll(padrao)) {
          const linha = fonte.slice(0, achado.index).split('\n').length;
          ofensores.push(`${caminho}:${linha}`);
        }
      }
    }

    assert.deepEqual(
      ofensores,
      [],
      `logger já vinculado por createLogger recebendo o nome do módulo de novo:\n${ofensores.join('\n')}`
    );
  });
});
