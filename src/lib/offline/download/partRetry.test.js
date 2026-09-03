/**
 * Retentativa da parte inteira — inclusive quando a queda é no meio do corpo.
 * Run: node --test src/lib/offline/download/partRetry.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { downloadPartWithRetry } from './partRetry.js';

/**
 * Resposta cujo corpo pode falhar no meio.
 * @param {number[][]} pedacos
 * @param {number} [falharApos] índice do pedaço em que a conexão cai
 */
function resposta(pedacos, falharApos = -1) {
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        async read() {
          if (i === falharApos) throw new Error('Failed to fetch');
          if (i >= pedacos.length) return { done: true, value: undefined };
          return { done: false, value: new Uint8Array(pedacos[i++]) };
        },
        cancel() {}
      })
    }
  };
}

const semEspera = async () => {};

describe('downloadPartWithRetry', () => {
  it('devolve o blob e não retenta quando dá certo de primeira', async () => {
    let chamadas = 0;
    const blob = await downloadPartWithRetry('/packages/a.zip', {
      fetchImpl: async () => {
        chamadas++;
        return /** @type {any} */ (resposta([[1, 2], [3]]));
      },
      onBytes: () => {},
      sleepImpl: semEspera
    });

    assert.equal(chamadas, 1);
    assert.equal(blob.size, 3);
  });

  it('a queda no MEIO do corpo é retentada — era a falha que matava o download inteiro', async () => {
    let chamadas = 0;
    const blob = await downloadPartWithRetry('/packages/a.zip', {
      fetchImpl: async () => {
        chamadas++;
        // Primeira tentativa: cai depois do primeiro pedaço.
        return /** @type {any} */ (chamadas === 1 ? resposta([[1, 2], [3]], 1) : resposta([[1, 2], [3]]));
      },
      onBytes: () => {},
      sleepImpl: semEspera
    });

    assert.equal(chamadas, 2);
    assert.equal(blob.size, 3);
  });

  it('devolve os bytes da tentativa perdida para quem contabiliza', async () => {
    let chamadas = 0;
    /** @type {number[]} */
    const somados = [];
    /** @type {number[]} */
    const devolvidos = [];

    await downloadPartWithRetry('/packages/a.zip', {
      fetchImpl: async () => {
        chamadas++;
        return /** @type {any} */ (
          chamadas === 1 ? resposta([[1, 2, 3, 4], [5]], 1) : resposta([[1, 2], [3]])
        );
      },
      onBytes: (/** @type {number} */ n) => somados.push(n),
      onAttemptFailed: (/** @type {number} */ _t, /** @type {Error} */ _e, /** @type {number} */ bytes) => devolvidos.push(bytes),
      sleepImpl: semEspera
    });

    // 4 bytes chegaram antes da queda e precisam sair da conta: senão o
    // contador da tela passa do total e a barra estoura os 100%.
    assert.deepEqual(somados, [4, 2, 1]);
    assert.deepEqual(devolvidos, [4]);
  });

  it('desiste depois do orçamento de tentativas, com o último erro', async () => {
    let chamadas = 0;
    await assert.rejects(
      downloadPartWithRetry('/packages/a.zip', {
        fetchImpl: async () => {
          chamadas++;
          return /** @type {any} */ (resposta([[1]], 0));
        },
        attempts: 3,
        onBytes: () => {},
        sleepImpl: semEspera
      }),
      /Failed to fetch/
    );
    assert.equal(chamadas, 3);
  });

  it('não retenta 404: o lote não volta a existir por insistência', async () => {
    let chamadas = 0;
    await assert.rejects(
      downloadPartWithRetry('/packages/a.zip', {
        fetchImpl: async () => {
          chamadas++;
          return /** @type {any} */ ({ ok: false, status: 404, headers: { get: () => null } });
        },
        onBytes: () => {},
        sleepImpl: semEspera
      }),
      /404/
    );
    assert.equal(chamadas, 1);
  });

  it('retenta 503', async () => {
    let chamadas = 0;
    const blob = await downloadPartWithRetry('/packages/a.zip', {
      fetchImpl: async () => {
        chamadas++;
        if (chamadas === 1) return /** @type {any} */ ({ ok: false, status: 503, headers: { get: () => null } });
        return /** @type {any} */ (resposta([[1]]));
      },
      onBytes: () => {},
      sleepImpl: semEspera
    });
    assert.equal(chamadas, 2);
    assert.equal(blob.size, 1);
  });

  it('cancelar durante uma tentativa não dispara a seguinte', async () => {
    let chamadas = 0;
    let cancelado = false;
    await assert.rejects(
      downloadPartWithRetry('/packages/a.zip', {
        fetchImpl: async () => {
          chamadas++;
          // A pessoa toca em "Cancelar" enquanto esta tentativa está no ar.
          cancelado = true;
          throw new Error('Failed to fetch');
        },
        isCancelled: () => cancelado,
        onBytes: () => {},
        sleepImpl: semEspera
      }),
      /DOWNLOAD_CANCELLED/
    );
    assert.equal(chamadas, 1, 'não começa a tentativa seguinte depois do cancelamento');
  });

  it('já cancelado antes de começar nem chega a pedir', async () => {
    let chamadas = 0;
    await assert.rejects(
      downloadPartWithRetry('/packages/a.zip', {
        fetchImpl: async () => {
          chamadas++;
          return /** @type {any} */ (resposta([[1]]));
        },
        isCancelled: () => true,
        onBytes: () => {},
        sleepImpl: semEspera
      }),
      /DOWNLOAD_CANCELLED/
    );
    assert.equal(chamadas, 0);
  });

  it('espera mais a cada tentativa', async () => {
    /** @type {number[]} */
    const esperas = [];
    let chamadas = 0;
    await downloadPartWithRetry('/packages/a.zip', {
      fetchImpl: async () => {
        chamadas++;
        if (chamadas < 3) return /** @type {any} */ (resposta([[1]], 0));
        return /** @type {any} */ (resposta([[1]]));
      },
      baseDelayMs: 100,
      jitter: false,
      onBytes: () => {},
      sleepImpl: async (/** @type {number} */ ms) => { esperas.push(ms); }
    });
    assert.deepEqual(esperas, [100, 200]);
  });

  it('avisa cada tentativa perdida', async () => {
    /** @type {Array<[number, string]>} */
    const avisos = [];
    let chamadas = 0;
    await downloadPartWithRetry('/packages/a.zip', {
      fetchImpl: async () => {
        chamadas++;
        return /** @type {any} */ (chamadas === 1 ? resposta([[1]], 0) : resposta([[1]]));
      },
      onBytes: () => {},
      onAttemptFailed: (/** @type {number} */ tentativa, /** @type {Error} */ erro) => avisos.push([tentativa, erro.message]),
      sleepImpl: semEspera
    });
    assert.deepEqual(avisos, [[1, 'Failed to fetch']]);
  });
});
