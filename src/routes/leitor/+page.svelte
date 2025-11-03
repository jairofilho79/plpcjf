<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/stores';

  // Core and viewer modules
  // Vite will resolve the worker as a URL
  import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
  import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
  import { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
  import 'pdfjs-dist/web/pdf_viewer.css';

  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

  let containerEl: HTMLDivElement | null = null;
  let viewerEl: HTMLDivElement | null = null;

  let eventBus: EventBus;
  let linkService: PDFLinkService;
  let viewer: PDFViewer;
  let cleanup: (() => void) | null = null;

  $: searchParams = new URLSearchParams($page.url.search);
  $: file = searchParams.get('file') ?? '/pdfs/exemplo.pdf';

  async function load(fileUrl: string) {
    const loadingTask = pdfjsLib.getDocument({ url: fileUrl, withCredentials: false });
    const pdfDocument = await loadingTask.promise;
    linkService.setDocument(pdfDocument);
    viewer.setDocument(pdfDocument);
    viewer.currentScaleValue = 'page-fit';
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!viewer) return;
    // Basic shortcuts
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      viewer.currentScale = viewer.currentScale * 1.1;
    } else if ((e.ctrlKey || e.metaKey) && (e.key === '-' )) {
      e.preventDefault();
      viewer.currentScale = viewer.currentScale / 1.1;
    } else if ((e.ctrlKey || e.metaKey) && (e.key === '0')) {
      e.preventDefault();
      viewer.currentScaleValue = 'page-fit';
    } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
      e.preventDefault();
      viewer.container.scrollBy({ top: 80 });
    } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      e.preventDefault();
      viewer.container.scrollBy({ top: -80 });
    }
  }

  onMount(() => {
    if (!containerEl || !viewerEl) return;

    eventBus = new EventBus();
    linkService = new PDFLinkService({ eventBus });
    viewer = new PDFViewer({
      container: containerEl,
      viewer: viewerEl,
      eventBus,
      linkService,
      useOnlyCssZoom: true,
      textLayerMode: 2
    });
    linkService.setViewer(viewer);

    const resize = () => eventBus.dispatch('resize', {});
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', onKeyDown);

    // Basic pinch-zoom via CSS zoom handled by browser when useOnlyCssZoom is true

    load(file);

    cleanup = () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown);
      // No explicit destroy API; let GC collect. Clear container contents.
      if (viewerEl) viewerEl.innerHTML = '';
    };
  });

  onDestroy(() => {
    cleanup?.();
  });

  function zoomIn() {
    if (!viewer) return;
    viewer.currentScale = viewer.currentScale * 1.1;
  }
  function zoomOut() {
    if (!viewer) return;
    viewer.currentScale = viewer.currentScale / 1.1;
  }
  function zoomFit() {
    if (!viewer) return;
    viewer.currentScaleValue = 'page-fit';
  }
</script>

<style>
  .container {
    position: fixed;
    inset: 48px 0 0 0;
    overflow: auto;
    background: #2a2a2a;
  }
  .viewer {
    /* pdf_viewer.css expects this id/class structure */
  }
  .toolbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 48px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    background: #111827;
    color: white;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    z-index: 10;
  }
  .btn {
    padding: 6px 10px;
    border-radius: 6px;
    background: #1f2937;
    border: 1px solid #374151;
    color: white;
    cursor: pointer;
  }
  .btn:hover { background: #374151; }
</style>

<div class="toolbar">
  <button class="btn" on:click={zoomOut}>−</button>
  <button class="btn" on:click={zoomFit}>Ajustar</button>
  <button class="btn" on:click={zoomIn}>+</button>
  <div style="margin-left:auto;opacity:.7">{file}</div>
  <!-- Abra com /leitor?file=/pdfs/exemplo.pdf -->
  <!-- Atalhos: Ctrl/Cmd +/−/0, PgUp/PgDn/↑/↓ -->
  
</div>

<div bind:this={containerEl} class="container pdfViewer">
  <div bind:this={viewerEl} class="viewer pdfViewer"></div>
  <!-- pdfjs-dist css hooks on .pdfViewer and .viewer -->
  
</div>


