<script>
  import { tick } from 'svelte';
  import { X, Trash2, GripVertical, Share2, Save, Check, ExternalLink, ChevronDown, ChevronUp } from 'lucide-svelte';
  import { goto } from '$app/navigation';
  import { carousel } from '$lib/stores/carousel';
  import { pdfViewer } from '$lib/stores/pdfViewer';
  import { savedPlaylists } from '$lib/stores/savedPlaylists';
  import { getPdfRelPath } from '$lib/utils/pathUtils';
  import GestureButton from '$lib/components/GestureButton.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { 
    fetchPdfAsBlob, 
    sharePdf, 
    savePdf, 
    buildOnlineReaderUrl, 
    openPdfNewTabOfflineFirst 
  } from '$lib/utils/pdfUtils';
  import { sharePlaylistLink, generatePlaylistShareUrl } from '$lib/utils/playlistUtils';
  import { navigateLouvorToLeitor } from '$lib/utils/navigateLouvorToLeitor';
  
  /**
   * @type {number | null}
   */
  let draggedIndex = null;
  /** @type {string | null} */
  let checkingPdfId = null;
  /** @type {string | null} */
  let pdfError = null;
  /** @type {string | null} */
  let processingPdfId = null;
  /**
   * @type {number | null}
   */
  let dragOverIndex = null;
  let hasDragged = false;
  let dragStartX = 0;
  let dragStartY = 0;

  let showClearDialog = false;
  let isExpanded = false;
  let isOpeningTabs = false;
  
  /**
   * @param {DragEvent & { currentTarget: EventTarget & HTMLDivElement; }} event
   * @param {number | null} index
   */
  function handleDragStart(event, index) {
    draggedIndex = index;
    hasDragged = false;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    // @ts-ignore
    event.dataTransfer.effectAllowed = 'move';
    // @ts-ignore
    event.dataTransfer.setData('text/html', index);
    event.currentTarget.style.opacity = '0.5';
  }
  
  /**
   * @param {DragEvent & { currentTarget: EventTarget & HTMLDivElement; }} event
   */
  function handleDragEnd(event) {
    event.currentTarget.style.opacity = '1';
    setTimeout(() => {
      draggedIndex = null;
      dragOverIndex = null;
      hasDragged = false;
    }, 0);
  }
  
  /**
   * @param {DragEvent & { currentTarget: EventTarget & HTMLDivElement; }} event
   * @param {number} index
   */
  function handleDragOver(event, index) {
    event.preventDefault();
    // @ts-ignore
    event.dataTransfer.dropEffect = 'move';
    if (draggedIndex !== null && draggedIndex !== index) {
      dragOverIndex = index;
    }
  }
  
  /**
   * @param {DragEvent & { currentTarget: EventTarget & HTMLDivElement; }} event
   */
  function handleDragLeave(event) {
    // @ts-ignore
    if (!event.currentTarget.contains(event.relatedTarget)) {
      dragOverIndex = null;
    }
  }
  
  /**
   * @param {DragEvent & { currentTarget: EventTarget & HTMLDivElement; }} event
   * @param {number} dropIndex
   */
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
  
  // @ts-ignore
  function handleDrag(event) {
    const deltaX = Math.abs(event.clientX - dragStartX);
    const deltaY = Math.abs(event.clientY - dragStartY);
    if (deltaX > 5 || deltaY > 5) {
      hasDragged = true;
    }
  }
  
  /**
   * @param {{ pdfId: string; nome: any; categoria: any; classificacao: any; pdf: string | undefined; }} louvor
   */
  async function openPdfFromChip(louvor) {
    const pdfPath = getPdfRelPath(louvor);
    const mode = $pdfViewer;
    
    if (mode === 'leitor') {
      checkingPdfId = louvor.pdfId;
      pdfError = null;
      try {
        const result = await navigateLouvorToLeitor(louvor);
        if (!result.navigated && result.error) {
          pdfError = result.error;
        }
      } finally {
        checkingPdfId = null;
      }
      return;
    }
    
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
      processingPdfId = louvor.pdfId;
      try {
        const blob = await fetchPdfAsBlob(pdfPath);
        await sharePdf(blob, louvor.pdf, louvor.nome);
      } catch (_) {
        // @ts-ignore
        window.open(pdfPath, '_blank');
      } finally {
        processingPdfId = null;
      }
      return;
    }
    if (mode === 'save') {
      processingPdfId = louvor.pdfId;
      try {
        const blob = await fetchPdfAsBlob(pdfPath);
        await savePdf(blob, louvor.pdf);
      } catch (_) {
        const a = document.createElement('a');
        // @ts-ignore
        a.href = pdfPath;
        // @ts-ignore
        a.download = louvor.pdf;
        a.click();
      } finally {
        processingPdfId = null;
      }
      return;
    }
    
    // @ts-ignore
    window.location.href = pdfPath;
  }
  
  // @ts-ignore
  function handleChipClick(event, louvor) {
    if (event.target.closest('button')) return;
    if (hasDragged) {
      hasDragged = false;
      return;
    }
    openPdfFromChip(louvor);
  }
  
  // @ts-ignore
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

  // --- Saved state detection (reactive against both $carousel and $savedPlaylists) ---

  let showCopiedMessage = false;
  let isSaving = false;

  $: currentPdfIds = $carousel
    .map(/** @type {{ pdfId: any; }} */ l => l.pdfId)
    .filter(/** @type {any} */ id => id != null && id !== '');

  $: currentHash = currentPdfIds.join(',');

  // Reacts to changes in $carousel (via currentHash) AND $savedPlaylists store
  $: savedPlaylistMatch = currentHash !== ''
    ? ($savedPlaylists.find(/** @type {{ pdfIds: string[]; }} */ p => p.pdfIds.join(',') === currentHash) || null)
    : null;

  $: isPlaylistSaved = savedPlaylistMatch !== null;
  $: canSave = $carousel.length > 0 && !isPlaylistSaved && !isSaving;
  $: canShare = $carousel.length > 0;

  // --- Playlist name truncation ---

  /**
   * @param {string | null | undefined} name
   */
  function truncateDesktop(name) {
    if (!name) return '';
    if (name.length > 25) return name.slice(0, 22) + '...';
    return name;
  }

  /**
   * @param {string | null | undefined} name
   */
  function truncateMobile(name) {
    if (!name) return '';
    if (name.length > 10) return name.slice(0, 7) + '...';
    return name;
  }

  // --- Save ---

  function generateDefaultPlaylistName() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `lista ${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  }

  function handleSave() {
    if (isSaving || !$carousel.length || isPlaylistSaved) return;
    isSaving = true;
    
    const pdfIds = $carousel
      .map(/** @type {{ pdfId: any; }} */ l => l.pdfId)
      .filter(/** @type {any} */ id => id != null && id !== '');
    
    if (pdfIds.length === 0) {
      isSaving = false;
      return;
    }
    
    const playlistId = savedPlaylists.savePlaylist(pdfIds);
    goto(`/listas?editId=${playlistId}`);
    
    setTimeout(() => {
      isSaving = false;
    }, 0);
  }
  
  function handleSaveClick() {
    handleSave();
  }

  // --- Share ---

  async function handleShare() {
    if (!$carousel.length) return;
    
    const pdfIds = $carousel.map(/** @type {{ pdfId: any; }} */ l => l.pdfId);
    const playlistName = savedPlaylistMatch?.nome || generateDefaultPlaylistName();
    const shareUrl = generatePlaylistShareUrl(pdfIds, playlistName);
    
    try {
      // @ts-ignore – sharePlaylistLink can return { copied: boolean } despite void typing
      const result = await sharePlaylistLink(shareUrl, playlistName);
      // @ts-ignore
      if (result && result.copied) {
        showCopiedMessage = true;
        setTimeout(() => {
          showCopiedMessage = false;
        }, 2000);
      }
    } catch (error) {
      console.error('Erro ao compartilhar playlist:', error);
    }
  }

  // --- Clear (with confirmation dialog) ---

  function handleClearRequest() {
    showClearDialog = true;
  }

  function handleClearConfirm() {
    showClearDialog = false;
    carousel.clearCarousel();
  }

  function handleClearCancel() {
    showClearDialog = false;
  }

  // --- Open all in tabs ---

  function handleOpenInTabs() {
    if (!$carousel.length || isOpeningTabs) return;

    const mode = $pdfViewer;
    // share/save don't map to "open in tab" — fall back to leitor
    const effectiveMode = (mode === 'share' || mode === 'save') ? 'leitor' : mode;

    isOpeningTabs = true;

    for (const louvor of $carousel) {
      const pdfPath = getPdfRelPath(louvor);
      if (!pdfPath) continue;

      if (effectiveMode === 'leitor') {
        const fileParam = encodeURIComponent(`/${pdfPath}`);
        const tituloParam = encodeURIComponent(louvor.nome || '');
        const subtituloText = `${louvor.categoria || ''} | ${louvor.classificacao || ''}`.trim();
        const subtituloParam = encodeURIComponent(subtituloText);
        window.open(
          `/leitor?file=${fileParam}&titulo=${tituloParam}&subtitulo=${subtituloParam}`,
          '_blank',
          'noopener'
        );
      } else if (effectiveMode === 'newtab') {
        window.open(
          new URL(`/${pdfPath}`, window.location.origin).href,
          '_blank',
          'noopener'
        );
      } else if (effectiveMode === 'online') {
        window.open(buildOnlineReaderUrl(pdfPath), '_blank', 'noopener');
      }
    }

    setTimeout(() => { isOpeningTabs = false; }, 500);
  }

  // --- Expand / collapse ---

  function handleExpandToggle() {
    isExpanded = !isExpanded;
    // Cancel any active drag when toggling layout
    draggedIndex = null;
    dragOverIndex = null;
    hasDragged = false;
  }
</script>

{#if $carousel.length > 0}
  <div class="w-full max-w-4xl mx-auto p-4 bg-card-color rounded-lg border-2 relative carousel-container">

    <!-- Left label group: "Playlist" + saved name box -->
    <div class="left-tags-group">
      <span class="container-tag">Playlist</span>
      {#if savedPlaylistMatch}
        <span class="container-tag playlist-name-tag" title={savedPlaylistMatch.nome}>
          <span class="name-desktop">{truncateDesktop(savedPlaylistMatch.nome)}</span>
          <span class="name-mobile">{truncateMobile(savedPlaylistMatch.nome)}</span>
        </span>
      {/if}
    </div>

    <!-- Action buttons group -->
    <div class="action-buttons-group">
      <button
        on:click={handleShare}
        class="action-button-tag light-button"
        title="Compartilhar playlist"
        disabled={!canShare}
      >
        <Share2 class="w-3 h-3" />
        <span>Compartilhar</span>
      </button>

      <GestureButton
        on:click={handleSaveClick}
        visualFeedback={true}
        hapticFeedback={true}
        disabled={!canSave}
        preventDefault={true}
      >
        <div
          class="action-button-tag light-button"
          class:saved={isPlaylistSaved}
          class:disabled={!canSave}
          title={isPlaylistSaved ? 'Playlist já salva' : isSaving ? 'Salvando...' : 'Toque para salvar'}
        >
          {#if isPlaylistSaved}
            <Check class="w-3 h-3" />
            <span>Salvo</span>
          {:else if isSaving}
            <Save class="w-3 h-3" />
            <span>Salvando...</span>
          {:else}
            <Save class="w-3 h-3" />
            <span>Salvar</span>
          {/if}
        </div>
      </GestureButton>

      <button
        on:click={handleOpenInTabs}
        class="action-button-tag light-button"
        title="Abrir todos em novas abas"
        disabled={isOpeningTabs}
      >
        <ExternalLink class="w-3 h-3" />
        <span>Em Abas</span>
      </button>

      <button
        on:click={handleExpandToggle}
        class="action-button-tag light-button"
        title={isExpanded ? 'Encolher lista' : 'Expandir lista'}
      >
        {#if isExpanded}
          <ChevronUp class="w-3 h-3" />
          <span>Encolher</span>
        {:else}
          <ChevronDown class="w-3 h-3" />
          <span>Expandir</span>
        {/if}
      </button>

      <button
        on:click={handleClearRequest}
        class="action-button-tag clear-button-tag clear-button-spacer"
        title="Limpar todos"
      >
        <Trash2 class="w-3 h-3" />
        <span>Limpar</span>
      </button>
    </div>

    {#if showCopiedMessage}
      <div class="copied-message">Link copiado!</div>
    {/if}
    
    {#if pdfError}
      <div class="pdf-error-banner" role="alert">
        {pdfError}
      </div>
    {/if}

    <div class="carousel-chips-list" class:expanded={isExpanded}>
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
          class:checking={checkingPdfId === louvor.pdfId}
          class:processing={processingPdfId === louvor.pdfId}
        >
          <div class="drag-handle" on:mousedown|stopPropagation>
            <GripVertical class="w-4 h-4" />
          </div>
          <div class="chip-content">
            <div class="chip-title">
              <strong>#{louvor.numero || 'N/A'}</strong> - {louvor.nome || 'Sem título'}
              {#if processingPdfId === louvor.pdfId}
                <span class="processing-indicator">
                  {#if $pdfViewer === 'share'}Compartilhando...{:else if $pdfViewer === 'save'}Baixando...{/if}
                </span>
              {/if}
            </div>
            <div class="chip-subtitles">
              <div class="chip-classification">
                {louvor.classificacao || 'Sem classificação'}
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
            on:click|stopPropagation={() => carousel.removeLouvor(louvor.pdfId)}
            class="chip-remove-button"
            title="Remover"
          >
            <X class="w-3 h-3" />
          </button>
        </div>
      {/each}
    </div>

    <ConfirmDialog
      show={showClearDialog}
      title="Limpar Playlist"
      message="Tem certeza que deseja remover todos os louvores da playlist?"
      confirmLabel="Limpar"
      cancelLabel="Cancelar"
      onConfirm={handleClearConfirm}
      onCancel={handleClearCancel}
    />
  </div>
{/if}

<style>
  .carousel-container {
    position: relative;
    border-color: var(--gold-color);
  }

  /* ---- Left label group ---- */

  .left-tags-group {
    position: absolute;
    top: -0.875rem;
    left: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    z-index: 10;
  }
  
  .container-tag {
    background-color: var(--card-color);
    color: var(--text-dark);
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    border: 2px solid var(--gold-color);
    line-height: 1;
    white-space: nowrap;
  }

  .playlist-name-tag {
    color: var(--gold-color);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .name-desktop {
    display: inline;
  }

  .name-mobile {
    display: none;
  }

  @media (max-width: 640px) {
    .name-desktop {
      display: none;
    }
    .name-mobile {
      display: inline;
    }
  }

  /* ---- Action buttons group ---- */
  
  .action-buttons-group {
    position: absolute;
    top: -0.875rem;
    right: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    z-index: 10;
  }

  .action-button-tag {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    border: 2px solid rgba(0,0,0,0.2);
    cursor: pointer;
    transition: all 0.2s ease;
    line-height: 1;
  }

  /* Extra left margin to make accidental clicks harder */
  .clear-button-spacer {
    margin-left: 0.75rem;
  }

  .light-button {
    background-color: var(--card-color);
    color: var(--text-dark);
  }

  .light-button:disabled,
  .light-button.disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  @media (hover: hover) and (pointer: fine) {
    .light-button:hover:not(:disabled) {
      background-color: var(--placeholder-color);
      transform: translateY(-1px);
    }
    
    .light-button.saved:hover:not(:disabled) {
      background-color: rgba(212, 175, 55, 0.3);
    }
  }

  @media (hover: none) and (pointer: coarse) {
    .light-button:active:not(:disabled) {
      background-color: var(--placeholder-color);
      transform: translateY(-1px);
    }
    
    .light-button.saved:active:not(:disabled) {
      background-color: rgba(212, 175, 55, 0.3);
    }
  }

  .light-button.saved {
    background-color: var(--card-color) !important;
    border-color: var(--gold-color);
    color: var(--gold-color);
  }
  
  .light-button.saved:disabled,
  .light-button.saved.disabled,
  .action-button-tag.light-button.saved {
    background-color: var(--card-color) !important;
    opacity: 0.8;
  }

  .clear-button-tag {
    background-color: var(--title-color);
    color: var(--placeholder-color);
  }
  
  .clear-button-tag:hover {
    background-color: var(--title-color);
    opacity: 0.9;
    transform: translateY(-1px);
  }

  /* ---- Responsive: smaller gap + icon-only on very small screens ---- */

  @media (max-width: 640px) {
    .action-buttons-group {
      gap: 0.25rem;
    }
    .action-button-tag {
      padding: 0.2rem 0.375rem;
    }
    .clear-button-spacer {
      margin-left: 0.375rem;
    }
  }

  @media (max-width: 480px) {
    .action-button-tag span {
      display: none;
    }
  }

  /* ---- Copied message ---- */

  .copied-message {
    position: absolute;
    top: -2.5rem;
    right: 0.75rem;
    background-color: var(--title-color);
    color: var(--placeholder-color);
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    border: 2px solid var(--gold-color);
    z-index: 20;
    animation: fadeInOut 2s ease;
  }

  @keyframes fadeInOut {
    0%, 100% { opacity: 0; transform: translateY(-5px); }
    10%, 90% { opacity: 1; transform: translateY(0); }
  }
  
  /* ---- Chips list (horizontal default, vertical when expanded) ---- */

  .carousel-chips-list {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 5px 0;
    flex-wrap: nowrap;
    scrollbar-width: thin;
    scrollbar-color: var(--gold-color) transparent;
  }

  .carousel-chips-list.expanded {
    flex-direction: column;
    overflow-x: hidden;
    overflow-y: auto;
    flex-wrap: nowrap;
    max-height: 70vh;
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

  /* ---- Chip base ---- */
  
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

  /* ---- Expanded mode: chips grow 25% and fill full width ---- */

  .carousel-chips-list.expanded .carousel-chip {
    min-width: unset;
    max-width: 100%;
    padding: 0.625rem 0.9375rem;
  }

  /* Vertical drag-over indicator */
  .carousel-chips-list.expanded .carousel-chip.drag-over {
    transform: translateY(-2px);
    border-top-color: var(--gold-light);
    box-shadow: 0 -2px 0 var(--gold-light), 0 0 0 2px var(--gold-light);
  }

  /* ---- Drag handle ---- */
  
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
  
  /* ---- Chip content ---- */

  .chip-content {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 0.125rem;
    flex: 1;
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

  .carousel-chips-list.expanded .chip-title {
    font-size: 1.09375rem;
    white-space: normal;
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

  .carousel-chips-list.expanded .chip-classification {
    font-size: 0.875rem;
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

  .carousel-chips-list.expanded .chip-category {
    font-size: 0.875rem;
  }
  
  .category-icon {
    width: 0.75rem;
    height: 0.75rem;
    color: var(--text-light);
    flex-shrink: 0;
  }

  .carousel-chips-list.expanded .category-icon {
    width: 0.9375rem;
    height: 0.9375rem;
  }
  
  /* ---- Remove button ---- */

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

  /* ---- Loading states ---- */
  
  .carousel-chip.checking,
  .carousel-chip.processing {
    opacity: 0.6;
    cursor: wait;
    pointer-events: none;
  }
  
  .processing-indicator {
    display: inline-block;
    margin-left: 0.5rem;
    font-size: 0.7rem;
    opacity: 0.8;
    font-weight: 400;
    color: var(--gold-color);
  }

  /* ---- PDF error ---- */

  .pdf-error-banner {
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
</style>
