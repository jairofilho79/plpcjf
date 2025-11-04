<script>
  import { X, Trash2, GripVertical } from 'lucide-svelte';
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
  
  let draggedIndex = null;
  let dragOverIndex = null;
  let hasDragged = false;
  let dragStartX = 0;
  let dragStartY = 0;
  
  function handleDragStart(event, index) {
    draggedIndex = index;
    hasDragged = false;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/html', index);
    event.currentTarget.style.opacity = '0.5';
  }
  
  function handleDragEnd(event) {
    event.currentTarget.style.opacity = '1';
    // Aguarda um tick para garantir que o drop seja processado antes do clique
    setTimeout(() => {
      draggedIndex = null;
      dragOverIndex = null;
      hasDragged = false;
    }, 0);
  }
  
  function handleDragOver(event, index) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (draggedIndex !== null && draggedIndex !== index) {
      dragOverIndex = index;
    }
  }
  
  function handleDragLeave(event) {
    // Só limpa se não estiver sobre outro item
    if (!event.currentTarget.contains(event.relatedTarget)) {
      dragOverIndex = null;
    }
  }
  
  function handleDrop(event, dropIndex) {
    event.preventDefault();
    event.stopPropagation();
    
    if (draggedIndex !== null && draggedIndex !== dropIndex) {
      hasDragged = true;
      carousel.reorderCarousel(draggedIndex, dropIndex);
    }
    
    draggedIndex = null;
    dragOverIndex = null;
  }
  
  function handleDrag(event) {
    // Verifica se houve movimento significativo (mais de 5 pixels)
    const deltaX = Math.abs(event.clientX - dragStartX);
    const deltaY = Math.abs(event.clientY - dragStartY);
    if (deltaX > 5 || deltaY > 5) {
      hasDragged = true;
    }
  }
  
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
    if (hasDragged) {
      hasDragged = false;
      return;
    }
    openPdfFromChip(louvor);
  }
  
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
</script>

{#if $carousel.length > 0}
  <div class="w-full max-w-4xl mx-auto p-4 bg-card-color rounded-lg border-2 relative carousel-container">
    <span class="container-tag">Playlist</span>
    <button
      on:click={() => carousel.clearCarousel()}
      class="clear-button-tag"
      title="Limpar todos"
    >
      <Trash2 class="w-3 h-3" />
      <span>Limpar</span>
    </button>
    
    <div class="flex gap-2 overflow-x-auto carousel-chips-list">
      {#each $carousel as louvor, index}
        {@const categoryIcon = getCategoryIcon(louvor.categoria)}
        <div
          draggable="true"
          on:dragstart={(e) => handleDragStart(e, index)}
          on:drag={(e) => handleDrag(e)}
          on:dragend={(e) => handleDragEnd(e)}
          on:dragover={(e) => handleDragOver(e, index)}
          on:dragleave={(e) => handleDragLeave(e)}
          on:drop={(e) => handleDrop(e, index)}
          on:click={(e) => handleChipClick(e, louvor)}
          class="carousel-chip"
          class:dragging={draggedIndex === index}
          class:drag-over={dragOverIndex === index}
        >
          <div class="drag-handle" on:mousedown|stopPropagation>
            <GripVertical class="w-4 h-4" />
          </div>
          <div class="chip-content">
            <div class="chip-title">
              <strong>#{enumMapper(louvor.numero) || 'N/A'}</strong> - {louvor.nome || 'Sem título'}
            </div>
            <div class="chip-subtitles">
              <div class="chip-classification">
                {enumMapper(louvor.classificacao) || 'Sem classificação'}
              </div>
              <div class="chip-category">
                {#if categoryIcon}
                  <svg class="category-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={categoryIcon} />
                  </svg>
                {/if}
                <span>{louvor.categoria || 'Sem categoria'}</span>
              </div>
            </div>
          </div>
          <button
            on:click|stopPropagation={() => carousel.removeLouvor(louvor.numero, louvor.nome, louvor.classificacao)}
            class="chip-remove-button"
            title="Remover"
          >
            <X class="w-3 h-3" />
          </button>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .carousel-container {
    position: relative;
    border-color: var(--gold-color);
  }
  
  .container-tag {
    position: absolute;
    top: -0.875rem;
    left: 0.75rem;
    background-color: var(--card-color);
    color: var(--text-dark);
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    border: 2px solid var(--gold-color);
    z-index: 10;
    line-height: 1;
  }
  
  .clear-button-tag {
    position: absolute;
    top: -0.875rem;
    right: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    background-color: var(--title-color);
    color: var(--placeholder-color);
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    border: 2px solid rgba(0,0,0,0.2);
    cursor: pointer;
    transition: all 0.2s ease;
    line-height: 1;
    z-index: 10;
  }
  
  .clear-button-tag:hover {
    background-color: var(--title-color);
    opacity: 0.9;
    transform: translateY(-1px);
  }
  
  .carousel-chips-list {
    overflow-x: auto;
    overflow-y: hidden;
    padding: 5px 0;
    scrollbar-width: thin;
    scrollbar-color: var(--gold-color) transparent;
  }
  
  .carousel-chip {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: fit-content;
    max-width: 200px;
    padding: 0.5rem 0.75rem;
    background-color: var(--title-color);
    border: 2px solid var(--gold-color);
    border-radius: 1.25rem;
    box-shadow: var(--shadow-md);
    transition: all 0.2s ease;
    cursor: pointer;
    flex-shrink: 0;
    position: relative;
  }
  
  .carousel-chip:hover {
    box-shadow: var(--shadow-lg);
    transform: translateY(-1px);
  }
  
  .carousel-chip.dragging {
    opacity: 0.5;
    cursor: grabbing;
  }
  
  .carousel-chip.drag-over {
    border-color: var(--gold-light);
    box-shadow: 0 0 0 2px var(--gold-light);
    transform: scale(1.05);
  }
  
  .drag-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-light);
    opacity: 0.6;
    cursor: grab;
    flex-shrink: 0;
    padding: 0.125rem;
    transition: opacity 0.2s ease;
  }
  
  .drag-handle:active {
    cursor: grabbing;
  }
  
  .carousel-chip:hover .drag-handle {
    opacity: 1;
  }
  
  .chip-content {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 0.125rem;
  }
  
  .chip-title {
    font-size: 0.875rem;
    font-family: 'Garamond', serif;
    font-weight: 700;
    color: var(--text-light);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .chip-subtitles {
    display: flex;
    flex-direction: row;
    gap: 0.375rem;
    align-items: center;
  }
  
  .chip-subtitles::after {
    content: '';
    width: 1px;
    height: 0.75rem;
    background-color: var(--text-light);
    opacity: 0.3;
  }
  
  .chip-classification {
    font-size: 0.7rem;
    color: var(--text-light);
    opacity: 0.85;
    line-height: 1.2;
    white-space: nowrap;
  }
  
  .chip-category {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.7rem;
    color: var(--text-light);
    opacity: 0.85;
    line-height: 1.2;
    white-space: nowrap;
  }
  
  .category-icon {
    width: 0.75rem;
    height: 0.75rem;
    color: var(--text-light);
    flex-shrink: 0;
  }
  
  .chip-remove-button {
    background-color: var(--card-color);
    color: var(--text-dark);
    border: none;
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    width: 1.25rem;
    height: 1.25rem;
    flex-shrink: 0;
  }
  
  .chip-remove-button:hover {
    background-color: var(--gold-light);
    transform: scale(1.1);
  }
  
  .carousel-chips-list::-webkit-scrollbar {
    height: 6px;
  }
  
  .carousel-chips-list::-webkit-scrollbar-track {
    background: transparent;
  }
  
  .carousel-chips-list::-webkit-scrollbar-thumb {
    background: var(--gold-color);
    border-radius: 3px;
  }
</style>

