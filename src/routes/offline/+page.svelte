<script>
  import { onMount } from 'svelte';
  import { Download, AlertCircle, CheckCircle, Info } from 'lucide-svelte';
  import { offline, isDownloading } from '$lib/stores/offline';
  import { CATEGORY_OPTIONS } from '$lib/stores/filters';
  import { louvores, loadLouvores, louvoresLoaded } from '$lib/stores/louvores';
  import OfflineRequirementsAlert from '$lib/components/OfflineRequirementsAlert.svelte';
  import OfflineIndicator from '$lib/components/OfflineIndicator.svelte';

  // Selected categories for download
  /**
     * @type {string[]}
     */
  let selectedCategories = [];

  // Load saved categories on mount
  onMount(async () => {
    await loadLouvores();

    const saved = offline.getSavedCategories();
    if (saved && saved.length > 0) {
      selectedCategories = saved;
    }
  });

  // Track which categories are already downloaded (cannot be removed)
  $: downloadedCategories = offline.getSavedCategories() || [];

  // Get current offline state
  $: state = $offline;
  $: downloading = $isDownloading;
  $: louvoresReady = $louvores.length > 0;
  $: canDownload = selectedCategories.length > 0 && !downloading && louvoresReady;
  $: progress = state.progress || 0;
  $: completed = state.completed || 0;
  $: failed = state.failed || 0;
  $: total = state.total || 0;
  $: categorySizes = state.categorySizes || {};
  
  /**
   * Format bytes to human readable size
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
   * Get total size of selected categories
   */
  $: totalSelectedSize = selectedCategories.reduce((sum, cat) => {
    return sum + (categorySizes[cat] || 0);
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
    await offline.downloadByCategories(selectedCategories);
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

      <!-- Offline indicator showing preparation status -->
      <div class="offline-indicator-container">
        <OfflineIndicator />
      </div>

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
            {@const categorySize = categorySizes[category] || 0}
            {@const isDownloaded = downloadedCategories.includes(category)}
            <label class="category-item" class:downloaded={isDownloaded}>
              <input
                type="checkbox"
                checked={isSelected}
                on:change={() => toggleCategory(category)}
                disabled={downloading || isDownloaded}
              />
              <div class="category-info">
                <span class="category-label">{category}</span>
                {#if categorySize > 0}
                  <span class="category-size">{formatSize(categorySize)}</span>
                {/if}
                {#if isDownloaded}
                  <span class="downloaded-badge">Já baixada</span>
                {/if}
              </div>
            </label>
          {/each}
        </div>
        
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

        <p class="progress-note">
          Você pode fechar esta página e continuar usando o aplicativo.
          O download continuará em segundo plano.
        </p>
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
      <div class="error-box">
        <AlertCircle class="w-5 h-5 error-icon" />
        <p class="error-text">{state.error}</p>
      </div>
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
    color: #6c757d;
    font-weight: 500;
  }
  
  .total-size-info {
    margin-top: 1rem;
    padding: 0.75rem;
    background-color: var(--placeholder-color);
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
    color: var(--light-gold);
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
    margin-top: 0.25rem;
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

