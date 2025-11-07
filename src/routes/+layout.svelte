<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { CloudOff } from 'lucide-svelte';
  import OfflineIndicator from '$lib/components/OfflineIndicator.svelte';
  import { registerServiceWorker } from '$lib/utils/swRegistration';
  
  // Handle overflow for /leitor route
  $: if (browser && $page.url.pathname.startsWith('/leitor')) {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  } else if (browser) {
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }
  
  // Register service worker on mount
  onMount(() => {
    if (browser) {
      registerServiceWorker();
    }
  });
  
  // Navigate to offline page
  function handleOfflineClick() {
    goto('/offline');
  }
  
  // Placeholder function for listas button
  function handleListasClick() {
    // TODO: Implementar funcionalidade futuramente
  }
  
  // Placeholder function for sobre button
  function handleSobreClick() {
    // TODO: Implementar funcionalidade futuramente
  }
</script>

<!-- Toolbar fixa no topo (oculta no /leitor) -->
{#if !$page.url.pathname.startsWith('/leitor')}
  <div class="fixed top-0 left-0 right-0 bg-background-color border-b-4 border-gold-color shadow-md z-40 plpc-header">
    <div class="header-content">
      <div class="header-title-section">
        <div class="header-main-row">
          <div class="header-left">
            <button 
              class="header-button sobre-button"
              on:click={handleSobreClick}
              aria-label="Sobre"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
                <path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
              </svg>
              <span>Sobre</span>
            </button>
            <button 
              class="header-button biblioteca-button"
              on:click={() => goto('/biblioteca')}
              aria-label="Ir para Biblioteca"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75Z" />
              </svg>
              <span>Biblioteca</span>
            </button>
          </div>
          <div class="header-center">
            <button 
              class="plpc-title-button"
              on:click={() => goto('/')}
              aria-label="Ir para página principal"
            >
              <h1 class="text-center py-4 text-3xl font-garamond font-bold text-placeholder-color tracking-wide" style="text-shadow: 1px 1px 2px rgba(0,0,0,0.3);">
                PLPC
              </h1>
            </button>
          </div>
          <div class="header-right">
            <button 
              class="header-button offline-button"
              on:click={handleOfflineClick}
              aria-label="Offline"
            >
              <CloudOff class="icon" />
              <span>Offline</span>
            </button>
            <button 
              class="header-button listas-button"
              on:click={handleListasClick}
              aria-label="Listas"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
              </svg>
              <span>Listas</span>
            </button>
          </div>
        </div>
      </div>
      <div class="offline-indicator-wrapper">
        <OfflineIndicator />
      </div>
    </div>
  </div>
{/if}

<!-- Conteúdo principal com margem para toolbar (sem margem superior no /leitor) -->
<div class="pb-4 px-4 min-h-screen bg-background-color" 
     class:pt-24={!$page.url.pathname.startsWith('/leitor')}
     class:px-0={$page.url.pathname.startsWith('/leitor')}
     class:pb-0={$page.url.pathname.startsWith('/leitor')}>
  <slot />
</div>

<style>
  .header-content {
    position: relative;
    width: 100%;
  }
  
  .header-title-section {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  
  .header-main-row {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    position: relative;
  }
  
  .header-left {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 1rem;
    gap: 0.5rem;
  }
  
  .header-center {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .header-right {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding-left: 1rem;
    gap: 0.5rem;
  }
  
  .plpc-title-button {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    transition: transform 0.2s ease;
  }
  
  .plpc-title-button:hover {
    transform: scale(1.05);
  }
  
  .plpc-title-button:active {
    transform: scale(1.02);
  }
  
  .header-title-section :global(h1) {
    text-align: center;
    margin: 0;
  }
  
  .header-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background-color: transparent;
    border: none;
    border-radius: 0.375rem;
    color: var(--placeholder-color);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    opacity: 0.7;
  }
  
  .header-button:hover {
    opacity: 1;
    box-shadow: 
      0 2px 4px rgba(0, 0, 0, 0.3),
      0 4px 8px rgba(0, 0, 0, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.1);
    transform: translateY(-1px);
  }
  
  .header-button:active {
    transform: translateY(0);
    box-shadow: 
      0 1px 2px rgba(0, 0, 0, 0.2),
      inset 0 1px 2px rgba(0, 0, 0, 0.1);
  }
  
  .header-button .icon {
    width: 1.25rem;
    height: 1.25rem;
  }
  
  
  @media (max-width: 768px) {
    .header-left {
      padding-right: 0.5rem;
    }
    
    .header-right {
      padding-left: 0.5rem;
    }
    
    .header-button {
      padding: 0.375rem 0.75rem;
      font-size: 0.75rem;
    }
    
    .header-button span {
      display: none;
    }
    
    .header-button .icon {
      width: 1.125rem;
      height: 1.125rem;
    }
  }
  
  .offline-indicator-wrapper {
    position: absolute;
    top: 0.5rem;
    right: 1rem;
    z-index: 50;
  }
  
  @media (max-width: 768px) {
    .offline-indicator-wrapper {
      right: 0.5rem;
    }
  }
</style>

