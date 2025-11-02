<script>
  import { X } from 'lucide-svelte';
  import { carousel } from '$lib/stores/carousel';
  import { pdfViewer } from '$lib/stores/pdfViewer';
  import { enumMapper } from '$lib/utils/enumMapper';
  import { getPdfRelPath } from '$lib/utils/pathUtils';
  import { 
    fetchPdfAsBlob, 
    sharePdf, 
    savePdf, 
    buildOnlineReaderUrl, 
    openPdfNewTabOfflineFirst 
  } from '$lib/utils/pdfUtils';
  
  async function openPdfFromChip(louvor) {
    const pdfPath = getPdfRelPath(louvor);
    const mode = $pdfViewer;
    
    if (mode === 'newtab') {
      await openPdfNewTabOfflineFirst(`/${pdfPath}`, louvor.pdf);
      return;
    }
    if (mode === 'online') {
      const readerUrl = buildOnlineReaderUrl(pdfPath);
      window.open(readerUrl, '_blank', 'noopener');
      return;
    }
    if (mode === 'share') {
      try {
        const blob = await fetchPdfAsBlob(pdfPath);
        await sharePdf(blob, louvor.pdf, louvor.nome);
      } catch (_) {
        window.open(pdfPath, '_blank');
      }
      return;
    }
    if (mode === 'save') {
      try {
        const blob = await fetchPdfAsBlob(pdfPath);
        await savePdf(blob, louvor.pdf);
      } catch (_) {
        const a = document.createElement('a');
        a.href = pdfPath;
        a.download = louvor.pdf;
        a.click();
      }
      return;
    }
    
    // default: mesma aba
    window.location.href = pdfPath;
  }
  
  function handleChipClick(event, louvor) {
    if (event.target.closest('button')) return;
    openPdfFromChip(louvor);
  }
</script>

{#if $carousel.length > 0}
  <div class="w-full max-w-4xl mx-auto p-4 bg-gray-50 rounded-lg border border-gray-200 shadow-sm">
    <div class="flex justify-between items-center mb-3">
      <h3 class="text-base font-semibold text-gray-700">Louvores Selecionados</h3>
      <button
        on:click={() => carousel.clearCarousel()}
        class="bg-red-600 text-white border-none px-3 py-1.5 rounded text-xs cursor-pointer hover:bg-red-700 transition-colors"
      >
        Limpar Todos
      </button>
    </div>
    
    <div class="flex gap-2 overflow-x-auto pb-2">
      {#each $carousel as louvor}
        <div
          on:click={(e) => handleChipClick(e, louvor)}
          class="chip flex items-center bg-btn-background-color text-white px-4 py-2 rounded-full text-sm whitespace-nowrap cursor-pointer transition-colors hover:bg-btn-background-color/90 flex-shrink-0"
        >
          <span>#{enumMapper(louvor.numero) || 'N/A'} - {louvor.nome || 'Sem título'}</span>
          <button
            on:click|stopPropagation={() => carousel.removeLouvor(louvor.numero, louvor.nome, louvor.classificacao)}
            class="ml-2 bg-transparent border-none text-white text-xl cursor-pointer p-0 w-5 h-5 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
            title="Remover"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .chip {
    scrollbar-width: thin;
    scrollbar-color: #ccc #f8f9fa;
  }
  
  .chip::-webkit-scrollbar {
    height: 6px;
  }
  
  .chip::-webkit-scrollbar-track {
    background: #f8f9fa;
    border-radius: 3px;
  }
  
  .chip::-webkit-scrollbar-thumb {
    background: #ccc;
    border-radius: 3px;
  }
</style>

