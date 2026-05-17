const PHASE_RANGES = {
  downloading: [0, 55],
  extracting: [55, 70],
  preparing: [70, 75],
  storing: [75, 100],
  complete: [100, 100]
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function packageWeight(pkg) {
  const size = Number(pkg?.part?.size || 0);
  return Number.isFinite(size) && size > 0 ? size : 1;
}

/**
 * Computes a monotonic global download percentage.
 *
 * Each package receives a global progress span weighted by manifest size when
 * available. Inside that span, each phase advances inside a fixed local range.
 *
 * @param {{
 *   packagesInfo: Array<{part?: {size?: number}}>,
 *   packageIndex: number,
 *   phase: string,
 *   phasePercentage: number,
 *   lastPercentage?: number
 * }} params
 * @returns {number}
 */
export function computePackageProgressPercentage({
  packagesInfo,
  packageIndex,
  phase,
  phasePercentage,
  lastPercentage = 0
}) {
  const packages = Array.isArray(packagesInfo) ? packagesInfo : [];
  if (packages.length === 0) return clamp(Math.floor(lastPercentage || 0), 0, 100);

  const safeIndex = clamp(Number(packageIndex || 0), 0, packages.length - 1);
  const weights = packages.map(packageWeight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || packages.length;
  const weightBefore = weights.slice(0, safeIndex).reduce((sum, weight) => sum + weight, 0);
  const currentWeight = weights[safeIndex] || 1;

  const [phaseStart, phaseEnd] = PHASE_RANGES[phase] || PHASE_RANGES.downloading;
  const pct = clamp(Number(phasePercentage || 0), 0, 100);
  const packageLocalPct = phaseStart + ((phaseEnd - phaseStart) * pct / 100);
  const rawGlobal = ((weightBefore + currentWeight * (packageLocalPct / 100)) / totalWeight) * 100;

  return clamp(Math.floor(Math.max(rawGlobal, Number(lastPercentage || 0))), 0, 100);
}
