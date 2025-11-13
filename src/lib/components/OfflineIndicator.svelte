<script>
  import { CloudOff, Cloud, Download, CheckCircle } from 'lucide-svelte';
  import { offline, isOfflineEnabled, isDownloading } from '$lib/stores/offline';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  
  $: state = $offline;
  $: enabled = $isOfflineEnabled;
  $: downloading = $isDownloading;
  $: cachedCount = state.cachedCount || 0;
  $: progress = state.progress || 0;
  $: isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  
  // Check if offline requirements are met
  $: savedCategories = offline.getSavedCategories();
  $: hasCategoryDownloaded = savedCategories && savedCategories.length > 0;
  $: isLeitorOffline = browser ? localStorage.getItem('IS_LEITOR_OFFLINE') === 'true' : false;
  $: isOfflineReady = hasCategoryDownloaded && isLeitorOffline;
  
  let showTooltip = false;
  /**
   * @type {ReturnType<typeof setTimeout> | undefined}
   */
  let tooltipTimeout = undefined;
  
  /**
   * Show tooltip
   */
  function handleMouseEnter() {
    if (tooltipTimeout !== undefined) {
      clearTimeout(tooltipTimeout);
    }
    showTooltip = true;
  }
  
  /**
   * Hide tooltip with delay
   */
  function handleMouseLeave() {
    tooltipTimeout = setTimeout(() => {
      showTooltip = false;
    }, 200);
  }
  
  /**
   * Click handler - navigate to offline page
   */
  function handleClick() {
    goto('/offline');
  }
</script>

{#if enabled || downloading || isOfflineReady}
  <div 
    class="offline-indicator"
    class:downloading={downloading}
    class:ready={isOfflineReady && !downloading}
    on:mouseenter={handleMouseEnter}
    on:mouseleave={handleMouseLeave}
    on:click={handleClick}
    role="button"
    tabindex="0"
    on:keydown={(e) => e.key === 'Enter' && handleClick()}
  >
    {#if downloading}
      <div class="icon-wrapper downloading-animation">
        <Download class="w-5 h-5" />
      </div>
    {:else if isOfflineReady}
      <div class="icon-wrapper ready-icon">
        <CheckCircle class="w-5 h-5" />
      </div>
    {:else if enabled}
      <div class="icon-wrapper" class:offline={!isOnline}>
        {#if isOnline}
          <Cloud class="w-5 h-5" />
        {:else}
          <CloudOff class="w-5 h-5" />
        {/if}
      </div>
    {/if}
    
    <!-- Progress ring for download -->
    {#if downloading && progress > 0}
      <svg class="progress-ring" width="32" height="32" viewBox="0 0 32 32">
        <circle
          class="progress-ring-circle"
          stroke="currentColor"
          stroke-width="2"
          fill="transparent"
          r="14"
          cx="16"
          cy="16"
          style="stroke-dasharray: {88}; stroke-dashoffset: {88 - (88 * progress) / 100};"
        />
      </svg>
    {/if}
    
    <!-- Tooltip -->
    {#if showTooltip}
      <div class="tooltip">
        {#if downloading}
          <p class="tooltip-title">Baixando PDFs...</p>
          <p class="tooltip-text">{progress}% concluído</p>
        {:else if isOfflineReady}
          <p class="tooltip-title">App Preparada para Offline</p>
          <p class="tooltip-text">Todos os requisitos foram cumpridos</p>
          <p class="tooltip-text">{cachedCount} PDFs em cache</p>
        {:else if enabled}
          <p class="tooltip-title">Modo Offline Ativo</p>
          <p class="tooltip-text">{cachedCount} PDFs em cache</p>
          {#if !isOnline}
            <p class="tooltip-warning">Você está offline</p>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .offline-indicator {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    cursor: pointer;
    transition: transform 0.2s;
  }
  
  .offline-indicator:hover {
    transform: scale(1.1);
  }
  
  .icon-wrapper {
    position: relative;
    z-index: 2;
    color: var(--gold-color);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }
  
  .icon-wrapper.offline {
    color: #dc3545;
  }

  .icon-wrapper.ready-icon {
    color: #28a745;
  }

  .offline-indicator.ready {
    background-color: rgba(40, 167, 69, 0.1);
    border-radius: 50%;
  }
  
  .downloading-animation {
    animation: pulse 1.5s ease-in-out infinite;
  }
  
  @keyframes pulse {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.7;
      transform: scale(0.95);
    }
  }
  
  /* Progress ring */
  .progress-ring {
    position: absolute;
    top: 0;
    left: 0;
    transform: rotate(-90deg);
    z-index: 1;
  }
  
  .progress-ring-circle {
    color: var(--gold-color);
    transition: stroke-dashoffset 0.3s ease;
  }
  
  /* Tooltip */
  .tooltip {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    background-color: var(--title-color);
    color: var(--text-light);
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    white-space: nowrap;
    z-index: 10000;
    border: 2px solid var(--gold-color);
  }
  
  .tooltip::before {
    content: '';
    position: absolute;
    bottom: 100%;
    right: 0.75rem;
    border: 0.5rem solid transparent;
    border-bottom-color: var(--gold-color);
  }
  
  .tooltip-title {
    font-size: 0.875rem;
    font-weight: 700;
    margin: 0 0 0.25rem 0;
    color: var(--text-light);
  }
  
  .tooltip-text {
    font-size: 0.8125rem;
    margin: 0;
    color: var(--text-light);
    opacity: 0.9;
  }
  
  .tooltip-warning {
    font-size: 0.8125rem;
    margin: 0.25rem 0 0 0;
    color: #ffc107;
    font-weight: 600;
  }
  
  /* Mobile adjustments */
  @media (max-width: 768px) {
    .offline-indicator {
      width: 2rem;
      height: 2rem;
    }
    
    .icon-wrapper :global(svg) {
      width: 1.125rem;
      height: 1.125rem;
    }
    
    .progress-ring {
      width: 28px;
      height: 28px;
    }
    
    .tooltip {
      right: auto;
      left: 50%;
      transform: translateX(-50%);
    }
    
    .tooltip::before {
      left: 50%;
      right: auto;
      transform: translateX(-50%);
    }
  }
</style>

