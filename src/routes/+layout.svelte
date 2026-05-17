<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { CloudOff } from 'lucide-svelte';
  import OfflineIndicator from '$lib/components/OfflineIndicator.svelte';
  import AppSnackbarHost from '$lib/components/AppSnackbarHost.svelte';
  import { registerServiceWorker, setupServiceWorkerMessageListener } from '$lib/utils/swRegistration';
  import { setupLouvoresManifestChecksumTriggers } from '$lib/stores/louvores';
  import { setupCacheSync } from '$lib/utils/cacheSync';
  import {
    installStaleChunkRecoveryListeners,
    scheduleStaleRecoveryCounterReset
  } from '$lib/utils/staleChunkRecovery';
  import { 
    getPdfJsPriority, 
    shouldPreload, 
    preloadPdfJs, 
    requestIdleCallback 
  } from '$lib/utils/pdfjsLoader';
  
  // Handle overflow for /leitor route
  $: if (browser && $page.url.pathname.startsWith('/leitor')) {
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.height = '100%';
    document.documentElement.style.overscrollBehavior = 'none';
    document.body.style.overflow = 'hidden';
    document.body.style.height = '100%';
    document.body.style.overscrollBehavior = 'none';
    // iOS: position fixed impede scroll residual da página
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
  } else if (browser) {
    document.documentElement.style.overflow = '';
    document.documentElement.style.height = '';
    document.documentElement.style.overscrollBehavior = '';
    document.body.style.overflow = '';
    document.body.style.height = '';
    document.body.style.overscrollBehavior = '';
    document.body.style.position = '';
    document.body.style.width = '';
  }
  
  // Pré-carregamento inteligente baseado em rota
  function smartPreloadPdfJs() {
    if (!browser) return;
    
    // Verificar se já está carregado
    if (window.__pdfjsPreloaded && !window.__pdfjsPreloaded.partial) return;
    
    const pathname = $page.url.pathname;
    const priority = getPdfJsPriority(pathname);
    
    // Verificar conexão
    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    
    if (!shouldPreload(priority, connection)) {
      return;
    }
    
    // Carregar baseado na prioridade
    if (priority === 'high') {
      // Carregar imediatamente (rota /leitor)
      preloadPdfJs({ priority: 'high', loadViewer: true }).catch(err => {
        console.warn('[Layout] Erro ao pré-carregar PDF.js:', err);
      });
    } else if (priority === 'medium') {
      // Carregar após recursos críticos (requestIdleCallback)
      requestIdleCallback(() => {
        preloadPdfJs({ priority: 'medium', loadViewer: false }).catch(err => {
          console.warn('[Layout] Erro ao pré-carregar PDF.js:', err);
        });
      }, { timeout: 2000 });
    }
    // 'low' e 'none' não carregam automaticamente
  }
  
  // Register service worker and setup sync on mount
  onMount(() => {
    if (browser) {
      const removeStaleChunkListeners = installStaleChunkRecoveryListeners();
      const cancelStaleRecoveryReset = scheduleStaleRecoveryCounterReset();

      // CORREÇÃO PARA STANDALONE: Garantir que o SvelteKit router processe a URL correta
      // Quando o Service Worker serve o shell root ('/'), o SvelteKit pode não ter
      // processado a URL real da barra de endereços ainda. Verificamos e corrigimos.
      const checkAndFixUrl = () => {
        const windowUrl = window.location.pathname + window.location.search;
        const sveltekitUrl = $page.url.pathname + $page.url.search;
        
        // Se a URL na barra não corresponde à rota do SvelteKit, forçar navegação
        // Isso é especialmente importante em standalone quando o SW serve o shell root
        if (windowUrl !== sveltekitUrl && windowUrl !== '/') {
          console.log('[Layout] URL mismatch detected - fixing:', {
            windowLocation: windowUrl,
            sveltekitPage: sveltekitUrl
          });
          // Usar setTimeout para garantir que o SvelteKit já inicializou
          setTimeout(() => {
            goto(windowUrl, { replaceState: true, noScroll: true });
          }, 0);
        }
      };
      
      // Verificar imediatamente e também após um pequeno delay
      // para garantir que o SvelteKit router já inicializou
      checkAndFixUrl();
      setTimeout(checkAndFixUrl, 100);
      
      registerServiceWorker().then(() => {
        // Setup Service Worker message listener
        setupServiceWorkerMessageListener();
        
        // Setup BroadcastChannel for cross-tab sync
        setupCacheSync();
      });
      
      // Pré-carregamento inteligente baseado na rota atual
      smartPreloadPdfJs();

      const removeLouvoresChecksumTriggers = setupLouvoresManifestChecksumTriggers();

      return () => {
        removeLouvoresChecksumTriggers();
        removeStaleChunkListeners();
        cancelStaleRecoveryReset();
      };
    }
  });
  
  // Reagir a mudanças de rota para pré-carregamento inteligente
  $: if (browser) {
    smartPreloadPdfJs();
  }
  
  // Navigate to offline page
  function handleOfflineClick() {
    goto('/offline');
  }
  
  // Navigate to listas page
  function handleListasClick() {
    goto('/listas');
  }
  
  // Navigate to sobre page
  function handleSobreClick() {
    goto('/sobre');
  }

  // Detectar página atual para aplicar estilos dinâmicos
  $: isSobreActive = $page.url.pathname === '/sobre';
  $: isBibliotecaActive = $page.url.pathname === '/biblioteca';
  $: isHomeActive = $page.url.pathname === '/';
  $: isOfflineActive = $page.url.pathname === '/offline';
  $: isListasActive = $page.url.pathname === '/listas';
  
  // Verificar se alguma página está ativa (para aplicar estado inativo nos outros)
  $: hasActivePage = isSobreActive || isBibliotecaActive || isHomeActive || isOfflineActive || isListasActive;
</script>

<AppSnackbarHost />

<!-- Toolbar fixa no topo (oculta no /leitor) -->
{#if !$page.url.pathname.startsWith('/leitor')}
  <div class="fixed top-0 left-0 right-0 bg-background-color border-b-4 border-gold-color shadow-md z-40 plpc-header">
    <div class="header-content">
      <div class="header-title-section">
        <div class="header-main-row">
          <div class="header-left">
            <button 
              class="header-button sobre-button"
              class:active={isSobreActive}
              class:inactive={hasActivePage && !isSobreActive}
              on:click={handleSobreClick}
              aria-label="Sobre"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
                <path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
              </svg>
              <span>Como Usar</span>
              <div class="light-beam"></div>
            </button>
            <button 
              class="header-button biblioteca-button"
              class:active={isBibliotecaActive}
              class:inactive={hasActivePage && !isBibliotecaActive}
              on:click={() => goto('/biblioteca')}
              aria-label="Ir para Biblioteca"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75Z" />
              </svg>
              <span>Biblioteca</span>
              <div class="light-beam"></div>
            </button>
          </div>
          <div class="header-center">
            <button 
              class="plpc-title-button"
              class:active={isHomeActive}
              class:inactive={hasActivePage && !isHomeActive}
              on:click={() => goto('/')}
              aria-label="Ir para página principal"
            >
              <h1 class="text-center py-4 text-3xl font-garamond font-bold text-placeholder-color tracking-wide" style="text-shadow: 1px 1px 2px rgba(0,0,0,0.3);">
                PLPCG
              </h1>
              <div class="light-beam"></div>
            </button>
          </div>
          <div class="header-right">
            <button 
              class="header-button offline-button"
              class:active={isOfflineActive}
              class:inactive={hasActivePage && !isOfflineActive}
              on:click={handleOfflineClick}
              aria-label="Offline"
            >
              <CloudOff class="icon" />
              <span>Offline</span>
              <div class="light-beam"></div>
            </button>
            <button 
              class="header-button listas-button"
              class:active={isListasActive}
              class:inactive={hasActivePage && !isListasActive}
              on:click={handleListasClick}
              aria-label="Listas"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
              </svg>
              <span>Listas</span>
              <div class="light-beam"></div>
            </button>
          </div>
        </div>
      </div>
      {#if !isOfflineActive}
        <div class="offline-indicator-wrapper">
          <OfflineIndicator />
        </div>
      {/if}
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
    transition: all 0.3s ease;
    position: relative;
  }
  
  .plpc-title-button:hover {
    transform: scale(1.05);
  }
  
  .plpc-title-button:active {
    transform: scale(1.02);
  }

  .plpc-title-button.inactive {
    opacity: 0.5;
  }

  .plpc-title-button.inactive :global(h1) {
    font-size: 1.5rem;
    opacity: 0.7;
  }
  
  .header-title-section :global(h1) {
    text-align: center;
    margin: 0;
    transition: all 0.3s ease;
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
    transition: all 0.3s ease;
    opacity: 0.7;
    position: relative;
  }
  
  .header-button:hover {
    opacity: 1;
    font-size: 0.92rem;
    filter: brightness(1.1);
  }
  
  .header-button:active {
    transform: scale(0.98);
  }

  /* Estado ativo - aplicar estilo PLPCG com crescimento proporcional */
  /* PLPCG: 1.5rem → 1.875rem = 1.25x, então: 0.875rem → 1.09375rem ≈ 1.1rem */
  .header-button.active {
    font-size: 1.1rem; /* Crescimento proporcional: 0.875rem → 1.1rem = 1.257x (mesmo que PLPCG) */
    font-family: 'Garamond', serif;
    font-weight: 700;
    color: var(--placeholder-color);
    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
    opacity: 1;
  }

  .header-button.active .icon {
    width: 1.375rem;
    height: 1.375rem;
    filter: brightness(1.2);
  }

  .header-button.active span {
    font-size: 1.1rem; /* Crescimento proporcional: 0.875rem → 1.1rem = 1.257x (mesmo que PLPCG) */
    font-family: 'Garamond', serif;
    font-weight: 700;
  }

  /* Estado inativo - mais apagado */
  .header-button.inactive {
    opacity: 0.5;
  }

  .header-button.inactive .icon {
    opacity: 0.6;
  }

  .header-button span {
    font-size: 0.875rem; /* Tamanho base do texto (mesmo que o botão) */
    transition: all 0.3s ease;
  }
  
  .header-button .icon {
    width: 1.25rem;
    height: 1.25rem;
    transition: all 0.3s ease;
  }

  /* Feixe de luz */
  .light-beam {
    position: absolute;
    bottom: -2px;
    left: 50%;
    transform: translateX(-50%);
    height: 4px;
    width: 0;
    background: linear-gradient(to right, 
      transparent 0%, 
      rgba(255, 240, 160, 0.95) 15%,
      rgba(255, 230, 120, 1) 30%,
      rgba(255, 220, 100, 1) 50%, 
      rgba(255, 230, 120, 1) 70%,
      rgba(255, 240, 160, 0.95) 85%,
      transparent 100%);
    box-shadow: 
      0 0 12px rgba(255, 220, 100, 1),
      0 0 24px rgba(255, 220, 100, 0.8),
      0 0 36px rgba(255, 220, 100, 0.6),
      0 0 48px rgba(255, 220, 100, 0.4),
      0 2px 8px rgba(255, 220, 100, 0.7);
    border-radius: 50%;
    transition: width 0.3s ease, opacity 0.3s ease, box-shadow 0.3s ease;
    opacity: 0;
  }

  .header-button:hover .light-beam,
  .plpc-title-button:hover .light-beam {
    opacity: 1;
    width: 60%;
  }

  .header-button.active .light-beam {
    opacity: 1;
    width: calc(100% - 2rem);
  }

  .plpc-title-button .light-beam {
    bottom: 0.25rem;
  }

  .plpc-title-button:hover .light-beam {
    opacity: 1;
    width: 60%;
  }

  .plpc-title-button.active .light-beam {
    opacity: 1;
    width: calc(100% - 1rem);
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

    .header-button.active {
      font-size: 0.9375rem; /* Crescimento proporcional: 0.75rem → 0.9375rem = 1.25x */
    }

    .header-button.active span {
      font-size: 0.9375rem; /* Crescimento proporcional: 0.75rem → 0.9375rem = 1.25x */
    }

    .header-button.active .icon {
      width: 1.25rem;
      height: 1.25rem;
    }
    
    .header-button span {
      display: none;
    }
    
    .header-button .icon {
      width: 1.125rem;
      height: 1.125rem;
    }

    .plpc-title-button.inactive :global(h1) {
      font-size: 1.25rem;
    }

    .light-beam {
      height: 3px;
      box-shadow: 
        0 0 8px rgba(255, 220, 100, 1),
        0 0 16px rgba(255, 220, 100, 0.8),
        0 0 24px rgba(255, 220, 100, 0.6),
        0 2px 6px rgba(255, 220, 100, 0.7);
    }

    .header-button.active .light-beam,
    .plpc-title-button.active .light-beam {
      width: calc(100% - 1rem);
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

