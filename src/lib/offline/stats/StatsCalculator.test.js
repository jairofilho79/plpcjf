/**
 * StatsCalculator tests
 *
 * Verifies that after the refactor the calculator reads from IndexedDB
 * (via OfflineInventoryRepository) and NOT from the Cache API or Service Worker.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockPersistedSet = new Set();

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$lib/offline/storage/OfflineInventoryRepository.js', () => ({
  default: {
    getPersistedLookupSet: vi.fn().mockResolvedValue(mockPersistedSet),
    computeMissingPdfs: vi.fn((louvores, set) => louvores.filter((l) => !set.has(l.pdfId)))
  }
}));

vi.mock('$lib/utils/statsCache.js', () => ({
  getCachedStats: vi.fn().mockReturnValue(null),
  cacheStats: vi.fn(),
  invalidateCategory: vi.fn(),
  invalidateCategories: vi.fn(),
  getAllCachedStats: vi.fn().mockReturnValue({}),
  isCacheValid: vi.fn().mockReturnValue(true)
}));

vi.mock('$lib/offline/core/OfflineRevision.js', () => ({
  getCurrentStatsRevision: vi.fn().mockReturnValue('rev-1')
}));

vi.mock('$lib/offline/utils/OfflineLogger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() })
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeLouvores(category, pdfIds) {
  return pdfIds.map((pdfId) => ({ pdfId, categoria: category }));
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('StatsCalculator', () => {
  let calculator;

  beforeEach(async () => {
    mockPersistedSet.clear();
    vi.clearAllMocks();

    const mod = await import('./StatsCalculator.js?t=' + Date.now());
    calculator = mod.default;
    calculator.invalidateAll();
  });

  it('returns zero stats when no louvores exist for category', async () => {
    const result = await calculator.getCategoryStats('EmptyCat', {
      louvoresData: makeLouvores('OtherCat', ['a', 'b']),
      forceRecalculate: true
    });
    expect(result).toEqual({ total: 0, available: 0, missing: 0, percentage: 0 });
  });

  it('computes correct stats using IDB set (all persisted)', async () => {
    const louvores = makeLouvores('TestCat', ['p1', 'p2', 'p3']);
    mockPersistedSet.add('p1');
    mockPersistedSet.add('p2');
    mockPersistedSet.add('p3');

    const { default: invRepo } = await import('$lib/offline/storage/OfflineInventoryRepository.js');
    invRepo.computeMissingPdfs.mockImplementation((l, s) => l.filter((x) => !s.has(x.pdfId)));

    const result = await calculator.getCategoryStats('TestCat', {
      louvoresData: louvores,
      forceRecalculate: true
    });

    expect(result.total).toBe(3);
    expect(result.available).toBe(3);
    expect(result.missing).toBe(0);
    expect(result.percentage).toBe(100);
  });

  it('computes correct stats when some PDFs are missing', async () => {
    const louvores = makeLouvores('TestCat', ['p1', 'p2', 'p3']);
    mockPersistedSet.add('p1'); // only p1 persisted

    const { default: invRepo } = await import('$lib/offline/storage/OfflineInventoryRepository.js');
    invRepo.computeMissingPdfs.mockImplementation((l, s) => l.filter((x) => !s.has(x.pdfId)));

    const result = await calculator.getCategoryStats('TestCat', {
      louvoresData: louvores,
      forceRecalculate: true
    });

    expect(result.total).toBe(3);
    expect(result.available).toBe(1);
    expect(result.missing).toBe(2);
    expect(result.percentage).toBe(33);
  });

  it('does NOT call getCachedPDFsFast (Cache API)', async () => {
    // Ensure swRegistration is not imported during stats calculation
    const swMod = await vi.importMock('$lib/utils/swRegistration.js').catch(() => null);
    if (swMod) {
      expect(swMod.getCachedPDFsFast).not.toHaveBeenCalled();
    }
  });

  it('reuses persisted set across getAllStats call', async () => {
    const louvores = [
      ...makeLouvores('CatA', ['a1', 'a2']),
      ...makeLouvores('CatB', ['b1'])
    ];

    const { default: invRepo } = await import('$lib/offline/storage/OfflineInventoryRepository.js');
    invRepo.getPersistedLookupSet.mockResolvedValueOnce(new Set(['a1', 'a2', 'b1']));
    invRepo.computeMissingPdfs.mockImplementation((l, s) => l.filter((x) => !s.has(x.pdfId)));

    const allStats = await calculator.getAllStats({
      louvoresData: louvores,
      forceRecalculate: true
    });

    // getPersistedLookupSet should only be called once (shared set)
    expect(invRepo.getPersistedLookupSet).toHaveBeenCalledTimes(1);
    expect(allStats['CatA'].percentage).toBe(100);
    expect(allStats['CatB'].percentage).toBe(100);
  });

  it('invalidateAll clears memory cache', () => {
    calculator.memoryCache.set('X', { stats: {}, timestamp: Date.now() });
    calculator.invalidateAll();
    expect(calculator.memoryCache.size).toBe(0);
  });
});
