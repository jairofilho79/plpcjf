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

describe('louvores manifest (só atualização manual; sem versão)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    vi.stubGlobal('localStorage', createLocalStorageMock());
    vi.stubGlobal('navigator', { onLine: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('loadLouvores busca apenas o manifesto', async () => {
    const manifest = [{ id: 'a', nome: 'Louvor A', pdfId: 'p1' }];

    global.fetch = vi.fn(async (url) => {
      if (url === '/louvores-manifest.json') {
        return jsonResponse(manifest);
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const { loadLouvores, louvores } = await import('./louvores.js');

    await loadLouvores();

    expect(global.fetch.mock.calls.every(([u]) => u === '/louvores-manifest.json')).toBe(true);
    expect(get(louvores).map((item) => item.id)).toEqual(['a']);
    expect(clearLouvoresManifestFromSwCacheMock).not.toHaveBeenCalled();
    expect(showInfoSnackbarMock).not.toHaveBeenCalled();
    expect(checkForNewPDFsMock).not.toHaveBeenCalled();
  });

  it('loadLouvores com dados em memória não refaz fetch', async () => {
    const memoryManifest = [{ id: 'mem', nome: 'Em Memoria', pdfId: 'm1' }];

    global.fetch = vi.fn();

    const { loadLouvores, louvores } = await import('./louvores.js');
    louvores.set(memoryManifest);

    await loadLouvores();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(get(louvores).map((item) => item.id)).toEqual(['mem']);
    expect(clearLouvoresManifestFromSwCacheMock).not.toHaveBeenCalled();
  });

  it('loadLouvores tenta segunda onda no-store se a primeira resposta for vazia', async () => {
    const valid = [{ id: 'ok', nome: 'OK', pdfId: 'x' }];

    global.fetch = vi.fn(async (url, init = {}) => {
      if (url !== '/louvores-manifest.json') {
        throw new Error(`Unexpected fetch URL: ${url}`);
      }
      if (init.cache === 'no-store') {
        return jsonResponse(valid);
      }
      return jsonResponse([]);
    });

    const { loadLouvores, louvores } = await import('./louvores.js');

    await loadLouvores();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(get(louvores).map((item) => item.id)).toEqual(['ok']);
  });

  it('loadLouvores descarta resultado obsoleto quando duas cargas concorrem', async () => {
    vi.useFakeTimers();
    const oldManifest = [{ id: 'old', nome: 'Antigo', pdfId: 'old1' }];
    const newManifest = [{ id: 'new', nome: 'Novo', pdfId: 'new1' }];
    let callCount = 0;

    global.fetch = vi.fn(async (url) => {
      if (url !== '/louvores-manifest.json') {
        throw new Error(`Unexpected fetch URL: ${url}`);
      }
      callCount += 1;
      if (callCount === 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return jsonResponse(oldManifest);
      }
      return jsonResponse(newManifest);
    });

    const { loadLouvores, louvores } = await import('./louvores.js');

    const first = loadLouvores();
    const second = loadLouvores();

    await vi.runAllTimersAsync();
    await Promise.all([first, second]);

    expect(get(louvores).map((item) => item.id)).toEqual(['new']);
  });

  it('forceRefreshLouvoresFromNetwork aplica manifesto válido', async () => {
    const freshManifest = [{ id: 'forced', nome: 'Forcado', pdfId: 'f1' }];

    global.fetch = vi.fn(async (url, init = {}) => {
      if (url === '/louvores-manifest.json') {
        expect(init?.cache).toBe('no-store');
        return jsonResponse(freshManifest);
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const { forceRefreshLouvoresFromNetwork, louvores } = await import('./louvores.js');

    await forceRefreshLouvoresFromNetwork();

    expect(clearLouvoresManifestFromSwCacheMock).toHaveBeenCalledTimes(1);
    expect(get(louvores).map((item) => item.id)).toEqual(['forced']);
    expect(checkForNewPDFsMock).toHaveBeenCalledTimes(1);
    expect(showInfoSnackbarMock).toHaveBeenCalledTimes(1);
    expect(showSuccessSnackbarMock).toHaveBeenCalledTimes(1);
    expect(showErrorSnackbarMock).not.toHaveBeenCalled();
    expect(dismissSnackbarMock).toHaveBeenCalledTimes(1);
  });

  it('forceRefreshLouvoresFromNetwork reintenta após falha de rede e depois aplica', async () => {
    vi.useFakeTimers();
    const manifest = [{ nome: 'A', pdfId: '1' }];
    let n = 0;
    global.fetch = vi.fn(async (url) => {
      if (url !== '/louvores-manifest.json') throw new Error('bad url');
      n++;
      if (n < 3) throw new Error('network');
      return jsonResponse(manifest);
    });

    const { forceRefreshLouvoresFromNetwork, louvores } = await import('./louvores.js');

    const p = forceRefreshLouvoresFromNetwork();
    await vi.runAllTimersAsync();
    await p;

    expect(n).toBe(3);
    expect(get(louvores).length).toBe(1);
    expect(showSuccessSnackbarMock).toHaveBeenCalled();
  });

  it('forceRefreshLouvoresFromNetwork não substitui o store se o manifesto for vazio', async () => {
    const existing = [{ id: 'keep', nome: 'Manter', pdfId: 'k1' }];

    global.fetch = vi.fn(async (url, init = {}) => {
      if (url === '/louvores-manifest.json' && init?.cache === 'no-store') {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const { forceRefreshLouvoresFromNetwork, louvores } = await import('./louvores.js');
    louvores.set(existing);

    await forceRefreshLouvoresFromNetwork();

    expect(get(louvores).map((item) => item.id)).toEqual(['keep']);
    expect(showErrorSnackbarMock).toHaveBeenCalled();
    expect(showSuccessSnackbarMock).not.toHaveBeenCalled();
    expect(checkForNewPDFsMock).not.toHaveBeenCalled();
  });

  it('prepareLouvoresManifestPayload normaliza nome numérico e ignora linhas sem pdfId', async () => {
    const { prepareLouvoresManifestPayload } = await import('./louvores.js');
    expect(prepareLouvoresManifestPayload([])).toBe(null);
    expect(prepareLouvoresManifestPayload(null)).toBe(null);
    const a = prepareLouvoresManifestPayload([{ nome: 'x', pdfId: 'p' }]);
    expect(a).not.toBe(null);
    expect(a?.[0].nome).toBe('x');
    expect(prepareLouvoresManifestPayload([{ nome: 'x' }])).toBe(null);
    expect(prepareLouvoresManifestPayload([{ pdfId: 'p' }])).not.toBe(null);
    expect(prepareLouvoresManifestPayload([{ pdfId: 'p' }])?.[0].nome).toBe('');
    const num = prepareLouvoresManifestPayload([{ nome: 42, pdfId: 'p' }]);
    expect(num?.[0].nome).toBe('42');
    const mixed = prepareLouvoresManifestPayload([
      { nome: 'ok', pdfId: 'a' },
      { nome: 'bad', pdfId: '' },
      { nome: 'ok2', pdfId: 'b' }
    ]);
    expect(mixed?.length).toBe(2);
    expect(mixed?.map((x) => x.pdfId)).toEqual(['a', 'b']);
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
