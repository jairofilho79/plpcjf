/**
 * FASE 3: Sistema de cache inteligente para stats offline
 * 
 * Funcionalidades:
 * - Cache comprimido e versionado
 * - Invalidação seletiva por categoria
 * - Métricas de performance
 * - Migração automática entre versões
 */

import { safeKeys, safeRemoveMany } from './safeStorage.js';

const STATS_CACHE_KEY = 'offlineStatsCache_v2';
const STATS_CACHE_VERSION = 2;
const STATS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas

/**
 * Estrutura do cache versionado
 * @typedef {Object} CachedStatsData
 * @property {number} version - Versão do formato de cache
 * @property {number} timestamp - Timestamp de criação/atualização
 * @property {Record<string, {total: number, available: number, missing: number, percentage: number}>} stats - Stats por categoria
 * @property {Object} metadata - Metadados do cache
 * @property {number} metadata.louvoresCount - Número de louvores quando cache foi criado
 * @property {number} metadata.cachedPdfsCount - Número de PDFs em cache quando foi criado
 */

/**
 * Métricas de performance do cache
 * @typedef {Object} CacheMetrics
 * @property {number} cacheHitRate - Taxa de acerto do cache (0-1)
 * @property {number} avgCalculationTime - Tempo médio de cálculo em ms
 * @property {number} avgLoadTime - Tempo médio de carregamento em ms
 * @property {number} cacheSize - Tamanho do cache em bytes
 * @property {number} categoriesCached - Número de categorias em cache
 * @property {number} totalHits - Total de hits no cache
 * @property {number} totalMisses - Total de misses no cache
 */

// Cache em memória para acesso rápido
let memoryCache = new Map();

// Métricas de performance
let metrics = {
  hits: 0,
  misses: 0,
  calculationTimes: [],
  loadTimes: []
};

/**
 * Inicializar cache e migrar versões antigas se necessário
 */
export function initStatsCache() {
  try {
    // Verificar se existe cache antigo (Fase 2) e migrar
    const oldCacheKeys = [];
    // `safeKeys()` em vez de `localStorage.length` + `.key(i)`: se o
    // armazenamento lançar a meio, o laço cru perdia a lista toda para o
    // `catch` de fora. `safeKeys` devolve o que conseguiu ler.
    for (const key of safeKeys()) {
      if (key.startsWith('offlineStatsCache_') && !key.includes('_v2')) {
        oldCacheKeys.push(key);
      }
    }

    if (oldCacheKeys.length > 0) {
      console.log('[Stats Cache] Migrating old cache format...');
      migrateOldCache(oldCacheKeys);
    }

    // Carregar cache atual em memória
    loadCacheToMemory();
  } catch (error) {
    console.warn('[Stats Cache] Error initializing cache:', error);
  }
}

/**
 * Migrar cache da Fase 2 para formato da Fase 3
 * @param {string[]} oldKeys - Chaves do cache antigo
 */
function migrateOldCache(oldKeys) {
  try {
    const migratedStats = {};
    let latestTimestamp = 0;

    for (const key of oldKeys) {
      try {
        const cached = localStorage.getItem(key);
        if (!cached) continue;

        const { stats, timestamp } = JSON.parse(cached);
        const category = key.replace('offlineStatsCache_', '');

        if (stats && category) {
          migratedStats[category] = stats;
          if (timestamp > latestTimestamp) {
            latestTimestamp = timestamp;
          }
        }

        // Remover cache antigo
        localStorage.removeItem(key);
      } catch (err) {
        console.warn(`[Stats Cache] Error migrating key ${key}:`, err);
      }
    }

    if (Object.keys(migratedStats).length > 0) {
      // Salvar no novo formato
      const cacheData = {
        version: STATS_CACHE_VERSION,
        timestamp: latestTimestamp || Date.now(),
        stats: migratedStats,
        metadata: {
          louvoresCount: 0, // Não temos essa info no cache antigo
          cachedPdfsCount: 0
        }
      };

      localStorage.setItem(STATS_CACHE_KEY, JSON.stringify(cacheData));
      console.log('[Stats Cache] Migration completed:', Object.keys(migratedStats).length, 'categories');
    }
  } catch (error) {
    console.error('[Stats Cache] Error during migration:', error);
  }
}

/**
 * Carregar cache do localStorage para memória
 */
function loadCacheToMemory() {
  try {
    const cached = localStorage.getItem(STATS_CACHE_KEY);
    if (!cached) {
      memoryCache.clear();
      return;
    }

    const cacheData = /** @type {CachedStatsData} */ (JSON.parse(cached));

    // Verificar versão e TTL
    if (cacheData.version !== STATS_CACHE_VERSION) {
      console.log('[Stats Cache] Cache version mismatch, clearing...');
      clearCache();
      return;
    }

    const age = Date.now() - cacheData.timestamp;
    if (age > STATS_CACHE_TTL) {
      console.log('[Stats Cache] Cache expired, clearing...');
      clearCache();
      return;
    }

    // Carregar para memória
    memoryCache.clear();
    if (cacheData.stats) {
      Object.entries(cacheData.stats).forEach(([category, stats]) => {
        memoryCache.set(category, stats);
      });
    }

    console.log('[Stats Cache] Loaded', memoryCache.size, 'categories to memory');
  } catch (error) {
    console.warn('[Stats Cache] Error loading cache to memory:', error);
    memoryCache.clear();
  }
}

/**
 * Obter stats de uma categoria do cache
 * @param {string} category - Categoria
 * @returns {Object | null} - Stats ou null se não encontrado/expirado
 */
export function getCachedStats(category) {
  const startTime = performance.now();

  try {
    // Verificar cache em memória primeiro (mais rápido)
    if (memoryCache.has(category)) {
      metrics.hits++;
      const loadTime = performance.now() - startTime;
      metrics.loadTimes.push(loadTime);
      return memoryCache.get(category);
    }

    // Se não estiver em memória, verificar localStorage
    const cached = localStorage.getItem(STATS_CACHE_KEY);
    if (!cached) {
      metrics.misses++;
      return null;
    }

    const cacheData = /** @type {CachedStatsData} */ (JSON.parse(cached));

    // Verificar versão e TTL
    if (cacheData.version !== STATS_CACHE_VERSION) {
      metrics.misses++;
      return null;
    }

    const age = Date.now() - cacheData.timestamp;
    if (age > STATS_CACHE_TTL) {
      metrics.misses++;
      return null;
    }

    // Buscar stats da categoria
    const stats = cacheData.stats?.[category];
    if (stats) {
      // Atualizar cache em memória
      memoryCache.set(category, stats);
      metrics.hits++;
      const loadTime = performance.now() - startTime;
      metrics.loadTimes.push(loadTime);
      return stats;
    }

    metrics.misses++;
    return null;
  } catch (error) {
    console.warn('[Stats Cache] Error reading stats cache:', error);
    metrics.misses++;
    return null;
  }
}

/**
 * Obter todas as stats do cache
 * @returns {Record<string, Object>} - Todas as stats em cache
 */
export function getAllCachedStats() {
  try {
    const cached = localStorage.getItem(STATS_CACHE_KEY);
    if (!cached) return {};

    const cacheData = /** @type {CachedStatsData} */ (JSON.parse(cached));

    // Verificar versão e TTL
    if (cacheData.version !== STATS_CACHE_VERSION) {
      return {};
    }

    const age = Date.now() - cacheData.timestamp;
    if (age > STATS_CACHE_TTL) {
      return {};
    }

    return cacheData.stats || {};
  } catch (error) {
    console.warn('[Stats Cache] Error reading all cached stats:', error);
    return {};
  }
}

/**
 * Salvar stats de uma categoria no cache
 * @param {string} category - Categoria
 * @param {Object} stats - Stats para salvar
 * @param {Object} metadata - Metadados opcionais
 */
export function cacheStats(category, stats, metadata = {}) {
  try {
    const startTime = performance.now();

    // Atualizar cache em memória
    memoryCache.set(category, stats);

    // Carregar cache existente ou criar novo
    let cacheData = /** @type {CachedStatsData} */ ({
      version: STATS_CACHE_VERSION,
      timestamp: Date.now(),
      stats: {},
      metadata: {
        louvoresCount: metadata.louvoresCount || 0,
        cachedPdfsCount: metadata.cachedPdfsCount || 0
      }
    });

    const existing = localStorage.getItem(STATS_CACHE_KEY);
    if (existing) {
      try {
        const existingData = JSON.parse(existing);
        if (existingData.version === STATS_CACHE_VERSION) {
          cacheData = existingData;
          cacheData.timestamp = Date.now(); // Atualizar timestamp
        }
      } catch (err) {
        // Se falhar ao parsear, usar cache novo
      }
    }

    // Atualizar stats da categoria
    if (!cacheData.stats) {
      cacheData.stats = {};
    }
    cacheData.stats[category] = stats;

    // Atualizar metadados se fornecidos
    if (metadata.louvoresCount !== undefined) {
      cacheData.metadata.louvoresCount = metadata.louvoresCount;
    }
    if (metadata.cachedPdfsCount !== undefined) {
      cacheData.metadata.cachedPdfsCount = metadata.cachedPdfsCount;
    }

    // Salvar no localStorage
    localStorage.setItem(STATS_CACHE_KEY, JSON.stringify(cacheData));

    const saveTime = performance.now() - startTime;
    if (saveTime > 10) {
      console.log(`[Stats Cache] Slow save for ${category}:`, saveTime.toFixed(2), 'ms');
    }
  } catch (error) {
    console.warn('[Stats Cache] Error writing stats cache:', error);
    // Se falhar por falta de espaço, tentar limpar cache antigo
    if (error.name === 'QuotaExceededError') {
      console.warn('[Stats Cache] Storage quota exceeded, clearing old cache...');
      clearCache();
    }
  }
}

/**
 * Salvar múltiplas stats de uma vez (mais eficiente)
 * @param {Record<string, Object>} statsMap - Mapa de categoria -> stats
 * @param {Object} metadata - Metadados opcionais
 */
export function cacheAllStats(statsMap, metadata = {}) {
  try {
    const startTime = performance.now();

    // Atualizar cache em memória
    Object.entries(statsMap).forEach(([category, stats]) => {
      memoryCache.set(category, stats);
    });

    // Criar ou atualizar cache
    const cacheData = /** @type {CachedStatsData} */ ({
      version: STATS_CACHE_VERSION,
      timestamp: Date.now(),
      stats: { ...statsMap },
      metadata: {
        louvoresCount: metadata.louvoresCount || 0,
        cachedPdfsCount: metadata.cachedPdfsCount || 0
      }
    });

    // Salvar no localStorage
    localStorage.setItem(STATS_CACHE_KEY, JSON.stringify(cacheData));

    const saveTime = performance.now() - startTime;
    console.log(`[Stats Cache] Saved ${Object.keys(statsMap).length} categories in`, saveTime.toFixed(2), 'ms');
  } catch (error) {
    console.warn('[Stats Cache] Error writing all stats cache:', error);
    if (error.name === 'QuotaExceededError') {
      console.warn('[Stats Cache] Storage quota exceeded, clearing cache...');
      clearCache();
    }
  }
}

/**
 * Invalidar stats de uma categoria específica
 * @param {string} category - Categoria a invalidar
 */
export function invalidateCategory(category) {
  try {
    // Remover da memória
    memoryCache.delete(category);

    // Remover do localStorage
    const cached = localStorage.getItem(STATS_CACHE_KEY);
    if (!cached) return;

    const cacheData = /** @type {CachedStatsData} */ (JSON.parse(cached));
    if (cacheData.stats && cacheData.stats[category]) {
      delete cacheData.stats[category];
      cacheData.timestamp = Date.now(); // Atualizar timestamp
      localStorage.setItem(STATS_CACHE_KEY, JSON.stringify(cacheData));
      console.log('[Stats Cache] Invalidated category:', category);
    }
  } catch (error) {
    console.warn('[Stats Cache] Error invalidating category:', error);
  }
}

/**
 * Invalidar múltiplas categorias
 * @param {string[]} categories - Categorias a invalidar
 */
export function invalidateCategories(categories) {
  categories.forEach(category => invalidateCategory(category));
}

/**
 * Limpar todo o cache
 */
export function clearCache() {
  try {
    memoryCache.clear();
    localStorage.removeItem(STATS_CACHE_KEY);
    
    // Limpar também caches antigos (Fase 2)
    const keysToRemove = [];
    // Mesma troca da `initStatsCache`: enumerar cru descartava a lista inteira
    // se o storage lançasse a meio do laço.
    for (const key of safeKeys()) {
      if (key.startsWith('offlineStatsCache_')) {
        keysToRemove.push(key);
      }
    }
    // `safeRemoveMany` tenta todas as chaves; a sequência crua de `removeItem`
    // abortava na primeira que lançasse e deixava as restantes para trás.
    safeRemoveMany(keysToRemove);
    
    console.log('[Stats Cache] Cache cleared');
  } catch (error) {
    console.warn('[Stats Cache] Error clearing cache:', error);
  }
}

/**
 * Registrar tempo de cálculo
 * @param {number} time - Tempo em ms
 */
export function recordCalculationTime(time) {
  metrics.calculationTimes.push(time);
  // Manter apenas últimos 100 tempos
  if (metrics.calculationTimes.length > 100) {
    metrics.calculationTimes.shift();
  }
}

/**
 * Obter métricas de performance do cache
 * @returns {CacheMetrics} - Métricas do cache
 */
export function getCacheMetrics() {
  const totalRequests = metrics.hits + metrics.misses;
  const cacheHitRate = totalRequests > 0 ? metrics.hits / totalRequests : 0;

  const avgCalculationTime = metrics.calculationTimes.length > 0
    ? metrics.calculationTimes.reduce((a, b) => a + b, 0) / metrics.calculationTimes.length
    : 0;

  const avgLoadTime = metrics.loadTimes.length > 0
    ? metrics.loadTimes.reduce((a, b) => a + b, 0) / metrics.loadTimes.length
    : 0;

  // Calcular tamanho do cache
  let cacheSize = 0;
  try {
    const cached = localStorage.getItem(STATS_CACHE_KEY);
    if (cached) {
      cacheSize = new Blob([cached]).size;
    }
  } catch (error) {
    // Ignorar erro
  }

  return {
    cacheHitRate: Math.round(cacheHitRate * 100) / 100,
    avgCalculationTime: Math.round(avgCalculationTime * 10) / 10,
    avgLoadTime: Math.round(avgLoadTime * 10) / 10,
    cacheSize,
    categoriesCached: memoryCache.size,
    totalHits: metrics.hits,
    totalMisses: metrics.misses
  };
}

/**
 * Resetar métricas
 */
export function resetMetrics() {
  metrics = {
    hits: 0,
    misses: 0,
    calculationTimes: [],
    loadTimes: []
  };
}

/**
 * Verificar se cache está válido
 * @returns {boolean} - True se cache é válido
 */
export function isCacheValid() {
  try {
    const cached = localStorage.getItem(STATS_CACHE_KEY);
    if (!cached) return false;

    const cacheData = /** @type {CachedStatsData} */ (JSON.parse(cached));
    if (cacheData.version !== STATS_CACHE_VERSION) return false;

    const age = Date.now() - cacheData.timestamp;
    return age <= STATS_CACHE_TTL;
  } catch (error) {
    return false;
  }
}






