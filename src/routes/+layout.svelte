<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import OfflineGestureDetector from '$lib/components/OfflineGestureDetector.svelte';
  import OfflineIndicator from '$lib/components/OfflineIndicator.svelte';
  import OfflineModal from '$lib/components/OfflineModal.svelte';
  import { offline } from '$lib/stores/offline';
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
  
  // Handle gesture detection
  function handleGestureDetected() {
    console.log('[Layout] Gesture detected, showing offline modal');
    offline.showOfflineModal();
  }
</script>

<!-- Toolbar fixa no topo (oculta no /leitor) -->
{#if !$page.url.pathname.startsWith('/leitor')}
  <div class="fixed top-0 left-0 right-0 bg-background-color border-b-4 border-gold-color shadow-md z-40 plpc-header">
    <div class="header-content">
      <div class="header-title-section">
        <OfflineGestureDetector on:gesture-detected={handleGestureDetected}>
          <h1 class="text-center pt-4 pb-0 text-3xl font-garamond font-bold text-placeholder-color tracking-wide" style="text-shadow: 1px 1px 2px rgba(0,0,0,0.3);">
            PLPC
          </h1>
        </OfflineGestureDetector>
        <p class="text-center text-xs text-placeholder-color opacity-60 pb-3 pt-0.5 subtitle-inset">
          Pesquisador de Louvores em Partitura e Cifra (e Gestinhos)
        </p>
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

<!-- Offline Modal -->
<OfflineModal />

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
  
  .header-title-section :global(h1),
  .header-title-section :global(p) {
    width: 100%;
    text-align: center;
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

