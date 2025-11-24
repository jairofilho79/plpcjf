/**
 * PDF Path Manager Tests
 * Tests for PdfPathManager normalization preserving case and accents
 */

import PdfPathManager from './PdfPathManager.js';

describe('PdfPathManager', () => {
  describe('normalizeForStorage', () => {
    test('preserves case and accents', () => {
      const path = 'assets/Cifra nível I/arquivo.pdf';
      const normalized = PdfPathManager.normalizeForStorage(path);
      expect(normalized).toBe('assets/Cifra nível I/arquivo.pdf');
    });

    test('preserves uppercase in category names', () => {
      const path = 'assets/ColAdultos/001.pdf';
      const normalized = PdfPathManager.normalizeForStorage(path);
      expect(normalized).toBe('assets/ColAdultos/001.pdf');
    });

    test('adds assets/ prefix if missing', () => {
      const path = 'Categoria/arquivo.pdf';
      const normalized = PdfPathManager.normalizeForStorage(path);
      expect(normalized).toBe('assets/Categoria/arquivo.pdf');
    });

    test('handles paths already with assets/ prefix', () => {
      const path = 'assets/Categoria/arquivo.pdf';
      const normalized = PdfPathManager.normalizeForStorage(path);
      expect(normalized).toBe('assets/Categoria/arquivo.pdf');
    });

    test('removes leading slashes', () => {
      const path = '/assets/Categoria/arquivo.pdf';
      const normalized = PdfPathManager.normalizeForStorage(path);
      expect(normalized).toBe('assets/Categoria/arquivo.pdf');
    });

    test('removes protocol and domain', () => {
      const path = 'https://example.com/assets/Categoria/arquivo.pdf';
      const normalized = PdfPathManager.normalizeForStorage(path);
      expect(normalized).toBe('assets/Categoria/arquivo.pdf');
    });

    test('normalizes Windows path separators', () => {
      const path = 'assets\\Categoria\\arquivo.pdf';
      const normalized = PdfPathManager.normalizeForStorage(path);
      expect(normalized).toBe('assets/Categoria/arquivo.pdf');
    });

    test('handles empty string', () => {
      const normalized = PdfPathManager.normalizeForStorage('');
      expect(normalized).toBe('');
    });

    test('handles null/undefined', () => {
      expect(PdfPathManager.normalizeForStorage(null)).toBe('');
      expect(PdfPathManager.normalizeForStorage(undefined)).toBe('');
    });
  });

  describe('createRequestUrl', () => {
    test('creates full URL with origin', () => {
      const path = 'assets/Categoria/arquivo.pdf';
      const url = PdfPathManager.createRequestUrl(path, 'https://example.com');
      expect(url).toContain('https://example.com');
      expect(url).toContain('assets/Categoria/arquivo.pdf');
    });

    test('normalizes path before creating URL', () => {
      const path = 'Categoria/arquivo.pdf';
      const url = PdfPathManager.createRequestUrl(path, 'https://example.com');
      expect(url).toContain('assets/Categoria/arquivo.pdf');
    });

    test('handles empty path', () => {
      const url = PdfPathManager.createRequestUrl('');
      expect(url).toBe('');
    });
  });

  describe('createSearchVariations', () => {
    test('generates multiple URL variations', () => {
      const path = 'assets/Categoria/arquivo.pdf';
      const variations = PdfPathManager.createSearchVariations(path, 'https://example.com');
      expect(variations.length).toBeGreaterThan(0);
      expect(variations.every(v => typeof v === 'string')).toBe(true);
    });

    test('variations include normalized path', () => {
      const path = 'Categoria/arquivo.pdf';
      const variations = PdfPathManager.createSearchVariations(path, 'https://example.com');
      const hasNormalized = variations.some(v => v.includes('assets/Categoria/arquivo.pdf'));
      expect(hasNormalized).toBe(true);
    });

    test('removes duplicates', () => {
      const path = 'assets/Categoria/arquivo.pdf';
      const variations = PdfPathManager.createSearchVariations(path, 'https://example.com');
      const unique = new Set(variations);
      expect(variations.length).toBe(unique.size);
    });

    test('handles empty path', () => {
      const variations = PdfPathManager.createSearchVariations('');
      expect(variations).toEqual([]);
    });
  });
});

