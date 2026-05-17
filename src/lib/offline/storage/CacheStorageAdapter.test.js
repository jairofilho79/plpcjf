import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

const { mockGetConfig, mockPutAsset } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockPutAsset: vi.fn()
}));

vi.mock('../core/OfflineConfig.js', () => ({
  getConfig: mockGetConfig
}));

vi.mock('./IndexedDbAssetRepository.js', () => ({
  default: {
    putAsset: mockPutAsset,
    getAssetBlob: vi.fn(),
    deleteAsset: vi.fn(),
    listAssets: vi.fn()
  }
}));

vi.mock('../utils/OfflineLogger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() })
}));

vi.mock('../core/OfflineEvents.js', () => ({
  default: { emit: vi.fn() },
  EVENTS: {}
}));

import { CacheStorageAdapter } from './CacheStorageAdapter.js';

describe('CacheStorageAdapter IDB write-only mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockImplementation((key) => {
      if (key === 'OFFLINE_IDB_ENABLED') return true;
      if (key === 'OFFLINE_IDB_WRITE_ONLY') return true;
      if (key === 'PDF_CACHE_NAME') return 'plpc-pdfs';
      return undefined;
    });

    vi.stubGlobal('caches', {
      open: vi.fn().mockResolvedValue({
        put: vi.fn()
      })
    });

    vi.stubGlobal('window', {
      location: { origin: 'https://example.com' }
    });

    vi.stubGlobal('navigator', {});
  });

  it('does not write PDFs to Cache API when IndexedDB write-only is enabled', async () => {
    mockPutAsset.mockResolvedValue(true);
    const adapter = new CacheStorageAdapter('plpc-pdfs');

    await adapter._putPdfInternal('assets/Cat/001.pdf', new Blob(['pdf'], { type: 'application/pdf' }));

    expect(caches.open).not.toHaveBeenCalled();
    expect(mockPutAsset).toHaveBeenCalledOnce();
  });

  it('throws when IndexedDB write fails in write-only mode', async () => {
    mockPutAsset.mockRejectedValue(new DOMException('Quota exceeded', 'QuotaExceededError'));
    const adapter = new CacheStorageAdapter('plpc-pdfs');

    await expect(
      adapter._putPdfInternal('assets/Cat/001.pdf', new Blob(['pdf'], { type: 'application/pdf' }))
    ).rejects.toMatchObject({ errorCode: 'QUOTA_EXCEEDED' });
  });
});
