import { describe, expect, it } from 'vitest';
import { computePackageProgressPercentage } from './DownloadProgressMath.js';

describe('computePackageProgressPercentage', () => {
  it('never regresses when a new package starts after storing progress', () => {
    const packagesInfo = [
      { part: { size: 100 }, completedPdfs: 20 },
      { part: { size: 100 }, completedPdfs: 0 }
    ];

    const afterFirstPackage = computePackageProgressPercentage({
      packagesInfo,
      packageIndex: 0,
      phase: 'storing',
      phasePercentage: 100,
      lastPercentage: 0
    });

    const secondPackageStarts = computePackageProgressPercentage({
      packagesInfo,
      packageIndex: 1,
      phase: 'downloading',
      phasePercentage: 0,
      lastPercentage: afterFirstPackage
    });

    expect(afterFirstPackage).toBeGreaterThan(0);
    expect(secondPackageStarts).toBeGreaterThanOrEqual(afterFirstPackage);
  });

  it('uses package size as global weight when available', () => {
    const packagesInfo = [
      { part: { size: 100 }, completedPdfs: 0 },
      { part: { size: 300 }, completedPdfs: 0 }
    ];

    const firstPackageDone = computePackageProgressPercentage({
      packagesInfo,
      packageIndex: 0,
      phase: 'storing',
      phasePercentage: 100,
      lastPercentage: 0
    });

    expect(firstPackageDone).toBe(25);
  });
});
