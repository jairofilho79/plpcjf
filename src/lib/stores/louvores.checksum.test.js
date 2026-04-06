import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({
  browser: true
}));

const clearLouvoresManifestFromSwCacheMock = vi.fn();
vi.mock('$lib/utils/swRegistration', () => ({
  clearLouvoresManifestFromSwCache: clearLouvoresManifestFromSwCacheMock
}));

vi.mock('$lib/utils/louvorSearch', () => ({
  tokensContent: (value) => [`tok:${value}`],
  normalizeForSearch: (value) => String(value ?? '').toLowerCase()
}));

const updatePdfIndexInBackgroundMock = vi.fn();
vi.mock('$lib/utils/pdfIndex', () => ({
  updatePdfIndexInBackground: updatePdfIndexInBackgroundMock
}));

const checkForNewPDFsMock = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/stores/offline.js', () => ({
  offline: {
    checkForNewPDFs: checkForNewPDFsMock
  }
}));

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

import {
  LOUVORES_MANIFEST_CHECKSUM_URL,
  sha256HexUtf8,
  writeChecksumLastOkAt,
  writeManifestBodySha256
} from '$lib/utils/louvoresManifestChecksum.js';

describe('maybeCheckLouvoresManifestFromServer', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('localStorage', createLocalStorageMock());
    vi.stubGlobal('navigator', { onLine: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('não chama fetch quando offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    global.fetch = vi.fn();
    const { maybeCheckLouvoresManifestFromServer } = await import('./louvores.js');
    await maybeCheckLouvoresManifestFromServer();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('não chama fetch sem baseline de hash local', async () => {
    global.fetch = vi.fn();
    const { maybeCheckLouvoresManifestFromServer } = await import('./louvores.js');
    await maybeCheckLouvoresManifestFromServer();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('com baseline e janela 24h: GET checksum só; se igual, atualiza lastOk e não baixa manifesto', async () => {
    const manifestBody = JSON.stringify([{ id: 'a', nome: 'A', pdfId: 'p1' }]);
    const hash = await sha256HexUtf8(manifestBody);
    writeManifestBodySha256(hash);
    writeChecksumLastOkAt(0);

    global.fetch = vi.fn(async (url) => {
      if (url === LOUVORES_MANIFEST_CHECKSUM_URL) {
        return new Response(hash, { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
      throw new Error(`unexpected ${url}`);
    });

    const { maybeCheckLouvoresManifestFromServer } = await import('./louvores.js');
    await maybeCheckLouvoresManifestFromServer();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe(LOUVORES_MANIFEST_CHECKSUM_URL);
    expect(clearLouvoresManifestFromSwCacheMock).not.toHaveBeenCalled();
  });

  it('204 no checksum: noop', async () => {
    const manifestBody = JSON.stringify([{ nome: 'A', pdfId: 'p1' }]);
    const hash = await sha256HexUtf8(manifestBody);
    writeManifestBodySha256(hash);
    writeChecksumLastOkAt(0);

    global.fetch = vi.fn(async (url) => {
      if (url === LOUVORES_MANIFEST_CHECKSUM_URL) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${url}`);
    });

    const { maybeCheckLouvoresManifestFromServer } = await import('./louvores.js');
    await maybeCheckLouvoresManifestFromServer();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(clearLouvoresManifestFromSwCacheMock).not.toHaveBeenCalled();
  });

  it('checksum diferente e manifesto com hash correto: aplica e chama checkForNewPDFs', async () => {
    const oldBody = JSON.stringify([{ nome: 'Old', pdfId: 'o1' }]);
    const newBody = JSON.stringify([{ nome: 'New', pdfId: 'n1' }]);
    const oldHash = await sha256HexUtf8(oldBody);
    const newHash = await sha256HexUtf8(newBody);
    writeManifestBodySha256(oldHash);
    writeChecksumLastOkAt(0);

    global.fetch = vi.fn(async (url, init) => {
      if (url === LOUVORES_MANIFEST_CHECKSUM_URL) {
        return new Response(newHash, { status: 200 });
      }
      if (url === '/louvores-manifest.json') {
        expect(init?.cache).toBe('no-store');
        return new Response(newBody, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected ${url}`);
    });

    const { maybeCheckLouvoresManifestFromServer, louvores } = await import('./louvores.js');
    const { get } = await import('svelte/store');
    await maybeCheckLouvoresManifestFromServer();

    expect(clearLouvoresManifestFromSwCacheMock).toHaveBeenCalledTimes(1);
    expect(checkForNewPDFsMock).toHaveBeenCalledTimes(1);
    expect(get(louvores).map((x) => x.pdfId)).toEqual(['n1']);
  });

  it('checksum diferente mas corpo do manifesto não bate: descarta e não altera store', async () => {
    const oldBody = JSON.stringify([{ nome: 'Old', pdfId: 'o1' }]);
    const newBody = JSON.stringify([{ nome: 'New', pdfId: 'n1' }]);
    const oldHash = await sha256HexUtf8(oldBody);
    const wrongBody = JSON.stringify([{ nome: 'Other', pdfId: 'x1' }]);
    const newHash = await sha256HexUtf8(newBody);
    writeManifestBodySha256(oldHash);
    writeChecksumLastOkAt(0);

    global.fetch = vi.fn(async (url) => {
      if (url === LOUVORES_MANIFEST_CHECKSUM_URL) {
        return new Response(newHash, { status: 200 });
      }
      if (url === '/louvores-manifest.json') {
        return new Response(wrongBody, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected ${url}`);
    });

    const { maybeCheckLouvoresManifestFromServer, louvores } = await import('./louvores.js');
    const { get } = await import('svelte/store');
    louvores.set([{ nome: 'Keep', pdfId: 'k1' }]);

    await maybeCheckLouvoresManifestFromServer();

    expect(get(louvores).map((x) => x.pdfId)).toEqual(['k1']);
    expect(checkForNewPDFsMock).not.toHaveBeenCalled();
  });
});
