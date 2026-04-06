import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function createLocalStorageMock() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    }
  };
}

describe('louvoresManifestChecksum', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('sha256HexUtf8 matches known empty string digest', async () => {
    const h = await sha256HexUtf8('');
    expect(h).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('parseExpectedChecksumFromResponseBody accepts 64 hex and lowercases', () => {
    const u = 'ABCDEF0123456789'.repeat(4);
    expect(parseExpectedChecksumFromResponseBody(`  ${u}  `)).toBe(u.toLowerCase());
    expect(parseExpectedChecksumFromResponseBody('not-hex')).toBe(null);
    expect(parseExpectedChecksumFromResponseBody('')).toBe(null);
  });

  it('shouldFetchExpectedChecksum requires baseline, online, and 24h window', async () => {
    const body = '[{"pdfId":"x"}]';
    const hash = await sha256HexUtf8(body);
    writeManifestBodySha256(hash);
    const now = 1_000_000_000_000;

    expect(shouldFetchExpectedChecksum(now, false)).toBe(false);
    expect(shouldFetchExpectedChecksum(now, true)).toBe(true);

    writeChecksumLastOkAt(now);
    expect(shouldFetchExpectedChecksum(now + 1, true)).toBe(false);
    expect(shouldFetchExpectedChecksum(now + 24 * 60 * 60 * 1000, true)).toBe(true);
  });

  it('recordManifestSyncFailure applies 1–2–4–8–16 min then 24h cooldown', () => {
    vi.useFakeTimers();
    const t0 = 10_000_000_000_000;
    vi.setSystemTime(t0);
    resetManifestSyncPenalty();

    let t = t0;
    for (let i = 0; i < 4; i++) {
      recordManifestSyncFailure(t);
      const p = readManifestSyncPenalty();
      expect(p.failStreak).toBe(i + 1);
      expect(p.cooldownUntil).toBe(0);
      expect(p.nextRetryAt).toBe(t + MANIFEST_SYNC_RETRY_DELAYS_MIN[i] * 60_000);
      t = p.nextRetryAt;
      vi.setSystemTime(t);
    }

    recordManifestSyncFailure(t);
    const final = readManifestSyncPenalty();
    expect(final.failStreak).toBe(0);
    expect(final.nextRetryAt).toBe(0);
    expect(final.cooldownUntil).toBe(t + 24 * 60 * 60 * 1000);
  });
});
