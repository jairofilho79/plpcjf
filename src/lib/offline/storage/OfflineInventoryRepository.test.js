/**
 * OfflineInventoryRepository tests
 *
 * Covers:
 *  - computeMissingPdfsDetailed: both pdfId-based and path-based matching
 *  - computeMissingPdfs: convenience wrapper
 *  - computeStats: per-category stats derived from persisted set
 *  - getPersistedLookupSet: delegates to repository
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OfflineInventoryRepository, PDF_STATUS } from './OfflineInventoryRepository.js';

// ── Stub repo ────────────────────────────────────────────────────────────────

function makeStubRepo(rows = []) {
  return {
    putAsset: vi.fn().mockResolvedValue(true),
    hasAsset: vi.fn().mockResolvedValue(false),
    hasByPdfId: vi.fn().mockResolvedValue(false),
    getAssetBlob: vi.fn().mockResolvedValue(null),
    listAssets: vi.fn().mockResolvedValue(rows.map((r) => r.id)),
    listAssetMeta: vi.fn().mockResolvedValue(rows),
    listAssetMetaByCategory: vi.fn().mockResolvedValue([]),
    getPersistedLookupSet: vi.fn().mockResolvedValue(
      new Set(rows.flatMap((r) => [r.id, r.pdfId].filter(Boolean)))
    ),
    countAssets: vi.fn().mockResolvedValue(rows.length)
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function louvor(pdfId, categoria = 'TestCat') {
  // pdfId is base64-UTF8 of an assets/ path.  For tests we use a simple ASCII
  // path so btoa works directly.
  return { pdfId, categoria };
}

function makePersistedSet(...pdfIds) {
  return new Set(pdfIds);
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('OfflineInventoryRepository', () => {
  let repo;
  let inv;

  beforeEach(() => {
    repo = makeStubRepo();
    inv = new OfflineInventoryRepository(repo);
  });

  // ── computeMissingPdfsDetailed ──────────────────────────────────────────

  describe('computeMissingPdfsDetailed', () => {
    it('returns empty lists when louvores array is empty', () => {
      const result = inv.computeMissingPdfsDetailed([], new Set());
      expect(result.confirmedMissing).toHaveLength(0);
      expect(result.unknown).toHaveLength(0);
    });

    it('returns all pdfId-bearing items as unknown when set is null', () => {
      const louvores = [louvor('abc123'), louvor(null)];
      const result = inv.computeMissingPdfsDetailed(louvores, null);
      expect(result.confirmedMissing).toHaveLength(0);
      expect(result.unknown).toHaveLength(1); // only the one with pdfId
    });

    it('marks louvor as persisted when pdfId is in the set', () => {
      const louvores = [louvor('abc123'), louvor('def456')];
      const set = makePersistedSet('abc123'); // only first is persisted
      const result = inv.computeMissingPdfsDetailed(louvores, set);
      expect(result.confirmedMissing).toHaveLength(1);
      expect(result.confirmedMissing[0].pdfId).toBe('def456');
    });

    it('skips louvores without pdfId', () => {
      const louvores = [{ pdfId: null, categoria: 'X' }, { pdfId: undefined, categoria: 'X' }];
      const result = inv.computeMissingPdfsDetailed(louvores, new Set());
      expect(result.confirmedMissing).toHaveLength(0);
    });

    it('matches via decoded path variants for legacy rows', () => {
      // 'assets/Col/001.pdf' encoded base64-ASCII (simple ASCII path for test)
      const pdfId = btoa('assets/Col/001.pdf');
      const louvores = [louvor(pdfId)];
      // Legacy row stored without pdfId but with normalized IDB key
      const set = makePersistedSet('/assets/Col/001.pdf');
      const result = inv.computeMissingPdfsDetailed(louvores, set);
      expect(result.confirmedMissing).toHaveLength(0);
    });
  });

  // ── computeMissingPdfs ──────────────────────────────────────────────────

  describe('computeMissingPdfs', () => {
    it('returns only confirmedMissing array', () => {
      const louvores = [louvor('pdfA'), louvor('pdfB')];
      const set = makePersistedSet('pdfA');
      const missing = inv.computeMissingPdfs(louvores, set);
      expect(missing).toHaveLength(1);
      expect(missing[0].pdfId).toBe('pdfB');
    });

    it('returns empty when all are persisted', () => {
      const louvores = [louvor('pdfA'), louvor('pdfB')];
      const set = makePersistedSet('pdfA', 'pdfB');
      expect(inv.computeMissingPdfs(louvores, set)).toHaveLength(0);
    });
  });

  // ── computeStats ────────────────────────────────────────────────────────

  describe('computeStats', () => {
    it('returns correct totals for a single category', async () => {
      const louvores = [louvor('p1', 'Cat'), louvor('p2', 'Cat'), louvor('p3', 'Cat')];
      const map = new Map([['Cat', louvores]]);
      const set = makePersistedSet('p1', 'p3'); // 2 of 3 persisted

      const stats = await inv.computeStats(['Cat'], map, set);
      const cat = stats.get('Cat');
      expect(cat.total).toBe(3);
      expect(cat.available).toBe(2);
      expect(cat.missing).toBe(1);
      expect(cat.percentage).toBe(67);
    });

    it('handles empty category', async () => {
      const stats = await inv.computeStats(['EmptyCat'], new Map([['EmptyCat', []]]), new Set());
      expect(stats.get('EmptyCat')).toEqual({ total: 0, available: 0, missing: 0, percentage: 0 });
    });

    it('handles multiple categories', async () => {
      const louvoresA = [louvor('a1', 'A'), louvor('a2', 'A')];
      const louvoresB = [louvor('b1', 'B')];
      const map = new Map([['A', louvoresA], ['B', louvoresB]]);
      const set = makePersistedSet('a1', 'a2', 'b1'); // all persisted

      const stats = await inv.computeStats(['A', 'B'], map, set);
      expect(stats.get('A').percentage).toBe(100);
      expect(stats.get('B').percentage).toBe(100);
    });
  });

  // ── PDF_STATUS constants ─────────────────────────────────────────────────

  describe('PDF_STATUS', () => {
    it('exports expected status values', () => {
      expect(PDF_STATUS.PERSISTED).toBe('persisted');
      expect(PDF_STATUS.MISSING).toBe('missing');
      expect(PDF_STATUS.UNKNOWN).toBe('unknown');
    });
  });

  // ── storePdf ─────────────────────────────────────────────────────────────

  describe('storePdf', () => {
    it('calls putAsset with status persisted by default', async () => {
      const blob = new Blob(['pdf'], { type: 'application/pdf' });
      await inv.storePdf('assets/test.pdf', blob, { pdfId: 'x', category: 'Cat' });
      expect(repo.putAsset).toHaveBeenCalledWith(
        'assets/test.pdf',
        blob,
        expect.objectContaining({ status: 'persisted', pdfId: 'x', category: 'Cat' })
      );
    });
  });
});
