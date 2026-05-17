/**
 * PDF Validator Integration Tests
 * Tests for validating PDF availability and normalization consistency
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import cacheValidator from './CacheValidator.js';
import indexValidator from './IndexValidator.js';
import networkValidator from './NetworkValidator.js';
import compositeValidator from './CompositeValidator.js';
import urlNormalizer from '../normalization/UrlNormalizer.js';
import cacheStorageAdapter from '../storage/CacheStorageAdapter.js';

// Mock dependencies
vi.mock('$lib/utils/pdfIndex', () => ({
  isPdfAvailableInIndex: vi.fn()
}));

vi.mock('../storage/CacheStorageAdapter.js', () => ({
  default: {
    hasPdf: vi.fn(),
    getPdf: vi.fn(),
    putPdf: vi.fn()
  }
}));

describe('PdfValidator Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    urlNormalizer.clearCache();
  });

  describe('Normalization Consistency', () => {
    it('should normalize URLs consistently across all validators', () => {
      const testUrls = [
        'assets/ColAdultos/001.pdf',
        '/assets/ColAdultos/001.pdf',
        'Assets/ColAdultos/001.pdf',
        'assets\\ColAdultos\\001.pdf',
        'https://example.com/assets/ColAdultos/001.pdf'
      ];

      const normalized = testUrls.map(url => urlNormalizer.normalizePdfUrl(url));
      
      // All should normalize to the same value
      const firstNormalized = normalized[0];
      normalized.forEach(norm => {
        expect(norm).toBe(firstNormalized);
      });
    });

    it('should handle URL variations correctly', () => {
      const variations = [
        'assets/ColAdultos/001.pdf',
        'assets/coladultos/001.pdf', // lowercase
        'assets/ColAdultos/001.PDF', // uppercase extension
        '/assets/ColAdultos/001.pdf', // leading slash
        'assets/ColAdultos/001.pdf/' // trailing slash
      ];

      const normalized = variations.map(url => urlNormalizer.normalizePdfUrl(url));
      
      // All should normalize to the same base path
      const basePath = 'assets/coladultos/001.pdf';
      normalized.forEach(norm => {
        expect(norm).toBe(basePath);
      });
    });
  });

  describe('CacheValidator', () => {
    it('should validate PDF availability via cache', async () => {
      const pdfPath = 'assets/ColAdultos/001.pdf';
      
      // Mock cache to return true
      cacheStorageAdapter.hasPdf.mockResolvedValue(true);
      
      const result = await cacheValidator.validate(pdfPath);
      
      expect(result.available).toBe(true);
      expect(result.source).toBe('cache');
      expect(result.normalizedPath).toBeTruthy();
      // CacheValidator uses PdfPathManager.normalizeForStorage which preserves case
      expect(cacheStorageAdapter.hasPdf).toHaveBeenCalledWith('assets/ColAdultos/001.pdf');
    });

    it('should return false when PDF is not in cache', async () => {
      const pdfPath = 'assets/ColAdultos/001.pdf';
      
      // Mock cache to return false
      cacheStorageAdapter.hasPdf.mockResolvedValue(false);
      
      const result = await cacheValidator.validate(pdfPath);
      
      expect(result.available).toBe(false);
      expect(result.source).toBe('cache');
      expect(result.needsDownload).toBe(navigator.onLine);
    });

    it('should normalize path before checking cache', async () => {
      const pdfPath = '/assets/ColAdultos/001.pdf';
      
      cacheStorageAdapter.hasPdf.mockResolvedValue(true);
      
      await cacheValidator.validate(pdfPath);
      
      // CacheValidator uses PdfPathManager.normalizeForStorage: removes leading slash, preserves case
      expect(cacheStorageAdapter.hasPdf).toHaveBeenCalledWith('assets/ColAdultos/001.pdf');
    });
  });

  describe('IndexValidator', () => {
    it('should validate PDF availability via index when pdfId is provided', async () => {
      const pdfPath = 'assets/ColAdultos/001.pdf';
      const pdfId = 'test-pdf-id';
      
      const { isPdfAvailableInIndex } = await import('$lib/utils/pdfIndex');
      isPdfAvailableInIndex.mockReturnValue(true);
      
      const result = await indexValidator.validate(pdfPath, { pdfId });
      
      expect(result.available).toBe(true);
      expect(result.source).toBe('index');
    });

    it('should return error when pdfId is not provided', async () => {
      const pdfPath = 'assets/ColAdultos/001.pdf';
      
      const result = await indexValidator.validate(pdfPath);
      
      expect(result.available).toBe(false);
      expect(result.error).toContain('PDF ID required');
    });

    it('should handle index unavailable gracefully', async () => {
      const pdfPath = 'assets/ColAdultos/001.pdf';
      const pdfId = 'test-pdf-id';
      
      const { isPdfAvailableInIndex } = await import('$lib/utils/pdfIndex');
      isPdfAvailableInIndex.mockReturnValue(null);
      
      const result = await indexValidator.validate(pdfPath, { pdfId });
      
      expect(result.available).toBe(false);
      expect(result.error).toContain('Index not available');
    });
  });

  describe('NetworkValidator', () => {
    it('should validate PDF availability via network when online', async () => {
      const pdfPath = 'assets/ColAdultos/001.pdf';
      
      // Use vi.stubGlobal so the module also sees the mock
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);
      
      const result = await networkValidator.validate(pdfPath, { checkNetwork: true });
      
      expect(result.source).toBe('network');
      expect(mockFetch).toHaveBeenCalled();
      
      vi.unstubAllGlobals();
    });

    it('should skip network check when offline', async () => {
      const pdfPath = 'assets/ColAdultos/001.pdf';
      
      // Mock navigator.onLine
      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: false
      });
      
      const result = await networkValidator.validate(pdfPath);
      
      expect(result.error).toContain('offline');
      
      // Restore
      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: true
      });
    });
  });

  describe('CompositeValidator', () => {
    it('should use index first when available', async () => {
      const pdfPath = 'assets/ColAdultos/001.pdf';
      const pdfId = 'test-pdf-id';
      
      const { isPdfAvailableInIndex } = await import('$lib/utils/pdfIndex');
      isPdfAvailableInIndex.mockReturnValue(true);
      
      const result = await compositeValidator.validate(pdfPath, {
        useIndex: true,
        pdfId
      });
      
      expect(result.available).toBe(true);
      expect(result.source).toBe('index');
    });

    it('should fallback to cache when index is unavailable', async () => {
      const pdfPath = 'assets/ColAdultos/001.pdf';
      const pdfId = 'test-pdf-id';
      
      const { isPdfAvailableInIndex } = await import('$lib/utils/pdfIndex');
      isPdfAvailableInIndex.mockReturnValue(null); // Index unavailable
      
      cacheStorageAdapter.hasPdf.mockResolvedValue(true);
      
      const result = await compositeValidator.validate(pdfPath, {
        useIndex: true,
        pdfId
      });
      
      expect(result.available).toBe(true);
      expect(result.source).toBe('cache');
    });

    it('should use all strategies in order', async () => {
      const pdfPath = 'assets/ColAdultos/001.pdf';
      const pdfId = 'test-pdf-id';
      
      const { isPdfAvailableInIndex } = await import('$lib/utils/pdfIndex');
      isPdfAvailableInIndex.mockReturnValue(null); // Index unavailable
      cacheStorageAdapter.hasPdf.mockResolvedValue(false); // Not in cache
      
      // Use vi.stubGlobal so the module also sees the mock
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);
      
      const result = await compositeValidator.validate(pdfPath, {
        useIndex: true,
        checkNetwork: true,
        pdfId
      });
      
      expect(result.source).toBe('network');
      
      vi.unstubAllGlobals();
    });
  });

  describe('Normalization in Validation Flow', () => {
    it('should normalize paths consistently throughout validation', async () => {
      const pdfPath = '/assets/ColAdultos/001.pdf';
      const pdfId = 'test-pdf-id';
      
      cacheStorageAdapter.hasPdf.mockResolvedValue(true);
      
      const result = await compositeValidator.validate(pdfPath, { pdfId });
      
      // PdfPathManager.normalizeForStorage removes leading slash and preserves case
      const expectedPath = 'assets/ColAdultos/001.pdf';
      expect(cacheStorageAdapter.hasPdf).toHaveBeenCalledWith(expectedPath);
      expect(result.normalizedPath).toBe(expectedPath);
    });

    it('should handle different URL formats and normalize correctly', async () => {
      cacheStorageAdapter.hasPdf.mockResolvedValue(true);
      
      // PdfPathManager.normalizeForStorage preserves original case, removes leading slashes
      const cases = [
        { input: 'assets/ColAdultos/001.pdf', expected: 'assets/ColAdultos/001.pdf' },
        { input: '/assets/ColAdultos/001.pdf', expected: 'assets/ColAdultos/001.pdf' },
        { input: 'Assets/ColAdultos/001.pdf', expected: 'Assets/ColAdultos/001.pdf' }
      ];
      
      for (const { input, expected } of cases) {
        const result = await cacheValidator.validate(input);
        expect(result.normalizedPath).toBe(expected);
      }
    });
  });
});

