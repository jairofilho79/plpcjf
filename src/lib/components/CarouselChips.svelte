<script>
  import { tick } from 'svelte';
  import { X, Trash2, GripVertical, Share2, Save, Check } from 'lucide-svelte';
  import { goto } from '$app/navigation';
  import { carousel } from '$lib/stores/carousel';
  import { pdfViewer } from '$lib/stores/pdfViewer';
  import { savedPlaylists } from '$lib/stores/savedPlaylists';
  import { getPdfRelPath } from '$lib/utils/pathUtils';
  import GestureButton from '$lib/components/GestureButton.svelte';
  import { 
    fetchPdfAsBlob, 
    sharePdf, 
    savePdf, 
    buildOnlineReaderUrl, 
    openPdfNewTabOfflineFirst 
  } from '$lib/utils/pdfUtils';
  import { sharePlaylistLink, generatePlaylistShareUrl } from '$lib/utils/playlistUtils';
  import { isPdfAvailableInIndex } from '$lib/utils/pdfIndex';
  import { ensurePdfAvailable, getCachedValidation } from '$lib/utils/pdfValidation';
  
  /**
     * @type {number | null}
     */
  let draggedIndex = null;
  let checkingPdfId = null;
  let pdfError = null;
  /**
     * @type {number | null}
     */
  let dragOverIndex = null;
  let hasDragged = false;
  let dragStartX = 0;
  let dragStartY = 0;
  
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
    // Aguarda um tick para garantir que o drop seja processado antes do clique
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
    // Só limpa se não estiver sobre outro item
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
    // Verifica se houve movimento significativo (mais de 5 pixels)
    const deltaX = Math.abs(event.clientX - dragStartX);
    const deltaY = Math.abs(event.clientY - dragStartY);
    if (deltaX > 5 || deltaY > 5) {
      hasDragged = true;
    }
  }
  
  /**
     * @param {{ nome: any; categoria: any; classificacao: any; pdf: string | undefined; }} louvor
     */
  async function openPdfFromChip(louvor) {
    const pdfPath = getPdfRelPath(louvor);
    const mode = $pdfViewer;
    
    if (mode === 'leitor') {
      // FASE 2: Cache de Validação - verificar cache primeiro
      checkingPdfId = louvor.pdfId;
      pdfError = null;
      
      try {
        // Verificar cache de validação primeiro (Fase 2)
        const cached = getCachedValidation(louvor.pdfId);
        if (cached && cached.available) {
          // Cache diz que está disponível - usar URL do cache e pular validação
          const fileParam = encodeURIComponent(cached.url || `/${pdfPath}`);
          const tituloParam = encodeURIComponent(louvor.nome || '');
          const subtituloText = `${louvor.categoria || ''} | ${louvor.classificacao || ''}`.trim();
          const subtituloParam = encodeURIComponent(subtituloText);
          const url = `/leitor?file=${fileParam}&titulo=${tituloParam}&subtitulo=${subtituloParam}&validated=true`;
          window.open(url, '_blank', 'noopener');
          checkingPdfId = null;
          return;
        }
        
        // Se não estiver no cache ou cache diz que não está disponível, fazer validação
        // Quick check via index first (mas não bloqueia se index for null ou desatualizado)
        const indexCheck = isPdfAvailableInIndex(louvor.pdfId);
        
        let shouldProceed = false;
        
        if (indexCheck === true) {
          // Index diz que está disponível - confiar mas fazer validação rápida
          try {
            const { validatePdfAvailability } = await import('$lib/utils/pdfValidation');
            const quickValidation = await validatePdfAvailability(pdfPath, louvor.pdfId);
            if (quickValidation.available) {
              shouldProceed = true;
            } else if (quickValidation.needsDownload && navigator.onLine) {
              // PDF não está offline mas pode ser baixado - permitir abertura (leitor tentará baixar)
              shouldProceed = true;
            }
          } catch (err) {
            console.warn('[CarouselChips] Quick validation failed, proceeding anyway:', err);
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
            const { validatePdfAvailability } = await import('$lib/utils/pdfValidation');
            const validation = await validatePdfAvailability(pdfPath, louvor.pdfId);
            if (validation.needsDownload && navigator.onLine) {
              // PDF não está offline mas pode ser baixado - permitir abertura
              shouldProceed = true;
            } else if (!navigator.onLine && validation.available === false) {
              // Realmente não disponível e offline - mostrar erro
              pdfError = 'PDF não está disponível offline. Por favor, baixe primeiro na página de configuração offline.';
              checkingPdfId = null;
              return;
            } else {
              // Se houver dúvida (SW não pronto, erro temporário), permitir abertura
              // O leitor tentará carregar e mostrará erro apropriado se realmente não estiver disponível
              console.warn('[CarouselChips] Validation uncertain, allowing navigation - leitor will handle errors');
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
        const fileParam = encodeURIComponent(`/${pdfPath}`);
        const tituloParam = encodeURIComponent(louvor.nome || '');
        const subtituloText = `${louvor.categoria || ''} | ${louvor.classificacao || ''}`.trim();
        const subtituloParam = encodeURIComponent(subtituloText);
        const url = `/leitor?file=${fileParam}&titulo=${tituloParam}&subtitulo=${subtituloParam}`;
        window.open(url, '_blank', 'noopener');
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
      try {
        const blob = await fetchPdfAsBlob(pdfPath);
        await sharePdf(blob, louvor.pdf, louvor.nome);
      } catch (_) {
        // @ts-ignore
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
        // @ts-ignore
        a.href = pdfPath;
        // @ts-ignore
        a.download = louvor.pdf;
        a.click();
      }
      return;
    }
    
    // default: mesma aba
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

  // Track saved playlist state - apenas o hash da playlist salva
  let savedPdfIds = null;
  let savedPlaylistName = null;
  let showCopiedMessage = false;
  let isSaving = false; // Flag para prevenir múltiplos salvamentos simultâneos

  // Generate hash of current playlist for comparison
  function getCurrentPlaylistHash() {
    const pdfIds = $carousel
      .map(l => l.pdfId)
      .filter(id => id != null && id !== '')
      .join(',');
    return pdfIds;
  }

  // Check if current playlist matches saved version
  $: currentHash = getCurrentPlaylistHash();
  $: isPlaylistSaved = savedPdfIds !== null && savedPdfIds === currentHash && currentHash !== '';
  $: canSave = $carousel.length > 0 && !isPlaylistSaved && !isSaving;
  $: canShare = $carousel.length > 0; // Botão de compartilhar sempre habilitado se houver itens

  // Limpar estado salvo quando o carousel muda (hash muda)
  $: {
    currentHash; // Reage a mudanças no carousel
    
    // Se o hash mudou e temos um estado salvo, limpar (playlist foi modificada)
    if (savedPdfIds !== null && savedPdfIds !== currentHash) {
      savedPdfIds = null;
      savedPlaylistName = null;
    }
    
    // Se o carousel está vazio, limpar estado
    if ($carousel.length === 0) {
      savedPdfIds = null;
      savedPlaylistName = null;
    }
  }

  function handleSave() {
    // Prevenir múltiplos salvamentos simultâneos
    if (isSaving || !$carousel.length || isPlaylistSaved) return;
    
    // Marcar como salvando para desabilitar o botão imediatamente
    isSaving = true;
    
    // Filter out invalid IDs
    const pdfIds = $carousel
      .map(l => l.pdfId)
      .filter(id => id != null && id !== '');
    
    if (pdfIds.length === 0) {
      isSaving = false;
      return;
    }
    
    const hash = pdfIds.join(',');
    
    // Sempre criar nova playlist (não verificar se já existe)
    const playlistId = savedPlaylists.savePlaylist(pdfIds);
    const newPlaylist = savedPlaylists.getPlaylist(playlistId);
    
    // Atualizar estado imediatamente após salvar (síncrono)
    savedPdfIds = hash;
    savedPlaylistName = newPlaylist ? newPlaylist.nome : null;
    
    // Reset flag de forma assíncrona para não bloquear a UI
    // A reatividade do Svelte vai atualizar isPlaylistSaved automaticamente
    setTimeout(() => {
      isSaving = false;
    }, 0);
  }
  
  function handleSaveClick() {
    handleSave();
  }

  /**
   * Generate default playlist name: "lista dd/mm/yyyy HH:mm:ss"
   */
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

  async function handleShare() {
    if (!$carousel.length) return;
    
    const pdfIds = $carousel.map(l => l.pdfId);
    // Use saved playlist name if available, otherwise generate default name
    const playlistName = savedPlaylistName || generateDefaultPlaylistName();
    const shareUrl = generatePlaylistShareUrl(pdfIds, playlistName);
    
    try {
      const result = await sharePlaylistLink(shareUrl, playlistName);
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
</script>

{#if $carousel.length > 0}
  <div class="w-full max-w-4xl mx-auto p-4 bg-card-color rounded-lg border-2 relative carousel-container">
    <span class="container-tag">Playlist</span>
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
          title={isPlaylistSaved ? 'Playlist salva (toque para salvar novamente)' : isSaving ? 'Salvando...' : 'Toque para salvar'}
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
        on:click={() => carousel.clearCarousel()}
        class="action-button-tag clear-button-tag"
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
          class:checking={checkingPdfId === louvor.pdfId}
        >
          <div class="drag-handle" on:mousedown|stopPropagation>
            <GripVertical class="w-4 h-4" />
          </div>
          <div class="chip-content">
            <div class="chip-title">
              <strong>#{louvor.numero || 'N/A'}</strong> - {louvor.nome || 'Sem título'}
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

  .light-button {
    background-color: var(--card-color);
    color: var(--text-dark);
  }

  .light-button:disabled,
  .light-button.disabled {
    opacity: 0.6;
    cursor: not-allowed;
    /* Não usar pointer-events: none para evitar bloquear outros elementos */
  }

  /* Só aplicar hover em dispositivos com mouse */
  @media (hover: hover) and (pointer: fine) {
    .light-button:hover:not(:disabled) {
      background-color: var(--placeholder-color);
      transform: translateY(-1px);
    }
    
    .light-button.saved:hover:not(:disabled) {
      background-color: rgba(212, 175, 55, 0.3);
    }
  }

  /* Para dispositivos touch, usar :active em vez de :hover */
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
    background-color: var(--card-color) !important; /* Manter fundo branco sempre */
    border-color: var(--gold-color);
    color: var(--gold-color);
  }
  
  /* Manter fundo branco mesmo quando desabilitado - garantir especificidade */
  .light-button.saved:disabled,
  .light-button.saved.disabled,
  .action-button-tag.light-button.saved {
    background-color: var(--card-color) !important;
    opacity: 0.8; /* Opacidade reduzida mas não totalmente opaco */
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
  
  .carousel-chip.checking {
    opacity: 0.6;
    cursor: wait;
    pointer-events: none;
  }
</style>

