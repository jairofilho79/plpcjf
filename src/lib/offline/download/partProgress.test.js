/**
 * Progresso por parte e retentativa. Run: node --test src/lib/offline/download/partProgress.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  readCompletedParts,
  markPartCompleted,
  clearCompletedParts,
  clearAllCompletedParts,
  computePartsFingerprint,
  isRetryableStatus,
  looksLikeCaptivePortal,
  fetchWithRetry,
  excludeSkippedPartFromBytesTotal
} from './partProgress.js';

function createStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); }
  };
}

describe('partes concluídas', () => {
  let storage;
  beforeEach(() => { storage = createStorage(); });

  it('começa vazio', () => {
    assert.equal(readCompletedParts(storage, 'Cifra').size, 0);
  });

  it('registra e relê', () => {
    markPartCompleted(storage, 'Cifra', 'Cifra-1.zip');
    markPartCompleted(storage, 'Cifra', 'Cifra-2.zip');
    const done = readCompletedParts(storage, 'Cifra');
    assert.equal(done.has('Cifra-1.zip'), true);
    assert.equal(done.size, 2);
  });

  it('isola downloads diferentes', () => {
    markPartCompleted(storage, 'Cifra', 'Cifra-1.zip');
    assert.equal(readCompletedParts(storage, 'Partitura').size, 0);
  });

  it('limpa ao concluir', () => {
    markPartCompleted(storage, 'Cifra', 'Cifra-1.zip');
    clearCompletedParts(storage, 'Cifra');
    assert.equal(readCompletedParts(storage, 'Cifra').size, 0);
  });

  it('sobrevive a JSON corrompido', () => {
    storage.setItem('plpc:downloadParts:Cifra', '{quebrado');
    assert.equal(readCompletedParts(storage, 'Cifra').size, 0);
  });

  it('limpa todos os downloads sem tocar em outras chaves', () => {
    storage.setItem('outra-coisa', 'preservar');
    markPartCompleted(storage, 'Cifra', 'Cifra-1.zip');
    markPartCompleted(storage, 'Partitura', 'Partitura-1.zip');
    clearAllCompletedParts(storage);
    assert.equal(readCompletedParts(storage, 'Cifra').size, 0);
    assert.equal(readCompletedParts(storage, 'Partitura').size, 0);
    assert.equal(storage.getItem('outra-coisa'), 'preservar');
  });

  it('ignora registro em formato desconhecido', () => {
    storage.setItem('plpc:downloadParts:Cifra', JSON.stringify(['Cifra-1.zip']));
    assert.equal(readCompletedParts(storage, 'Cifra').size, 0);
  });
});

describe('impressão digital das partes', () => {
  let storage;
  beforeEach(() => { storage = createStorage(); });

  const partsV1 = [
    { filename: 'Cifra-1.zip', size: 100 },
    { filename: 'Cifra-2.zip', size: 200 }
  ];

  it('é estável e não depende da ordem', () => {
    const a = computePartsFingerprint(partsV1, '1.0.0');
    const b = computePartsFingerprint([...partsV1].reverse(), '1.0.0');
    assert.equal(a, b);
  });

  it('muda quando o tamanho de uma parte muda', () => {
    const a = computePartsFingerprint(partsV1, '1.0.0');
    const b = computePartsFingerprint(
      [{ filename: 'Cifra-1.zip', size: 999 }, { filename: 'Cifra-2.zip', size: 200 }],
      '1.0.0'
    );
    assert.notEqual(a, b);
  });

  it('muda quando o conteúdo declarado da parte muda', () => {
    const a = computePartsFingerprint(
      [{ filename: 'Cifra-1.zip', size: 100, pdfs: ['aaa', 'bbb'] }],
      '1.0.0'
    );
    const b = computePartsFingerprint(
      [{ filename: 'Cifra-1.zip', size: 100, pdfs: ['aaa', 'ccc'] }],
      '1.0.0'
    );
    const c = computePartsFingerprint(
      [{ filename: 'Cifra-1.zip', size: 100, pdfs: ['aaa'] }],
      '1.0.0'
    );
    assert.notEqual(a, b);
    assert.notEqual(a, c);
  });

  it('muda quando o manifesto muda', () => {
    assert.notEqual(
      computePartsFingerprint(partsV1, '1.0.0'),
      computePartsFingerprint(partsV1, '1.0.1')
    );
  });

  it('descarta a retomada quando os pacotes mudaram no servidor', () => {
    const antiga = computePartsFingerprint(partsV1, '1.0.0');
    markPartCompleted(storage, 'Cifra', 'Cifra-1.zip', antiga);
    assert.equal(readCompletedParts(storage, 'Cifra', antiga).size, 1);

    const nova = computePartsFingerprint(
      [...partsV1, { filename: 'Cifra-3.zip', size: 300 }],
      '1.0.0'
    );
    assert.equal(readCompletedParts(storage, 'Cifra', nova).size, 0);
    // O registro velho é apagado, não fica esperando para emendar depois.
    assert.equal(storage.getItem('plpc:downloadParts:Cifra'), null);
  });

  it('recomeça a lista quando marca uma parte com impressão nova', () => {
    markPartCompleted(storage, 'Cifra', 'Cifra-1.zip', 'aaa');
    markPartCompleted(storage, 'Cifra', 'Cifra-9.zip', 'bbb');
    const done = readCompletedParts(storage, 'Cifra', 'bbb');
    assert.deepEqual([...done], ['Cifra-9.zip']);
  });

  it('descarta estado antigo demais', () => {
    const agora = Date.now();
    markPartCompleted(storage, 'Cifra', 'Cifra-1.zip', 'aaa', agora);
    const oitoDias = agora + 8 * 24 * 60 * 60 * 1000;
    assert.equal(readCompletedParts(storage, 'Cifra', 'aaa', oitoDias).size, 0);
  });
});

describe('classificação de resposta', () => {
  it('separa retentável de definitivo', () => {
    assert.equal(isRetryableStatus(500), true);
    assert.equal(isRetryableStatus(503), true);
    assert.equal(isRetryableStatus(429), true);
    assert.equal(isRetryableStatus(408), true);
    assert.equal(isRetryableStatus(404), false);
    assert.equal(isRetryableStatus(403), false);
  });

  it('reconhece portal cativo pelo content-type', () => {
    const html = { headers: { get: () => 'text/html; charset=utf-8' } };
    const zip = { headers: { get: () => 'application/zip' } };
    assert.equal(looksLikeCaptivePortal(html), true);
    assert.equal(looksLikeCaptivePortal(zip), false);
    assert.equal(looksLikeCaptivePortal(null), false);
  });
});

describe('fetchWithRetry', () => {
  it('devolve na primeira tentativa quando dá certo', async () => {
    let calls = 0;
    const fakeFetch = async () => { calls++; return { ok: true, status: 200 }; };
    const res = await fetchWithRetry('/x.zip', {}, { fetchImpl: fakeFetch });
    assert.equal(res.ok, true);
    assert.equal(calls, 1);
  });

  it('reintenta erro de transporte e acaba dando certo', async () => {
    let calls = 0;
    const fakeFetch = async () => {
      calls++;
      if (calls < 3) throw new Error('network');
      return { ok: true, status: 200 };
    };
    const res = await fetchWithRetry('/x.zip', {}, { fetchImpl: fakeFetch, baseDelayMs: 1 });
    assert.equal(res.ok, true);
    assert.equal(calls, 3);
  });

  it('reintenta 5xx mas não 404', async () => {
    let calls = 0;
    const fakeFetch = async () => { calls++; return { ok: false, status: 404 }; };
    await assert.rejects(
      () => fetchWithRetry('/x.zip', {}, { fetchImpl: fakeFetch, baseDelayMs: 1 }),
      /404/
    );
    assert.equal(calls, 1);
  });

  it('reintenta 503 até o limite', async () => {
    let calls = 0;
    const fakeFetch = async () => { calls++; return { ok: false, status: 503 }; };
    await assert.rejects(
      () => fetchWithRetry('/x.zip', {}, { fetchImpl: fakeFetch, attempts: 3, baseDelayMs: 1 }),
      /503/
    );
    assert.equal(calls, 3);
  });

  it('desiste após o número de tentativas', async () => {
    let calls = 0;
    const fakeFetch = async () => { calls++; throw new Error('network'); };
    await assert.rejects(
      () => fetchWithRetry('/x.zip', {}, { fetchImpl: fakeFetch, attempts: 3, baseDelayMs: 1 })
    );
    assert.equal(calls, 3);
  });

  it('propaga AbortError sem reintentar', async () => {
    let calls = 0;
    const fakeFetch = async () => {
      calls++;
      throw new DOMException('abort', 'AbortError');
    };
    await assert.rejects(() => fetchWithRetry('/x.zip', {}, { fetchImpl: fakeFetch, baseDelayMs: 1 }));
    assert.equal(calls, 1);
  });

  it('cancelamento interrompe o backoff, não só o fetch', async () => {
    const controller = new AbortController();
    let calls = 0;
    const fakeFetch = async () => {
      calls++;
      // O cancelamento chega enquanto a próxima espera já começou.
      setTimeout(() => controller.abort(), 5);
      throw new Error('network');
    };

    const started = Date.now();
    await assert.rejects(
      () => fetchWithRetry('/x.zip', {}, {
        fetchImpl: fakeFetch,
        attempts: 5,
        baseDelayMs: 5000,
        jitter: false,
        signal: controller.signal
      }),
      (error) => error.name === 'AbortError'
    );
    assert.equal(calls, 1);
    // Não esperou os 5 s do backoff.
    assert.ok(Date.now() - started < 1000);
  });

  it('não tenta de novo depois de um cancelamento já registrado', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const fakeFetch = async () => { calls++; return { ok: true, status: 200 }; };
    await assert.rejects(
      () => fetchWithRetry('/x.zip', {}, { fetchImpl: fakeFetch, signal: controller.signal }),
      (error) => error.name === 'AbortError'
    );
    assert.equal(calls, 0);
  });

  it('trata prazo estourado como retentável', async () => {
    let calls = 0;
    // Conexão pendurada: só termina quando alguém aborta.
    const hangingFetch = (url, init) =>
      new Promise((_, reject) => {
        calls++;
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });

    await assert.rejects(
      () => fetchWithRetry('/x.zip', {}, {
        fetchImpl: hangingFetch,
        attempts: 3,
        baseDelayMs: 1,
        timeoutMs: 15
      }),
      /Tempo esgotado/
    );
    assert.equal(calls, 3);
  });

  it('cancelamento durante um fetch pendurado não vira retentativa', async () => {
    const controller = new AbortController();
    let calls = 0;
    const hangingFetch = (url, init) =>
      new Promise((_, reject) => {
        calls++;
        setTimeout(() => controller.abort(), 5);
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });

    await assert.rejects(
      () => fetchWithRetry('/x.zip', {}, {
        fetchImpl: hangingFetch,
        attempts: 3,
        baseDelayMs: 1,
        timeoutMs: 5000,
        signal: controller.signal
      }),
      (error) => error.name === 'AbortError'
    );
    assert.equal(calls, 1);
  });

  it('não deixa o prazo matar a leitura do corpo depois dos cabeçalhos', async () => {
    /** @type {AbortSignal | null} */
    let seen = null;
    const fakeFetch = async (url, init) => {
      seen = init.signal;
      return { ok: true, status: 200 };
    };
    const res = await fetchWithRetry('/x.zip', {}, { fetchImpl: fakeFetch, timeoutMs: 10 });
    assert.equal(res.ok, true);
    await new Promise((resolve) => setTimeout(resolve, 40));
    // O timer foi desarmado ao chegar a resposta: o corpo pode demorar à vontade.
    assert.equal(seen.aborted, false);
  });

  it('respeita o teto de tempo total', async () => {
    let calls = 0;
    const fakeFetch = async () => { calls++; throw new Error('network'); };
    const started = Date.now();
    await assert.rejects(
      () => fetchWithRetry('/x.zip', {}, {
        fetchImpl: fakeFetch,
        attempts: 50,
        baseDelayMs: 20,
        maxDelayMs: 20,
        jitter: false,
        maxElapsedMs: 120
      })
    );
    assert.ok(calls < 50, `esperava desistir antes das 50 tentativas, foram ${calls}`);
    assert.ok(Date.now() - started < 2000);
  });
});

describe('excludeSkippedPartFromBytesTotal', () => {
  it('encolhe o total pelo tamanho da parte pulada', () => {
    assert.equal(excludeSkippedPartFromBytesTotal(300_000_000, 90_000_000), 210_000_000);
  });

  it('acumula ao longo de várias partes puladas, simulando uma retomada', () => {
    // 17 partes de ~17.6 MB cada (~300 MB); retomando na parte 13, as 12
    // primeiras são puladas.
    const partSize = 17_647_058;
    let bytesTotal = 300_000_000;
    for (let i = 0; i < 12; i++) {
      bytesTotal = excludeSkippedPartFromBytesTotal(bytesTotal, partSize);
    }
    // Sobra o suficiente para as 5 partes restantes, não os 300 MB originais:
    // sem o ajuste, o download terminaria com bytesDownloaded (~90 MB) bem
    // abaixo de bytesTotal (300 MB) mesmo com sucesso e barra em 100%.
    assert.ok(bytesTotal < 100_000_000, `esperava bem menos que 100 MB restantes, ficou ${bytesTotal}`);
    assert.ok(bytesTotal > 0);
  });

  it('preserva null quando o manifesto não permite estimar (size ausente/ inválido em alguma parte)', () => {
    assert.equal(excludeSkippedPartFromBytesTotal(null, 90_000_000), null);
  });

  it('ignora tamanho de parte inválido e mantém o total como estava', () => {
    assert.equal(excludeSkippedPartFromBytesTotal(300_000_000, undefined), 300_000_000);
    assert.equal(excludeSkippedPartFromBytesTotal(300_000_000, 0), 300_000_000);
    assert.equal(excludeSkippedPartFromBytesTotal(300_000_000, -5), 300_000_000);
  });

  it('nunca fica negativo mesmo se a soma das partes puladas exceder o total', () => {
    assert.equal(excludeSkippedPartFromBytesTotal(10, 90_000_000), 0);
  });
});
