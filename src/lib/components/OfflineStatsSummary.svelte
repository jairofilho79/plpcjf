<script>
  // Cartão "Disponibilidade Geral" da página /offline. Responsabilidade
  // única: mostrar o snapshot agregado de estatísticas que a página já
  // calculou (e o aviso de "dados em cache" quando aplicável) e emitir
  // "refresh" quando o usuário pede para recalcular — não calcula nada.
  // Extraído de src/routes/offline/+page.svelte (#23).
  import { createEventDispatcher } from 'svelte';
  import { TrendingUp, RefreshCw } from 'lucide-svelte';
  import { getCacheMetrics } from '$lib/utils/statsCache';

  const dispatch = createEventDispatcher();

  export let statsStale = true;
  /** @type {{ total: number, available: number, missing: number }} */
  export let totalStats = { total: 0, available: 0, missing: 0 };
  export let overallPercentage = 0;
  export let isLoadingStats = false;
  /** @type {{ enabled: boolean, lastMetrics: any }} */
  export let performanceMetrics = { enabled: false, lastMetrics: null };

  function refresh() {
    dispatch('refresh');
  }

  function showMetrics() {
    const metrics = getCacheMetrics();
    console.table(metrics);
    alert(`Cache Hit Rate: ${(metrics.cacheHitRate * 100).toFixed(1)}%\nAvg Calculation: ${metrics.avgCalculationTime}ms\nAvg Load: ${metrics.avgLoadTime}ms\nCache Size: ${(metrics.cacheSize / 1024).toFixed(2)} KB\nCategories Cached: ${metrics.categoriesCached}`);
  }
</script>

<!-- Stats: capa com cache ao abrir; cálculo só ao clicar atualizar -->
<div class="availability-summary" class:has-stale-overlay={statsStale}>
  <div class="summary-header">
    <TrendingUp class="w-5 h-5 summary-icon" />
    <h3 class="summary-title">Disponibilidade Geral</h3>
    {#if !statsStale}
      <button
        class="refresh-stats-btn"
        on:click={refresh}
        disabled={isLoadingStats}
        title="Atualizar estatísticas"
      >
        <RefreshCw class="w-4 h-4 {isLoadingStats ? 'spinning' : ''}" />
      </button>
    {/if}
    {#if performanceMetrics.enabled && performanceMetrics.lastMetrics}
      <button
        class="metrics-btn"
        on:click={showMetrics}
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
        on:click={refresh}
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

<style>
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

  @media (max-width: 640px) {
    .btn {
      width: 100%;
      justify-content: center;
    }
  }
</style>
