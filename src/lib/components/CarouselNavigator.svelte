<script>
  import { createEventDispatcher } from 'svelte';
  import { goto } from '$app/navigation';
  import GestureButton from '$lib/components/GestureButton.svelte';
  import { getPdfRelPath } from '$lib/utils/pathUtils';
  import { savedPlaylists } from '$lib/stores/savedPlaylists';

  export let currentFile = '';
  export let carousel = [];

  const dispatch = createEventDispatcher();

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
  $: nextPdf =
    currentIndex >= 0 && carousel.length > 0
      ? carousel[(currentIndex + 1) % carousel.length]
      : null;

  $: prevPdf =
    currentIndex >= 0 && carousel.length > 0
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

  /** Toque longo: abre a página de listas na visualização da playlist atual do carrossel. */
  function handleVerListaLongPress() {
    const pdfIds = (carousel || []).map((l) => l.pdfId).filter(Boolean);
    if (pdfIds.length === 0) return;

    const existing = savedPlaylists.findPlaylistByPdfIds(pdfIds);
    const id = existing ? existing.id : savedPlaylists.savePlaylist(pdfIds);
    goto(`/listas?viewId=${encodeURIComponent(id)}`, { replaceState: true, noScroll: true });
  }
</script>

<div class="carousel-navigator">
  <GestureButton
    on:click={handleNext}
    on:longpress={handleVerListaLongPress}
    longPressDuration={500}
    maxMovement={28}
    cancelLongPressOnVerticalScroll={false}
    usePointerCaptureWhilePressed={true}
    visualFeedback={true}
    hapticFeedback={true}
    preventDefault={true}
    ariaLabel="Lista: avançar para o próximo PDF. Toque longo abre a visualização da lista atual."
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
</div>

<style>
  .carousel-navigator {
    display: contents;
  }

  .carousel-navigator :global(.gesture-button-wrapper) {
    touch-action: none;
  }

  .carousel-control {
    height: 36px; /* sobrescrito pelo --tbtn-h da toolbar quando usado nela */
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    padding: 0 10px;
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

  /* Ocultar rótulo em smartphone, mostrar em tablet+ */
  @media (max-width: 767px) {
    .carousel-label { display: none; }
  }
  @media (min-width: 768px) {
    .carousel-label { display: inline; }
  }
</style>
