import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

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

const showInfoSnackbarMock = vi.fn();
const showSuccessSnackbarMock = vi.fn();
const showErrorSnackbarMock = vi.fn();
const dismissSnackbarMock = vi.fn();
vi.mock('$lib/utils/appSnackbar.js', () => ({
  showInfoSnackbar: showInfoSnackbarMock,
  showSuccessSnackbar: showSuccessSnackbarMock,
  showErrorSnackbar: showErrorSnackbarMock,
  dismissSnackbar: dismissSnackbarMock
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

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('louvores versioning refresh', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    vi.stubGlobal('localStorage', createLocalStorageMock());
    vi.stubGlobal('navigator', { onLine: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('replaces stale manifest with no-store fetch when version changes', async () => {
    const staleManifest = [{ id: 'stale', nome: 'Manifesto Antigo', pdfId: 'abc' }];
    const freshManifest = [{ id: 'fresh', nome: 'Manifesto Novo', pdfId: 'def' }];

    global.fetch = vi.fn(async (url, init = {}) => {
      if (url === '/louvores-version.json') {
        return jsonResponse({ version: 2 });
      }

      if (url === '/louvores-manifest.json') {
        if (init?.cache === 'no-store') {
          return jsonResponse(freshManifest);
        }
        return jsonResponse(staleManifest);
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const { loadLouvores, louvores, LOUVORES_MANIFEST_VERSION_KEY } = await import('./louvores.js');
    localStorage.setItem(LOUVORES_MANIFEST_VERSION_KEY, '1');

    await loadLouvores();

    // First load can still use cached/stale manifest before background refresh.
    expect(get(louvores).map((item) => item.id)).toEqual(['stale']);

    // Allow microtask + async refresh chain to finish.
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(clearLouvoresManifestFromSwCacheMock).toHaveBeenCalledTimes(1);
    expect(get(louvores).map((item) => item.id)).toEqual(['fresh']);
    expect(localStorage.getItem(LOUVORES_MANIFEST_VERSION_KEY)).toBe('2');
    expect(checkForNewPDFsMock).toHaveBeenCalledTimes(1);
    expect(showInfoSnackbarMock).toHaveBeenCalledTimes(1);
    expect(showSuccessSnackbarMock).toHaveBeenCalledTimes(1);
    expect(showErrorSnackbarMock).not.toHaveBeenCalled();
    expect(dismissSnackbarMock).toHaveBeenCalledTimes(1);
  });

  it('when data is already in memory, refreshes directly in background with no-store', async () => {
    const memoryManifest = [{ id: 'memory', nome: 'Em Memoria', pdfId: 'mem' }];
    const freshManifest = [{ id: 'fresh-2', nome: 'Novo 2', pdfId: 'new2' }];

    global.fetch = vi.fn(async (url, init = {}) => {
      if (url === '/louvores-version.json') {
        return jsonResponse({ version: 6 });
      }

      if (url === '/louvores-manifest.json') {
        if (init?.cache === 'no-store') {
          return jsonResponse(freshManifest);
        }
        return jsonResponse(memoryManifest);
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const { loadLouvores, louvores, LOUVORES_MANIFEST_VERSION_KEY } = await import('./louvores.js');
    localStorage.setItem(LOUVORES_MANIFEST_VERSION_KEY, '5');

    louvores.set(memoryManifest);
    await loadLouvores();

    // With in-memory data and version mismatch, should keep memory initially.
    expect(get(louvores).map((item) => item.id)).toEqual(['memory']);

    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(clearLouvoresManifestFromSwCacheMock).toHaveBeenCalledTimes(1);
    expect(get(louvores).map((item) => item.id)).toEqual(['fresh-2']);
    expect(localStorage.getItem(LOUVORES_MANIFEST_VERSION_KEY)).toBe('6');

    const manifestFetchCalls = global.fetch.mock.calls.filter(([url]) => url === '/louvores-manifest.json');
    expect(manifestFetchCalls).toHaveLength(1);
    expect(manifestFetchCalls[0][1]).toMatchObject({ cache: 'no-store' });
    expect(showInfoSnackbarMock).toHaveBeenCalledTimes(1);
    expect(showSuccessSnackbarMock).toHaveBeenCalledTimes(1);
    expect(showErrorSnackbarMock).not.toHaveBeenCalled();
    expect(dismissSnackbarMock).toHaveBeenCalledTimes(1);
  });

  it('forceRefreshLouvoresFromNetwork runs same pipeline when online', async () => {
    const freshManifest = [{ id: 'forced', nome: 'Forcado', pdfId: 'f1' }];

    global.fetch = vi.fn(async (url, init = {}) => {
      if (url === '/louvores-version.json') {
        return jsonResponse({ version: 9 });
      }
      if (url === '/louvores-manifest.json') {
        expect(init?.cache).toBe('no-store');
        return jsonResponse(freshManifest);
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const { forceRefreshLouvoresFromNetwork, louvores, LOUVORES_MANIFEST_VERSION_KEY } = await import('./louvores.js');
    localStorage.setItem(LOUVORES_MANIFEST_VERSION_KEY, '8');

    await forceRefreshLouvoresFromNetwork();

    expect(clearLouvoresManifestFromSwCacheMock).toHaveBeenCalledTimes(1);
    expect(get(louvores).map((item) => item.id)).toEqual(['forced']);
    expect(localStorage.getItem(LOUVORES_MANIFEST_VERSION_KEY)).toBe('9');
    expect(checkForNewPDFsMock).toHaveBeenCalledTimes(1);
    expect(showInfoSnackbarMock).toHaveBeenCalledTimes(1);
    expect(showSuccessSnackbarMock).toHaveBeenCalledTimes(1);
    expect(showErrorSnackbarMock).not.toHaveBeenCalled();
    expect(dismissSnackbarMock).toHaveBeenCalledTimes(1);
  });

  it('forceRefreshLouvoresFromNetwork shows error and skips pipeline when offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    global.fetch = vi.fn();

    const { forceRefreshLouvoresFromNetwork } = await import('./louvores.js');

    await forceRefreshLouvoresFromNetwork();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(clearLouvoresManifestFromSwCacheMock).not.toHaveBeenCalled();
    expect(showErrorSnackbarMock).toHaveBeenCalledTimes(1);
    expect(showInfoSnackbarMock).not.toHaveBeenCalled();
  });
});
