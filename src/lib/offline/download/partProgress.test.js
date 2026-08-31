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
  fetchWithRetry
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
