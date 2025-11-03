<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import UpdateBanner from '$lib/components/UpdateBanner.svelte';
  import InstallProgressModal from '$lib/components/InstallProgressModal.svelte';
  
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
  let progress = { current: 0, total: 0 };
  
  onMount(() => {
    if (!browser) return;
    
    // Service Worker registration
    if ('serviceWorker' in navigator) {
      const swPath = '/sw.js';
      
      // Register with type: 'module' in development for ES module support
      const swOptions: RegistrationOptions = {
        scope: '/',
        // Use module type in development to support ES imports
        ...(browser && window.location.hostname === 'localhost' ? { type: 'module' as WorkerType } : {})
      };
      
      navigator.serviceWorker.register(swPath, swOptions)
        .then((registration) => {
          console.log('SW registered:', registration);
          
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
          // Silently fail in development if service worker is not available
          if (error.message?.includes('HTTP') || error.message?.includes('403') || error.message?.includes('404')) {
            console.warn('SW not available in development:', error.message);
          } else {
            console.error('SW registration failed:', error);
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
            setTimeout(() => { showProgressModal = false; }, 4000);
          }
        }
        if (event.data && event.data.type === 'VERIFY_SUMMARY') {
          showProgressModal = true;
          progress = {
            current: event.data.summary.present,
            total: event.data.summary.total
          };
          setTimeout(() => { showProgressModal = false; }, 4000);
        }
      });
    }
    
    // PLPC header hidden activation (7 taps in 10s)
    // DESABILITADO - Será reabilitado em breve
    /*
    const header = document.querySelector('.plpc-header');
    if (header) {
      let tapCount = 0;
      let windowStart = 0;
      const WINDOW_MS = 10000;
      const REQUIRED_TAPS = 7;
      
      function onTap() {
        const now = Date.now();
        if (windowStart === 0 || (now - windowStart) > WINDOW_MS) {
          tapCount = 0;
          windowStart = now;
        }
        tapCount += 1;
        if (tapCount >= REQUIRED_TAPS) {
          try {
            localStorage.setItem('ALLOW_PDF_SYNC', '1');
            showProgressModal = true;
            progress = { current: 0, total: 0 };
            if (navigator.serviceWorker && navigator.serviceWorker.controller) {
              navigator.serviceWorker.controller.postMessage({ type: 'SYNC_PDFS' });
            }
          } catch (_) {}
          tapCount = 0;
        }
      }
      
      header.addEventListener('click', onTap);
      header.addEventListener('touchend', onTap, { passive: true });
    }
    */
  });
</script>

<!-- Toolbar fixa no topo (oculta no /leitor) -->
{#if !$page.url.pathname.startsWith('/leitor')}
  <div class="fixed top-0 left-0 right-0 bg-background-color border-b-4 border-gold-color shadow-md z-40 plpc-header" style="cursor: pointer; pointer-events: none;">
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

<!-- Install Progress Modal -->
<InstallProgressModal {progress} bind:show={showProgressModal} />

