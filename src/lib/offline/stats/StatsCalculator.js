/**
 * Stats Calculator
 * Centralized calculator for category availability statistics
 * FASE 4: Refactored from offline.js to dedicated module
 */

import cacheStorageAdapter from '../storage/CacheStorageAdapter.js';
import { buildPdfCacheIndex, louvorFaltaNoIndice } from '$lib/utils/pdfCacheIndex.js';
import PdfPathManager from '../utils/PdfPathManager.js';
import { getCachedStats, cacheStats, invalidateCategory, invalidateCategories, getAllCachedStats } from '$lib/utils/statsCache.js';
import { createLogger } from '../utils/OfflineLogger.js';
import { criarCedente } from './yieldScheduler.js';
import { browser } from '$app/environment';
import { getCachedPDFsFast } from '$lib/utils/swRegistration.js';

const logger = createLogger('StatsCalculator');

/**
 * @typedef {Object} CategoryStats
 * @property {number} total - Total number of PDFs in category
 * @property {number} available - Number of PDFs available in cache
 * @property {number} missing - Number of PDFs missing from cache
 * @property {number} percentage - Percentage of PDFs available (0-100)
 */

/**
 * @typedef {Object} StatsOptions
 * @property {boolean} [useCache=true] - Use cached stats if available
 * @property {boolean} [forceRecalculate=false] - Force recalculation even if cached
 * @property {Array<Object> | null} [louvoresData] - Louvores data (if not provided, will be fetched from store)
 * @property {Array<Object> | null} [cachedPdfs] - Cached PDFs list (if not provided, will be fetched)
 */

/**
 * Stats Calculator
 * Calculates category availability statistics with intelligent caching
 */
class StatsCalculator {
  /**
   * Índice de cache memoizado pela **identidade** do array de PDFs em cache.
   *
   * Antes, cada chunk de 50 louvores reconstruía o índice inteiro por dentro de
   * `findMissingPdfs`: 11,7 ms sobre os 4629 caminhos do acervo, 95 vezes por
   * varredura — ~1,1 s de CPU jogado fora num Mac, mais num telemóvel.
   *
   * A chave é o array porque `+page.svelte` passa o **mesmo** `cachedPdfs` às
   * três chamadas concorrentes de `getCategoryStats`: as três partilham um
   * índice só, de graça, sem que aquele arquivo precise saber disso.
   *
   * Não há invalidação manual, e nem deve haver: `loadCachedPdfsList` devolve um
   * array novo a cada leitura, então uma lista velha perde a última referência e
   * o WeakMap larga a entrada sozinho. Invalidar por tempo ou por evento aqui
   * seria reintroduzir a chance de responder com um índice que já não
   * corresponde à lista recebida.
   *
   * @type {WeakMap<object, import('$lib/utils/pdfCacheIndex.js').PdfCacheIndex>}
   */
  #indicePorLista = new WeakMap();

  constructor() {
    this.cacheAdapter = cacheStorageAdapter;
    this.memoryCache = new Map(); // In-memory cache for quick access
    this.calculationInProgress = new Set(); // Track calculations in progress to avoid duplicates
  }

  /**
   * O índice desta lista, construído no máximo uma vez por lista.
   * @param {string[]} listaDePdfs
   * @returns {import('$lib/utils/pdfCacheIndex.js').PdfCacheIndex}
   */
  #obterIndice(listaDePdfs) {
    const lista = Array.isArray(listaDePdfs) ? listaDePdfs : [];

    const memoizado = this.#indicePorLista.get(lista);
    if (memoizado) return memoizado;

    // A mesma régua de `findMissingPdfs`: normalizeForStorage nos dois lados.
    // #22.2 — a chave gravada no cache está em NFC e `getPdfRelPath` devolve o
    // caminho cru, NFD em 8 casos do acervo. Divergir aqui faria esses 8
    // aparecerem como faltando para sempre.
    const indice = buildPdfCacheIndex(lista, { normalize: PdfPathManager.normalizeForStorage });
    this.#indicePorLista.set(lista, indice);
    return indice;
  }

  /**
   * Get stats for a single category
   * @param {string} category - Category name
   * @param {StatsOptions} [options={}] - Calculation options
   * @returns {Promise<CategoryStats>} Category statistics
   */
  async getCategoryStats(category, options = {}) {
    if (!category) {
      return { total: 0, available: 0, missing: 0, percentage: 0 };
    }

    const {
      useCache = true,
      forceRecalculate = false,
      louvoresData = null,
      cachedPdfs = null
    } = options;

    // Check memory cache first (fastest)
    if (!forceRecalculate && useCache && this.memoryCache.has(category)) {
      const cached = this.memoryCache.get(category);
      // Check if cache is still valid (basic check)
      if (cached && cached.timestamp && Date.now() - cached.timestamp < 60000) {
        logger.debug(`Memory cache hit for category: ${category}`);
        return cached.stats;
      }
    }

    // Check persistent cache
    if (!forceRecalculate && useCache) {
      const cached = getCachedStats(category);
      if (cached) {
        // Update memory cache
        this.memoryCache.set(category, {
          stats: cached,
          timestamp: Date.now()
        });
        logger.debug(`Persistent cache hit for category: ${category}`);
        return /** @type {CategoryStats} */ (cached);
      }
    }

    // Prevent duplicate calculations
    if (this.calculationInProgress.has(category)) {
      // Wait for existing calculation
      await /** @type {Promise<void>} */ (new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this.calculationInProgress.has(category)) {
            clearInterval(checkInterval);
            resolve(undefined);
          }
        }, 50);
      }));
      
      // Try cache again after waiting
      const cached = this.memoryCache.get(category) || getCachedStats(category);
      if (cached) {
        return cached.stats || cached;
      }
    }

    // Mark as in progress
    this.calculationInProgress.add(category);

    try {
      const startTime = performance.now();

      // Get louvores data
      let louvores = louvoresData;
      if (!louvores) {
        const { louvores: louvoresStore } = await import('$lib/stores/louvores.js');
        const { get } = await import('svelte/store');
        louvores = get(louvoresStore);
      }

      if (!louvores || !Array.isArray(louvores)) {
        logger.warn('No louvores data available');
        return { total: 0, available: 0, missing: 0, percentage: 0 };
      }

      // Get cached PDFs
      let cachedPdfsList = cachedPdfs;
      if (!cachedPdfsList) {
        if (browser) {
          cachedPdfsList = await getCachedPDFsFast();
        } else {
          cachedPdfsList = [];
        }
      }

      // Normalize category and get all variants (e.g., "Cifra" includes "Cifra nível I" and "Cifra nível II")
      const normalizedCategory = this._normalizeCategory(category);
      const categoryVariants = this._getCategoryVariants(normalizedCategory);
      
      // Filter louvores by category and its variants
      const categoryLouvores = louvores.filter((/** @type {any} */ l) => categoryVariants.includes(l.categoria));
      const total = categoryLouvores.length;

      if (total === 0) {
        const result = { total: 0, available: 0, missing: 0, percentage: 0 };
        this._cacheResult(category, result, louvores.length, cachedPdfsList.length);
        return result;
      }

      // Contagem de faltantes: um índice, uma passagem, cedência por relógio.
      //
      // O ramo `> 100` saiu. Ele fatiava a categoria em chunks de 50 e esperava
      // um `setTimeout(…, 0)` entre eles — que, aninhado a partir do quinto
      // nível e com a aba não visível, o Chrome trava em 1000 ms. Medido em
      // produção: `Gestos` (6 chunks) e `Partitura` (34 chunks) gravadas com
      // 27,98 s de diferença, 1,00 s por chunk, exato. Eram ~95 s de espera
      // pura por varredura — o botão "atualizar" preso, e o utilizador a ver
      // estatísticas que não mudavam.
      //
      // `findMissingPdfs` também saiu do caminho, mas continua a valer para os
      // outros três chamadores: ela reconstrói o índice a cada chamada, e era
      // chamada uma vez por chunk. Aqui o índice vem memoizado e o que se
      // percorre é a lista inteira, uma vez. `pdfCacheIndex.equivalencia.test.js`
      // prova, sobre os 4629 caminhos do acervo, que a contagem é a mesma.
      const indice = this.#obterIndice(/** @type {string[]} */ (cachedPdfsList));
      const cedente = criarCedente();

      let missing = 0;
      for (const louvor of categoryLouvores) {
        if (louvorFaltaNoIndice(louvor, indice)) missing++;
        await cedente.talvezCeder();
      }

      const available = total - missing;
      const percentage = total > 0 ? Math.round((available / total) * 100) : 0;

      const result = { total, available, missing, percentage };

      // Cache the result
      this._cacheResult(category, result, louvores.length, cachedPdfsList.length);

      const calculationTime = performance.now() - startTime;
      logger.debug(`Calculated stats for ${category} in ${calculationTime.toFixed(2)}ms`);

      return result;
    } catch (error) {
      logger.error(`Error calculating stats for ${category}:`, error);
      return { total: 0, available: 0, missing: 0, percentage: 0 };
    } finally {
      this.calculationInProgress.delete(category);
    }
  }

  /**
   * Get stats for all categories
   * @param {StatsOptions} [options={}] - Calculation options
   * @returns {Promise<Record<string, CategoryStats>>} Map of category -> stats
   */
  async getAllStats(options = {}) {
    const {
      useCache = true,
      forceRecalculate = false,
      louvoresData = null,
      cachedPdfs = null
    } = options;

    // Get louvores data
    let louvores = louvoresData;
    if (!louvores) {
      const { louvores: louvoresStore } = await import('$lib/stores/louvores.js');
      const { get } = await import('svelte/store');
      louvores = get(louvoresStore);
    }

    if (!louvores || !Array.isArray(louvores)) {
      logger.warn('No louvores data available');
      return {};
    }

      // Get all unique categories and normalize them
      const allCategories = [...new Set(louvores.map((/** @type {any} */ l) => l.categoria).filter(Boolean))];
      const categories = [...new Set(allCategories.map(cat => this._normalizeCategory(cat)))];

    // Load all cached stats if available
    if (useCache && !forceRecalculate) {
      const allCached = getAllCachedStats();
      if (Object.keys(allCached).length > 0) {
        // Update memory cache
        Object.entries(allCached).forEach(([category, stats]) => {
          this.memoryCache.set(category, {
            stats,
            timestamp: Date.now()
          });
        });
      }
    }

    // Calculate stats for all categories
    /** @type {Record<string, CategoryStats>} */
    const allStats = {};
    const statsPromises = categories.map(async (category) => {
      const stats = await this.getCategoryStats(category, {
        ...options,
        louvoresData: louvores,
        cachedPdfs
      });
      allStats[category] = stats;
    });

    await Promise.all(statsPromises);

    return allStats;
  }

  /**
   * Invalidate stats for a specific category
   * @param {string} category - Category to invalidate
   */
  invalidateCategory(category) {
    if (!category) return;

    // Remove from memory cache
    this.memoryCache.delete(category);

    // Invalidate persistent cache
    invalidateCategory(category);

    logger.debug(`Invalidated stats for category: ${category}`);
  }

  /**
   * Invalidate stats for all categories
   */
  invalidateAll() {
    // Clear memory cache
    this.memoryCache.clear();

    // WeakMap não tem clear(): reatribuir é o descarte. Na prática é redundante
    // — a lista velha morre sozinha —, mas invalidar tudo tem de significar
    // tudo, e um índice construído sobre uma lista ainda viva ficaria de pé.
    this.#indicePorLista = new WeakMap();

    // Invalidate all persistent cache
    const allCached = getAllCachedStats();
    const categories = Object.keys(allCached);
    invalidateCategories(categories);

    logger.debug('Invalidated all stats');
  }

  /**
   * Sync stats with current cache state
   * Invalidates and recalculates stats if cache has changed
   * @param {Array<Object> | null} [cachedPdfs] - Current cached PDFs list
   * @returns {Promise<void>}
   */
  async sync(cachedPdfs = null) {
    logger.debug('Syncing stats with cache state');

    // Get current cached PDFs if not provided
    let currentCachedPdfs = cachedPdfs;
    if (!currentCachedPdfs && browser) {
      currentCachedPdfs = await getCachedPDFsFast();
    }

    // Get cached stats metadata to compare
    const allCached = getAllCachedStats();
    
    // For now, we'll invalidate all and let them be recalculated on demand
    // This is simpler and ensures consistency
    // In the future, we could do incremental sync
    this.invalidateAll();

    logger.debug('Stats sync completed');
  }

  /**
   * Normalize category name - aggregates subcategories into main category
   * @param {string} category - Category name to normalize
   * @returns {string} Normalized category name
   * @private
   */
  _normalizeCategory(category) {
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
   * @private
   */
  _getCategoryVariants(normalizedCategory) {
    if (normalizedCategory === 'Cifra') {
      return ['Cifra', 'Cifra nível I', 'Cifra nível II'];
    }
    return [normalizedCategory];
  }

  /**
   * Cache calculation result
   * @param {string} category - Category name
   * @param {CategoryStats} stats - Stats to cache
   * @param {number} louvoresCount - Total louvores count
   * @param {number} cachedPdfsCount - Total cached PDFs count
   * @private
   */
  _cacheResult(category, stats, louvoresCount, cachedPdfsCount) {
    // Cache in memory
    this.memoryCache.set(category, {
      stats,
      timestamp: Date.now(),
      louvoresCount,
      cachedPdfsCount
    });

    // Limit memory cache size (keep last 50)
    if (this.memoryCache.size > 50) {
      const firstKey = this.memoryCache.keys().next().value;
      this.memoryCache.delete(firstKey);
    }

    // Cache persistently
    cacheStats(category, stats, {
      louvoresCount,
      cachedPdfsCount
    });
  }
}

// Create singleton instance
const statsCalculator = new StatsCalculator();

export default statsCalculator;
