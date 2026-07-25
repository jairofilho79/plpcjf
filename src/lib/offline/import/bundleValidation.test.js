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
  listCategoriesFromOfflineManifest,
  buildImportChecklist,
  importChecklistPercentage
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

  it('buildImportChecklist tracks category parts and tags', () => {
    const offlineManifest = {
      packages: {
        'Gestos em Gravura': {
          parts: [
            { filename: 'Gestos-em-Gravura-1.zip' },
            { filename: 'Gestos-em-Gravura-2.zip' },
            { filename: 'Gestos-em-Gravura-3.zip' }
          ]
        }
      }
    };
    const rows = buildImportChecklist({
      offlineManifest,
      offlineManifestDone: true,
      louvoresManifestDone: true,
      seenParts: new Set(['Gestos-em-Gravura-1.zip']),
      currentPart: 'Gestos-em-Gravura-2.zip',
      phase: 'part'
    });
    assert.equal(rows[0].status, 'done');
    assert.equal(rows[1].status, 'done');
    assert.equal(rows[2].label, 'Gestos em Gravura (1/3)');
    assert.equal(rows[2].status, 'active');
    assert.equal(rows[3].id, 'commit');
    assert.equal(rows[3].status, 'pending');
  });

  it('buildImportChecklist exposes commit counts', () => {
    const rows = buildImportChecklist({
      offlineManifestDone: true,
      louvoresManifestDone: true,
      seenParts: new Set(),
      phase: 'commit',
      commitCounts: { ok: 12, fail: 1, total: 100 }
    });
    const commit = rows.find((r) => r.id === 'commit');
    assert.equal(commit?.status, 'active');
    assert.deepEqual(commit?.counts, { ok: 12, fail: 1, total: 100 });
  });

  it('importChecklistPercentage moves with steps', () => {
    assert.equal(
      importChecklistPercentage({
        offlineManifestDone: false,
        louvoresManifestDone: false,
        completedParts: 0,
        totalParts: 3,
        phase: 'scan'
      }),
      0
    );
    assert.ok(
      importChecklistPercentage({
        offlineManifestDone: true,
        louvoresManifestDone: true,
        completedParts: 1,
        totalParts: 3,
        phase: 'part',
        partInFlight: true
      }) > 40
    );
    assert.ok(
      importChecklistPercentage({
        offlineManifestDone: true,
        louvoresManifestDone: true,
        completedParts: 3,
        totalParts: 3,
        phase: 'commit',
        commitFraction: 0.5
      }) >= 90
    );
    assert.equal(
      importChecklistPercentage({
        offlineManifestDone: true,
        louvoresManifestDone: true,
        completedParts: 3,
        totalParts: 3,
        phase: 'done'
      }),
      100
    );
  });
});
