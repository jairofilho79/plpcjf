// Estatísticas e disponibilidade — cálculo puro de quanto de uma categoria já
// está disponível offline e quais pacotes ainda faltam baixar. Extraído de
// offline.js (#23): não faz rede nem grava nada (quem grava é
// offlineDownloadedCategories.js); só responde "quanto falta?" a partir do
// que os outros dois módulos já sabem.
import { findMissingPdfs, findRequiredPackages } from '$lib/utils/pdfValidation';
import { normalizeCategory, getCategoryVariants } from './offlineDownloadedCategories.js';

/**
 * Identifies missing PDFs by comparing louvores-manifest.json with cache
 * @param {Array} louvoresData - Array of louvor objects
 * @param {Array} cachedPdfs - Array of cached PDF URLs
 * @returns {Array} - Array of louvor objects with missing PDFs
 */
function identifyMissingPdfs(louvoresData, cachedPdfs) {
  return findMissingPdfs(louvoresData, cachedPdfs);
}

/**
 * Finds required packages based on missing PDFs and offline manifest
 * @param {Array} missingPdfs - Array of louvor objects with missing PDFs
 * @param {Object} offlineManifest - Offline manifest object
 * @returns {Array} - Array of package parts that need to be downloaded
 */
function findRequiredPackagesForMissing(missingPdfs, offlineManifest) {
  return findRequiredPackages(missingPdfs, offlineManifest);
}

// FASE 3: Cache de memoização removido - agora usando StatsCalculator
// Função mantida apenas para compatibilidade com código existente
function clearStatsCalculationCache() {
  // StatsCalculator gerencia seu próprio cache
  // Esta função é mantida para compatibilidade mas não faz nada
}

/**
 * Get availability statistics for a category
 * FASE 4: Delegado para StatsCalculator
 * @param {string} category - Category name
 * @param {Array} louvoresData - All louvores
 * @param {Array} cachedPdfs - Cached PDF URLs
 * @returns {Promise<{total: number, available: number, missing: number, percentage: number}>}
 */
async function getCategoryAvailabilityStats(category, louvoresData, cachedPdfs) {
  // Usar StatsCalculator que já gerencia cache e otimizações
  const { default: statsCalculator } = await import('$lib/offline/stats/StatsCalculator.js');
  return await statsCalculator.getCategoryStats(category, {
    louvoresData,
    cachedPdfs,
    useCache: true
  });
}

/**
 * Get required packages info for selected categories
 * @param {Array} categories - Selected categories
 * @param {Array} louvoresData - All louvores
 * @param {Array} cachedPdfs - Cached PDF URLs
 * @param {Object} manifest - Offline manifest
 * @returns {Promise<{totalParts: number, totalSize: number, partsByCategory: Object}>}
 */
async function getRequiredPackagesInfo(categories, louvoresData, cachedPdfs, manifest) {
  if (!categories || categories.length === 0 || !manifest) {
    return { totalParts: 0, totalSize: 0, partsByCategory: {} };
  }

  // Get all category variants (e.g., for "Cifra" include "Cifra nível I" and "Cifra nível II")
  const categoryVariantsMap = new Map();
  categories.forEach(cat => {
    const normalized = normalizeCategory(cat);
    const variants = getCategoryVariants(normalized);
    categoryVariantsMap.set(normalized, variants);
  });
  
  const allCategoryVariants = Array.from(categoryVariantsMap.values()).flat();
  const filteredLouvores = louvoresData.filter(l => allCategoryVariants.includes(l.categoria));
  const missingPdfs = identifyMissingPdfs(filteredLouvores, cachedPdfs);
  const requiredParts = findRequiredPackagesForMissing(missingPdfs, manifest);

  const partsByCategory = {};
  let totalSize = 0;

  for (const part of requiredParts) {
    // Normalize category name when grouping parts
    const normalizedCategory = normalizeCategory(part.category);
    if (!partsByCategory[normalizedCategory]) {
      partsByCategory[normalizedCategory] = [];
    }
    partsByCategory[normalizedCategory].push(part);
    totalSize += part.size || 0;
  }

  return {
    totalParts: requiredParts.length,
    totalSize,
    partsByCategory
  };
}

export {
  identifyMissingPdfs,
  findRequiredPackagesForMissing,
  clearStatsCalculationCache,
  getCategoryAvailabilityStats,
  getRequiredPackagesInfo
};
