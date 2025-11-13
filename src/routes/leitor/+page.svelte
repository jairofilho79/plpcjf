<script lang="ts">
  /// <reference types="@sveltejs/kit" />
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/stores';

  // Type for PDF.js getDocument function
  type PDFJSGetDocument = (options: { url: string; withCredentials?: boolean }) => {
    promise: Promise<{ numPages?: number }>;
  };

  let containerEl: HTMLDivElement | null = null;
  let viewerEl: HTMLDivElement | null = null;

  let eventBus: any;
  let linkService: any;
  let viewer: any;
  let cleanup: (() => void) | null = null;
  let toolbarEl: HTMLDivElement | null = null;
  let toolbarHeight = 60;

  $: searchParams = new URLSearchParams($page.url.search);
  $: file = searchParams.get('file') ?? '/pdfs/exemplo.pdf';
  $: titulo = searchParams.get('titulo') ?? '';
  $: subtitulo = searchParams.get('subtitulo') ?? '';

  let currentPage = 1;
  let totalPages = 0;
  let zoomPercent = 100;
  let lastLoadedFile: string | null = null;
  // Preferred fit mode: 'page-width' or 'page-fit'
  // Load from localStorage if available, otherwise default to 'page-fit'
  let preferredFitMode: 'page-width' | 'page-fit' = (() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pdfPreferredFitMode');
      return (saved === 'page-width' || saved === 'page-fit') ? saved : 'page-fit';
    }
    return 'page-fit';
  })();
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let isLongPressing = false;
  const LONG_PRESS_DURATION = 500; // milliseconds
  // Flag to prevent PDF.js from overwriting our manual page-width calculation
  let isManuallyAdjustingPageWidth = false;
  let pageWidthAdjustTimeout: ReturnType<typeof setTimeout> | null = null;
  
  // Cache the calculated page-width scale to avoid recalculating on every page change
  let cachedPageWidthScale: number | null = null;
  let lastContainerWidth: number = 0;
  
  // Apply CSS class to container based on fit mode
  $: containerClass = preferredFitMode === 'page-fit' ? 'page-fit-mode' : 'page-width-mode';
  
  // Save preferred fit mode to localStorage whenever it changes
  $: if (typeof window !== 'undefined') {
    localStorage.setItem('pdfPreferredFitMode', preferredFitMode);
  }

  // Function to calculate and apply page-width zoom manually
  function applyPageWidthZoom(forceRecalculate = false) {
    if (!viewer || !containerEl || !viewerEl) return;
    if (preferredFitMode !== 'page-width') return;
    
    const currentContainerWidth = containerEl.clientWidth;
    
    // If we have a cached scale and container width hasn't changed, reuse it
    if (!forceRecalculate && cachedPageWidthScale !== null && lastContainerWidth === currentContainerWidth) {
      isManuallyAdjustingPageWidth = true;
      viewer.currentScale = cachedPageWidthScale;
      setTimeout(() => {
        isManuallyAdjustingPageWidth = false;
      }, 100);
      return;
    }
    
    // Get the PDF page's natural width
    const pageView = (viewer as any)._pages?.[(viewer as any).currentPageNumber - 1];
    if (!pageView) return;
    
    // Get the page's NATURAL width at scale 1.0 (not the current scaled width)
    // pageView.width might be scaled, we need the original viewport
    const pdfPage = pageView.pdfPage;
    if (!pdfPage) return;
    
    // Get viewport at scale 1.0 to get the natural dimensions
    const naturalViewport = pdfPage.getViewport({ scale: 1.0 });
    const naturalWidth = naturalViewport.width;
    
    // Calculate available width considering scrollbar
    // clientWidth gives the visible width (inner width - scrollbar if present)
    // offsetWidth gives the total width including scrollbar
    const scrollbarWidth = containerEl.offsetWidth - containerEl.clientWidth;
    
    // Use clientWidth which already excludes the scrollbar width
    let availableWidth = currentContainerWidth;
    
    // Check if scrollbars are overlay (mobile/Mac) or take up space (Windows desktop)
    // On mobile and Mac with overlay scrollbars, offsetWidth === clientWidth even with scroll
    // Only subtract scrollbar width on desktop where scrollbars take up space
    const isMobileOrOverlayScrollbar = window.innerWidth <= 768 || scrollbarWidth === 0;
    
    if (!isMobileOrOverlayScrollbar && scrollbarWidth === 0) {
      // Desktop with scrollbar that will appear - subtract typical width
      availableWidth -= 17;
    }
    
    // Calculate the scale needed to fill the available width exactly
    // Use naturalWidth (at scale 1.0) not pageView.width which may be scaled
    let targetScale = availableWidth / naturalWidth;
    
    if (targetScale > 0) {
      // Set flag to prevent PDF.js from overwriting and prevent reapplication loops
      isManuallyAdjustingPageWidth = true;
      
      // Apply the calculated scale directly (not using currentScaleValue)
      viewer.currentScale = targetScale;
      
      // After PDF.js renders, check if the actual size matches and adjust if needed
      setTimeout(() => {
        if (!viewerEl || !containerEl || !viewer) {
          isManuallyAdjustingPageWidth = false;
          return;
        }
        
        const pageEl = viewerEl.querySelector('.page') as HTMLElement;
        if (pageEl && preferredFitMode === 'page-width') {
          const actualRenderedWidth = pageEl.offsetWidth;
          const desiredWidth = containerEl.clientWidth;
          
          // If the rendered width doesn't match, calculate correction factor
          if (Math.abs(actualRenderedWidth - desiredWidth) > 1) {
            const correctionFactor = desiredWidth / actualRenderedWidth;
            const correctedScale = viewer.currentScale * correctionFactor;
            
            // Apply corrected scale
            viewer.currentScale = correctedScale;
            
            // Cache the corrected scale for reuse
            cachedPageWidthScale = correctedScale;
            lastContainerWidth = currentContainerWidth;
          } else {
            // Cache the initial scale if no correction was needed
            cachedPageWidthScale = viewer.currentScale;
            lastContainerWidth = currentContainerWidth;
          }
        }
        
        isManuallyAdjustingPageWidth = false;
      }, 100);
    }
  }

  // Gesture state for pinch to zoom
  let pinchInitialDistance = 0;
  let pinchInitialScale = 1;
  let isPinching = false;
  
  // Gesture state for single touch navigation
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let hasMoved = false;
  const TOUCH_MOVE_THRESHOLD = 10; // pixels
  const TOUCH_TIME_THRESHOLD = 300; // milliseconds

  async function load(fileUrl: string) {
    const getDocument = (window as any).__pdfjsGetDocument as PDFJSGetDocument | undefined;
    if (!getDocument) return;
    // Avoid duplicate loads of the same file
    if (lastLoadedFile === fileUrl) return;
    const loadingTask = getDocument({ url: fileUrl, withCredentials: false });
    const pdfDocument = await loadingTask.promise;
    linkService.setDocument(pdfDocument);
    viewer.setDocument(pdfDocument);
    totalPages = pdfDocument.numPages ?? 0;
    currentPage = 1;
    lastLoadedFile = fileUrl;
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
      nextPage();
    } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      e.preventDefault();
      prevPage();
    }
  }

  onMount(async () => {
    // Set IS_LEITOR_OFFLINE flag when accessing the leitor route
    if (typeof window !== 'undefined') {
      localStorage.setItem('IS_LEITOR_OFFLINE', 'true');
    }

    if (!containerEl || !viewerEl) return;
    // Measure toolbar height (including border) and keep it updated
    const updateToolbarHeight = () => {
      toolbarHeight = toolbarEl ? toolbarEl.offsetHeight : 60;
      if (containerEl) containerEl.style.top = `${toolbarHeight}px`;
    };
    updateToolbarHeight();
    const ro = new ResizeObserver(updateToolbarHeight);
    if (toolbarEl) ro.observe(toolbarEl);

    // Load core and viewer via URL indirection to avoid Vite optimizer issues
    const [coreUrlMod, viewerUrlMod, workerUrlMod] = await Promise.all([
      import('pdfjs-dist/build/pdf.mjs?url'),
      import('pdfjs-dist/web/pdf_viewer.mjs?url'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    ]);
    const coreMod = await import(/* @vite-ignore */ coreUrlMod.default);
    const viewerNS = await import(/* @vite-ignore */ viewerUrlMod.default);
    // Register on globals for viewer expectations
    // @ts-ignore
    const core = coreMod?.default ?? coreMod;
    // @ts-ignore
    globalThis.pdfjsLib = core;
    // @ts-ignore
    window.pdfjsLib = core;
    // Expose getDocument for load()
    // @ts-ignore
    window.__pdfjsGetDocument = core.getDocument;
    core.GlobalWorkerOptions.workerSrc = workerUrlMod.default;

    const { EventBus, PDFLinkService, PDFSinglePageViewer } = viewerNS as any;

    eventBus = new EventBus();
    linkService = new PDFLinkService({ eventBus });
    viewer = new PDFSinglePageViewer({
      container: containerEl,
      viewer: viewerEl,
      eventBus,
      linkService,
      useOnlyCssZoom: true,
      textLayerMode: 2
    });
    linkService.setViewer(viewer);

    const resize = () => {
      // apenas notifica o viewer para recalcular o layout/textLayer
      eventBus.dispatch('resize', {});
      // Adjust zoom after resize if in page-width mode
      // Force recalculate on resize since container width may have changed
      if (preferredFitMode === 'page-width') {
        // Clear cache since window was resized
        cachedPageWidthScale = null;
        if (pageWidthAdjustTimeout) clearTimeout(pageWidthAdjustTimeout);
        pageWidthAdjustTimeout = setTimeout(() => {
          applyPageWidthZoom(true);
        }, 150);
      }
    };
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', onKeyDown);

    // Add touch gesture handlers
    if (containerEl) {
      containerEl.addEventListener('touchstart', onTouchStart, { passive: false });
      containerEl.addEventListener('touchmove', onTouchMove, { passive: false });
      containerEl.addEventListener('touchend', onTouchEnd, { passive: false });
      containerEl.addEventListener('touchcancel', onTouchEnd, { passive: false });
    }

    // Define escala inicial e sincroniza estados
    eventBus.on('pagesinit', () => {
      if (viewer) {
        if (preferredFitMode === 'page-width') {
          // For page-width, calculate manually instead of using PDF.js algorithm
          // Force recalculate on initial load
          setTimeout(() => {
            applyPageWidthZoom(true);
          }, 100);
        } else {
          viewer.currentScaleValue = preferredFitMode;
        }
      }
    });
    eventBus.on('scalechanging', (e: any) => {
      const newScale = e?.scale ?? (viewer as any)?.currentScale ?? 1;
      zoomPercent = Math.round(newScale * 100);
      
      // If we're manually adjusting, skip to avoid loops
      // Don't reapply automatically - this was causing the zoom to be too large
      if (isManuallyAdjustingPageWidth) {
        return;
      }
    });
    eventBus.on('pagesloaded', (e: any) => {
      totalPages = e?.pagesCount ?? totalPages;
      currentPage = (viewer as any)?.currentPageNumber ?? currentPage;
      // Adjust zoom after pages are loaded if in page-width mode
      if (preferredFitMode === 'page-width') {
        if (pageWidthAdjustTimeout) clearTimeout(pageWidthAdjustTimeout);
        pageWidthAdjustTimeout = setTimeout(() => {
          applyPageWidthZoom();
        }, 150);
      }
    });
    eventBus.on('pagechanging', (e: any) => {
      currentPage = e?.pageNumber ?? currentPage;
      // Adjust zoom when page changes if in page-width mode
      // Don't force recalculate - reuse cached scale
      if (preferredFitMode === 'page-width') {
        if (pageWidthAdjustTimeout) clearTimeout(pageWidthAdjustTimeout);
        pageWidthAdjustTimeout = setTimeout(() => {
          applyPageWidthZoom(false);
        }, 50);
      }
    });

    await load(file);

    cleanup = () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown);
      if (containerEl) {
        containerEl.removeEventListener('touchstart', onTouchStart);
        containerEl.removeEventListener('touchmove', onTouchMove);
        containerEl.removeEventListener('touchend', onTouchEnd);
        containerEl.removeEventListener('touchcancel', onTouchEnd);
      }
      try { if (toolbarEl) ro.unobserve(toolbarEl); } catch {}
      // No explicit destroy API; let GC collect. Clear container contents.
      if (viewerEl) viewerEl.innerHTML = '';
    };
  });

  onDestroy(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    if (pageWidthAdjustTimeout) {
      clearTimeout(pageWidthAdjustTimeout);
      pageWidthAdjustTimeout = null;
    }
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
    if (!viewer || isLongPressing) return;
    // Reset to the preferred fit mode
    if (preferredFitMode === 'page-width') {
      // For page-width, calculate manually instead of using PDF.js algorithm
      // Reuse cached scale if available
      setTimeout(() => {
        applyPageWidthZoom(false);
      }, 100);
    } else {
      viewer.currentScaleValue = preferredFitMode;
    }
  }
  
  function toggleFitMode() {
    preferredFitMode = preferredFitMode === 'page-fit' ? 'page-width' : 'page-fit';
    if (viewer) {
      if (preferredFitMode === 'page-width') {
        // For page-width, calculate manually instead of using PDF.js algorithm
        // This prevents PDF.js from overwriting our calculation
        // Force recalculate when switching to page-width mode
        setTimeout(() => {
          applyPageWidthZoom(true);
        }, 100);
      } else {
        // Clear cache when switching away from page-width
        cachedPageWidthScale = null;
        viewer.currentScaleValue = preferredFitMode;
      }
    }
  }
  
  function handleZoomFitMouseDown(e: MouseEvent) {
    isLongPressing = false;
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      isLongPressing = true;
      toggleFitMode();
      longPressTimer = null;
    }, LONG_PRESS_DURATION);
  }
  
  function handleZoomFitMouseUp() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    // Reset flag after a short delay to allow click handler to check
    setTimeout(() => {
      isLongPressing = false;
    }, 50);
  }
  
  function handleZoomFitMouseLeave() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    isLongPressing = false;
  }
  
  function handleZoomFitTouchStart(e: TouchEvent) {
    isLongPressing = false;
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      isLongPressing = true;
      toggleFitMode();
      longPressTimer = null;
    }, LONG_PRESS_DURATION);
    // Don't prevent default to allow normal click behavior
  }
  
  function handleZoomFitTouchEnd() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    // Reset flag after a short delay
    setTimeout(() => {
      isLongPressing = false;
    }, 50);
  }
  function nextPage() {
    if (!viewer) return;
    const maxPages = totalPages || (viewer as any)._pagesCount || 1;
    const next = Math.min(((viewer as any).currentPageNumber ?? 1) + 1, maxPages);
    (viewer as any).currentPageNumber = next;
  }
  function prevPage() {
    if (!viewer) return;
    const prev = Math.max(((viewer as any).currentPageNumber ?? 1) - 1, 1);
    (viewer as any).currentPageNumber = prev;
  }

  // Calculate distance between two touch points
  function getTouchDistance(touch1: Touch, touch2: Touch): number {
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Handle touch start for gestures
  function onTouchStart(e: TouchEvent) {
    if (!viewer || !containerEl) return;
    
    const touches = e.touches;
    
    // Pinch to zoom: 2 touches
    if (touches.length === 2) {
      isPinching = true;
      pinchInitialDistance = getTouchDistance(touches[0], touches[1]);
      pinchInitialScale = viewer.currentScale;
      e.preventDefault();
      return;
    }
    
    // Single touch for navigation
    if (touches.length === 1) {
      touchStartX = touches[0].clientX;
      touchStartY = touches[0].clientY;
      touchStartTime = Date.now();
      hasMoved = false;
    }
  }

  // Handle touch move for gestures
  function onTouchMove(e: TouchEvent) {
    if (!viewer || !containerEl) return;
    
    const touches = e.touches;
    
    // Pinch to zoom: 2 touches
    if (touches.length === 2 && isPinching) {
      const currentDistance = getTouchDistance(touches[0], touches[1]);
      const scaleRatio = currentDistance / pinchInitialDistance;
      const newScale = pinchInitialScale * scaleRatio;
      
      // Clamp scale to reasonable bounds (0.25x to 4x)
      const clampedScale = Math.max(0.25, Math.min(4, newScale));
      viewer.currentScale = clampedScale;
      
      e.preventDefault();
      return;
    }
    
    // Single touch: check if it moved significantly
    if (touches.length === 1 && !isPinching) {
      const dx = Math.abs(touches[0].clientX - touchStartX);
      const dy = Math.abs(touches[0].clientY - touchStartY);
      
      if (dx > TOUCH_MOVE_THRESHOLD || dy > TOUCH_MOVE_THRESHOLD) {
        hasMoved = true;
      }
    }
  }

  // Handle touch end for gestures
  function onTouchEnd(e: TouchEvent) {
    if (!viewer || !containerEl) return;
    
    const touches = e.touches;
    
    // End pinch gesture
    if (isPinching && touches.length < 2) {
      isPinching = false;
      pinchInitialDistance = 0;
      pinchInitialScale = 1;
      e.preventDefault();
      return;
    }
    
    // Single touch navigation: check if it was a tap (not a scroll)
    if (touches.length === 0 && !isPinching && !hasMoved) {
      const touchDuration = Date.now() - touchStartTime;
      
      // Only process if it was a quick tap (not a long press or scroll)
      if (touchDuration < TOUCH_TIME_THRESHOLD) {
        const containerRect = containerEl.getBoundingClientRect();
        const containerWidth = containerRect.width;
        const relativeX = touchStartX - containerRect.left;
        const quarterWidth = containerWidth / 4;
        
        // First quarter (0-25%): previous page
        if (relativeX < quarterWidth) {
          prevPage();
        }
        // Last quarter (75-100%): next page
        else if (relativeX > containerWidth - quarterWidth) {
          nextPage();
        }
      }
    }
    
    // Reset state
    touchStartX = 0;
    touchStartY = 0;
    touchStartTime = 0;
    hasMoved = false;
  }
  // Reload if the file query param changes, but only when it actually changes
  $: if (viewer && file && file !== lastLoadedFile) {
    Promise.resolve().then(() => load(file));
  }
</script>

<svelte:head>
  <link rel="stylesheet" href="/pdfjs/web/pdf_viewer.css" />
</svelte:head>

<style>
  /* Ensure body and html don't have margins/padding that could create gaps */
  :global(body), :global(html) {
    margin: 0;
    padding: 0;
    overflow-x: hidden;
  }

  .container {
    position: fixed;
    /* top is set dynamically via JS to match toolbar height including border */
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    overflow-y: auto;
    overflow-x: auto;
    background: #2a2a2a;
    width: 100vw;
    max-width: 100vw;
    z-index: 1; /* ensure it overlays page background */
    touch-action: pan-x pan-y; /* Allow scrolling but prevent default pinch */
  }

  /* Viewer base width equals viewport; zooms can overflow horizontally for scroll */
  .pdfViewer {
    width: 100%;
    box-sizing: border-box;
  }
  
  /* Remove default PDF.js page margins to eliminate gray spaces on sides */
  :global(.pdfViewer .page) {
    margin: 0 !important;
    border: none !important;
  }
  
  :global(.pdfViewer) {
    padding: 0 !important;
  }
  
  /* Center PDF pages in page-fit mode with auto margins */
  .container.page-fit-mode :global(.pdfViewer .page) {
    margin: 0 auto !important;
  }
  
  /* No horizontal margin in page-width mode (fill entire width) */
  .container.page-width-mode :global(.pdfViewer .page) {
    margin: 0 !important;
  }
  /* Removed unused nested selector to satisfy build warnings */
  .toolbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 56px;
    display: grid;
    grid-template-columns: 1fr repeat(6, max-content);
    grid-template-rows: repeat(3, 1fr);
    column-gap: 8px;
    padding: 0 calc(12px + env(safe-area-inset-right)) 0 calc(12px + env(safe-area-inset-left));
    background: var(--background-color);
    color: var(--text-light);
    border-bottom: 4px solid var(--gold-color);
    z-index: 1000;
    align-items: center;
    box-sizing: border-box;
    width: 100%;
    max-width: 100vw;
    overflow: hidden;
  }
  .btn {
    padding: 10px 12px;
    border-radius: 6px;
    background: var(--btn-background-color);
    border: 1px solid rgba(255,255,255,0.12);
    color: var(--text-light);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .btn:hover { filter: brightness(1.05); }
  .btn .icon {
    width: 20px;
    height: 20px;
    stroke: currentColor;
  }
  .title-wrap { display: flex; flex-direction: column; justify-content: center; min-width: 0; grid-column: 1; grid-row: 2 / 4; }
  .title-main {
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
  }
  .title-sub {
    font-size: 12px;
    opacity: .8;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
  }
  .indicator { opacity: .9; }
  .brand {
    grid-column: 1;
    grid-row: 1;
    white-space: nowrap;
    font-weight: 700;
    font-family: "EB Garamond", Garamond, Georgia, serif; /* similar ao header */
    font-size: 1.5rem; /* ~text-3xl no contexto da barra */
    line-height: 1;
    color: var(--placeholder-color);
    letter-spacing: .03em; /* tracking-wide */
    text-shadow: 1px 1px 2px rgba(0,0,0,0.3);
  }

  .indicator { display: flex; align-items: center; gap: 4px; min-width: 56px; justify-content: center; }
  .indicator .current { font-variant-numeric: tabular-nums; }
  .indicator .total { opacity: .9; }

  /* Grid placements for controls spanning all rows */
  .btn.prev { grid-column: 2; grid-row: 1 / 4; align-self: center; }
  .indicator { grid-column: 3; grid-row: 1 / 4; align-self: center; }
  .btn.next { grid-column: 4; grid-row: 1 / 4; align-self: center; }
  .btn.zoom-minus { grid-column: 5; grid-row: 1 / 4; align-self: center; }
  .btn.zoom-fit { grid-column: 6; grid-row: 1 / 4; align-self: center; position: relative; }
  
  .zoom-fit-indicator {
    position: absolute;
    pointer-events: none;
    transition: all 0.3s ease;
  }
  
  .zoom-fit-indicator.bar {
    background: white;
    border-radius: 1px;
  }
  
  /* Page-fit: horizontal bars (top and bottom) */
  .btn.zoom-fit.page-fit .zoom-fit-indicator.page-fit.top,
  .btn.zoom-fit.page-fit .zoom-fit-indicator.page-fit.bottom {
    opacity: 1;
  }
  
  .btn.zoom-fit.page-fit .zoom-fit-indicator.page-fit.top {
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    width: 20px;
    height: 2px;
  }
  
  .btn.zoom-fit.page-fit .zoom-fit-indicator.page-fit.bottom {
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    width: 20px;
    height: 2px;
  }
  
  /* Page-width: vertical bars (left and right) */
  .btn.zoom-fit.page-width .zoom-fit-indicator.page-width.left,
  .btn.zoom-fit.page-width .zoom-fit-indicator.page-width.right {
    opacity: 1;
  }
  
  .btn.zoom-fit.page-width .zoom-fit-indicator.page-width.left {
    left: 8px;
    top: 50%;
    transform: translateY(-50%);
    width: 2px;
    height: 20px;
  }
  
  .btn.zoom-fit.page-width .zoom-fit-indicator.page-width.right {
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    width: 2px;
    height: 20px;
  }
  
  /* Hide bars when not in corresponding mode */
  .btn.zoom-fit.page-fit .zoom-fit-indicator.page-width.left,
  .btn.zoom-fit.page-fit .zoom-fit-indicator.page-width.right {
    opacity: 0;
    width: 0;
    height: 0;
  }
  
  .btn.zoom-fit.page-width .zoom-fit-indicator.page-fit.top,
  .btn.zoom-fit.page-width .zoom-fit-indicator.page-fit.bottom {
    opacity: 0;
    width: 0;
    height: 0;
  }
  .btn.zoom-plus { grid-column: 7; grid-row: 1 / 4; align-self: center; }

  /* Wide screens: let content breathe */
  @media (min-width: 1024px) {
    .brand { font-size: 1.75rem; }
    .btn { padding: 12px 14px; }
    .title-main { font-size: 1rem; }
  }

  /* Tablet+ layout: brand in its own column, title/subtitle to the right */
  @media (min-width: 768px) {
    .toolbar {
      grid-template-columns: auto 1fr repeat(6, max-content);
    }
    .brand { grid-column: 1; grid-row: 1 / 4; align-self: center; }
    .title-wrap { grid-column: 2; grid-row: 1 / 4; }
    /* shift controls one column to the right */
    .btn.prev { grid-column: 3; }
    .indicator { grid-column: 4; }
    .btn.next { grid-column: 5; }
    .btn.zoom-minus { grid-column: 6; }
    .btn.zoom-fit { grid-column: 7; }
    .btn.zoom-plus { grid-column: 8; }
  }

  /* Compact screens: stack title under PLPC, stack indicator, hide +/- */
  @media (max-width: 600px) {
    .btn.zoom-minus, .btn.zoom-plus { display: none; }
  }
</style>

<div class="toolbar" bind:this={toolbarEl}>
  <div class="brand">PLPC</div>

  <button class="btn prev" on:click={prevPage} aria-label="Página anterior">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
      <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
    </svg>
  </button>
  <div class="indicator" aria-label="Página atual e total">
    <span class="current">{currentPage}</span>
    <span class="total">/ {totalPages}</span>
  </div>
  <button class="btn next" on:click={nextPage} aria-label="Próxima página">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
      <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
    </svg>
  </button>

  <button class="btn zoom-minus" on:click={zoomOut} aria-label="Diminuir zoom">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
      <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14" />
    </svg>
  </button>

  <button 
    class="btn zoom-fit" 
    class:page-fit={preferredFitMode === 'page-fit'}
    class:page-width={preferredFitMode === 'page-width'}
    on:click={zoomFit} 
    on:mousedown={handleZoomFitMouseDown}
    on:mouseup={handleZoomFitMouseUp}
    on:mouseleave={handleZoomFitMouseLeave}
    on:touchstart={handleZoomFitTouchStart}
    on:touchend={handleZoomFitTouchEnd}
    aria-label="Ajustar zoom"
  >
    {zoomPercent}%
    <!-- Visual indicators for fit mode -->
    <div class="zoom-fit-indicator bar page-fit top"></div>
    <div class="zoom-fit-indicator bar page-fit bottom"></div>
    <div class="zoom-fit-indicator bar page-width left"></div>
    <div class="zoom-fit-indicator bar page-width right"></div>
  </button>

  <button class="btn zoom-plus" on:click={zoomIn} aria-label="Aumentar zoom">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  </button>

  <div class="title-wrap">
    {#if titulo}
      <div class="title-main" title={titulo}>{titulo}</div>
    {/if}
    {#if subtitulo}
      <div class="title-sub" title={subtitulo}>{subtitulo}</div>
    {/if}
  </div>

  <!-- Abra com /leitor?file=/pdfs/exemplo.pdf&titulo=Exemplo&subtitulo=Sub -->
  <!-- Atalhos: Ctrl/Cmd +/−/0, PgUp/PgDn/↑/↓ -->
  
</div>

<div id="viewerContainer" bind:this={containerEl} class="container {containerClass}">
  <div bind:this={viewerEl} class="viewer pdfViewer"></div>
  <!-- pdfjs-dist css hooks on .pdfViewer and .viewer -->
  
</div>


