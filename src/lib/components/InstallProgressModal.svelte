<script>
  import { browser } from '$app/environment';
  
  export let progress = { current: 0, total: 0 };
  export let show = false;
  
  function cancelInstall() {
    show = false;
    console.log('Installation cancelled by user');
  }
  
  $: percent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
</script>

{#if show && browser}
  <div class="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
    <div class="bg-white p-8 rounded-xl max-w-md text-center">
      <h3 class="mb-5 text-xl font-garamond font-bold">Instalando aplicação offline...</h3>
      <div class="bg-gray-200 rounded h-5 mb-5">
        <div
          class="bg-gold-color h-full rounded transition-all duration-300"
          style="width: {percent}%"
        ></div>
      </div>
      <p class="my-3 text-gray-700">
        {progress.current < progress.total 
          ? `Baixando PDFs: ${progress.current}/${progress.total}`
          : 'Concluído!'}
      </p>
      <button
        on:click={cancelInstall}
        class="mt-5 px-5 py-2 bg-red-600 text-white border-none rounded cursor-pointer hover:bg-red-700 transition-colors"
      >
        Cancelar
      </button>
    </div>
  </div>
{/if}

