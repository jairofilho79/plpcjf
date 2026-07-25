/**
 * Node built-in test for offline bundle validation (no vitest required).
 * Run: node --test src/lib/offline/import/bundleValidation.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isUnsafeZipPath,
  zipEntryBasename,
  listPartFilenames,
  validateBundleRoot,
  listCategoriesFromOfflineManifest
} from './bundleValidation.js';

describe('bundleValidation', () => {
  it('detects unsafe zip paths', () => {
    assert.equal(isUnsafeZipPath('../evil.pdf'), true);
    assert.equal(isUnsafeZipPath('/abs/file.pdf'), true);
    assert.equal(isUnsafeZipPath('Partitura-1.zip'), false);
    assert.equal(isUnsafeZipPath('folder/Partitura-1.zip'), false);
  });

  it('lists part filenames from offline-manifest', () => {
    const manifest = {
      packages: {
        Partitura: {
          parts: [{ filename: 'Partitura-1.zip' }, { filename: '/packages/Partitura-2.zip' }]
        },
        Cifra: { parts: [{ filename: 'Cifra-1.zip' }] }
      }
    };
    assert.deepEqual(listPartFilenames(manifest), [
      'Partitura-1.zip',
      'Partitura-2.zip',
      'Cifra-1.zip'
    ]);
    assert.deepEqual(listCategoriesFromOfflineManifest(manifest), ['Partitura', 'Cifra']);
  });

  it('validateBundleRoot requires manifests and all parts', () => {
    const offlineManifest = {
      packages: {
        Partitura: { parts: [{ filename: 'Partitura-1.zip' }] }
      }
    };
    const louvoresManifest = [{ nome: 'X', pdfId: 'abc' }];

    const missing = validateBundleRoot({
      offlineManifest,
      louvoresManifest,
      entryBasenames: []
    });
    assert.equal(missing.ok, false);
    assert.ok(missing.errors.some((e) => e.includes('Partitura-1.zip')));

    const ok = validateBundleRoot({
      offlineManifest,
      louvoresManifest,
      entryBasenames: ['Partitura-1.zip', 'readme.txt']
    });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.partFilenames, ['Partitura-1.zip']);
  });

  it('zipEntryBasename strips directories', () => {
    assert.equal(zipEntryBasename('a/b/c.zip'), 'c.zip');
    assert.equal(zipEntryBasename('c.zip'), 'c.zip');
  });
});
