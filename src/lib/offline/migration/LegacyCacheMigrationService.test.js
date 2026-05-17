/**
 * LegacyCacheMigrationService tests
 *
 * Covers:
 *  - Checkpoint persistence and resumption
 *  - Cancellation between batches
 *  - isMigrationNeeded detection
 *  - Safe IDB write before Cache API delete
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$lib/offline/core/OfflineConfig.js', () => ({
  getConfig: vi.fn((key) => {
    if (key === 'OFFLINE_MIGRATION_BATCH_SIZE') return 2;
    if (key === 'OFFLINE_MIGRATION_YIELD_MS') return 0;
    return undefined;
  })
}));

vi.mock('$lib/offline/storage/OfflineInventoryRepository.js', () => ({
  default: {
    _repo: {
      hasAsset: vi.fn().mockResolvedValue(false)
    },
    storePdf: vi.fn().mockResolvedValue(true)
  }
}));

vi.mock('$lib/offline/utils/OfflineLogger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() })
}));

vi.mock('$lib/offline/utils/PdfPathManager.js', () => ({
  default: {
    normalizeForStorage: vi.fn((p) => p.replace(/^\/+/, ''))
  }
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFakeCache(pdfUrls) {
  const deleted = new Set();
  const keys = pdfUrls.map((u) => ({ url: u }));
  return {
    keys: vi.fn().mockResolvedValue(keys),
    match: vi.fn().mockImplementation((req) => {
      if (deleted.has(req.url)) return Promise.resolve(null);
      return Promise.resolve({
        blob: () => Promise.resolve(new Blob(['pdf'], { type: 'application/pdf' }))
      });
    }),
    delete: vi.fn().mockImplementation((req) => {
      deleted.add(req.url);
      return Promise.resolve(true);
    }),
    _deleted: deleted
  };
}

// localStorage mock
const localStorageData = {};
const localStorageMock = {
  getItem: vi.fn((k) => localStorageData[k] ?? null),
  setItem: vi.fn((k, v) => { localStorageData[k] = v; }),
  removeItem: vi.fn((k) => { delete localStorageData[k]; })
};

// ── Suite ────────────────────────────────────────────────────────────────────

describe('LegacyCacheMigrationService', () => {
  let svc;
  let fakeCache;

  beforeEach(async () => {
    Object.keys(localStorageData).forEach((k) => delete localStorageData[k]);
    vi.clearAllMocks();

    fakeCache = makeFakeCache([
      'https://example.com/assets/Cat/001.pdf',
      'https://example.com/assets/Cat/002.pdf',
      'https://example.com/assets/Cat/003.pdf'
    ]);

    global.caches = {
      open: vi.fn().mockResolvedValue(fakeCache)
    };
    Object.defineProperty(global, 'localStorage', { value: localStorageMock, configurable: true });

    // Re-import fresh instance each test
    const mod = await import('./LegacyCacheMigrationService.js?t=' + Date.now());
    svc = mod.default;
    svc.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('migrates all PDF entries and marks as done', async () => {
    const result = await svc.migrate();
    expect(result.migrated).toBe(3);
    expect(result.cancelled).toBe(false);
    expect(svc.isCompleted()).toBe(true);
  });

  it('reports progress via callback', async () => {
    const calls = [];
    await svc.migrate({ onProgress: (p) => calls.push({ ...p }) });
    // should have at least one call for each batch (batchSize=2 → 2 batches)
    expect(calls.length).toBeGreaterThan(0);
    const last = calls[calls.length - 1];
    expect(last.migrated).toBe(3);
    expect(last.percentage).toBe(100);
  });

  it('skips entries already in IDB', async () => {
    const { default: invRepo } = await import('$lib/offline/storage/OfflineInventoryRepository.js');
    invRepo._repo.hasAsset.mockResolvedValue(true); // all already in IDB

    const result = await svc.migrate();
    expect(result.migrated).toBe(0);
    // 2 legacy caches × 3 entries each = 6 total skipped
    expect(result.skipped).toBe(6);
  });

  it('can be cancelled between batches', async () => {
    let batchCount = 0;
    await svc.migrate({
      onProgress: () => {
        batchCount++;
        if (batchCount === 1) svc.cancel();
      }
    });

    // cancelled before completing all 3
    expect(svc.isCompleted()).toBe(false);
    expect(svc.isRunning()).toBe(false);
  });

  it('is resumable: continues from checkpoint after cancellation', async () => {
    // Cancel after first batch (processes 2 of 3)
    let cancelled = false;
    await svc.migrate({
      onProgress: (p) => {
        if (p.processed >= 2 && !cancelled) {
          cancelled = true;
          svc.cancel();
        }
      }
    });

    const checkpointBefore = svc.getCheckpoint();
    expect(checkpointBefore.processed).toBeGreaterThan(0);

    // Reset invRepo mock so the remaining entries are "not in IDB" again
    const { default: invRepo } = await import('$lib/offline/storage/OfflineInventoryRepository.js');
    invRepo._repo.hasAsset.mockResolvedValue(false);

    // Re-run: should pick up from checkpoint (only processes remaining)
    const result2 = await svc.migrate();
    expect(result2.cancelled).toBe(false);
    expect(svc.isCompleted()).toBe(true);
  });

  it('does not delete from cache when IDB write is not called (already existed)', async () => {
    const { default: invRepo } = await import('$lib/offline/storage/OfflineInventoryRepository.js');
    invRepo._repo.hasAsset.mockResolvedValue(true); // all pre-exist

    await svc.migrate();
    // cache.delete should not have been called for entries that already existed
    // (we skip IDB write AND cache delete)
    expect(fakeCache.delete).not.toHaveBeenCalled();
  });

  it('isMigrationNeeded returns true when cache has PDFs', async () => {
    svc.reset();
    const needed = await svc.isMigrationNeeded();
    expect(needed).toBe(true);
  });

  it('isMigrationNeeded returns false after migration is completed', async () => {
    await svc.migrate();
    const needed = await svc.isMigrationNeeded();
    expect(needed).toBe(false);
  });
});
