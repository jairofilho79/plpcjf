/**
 * Checksum do louvores-manifest.json: janela de 24 h e backoff.
 * Run: node --test src/lib/utils/louvoresManifestChecksum.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MANIFEST_SYNC_RETRY_DELAYS_MIN,
  parseExpectedChecksumFromResponseBody,
  readManifestSyncPenalty,
  recordManifestSyncFailure,
  resetManifestSyncPenalty,
  sha256HexUtf8,
  shouldFetchExpectedChecksum,
  writeChecksumLastOkAt,
  writeManifestBodySha256
} from './louvoresManifestChecksum.js';

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

describe('louvoresManifestChecksum', () => {
  beforeEach(() => {
    // O módulo lê o `localStorage` global, não um parâmetro injetado.
    globalThis.localStorage = criarStorage();
  });

  afterEach(() => {
    delete globalThis.localStorage;
  });

  it('sha256HexUtf8 bate com o digest conhecido da string vazia', async () => {
    assert.equal(
      await sha256HexUtf8(''),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('parseExpectedChecksumFromResponseBody aceita 64 hex e devolve minúsculo', () => {
    const maiusculo = 'ABCDEF0123456789'.repeat(4);
    assert.equal(parseExpectedChecksumFromResponseBody(`  ${maiusculo}  `), maiusculo.toLowerCase());
    assert.equal(parseExpectedChecksumFromResponseBody('not-hex'), null);
    assert.equal(parseExpectedChecksumFromResponseBody(''), null);
  });

  it('shouldFetchExpectedChecksum exige baseline, estar online e a janela de 24 h', async () => {
    const corpo = '[{"pdfId":"x"}]';
    writeManifestBodySha256(await sha256HexUtf8(corpo));
    const agora = 1_000_000_000_000;

    assert.equal(shouldFetchExpectedChecksum(agora, false), false);
    assert.equal(shouldFetchExpectedChecksum(agora, true), true);

    writeChecksumLastOkAt(agora);
    assert.equal(shouldFetchExpectedChecksum(agora + 1, true), false);
    assert.equal(shouldFetchExpectedChecksum(agora + 24 * 60 * 60 * 1000, true), true);
  });

  it('recordManifestSyncFailure aplica 1–2–4–8–16 min e depois 24 h de espera', () => {
    const t0 = 10_000_000_000_000;
    resetManifestSyncPenalty();

    let t = t0;
    for (let i = 0; i < 4; i++) {
      recordManifestSyncFailure(t);
      const p = readManifestSyncPenalty();
      assert.equal(p.failStreak, i + 1);
      assert.equal(p.cooldownUntil, 0);
      assert.equal(p.nextRetryAt, t + MANIFEST_SYNC_RETRY_DELAYS_MIN[i] * 60_000);
      t = p.nextRetryAt;
    }

    recordManifestSyncFailure(t);
    const final = readManifestSyncPenalty();
    assert.equal(final.failStreak, 0);
    assert.equal(final.nextRetryAt, 0);
    assert.equal(final.cooldownUntil, t + 24 * 60 * 60 * 1000);
  });
});
