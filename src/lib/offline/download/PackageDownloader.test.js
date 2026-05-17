/**
 * PackageDownloader — phase mapping and stored=0 fallback tests.
 *
 * These tests verify that:
 *  1. Worker events (DOWNLOADING / EXTRACTING / STORING) are mapped to the
 *     correct `phase` values in the `onProgress` callback.
 *  2. When the ZIP worker returns stored=0 with expectedPdfs present, the
 *     main-thread fflate fallback is invoked automatically.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../utils/OfflineLogger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() })
}));

vi.mock('../core/OfflineConfig.js', () => ({
  getConfig: vi.fn((key) => {
    if (key === 'OFFLINE_IDB_ENABLED') return true;
    if (key === 'OFFLINE_WORKER_ZIP_STREAMING_ENABLED') return true;
    return false;
  })
}));

vi.mock('../normalization/UrlNormalizer.js', () => ({ default: {} }));
vi.mock('../storage/CacheStorageAdapter.js', () => ({ default: { _putPdfInternal: vi.fn() } }));
vi.mock('../core/OfflineEvents.js', () => ({ default: { emit: vi.fn() }, EVENTS: {} }));
vi.mock('../core/OfflineStorageErrors.js', () => ({
  createQuotaExceededError: vi.fn(),
  isQuotaExceededError: vi.fn(() => false)
}));

// Use vi.hoisted so the variable is available when vi.mock factory runs
const { mockIngestZip } = vi.hoisted(() => ({ mockIngestZip: vi.fn() }));

vi.mock('../workers/ZipWorkerClient.js', () => ({
  default: { ingestZip: mockIngestZip }
}));

// fflate unzip mock (used by the fallback pipeline)
vi.mock('fflate', () => ({
  unzip: vi.fn((_buf, cb) => cb(null, {}))
}));

import { PackageDownloader } from './PackageDownloader.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDownloader() {
  return new PackageDownloader({ basePath: '/packages' });
}

// Make `typeof Worker !== 'undefined'` return true so useZipWorker condition passes.
// ZipWorkerClient is already fully mocked so no real Worker is instantiated.
vi.stubGlobal('Worker', class FakeWorker {});

// ── Phase mapping tests ───────────────────────────────────────────────────────

describe('PackageDownloader — phase mapping from worker events', () => {
  beforeEach(() => {
    mockIngestZip.mockReset();
  });

  it('maps DOWNLOADING worker event to phase=downloading in onProgress', async () => {
    const phases = [];

    mockIngestZip.mockImplementation(({ onProgress }) => {
      onProgress({ event: 'DOWNLOADING', receivedBytes: 1024, totalBytes: 4096, percentage: 25 });
      return Promise.resolve({ stored: 1, extracted: 1, bytesDownloaded: 4096 });
    });

    const downloader = makeDownloader();
    await downloader.downloadExtractStorePackage('/packages/test.zip', ['assets/foo.pdf'], {
      onProgress: (p) => phases.push(p.phase)
    });

    expect(phases).toContain('downloading');
  });

  it('maps EXTRACTING worker event to phase=extracting in onProgress', async () => {
    const phases = [];

    mockIngestZip.mockImplementation(({ onProgress }) => {
      onProgress({ event: 'EXTRACTING', completed: 1, total: 5, percentage: 20 });
      return Promise.resolve({ stored: 5, extracted: 5, bytesDownloaded: 1000 });
    });

    const downloader = makeDownloader();
    await downloader.downloadExtractStorePackage('/packages/test.zip', ['assets/foo.pdf'], {
      onProgress: (p) => phases.push(p.phase)
    });

    expect(phases).toContain('extracting');
  });

  it('maps STORING worker event to phase=storing in onProgress', async () => {
    const phases = [];

    mockIngestZip.mockImplementation(({ onProgress }) => {
      onProgress({ event: 'STORING', completed: 1, total: 5, percentage: 20 });
      return Promise.resolve({ stored: 5, extracted: 5, bytesDownloaded: 1000 });
    });

    const downloader = makeDownloader();
    await downloader.downloadExtractStorePackage('/packages/test.zip', ['assets/foo.pdf'], {
      onProgress: (p) => phases.push(p.phase)
    });

    expect(phases).toContain('storing');
  });
});

// ── stored=0 fallback tests ───────────────────────────────────────────────────

describe('PackageDownloader — fallback when worker returns stored=0', () => {
  beforeEach(() => {
    mockIngestZip.mockReset();
  });

  it('calls _downloadExtractStoreMainThread when worker returns stored=0', async () => {
    mockIngestZip.mockResolvedValue({ stored: 0, extracted: 0, bytesDownloaded: 1000 });

    const downloader = makeDownloader();
    const fallbackSpy = vi
      .spyOn(downloader, '_downloadExtractStoreMainThread')
      .mockResolvedValue({ stored: 3, extracted: 3, bytesDownloaded: 1000 });

    const result = await downloader.downloadExtractStorePackage(
      '/packages/test.zip',
      ['assets/foo.pdf', 'assets/bar.pdf', 'assets/baz.pdf'],
      {}
    );

    expect(fallbackSpy).toHaveBeenCalledOnce();
    expect(result.stored).toBe(3);
  });

  it('does NOT call fallback when stored=0 and no expectedPdfs were provided', async () => {
    mockIngestZip.mockResolvedValue({ stored: 0, extracted: 0, bytesDownloaded: 500 });

    const downloader = makeDownloader();
    const fallbackSpy = vi
      .spyOn(downloader, '_downloadExtractStoreMainThread')
      .mockResolvedValue({ stored: 0, extracted: 0, bytesDownloaded: 500 });

    const result = await downloader.downloadExtractStorePackage(
      '/packages/test.zip',
      [],   // no expected PDFs → condition (expectedPdfs.length > 0) is false
      {}
    );

    expect(fallbackSpy).not.toHaveBeenCalled();
    expect(result.stored).toBe(0);
  });

  it('returns worker result when stored > 0', async () => {
    mockIngestZip.mockResolvedValue({ stored: 5, extracted: 5, bytesDownloaded: 2000 });

    const downloader = makeDownloader();
    const fallbackSpy = vi
      .spyOn(downloader, '_downloadExtractStoreMainThread')
      .mockResolvedValue({ stored: 99, extracted: 99, bytesDownloaded: 2000 });

    const result = await downloader.downloadExtractStorePackage(
      '/packages/test.zip',
      ['assets/foo.pdf'],
      {}
    );

    expect(fallbackSpy).not.toHaveBeenCalled();
    expect(result.stored).toBe(5);
  });
});

// ── _resolveAbsoluteUrl tests ─────────────────────────────────────────────────

describe('PackageDownloader._resolveAbsoluteUrl', () => {
  it('adds basePath for bare filenames', () => {
    const d = makeDownloader();
    // jsdom window.location.origin is 'http://localhost'
    const url = d._resolveAbsoluteUrl('Partitura-1.zip');
    expect(url).toContain('/packages/Partitura-1.zip');
  });

  it('preserves paths that already start with /', () => {
    const d = makeDownloader();
    const url = d._resolveAbsoluteUrl('/packages/Partitura-1.zip');
    expect(url).toContain('/packages/Partitura-1.zip');
  });

  it('extracts pathname from http URL', () => {
    const d = makeDownloader();
    const url = d._resolveAbsoluteUrl('https://cdn.example.com/packages/Partitura-1.zip');
    expect(url).toContain('/packages/Partitura-1.zip');
  });
});
