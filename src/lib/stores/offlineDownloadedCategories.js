// Persistência de categorias baixadas — lê e escreve o estado "o que já foi
// baixado" em localStorage e verifica, direto no Cache Storage, se os PDFs de
// uma categoria realmente estão lá. Extraído de offline.js (#23): esta é a
// única responsabilidade deste arquivo — nada aqui inicia download nem
// calcula estatística de exibição, só responde "o que está salvo?" e
// "o que está de fato em cache?".
import { browser } from '$app/environment';
import PdfPathManager from '$lib/offline/utils/PdfPathManager.js';
import { atobUTF8 } from '$lib/utils/pathUtils';
import { getConfig } from '$lib/offline/core/OfflineConfig.js';

const SELECTED_CATEGORIES_KEY = 'selectedCategoriesForDownload';
const DOWNLOADED_CATEGORIES_KEY = 'downloadedCategories';
const OFFLINE_CATEGORIAS_SALVAS = 'OFFLINE_CATEGORIAS_SALVAS';

// Use centralized cache name from OfflineConfig - ensures consistency across all code
const DEFAULT_PDF_CACHE_FALLBACK = getConfig('PDF_CACHE_NAME') || 'plpc-pdfs';

/**
 * Normalize category name - aggregates subcategories into main category
 * Maps "Cifra nível I" and "Cifra nível II" to "Cifra"
 * @param {string} category - Category name to normalize
 * @returns {string} Normalized category name
 */
function normalizeCategory(category) {
  if (!category) return category;
  if (category === 'Cifra nível I' || category === 'Cifra nível II') {
    return 'Cifra';
  }
  return category;
}

/**
 * Get all categories that should be aggregated into a normalized category
 * @param {string} normalizedCategory - Normalized category name
 * @returns {string[]} Array of category names that map to this normalized category
 */
function getCategoryVariants(normalizedCategory) {
  if (normalizedCategory === 'Cifra') {
    return ['Cifra', 'Cifra nível I', 'Cifra nível II'];
  }
  return [normalizedCategory];
}

async function openPdfCache() {
  if (!browser || typeof caches === 'undefined') {
    throw new Error('Caches API nao esta disponivel neste ambiente');
  }

  // Always use the configured cache name to ensure consistency
  // Don't search for any cache ending with '-pdfs' as this can cause mismatches
  return caches.open(DEFAULT_PDF_CACHE_FALLBACK);
}

/**
 * Get PDF URL from louvor object
 * @param {{ pdfId: any; }} louvor
 */
function getPdfUrl(louvor) {
  if (!louvor || !louvor.pdfId) {
    return null;
  }
  
  try {
    // CRÍTICO: Usar atobUTF8 (UTF-8), NÃO atob() (latin-1)
    // pdfId está codificado em base64 UTF-8, não latin-1
    const decoded = atobUTF8(louvor.pdfId);
    // normaliza removendo barras iniciais
    let path = decoded.replace(/^\/+/, '').trim();
    
    if (!path) {
      return null;
    }
    
    // assegura prefixo assets/
    if (!path.toLowerCase().startsWith('assets/')) {
      path = `assets/${path}`;
    }
    
    return `/${path}`;
  } catch (e) {
    console.error('[Offline Store] Failed to decode pdfId:', e);
    return null;
  }
}

/**
 * Get saved selected categories from localStorage
 */
function getSavedCategories() {
  if (!browser) return [];
  try {
    const saved = localStorage.getItem(SELECTED_CATEGORIES_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Save selected categories to localStorage
 * @param {any} categories
 */
function saveCategories(categories) {
  if (!browser) return;
  try {
    localStorage.setItem(SELECTED_CATEGORIES_KEY, JSON.stringify(categories));
  } catch (e) {
    console.error('[Offline Store] Failed to save categories:', e);
  }
}

/**
 * Get downloaded categories from localStorage
 * Uses OFFLINE_CATEGORIAS_SALVAS flag to store categories that are saved in cache storage
 */
function getDownloadedCategories() {
  if (!browser) return [];
  try {
    // First try the new flag
    const saved = localStorage.getItem(OFFLINE_CATEGORIAS_SALVAS);
    if (saved) {
      return JSON.parse(saved);
    }
    // Fallback to old key for migration
    const oldSaved = localStorage.getItem(DOWNLOADED_CATEGORIES_KEY);
    if (oldSaved) {
      const categories = JSON.parse(oldSaved);
      // Migrate to new key
      localStorage.setItem(OFFLINE_CATEGORIAS_SALVAS, oldSaved);
      return categories;
    }
    return [];
  } catch (e) {
    console.error('[Offline Store] Failed to get downloaded categories:', e);
    return [];
  }
}

/**
 * Save downloaded categories to localStorage
 * Uses OFFLINE_CATEGORIAS_SALVAS flag to store categories that are saved in cache storage
 * @param {any[]} categories
 */
function saveDownloadedCategories(categories) {
  if (!browser) return;
  try {
    localStorage.setItem(OFFLINE_CATEGORIAS_SALVAS, JSON.stringify(categories));
    // Also save to old key for backward compatibility
    localStorage.setItem(DOWNLOADED_CATEGORIES_KEY, JSON.stringify(categories));
  } catch (e) {
    console.error('[Offline Store] Failed to save downloaded categories:', e);
  }
}

/**
 * Verify if a PDF actually exists in Cache Storage
 * This performs a real check in the cache, not just in the list
 * @param {string | URL} pdfUrl
 */
async function verifyPdfInCacheStorage(pdfUrl) {
  if (!browser || typeof caches === 'undefined') {
    return false;
  }
  
  try {
    const cache = await openPdfCache();

    // #22.5: uma chave só, a mesma que os quatro escritores gravam. Eram seis
    // variações, e duas delas (`new URL(...)` cru e o caminho sem origem)
    // divergiam da chave gravada exatamente nos caminhos com colchetes que a
    // Tarefa 5 corrigiu.
    const pdfUrlStr = typeof pdfUrl === 'string' ? pdfUrl : String(pdfUrl);
    const url = PdfPathManager.createRequestUrl(pdfUrlStr, location.origin);
    if (!url) return false;

    const response = await cache.match(new Request(url));
    return !!response;
  } catch (error) {
    console.warn(`[Offline Store] Error verifying PDF in cache: ${pdfUrl}`, error);
    return false;
  }
}

/**
 * Check if a category is completely downloaded (all PDFs are in cache storage)
 * IMPORTANT: This checks PDFs in cache storage, NOT ZIP files.
 * ZIP files are removed from cache after extraction, so we verify PDFs directly.
 * Uses unified normalization function for consistency.
 * 
 * #22.4: a verificação é sempre direta no Cache Storage. O antigo quarto
 * parâmetro, que existia para desligar um bloco de fallback difuso numa
 * categoria com muitos arquivos de mesmo nome, saiu junto com o bloco —
 * agora todas as categorias usam o modo de verificação estrita.
 * FIX: Now handles category normalization - aggregates "Cifra nível I" and "Cifra nível II" into "Cifra"
 * @param {string} category
 * @param {any[]} cachedPdfs - só sinaliza que a lista de cache já foi carregada
 * @param {any[]} louvoresData
 */
async function isCategoryCompletelyDownloaded(category, cachedPdfs, louvoresData) {
  if (!category || !louvoresData || !cachedPdfs) {
    return false;
  }

  // Normalize category name - aggregate subcategories
  const normalizedCategory = normalizeCategory(category);
  
  // Get all PDFs for this category and its variants (e.g., for "Cifra" include "Cifra nível I" and "Cifra nível II")
  const categoryVariants = getCategoryVariants(normalizedCategory);
  const categoryLouvores = louvoresData.filter((/** @type {{ categoria: any; }} */ louvor) => 
    categoryVariants.includes(louvor.categoria)
  );
  
  if (categoryLouvores.length === 0) {
    return false;
  }

  // Track unique PDFs found for counting validation
  const foundPdfs = new Set();
  let missingCount = 0;

  // Check if all PDFs for this category are in cache
  for (const louvor of categoryLouvores) {
    const pdfUrl = getPdfUrl(louvor);
    if (!pdfUrl) {
      continue;
    }

    // Prepare PDF URL for comparison (remove leading slash, preserve original case and accents)
    const pdfPath = pdfUrl.replace(/^\/+/, '');

    // CRITICAL: Always verify directly in Cache Storage first
    // The cache stores with URL encoding, so direct verification is most reliable
    let isCached = false;
    
    // Primary strategy: Direct verification in Cache Storage (most reliable)
    // This handles URL encoding correctly and doesn't use normalization
    const existsInCache = await verifyPdfInCacheStorage(pdfUrl);
    if (existsInCache) {
      isCached = true;
      foundPdfs.add(pdfPath);
    }
    
    // #22.4: as duas "estratégias de fallback" saíram. Medido sobre o acervo
    // real: elas não achavam 40 dos 652 PDFs de uma categoria de fato baixada
    // (a chave gravada é percent-encoded e `pdfPath` não é), e não achavam
    // nenhum que a verificação direta acima já não achasse.

    if (!isCached) {
      missingCount++;
      if (missingCount <= 3) { // Log first 3 missing PDFs to avoid spam
        console.warn(`[Offline Store] PDF não encontrado no cache (verificação direta): ${pdfUrl}`);
      }
    }
  }

  // FIX: Additional validation - count unique PDFs found vs expected
  const expectedCount = categoryLouvores.filter((/** @type {any} */ l) => getPdfUrl(l)).length;
  const foundCount = foundPdfs.size;
  
  // FIX: Tolerância de 99% - considerar completa se tiver 99% ou mais dos PDFs
  // Isso evita marcar como incompleta categorias que estão praticamente completas
  // (ex: 1631/1633 = 99.88% deve ser considerada completa)
  const COMPLETION_THRESHOLD = 0.99; // 99%
  const completionPercentage = foundCount / expectedCount;
  
  if (completionPercentage < COMPLETION_THRESHOLD) {
    console.warn(`[Offline Store] Category "${category}": Found ${foundCount}/${expectedCount} PDFs (${(completionPercentage * 100).toFixed(2)}%). Marking as incomplete.`);
    return false;
  }
  
  // Log success for debugging
  if (completionPercentage >= COMPLETION_THRESHOLD) {
    if (foundCount === expectedCount) {
      console.log(`[Offline Store] Category "${normalizedCategory}": Strict validation passed - ${foundCount} PDFs verified.`);
    } else {
      console.log(`[Offline Store] Category "${normalizedCategory}": ${(completionPercentage * 100).toFixed(2)}% complete (${foundCount}/${expectedCount} PDFs). Marking as complete.`);
    }
  }

  // Invalidate stats cache for the normalized category after validation completes
  // This ensures UI updates with fresh stats
  try {
    const { invalidateCategory } = await import('$lib/utils/statsCache');
    invalidateCategory(normalizedCategory);
    
    // Also invalidate in StatsCalculator if available
    try {
      const { default: statsCalculator } = await import('$lib/offline/stats/StatsCalculator.js');
      statsCalculator.invalidateCategory(normalizedCategory);
    } catch (e) {
      // Ignore if StatsCalculator not available
    }
  } catch (e) {
    // Ignore errors in stats invalidation - not critical
    console.debug('[Offline Store] Could not invalidate stats cache:', e);
  }

  return true;
}

/**
 * Get list of completely downloaded categories
 * FIX: Now normalizes categories - aggregates "Cifra nível I" and "Cifra nível II" into "Cifra"
 * @param {any[]} louvoresData
 * @param {any[]} cachedPdfs
 */
async function getCompletelyDownloadedCategories(louvoresData, cachedPdfs) {
  if (!louvoresData || !cachedPdfs || louvoresData.length === 0) {
    return [];
  }

  // Get all unique categories and normalize them
  const allCategories = [...new Set(louvoresData.map((/** @type {{ categoria: any; }} */ l) => l.categoria).filter(Boolean))];
  const normalizedCategories = [...new Set(allCategories.map(cat => normalizeCategory(cat)))];
  
  const downloadedCategories = [];

  // Check each normalized category (this will aggregate subcategories)
  for (const normalizedCategory of normalizedCategories) {
    // Check if all variants of this normalized category are downloaded
    // We check using the normalized category name, which will aggregate subcategories
    const isDownloaded = await isCategoryCompletelyDownloaded(normalizedCategory, cachedPdfs, louvoresData);
    if (isDownloaded) {
      downloadedCategories.push(normalizedCategory);
    }
  }

  return downloadedCategories;
}

export {
  normalizeCategory,
  getCategoryVariants,
  openPdfCache,
  getPdfUrl,
  getSavedCategories,
  saveCategories,
  getDownloadedCategories,
  saveDownloadedCategories,
  verifyPdfInCacheStorage,
  isCategoryCompletelyDownloaded,
  getCompletelyDownloadedCategories,
  SELECTED_CATEGORIES_KEY,
  DOWNLOADED_CATEGORIES_KEY,
  OFFLINE_CATEGORIAS_SALVAS
};
