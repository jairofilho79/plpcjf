<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import UpdateBanner from '$lib/components/UpdateBanner.svelte';
  import InstallProgressModal from '$lib/components/InstallProgressModal.svelte';
  import OfflineFilterModal from '$lib/components/OfflineFilterModal.svelte';
  import { louvores } from '$lib/stores/louvores';
  
  // Handle overflow for /leitor route
  $: if (browser && $page.url.pathname.startsWith('/leitor')) {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  } else if (browser) {
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }
  
  let showUpdateBanner = false;
  let showProgressModal = false;
  let showOfflineFilterModal = false;
  let progress = { current: 0, total: 0 };
  let alreadyCachedCount = 0;
  let totalToDownloadCount = 0;
  
  onMount(() => {
    if (!browser) return;
    
          // Service Worker registration
      // NOTA: Em dev com injectManifest, o service worker não funciona porque não é bundlado.
      // O rollupOptions só aplica durante o build. Em dev, os imports workbox não resolvem.
      // Desabilitamos em dev por enquanto. Teste em produção após o build.
      if ('serviceWorker' in navigator) {
        const isDev = browser && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
        
        if (isDev) {
          console.warn('[UI] Service Worker disabled in development (injectManifest limitation)');
          console.warn('[UI] Service worker will work in production after build');
          return;
        }
        
        // Service worker path
        // Em prod: nossa rota /sw.js serve o arquivo compilado (bundlado)
        const swPath = '/sw.js';
        
        // Register service worker
        // Em prod: rollupOptions (format: 'iife') gera bundle sem imports ES6 (não precisa de type: 'module')
        const swOptions: RegistrationOptions = {
          scope: '/'
        };
        
        navigator.serviceWorker.register(swPath, swOptions)
        .then((registration) => {
          console.log('[UI] SW registered:', registration.scope);
          
          // Sincronizar PDFs apenas para usuários permitidos
          const allowSync = localStorage.getItem('ALLOW_PDF_SYNC') === '1';
          if (allowSync) {
            if (navigator.serviceWorker.controller) {
              navigator.serviceWorker.controller.postMessage({ type: 'SYNC_PDFS' });
            } else {
              navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (navigator.serviceWorker.controller) {
                  navigator.serviceWorker.controller.postMessage({ type: 'SYNC_PDFS' });
                }
              }, { once: true });
            }
          }
          
          // Check for updates
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (newWorker && newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateBanner = true;
              }
            });
          });
          
          // Optional: Register Periodic Background Sync
          navigator.serviceWorker.ready
            .then(async (reg) => {
              const allowSync = localStorage.getItem('ALLOW_PDF_SYNC') === '1';
              if (!allowSync) return;
              if ('periodicSync' in reg) {
                try {
              const status = await (navigator.permissions as any).query({ name: 'periodic-background-sync' as any });
                  if (status.state === 'granted' || status.state === 'prompt') {
                const tags = await (reg as any).periodicSync.getTags();
                    if (!tags.includes('sync-pdfs')) {
                  await (reg as any).periodicSync.register('sync-pdfs', { minInterval: 24 * 60 * 60 * 1000 });
                      console.log('[UI] Periodic background sync registered');
                    }
                  }
                } catch (e) {
                  console.log('[UI] Periodic background sync not available', e);
                }
              }
            });
                  })
          .catch((error) => {
            console.error('[UI] SW registration failed:', error);
            if (error.message) {
              console.error('[UI] Error message:', error.message);
            }
          });
    }
    
    // Listen for progress updates
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'PROGRESS') {
          progress = event.data.progress;
          showProgressModal = true;
          if (progress.current >= progress.total) {
            setTimeout(() => { showProgressModal = false; }, 2000);
          }
        } else if (event.data && event.data.type === 'CACHE_CHECK_COMPLETE') {
          handleCacheCheckComplete(event.data);
        } else if (event.data && event.data.type === 'VERIFY_SUMMARY') {
          showProgressModal = true;
          progress = {
            current: event.data.summary.present,
            total: event.data.summary.total
          };
          setTimeout(() => { showProgressModal = false; }, 4000);
        }
      });
    }
    
    // PLPC header hidden activation (7 taps in 5 seconds)
    setupPlpcHeaderActivation();
  });
  
  // Functions for offline download
  function setupPlpcHeaderActivation() {
    const REQUIRED_TAPS = 7;
    const WINDOW_MS = 5000; // 5 segundos
    
    let plpcTapCount = 0;
    let plpcTapTimes: number[] = [];

    const plpcHeader = document.querySelector('.plpc-header');
    if (!plpcHeader) {
      console.warn('plpcHeader element not found');
      return;
    }

    const onTap = () => {
      const now = Date.now();
      plpcTapTimes.push(now);
      
      // Remove taps outside the time window
      plpcTapTimes = plpcTapTimes.filter((time: number) => now - time < WINDOW_MS);
      plpcTapCount = plpcTapTimes.length;
      
      if (plpcTapCount >= REQUIRED_TAPS) {
        // Reset counter
        plpcTapCount = 0;
        plpcTapTimes = [];
        
        // Abrir modal de filtros
        showOfflineFilterModal = true;
      }
    };

    plpcHeader.addEventListener('click', onTap);
    plpcHeader.addEventListener('touchend', onTap, { passive: true });
  }
  
  async function handleConfirmOfflineDownload(filters: string[]) {
    showOfflineFilterModal = false;
    showProgressModal = true;
    
    if (!('serviceWorker' in navigator)) {
      console.error('[UI] Service Worker not supported');
      showProgressModal = false;
      alert('Service Worker não é suportado neste navegador.');
      return;
    }
    
    // Função auxiliar para enviar mensagem
    const sendMessage = (louvoresData: any[]) => {
      // Tentar usar controller primeiro (mais rápido)
      if (navigator.serviceWorker.controller) {
        console.log('[UI] Using controller to send message');
        navigator.serviceWorker.controller.postMessage({
          type: 'SYNC_PDFS_FILTERED',
          filters: filters,
          louvores: louvoresData
        });
        console.log('[UI] Sent SYNC_PDFS_FILTERED message via controller with', louvoresData.length, 'louvores');
        return;
      }
      
      // Se não tiver controller, aguardar registration estar pronto
      navigator.serviceWorker.ready.then((registration) => {
        if (registration.active) {
          console.log('[UI] Using registration.active to send message');
          registration.active.postMessage({
            type: 'SYNC_PDFS_FILTERED',
            filters: filters,
            louvores: louvoresData
          });
          console.log('[UI] Sent SYNC_PDFS_FILTERED message via registration.active with', louvoresData.length, 'louvores');
        } else if (registration.installing) {
          console.log('[UI] Service worker installing, waiting for activation');
          registration.installing.addEventListener('statechange', () => {
            if (registration.active) {
              registration.active.postMessage({
                type: 'SYNC_PDFS_FILTERED',
                filters: filters,
                louvores: louvoresData
              });
              console.log('[UI] Sent SYNC_PDFS_FILTERED message after activation with', louvoresData.length, 'louvores');
            }
          });
        } else {
          console.warn('[UI] Service worker not active or installing');
          showProgressModal = false;
          alert('Service Worker não está ativo. Por favor, recarregue a página e tente novamente.');
        }
      }).catch((error) => {
        console.error('[UI] Error getting service worker ready:', error);
        showProgressModal = false;
        alert('Erro ao acessar Service Worker. Verifique se o service worker está registrado.');
      });
    };
    
    // Verificar se louvores já estão carregados
    if ($louvores && $louvores.length > 0) {
      sendMessage($louvores);
    } else {
      // Aguardar louvores serem carregados
      console.log('[UI] Waiting for louvores to load...');
      const unsubscribe = louvores.subscribe(l => {
        if (l && l.length > 0) {
          unsubscribe();
          sendMessage(l);
        }
      });
    }
  }
  
  function handleCancelOfflineDownload() {
    showOfflineFilterModal = false;
  }
  
  function handleCancelInstall() {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'CANCEL_SYNC'
      });
    }
    showProgressModal = false;
  }
  
  function handleCacheCheckComplete(data: { alreadyCached?: number; toDownload?: number; total?: number }) {
    alreadyCachedCount = data.alreadyCached || 0;
    totalToDownloadCount = data.toDownload || 0;
    showProgressModal = true;
  }
</script>

<!-- Toolbar fixa no topo (oculta no /leitor) -->
{#if !$page.url.pathname.startsWith('/leitor')}
  <div class="fixed top-0 left-0 right-0 bg-background-color border-b-4 border-gold-color shadow-md z-40 plpc-header" style="cursor: pointer;">
    <h1 class="text-center pt-4 pb-0 text-3xl font-garamond font-bold text-placeholder-color tracking-wide" style="text-shadow: 1px 1px 2px rgba(0,0,0,0.3);">
      PLPC
    </h1>
    <p class="text-center text-xs text-placeholder-color opacity-60 pb-3 pt-0.5 subtitle-inset">
      Pesquisador de Louvores de Partitura e Cifra (e Gestinhos)
    </p>
  </div>
{/if}

<!-- Conteúdo principal com margem para toolbar (sem margem superior no /leitor) -->
<div class="pb-4 px-4 min-h-screen bg-background-color" 
     class:pt-24={!$page.url.pathname.startsWith('/leitor')}
     class:px-0={$page.url.pathname.startsWith('/leitor')}
     class:pb-0={$page.url.pathname.startsWith('/leitor')}>
  <slot />
</div>

<!-- Update Banner -->
<UpdateBanner bind:show={showUpdateBanner} />

<!-- Offline Filter Modal -->
<OfflineFilterModal 
  bind:show={showOfflineFilterModal}
  onConfirm={handleConfirmOfflineDownload}
  onCancel={handleCancelOfflineDownload}
/>

<!-- Install Progress Modal -->
<InstallProgressModal 
  {progress} 
  bind:show={showProgressModal}
  alreadyCached={alreadyCachedCount}
  totalToDownload={totalToDownloadCount}
  onCancel={handleCancelInstall}
/>

