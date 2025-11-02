<script>
  import { Plus, Check } from 'lucide-svelte';
  import { enumMapper } from '$lib/utils/enumMapper';
  import { getPdfRelPath } from '$lib/utils/pathUtils';
  import { 
    fetchPdfAsBlob, 
    sharePdf, 
    savePdf, 
    buildOnlineReaderUrl, 
    openPdfNewTabOfflineFirst 
  } from '$lib/utils/pdfUtils';
  import { carousel } from '$lib/stores/carousel';
  import { pdfViewer } from '$lib/stores/pdfViewer';
  
  export let louvor;
  
  $: pdfPath = getPdfRelPath(louvor);
  $: isInCarousel = $carousel.some(item => 
    item.numero === louvor.numero && 
    item.nome === louvor.nome && 
    item.classificacao === louvor.classificacao
  );
  
  async function handleCardClick() {
    const mode = $pdfViewer;
    
    if (mode === 'share' || mode === 'save') {
      try {
        const blob = await fetchPdfAsBlob(pdfPath);
        if (mode === 'share') {
          await sharePdf(blob, louvor.pdf, louvor.nome);
        } else {
          await savePdf(blob, louvor.pdf);
        }
      } catch (err) {
        console.error('Erro ao processar PDF:', err);
        window.open(pdfPath, '_blank');
      }
      return;
    }
    
    if (mode === 'online') {
      const readerUrl = buildOnlineReaderUrl(pdfPath);
      window.open(readerUrl, '_blank', 'noopener');
      return;
    }
    
    if (mode === 'newtab') {
      await openPdfNewTabOfflineFirst(`/${pdfPath}`, louvor.pdf);
      return;
    }
  }
  
  function handleAddToCarousel() {
    carousel.addLouvor(louvor);
  }
</script>

<div class="louvor-card grid grid-cols-[1fr_30%] w-full max-w-3xl h-48 p-6 border border-gray-300 rounded-card shadow-md hover:shadow-lg transition-transform hover:-translate-y-1 bg-card-bg">
  <a
    href={pdfPath}
    on:click|preventDefault={handleCardClick}
    class="louvor-info flex flex-col justify-between text-decoration-none text-current"
  >
    <div class="text-xl font-garamond font-bold text-center mb-4">
      <strong>#{enumMapper(louvor.numero) || 'N/A'}</strong> - {louvor.nome || 'Sem título'}
    </div>
    <div class="flex flex-col justify-center gap-2 text-center">
      <div class="text-sm text-gray-600">
        {enumMapper(louvor.classificacao) || 'Sem classificação'}
      </div>
      <div class="text-sm text-gray-500">
        {louvor.categoria || 'Sem categoria'}
      </div>
    </div>
  </a>
  
  <button
    on:click={handleAddToCarousel}
    disabled={isInCarousel}
    class="bg-btn-background-color text-text-light border-none rounded-lg text-2xl cursor-pointer transition-colors flex items-center justify-center w-full h-full hover:bg-btn-background-color/90 disabled:bg-gray-500 disabled:cursor-not-allowed"
  >
    {#if isInCarousel}
      <Check class="w-8 h-8" />
    {:else}
      <Plus class="w-8 h-8" />
    {/if}
  </button>
</div>

<style>
  .louvor-card {
    min-height: 200px;
  }
</style>

