<script>
  import { onMount } from 'svelte';
  import { Download, AlertCircle, CheckCircle, Info, Package, TrendingUp, RefreshCw } from 'lucide-svelte';
  import { offline, isDownloading } from '$lib/stores/offline';
  import { CATEGORY_OPTIONS } from '$lib/stores/filters';
  import { louvores, loadLouvores, louvoresLoaded } from '$lib/stores/louvores';
  import OfflineRequirementsAlert from '$lib/components/OfflineRequirementsAlert.svelte';
  import OfflineIndicator from '$lib/components/OfflineIndicator.svelte';
  import { setupCacheSync, onCacheSync, checkCacheVersionChanged, updateCacheVersion } from '$lib/utils/cacheSync';
  import { clearPdfIndex } from '$lib/utils/pdfIndex';

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
  let needsSync = false;
  let isSyncing = false;
  let lastSyncTime = null;
  /** @type {(() => void) | null} */
  let syncUnsubscribe = null;

  // Load saved categories and check downloaded categories on mount
  onMount(async () => {
    await loadLouvores();

    // Check and update downloaded categories based on cache
    downloadedCategories = await offline.checkAndUpdateDownloadedCategories();
    
    // Load saved categories for selection
    const saved = offline.getSavedCategories();
    if (saved && saved.length > 0) {
      selectedCategories = saved;
    }
    
    // Ensure downloaded categories are ALWAYS selected and cannot be deselected
    // Merge downloaded categories with saved categories, ensuring downloaded ones are included
    const allCategories = [...new Set([...selectedCategories, ...downloadedCategories])];
    selectedCategories = allCategories;
    
    // Load initial stats
    await loadCategoryStats();
    
    // Validate and clear error if no longer relevant
    await offline.validateAndClearError();
    
    // Setup cache sync listener
    setupCacheSync();
    const unsubscribe = onCacheSync(() => {
      needsSync = true;
      console.log('[Offline Page] Cache sync required from another tab');
    });
    syncUnsubscribe = unsubscribe;
    
    // Listen for cache sync events
    window.addEventListener('cache-sync-required', handleCacheSyncRequired);
    
    // Check for sync needed on window focus
    window.addEventListener('focus', checkSyncOnFocus);
    
    // Check sync status periodically
    const syncCheckInterval = setInterval(async () => {
      const changed = await checkCacheVersionChanged();
      if (changed) {
        needsSync = true;
      }
    }, 30000); // Check every 30 seconds
    
    // Cleanup
    return () => {
      if (syncUnsubscribe) {
        syncUnsubscribe();
      }
      window.removeEventListener('cache-sync-required', handleCacheSyncRequired);
      window.removeEventListener('focus', checkSyncOnFocus);
      clearInterval(syncCheckInterval);
    };
  });
  
  /**
   * @param {Event} event
   */
  function handleCacheSyncRequired(event) {
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
      
      // Reload category stats to reflect any fixes
      await loadCategoryStats();
      
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

  // Load category availability statistics
  async function loadCategoryStats() {
    if (!$louvores.length) return;
    
    isLoadingStats = true;
    try {
      const state = $offline;
      /** @type {string[]} */
      let cachedPdfs = state.cachedPdfs || [];
      
      // Ensure cached PDFs are loaded
      if (!cachedPdfs || cachedPdfs.length === 0) {
        await offline.loadCachedPdfsList();
        const updatedState = $offline;
        cachedPdfs = updatedState.cachedPdfs || [];
      }
      
      // Get stats for each category
      /** @type {Record<string, {total: number, available: number, missing: number, percentage: number}>} */
      const stats = {};
      for (const category of CATEGORY_OPTIONS) {
        stats[category] = await offline.getCategoryAvailabilityStats(
          category,
          $louvores,
          cachedPdfs
        );
      }
      categoryStats = stats;
      
      // Get required packages info for selected categories
      if (selectedCategories.length > 0) {
        let manifest = state.offlineManifest;
        if (!manifest) {
          manifest = await offline.fetchOfflineManifest();
        }
        if (manifest) {
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
      console.error('[Offline Page] Failed to load stats:', error);
    } finally {
      isLoadingStats = false;
    }
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
        const cats = await offline.checkAndUpdateDownloadedCategories();
        downloadedCategories = cats;
        // Ensure downloaded categories are selected
        cats.forEach((/** @type {string} */ cat) => {
          if (!selectedCategories.includes(cat)) {
            selectedCategories = [...selectedCategories, cat];
          }
        });
        // Reload stats after download
        await loadCategoryStats();
      }
    }, 1000);
  }

  // React to category selection changes (debounced to avoid excessive calls)
  /** @type {ReturnType<typeof setTimeout> | null} */
  let categorySelectionTimeout = null;
  $: if (selectedCategories.length > 0 && $louvores.length > 0 && !isLoadingStats) {
    if (categorySelectionTimeout) {
      clearTimeout(categorySelectionTimeout);
    }
    categorySelectionTimeout = setTimeout(() => {
      loadCategoryStats();
    }, 300);
  }

  // Get current offline state
  $: state = $offline;
  $: downloading = $isDownloading;
  $: louvoresReady = $louvores.length > 0;
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
   * Get total size of selected categories (excluding already downloaded)
   */
  $: totalSelectedSize = selectedCategories
    .filter((/** @type {string} */ cat) => !downloadedCategories.includes(cat))
    .reduce((/** @type {number} */ sum, /** @type {string} */ cat) => {
      return sum + ((/** @type {Record<string, number>} */ (categorySizes))[cat] || 0);
    }, 0);

  /**
     * Toggle category selection
     * @param {string} category
     */
  function toggleCategory(category) {
    if (downloading) return; // Can't change selection while downloading
    // Can't remove already downloaded categories
    if (downloadedCategories.includes(category)) return;

    if (selectedCategories.includes(category)) {
      selectedCategories = selectedCategories.filter(c => c !== category);
    } else {
      selectedCategories = [...selectedCategories, category];
    }
  }

  /**
   * Start download
   */
  async function startDownload() {
    if (!canDownload) return;

    console.log('[Offline Page] Starting download for categories:', selectedCategories);
    
    // Filter out already downloaded categories - they should not be downloaded again
    const categoriesToDownload = selectedCategories.filter(cat => !downloadedCategories.includes(cat));
    
    if (categoriesToDownload.length === 0) {
      console.log('[Offline Page] All selected categories are already downloaded');
      return;
    }
    
    await offline.downloadByCategories(categoriesToDownload);
    
    // After download completes, categories will be updated via reactive statement
  }

  /**
   * Cancel download
   */
  async function cancelDownload() {
    console.log('[Offline Page] Cancelling download');
    await offline.cancelDownload();
  }
</script>

<svelte:head>
  <title>Modo Offline - PLPC</title>
</svelte:head>

<div class="max-w-4xl mx-auto">
  <!-- Body -->
  <div class="page-body">
    {#if !downloading && progress < 100}

      <!-- Sync banner -->
      {#if needsSync}
        <div class="sync-banner">
          <div class="sync-banner-content">
            <AlertCircle class="w-4 h-4 sync-icon" />
            <span class="sync-text">Os dados podem estar desatualizados</span>
            <button 
              class="sync-button" 
              on:click={forceSync} 
              disabled={isSyncing}
            >
              {#if isSyncing}
                <RefreshCw class="w-4 h-4 spinning" />
                <span>Sincronizando...</span>
              {:else}
                <RefreshCw class="w-4 h-4" />
                <span>Sincronizar Agora</span>
              {/if}
            </button>
          </div>
        </div>
      {/if}

      <!-- Overall availability summary -->
      {#if totalStats.total > 0}
        <div class="availability-summary">
          <div class="summary-header">
            <TrendingUp class="w-5 h-5 summary-icon" />
            <h3 class="summary-title">Disponibilidade Geral</h3>
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
      <OfflineRequirementsAlert />

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

      <!-- Category selection -->
      <div class="category-section">
        <h2 class="section-title">Selecione as categorias para baixar:</h2>
        <div class="category-list">
          {#each CATEGORY_OPTIONS as category}
            {@const isSelected = selectedCategories.includes(category)}
            {@const categorySize = ((/** @type {Record<string, number>} */ (categorySizes))[category] || 0)}
            {@const stats = categoryStats[category] || { total: 0, available: 0, missing: 0, percentage: 0 }}
            {@const isActuallyComplete = stats.percentage === 100 && stats.missing === 0}
            {@const isDownloaded = downloadedCategories.includes(category)}
            {@const shouldShowCompleteBadge = isActuallyComplete && (isDownloaded || stats.available === stats.total)}
            
            <label class="category-item" class:downloaded={isDownloaded} class:complete={isActuallyComplete}>
              <input
                type="checkbox"
                checked={isSelected}
                on:change={() => toggleCategory(category)}
                disabled={downloading || isDownloaded}
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

      <!-- Action buttons -->
      <div class="action-buttons">
        <button
          class="btn btn-primary"
          on:click={startDownload}
          disabled={!canDownload}
          title={!louvoresReady ? 'Aguardando carregamento dos louvores...' : categoriesToDownload.length === 0 ? 'Selecione categorias que precisam ser baixadas' : ''}
        >
          <Download class="w-5 h-5" />
          <span>Baixar PDFs</span>
        </button>
      </div>
    {:else if downloading}
      <!-- Download progress -->
      <div class="progress-section">
        <div class="progress-info">
          <p class="progress-title">Baixando PDFs...</p>
          <p class="progress-stats">
            {completed} de {total} PDFs baixados
            {#if failed > 0}
              <span class="failed-count">({failed} falharam)</span>
            {/if}
          </p>
        </div>

        <!-- Progress bar -->
        <div class="progress-bar-container">
          <div class="progress-bar" style="width: {progress}%"></div>
        </div>

        <p class="progress-percentage">{progress}%</p>

        <!-- Cancel button -->
        <div class="action-buttons">
          <button
            class="btn btn-danger"
            on:click={cancelDownload}
          >
            Cancelar Download
          </button>
        </div>
      </div>
    {:else if progress >= 100}
      <!-- Download complete -->
      <div class="complete-section">
        <CheckCircle class="w-16 h-16 complete-icon" />
        <p class="complete-title">Download concluído!</p>
        <p class="complete-stats">
          {completed} PDFs baixados com sucesso
          {#if failed > 0}
            <br />
            <span class="failed-count">{failed} PDFs falharam</span>
          {/if}
        </p>

        <div class="action-buttons">
          <!-- Download completed, user can navigate away using header -->
        </div>
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

