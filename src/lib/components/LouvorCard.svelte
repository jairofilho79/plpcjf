<script>
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { Plus, Check } from 'lucide-svelte';
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
  import { isPdfAvailableInIndex } from '$lib/utils/pdfIndex';
  import { ensurePdfAvailable, validatePdfWithStrategies, validatePdfAvailability } from '$lib/utils/pdfValidation';
  import { setupCardPrefetch } from '$lib/utils/pdfjsLoader';
  
  export let louvor;
  
  $: pdfPath = getPdfRelPath(louvor);
  $: isInCarousel = $carousel.some(item => 
    item.pdfId === louvor.pdfId
  );
  
  let isCheckingAvailability = false;
  let availabilityError = null;
  let cardElement;
  let prefetchCleanup;
  
  function getCategoryIcon(category) {
    if (!category) return null;
    if (category === 'Partitura') {
      return 'M7 21h10M7 21V5a2 2 0 012-2h6a2 2 0 012 2v16M7 21H5a2 2 0 01-2-2V9a2 2 0 012-2h2m10 4h2a2 2 0 012 2v10a2 2 0 01-2 2h-2m-4-4V9a2 2 0 012-2h2M9 9h2m-2 4h2m-2 4h2';
    }
    if (category === 'Cifra' || category.includes('Cifra nível')) {
      return 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z';
    }
    if (category === 'Gestos em Gravura') {
      return 'M10.05 4.575a1.575 1.575 0 1 0-3.15 0v3m3.15-3v-1.5a1.575 1.575 0 0 1 3.15 0v1.5m-3.15 0 .075 5.925m3.075.75V4.575m0 0a1.575 1.575 0 0 1 3.15 0V15M6.9 7.575a1.575 1.575 0 1 0-3.15 0v8.175a6.75 6.75 0 0 0 6.75 6.75h2.018a5.25 5.25 0 0 0 3.712-1.538l1.732-1.732a5.25 5.25 0 0 0 1.538-3.712l.003-2.024a.668.668 0 0 1 .198-.471 1.575 1.575 0 1 0-2.228-2.228 3.818 3.818 0 0 0-1.12 2.687M6.9 7.575V12m6.27 4.318A4.49 4.49 0 0 1 16.35 15m.002 0h-.002';
    }
    return null;
  }
  
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
    
    if (mode === 'leitor') {
      // VALIDAÇÃO PRÉ-NAVEGAÇÃO (não bloqueia se houver problemas temporários)
      isCheckingAvailability = true;
      availabilityError = null;
      
      try {
        // Quick check via index first (mas não bloqueia se index for null ou desatualizado)
        const indexCheck = isPdfAvailableInIndex(louvor.pdfId);
        
        let shouldProceed = false;
        
        if (indexCheck === true) {
          // Index diz que está disponível - confiar mas fazer validação rápida
          try {
            const quickValidation = await validatePdfAvailability(pdfPath);
            if (quickValidation.available) {
              shouldProceed = true;
            } else if (quickValidation.needsDownload && navigator.onLine) {
              // PDF não está offline mas pode ser baixado - permitir abertura (leitor tentará baixar)
              shouldProceed = true;
            }
          } catch (err) {
            console.warn('[LouvorCard] Quick validation failed, proceeding anyway:', err);
            // Se validação falhar por erro técnico, permitir abertura
            shouldProceed = true;
          }
        } else {
          // Index é false ou null - fazer validação completa
          const isAvailable = await ensurePdfAvailable(pdfPath);
          
          if (isAvailable) {
            shouldProceed = true;
          } else {
            // Verificar se pode ser baixado online
            const validation = await validatePdfAvailability(pdfPath);
            if (validation.needsDownload && navigator.onLine) {
              // PDF não está offline mas pode ser baixado - permitir abertura
              shouldProceed = true;
            } else if (!navigator.onLine && validation.available === false) {
              // Realmente não disponível e offline - mostrar erro
              availabilityError = 'PDF não está disponível offline. Por favor, baixe primeiro na página de configuração offline.';
              isCheckingAvailability = false;
              return;
            } else {
              // Se houver dúvida (SW não pronto, erro temporário), permitir abertura
              // O leitor tentará carregar e mostrará erro apropriado se realmente não estiver disponível
              console.warn('[LouvorCard] Validation uncertain, allowing navigation - leitor will handle errors');
              shouldProceed = true;
            }
          }
        }
        
        if (shouldProceed) {
          // PDF está disponível ou pode ser baixado, proceder com navegação
          // Adicionar flag validated=true para evitar validação dupla no leitor
          const fileParam = encodeURIComponent(`/${pdfPath}`);
          const tituloParam = encodeURIComponent(louvor.nome || '');
          const subtituloText = `${louvor.categoria || ''} | ${louvor.classificacao || ''}`.trim();
          const subtituloParam = encodeURIComponent(subtituloText);
          const url = `/leitor?file=${fileParam}&titulo=${tituloParam}&subtitulo=${subtituloParam}&validated=true`;
          window.open(url, '_blank', 'noopener');
        }
      } catch (err) {
        console.error('Erro ao validar PDF:', err);
        // Em caso de erro, permitir abertura - leitor tentará carregar
        // Não adicionar validated=true aqui pois validação falhou
        const fileParam = encodeURIComponent(`/${pdfPath}`);
        const tituloParam = encodeURIComponent(louvor.nome || '');
        const subtituloText = `${louvor.categoria || ''} | ${louvor.classificacao || ''}`.trim();
        const subtituloParam = encodeURIComponent(subtituloText);
        const url = `/leitor?file=${fileParam}&titulo=${tituloParam}&subtitulo=${subtituloParam}`;
        window.open(url, '_blank', 'noopener');
      } finally {
        isCheckingAvailability = false;
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
  
  $: categoryIcon = getCategoryIcon(louvor.categoria);
  
  // Setup prefetch quando card estiver montado e pdfPath disponível
  onMount(() => {
    if (browser && cardElement && pdfPath) {
      // Apenas prefetch se modo for leitor (não faz sentido para outros modos)
      if ($pdfViewer === 'leitor') {
        prefetchCleanup = setupCardPrefetch(cardElement, pdfPath);
      }
    }
  });
  
  onDestroy(() => {
    if (prefetchCleanup) {
      prefetchCleanup();
    }
  });
</script>

<div class="louvor-card" bind:this={cardElement}>
  {#if availabilityError}
    <div class="availability-error" role="alert">
      {availabilityError}
    </div>
  {/if}
  <a
    href={pdfPath}
    on:click|preventDefault={handleCardClick}
    class="louvor-info"
    class:checking={isCheckingAvailability}
  >
    <div class="louvor-title">
      <strong>#{louvor.numero || 'N/A'}</strong> - {louvor.nome || 'Sem título'}
    </div>
    <div class="louvor-subtitles">
      <div class="louvor-classification">
        {louvor.classificacao || 'Sem classificação'}
      </div>
      <div class="louvor-category">
        {#if categoryIcon}
          <svg class="category-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={categoryIcon} />
          </svg>
        {/if}
        <span>{louvor.categoria || 'Sem categoria'}</span>
      </div>
    </div>
  </a>
  
  <button
    on:click={handleAddToCarousel}
    disabled={isInCarousel}
    class="add-button"
    title="Adicionar à playlist de louvores"
  >
    {#if isInCarousel}
      <Check class="w-5 h-5" />
    {:else}
      <Plus class="w-5 h-5" />
    {/if}
  </button>
</div>

<style>
  .louvor-card {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.75rem;
    width: 100%;
    padding: 0.75rem 1rem;
    background-color: var(--title-color);
    border: 2px solid var(--gold-color);
    border-radius: 0.5rem;
    box-shadow: var(--shadow-md);
    transition: all 0.2s ease;
  }
  
  .louvor-card:hover {
    box-shadow: var(--shadow-lg);
    transform: translateY(-1px);
  }
  
  .louvor-info {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    text-decoration: none;
    color: var(--text-light);
    min-width: 0;
  }
  
  .louvor-title {
    font-size: 1rem;
    font-family: 'Garamond', serif;
    font-weight: 700;
    color: var(--text-light);
    margin-bottom: 0.5rem;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  
  .louvor-subtitles {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  
  .louvor-classification {
    font-size: 0.8125rem;
    color: var(--text-light);
    opacity: 0.9;
    line-height: 1.4;
  }
  
  .louvor-category {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.8125rem;
    color: var(--text-light);
    opacity: 0.9;
    line-height: 1.4;
  }
  
  .category-icon {
    width: 1rem;
    height: 1rem;
    color: var(--text-light);
    flex-shrink: 0;
  }
  
  .add-button {
    background-color: var(--card-color);
    color: var(--text-dark);
    border: 2px solid var(--gold-color);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
    min-width: 2.5rem;
    height: 2.5rem;
    align-self: center;
    flex-shrink: 0;
  }
  
  .add-button:hover:not(:disabled) {
    background-color: var(--gold-light);
    transform: scale(1.05);
  }
  
  .add-button:disabled {
    background-color: var(--badge-gray-bg);
    cursor: not-allowed;
    opacity: 0.6;
  }
  
  .availability-error {
    grid-column: 1 / -1;
    padding: 0.5rem;
    margin-bottom: 0.5rem;
    background-color: rgba(220, 38, 38, 0.1);
    border: 1px solid rgba(220, 38, 38, 0.3);
    border-radius: 0.25rem;
    color: var(--text-light);
    font-size: 0.875rem;
    text-align: center;
  }
  
  .louvor-info.checking {
    opacity: 0.6;
    cursor: wait;
    pointer-events: none;
  }
</style>

