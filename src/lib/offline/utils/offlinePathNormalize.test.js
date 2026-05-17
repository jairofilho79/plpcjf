/**
 * offlinePathNormalize tests
 *
 * Covers the three public functions used by both main thread and ZIP worker:
 *  - normalizeStoragePath
 *  - normalizeIdbId
 *  - buildExpectedSet / shouldIngestZipEntry
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeStoragePath,
  normalizeIdbId,
  buildExpectedSet,
  shouldIngestZipEntry
} from './offlinePathNormalize.js';

// ── normalizeStoragePath ─────────────────────────────────────────────────────

describe('normalizeStoragePath', () => {
  it('returns empty string for null/empty input', () => {
    expect(normalizeStoragePath('')).toBe('');
    expect(normalizeStoragePath(null)).toBe('');
    expect(normalizeStoragePath(undefined)).toBe('');
  });

  it('adds assets/ prefix when absent', () => {
    expect(normalizeStoragePath('ColAdultos/675.pdf')).toBe('assets/ColAdultos/675.pdf');
  });

  it('does not double-add assets/ prefix', () => {
    expect(normalizeStoragePath('assets/ColAdultos/675.pdf')).toBe('assets/ColAdultos/675.pdf');
  });

  it('strips leading slashes before adding prefix', () => {
    expect(normalizeStoragePath('/ColAdultos/675.pdf')).toBe('assets/ColAdultos/675.pdf');
  });

  it('strips leading slashes when assets/ is already present', () => {
    expect(normalizeStoragePath('/assets/ColAdultos/675.pdf')).toBe('assets/ColAdultos/675.pdf');
  });

  it('strips http host prefix', () => {
    expect(normalizeStoragePath('https://example.com/assets/foo.pdf')).toBe('assets/foo.pdf');
  });

  it('preserves Portuguese characters (accents)', () => {
    const path = normalizeStoragePath('Cifra nível I/001.pdf');
    expect(path).toBe('assets/Cifra nível I/001.pdf');
  });

  it('decodes percent-encoded paths', () => {
    const encoded = 'assets/Cifra%20n%C3%ADvel%20I/001.pdf';
    expect(normalizeStoragePath(encoded)).toBe('assets/Cifra nível I/001.pdf');
  });

  it('normalises backslashes to forward slashes', () => {
    expect(normalizeStoragePath('assets\\ColAdultos\\675.pdf')).toBe('assets/ColAdultos/675.pdf');
  });

  it('strips trailing slashes', () => {
    expect(normalizeStoragePath('assets/ColAdultos/675.pdf/')).toBe('assets/ColAdultos/675.pdf');
  });
});

// ── normalizeIdbId ───────────────────────────────────────────────────────────

describe('normalizeIdbId', () => {
  it('produces /assets/... format (leading slash)', () => {
    expect(normalizeIdbId('ColAdultos/675.pdf')).toBe('/assets/ColAdultos/675.pdf');
    expect(normalizeIdbId('/assets/ColAdultos/675.pdf')).toBe('/assets/ColAdultos/675.pdf');
  });

  it('returns empty string for invalid input', () => {
    expect(normalizeIdbId('')).toBe('');
    expect(normalizeIdbId(null)).toBe('');
  });
});

// ── buildExpectedSet / shouldIngestZipEntry ──────────────────────────────────

describe('buildExpectedSet', () => {
  it('includes both /assets/... and assets/... variants', () => {
    const set = buildExpectedSet(['/ColAdultos/675.pdf']);
    expect(set.has('assets/ColAdultos/675.pdf')).toBe(true);
    expect(set.has('/assets/ColAdultos/675.pdf')).toBe(true);
  });

  it('handles paths that already include assets/', () => {
    const set = buildExpectedSet(['assets/ColAdultos/675.pdf']);
    expect(set.has('assets/ColAdultos/675.pdf')).toBe(true);
    expect(set.has('/assets/ColAdultos/675.pdf')).toBe(true);
  });

  it('returns empty set for empty input', () => {
    expect(buildExpectedSet([]).size).toBe(0);
  });

  it('skips null/empty entries', () => {
    const set = buildExpectedSet([null, '', 'assets/foo.pdf']);
    expect(set.has('assets/foo.pdf')).toBe(true);
    expect(set.size).toBeGreaterThan(0);
  });
});

describe('shouldIngestZipEntry', () => {
  const expectedPdfs = ['/ColAdultos/675.pdf', 'ColAdultos/001.pdf'];

  it('accepts a PDF entry whose path is in the expected set', () => {
    const set = buildExpectedSet(expectedPdfs);
    // ZIP entry with assets/ prefix
    expect(shouldIngestZipEntry('assets/ColAdultos/675.pdf', set)).toBe(true);
    // ZIP entry without assets/ prefix
    expect(shouldIngestZipEntry('ColAdultos/001.pdf', set)).toBe(true);
  });

  it('rejects a PDF entry NOT in the expected set', () => {
    const set = buildExpectedSet(expectedPdfs);
    expect(shouldIngestZipEntry('assets/Other/999.pdf', set)).toBe(false);
  });

  it('rejects non-PDF entries', () => {
    const set = buildExpectedSet(expectedPdfs);
    expect(shouldIngestZipEntry('assets/ColAdultos/675.jpg', set)).toBe(false);
    expect(shouldIngestZipEntry('assets/ColAdultos/', set)).toBe(false);
  });

  it('accepts any PDF when expected set is empty (no filter)', () => {
    const emptySet = new Set();
    expect(shouldIngestZipEntry('assets/Anything/001.pdf', emptySet)).toBe(true);
  });

  it('returns false for falsy entry name', () => {
    const set = buildExpectedSet(expectedPdfs);
    expect(shouldIngestZipEntry('', set)).toBe(false);
    expect(shouldIngestZipEntry(null, set)).toBe(false);
  });

  it('matches entries that have assets/ prefix even when expected path does not', () => {
    // expectedPdfs from DownloadManager._getPdfUrl return /ColAdultos/... (no assets/)
    // ZIP entries may be assets/ColAdultos/... (with assets/)
    const pdfsFromManager = ['/ColAdultos/675.pdf'];
    const set = buildExpectedSet(pdfsFromManager);
    expect(shouldIngestZipEntry('assets/ColAdultos/675.pdf', set)).toBe(true);
  });
});

// ── Cross-layer compatibility ────────────────────────────────────────────────
// Ensures that paths produced by the worker match those expected by
// IndexedDbAssetRepository._normalizeId (which uses normalizeIdbId internally).

describe('worker ↔ repository path compatibility', () => {
  it('normalizeIdbId of a ZIP entry matches what IndexedDbAssetRepository would store', () => {
    // ZIP entry: ColAdultos/675.pdf (no assets/ prefix, as some ZIPs are structured)
    const fromWorker = normalizeIdbId('ColAdultos/675.pdf');
    // Repository normalises path the same way
    const fromRepository = normalizeIdbId('ColAdultos/675.pdf');
    expect(fromWorker).toBe(fromRepository);
    expect(fromWorker).toBe('/assets/ColAdultos/675.pdf');
  });

  it('normalizeIdbId of a ZIP entry with assets/ prefix produces same result', () => {
    const withPrefix = normalizeIdbId('assets/ColAdultos/675.pdf');
    const withoutPrefix = normalizeIdbId('ColAdultos/675.pdf');
    expect(withPrefix).toBe(withoutPrefix);
  });
});
