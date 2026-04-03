<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import GestureButton from '$lib/components/GestureButton.svelte';
  import { getPdfRelPath } from '$lib/utils/pathUtils';
  import { savedPlaylists } from '$lib/stores/savedPlaylists';

  export let currentFile = '';
  export let carousel = [];

  const dispatch = createEventDispatcher();

  let listasMenuOpen = false;

  function closeListasMenu() {
    listasMenuOpen = false;
  }

  function openListasMenu() {
    listasMenuOpen = true;
  }

  onMount(() => {
    if (!browser) return;
    const onEscape = (e) => {
      if (e.key === 'Escape') closeListasMenu();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  });
  
  // Normalize file path for comparison (remove leading slash)
  function normalizeFilePath(file) {
    if (!file) return '';
    return file.replace(/^\/+/, '').trim();
  }
  
  // Find current index in carousel
  $: currentIndex = (() => {
    if (!currentFile || !carousel || carousel.length === 0) return -1;
    
    const normalizedCurrent = normalizeFilePath(currentFile);
    
    // If file starts with /pdfs/, it's not in the carousel (example PDF)
    if (normalizedCurrent.startsWith('pdfs/')) {
      return -1;
    }
    
    // Find matching carousel item
    for (let i = 0; i < carousel.length; i++) {
      const louvorPath = getPdfRelPath(carousel[i]);
      if (louvorPath && normalizeFilePath(louvorPath) === normalizedCurrent) {
        return i;
      }
    }
    
    return -1;
  })();
  
  // Calculate next and previous PDFs (circular navigation)
  $: nextPdf = currentIndex >= 0 && carousel.length > 0
    ? carousel[(currentIndex + 1) % carousel.length]
    : null;
  
  $: prevPdf = currentIndex >= 0 && carousel.length > 0
    ? carousel[(currentIndex - 1 + carousel.length) % carousel.length]
    : null;
  
  // Check if button should be disabled
  $: isDisabled = carousel.length === 0 || currentIndex < 0;
  
  function handleNext() {
    if (nextPdf && !isDisabled) {
      dispatch('navigate', { louvor: nextPdf, direction: 'next' });
    }
  }
  
  function handlePrevious() {
    if (prevPdf && !isDisabled) {
      dispatch('navigate', { louvor: prevPdf, direction: 'previous' });
    }
  }
  
  function handleVerListaFromMenu() {
    const pdfIds = (carousel || []).map((l) => l.pdfId).filter(Boolean);
    if (pdfIds.length === 0) return;

    const existing = savedPlaylists.findPlaylistByPdfIds(pdfIds);
    const id = existing ? existing.id : savedPlaylists.savePlaylist(pdfIds);
    closeListasMenu();
    goto(`/listas?viewId=${encodeURIComponent(id)}`);
  }

  function handleIrParaListasFromMenu() {
    closeListasMenu();
    goto('/listas');
  }
</script>

<div class="carousel-navigator">
  <div class="carousel-navigator-inner">
    <GestureButton
      on:click={handleNext}
      on:longpress={openListasMenu}
      longPressDuration={500}
      visualFeedback={true}
      hapticFeedback={true}
      preventDefault={true}
      ariaLabel="Lista: avançar para o próximo PDF. Toque longo abre o menu."
    >
      <div class="carousel-control" class:disabled={isDisabled}>
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        fill="none" 
        viewBox="0 0 24 24" 
        stroke-width="1.5" 
        stroke="currentColor" 
        class="icon"
        aria-hidden="true"
      >
        <path 
          stroke-linecap="round" 
          stroke-linejoin="round" 
          d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" 
        />
      </svg>
      <span class="carousel-label">Lista</span>
      </div>
    </GestureButton>
    {#if listasMenuOpen}
      <button
        type="button"
        class="listas-menu-backdrop"
        aria-label="Fechar menu"
        tabindex="-1"
        on:pointerdown|stopPropagation={closeListasMenu}
      ></button>
      <div class="listas-menu" role="menu" aria-label="Ações da lista">
        <button
          type="button"
          class="listas-menu-item"
          class:listas-menu-item-disabled={!carousel || carousel.length === 0}
          role="menuitem"
          disabled={!carousel || carousel.length === 0}
          on:click={handleVerListaFromMenu}
        >
          Ver Lista
        </button>
        <div class="listas-menu-divider" role="separator"></div>
        <button
          type="button"
          class="listas-menu-item"
          role="menuitem"
          on:click={handleIrParaListasFromMenu}
        >
          Ir para listas
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .carousel-navigator {
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    height: 100%;
  }

  .carousel-navigator-inner {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .listas-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1001;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    cursor: default;
  }

  .listas-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 1002;
    min-width: 11rem;
    padding: 0.35rem 0;
    margin: 0;
    background-color: var(--btn-background-color);
    border: 2px solid var(--gold-color);
    border-radius: 0.375rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  }

  .listas-menu-item {
    display: block;
    width: 100%;
    margin: 0;
    padding: 0.65rem 1rem;
    border: none;
    background: transparent;
    color: var(--text-light);
    font-size: 0.875rem;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.15s ease, filter 0.15s ease;
  }

  .listas-menu-item:hover:not(:disabled) {
    background-color: var(--title-color);
    filter: brightness(1.08);
  }

  .listas-menu-item-disabled,
  .listas-menu-item:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    filter: none;
  }

  .listas-menu-divider {
    height: 0;
    margin: 0.25rem 0;
    border: none;
    border-top: 2px solid var(--gold-color);
  }
  
  .carousel-control {
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    padding: 0 12px;
    border-radius: 6px;
    background: var(--btn-background-color);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: var(--text-light);
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    transition: filter 0.2s ease, opacity 0.2s ease;
    box-sizing: border-box;
    width: fit-content;
    max-width: 120px;
  }
  
  .carousel-control:hover {
    filter: brightness(1.05);
  }
  
  .carousel-control.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .icon {
    width: 20px;
    height: 20px;
    stroke: currentColor;
    flex-shrink: 0;
  }
  
  .carousel-label {
    font-size: 0.875rem;
    font-weight: 500;
    white-space: nowrap;
  }
  
  /* Hide label on mobile, show on tablet+ */
  @media (max-width: 767px) {
    .carousel-label {
      display: none;
    }
  }
  
  /* Show label on tablet+ */
  @media (min-width: 768px) {
    .carousel-label {
      display: inline;
    }
  }
</style>

