<script>
  import { browser } from '$app/environment';
  
  export let show = false;
  
  function updateApp() {
    if (!browser) return;
    
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      }, { once: true });
    }
  }
</script>

{#if show && browser}
  <div class="fixed bottom-0 left-0 right-0 bg-gold-color text-background-color px-4 py-4 text-center z-50 shadow-lg">
    <span class="mr-5">Nova versão disponível!</span>
    <button
      on:click={updateApp}
      class="px-5 py-2 bg-white text-gold-color border-none rounded cursor-pointer font-bold hover:bg-gray-100 transition-colors"
    >
      Atualizar Agora
    </button>
  </div>
{/if}

