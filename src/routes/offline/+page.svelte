<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { Download, AlertCircle, CheckCircle, Info, Package, TrendingUp, RefreshCw, Database } from 'lucide-svelte';
  import { offline, isDownloading } from '$lib/stores/offline';
  import { CATEGORY_OPTIONS } from '$lib/stores/filters';
  import { louvores, loadLouvores, louvoresLoaded } from '$lib/stores/louvores';
  import OfflineRequirementsAlert from '$lib/components/OfflineRequirementsAlert.svelte';
  import ErrorModal from '$lib/components/ErrorModal.svelte';
  import { downloadMissingPdfs } from '$lib/utils/missingPdfsDownloader.js';
  import { setupCacheSync, onCacheSync, checkCacheVersionChanged, updateCacheVersion } from '$lib/utils/cacheSync';
  import { clearPdfIndex } from '$lib/utils/pdfIndex';
  import {
    initStatsCache,
    getCachedStats,
    cacheStats,
    cacheAllStats,
    invalidateCategory,
    invalidateCategories,
    clearCache as clearStatsCache,
    recordCalculationTime,
    getCacheMetrics,
    getAllCachedStats
  } from '$lib/utils/statsCache';
  import statsCalculator from '$lib/offline/stats/StatsCalculator.js';
  import offlineEvents, { EVENTS as OFFLINE_EVENTS } from '$lib/offline/core/OfflineEvents.js';
  import offlineManager from '$lib/offline/core/OfflineManager.js';
  import legacyCacheMigrationService from '$lib/offline/migration/LegacyCacheMigrationService.js';
  import { getConfig } from '$lib/offline/core/OfflineConfig.js';
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
  /** @type {string[]} */
  let unknownCategories = [];
  /** @type {{supported: boolean, persisted: boolean, usage: number, quota: number, free: number, loading: boolean}} */
  let storageInfo = {
    supported: false,
    persisted: false,
    usage: 0,
    quota: 0,
    free: 0,
    loading: true
  };
  
  let isLoadingStats = false;
  let isInitializing = true; // Controla estado de carregamento inicial
  let isValidating = false; // Controla validação de erros (background)
  let needsSync = false;
  let isSyncing = false;
  let lastSyncTime = null;
  
  // Migration state
  let isMigrating = false;
  /** @type {{ processed: number, total: number, migrated: number, skipped: number, errors: number, percentage: number } | null} */
  let migrationProgress = null;
  /** @type {{ migrated: number, skipped: number, errors: number, cancelled: boolean } | null} */
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

  /** Indicador de suporte: IndexedDB / armazenamento avançado ativo */
  let idbAdvancedStorageActive = false;

  function syncIdbAdvancedIndicator() {
    idbAdvancedStorageActive = getConfig('OFFLINE_IDB_ENABLED') === true;
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

  // Load saved categories and check downloaded categories on mount
  onMount(() => {
    // Check offline available status
    offlineAvailable = checkOfflineAvailable();
    
    // FASE 3: Inicializar sistema de cache
    initStatsCache();
    
    // FASE 3: Habilitar métricas em modo desenvolvimento
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
      performanceMetrics.enabled = true;
    }
    
    // Inicialização assíncrona
    (async () => {
      await refreshStorageInfo();
      // Trigger offline initialization early (flags persistidas aplicadas em initialize).
      offlineManager
        .initialize()
        .then(() => syncIdbAdvancedIndicator())
        .catch((error) => {
          console.warn('[Offline Page] OfflineManager initialization warning:', error);
        });
      // FASE 1: Operações críticas - carregam dados básicos para renderização inicial
      try {
        // Inicializar store offline explicitamente (lazy initialization)
        await offline.lazyInitialize();
        
        // Carregar louvores primeiro
        await loadLouvores();
        
        // Garantir que cachedPdfs está atualizado no estado local
        await offline.loadCachedPdfsList(false, true);
        await new Promise(resolve => setTimeout(resolve, 50)); // Pequeno delay para garantir atualização
        
        // Fase crítica: usar snapshot salvo para liberar a UI mais rápido.
        // A validação completa (custosa) roda em background.
        const savedDownloaded = offline.getDownloadedCategories();
        downloadedCategories = savedDownloaded;
        
        // Load saved categories for selection
        const saved = offline.getSavedCategories();
        if (saved && saved.length > 0) {
          selectedCategories = saved;
        }
        
        // Ensure downloaded categories are ALWAYS selected and cannot be deselected
        // Merge downloaded categories with saved categories, ensuring downloaded ones are included
        const allCategories = [...new Set([...selectedCategories, ...downloadedCategories])];
        selectedCategories = allCategories;
        
        // Initialize lastSavedCategories to prevent unnecessary saves during initialization
        lastSavedCategories = [...selectedCategories];
        hasInitializedCategories = true;
        
        // Invalidate stats usando snapshot local para evitar inconsistências visuais iniciais.
        if (savedDownloaded.length > 0) {
          // Invalidate all caches: persistent, memory, and StatsCalculator
          invalidateCategories(savedDownloaded);
          savedDownloaded.forEach(cat => statsCache.delete(cat));
          // Also invalidate StatsCalculator's internal cache
          savedDownloaded.forEach(cat => statsCalculator.invalidateCategory(cat));
        }
        
        // FASE 3: Carregar stats do cache para renderização inicial rápida
        const cachedStats = getAllCachedStats();
        if (Object.keys(cachedStats).length > 0) {
          categoryStats = { ...cachedStats };
          // Atualizar cache em memória
          Object.entries(cachedStats).forEach(([cat, stats]) => {
            statsCache.set(cat, stats);
          });
        }
        
        // Initialize lastCachedPdfsCount after loading cached PDFs
        const initialState = $offline;
        if (initialState.cachedPdfs) {
          lastCachedPdfsCount = initialState.cachedPdfs.length;
        }
        
        // Marcar inicialização básica como completa - permite renderização
        isInitializing = false;
        syncIdbAdvancedIndicator();

        // Validação completa em background: corrige categorias baixadas sem bloquear o carregamento.
        void (async () => {
          try {
            const validatedDownloaded = await offline.checkAndUpdateDownloadedCategories();
            downloadedCategories = validatedDownloaded;
            selectedCategories = [...new Set([...selectedCategories, ...validatedDownloaded])];
          } catch (err) {
            console.warn('[Offline Page] Background validation of downloaded categories failed:', err);
          }
        })();
      } catch (error) {
        console.error('[Offline Page] Error during critical initialization:', error);
        isInitializing = false;
        syncIdbAdvancedIndicator();
      }
      
      // FASE 2: Operações não-críticas - executadas em background após renderização
      // Carregar stats apenas para categorias selecionadas inicialmente (lazy loading completo vem depois)
      if (selectedCategories.length > 0) {
        // Carregar stats de categorias selecionadas primeiro (prioridade)
        loadCategoryStatsForCategories(selectedCategories).catch(err => {
          console.error('[Offline Page] Error loading initial stats:', err);
        });
      }
      
      // Validar erros em background (não bloqueante)
      isValidating = true;
      offline.validateAndClearError().catch(err => {
        console.error('[Offline Page] Error validating errors:', err);
      }).finally(() => {
        isValidating = false;
      });
    
      // Setup cache sync listener
      setupCacheSync();
      const unsubscribe = onCacheSync(() => {
        needsSync = true;
        console.log('[Offline Page] Cache sync required from another tab');
      });
      syncUnsubscribe = /** @type {(() => void) | null} */ (unsubscribe) || null;
      
      // FASE 4: Listen for stats invalidation events
      offlineEvents.on(OFFLINE_EVENTS.DOWNLOAD_COMPLETE, async (event) => {
        const detail = event.detail || {};
        const categories = detail.categories || [];
        
        if (categories.length > 0) {
          console.log('[Offline Page] FASE 4: Stats invalidated for categories after download:', categories);
          
          // Invalidate all caches for affected categories
          invalidateCategories(categories);
          categories.forEach(cat => {
            statsCache.delete(cat);
            statsCalculator.invalidateCategory(cat);
            loadedCategories.delete(cat);
          });
          
          // Force reload cached PDFs list to ensure we have latest data
          await offline.loadCachedPdfsList(false, true);
          
          // Reload stats for affected categories (force recalculation)
          await loadCategoryStatsForCategories(categories, true).catch(err => {
            console.error('[Offline Page] Error reloading stats after download:', err);
          });
        }
      });
      
      // Listen for cache sync events
      window.addEventListener('cache-sync-required', handleCacheSyncRequired);
      
      // Listen for offline cache updated events (from download completion)
      window.addEventListener('offline-cache-updated', handleOfflineCacheUpdated);
      
      // Check for sync needed on window focus
      window.addEventListener('focus', checkSyncOnFocus);
      
      // Check sync status periodically
      syncCheckInterval = setInterval(async () => {
        const changed = await checkCacheVersionChanged();
        if (changed) {
          needsSync = true;
        }
      }, 30000); // Check every 30 seconds
      
      // Check if legacy cache migration is needed (Cache API → IndexedDB)
      migrationNeeded = await legacyCacheMigrationService.isMigrationNeeded();
      
      // ============================================
      // FASE 2: Remoção de triggers automáticos de stats
      // Stats são geradas apenas após download completo ou manualmente
      // ============================================
    })();
    
    // Retornar função de cleanup síncrona
    return () => {
      if (syncUnsubscribe) {
        syncUnsubscribe();
      }
      if (cacheUpdateDebounceTimer) {
        clearTimeout(cacheUpdateDebounceTimer);
        cacheUpdateDebounceTimer = null;
      }
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
  /** @type {ReturnType<typeof setTimeout> | null} */
  let cacheUpdateDebounceTimer = null;
  let hasPendingCacheUpdate = false;
  let cacheUpdateRequestedDuringProcessing = false;
  let pendingCacheUpdateDetail = {};

  function scheduleCacheReconciliation(detail = {}) {
    hasPendingCacheUpdate = true;
    pendingCacheUpdateDetail = detail;

    if (cacheUpdateDebounceTimer) {
      clearTimeout(cacheUpdateDebounceTimer);
    }

    cacheUpdateDebounceTimer = setTimeout(() => {
      cacheUpdateDebounceTimer = null;
      void reconcileCacheUpdate();
    }, 700);
  }

  async function reconcileCacheUpdate() {
    if (isProcessingCacheUpdate) {
      cacheUpdateRequestedDuringProcessing = true;
      return;
    }
    if (!hasPendingCacheUpdate) {
      return;
    }

    isProcessingCacheUpdate = true;
    hasPendingCacheUpdate = false;
    lastCacheUpdateTime = Date.now();

    try {
      // Use fresh source of truth for cache-dependent decisions.
      await offline.loadCachedPdfsList(false, true, true);
      const updatedDownloaded = await offline.checkAndUpdateDownloadedCategories();
      downloadedCategories = updatedDownloaded;
      selectedCategories = [...new Set([...selectedCategories, ...updatedDownloaded])];

      if (updatedDownloaded.length > 0) {
        invalidateCategories(updatedDownloaded);
        updatedDownloaded.forEach(cat => statsCache.delete(cat));
        updatedDownloaded.forEach(cat => statsCalculator.invalidateCategory(cat));
        loadedCategories.clear();
        await loadCategoryStatsForCategories(updatedDownloaded, true);
      }

      if (pendingCacheUpdateDetail?.source) {
        console.log('[Offline Page] Cache reconciliation complete:', pendingCacheUpdateDetail);
      }
    } finally {
      isProcessingCacheUpdate = false;
      if (cacheUpdateRequestedDuringProcessing || hasPendingCacheUpdate) {
        cacheUpdateRequestedDuringProcessing = false;
        void reconcileCacheUpdate();
      }
    }
  }
  
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
        scheduleCacheReconciliation(eventDetail);
        return;
      }

      scheduleCacheReconciliation(eventDetail);
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
   * Run legacy cache → IndexedDB migration manually.
   * Resumable: if previously interrupted, continues from the saved checkpoint.
   */
  async function runMigration() {
    if (isMigrating) return;
    
    isMigrating = true;
    migrationProgress = null;
    migrationResult = null;
    
    try {
      console.log('[Offline Page] Starting legacy cache migration...');
      
      const result = await legacyCacheMigrationService.migrate({
        onProgress: (progress) => {
          migrationProgress = progress;
        }
      });
      
      migrationResult = result;
      migrationNeeded = result.cancelled
        ? await legacyCacheMigrationService.isMigrationNeeded()
        : false;
      
      // Invalidate and reload stats after migration (IDB now has more entries)
      statsCalculator.invalidateAll();
      await loadCategoryStats(true);
      
      console.log('[Offline Page] Migration completed:', result);
    } catch (error) {
      console.error('[Offline Page] Migration error:', error);
      migrationResult = {
        migrated: 0,
        skipped: 0,
        errors: 1,
        cancelled: false
      };
    } finally {
      isMigrating = false;
    }
  }

  /**
   * Cancel a running migration.
   */
  function cancelMigration() {
    legacyCacheMigrationService.cancel();
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
   * Load category availability statistics for specific categories.
   *
   * Stats are now computed directly from IndexedDB (via StatsCalculator →
   * OfflineInventoryRepository) — no Cache API list required.
   *
   * @param {string[]} categories
   * @param {boolean} force - Force recalculation, ignoring caches
   */
  async function loadCategoryStatsForCategories(categories = [], force = false) {
    if (!$louvores.length || !categories || categories.length === 0) return;
    
    if (isLoadingStats) {
      console.log('[Offline Page] Stats already loading, skipping');
      return;
    }
    
    isLoadingStats = true;
    
    try {
      const newStats = { ...categoryStats };
      const statsToCalculate = [];
      const calculationStartTimes = new Map();
      
      for (const category of categories) {
        if (!force) {
          const cached = getCachedStats(category);
          if (cached) {
            newStats[category] = cached;
            statsCache.set(category, cached);
            continue;
          }
          if (statsCache.has(category)) {
            newStats[category] = statsCache.get(category);
            continue;
          }
        }
        statsToCalculate.push(category);
        calculationStartTimes.set(category, performance.now());
      }
      
      if (statsToCalculate.length > 0) {
        const calculationPromises = statsToCalculate.map(async (category) => {
          const startTime = calculationStartTimes.get(category) || performance.now();
          // StatsCalculator queries IndexedDB — no cachedPdfs param needed
          const stats = await statsCalculator.getCategoryStats(category, {
            louvoresData: $louvores,
            useCache: !force,
            forceRecalculate: force
          });
          const calcTime = performance.now() - startTime;
          recordCalculationTime(calcTime);
          
          newStats[category] = stats;
          statsCache.set(category, stats);
          cacheStats(category, stats, { louvoresCount: $louvores.length });
          
          return { category, stats };
        });
        
        await Promise.all(calculationPromises);
      }
      
      categoryStats = newStats;
    } catch (error) {
      console.error('[Offline Page] Failed to load stats for categories:', error);
    } finally {
      isLoadingStats = false;
    }
  }

  // Load category availability statistics (all categories)
  async function loadCategoryStats(force = false) {
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
        
        // Reload stats after download (force to bypass rate limiting)
        // This ensures UI updates with fresh stats after validation
        await loadCategoryStats(true);
        
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
  $: if (!isInitializing && hasInitializedCategories) {
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
  let isProcessingCacheChange = false;
  
  // React to cached PDFs changes - invalidate and reload stats when cache changes
  $: if (!isInitializing && !isProcessingCacheChange && state.cachedPdfs) {
    const currentCount = state.cachedPdfs.length;
    // Only react if count actually changed (not just on initial load)
    if (lastCachedPdfsCount > 0 && currentCount !== lastCachedPdfsCount) {
      console.log('[Offline Page] Cached PDFs count changed:', lastCachedPdfsCount, '->', currentCount);
      isProcessingCacheChange = true;
      scheduleCacheReconciliation({
        source: 'state-cached-pdfs-change',
        batch: true,
        previousCount: lastCachedPdfsCount,
        currentCount
      });
      setTimeout(() => {
        isProcessingCacheChange = false;
      }, 300);
    }
    lastCachedPdfsCount = currentCount;
  }
  // Only categories with real missing PDFs should be considered for download.
  $: categoriesToDownload = selectedCategories.filter(cat => {
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
  $: downloadPhase = state.downloadPhase || (downloading ? 'downloading' : 'idle');
  $: phaseProgress = state.phaseProgress ?? progress;
  $: currentPackage = state.currentPackage || 0;
  $: totalPackages = state.totalPackages || 0;
  $: hasDownloadStatus = downloading || progress > 0 || completed > 0 || failed > 0 || total > 0;
  $: hasDownloadError = !!state.error || (!downloading && failed > 0);
  $: hasQuotaError = state.errorCode === 'QUOTA_EXCEEDED';
  $: unknownCategories = state.validationUnknownCategories || [];
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
   * @param {number} bytes
   */
  function formatStorage(bytes) {
    if (!bytes || bytes <= 0) return '0 MB';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
  }

  async function refreshStorageInfo() {
    const hasEstimateApi =
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.estimate === 'function';
    const hasPersistedApi =
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.persisted === 'function';

    if (!hasEstimateApi) {
      storageInfo = {
        supported: false,
        persisted: false,
        usage: 0,
        quota: 0,
        free: 0,
        loading: false
      };
      return;
    }

    storageInfo = { ...storageInfo, loading: true };
    try {
      const estimate = await navigator.storage.estimate();
      const usage = Number(estimate?.usage || 0);
      const quota = Number(estimate?.quota || 0);
      const persisted = hasPersistedApi ? await navigator.storage.persisted() : false;
      storageInfo = {
        supported: true,
        persisted,
        usage,
        quota,
        free: Math.max(0, quota - usage),
        loading: false
      };
    } catch (error) {
      console.warn('[Offline Page] Could not read storage estimate:', error);
      storageInfo = {
        supported: false,
        persisted: false,
        usage: 0,
        quota: 0,
        free: 0,
        loading: false
      };
    }
  }

  /**
   * @param {unknown} error
   */
  function getErrorInfo(error) {
    const err = /** @type {{message?: string, errorCode?: string, code?: string}|null|undefined} */ (error);
    return {
      message: err?.message || null,
      code: err?.errorCode || err?.code || null
    };
  }
  
  /**
   * Get total size of selected categories that still need download.
   */
  $: totalSelectedSize = selectedCategories
    .filter((/** @type {string} */ cat) => {
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
    
    // Can't toggle categories that are already 100% complete
    if (isActuallyComplete) return;

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
    if (!canDownload) return;

    console.log('[Offline Page] Starting download for categories:', selectedCategories);
    
    // Filter out categories that are already effectively complete.
    const categoriesToDownload = selectedCategories.filter(cat => {
      const stats = categoryStats[cat] || { total: 0, available: 0, missing: 0, percentage: 0 };
      const isActuallyComplete = stats.percentage === 100 && stats.missing === 0;
      return !isActuallyComplete;
    });
    
    if (categoriesToDownload.length === 0) {
      console.log('[Offline Page] All selected categories are already downloaded');
      return;
    }
    
    try {
      await offlineManager.enableIndexedDbRollout({
        persist: true,
        runMigration: true
      });
      syncIdbAdvancedIndicator();
      await refreshStorageInfo();
      // FASE 5: Use OfflineManager directly
      await offlineManager.downloadCategories(categoriesToDownload, {
        louvoresData: $louvores
      });
      
      // After download completes, categories will be updated via reactive statement
    } catch (error) {
      console.error('[Offline Page] Error downloading selected categories:', error);
      const errorInfo = getErrorInfo(error);
      offline.updateState({
        downloading: false,
        error: errorInfo.message || 'Falha ao disponibilizar conteúdo offline. Tente novamente mais tarde.',
        errorCode: errorInfo.code
      });
      errorTitle = 'Falha no download offline';
      errorMessage = errorInfo.message || 'Não foi possível concluir o download. Verifique sua conexão e tente novamente.';
      showErrorModal = true;
    }
  }

  /**
   * Cancel download
   * FASE 5: Now uses OfflineManager directly
   */
  async function cancelDownload() {
    console.log('[Offline Page] Cancelling download');
    await offlineManager.cancelDownload();
  }

  /**
   * Download all categories automatically
   */
  async function downloadAllCategories() {
    if (downloading || !louvoresReady) return;

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
      await offlineManager.enableIndexedDbRollout({
        persist: true,
        runMigration: true
      });
      syncIdbAdvancedIndicator();
      await refreshStorageInfo();
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
      await refreshStorageInfo();
    } catch (error) {
      console.error('[Offline Page] Error downloading all categories:', error);
      const errorInfo = getErrorInfo(error);
      offline.updateState({
        downloading: false,
        error: errorInfo.message || 'Falha ao disponibilizar conteúdo offline. Tente novamente mais tarde.',
        errorCode: errorInfo.code
      });
      errorTitle = 'Falha no download offline';
      errorMessage = errorInfo.message || 'Não foi possível concluir o download. Verifique sua conexão e tente novamente.';
      showErrorModal = true;
    }
  }

  /**
   * Handle download of missing PDFs
   */
  async function handleDownloadMissingPdfs() {
    if (isDownloadingMissing || downloading || !louvoresReady) return;

    isDownloadingMissing = true;
    showErrorModal = false;
    errorMessage = '';
    errorTitle = 'Erro';

    try {
      console.log('[Offline Page] Starting download of missing PDFs');
      await offlineManager.enableIndexedDbRollout({
        persist: true,
        runMigration: true
      });
      syncIdbAdvancedIndicator();
      await refreshStorageInfo();

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

      // Reload stats after download
      await loadCategoryStats(true);
      await refreshStorageInfo();

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
      const errorInfo = getErrorInfo(error);
      
      // Update state with error
      offline.updateState({
        downloading: false,
        error: errorInfo.message || 'Erro ao baixar PDFs faltantes.',
        errorCode: errorInfo.code
      });

      // Show error modal
      errorTitle = 'Erro ao baixar PDFs';
      errorMessage = errorInfo.message || 'Ocorreu um erro ao tentar baixar os PDFs faltantes. Tente novamente.';
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
      await refreshStorageInfo();
      
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
      <!-- Skeleton Screen - Mostrar durante inicialização -->
      {#if isInitializing}
        <div class="skeleton-container">
          <!-- Skeleton para availability summary -->
          <div class="skeleton availability-summary">
            <div class="skeleton-header">
              <div class="skeleton-icon"></div>
              <div class="skeleton-title"></div>
            </div>
            <div class="skeleton-stats">
              <div class="skeleton-stat"></div>
              <div class="skeleton-stat"></div>
              <div class="skeleton-stat"></div>
              <div class="skeleton-stat"></div>
            </div>
            <div class="skeleton-progress-bar"></div>
          </div>
          
          <!-- Skeleton para info box -->
          <div class="skeleton info-box">
            <div class="skeleton-icon"></div>
            <div class="skeleton-content">
              <div class="skeleton-line"></div>
              <div class="skeleton-line"></div>
              <div class="skeleton-line short"></div>
            </div>
          </div>
          
          <!-- Skeleton para category list -->
          <div class="skeleton category-section">
            <div class="skeleton-title"></div>
            <div class="skeleton-category-list">
              {#each Array(5) as _}
                <div class="skeleton category-item">
                  <div class="skeleton-checkbox"></div>
                  <div class="skeleton-category-info">
                    <div class="skeleton-category-header">
                      <div class="skeleton-category-label"></div>
                      <div class="skeleton-badge"></div>
                    </div>
                    <div class="skeleton-category-stats"></div>
                    <div class="skeleton-progress-bar"></div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    
    {#if !isInitializing}

      {#if idbAdvancedStorageActive}
        <div class="idb-advanced-indicator" role="status" aria-live="polite">
          <Database class="idb-advanced-icon" />
          <span class="idb-advanced-text">Modo de armazenamento avançado ativo</span>
        </div>
      {/if}

      <!-- Migration banner: shown when legacy Cache API data has not yet been migrated -->
      {#if migrationNeeded && !isMigrating && !migrationResult}
        <div class="migration-banner info-box" role="alert">
          <Database class="w-5 h-5 info-icon" />
          <div class="info-text">
            <p class="info-title">Migração de armazenamento disponível</p>
            <p class="info-description">
              Seus PDFs estão salvos no formato antigo. Migrar para o novo formato
              garante melhor desempenho, stats precisas e evita falsos positivos.
              Você pode interromper e retomar a qualquer momento.
            </p>
            <div class="action-buttons" style="margin-top: 0.75rem; justify-content: flex-start;">
              <button class="btn btn-primary" on:click={runMigration} disabled={isMigrating}>
                <Database class="w-4 h-4" />
                <span>Migrar agora</span>
              </button>
            </div>
          </div>
        </div>
      {/if}

      <!-- Migration progress -->
      {#if isMigrating}
        <div class="migration-progress">
          <div class="migration-progress-header">
            {#if migrationProgress}
              <span>Migrando: {migrationProgress.processed} / {migrationProgress.total || '?'}</span>
              <span class="migration-stats">
                {migrationProgress.migrated} migrados · {migrationProgress.skipped} ignorados · {migrationProgress.errors} erros
              </span>
            {:else}
              <span>Preparando migração...</span>
            {/if}
          </div>
          <div class="migration-progress-bar">
            <div 
              class="migration-progress-fill" 
              style="width: {migrationProgress ? migrationProgress.percentage : 0}%"
            ></div>
          </div>
          <div class="action-buttons" style="margin-top: 0.75rem; justify-content: flex-start;">
            <button class="btn btn-danger" on:click={cancelMigration}>
              Interromper migração
            </button>
          </div>
        </div>
      {/if}

      <!-- Migration result -->
      {#if migrationResult && !isMigrating}
        <div class="migration-result" class:success={migrationResult.errors === 0 && !migrationResult.cancelled} class:error={migrationResult.errors > 0}>
          <div class="migration-result-content">
            {#if migrationResult.cancelled}
              <AlertCircle class="w-5 h-5" />
              <div class="migration-result-text">
                <strong>Migração interrompida</strong>
                <span>{migrationResult.migrated} migrados até agora — pode retomar a qualquer momento.</span>
              </div>
            {:else if migrationResult.errors === 0}
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

      <!-- Overall availability summary -->
      {#if totalStats.total > 0}
        <div class="availability-summary">
          <div class="summary-header">
            <TrendingUp class="w-5 h-5 summary-icon" />
            <h3 class="summary-title">Disponibilidade Geral</h3>
            <!-- FASE 2: Botão manual de atualização de stats -->
            <button
              class="refresh-stats-btn"
              on:click={() => loadCategoryStats(true)}
              disabled={isLoadingStats}
              title="Atualizar estatísticas"
            >
              <RefreshCw class="w-4 h-4 {isLoadingStats ? 'spinning' : ''}" />
            </button>
            <!-- FASE 3: Botão de métricas (apenas em desenvolvimento) -->
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
        </div>
      {/if}

      <div class="storage-transparency-box">
        <div class="storage-header">
          <Info class="w-5 h-5 info-icon" />
          <h3>Armazenamento do navegador</h3>
          <button class="refresh-storage-btn" on:click={refreshStorageInfo} disabled={storageInfo.loading}>
            {#if storageInfo.loading}
              <RefreshCw class="w-4 h-4 spinning" />
            {:else}
              <RefreshCw class="w-4 h-4" />
            {/if}
          </button>
        </div>
        {#if storageInfo.supported}
          <p class="storage-line">
            Usado: <strong>{formatStorage(storageInfo.usage)}</strong> |
            Quota: <strong>{formatStorage(storageInfo.quota)}</strong> |
            Livre: <strong>{formatStorage(storageInfo.free)}</strong>
          </p>
          {#if requiredPackagesInfo && requiredPackagesInfo.totalSize > 0}
            <p class="storage-line">
              Próximo download estimado: <strong>{formatStorage(requiredPackagesInfo.totalSize)}</strong>
            </p>
          {/if}
          <p class="storage-note">
            Persistência: {storageInfo.persisted ? 'ativa' : 'não garantida'}.
            O navegador pode limitar ou limpar cache conforme política interna.
          </p>
        {:else}
          <p class="storage-note">
            Este navegador não expõe estimativa de quota via API.
          </p>
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

      <!-- Loading indicator for stats -->
      {#if isLoadingStats}
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
            {@const isUnknown = unknownCategories.includes(category)}
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
                disabled={downloading || isActuallyComplete}
              />
              <div class="category-info">
                <div class="category-header">
                  <span class="category-label">{category}</span>
                  {#if shouldShowCompleteBadge}
                    <span class="downloaded-badge">✓ Completo</span>
                  {:else if isUnknown}
                    <span class="partial-badge unknown-badge">Validação pendente</span>
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

      <!-- Download status in-page (single source of progress feedback) -->
      {#if hasDownloadStatus}
        <div class="progress-section">
          <div class="progress-info">
            <p class="progress-title">
              {#if downloading}
                {#if downloadPhase === 'storing'}
                  Salvando no cache...
                {:else if downloadPhase === 'complete'}
                  Finalizando download...
                {:else}
                  Baixando pacotes...
                {/if}
              {:else if hasDownloadError}
                Download com falhas
              {:else if progress >= 100}
                Download concluído
              {:else}
                Status do download
              {/if}
            </p>
            <p class="progress-stats">
              {completed} de {total} PDFs processados
              {#if failed > 0}
                <span class="failed-count">({failed} falharam)</span>
              {/if}
            </p>
            {#if totalPackages > 0}
              <p class="progress-note">
                Pacote {currentPackage} de {totalPackages} | Fase: {downloadPhase} ({Math.round(phaseProgress)}%)
              </p>
            {/if}
          </div>

          <div class="progress-bar-container">
            <div class="progress-bar" style="width: {Math.max(0, Math.min(100, progress))}%"></div>
          </div>

          <p class="progress-percentage">{Math.round(progress)}%</p>

          {#if downloading}
            <div class="action-buttons">
              <button
                class="btn btn-danger"
                on:click={cancelDownload}
              >
                Cancelar download
              </button>
            </div>
          {/if}
        </div>
      {/if}

      {#if hasDownloadError}
        <div class="error-box download-error-box">
          <AlertCircle class="w-5 h-5 error-icon" />
          <div class="download-error-content">
            <p class="error-text">
              {#if hasQuotaError}
                Sem espaço suficiente no navegador para concluir o download offline.
              {:else}
                {state.error || 'O processo de download falhou parcialmente. Tente novamente em alguns instantes.'}
              {/if}
            </p>
            <div class="action-buttons">
              <button
                class="btn btn-primary"
                on:click={offlineAvailable ? handleDownloadMissingPdfs : downloadAllCategories}
                disabled={downloading || !louvoresReady}
              >
                Tentar novamente
              </button>
              {#if hasQuotaError}
                <button
                  class="btn btn-danger"
                  on:click={clearAllCache}
                  disabled={downloading || isClearingCache}
                >
                  Limpar cache offline
                </button>
              {/if}
            </div>
          </div>
        </div>
      {/if}

    {/if}

    {#if state.error && !hasDownloadError}
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

  .idb-advanced-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding: 0.55rem 0.85rem;
    border-radius: 0.375rem;
    border: 1px solid rgba(167, 181, 255, 0.55);
    background: rgba(90, 103, 216, 0.22);
    font-size: 0.8125rem;
    line-height: 1.35;
    color: var(--text-light);
  }

  .idb-advanced-indicator :global(.idb-advanced-icon) {
    flex-shrink: 0;
    width: 1rem;
    height: 1rem;
    color: #c4cbff;
  }

  .idb-advanced-text {
    margin: 0;
  }

  .offline-indicator-container {
    display: flex;
    justify-content: center;
    margin-bottom: 1.5rem;
  }

  .storage-transparency-box {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1rem;
    border: 1px solid rgba(212, 175, 55, 0.45);
    border-radius: 0.5rem;
    background: rgba(0, 0, 0, 0.18);
    margin-bottom: 1rem;
  }

  .storage-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .storage-transparency-box :global(.info-icon) {
    color: var(--gold-color);
    flex-shrink: 0;
  }

  .storage-header h3 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text-light);
  }

  .refresh-storage-btn {
    margin-left: auto;
    border: none;
    background: transparent;
    color: var(--text-light);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .refresh-storage-btn:hover:not(:disabled) {
    color: var(--gold-light);
  }

  .refresh-storage-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .storage-line {
    margin: 0;
    font-size: 0.84rem;
    color: rgba(255, 255, 255, 0.92);
  }

  .storage-line strong {
    color: var(--text-light);
    font-weight: 700;
  }

  .storage-note {
    margin: 0;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.78);
    line-height: 1.45;
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

  .unknown-badge {
    color: #0c5460;
    background-color: rgba(23, 162, 184, 0.15);
    border-color: rgba(23, 162, 184, 0.35);
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
    background-color: var(--background-color);
    border: 2px solid var(--gold-color);
    border-radius: 0.75rem;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
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

  .download-error-box {
    align-items: flex-start;
  }

  .download-error-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  /* Action buttons */
  .action-buttons {
    display: flex;
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

