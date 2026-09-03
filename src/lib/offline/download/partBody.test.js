/**
 * Leitura do corpo de uma parte com progresso por bytes.
 * Run: node --test src/lib/offline/download/partBody.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readBodyWithProgress, declaredBodySize } from './partBody.js';

/**
 * Resposta falsa com corpo em pedaços.
 * @param {number[][]} pedacos
 * @param {Record<string, string>} [headers]
 * @param {{ falharNoPedaco?: number, erro?: Error }} [opts]
 */
function fakeResponse(pedacos, headers = {}, opts = {}) {
  let i = 0;
  return {
    headers: {
      get: (/** @type {string} */ k) => headers[k.toLowerCase()] ?? null
    },
    body: {
      getReader() {
        return {
          async read() {
            if (opts.falharNoPedaco === i) throw opts.erro ?? new Error('rede caiu');
            if (i >= pedacos.length) return { done: true, value: undefined };
            return { done: false, value: new Uint8Array(pedacos[i++]) };
          },
          cancel() {}
        };
      }
    },
    async blob() {
      return new Blob(pedacos.map((p) => new Uint8Array(p)));
    }
  };
}

describe('readBodyWithProgress', () => {
  it('reporta os bytes de cada pedaço à medida que chegam', async () => {
    /** @type {number[]} */
    const vistos = [];
    const blob = await readBodyWithProgress(
      /** @type {any} */ (fakeResponse([[1, 2, 3], [4, 5], [6]])),
      { onBytes: (/** @type {number} */ n) => vistos.push(n) }
    );

    assert.deepEqual(vistos, [3, 2, 1]);
    assert.equal(blob.size, 6);
  });

  it('não espera o fim para reportar: o primeiro relatório vem antes do último pedaço', async () => {
    /** @type {string[]} */
    const ordem = [];
    let resolverSegundo = () => {};
    const segundoPedaco = new Promise((r) => (resolverSegundo = r));

    const response = {
      headers: { get: () => null },
      body: {
        getReader() {
          let i = 0;
          return {
            async read() {
              i++;
              if (i === 1) return { done: false, value: new Uint8Array([1, 2, 3]) };
              if (i === 2) {
                await segundoPedaco;
                return { done: false, value: new Uint8Array([4]) };
              }
              return { done: true, value: undefined };
            },
            cancel() {}
          };
        }
      }
    };

    const promessa = readBodyWithProgress(/** @type {any} */ (response), {
      onBytes: () => ordem.push('bytes')
    });

    // Dá uma volta na fila de microtarefas: o primeiro pedaço já deve ter sido
    // reportado, mesmo com o segundo ainda pendurado na rede.
    await new Promise((r) => setTimeout(r, 0));
    ordem.push('ainda-baixando');
    resolverSegundo();
    await promessa;

    assert.deepEqual(ordem.slice(0, 2), ['bytes', 'ainda-baixando']);
  });

  it('cai para response.blob() quando não há stream (Safari antigo)', async () => {
    /** @type {number[]} */
    const vistos = [];
    const response = {
      headers: { get: () => null },
      body: null,
      async blob() {
        return new Blob([new Uint8Array([1, 2, 3, 4])]);
      }
    };

    const blob = await readBodyWithProgress(/** @type {any} */ (response), {
      onBytes: (/** @type {number} */ n) => vistos.push(n)
    });

    assert.equal(blob.size, 4);
    assert.deepEqual(vistos, [4], 'sem stream, reporta tudo de uma vez em vez de nada');
  });

  it('propaga a queda de rede no meio do corpo', async () => {
    await assert.rejects(
      readBodyWithProgress(
        /** @type {any} */ (fakeResponse([[1, 2], [3, 4]], {}, { falharNoPedaco: 1 })),
        { onBytes: () => {} }
      ),
      /rede caiu/
    );
  });

  it('devolve o blob com o tipo pedido', async () => {
    const blob = await readBodyWithProgress(/** @type {any} */ (fakeResponse([[1]])), {
      onBytes: () => {},
      type: 'application/zip'
    });
    assert.equal(blob.type, 'application/zip');
  });
});

describe('declaredBodySize', () => {
  it('lê o Content-Length quando existe', () => {
    const r = fakeResponse([], { 'content-length': '24876045' });
    assert.equal(declaredBodySize(/** @type {any} */ (r)), 24876045);
  });

  it('devolve null sem Content-Length (resposta comprimida ou em chunks)', () => {
    assert.equal(declaredBodySize(/** @type {any} */ (fakeResponse([]))), null);
  });

  it('devolve null para valor inválido', () => {
    const r = fakeResponse([], { 'content-length': 'sei lá' });
    assert.equal(declaredBodySize(/** @type {any} */ (r)), null);
  });
});
