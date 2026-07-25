<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { Download, AlertCircle, CheckCircle, Info, Package, TrendingUp, RefreshCw, Upload } from 'lucide-svelte';
  import { offline, isDownloading } from '$lib/stores/offline';
  import { CATEGORY_OPTIONS } from '$lib/stores/filters';
  import { louvores, loadLouvores, louvoresLoaded } from '$lib/stores/louvores';
  import OfflineRequirementsAlert from '$lib/components/OfflineRequirementsAlert.svelte';
  import OfflineIndicator from '$lib/components/OfflineIndicator.svelte';
  import ErrorModal from '$lib/components/ErrorModal.svelte';
  import { downloadMissingPdfs } from '$lib/utils/missingPdfsDownloader.js';
  import { setupCacheSync, onCacheSync, checkCacheVersionChanged, updateCacheVersion } from '$lib/utils/cacheSync';
  import { clearPdfIndex } from '$lib/utils/pdfIndex';
  import {
    initStatsCache,
    getCachedStats,
    getAllCachedStats,
    cacheStats,
    invalidateCategories,
    clearCache as clearStatsCache,
    recordCalculationTime,
    getCacheMetrics
  } from '$lib/utils/statsCache';
  import statsCalculator from '$lib/offline/stats/StatsCalculator.js';
  import offlineEvents, { EVENTS as OFFLINE_EVENTS } from '$lib/offline/core/OfflineEvents.js';
  import offlineManager from '$lib/offline/core/OfflineManager.js';
  import cacheMigrationV2 from '$lib/offline/storage/CacheMigrationV2.js';
  import { browser } from '$app/environment';

  // Offline available flag from localStorage
  const OFFLINE_AVAILABLE_KEY = 'OFFLINE_AVAILABLE';
  let offlineAvailable = false;
  let isClearingCache = false;

  // Error modal state
  let showErrorModal = false;
  let errorTitle = 'Erro';
  let errorMessage = '';
  let isDownloadingMissing = false;
  let isImportingBundle = false;
  let importJustFinished = false;
  /** @type {HTMLInputElement | null} */
  let bundleFileInput = null;
  /** @type {Array<{ id: string, label: string, status: 'pending' | 'active' | 'done', counts?: { ok: number, fail: number, total: number } }>} */
  let importChecklist = [];

  const IMPORT_STATUS_LABEL = {
    pending: 'A fazer',
    active: 'Em progresso',
    done: 'Concluído'
  };

  // Selected categories for download
  /**
     * @type {string[]}
     */
  let selectedCategories = [];

  // Track which categories are already downloaded (cannot be removed)
  /**
     * @type {string[]}
     */
  let downloadedCategories = [];
  
  // Track last saved categories to prevent unnecessary saves
  /**
     * @type {string[]}
     */
  let lastSavedCategories = [];
  
  // Category availability stats
  /**
     * @type {Record<string, {total: number, available: number, missing: number, percentage: number}>}
     */
  let categoryStats = {};
  
  // Required packages info
  /**
     * @type {{totalParts: number, totalSize: number, partsByCategory: Object} | null}
     */
  let requiredPackagesInfo = null;
  
  let isLoadingStats = false;
  /** @type {boolean} Painel de stats visível (capa com cache; cálculo só ao atualizar) */
  let statsRequested = true;
  /** true = a mostrar cache com capa; false = já atualizado nesta sessão */
  let statsStale = true;
  let isValidating = false; // Controla validação de erros (background)
  let needsSync = false;
  let isSyncing = false;
  let lastSyncTime = null;
  
  // Migration V2 state
  let isMigrating = false;
  let migrationProgress = null;
  let migrationResult = null;
  let migrationNeeded = false;
  /** @type {(() => void) | null} */
  let syncUnsubscribe = null;
  
  // FASE 2: Variáveis de triggers automáticos removidas
  /** @type {ReturnType<typeof setInterval> | null} */
  let syncCheckInterval = null;
  
  // FASE 2: Handlers de eventos automáticos removidos
  
  // Intersection Observer para lazy loading de stats
  /** @type {IntersectionObserver | null} */
  let categoryObserver = null;
  /** @type {Set<string>} */
  let categoriesToLoad = new Set();
  /** @type {Set<string>} */
  let loadedCategories = new Set();
  
  // Controla se lazy loading está ativo
  let lazyLoadingEnabled = false;
  let statsCacheInited = false;

  /**
   * Dados leves necessários antes de download/stats (sem varrer Cache Storage).
   */
  async function ensureLouvoresReady() {
    if ($louvores.length > 0) return;
    await loadLouvores();
  }

  function ensureStatsCacheReady() {
    if (statsCacheInited) return;
    initStatsCache();
    statsCacheInited = true;
  }
  
  /**
   * FASE 3: Setup Intersection Observer para lazy loading otimizado de stats
   * Com priorização inteligente de categorias
   */
  function setupLazyLoading() {
    if (typeof IntersectionObserver === 'undefined' || lazyLoadingEnabled) {
      return;
    }
    
    lazyLoadingEnabled = true;
    
    // FASE 3: Priorizar categorias com mais PDFs (mais importantes)
    const categoryPriority = new Map();
    $louvores.forEach(louvor => {
      const cat = louvor.categoria;
      categoryPriority.set(cat, (categoryPriority.get(cat) || 0) + 1);
    });
    
    // Configurar observer com root margin para carregar um pouco antes de entrar no viewport
    categoryObserver = new IntersectionObserver(
      (entries) => {
        const visibleCategories = [];
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const category = entry.target.getAttribute('data-category');
            if (category && !loadedCategories.has(category) && !categoriesToLoad.has(category)) {
              visibleCategories.push(category);
              categoriesToLoad.add(category);
            }
          }
        });
        
        // FASE 3: Ordenar por prioridade (mais PDFs primeiro)
        visibleCategories.sort((a, b) => {
          const priorityA = categoryPriority.get(a) || 0;
          const priorityB = categoryPriority.get(b) || 0;
          return priorityB - priorityA;
        });
        
        // Carregar stats de categorias visíveis em chunks
        if (visibleCategories.length > 0) {
          processStatsInChunks(visibleCategories).catch(err => {
            console.error('[Offline Page] Error loading visible category stats:', err);
          });
        }
      },
      {
        rootMargin: '150px', // FASE 3: Aumentado para prefetching mais agressivo
        threshold: 0.1
      }
    );
    
    // Observar elementos de categoria após renderização (usar tick para aguardar Svelte)
    setTimeout(() => {
      const categoryElements = document.querySelectorAll('.category-item[data-category]');
      categoryElements.forEach(el => {
        if (categoryObserver) {
          categoryObserver.observe(el);
        }
      });
      
      // Se não encontrou elementos, tentar novamente após um delay maior
      if (categoryElements.length === 0) {
        setTimeout(() => {
          const retryElements = document.querySelectorAll('.category-item[data-category]');
          retryElements.forEach(el => {
            if (categoryObserver) {
              categoryObserver.observe(el);
            }
          });
        }, 500);
      }
    }, 100);
  }
  
  /**
   * FASE 3: Processar stats em chunks com tamanho dinâmico baseado em performance
   * @param {string[]} categories - Lista de categorias para processar
   */
  async function processStatsInChunks(categories) {
    // FASE 3: Tamanho de chunk adaptativo baseado em métricas
    let chunkSize = 3; // Inicial
    const metrics = getCacheMetrics();
    if (metrics.avgCalculationTime < 30) {
      chunkSize = 5; // Se cálculos são rápidos, processar mais por vez
    } else if (metrics.avgCalculationTime > 100) {
      chunkSize = 2; // Se cálculos são lentos, processar menos por vez
    }
    
    const chunks = [];
    
    // Dividir em chunks
    for (let i = 0; i < categories.length; i += chunkSize) {
      chunks.push(categories.slice(i, i + chunkSize));
    }
    
    // Processar cada chunk com delay para não bloquear UI
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      // Carregar stats do chunk
      await loadCategoryStatsForCategories(chunk);
      
      // Marcar como carregadas
      chunk.forEach(cat => {
        loadedCategories.add(cat);
        categoriesToLoad.delete(cat);
      });
      
      // FASE 3: Delay adaptativo baseado em performance
      const delay = metrics.avgCalculationTime > 50 ? 100 : 50;
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  /**
   * Agendar carregamento de stats restantes em idle time
   */
  function scheduleIdleLoading() {
    // Usar requestIdleCallback se disponível, caso contrário setTimeout
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(
        async () => {
          // Aguardar um pouco para priorizar operações críticas
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Carregar categorias que ainda não foram carregadas (exceto selecionadas)
          const remainingCategories = CATEGORY_OPTIONS.filter(cat => 
            !loadedCategories.has(cat) && 
            !selectedCategories.includes(cat) &&
            !categoriesToLoad.has(cat)
          );
          
          if (remainingCategories.length > 0) {
            // Processar em chunks em background
            processStatsInChunks(remainingCategories).catch(err => {
              console.error('[Offline Page] Error loading stats in idle time:', err);
            });
          }
        },
        { timeout: 5000 } // Timeout de 5 segundos
      );
    } else {
      // Fallback para setTimeout se requestIdleCallback não estiver disponível
      setTimeout(async () => {
        // Aguardar um pouco para priorizar operações críticas
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Carregar categorias que ainda não foram carregadas (exceto selecionadas)
        const remainingCategories = CATEGORY_OPTIONS.filter(cat => 
          !loadedCategories.has(cat) && 
          !selectedCategories.includes(cat) &&
          !categoriesToLoad.has(cat)
        );
        
        if (remainingCategories.length > 0) {
          // Processar em chunks em background
          processStatsInChunks(remainingCategories).catch(err => {
            console.error('[Offline Page] Error loading stats in idle time:', err);
          });
        }
      }, 2000);
    }
  }

  // Check offline available status from localStorage
  function checkOfflineAvailable() {
    if (!browser) return false;
    try {
      const value = localStorage.getItem(OFFLINE_AVAILABLE_KEY);
      return value === 'TRUE';
    } catch (e) {
      console.warn('[Offline Page] Error reading OFFLINE_AVAILABLE:', e);
      return false;
    }
  }

  // Set offline available status
  function setOfflineAvailable(value) {
    if (!browser) return;
    try {
      if (value) {
        localStorage.setItem(OFFLINE_AVAILABLE_KEY, 'TRUE');
        offlineAvailable = true;
      } else {
        localStorage.removeItem(OFFLINE_AVAILABLE_KEY);
        offlineAvailable = false;
      }
    } catch (e) {
      console.warn('[Offline Page] Error setting OFFLINE_AVAILABLE:', e);
    }
  }

  // Bootstrap leve: localStorage + listeners. Nada de Cache Storage / stats / migration no open.
  onMount(() => {
    offlineAvailable = checkOfflineAvailable();
    openCachedStats(); // capa imediata com cache; sem cálculo pesado

    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
      performanceMetrics.enabled = true;
    }

    // Categorias só do localStorage (sem varrer PDFs)
    const saved = offline.getSavedCategories() || [];
    const downloaded = offline.getDownloadedCategories() || [];
    downloadedCategories = downloaded;
    selectedCategories = [...new Set([...saved, ...downloaded])];
    lastSavedCategories = [...selectedCategories];
    hasInitializedCategories = true;

    // Louvores em background — libera botões de download quando chegar
    loadLouvores().catch((err) => {
      console.warn('[Offline Page] Background louvores load failed:', err);
    });

    setupCacheSync();
    const unsubscribe = onCacheSync(() => {
      needsSync = true;
    });
    syncUnsubscribe = /** @type {(() => void) | null} */ (unsubscribe) || null;

    offlineEvents.on(OFFLINE_EVENTS.DOWNLOAD_COMPLETE, async (event) => {
      const detail = event.detail || {};
      const categories = detail.categories || [];
      if (categories.length === 0) return;

      invalidateCategories(categories);
      categories.forEach((cat) => {
        statsCache.delete(cat);
        statsCalculator.invalidateCategory(cat);
        loadedCategories.delete(cat);
      });

      if (statsRequested) {
        statsStale = true;
      }
    });

    window.addEventListener('cache-sync-required', handleCacheSyncRequired);
    window.addEventListener('offline-cache-updated', handleOfflineCacheUpdated);

    return () => {
      if (syncUnsubscribe) syncUnsubscribe();
      if (categoryObserver) {
        categoryObserver.disconnect();
        categoryObserver = null;
      }
      window.removeEventListener('cache-sync-required', handleCacheSyncRequired);
      window.removeEventListener('offline-cache-updated', handleOfflineCacheUpdated);
      window.removeEventListener('focus', checkSyncOnFocus);
      if (syncCheckInterval) clearInterval(syncCheckInterval);
    };
  });
  
  // Track last sync trigger to prevent excessive syncs
  let lastSyncTriggerTime = 0;
  const MIN_SYNC_INTERVAL = 5000; // Minimum 5 seconds between sync triggers
  
  // Track last cache update to prevent infinite loops
  let lastCacheUpdateTime = 0;
  let isProcessingCacheUpdate = false;
  const MIN_CACHE_UPDATE_INTERVAL = 1000; // Minimum 1 second between cache updates
  
  /**
   * @param {Event} event
   */
  function handleCacheSyncRequired(event) {
    const now = Date.now();
    // Prevent excessive sync triggers
    if ((now - lastSyncTriggerTime) < MIN_SYNC_INTERVAL) {
      console.log('[Offline Page] Sync trigger ignored - too soon since last trigger');
      return;
    }
    
    lastSyncTriggerTime = now;
    needsSync = true;
    if (event instanceof CustomEvent) {
      console.log('[Offline Page] Cache sync required:', event.detail);
    }
  }

  async function checkSyncOnFocus() {
    const changed = await checkCacheVersionChanged();
    if (changed) {
      needsSync = true;
    }
  }

  // Flag to track if stats need recalculation after batch
  let needsStatsRecalculation = false;

  /**
   * Handle offline cache updated event
   * This is fired when PDFs are downloaded and cached
   */
  async function handleOfflineCacheUpdated(event) {
    if (event instanceof CustomEvent) {
      const now = Date.now();
      
      // Prevent infinite loops: skip if processing or too soon since last update
      if (isProcessingCacheUpdate || (now - lastCacheUpdateTime) < MIN_CACHE_UPDATE_INTERVAL) {
        console.log('[Offline Page] Cache update ignored - already processing or too soon');
        return;
      }
      
      // Check if this is a duplicate event (same source and timestamp)
      const eventDetail = event.detail || {};
      const eventSource = eventDetail.source || 'unknown';
      const eventTimestamp = eventDetail.timestamp || now;
      
      // Skip if this is a cache-reload event that we triggered ourselves
      if (eventSource === 'cache-reload') {
        console.log('[Offline Page] Cache update ignored - recursive cache-reload event');
        return;
      }
      
      // FASE 4: Detect batch operations and defer stats recalculation
      const isBatchOperation = eventDetail.type === 'batch-pdfs-added' || 
                               eventDetail.batch === true ||
                               eventSource === 'zip-download-batch' ||
                               eventSource.includes('batch');
      
      if (isBatchOperation) {
        console.log('[Offline Page] Batch operation detected - deferring stats recalculation');
        needsStatsRecalculation = true;
        return; // Skip immediate processing for batch operations
      }
      
      isProcessingCacheUpdate = true;
      lastCacheUpdateTime = now;
      
      try {
        console.log('[Offline Page] Cache updated event received:', eventDetail);
        
        // Reload cached PDFs list to get updated count (skip event to prevent loop)
        await offline.loadCachedPdfsList(false, true);
        
        // Update downloaded categories
        const updatedDownloaded = await offline.checkAndUpdateDownloadedCategories();
        downloadedCategories = updatedDownloaded;
        
        // Ensure downloaded categories are selected
        updatedDownloaded.forEach((cat) => {
          if (!selectedCategories.includes(cat)) {
            selectedCategories = [...selectedCategories, cat];
          }
        });
        
        // Invalidate stats cache and reload for affected categories
        if (updatedDownloaded.length > 0) {
          // Invalidate all caches: persistent, memory, and StatsCalculator
          invalidateCategories(updatedDownloaded);
          updatedDownloaded.forEach(cat => statsCache.delete(cat));
          // Also invalidate StatsCalculator's internal cache
          updatedDownloaded.forEach(cat => statsCalculator.invalidateCategory(cat));
          loadedCategories.clear();
          
          // Force reload cached PDFs list to ensure we have latest data
          await offline.loadCachedPdfsList(false, true);

          if (statsRequested) {
            statsStale = true;
          }
        }
      } finally {
        isProcessingCacheUpdate = false;
      }
    }
  }
  
  async function forceSync() {
    if (isSyncing) return;
    
    isSyncing = true;
    try {
      console.log('[Offline Page] Forcing sync...');
      
      // Clear PDF index
      clearPdfIndex();
      
      // Validate and sync all stats (this will reload everything and fix inconsistencies)
      const syncResult = await offline.validateAndSyncStats();
      
      // Update downloaded categories from sync result
      downloadedCategories = syncResult.downloaded;
      
      // FASE 3: Invalidar cache após sync (mas manter se possível)
      clearStatsCache();
      statsCache.clear();
      // Also invalidate StatsCalculator's internal cache
      statsCalculator.invalidateAll();
      loadedCategories.clear();
      
      // Force reload cached PDFs list to ensure we have latest data
      await offline.loadCachedPdfsList(false, true);
      
      // Reload category stats to reflect any fixes (force to bypass rate limiting)
      await loadCategoryStats(true);
      
      // FASE 3: Log métricas se habilitado
      if (performanceMetrics.enabled) {
        const metrics = getCacheMetrics();
        performanceMetrics.lastMetrics = metrics;
        console.log('[Offline Page] Cache Metrics:', metrics);
      }
      
      // Update cache version
      await updateCacheVersion();
      
      // Validate and clear error if no longer relevant
      await offline.validateAndClearError();
      
      lastSyncTime = new Date();
      needsSync = false;
      
      console.log('[Offline Page] Sync completed');
    } catch (error) {
      console.error('[Offline Page] Sync error:', error);
    } finally {
      isSyncing = false;
    }
  }

  /**
   * Run cache migration V2 manually
   */
  async function runMigration() {
    if (isMigrating) return;
    
    isMigrating = true;
    migrationProgress = null;
    migrationResult = null;
    
    try {
      console.log('[Offline Page] Starting cache migration V2...');
      
      const result = await cacheMigrationV2.migrate({
        force: false,
        onProgress: (progress) => {
          migrationProgress = progress;
        }
      });
      
      migrationResult = result;
      migrationNeeded = false;
      
      // Reload stats after migration
      await loadCategoryStats(true);
      
      console.log('[Offline Page] Migration completed:', result);
    } catch (error) {
      console.error('[Offline Page] Migration error:', error);
      migrationResult = {
        migrated: 0,
        skipped: 0,
        errors: 1,
        errorDetails: [error.message || 'Migration failed']
      };
    } finally {
      isMigrating = false;
    }
  }

  // Track last stats load time to prevent excessive calls
  let lastStatsLoadTime = 0;
  const MIN_STATS_LOAD_INTERVAL = 2000; // Minimum 2 seconds between loads

  // FASE 3: Cache em memória para acesso rápido (complementa statsCache.js)
  let statsCache = new Map();
  
  // FASE 3: Métricas de performance
  let performanceMetrics = {
    enabled: false, // Habilitar em modo desenvolvimento
    lastMetrics: null
  };

  /**
   * Load category availability statistics for specific categories
   * @param {string[]} categories - Categories to load stats for
   * @param {boolean} force - Force reload even if cached
   */
  async function loadCategoryStatsForCategories(categories = [], force = false) {
    if (!$louvores.length || !categories || categories.length === 0) return;
    
    // Prevent concurrent loads
    if (isLoadingStats) {
      console.log('[Offline Page] Stats already loading, skipping');
      return;
    }
    
    isLoadingStats = true;
    
    try {
      // Always reload cached PDFs list before calculating stats
      // This ensures we have the latest cache state, especially important with lazy loading
      // Force reload to bypass cache and get fresh data
      await offline.loadCachedPdfsList(false, true);
      
      // Wait a bit for state to update
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const state = $offline;
      /** @type {string[]} */
      let cachedPdfs = state.cachedPdfs || [];
      
      // If still empty after reload, try one more time with delay
      if (!cachedPdfs || cachedPdfs.length === 0) {
        // Small delay to allow Service Worker to process
        await new Promise(resolve => setTimeout(resolve, 200));
        await offline.loadCachedPdfsList(false, true);
        await new Promise(resolve => setTimeout(resolve, 50));
        const updatedState = $offline;
        cachedPdfs = updatedState.cachedPdfs || [];
      }
      
      // Log for debugging
      if (force) {
        console.log('[Offline Page] Loading stats with', cachedPdfs.length, 'cached PDFs');
      }
      
      // FASE 3: Load category stats only for specified categories (usando cache otimizado)
      const newStats = { ...categoryStats };
      const statsToCalculate = [];
      const calculationStartTimes = new Map();
      
      for (const category of categories) {
        // FASE 3: Verificar cache usando novo sistema
        if (!force) {
          const cached = getCachedStats(category);
          if (cached) {
            newStats[category] = cached;
            statsCache.set(category, cached);
            continue;
          }
          
          // Se não estiver no cache persistente, verificar cache em memória
          if (statsCache.has(category)) {
            newStats[category] = statsCache.get(category);
            continue;
          }
        }
        
        // Marcar para cálculo
        statsToCalculate.push(category);
        calculationStartTimes.set(category, performance.now());
      }
      
      // FASE 3: Calcular stats em paralelo quando possível
      if (statsToCalculate.length > 0) {
        const calculationPromises = statsToCalculate.map(async (category) => {
          const startTime = calculationStartTimes.get(category);
          // FASE 4: Use StatsCalculator directly for better performance
          // When force=true, ensure we force recalculation and don't use cache
          const stats = await statsCalculator.getCategoryStats(
            category,
            {
              louvoresData: $louvores,
              cachedPdfs,
              useCache: !force,
              forceRecalculate: force
            }
          );
          const calcTime = performance.now() - startTime;
          recordCalculationTime(calcTime);
          
          newStats[category] = stats;
          statsCache.set(category, stats);
          
          // FASE 3: Salvar no cache com metadados
          cacheStats(category, stats, {
            louvoresCount: $louvores.length,
            cachedPdfsCount: cachedPdfs.length
          });
          
          return { category, stats };
        });
        
        await Promise.all(calculationPromises);
      }
      
      categoryStats = newStats;
      
      // Get required packages info for selected categories
      if (selectedCategories.length > 0) {
        // FASE 5: Use OfflineManager to get manifest
        let manifest = state.offlineManifest;
        if (!manifest) {
          manifest = await offlineManager.getOfflineManifest();
        }
        if (manifest) {
          // FASE 5: Use OfflineManager for required packages info
          requiredPackagesInfo = await offline.getRequiredPackagesInfo(
            selectedCategories,
            $louvores,
            cachedPdfs,
            manifest
          );
        }
      } else {
        requiredPackagesInfo = null;
      }
    } catch (error) {
      console.error('[Offline Page] Failed to load stats for categories:', error);
    } finally {
      isLoadingStats = false;
    }
  }

  /**
   * Mostra stats do cache local (rápido) com capa “desatualizado”.
   * O cálculo real só corre ao clicar em atualizar.
   */
  function openCachedStats() {
    ensureStatsCacheReady();
    const cached = getAllCachedStats();
    if (Object.keys(cached).length > 0) {
      categoryStats = { ...cached };
      Object.entries(cached).forEach(([cat, stats]) => {
        statsCache.set(cat, stats);
      });
    }
    statsRequested = true;
    statsStale = true;
  }

  // Load category availability statistics (all categories) — sob pedido
  async function loadCategoryStats(force = false) {
    statsRequested = true;
    ensureStatsCacheReady();
    await ensureLouvoresReady();
    if (!$louvores.length) return;
    
    // Prevent excessive calls - only allow if forced or enough time has passed
    const now = Date.now();
    if (!force && (now - lastStatsLoadTime) < MIN_STATS_LOAD_INTERVAL) {
      console.log('[Offline Page] Skipping stats load - too soon since last load');
      return;
    }
    
    // FASE 3: Invalidar cache se forçado
    if (force) {
      clearStatsCache();
      statsCache.clear();
    }
    
    // Usar função específica para todas as categorias
    await loadCategoryStatsForCategories(CATEGORY_OPTIONS, force);
    lastStatsLoadTime = now;
    statsStale = false;
  }

  // Track download completion to update categories
  let lastCompletedCount = 0;
  let hasCheckedAfterDownload = false;

  // React to download completion
  $: if (!downloading && completed > lastCompletedCount && completed > 0) {
    lastCompletedCount = completed;
    hasCheckedAfterDownload = false;
    
    // When download completes, update downloaded categories after a short delay
    setTimeout(async () => {
      if (!hasCheckedAfterDownload) {
        hasCheckedAfterDownload = true;
        
        // Garantir que cachedPdfs está atualizado antes de verificar categorias baixadas
        await offline.loadCachedPdfsList(false, true);
        await new Promise(resolve => setTimeout(resolve, 100)); // Pequeno delay para garantir atualização
        
        const cats = await offline.checkAndUpdateDownloadedCategories();
        downloadedCategories = cats;
        // Ensure downloaded categories are selected
        cats.forEach((/** @type {string} */ cat) => {
          if (!selectedCategories.includes(cat)) {
            selectedCategories = [...selectedCategories, cat];
          }
        });
        // FIX: Invalidar apenas categorias afetadas pelo download
        // Identificar categorias que foram baixadas (normalizadas)
        const affectedCategories = cats.length > 0 ? cats : selectedCategories;
        if (affectedCategories.length > 0) {
          // Invalidate all caches: persistent, memory, and StatsCalculator
          invalidateCategories(affectedCategories);
          // Remover do cache em memória também
          affectedCategories.forEach(cat => statsCache.delete(cat));
          // Also invalidate StatsCalculator's internal cache
          affectedCategories.forEach(cat => statsCalculator.invalidateCategory(cat));
        }
        loadedCategories.clear();
        
        // FASE 4: Recalcular stats se houver flag de batch pendente
        // ou sempre recalcular após download completo
        if (needsStatsRecalculation) {
          console.log('[Offline Page] Recalculating stats after batch operation');
          needsStatsRecalculation = false; // Reset flag
        }
        
        // Após download: marcar stats como desatualizadas (capa), sem recalcular agora
        if (statsRequested) {
          statsStale = true;
        }
        
        // Set offline available flag after download completes
        // Check if all categories are downloaded
        const allCategoriesDownloaded = CATEGORY_OPTIONS.every(cat => cats.includes(cat));
        if (allCategoriesDownloaded) {
          setOfflineAvailable(true);
        }
      }
    }, 1000);
  }

  // FASE 2: Removido trigger automático de stats por mudança de categoria
  // Stats são carregadas apenas quando necessário (após download ou manualmente)

  let hasInitializedCategories = false;
  
  // Save selected categories automatically when they change (after initialization)
  // Only save if categories actually changed to prevent loops
  $: if (hasInitializedCategories) {
    const categoriesStr = JSON.stringify([...selectedCategories].sort());
    const lastSavedStr = JSON.stringify([...lastSavedCategories].sort());
    
    if (categoriesStr !== lastSavedStr) {
      offline.saveCategories(selectedCategories);
      lastSavedCategories = [...selectedCategories];
    }
  }

  // Get current offline state
  $: state = $offline;
  $: downloading = $isDownloading;
  $: louvoresReady = $louvores.length > 0;
  
  // Track cached PDFs count to detect changes
  let lastCachedPdfsCount = 0;
  
  // React to cached PDFs changes — só marca como desatualizado (capa)
  $: if (statsRequested && state.cachedPdfs) {
    const currentCount = state.cachedPdfs.length;
    if (lastCachedPdfsCount > 0 && currentCount !== lastCachedPdfsCount) {
      statsStale = true;
    }
    lastCachedPdfsCount = currentCount;
  }
  // Filter out already downloaded categories from selection for download button
  // Also check if category is actually complete (100% with no missing PDFs)
  $: categoriesToDownload = selectedCategories.filter(cat => {
    // Don't include if already marked as downloaded
    if (downloadedCategories.includes(cat)) return false;
    // Check if category is actually 100% complete
    const stats = categoryStats[cat] || { total: 0, available: 0, missing: 0, percentage: 0 };
    const isActuallyComplete = stats.percentage === 100 && stats.missing === 0;
    // Only include if not actually complete (needs download)
    return !isActuallyComplete;
  });
  $: canDownload = categoriesToDownload.length > 0 && !downloading && louvoresReady;
  $: progress = state.progress || 0;
  $: completed = state.completed || 0;
  $: failed = state.failed || 0;
  $: total = state.total || 0;
  $: categorySizes = state.categorySizes || {};
  
  // Calculate total availability stats
  $: totalStats = Object.values(categoryStats).reduce((/** @type {{total: number, available: number, missing: number}} */ acc, stats) => {
    return {
      total: acc.total + stats.total,
      available: acc.available + stats.available,
      missing: acc.missing + stats.missing
    };
  }, { total: 0, available: 0, missing: 0 });
  
  $: overallPercentage = totalStats.total > 0 
    ? Math.round((totalStats.available / totalStats.total) * 100) 
    : 0;
  
  /**
   * Format bytes to human readable size
   * @param {number} bytes
   */
  function formatSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) {
      return `${mb.toFixed(2)} MB`;
    }
    const kb = bytes / 1024;
    return `${kb.toFixed(2)} KB`;
  }
  
  /**
   * Get total size of selected categories (excluding already downloaded and complete ones)
   */
  $: totalSelectedSize = selectedCategories
    .filter((/** @type {string} */ cat) => {
      // Don't include if already marked as downloaded
      if (downloadedCategories.includes(cat)) return false;
      // Don't include if actually complete (100% with no missing PDFs)
      const stats = categoryStats[cat] || { total: 0, available: 0, missing: 0, percentage: 0 };
      const isActuallyComplete = stats.percentage === 100 && stats.missing === 0;
      return !isActuallyComplete;
    })
    .reduce((/** @type {number} */ sum, /** @type {string} */ cat) => {
      return sum + ((/** @type {Record<string, number>} */ (categorySizes))[cat] || 0);
    }, 0);

  /**
     * Toggle category selection
     * @param {string} category
     */
  function toggleCategory(category) {
    if (downloading) return; // Can't change selection while downloading
    
    // Get stats for this category
    const stats = categoryStats[category] || { total: 0, available: 0, missing: 0, percentage: 0 };
    const isActuallyComplete = stats.percentage === 100 && stats.missing === 0;
    
    // Can't remove already downloaded categories or complete categories
    if (downloadedCategories.includes(category) || isActuallyComplete) return;

    if (selectedCategories.includes(category)) {
      selectedCategories = selectedCategories.filter(c => c !== category);
    } else {
      selectedCategories = [...selectedCategories, category];
    }
    
    // The reactive statement will automatically save the changes
  }

  /**
   * Start download
   */
  async function startDownload() {
    await ensureLouvoresReady();
    if (!$louvores.length || downloading) return;

    console.log('[Offline Page] Starting download for categories:', selectedCategories);
    
    // Filter out already downloaded categories - they should not be downloaded again
    const categoriesToDownload = selectedCategories.filter(cat => !downloadedCategories.includes(cat));
    
    if (categoriesToDownload.length === 0) {
      console.log('[Offline Page] All selected categories are already downloaded');
      return;
    }
    
    // FASE 5: Use OfflineManager directly
    await offlineManager.downloadCategories(categoriesToDownload, {
      louvoresData: $louvores
    });
    
    // After download completes, categories will be updated via reactive statement
  }

  /**
   * Cancel download
   * FASE 5: Now uses OfflineManager directly
   */
  async function cancelDownload() {
    console.log('[Offline Page] Cancelling download/import');
    await offlineManager.cancelDownload();
    if (isImportingBundle) importChecklist = [];
  }

  /**
   * Import zip-mãe from local file (offline-first).
   * @param {Event} event
   */
  async function handleBundleFileSelected(event) {
    const input = /** @type {HTMLInputElement} */ (event.currentTarget);
    const file = input.files && input.files[0];
    input.value = '';
    if (!file || downloading || isImportingBundle || isDownloadingMissing) return;

    isImportingBundle = true;
    importJustFinished = false;
    importChecklist = [];
    offline.updateState({
      downloading: true,
      progress: 0,
      completed: 0,
      failed: 0,
      total: 0,
      error: null
    });

    try {
      const result = await offlineManager.importOfflineBundle(file, {
        onProgress: (p) => {
          if (Array.isArray(p.checklist)) {
            importChecklist = p.checklist;
          }
          offline.updateState({
            downloading: true,
            progress: p.percentage || 0,
            completed: p.completed || 0,
            total: p.total || 0,
            failed: 0
          });
        }
      });

      if (result.cancelled) {
        importChecklist = [];
        offline.updateState({
          downloading: false,
          progress: 0,
          completed: 0,
          total: 0
        });
        return;
      }

      if (!result.success) {
        importChecklist = [];
        offline.updateState({ downloading: false, progress: 0 });
        errorTitle = 'Falha na importação';
        errorMessage =
          result.error ||
          'Não foi possível importar o pacote. O cache anterior foi mantido (rollback).';
        showErrorModal = true;
        return;
      }

      setOfflineAvailable(true);
      downloadedCategories = result.categories || [];
      lastSavedCategories = [...downloadedCategories];
      selectedCategories = [...downloadedCategories];
      importJustFinished = true;
      importChecklist = [];

      offline.updateState({
        downloading: false,
        progress: 100,
        completed: result.pdfsStored,
        total: result.pdfsStored,
        failed: 0
      });

      await offline.loadCachedPdfsList(false, true);
      if (statsRequested) {
        statsStale = true;
      }
    } catch (error) {
      console.error('[Offline Page] Bundle import error:', error);
      importChecklist = [];
      offline.updateState({ downloading: false, progress: 0 });
      errorTitle = 'Falha na importação';
      errorMessage =
        error?.message ||
        'Erro inesperado na importação. O cache anterior foi mantido (rollback).';
      showErrorModal = true;
    } finally {
      isImportingBundle = false;
    }
  }

  function triggerBundleFilePicker() {
    if (downloading || isImportingBundle || isDownloadingMissing) return;
    bundleFileInput?.click();
  }

  /**
   * Download all categories automatically
   */
  async function downloadAllCategories() {
    if (downloading) return;
    await ensureLouvoresReady();
    if (!$louvores.length) return;

    console.log('[Offline Page] Starting download for all categories');
    
    // Open offline-setup.pdf in new tab
    const pdfUrl = '/leitor?file=%2Fassets%2FColCIAs%2F001.pdf&titulo=Meu%20Deus%2C%20meu%20pai&subtitulo=Partitura%20%7C%20Coletânea%20CIAs&validated=true';
    window.open(pdfUrl);
    
    // Select all categories
    const allCategories = [...CATEGORY_OPTIONS];
    selectedCategories = allCategories;
    
    // Filter out already downloaded categories
    const categoriesToDownload = allCategories.filter(cat => !downloadedCategories.includes(cat));
    
    if (categoriesToDownload.length === 0) {
      console.log('[Offline Page] All categories are already downloaded');
      setOfflineAvailable(true);
      return;
    }
    
    // Download all categories
    try {
      const result = await offlineManager.downloadCategories(categoriesToDownload, {
        louvoresData: $louvores
      });
      
      // Set offline available flag after successful download
      // Wait a bit for the reactive statement to update downloadedCategories
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Check if all categories are now downloaded
      await offline.loadCachedPdfsList(false, true);
      const updatedDownloaded = await offline.checkAndUpdateDownloadedCategories();
      const allDownloaded = CATEGORY_OPTIONS.every(cat => updatedDownloaded.includes(cat));
      
      if (allDownloaded || result.success) {
        setOfflineAvailable(true);
      }
    } catch (error) {
      console.error('[Offline Page] Error downloading all categories:', error);
      throw error;
    }
  }

  /**
   * Handle download of missing PDFs
   */
  async function handleDownloadMissingPdfs() {
    if (isDownloadingMissing || downloading) return;
    await ensureLouvoresReady();
    if (!$louvores.length) return;

    isDownloadingMissing = true;
    showErrorModal = false;
    errorMessage = '';
    errorTitle = 'Erro';

    try {
      console.log('[Offline Page] Starting download of missing PDFs');

      // Update offline state to show downloading
      offline.updateState({
        downloading: true,
        progress: 0,
        completed: 0,
        failed: 0,
        total: 0
      });

      // Download missing PDFs
      const result = await downloadMissingPdfs({
        louvoresData: $louvores,
        onProgress: (progress) => {
          // Update offline state with progress
          offline.updateState({
            downloading: true,
            progress: progress.percentage || 0,
            completed: progress.completed || 0,
            failed: progress.failed || 0,
            total: progress.total || 0
          });
        }
      });

      // Update final state
      offline.updateState({
        downloading: false,
        progress: result.total > 0 ? Math.floor((result.completed / result.total) * 100) : 100,
        completed: result.completed,
        failed: result.failed,
        total: result.total
      });

      // Reload cached PDFs list to update stats
      await offline.loadCachedPdfsList(true, false);

      if (statsRequested) {
        statsStale = true;
      }

      // Show error modal if there were errors
      if (!result.success || result.errors.length > 0) {
        errorTitle = 'Erro ao baixar PDFs';
        errorMessage = result.errors.length > 0 
          ? result.errors.join('\n')
          : 'Alguns PDFs não puderam ser baixados.';
        showErrorModal = true;
      } else if (result.total === 0) {
        // No PDFs to download
        errorTitle = 'Informação';
        errorMessage = 'Todos os PDFs já estão disponíveis offline.';
        showErrorModal = true;
      }
    } catch (error) {
      console.error('[Offline Page] Error downloading missing PDFs:', error);
      
      // Update state with error
      offline.updateState({
        downloading: false,
        error: error.message || 'Erro ao baixar PDFs faltantes.'
      });

      // Show error modal
      errorTitle = 'Erro ao baixar PDFs';
      errorMessage = error.message || 'Ocorreu um erro ao tentar baixar os PDFs faltantes. Tente novamente.';
      showErrorModal = true;
    } finally {
      isDownloadingMissing = false;
    }
  }

  /**
   * Close error modal
   */
  function closeErrorModal() {
    showErrorModal = false;
    errorMessage = '';
    errorTitle = 'Erro';
  }

  /**
   * Clear all cache storage
   */
  async function clearAllCache() {
    if (isClearingCache) return;
    
    isClearingCache = true;
    console.log('[Offline Page] Clearing all cache...');
    
    try {
      // Clear offline manager cache (PDFs)
      await offlineManager.clearCache();
      
      // Clear all caches including plpc-pdfs e plpc-v4-app (ver static/sw.js CACHE_VERSION)
      if (typeof caches !== 'undefined') {
        try {
          // Clear plpc-pdfs cache (PDFs)
          const pdfCache = await caches.open('plpc-pdfs');
          const pdfKeys = await pdfCache.keys();
          await Promise.all(pdfKeys.map(key => pdfCache.delete(key)));
          console.log('[Offline Page] Cleared plpc-pdfs cache');
          
          // Clear app pages cache
          const appCache = await caches.open('plpc-v4-app');
          const appKeys = await appCache.keys();
          await Promise.all(appKeys.map(key => appCache.delete(key)));
          console.log('[Offline Page] Cleared app pages cache');
          
          // Also try to delete the entire caches if possible
          try {
            await caches.delete('plpc-pdfs');
            console.log('[Offline Page] Deleted plpc-pdfs cache entirely');
          } catch (e) {
            // Ignore if cache doesn't exist or can't be deleted
            console.debug('[Offline Page] Could not delete plpc-pdfs cache entirely:', e);
          }
          
          try {
            await caches.delete('plpc-v4-app');
            console.log('[Offline Page] Deleted plpc-v4-app cache entirely');
          } catch (e) {
            // Ignore if cache doesn't exist or can't be deleted
            console.debug('[Offline Page] Could not delete plpc-v4-app cache entirely:', e);
          }
        } catch (error) {
          console.warn('[Offline Page] Error clearing caches:', error);
        }
      }
      
      // Clear stats cache
      clearStatsCache();
      
      // Clear PDF index
      clearPdfIndex();
      
      // Remove offline available flag
      setOfflineAvailable(false);
      
      // Reset state variables
      selectedCategories = [];
      downloadedCategories = [];
      lastSavedCategories = [];
      categoryStats = {};
      requiredPackagesInfo = null;
      
      // Reload cached PDFs list
      await offline.loadCachedPdfsList(false, true);
      
      // Update downloaded categories
      const updatedDownloaded = await offline.checkAndUpdateDownloadedCategories();
      downloadedCategories = updatedDownloaded;
      
      console.log('[Offline Page] All cache cleared successfully');
      
      // Redirect to home page after clearing cache
      await goto('/');
    } catch (error) {
      console.error('[Offline Page] Error clearing cache:', error);
      throw error;
    } finally {
      isClearingCache = false;
    }
  }
</script>

<svelte:head>
  <title>Modo Offline</title>
</svelte:head>

<div class="max-w-4xl mx-auto">
  <!-- Body -->
  <div class="page-body">

      <!-- Migration progress -->
      {#if isMigrating && migrationProgress}
        <div class="migration-progress">
          <div class="migration-progress-header">
            <span>Migrando cache: {migrationProgress.current} / {migrationProgress.total}</span>
            <span class="migration-stats">
              {migrationProgress.migrated} migrados, {migrationProgress.skipped} ignorados, {migrationProgress.errors} erros
            </span>
          </div>
          <div class="migration-progress-bar">
            <div 
              class="migration-progress-fill" 
              style="width: {Math.round((migrationProgress.current / migrationProgress.total) * 100)}%"
            ></div>
          </div>
        </div>
      {/if}

      <!-- Migration result -->
      {#if migrationResult && !isMigrating}
        <div class="migration-result" class:success={migrationResult.errors === 0} class:error={migrationResult.errors > 0}>
          <div class="migration-result-content">
            {#if migrationResult.errors === 0}
              <CheckCircle class="w-5 h-5" />
              <div class="migration-result-text">
                <strong>Migração concluída com sucesso!</strong>
                <span>{migrationResult.migrated} PDFs migrados, {migrationResult.skipped} ignorados</span>
              </div>
            {:else}
              <AlertCircle class="w-5 h-5" />
              <div class="migration-result-text">
                <strong>Migração concluída com erros</strong>
                <span>{migrationResult.migrated} migrados, {migrationResult.errors} erros</span>
              </div>
            {/if}
            <button class="migration-close" on:click={() => migrationResult = null}>×</button>
          </div>
        </div>
      {/if}

      {#if downloading}
      <!-- Download / import progress -->
      <div class="progress-section">
        <div class="progress-info">
          <p class="progress-title">{isImportingBundle ? 'A importar pacote offline…' : 'Baixando PDFs...'}</p>
          {#if !isImportingBundle}
            <p class="progress-stats">
              {completed} de {total} PDFs baixados
              {#if failed > 0}
                <span class="failed-count">({failed} falharam)</span>
              {/if}
            </p>
          {/if}
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar" style="width: {progress}%"></div>
        </div>
        <p class="progress-percentage">{progress}%</p>
        {#if isImportingBundle && importChecklist.length}
          <ul class="import-checklist">
            {#each importChecklist as item (item.id)}
              <li class="import-checklist-item" data-status={item.status}>
                <span class="import-checklist-label">{item.label}</span>
                <span class="import-checklist-meta">
                  {#if item.counts}
                    <span class="import-counts" aria-label="válidos, inválidos, total">
                      <span class="import-count-ok">{item.counts.ok}</span>
                      <span class="import-count-sep">;</span>
                      <span class="import-count-fail">{item.counts.fail}</span>
                      <span class="import-count-sep">,</span>
                      <span class="import-count-total">{item.counts.total}</span>
                    </span>
                  {/if}
                  <span class="import-status-tag" data-status={item.status}
                    >{IMPORT_STATUS_LABEL[item.status]}</span
                  >
                </span>
              </li>
            {/each}
          </ul>
        {/if}
        <div class="action-buttons">
          <button class="btn btn-danger" on:click={cancelDownload}>
            {isImportingBundle ? 'Cancelar importação' : 'Cancelar Download'}
          </button>
        </div>
      </div>
      {:else if progress >= 100}
      <div class="complete-section">
        <CheckCircle class="w-16 h-16 complete-icon" />
        <p class="complete-title">{importJustFinished ? 'Importação concluída!' : 'Download concluído!'}</p>
        <p class="complete-stats">
          {completed} PDFs {importJustFinished ? 'importados' : 'baixados'} com sucesso
          {#if failed > 0}
            <br />
            <span class="failed-count">{failed} PDFs falharam</span>
          {/if}
        </p>
        <div class="action-buttons"></div>
      </div>
      {:else}
      <!-- Stats: capa com cache ao abrir; cálculo só ao clicar atualizar -->
      <div class="availability-summary" class:has-stale-overlay={statsStale}>
        <div class="summary-header">
          <TrendingUp class="w-5 h-5 summary-icon" />
          <h3 class="summary-title">Disponibilidade Geral</h3>
          {#if !statsStale}
            <button
              class="refresh-stats-btn"
              on:click={() => loadCategoryStats(true)}
              disabled={isLoadingStats}
              title="Atualizar estatísticas"
            >
              <RefreshCw class="w-4 h-4 {isLoadingStats ? 'spinning' : ''}" />
            </button>
          {/if}
          {#if performanceMetrics.enabled && performanceMetrics.lastMetrics}
            <button
              class="metrics-btn"
              on:click={() => {
                const metrics = getCacheMetrics();
                console.table(metrics);
                alert(`Cache Hit Rate: ${(metrics.cacheHitRate * 100).toFixed(1)}%\nAvg Calculation: ${metrics.avgCalculationTime}ms\nAvg Load: ${metrics.avgLoadTime}ms\nCache Size: ${(metrics.cacheSize / 1024).toFixed(2)} KB\nCategories Cached: ${metrics.categoriesCached}`);
              }}
              title="Mostrar métricas de performance (desenvolvimento)"
            >
              <TrendingUp class="w-4 h-4" />
            </button>
          {/if}
        </div>
        <div class="summary-stats">
          <div class="stat-item">
            <span class="stat-value">{totalStats.available}</span>
            <span class="stat-label">Disponíveis</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{totalStats.missing}</span>
            <span class="stat-label">Faltantes</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{totalStats.total}</span>
            <span class="stat-label">Total</span>
          </div>
          <div class="stat-item highlight">
            <span class="stat-value">{overallPercentage}%</span>
            <span class="stat-label">Completo</span>
          </div>
        </div>
        <div class="summary-progress-bar">
          <div 
            class="summary-progress-fill" 
            style="width: {overallPercentage}%"
          ></div>
        </div>

        {#if statsStale}
          <div class="stats-stale-overlay">
            <p class="stats-stale-hint">Dados em cache — podem estar desatualizados</p>
            <button
              class="btn btn-primary stats-refresh-cta"
              type="button"
              on:click={() => loadCategoryStats(true)}
              disabled={isLoadingStats}
            >
              {#if isLoadingStats}
                <RefreshCw class="w-5 h-5 spinning" />
                <span>A atualizar…</span>
              {:else}
                <RefreshCw class="w-5 h-5" />
                <span>Clique aqui para atualizar</span>
              {/if}
            </button>
          </div>
        {/if}
      </div>

      <!-- Info about category persistence and cache limitation -->
      <div class="info-box">
        <Info class="w-5 h-5 info-icon" />
        <div class="info-text">
          <p class="info-title">Sobre downloads automáticos e remoção</p>
          <p class="info-description">
            As categorias selecionadas serão salvas e usadas para downloads automáticos de novos PDFs.
            Novos PDFs serão baixados automaticamente apenas das categorias que você escolher.
          </p>
          <p class="info-description">
            <strong>Atenção:</strong> Ainda não há funcionalidade para remover downloads pré-baixados individualmente.
            Para remover todos os PDFs baixados, é necessário limpar o cache do navegador completamente.
          </p>
        </div>
      </div>

      <!-- Offline requirements alert -->
      <!-- <OfflineRequirementsAlert /> -->

      {#if !$louvoresLoaded}
        <p class="loading-text">Carregando lista de louvores...</p>
      {:else if !louvoresReady}
        <div class="error-box">
          <AlertCircle class="w-5 h-5 error-icon" />
          <p class="error-text">
            Não foi possível carregar os dados dos louvores. Conecte-se à internet e tente novamente.
          </p>
        </div>
      {/if}

      <!-- Loading indicator for stats (fora da capa, quando já atualizou e recalcula) -->
      {#if isLoadingStats && statsRequested && !statsStale}
        <div class="stats-loading-indicator">
          <RefreshCw class="w-4 h-4 spinning" />
          <span>Carregando estatísticas...</span>
        </div>
      {/if}

      <!-- Category selection (hidden) -->
      <div class="category-section" style="display: none;">
        <h2 class="section-title">Selecione as categorias para baixar:</h2>
        <div class="category-list">
          {#each CATEGORY_OPTIONS as category}
            {@const isSelected = selectedCategories.includes(category)}
            {@const categorySize = ((/** @type {Record<string, number>} */ (categorySizes))[category] || 0)}
            {@const stats = categoryStats[category] || { total: 0, available: 0, missing: 0, percentage: 0 }}
            {@const isActuallyComplete = stats.percentage === 100 && stats.missing === 0}
            {@const isDownloaded = downloadedCategories.includes(category)}
            {@const shouldShowCompleteBadge = isActuallyComplete && (isDownloaded || stats.available === stats.total)}
            
            <label 
              class="category-item" 
              class:downloaded={isDownloaded} 
              class:complete={isActuallyComplete}
              data-category={category}
            >
              <input
                type="checkbox"
                checked={isSelected}
                on:change={() => toggleCategory(category)}
                disabled={downloading || isDownloaded || isActuallyComplete}
              />
              <div class="category-info">
                <div class="category-header">
                  <span class="category-label">{category}</span>
                  {#if shouldShowCompleteBadge}
                    <span class="downloaded-badge">✓ Completo</span>
                  {:else if stats.total > 0}
                    <span class="partial-badge">{stats.percentage}% disponível</span>
                  {/if}
                </div>
                
                <!-- Availability stats -->
                {#if stats.total > 0}
                  <div class="category-stats">
                    <span class="stat-text">
                      {stats.available} de {stats.total} PDFs disponíveis
                    </span>
                    {#if stats.missing > 0}
                      <span class="missing-text">({stats.missing} faltantes)</span>
                    {/if}
                  </div>
                  
                  <!-- Progress bar per category -->
                  <div class="category-progress-bar">
                    <div 
                      class="category-progress-fill" 
                      style="width: {stats.percentage}%"
                      class:complete={isActuallyComplete}
                    ></div>
                  </div>
                {/if}
                
                {#if categorySize > 0}
                  <span class="category-size">{formatSize(categorySize)}</span>
                {/if}
              </div>
            </label>
          {/each}
        </div>
        
        <!-- Required packages info -->
        {#if requiredPackagesInfo && requiredPackagesInfo.totalParts > 0}
          <div class="packages-info">
            <Package class="w-5 h-5 packages-icon" />
            <div class="packages-content">
              <p class="packages-title">Lotes necessários para download</p>
              <p class="packages-text">
                Serão baixados <strong>{requiredPackagesInfo.totalParts} lotes</strong> 
                ({formatSize(requiredPackagesInfo.totalSize)}) contendo os PDFs faltantes.
              </p>
              {#if Object.keys(requiredPackagesInfo.partsByCategory).length > 0}
                <div class="packages-breakdown">
                  {#each Object.entries(requiredPackagesInfo.partsByCategory) as [category, parts]}
                    <div class="package-category">
                      <strong>{category}:</strong> {parts.length} lote(s)
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/if}
        
        {#if selectedCategories.length > 0 && totalSelectedSize > 0}
          <div class="total-size-info">
            <p class="total-size-text">
              Tamanho total a baixar: <strong>{formatSize(totalSelectedSize)}</strong>
            </p>
          </div>
        {/if}
      </div>

      <!-- Simplified action button -->
      <div class="action-buttons">
        <input
          bind:this={bundleFileInput}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          class="bundle-file-input"
          on:change={handleBundleFileSelected}
        />
        <button
          class="btn btn-secondary"
          type="button"
          on:click={triggerBundleFilePicker}
          disabled={downloading || isImportingBundle || isDownloadingMissing}
          title="Importar zip-mãe (offline-manifest + louvores-manifest + packages) sem rede"
        >
          {#if isImportingBundle}
            <RefreshCw class="w-5 h-5 spinning" />
            <span>A importar…</span>
          {:else}
            <Upload class="w-5 h-5" />
            <span>Importar pacote offline</span>
          {/if}
        </button>
        {#if offlineAvailable}
          <button
            class="btn btn-primary"
            on:click={handleDownloadMissingPdfs}
            disabled={downloading || isDownloadingMissing || !louvoresReady}
            title={!louvoresReady ? 'Aguardando carregamento dos louvores...' : downloading || isDownloadingMissing ? 'Download em andamento...' : 'Baixar apenas os PDFs que estão faltando'}
          >
            {#if downloading || isDownloadingMissing}
              <RefreshCw class="w-5 h-5 spinning" />
              <span>Baixando...</span>
            {:else}
              <Download class="w-5 h-5" />
              <span>Baixar PDFs faltantes</span>
            {/if}
          </button>
        {:else}
          <button
            class="btn btn-primary"
            on:click={downloadAllCategories}
            disabled={downloading || !louvoresReady || offlineAvailable}
            title={!louvoresReady ? 'Aguardando carregamento dos louvores...' : offlineAvailable ? 'Conteúdo já disponível offline' : 'Baixar todas as categorias para uso offline'}
          >
            {#if downloading}
              <RefreshCw class="w-5 h-5 spinning" />
              <span>Baixando...</span>
            {:else}
              <Download class="w-5 h-5" />
              <span>Disponibilizar offline</span>
            {/if}
          </button>
        {/if}
      </div>
      {/if}


    {#if state.error}
      {@const hasActualMissing = Object.values(categoryStats).some(s => s && s.missing > 0)}
      {#if hasActualMissing}
        <div class="error-box">
          <AlertCircle class="w-5 h-5 error-icon" />
          <p class="error-text">{state.error}</p>
        </div>
      {/if}
    {/if}
  </div>
</div>

<!-- Error Modal -->
<ErrorModal 
  show={showErrorModal}
  title={errorTitle}
  message={errorMessage}
  onClose={closeErrorModal}
/>

<style>
  .max-w-4xl {
    max-width: 56rem;
  }

  .mx-auto {
    margin-left: auto;
    margin-right: auto;
  }

  .page-body {
    padding: 1.5rem;
  }

  .offline-indicator-container {
    display: flex;
    justify-content: center;
    margin-bottom: 1.5rem;
  }
  /* Info box */
  .info-box {
    display: flex;
    gap: 1rem;
    padding: 1rem;
    background-color: #d1ecf1;
    border: 2px solid #17a2b8;
    border-radius: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .info-box :global(.info-icon) {
    color: #0c5460;
    flex-shrink: 0;
    margin-top: 0.125rem;
  }

  .info-text {
    flex: 1;
  }

  .info-title {
    font-weight: 700;
    color: #0c5460;
    margin: 0 0 0.5rem 0;
    font-size: 0.9375rem;
  }

  .info-description {
    color: #0c5460;
    margin: 0 0 0.5rem 0;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .info-description:last-child {
    margin-bottom: 0;
  }

  .loading-text {
    color: var(--text-light);
    margin: 0 0 1rem 0;
    font-size: 0.875rem;
  }

  /* Category section */
  .category-section {
    margin-bottom: 1.5rem;
  }

  .section-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-light);
    margin: 0 0 1rem 0;
    padding-bottom: 0.75rem;
    border-bottom: 2px solid var(--gold-color);
  }

  .category-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .category-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background-color: var(--placeholder-color);
    border: 2px solid var(--placeholder-color);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  /* Garantir que textos em category-item tenham contraste adequado */
  .category-item .category-label,
  .category-item .category-stats,
  .category-item .category-size {
    color: var(--text-dark);
  }

  .category-item:hover {
    border-color: var(--gold-color);
    background-color: var(--placeholder-color);
  }

  .category-item input[type="checkbox"] {
    width: 1.25rem;
    height: 1.25rem;
    cursor: pointer;
  }

  .category-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1;
  }

  .category-label {
    font-size: 0.9375rem;
    color: var(--text-dark);
    font-weight: 500;
  }

  .category-size {
    font-size: 0.8125rem;
    color: #495057;
    font-weight: 500;
  }
  
  .total-size-info {
    margin-top: 1rem;
    padding: 0.75rem;
    background-color: var(--background-color);
    border: 2px solid var(--gold-color);
    border-radius: 0.5rem;
  }

  .total-size-text {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-light);
    text-align: center;
  }

  .total-size-text strong {
    color: var(--gold-color);
    font-weight: 700;
  }

  /* Quando checkbox está marcado: fundo escuro, texto claro */
  .category-item:has(input[type="checkbox"]:checked) {
    background-color: var(--background-color);
    border-color: var(--gold-color);
  }

  .category-item:has(input[type="checkbox"]:checked) .category-label {
    color: var(--text-light);
  }
  
  /* Garantir contraste nos textos quando selecionado */
  .category-item:has(input[type="checkbox"]:checked) .category-stats,
  .category-item:has(input[type="checkbox"]:checked) .stat-text {
    color: var(--text-light);
  }
  
  .category-item:has(input[type="checkbox"]:checked) .missing-text {
    color: #ff6b6b;
  }
  
  .category-item:has(input[type="checkbox"]:checked) .category-size {
    color: var(--text-light);
    opacity: 0.9;
  }
  
  /* Ajustar badges quando selecionado */
  .category-item:has(input[type="checkbox"]:checked) .partial-badge {
    background-color: rgba(255, 193, 7, 0.3);
    border-color: rgba(255, 193, 7, 0.6);
    color: #ffd700;
  }
  
  .category-item:has(input[type="checkbox"]:checked) .downloaded-badge {
    background-color: rgba(212, 175, 55, 0.3);
    border: 1px solid rgba(212, 175, 55, 0.6);
    color: var(--gold-color);
  }

  /* Downloaded category styles */
  .category-item.downloaded {
    background-color: var(--background-color);
    border-color: var(--gold-color);
    opacity: 0.8;
    cursor: not-allowed;
  }

  .category-item.downloaded input[type="checkbox"] {
    cursor: not-allowed;
    opacity: 0.6;
  }

  /* Complete category styles (similar to downloaded) */
  .category-item.complete {
    background-color: var(--background-color);
    border-color: #28a745;
    opacity: 0.8;
    cursor: not-allowed;
  }

  .category-item.complete input[type="checkbox"] {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .downloaded-badge {
    font-size: 0.75rem;
    color: var(--gold-color);
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    background-color: rgba(212, 175, 55, 0.1);
    border-radius: 0.25rem;
  }
  
  .partial-badge {
    font-size: 0.75rem;
    color: #856404;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    background-color: rgba(255, 193, 7, 0.25);
    border-radius: 0.25rem;
    border: 1px solid rgba(255, 193, 7, 0.4);
  }
  
  .category-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  
  .category-stats {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
    color: var(--text-dark);
    opacity: 0.85;
    margin: 0.5rem 0;
  }
  
  .stat-text {
    font-weight: 500;
  }
  
  .missing-text {
    color: #dc3545;
    font-weight: 600;
  }
  
  .category-progress-bar {
    width: 100%;
    height: 0.5rem;
    background-color: var(--background-color);
    border-radius: 0.25rem;
    overflow: hidden;
    margin: 0.5rem 0;
    border: 1px solid var(--placeholder-color);
  }
  
  .category-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--gold-color), #ffd700);
    transition: width 0.3s ease;
  }
  
  .category-progress-fill.complete {
    background: linear-gradient(90deg, #28a745, #20c997);
  }
  
  .category-item.complete {
    border-color: #28a745;
  }
  
  /* Availability summary styles */
  .availability-summary {
    position: relative;
    background-color: var(--background-color);
    border: 2px solid var(--gold-color);
    border-radius: 0.75rem;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
    overflow: hidden;
  }

  .stats-stale-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 1rem;
    background: rgba(15, 15, 20, 0.55);
    backdrop-filter: blur(1px);
    z-index: 2;
  }

  .stats-stale-hint {
    margin: 0;
    color: #f5f5f5;
    font-size: 0.875rem;
    text-align: center;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  }

  .stats-refresh-cta {
    max-width: 100%;
  }
  
  /* Garantir contraste no summary */
  .availability-summary .summary-title {
    color: var(--text-light);
  }
  
  .refresh-stats-btn {
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    padding: 0.5rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    color: var(--text-color);
  }

  .refresh-stats-btn:hover:not(:disabled) {
    background: var(--hover-bg);
    border-color: var(--primary-color);
    transform: translateY(-1px);
  }

  .refresh-stats-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .refresh-stats-btn .spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .summary-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  
  .summary-icon {
    color: var(--gold-color);
  }
  
  /* Ajustar cores dos stat items para fundo escuro */
  .availability-summary .stat-item {
    background-color: rgba(212, 175, 55, 0.15);
    border: 1px solid rgba(212, 175, 55, 0.4);
  }
  
  .availability-summary .stat-value,
  .availability-summary .stat-label {
    color: var(--text-light);
  }
  
  .availability-summary .stat-item.highlight {
    background-color: var(--gold-color);
    border-color: var(--gold-color);
  }
  
  .availability-summary .stat-item.highlight .stat-value,
  .availability-summary .stat-item.highlight .stat-label {
    color: var(--text-dark);
  }
  
  .summary-title {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--text-light);
    margin: 0;
  }
  
  .summary-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 1rem;
    margin-bottom: 1rem;
  }
  
  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.75rem;
    background-color: rgba(255, 255, 255, 0.1);
    border-radius: 0.5rem;
    border: 1px solid rgba(212, 175, 55, 0.3);
  }
  
  .stat-item.highlight {
    background-color: var(--gold-color);
    border-color: var(--gold-color);
  }
  
  .stat-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-dark);
  }
  
  .stat-item.highlight .stat-value {
    color: var(--text-dark);
  }
  
  .stat-label {
    font-size: 0.75rem;
    color: var(--text-dark);
    opacity: 0.85;
    margin-top: 0.25rem;
  }
  
  .stat-item.highlight .stat-label {
    color: var(--text-dark);
    opacity: 0.95;
  }
  
  .summary-progress-bar {
    width: 100%;
    height: 1rem;
    background-color: var(--background-color);
    border-radius: 0.5rem;
    overflow: hidden;
    border: 1px solid var(--placeholder-color);
  }
  
  .summary-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--gold-color), #ffd700);
    transition: width 0.3s ease;
  }
  
  /* Packages info styles */
  .packages-info {
    display: flex;
    gap: 1rem;
    padding: 1rem;
    background-color: #e7f3ff;
    border: 2px solid #17a2b8;
    border-radius: 0.5rem;
    margin-top: 1rem;
  }
  
  .packages-icon {
    color: #17a2b8;
    flex-shrink: 0;
    margin-top: 0.125rem;
  }
  
  .packages-content {
    flex: 1;
  }
  
  .packages-title {
    font-weight: 700;
    color: #0c5460;
    margin: 0 0 0.5rem 0;
    font-size: 0.9375rem;
  }
  
  .packages-text {
    color: #0c5460;
    margin: 0 0 0.5rem 0;
    font-size: 0.875rem;
    line-height: 1.5;
  }
  
  .packages-breakdown {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.5rem;
  }
  
  .package-category {
    font-size: 0.8125rem;
    color: #0c5460;
    padding: 0.25rem 0.5rem;
    background-color: rgba(23, 162, 184, 0.1);
    border-radius: 0.25rem;
  }

  /* Progress section */
  .progress-section {
    text-align: center;
  }

  .progress-info {
    margin-bottom: 1.5rem;
  }

  .progress-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-light);
    margin: 0 0 0.5rem 0;
  }

  .progress-stats {
    font-size: 0.9375rem;
    color: var(--text-light);
    margin: 0;
  }

  .failed-count {
    color: #dc3545;
    font-weight: 600;
  }

  .progress-bar-container {
    width: 100%;
    height: 2rem;
    background-color: var(--background-color);
    border: 2px solid var(--placeholder-color);
    border-radius: 1rem;
    overflow: hidden;
    margin-bottom: 0.75rem;
  }

  .progress-bar {
    height: 100%;
    background: linear-gradient(90deg, var(--gold-color), #ffd700);
    transition: width 0.3s ease;
    border-radius: 0.875rem;
  }

  .progress-percentage {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-light);
    margin: 0 0 1rem 0;
  }

  .import-checklist {
    list-style: none;
    margin: 0 0 1.25rem;
    padding: 0;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .import-checklist-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.5rem 0.65rem;
    border: 1px solid rgba(212, 175, 55, 0.25);
    border-radius: 0.35rem;
    background: rgba(0, 0, 0, 0.15);
  }

  .import-checklist-label {
    font-size: 0.875rem;
    color: var(--text-light);
    min-width: 0;
  }

  .import-checklist-meta {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-shrink: 0;
  }

  .import-counts {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.8125rem;
    font-weight: 600;
    display: inline-flex;
    align-items: baseline;
    gap: 0.15rem;
  }

  .import-count-ok {
    color: #4ade80;
  }

  .import-count-fail {
    color: #f87171;
  }

  .import-count-total {
    color: #f5f5f5;
  }

  .import-count-sep {
    color: rgba(245, 245, 245, 0.45);
    font-weight: 400;
  }

  .import-status-tag {
    flex-shrink: 0;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 0.2rem 0.45rem;
    border-radius: 0.25rem;
    border: 1px solid transparent;
  }

  .import-status-tag[data-status='pending'] {
    color: #c8c2b4;
    border-color: rgba(200, 194, 180, 0.35);
    background: rgba(200, 194, 180, 0.08);
  }

  .import-status-tag[data-status='active'] {
    color: #1a1a1a;
    border-color: var(--gold-color);
    background: var(--gold-color);
  }

  .import-status-tag[data-status='done'] {
    color: #d4edda;
    border-color: rgba(40, 167, 69, 0.55);
    background: rgba(40, 167, 69, 0.2);
  }

  .progress-note {
    font-size: 0.875rem;
    color: var(--text-light);
    opacity: 0.8;
    margin: 1rem 0 0 0;
    font-style: italic;
  }

  /* Complete section */
  .complete-section {
    text-align: center;
    padding: 1rem 0;
  }

  .complete-section :global(.complete-icon) {
    color: #28a745;
    margin: 0 auto 1rem;
  }

  .complete-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-light);
    margin: 0 0 0.75rem 0;
  }

  .complete-stats {
    font-size: 1rem;
    color: var(--text-light);
    margin: 0 0 1.5rem 0;
  }

  /* Error box */
  .error-box {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    background-color: #f8d7da;
    border: 2px solid #dc3545;
    border-radius: 0.5rem;
    margin-top: 1rem;
  }

  .error-box :global(.error-icon) {
    color: #721c24;
    flex-shrink: 0;
  }

  .error-text {
    color: #721c24;
    margin: 0;
    font-size: 0.875rem;
    font-weight: 500;
  }

  /* Action buttons */
  .action-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    justify-content: flex-end;
    margin-top: 1.5rem;
  }

  .btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    border-radius: 0.5rem;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    border: 2px solid;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background-color: var(--gold-color);
    color: var(--text-dark);
    border-color: var(--gold-color);
  }

  .btn-primary:hover:not(:disabled) {
    background-color: #c9962e;
    border-color: #c9962e;
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(212, 175, 55, 0.3);
  }

  .btn-secondary {
    background-color: #fff;
    color: var(--text-dark);
    border-color: var(--gold-color);
  }

  .btn-secondary:hover:not(:disabled) {
    background-color: #f5f5f5;
  }

  .bundle-file-input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    overflow: hidden;
    z-index: -1;
  }

  .btn-danger {
    background-color: #dc3545;
    color: white;
    border-color: #dc3545;
  }

  .btn-danger:hover:not(:disabled) {
    background-color: #c82333;
    border-color: #c82333;
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(220, 53, 69, 0.3);
  }

  .btn .spinning {
    animation: spin 1s linear infinite;
  }

  /* Skeleton Screen Styles */
  .skeleton-container {
    padding: 1.5rem;
  }

  .skeleton {
    background: linear-gradient(90deg, var(--placeholder-color) 25%, rgba(255, 255, 255, 0.1) 50%, var(--placeholder-color) 75%);
    background-size: 200% 100%;
    animation: loading 1.5s infinite;
    border-radius: 0.5rem;
  }

  @keyframes loading {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .skeleton.availability-summary {
    height: 200px;
    margin-bottom: 1.5rem;
    padding: 1.5rem;
  }

  .skeleton-header {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .skeleton-icon {
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 0.25rem;
  }

  .skeleton-title {
    height: 1.25rem;
    width: 200px;
    border-radius: 0.25rem;
  }

  .skeleton-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .skeleton-stat {
    height: 80px;
    border-radius: 0.5rem;
  }

  .skeleton-progress-bar {
    height: 1rem;
    width: 100%;
    border-radius: 0.5rem;
  }

  .skeleton.info-box {
    height: 120px;
    margin-bottom: 1.5rem;
    padding: 1rem;
    display: flex;
    gap: 1rem;
  }

  .skeleton-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .skeleton-line {
    height: 1rem;
    width: 100%;
    border-radius: 0.25rem;
  }

  .skeleton-line.short {
    width: 60%;
  }

  .skeleton.category-section {
    margin-bottom: 1.5rem;
  }

  .skeleton-category-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .skeleton.category-item {
    display: flex;
    gap: 0.75rem;
    padding: 0.75rem;
    height: 100px;
  }

  .skeleton-checkbox {
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 0.25rem;
    flex-shrink: 0;
  }

  .skeleton-category-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .skeleton-category-header {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .skeleton-category-label {
    height: 1rem;
    width: 150px;
    border-radius: 0.25rem;
  }

  .skeleton-badge {
    height: 1rem;
    width: 80px;
    border-radius: 0.25rem;
  }

  .skeleton-category-stats {
    height: 0.875rem;
    width: 120px;
    border-radius: 0.25rem;
  }

  /* Stats Loading Indicator */
  .stats-loading-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background-color: var(--background-color);
    border: 1px solid var(--gold-color);
    border-radius: 0.5rem;
    margin-bottom: 1rem;
    color: var(--text-light);
    font-size: 0.875rem;
  }

  .stats-loading-indicator :global(.spinning) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* Migration V2 Styles */
  .migration-banner {
    background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(147, 51, 234, 0.1) 100%);
    border-left: 4px solid #3b82f6;
  }

  .migration-progress {
    background: var(--background-color);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.5rem;
    padding: 1rem;
    margin-bottom: 1.5rem;
  }

  .migration-progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
    font-size: 0.875rem;
  }

  .migration-stats {
    opacity: 0.7;
    font-size: 0.75rem;
  }

  .migration-progress-bar {
    width: 100%;
    height: 0.5rem;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 0.25rem;
    overflow: hidden;
  }

  .migration-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #3b82f6, #8b5cf6);
    transition: width 0.3s ease;
  }

  .migration-result {
    background: var(--background-color);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.5rem;
    padding: 1rem;
    margin-bottom: 1.5rem;
  }

  .migration-result.success {
    border-left: 4px solid #10b981;
  }

  .migration-result.error {
    border-left: 4px solid #ef4444;
  }

  .migration-result-content {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .migration-result-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .migration-result-text strong {
    font-weight: 600;
  }

  .migration-result-text span {
    font-size: 0.875rem;
    opacity: 0.8;
  }

  .migration-close {
    background: transparent;
    border: none;
    color: var(--text-light);
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    padding: 0.25rem;
    opacity: 0.7;
    transition: opacity 0.2s;
  }

  .migration-close:hover {
    opacity: 1;
  }

  /* Responsive */
  @media (max-width: 640px) {
    .page-body {
      padding: 1rem;
    }

    .action-buttons {
      flex-direction: column;
    }

    .btn {
      width: 100%;
      justify-content: center;
    }
  }
</style>

