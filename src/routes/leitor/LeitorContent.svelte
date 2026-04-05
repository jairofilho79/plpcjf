<script lang="ts">
  /// <reference types="@sveltejs/kit" />
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import GestureButton from '$lib/components/GestureButton.svelte';
  import CarouselNavigator from '$lib/components/CarouselNavigator.svelte';
  import { carousel } from '$lib/stores/carousel';
  import { getPdfRelPath } from '$lib/utils/pathUtils';
  import { loadPdfJsComplete, loadPdfJsViewer } from '$lib/utils/pdfjsLoader';
  import { clearPdfFromSwCache } from '$lib/utils/swRegistration';

  // Type for PDF.js getDocument function
  type PDFJSGetDocument = (options: { url: string; withCredentials?: boolean }) => {
    promise: Promise<{ numPages?: number }>;
  };

  let containerEl: HTMLDivElement | null = null;
  let viewerEl: HTMLDivElement | null = null;
  let keyboardFocusEl: HTMLTextAreaElement | null = null;
  let keyboardActivated = false;

  let eventBus: any;
  let linkService: any;
  let viewer: any;
  let cleanup: (() => void) | null = null;
  let toolbarEl: HTMLDivElement | null = null;
  let toolbarHeight = 60;
  // Estado para controlar visibilidade da barra superior (fullscreen)
  // Sempre começa como true (barra visível) quando a página é carregada
  let isToolbarVisible = true;

  export let file: string;
  export let titulo: string;
  export let subtitulo: string;
  export let skipValidation: boolean;

  const dispatch = createEventDispatcher<{ remountLayout: void }>();

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
  // Flag to prevent PDF.js from overwriting our manual page-width calculation
  let isManuallyAdjustingPageWidth = false;
  let pageWidthAdjustTimeout: ReturnType<typeof setTimeout> | null = null;
  
  // Cache the calculated page-width scale to avoid recalculating on every page change
  let cachedPageWidthScale: number | null = null;
  let lastContainerWidth: number = 0;
  
  // PDF validation states
  let pdfLoading = false;
  let pdfError: string | null = null;
  let retryCount = 0;
  const MAX_RETRIES = 2;
  
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
  const ENABLE_PINCH_FOCAL_FIX = true;
  let pinchInitialDistance = 0;
  let pinchInitialScale = 1;
  let pinchStartFocalX = 0;
  let pinchStartFocalY = 0;
  let pinchStartContentX = 0;
  let pinchStartContentY = 0;
  let isPinching = false;
  
  // Gesture state for single touch navigation
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let hasMoved = false;
  const TOUCH_MOVE_THRESHOLD = 10; // pixels
  const TOUCH_TIME_THRESHOLD = 300; // ms

  const ENABLE_SWIPE_PAGE_NAV = true;
  const SWIPE_MIN_DISTANCE_PX = 80;
  const SWIPE_MAX_DURATION_MS = 400;
  const SWIPE_HORIZONTAL_RATIO = 1.4;
  const SWIPE_MIN_VELOCITY_PX_MS = 0.35;
  const SWIPE_COOLDOWN_MS = 250;
  const SWIPE_ZOOM_STRICT_SCALE = 1.15;
  const SWIPE_EXTRA_DISTANCE_WHEN_ZOOMED_PX = 20;
  const SWIPE_EXTRA_VELOCITY_WHEN_ZOOMED = 0.1;

  let swipePageStartX = 0;
  let swipePageStartY = 0;
  let swipePageStartTime = 0;
  let swipePageGestureValid = false;
  let lastSwipePageTurnAt = 0;

  // Load PDF directly without validation (optimization: skip validation if already validated)
  async function loadDirectly(fileUrl: string) {
    const getDocument = (window as any).__pdfjsGetDocument as PDFJSGetDocument | undefined;
    if (!getDocument) return;
    
    // Avoid duplicate loads of the same file
    if (lastLoadedFile === fileUrl && !pdfError) return;
    
    pdfLoading = true;
    pdfError = null;
    
    try {
      // Try to load directly - Service Worker will intercept and serve from cache if available
      const loadingTask = getDocument({ url: fileUrl, withCredentials: false });
      const pdfDocument = await loadingTask.promise;
      linkService.setDocument(pdfDocument);
      viewer.setDocument(pdfDocument);
      totalPages = pdfDocument.numPages ?? 0;
      currentPage = 1;
      lastLoadedFile = fileUrl;
      retryCount = 0;
      pdfError = null;
    } catch (error) {
      console.warn('[Leitor] Direct load failed, falling back to validation:', error);
      // If direct load fails, fall back to full validation
      await load(fileUrl);
    } finally {
      pdfLoading = false;
    }
  }

  async function load(fileUrl: string) {
    const getDocument = (window as any).__pdfjsGetDocument as PDFJSGetDocument | undefined;
    if (!getDocument) return;
    
    // Avoid duplicate loads of the same file
    if (lastLoadedFile === fileUrl && !pdfError) return;
    
    pdfLoading = true;
    pdfError = null;
    
    // Extract PDF path from URL - usar caminho original (NÃO normalizar)
    // O PDF deve ser carregado e validado usando o caminho original (preserva case e acentos)
    const urlObj = new URL(fileUrl, window.location.origin);
    const pdfPath = urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
    const originalFullUrl = new URL(`/${pdfPath}`, window.location.origin).href;
    
    try {
      
      // VALIDAÇÃO: Check if PDF is available in cache using original path (no normalization)
      const { validatePdfAvailability } = await import('$lib/utils/pdfValidation');
      const { downloadPDFsViaSW } = await import('$lib/utils/swRegistration');
      
      const validation = await validatePdfAvailability(pdfPath);
      
      if (!validation.available) {
        // Try to download automatically if online
        if (validation.needsDownload && navigator.onLine && retryCount < MAX_RETRIES) {
          retryCount++;
          console.log(`[Leitor] PDF não encontrado no cache, tentando baixar... (tentativa ${retryCount})`);
          
          // Show feedback
          pdfError = 'Baixando PDF...';
          
          try {
            // Download via Service Worker
            await downloadPDFsViaSW([validation.url], 1, (progress: any) => {
              if (progress.completed > 0) {
                pdfError = null;
                // Try to load again after download
                setTimeout(() => load(fileUrl), 500);
                return;
              }
            });
          } catch (downloadErr) {
            console.error('[Leitor] Download automático falhou:', downloadErr);
            pdfError = 'Erro ao baixar PDF. Verifique sua conexão.';
            
            // FASE 2: Invalidar cache de validação quando download falha
            try {
              const { clearAllValidationCache } = await import('$lib/utils/pdfValidation');
              clearAllValidationCache();
            } catch (err) {
              console.warn('[Leitor] Erro ao invalidar cache de validação:', err);
            }
            
            pdfLoading = false;
            return;
          }
          return;
        } else {
          // PDF not available and cannot be downloaded
          pdfError = 'PDF não está disponível offline. Por favor, baixe primeiro na página de configuração offline.';
          pdfLoading = false;
          return;
        }
      }
      
      // PDF is available, load using ORIGINAL URL (not normalized) to preserve exact path from pdfId
      const loadingTask = getDocument({ url: originalFullUrl, withCredentials: false });
      const pdfDocument = await loadingTask.promise;
      linkService.setDocument(pdfDocument);
      viewer.setDocument(pdfDocument);
      totalPages = pdfDocument.numPages ?? 0;
      currentPage = 1;
      lastLoadedFile = fileUrl;
      retryCount = 0; // Reset retry count on success
      pdfError = null;
    } catch (error) {
      console.error('[Leitor] Erro ao carregar PDF:', error);

      // Detect InvalidPDFException and force SW to drop cached entry,
      // so the next attempts will refetch from the network (R2)
      const errorName = (error as any)?.name || '';
      const errorMessage = String(error || '');
      const isInvalidPdf =
        errorName === 'InvalidPDFException' ||
        errorMessage.includes('InvalidPDF') ||
        errorMessage.includes('Invalid PDF');

      if (isInvalidPdf && typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          console.warn('[Leitor] Invalid PDF detected, clearing SW cache for refetch:', pdfPath);
          await clearPdfFromSwCache(pdfPath);
        } catch (clearErr) {
          console.warn('[Leitor] Falha ao limpar entrada de cache do PDF no SW:', clearErr);
        }
      }
      
      // Try fallback variations if original URL failed
      // Try variations of the URL (all using original path, no normalization)
      const urlVariations = [
        originalFullUrl, // Already tried, but keep for reference
        fileUrl, // Original URL from parameter
        new URL(`/${pdfPath}`, window.location.origin).href, // Original path with leading slash
        new URL(pdfPath, window.location.origin).href, // Original path without leading slash
        pdfPath.startsWith('/') ? pdfPath : `/${pdfPath}`, // Original path with/without slash
        pdfPath // Original path as-is
      ];
      
      // Remove duplicates and already tried URL
      const uniqueVariations = [...new Set(urlVariations)].filter(url => url !== originalFullUrl);
      
      let loadedSuccessfully = false;
      for (const variationUrl of uniqueVariations) {
        try {
          console.log(`[Leitor] Tentando variação de URL: ${variationUrl}`);
          const loadingTask = getDocument({ url: variationUrl, withCredentials: false });
          const pdfDocument = await loadingTask.promise;
          linkService.setDocument(pdfDocument);
          viewer.setDocument(pdfDocument);
          totalPages = pdfDocument.numPages ?? 0;
          currentPage = 1;
          lastLoadedFile = variationUrl;
          retryCount = 0;
          pdfError = null;
          loadedSuccessfully = true;
          console.log(`[Leitor] PDF carregado com sucesso usando variação: ${variationUrl}`);
          break;
        } catch (variationError) {
          // Continue to next variation
          continue;
        }
      }
      
      if (!loadedSuccessfully) {
        pdfError = 'Erro ao carregar PDF. Verifique se o arquivo está disponível.';
        
        // FASE 2: Invalidar cache de validação quando há erro definitivo no leitor
        // Como não temos pdfId aqui, invalidamos todo o cache para forçar revalidação
        try {
          const { clearAllValidationCache } = await import('$lib/utils/pdfValidation');
          clearAllValidationCache();
        } catch (err) {
          console.warn('[Leitor] Erro ao invalidar cache de validação:', err);
        }
        
        // Try retry if still have attempts
        if (retryCount < MAX_RETRIES && navigator.onLine) {
          retryCount++;
          setTimeout(() => load(fileUrl), 2000);
          return;
        }
      }
    } finally {
      pdfLoading = false;
    }
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
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      nextPage();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      prevPage();
    }
  }

  onMount(async () => {
    // Set IS_LEITOR_OFFLINE flag when accessing the leitor route
    if (typeof window !== 'undefined') {
      localStorage.setItem('IS_LEITOR_OFFLINE', 'true');
    }
    
    // Sempre garantir que a barra esteja visível ao carregar a página
    isToolbarVisible = true;
    
    // Add storage event listener for carousel synchronization between tabs
    let storageHandler: ((e: StorageEvent) => void) | null = null;
    if (typeof window !== 'undefined') {
      storageHandler = (e: StorageEvent) => {
        if (e.key === 'carouselLouvores') {
          try {
            const newCarousel = e.newValue ? JSON.parse(e.newValue) : [];
            carousel.setCarousel(newCarousel);
          } catch (err) {
            console.warn('[Leitor] Failed to sync carousel from storage:', err);
          }
        }
      };
      
      window.addEventListener('storage', storageHandler);
    }

    if (!containerEl || !viewerEl) return;
    const updateToolbarHeight = () => {
      if (isToolbarVisible) {
        toolbarHeight = toolbarEl ? toolbarEl.offsetHeight : 60;
      } else {
        toolbarHeight = 0;
      }
      if (containerEl) containerEl.style.top = `${toolbarHeight}px`;
    };
    updateToolbarHeight();
    const ro = new ResizeObserver(updateToolbarHeight);
    if (toolbarEl) ro.observe(toolbarEl);

    // Carregar PDF.js completo (garantir viewer disponível antes de inicializar)
    // Mostrar feedback visual durante carregamento
    pdfLoading = true;
    
    let core, viewerNS, workerUrl;
    
    try {
      // Usar módulo centralizado para carregar PDF.js completo
      const preloaded = await loadPdfJsComplete({ showProgress: true }) as any;
      
      if (preloaded) {
        const isPartial = preloaded.partial;
        console.log('[Leitor] PDF.js carregado', isPartial ? '(parcial, carregando viewer...)' : '(completo)');
        
        core = preloaded.core;
        workerUrl = preloaded.workerUrl;
        
        // Se viewer não foi carregado, carregar agora
        if (!preloaded.viewer) {
          console.log('[Leitor] Carregando viewer...');
          viewerNS = await loadPdfJsViewer();
        } else {
          viewerNS = preloaded.viewer;
        }
      } else {
        throw new Error('Falha ao carregar PDF.js');
      }
    } catch (error) {
      console.error('[Leitor] Erro ao carregar PDF.js:', error);
      pdfError = 'Erro ao carregar biblioteca PDF.js. Por favor, recarregue a página.';
      pdfLoading = false;
      return;
    }
    
    // Register on globals for viewer expectations
    // @ts-ignore
    globalThis.pdfjsLib = core;
    // @ts-ignore
    window.pdfjsLib = core;
    // Expose getDocument for load()
    // @ts-ignore
    window.__pdfjsGetDocument = core.getDocument;
    core.GlobalWorkerOptions.workerSrc = workerUrl;

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

    // Ativar sistema de eventos de teclado no iOS focando elemento invisível na primeira interação
    // Isso simula o comportamento de clicar em um botão que tem tabindex="0"
    const activateKeyboard = () => {
      if (keyboardActivated || !keyboardFocusEl) return;
      
      try {
        keyboardFocusEl.focus();
        keyboardActivated = true;
        console.log('[Leitor] Sistema de teclado ativado');
      } catch (err) {
        console.warn('[Leitor] Erro ao ativar teclado:', err);
      }
    };
    
    // Handler para primeira interação do usuário
    const handleFirstInteraction = () => {
      if (!keyboardActivated) {
        activateKeyboard();
      }
    };
    
    // Wrapper para touchstart que também ativa o teclado
    const touchStartWrapper = (e: TouchEvent) => {
      handleFirstInteraction();
      onTouchStart(e);
    };
    
    // Add touch gesture handlers
    if (containerEl) {
      containerEl.addEventListener('touchstart', touchStartWrapper, { passive: false });
      containerEl.addEventListener('touchmove', onTouchMove, { passive: false });
      containerEl.addEventListener('touchend', onTouchEnd, { passive: false });
      containerEl.addEventListener('touchcancel', onTouchEnd, { passive: false });
      containerEl.addEventListener('click', handleFirstInteraction, { passive: true, capture: true });
    }
    
    // Também ativar em qualquer clique na página
    document.addEventListener('click', handleFirstInteraction, { passive: true, capture: true });
    document.addEventListener('touchstart', handleFirstInteraction, { passive: true, capture: true });

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
      resetFitModeScrollPosition();
      requestAnimationFrame(() => resetFitModeScrollPosition());
      // Adjust zoom when page changes if in page-width mode
      // Don't force recalculate - reuse cached scale
      if (preferredFitMode === 'page-width') {
        if (pageWidthAdjustTimeout) clearTimeout(pageWidthAdjustTimeout);
        pageWidthAdjustTimeout = setTimeout(() => {
          applyPageWidthZoom(false);
        }, 50);
      }
    });

    // PDF.js carregado com sucesso, ocultar loading
    pdfLoading = false;
    
    // Use direct load if validation was already done (skipValidation flag)
    if (skipValidation) {
      await loadDirectly(file);
    } else {
      await load(file);
    }

    cleanup = () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', handleFirstInteraction, true);
      document.removeEventListener('touchstart', handleFirstInteraction, true);
      if (storageHandler) {
        window.removeEventListener('storage', storageHandler);
      }
      if (containerEl) {
        containerEl.removeEventListener('touchstart', touchStartWrapper);
        containerEl.removeEventListener('touchmove', onTouchMove);
        containerEl.removeEventListener('touchend', onTouchEnd);
        containerEl.removeEventListener('touchcancel', onTouchEnd);
        containerEl.removeEventListener('click', handleFirstInteraction, true);
      }
      try { if (toolbarEl) ro.unobserve(toolbarEl); } catch {}
      // No explicit destroy API; let GC collect. Clear container contents.
      if (viewerEl) viewerEl.innerHTML = '';
    };
  });

  onDestroy(() => {
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
    if (!viewer) return;
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
  function resetFitModeScrollPosition() {
    if (!containerEl || preferredFitMode !== 'page-fit') return;
    // Em page-fit, evita deslocamento residual após swipe/troca de página.
    containerEl.scrollLeft = 0;
    containerEl.scrollTop = 0;
  }
  function goToFirstPage() {
    if (!viewer) return;
    (viewer as any).currentPageNumber = 1;
  }
  function goToLastPage() {
    if (!viewer) return;
    const maxPages = totalPages || (viewer as any)._pagesCount || 1;
    (viewer as any).currentPageNumber = maxPages;
  }

  // Calculate distance between two touch points
  function getTouchDistance(touch1: Touch, touch2: Touch): number {
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Swipe horizontal rápido (1 dedo): dx negativo => próxima página; positivo => anterior.
   * Não substitui tap/long press nas zonas — GestureButton cancela tap se houve movimento grande.
   */
  function trySwipePageTurn(e: TouchEvent) {
    if (!ENABLE_SWIPE_PAGE_NAV || !viewer) return;
    if (e.type === 'touchcancel') return;
    const t = e.changedTouches[0];
    if (!t) return;

    const now = performance.now();
    if (now - lastSwipePageTurnAt < SWIPE_COOLDOWN_MS) return;

    const dx = t.clientX - swipePageStartX;
    const dy = t.clientY - swipePageStartY;
    const dt = Math.max(now - swipePageStartTime, 1);

    const scale = (viewer as any).currentScale ?? 1;
    const zoomed = scale > SWIPE_ZOOM_STRICT_SCALE;
    const minDist =
      SWIPE_MIN_DISTANCE_PX + (zoomed ? SWIPE_EXTRA_DISTANCE_WHEN_ZOOMED_PX : 0);
    const minVel =
      SWIPE_MIN_VELOCITY_PX_MS + (zoomed ? SWIPE_EXTRA_VELOCITY_WHEN_ZOOMED : 0);

    if (dt > SWIPE_MAX_DURATION_MS) return;
    if (Math.abs(dx) < minDist) return;
    if (Math.abs(dx) < Math.abs(dy) * SWIPE_HORIZONTAL_RATIO) return;
    const v = Math.abs(dx) / dt;
    if (v < minVel) return;

    lastSwipePageTurnAt = now;
    if (dx < 0) {
      nextPage();
    } else {
      prevPage();
    }
    e.preventDefault();
  }

  // Handle touch start for gestures
  function onTouchStart(e: TouchEvent) {
    if (!viewer || !containerEl) return;
    
    const touches = e.touches;
    
    // PRIORIDADE 1: Pinch to zoom (2 dedos) - processar primeiro
    if (touches.length === 2) {
      isPinching = true;
      swipePageGestureValid = false;
      pinchInitialDistance = getTouchDistance(touches[0], touches[1]);
      pinchInitialScale = viewer.currentScale;
      if (ENABLE_PINCH_FOCAL_FIX) {
        const containerRect = containerEl.getBoundingClientRect();
        pinchStartFocalX =
          (touches[0].clientX + touches[1].clientX) / 2 - containerRect.left;
        pinchStartFocalY =
          (touches[0].clientY + touches[1].clientY) / 2 - containerRect.top;

        // Mapear o ponto focal para coordenadas de conteúdo na escala inicial.
        pinchStartContentX =
          (containerEl.scrollLeft + pinchStartFocalX) / Math.max(pinchInitialScale, 0.0001);
        pinchStartContentY =
          (containerEl.scrollTop + pinchStartFocalY) / Math.max(pinchInitialScale, 0.0001);
      }
      e.preventDefault();
      return; // Não processar GestureButton quando em pinch
    }
    
    // Um dedo: candidato a swipe em todo o canvas (sobreposto a zonas ou PDF)
    if (touches.length === 1 && ENABLE_SWIPE_PAGE_NAV) {
      swipePageGestureValid = true;
      swipePageStartX = touches[0].clientX;
      swipePageStartY = touches[0].clientY;
      swipePageStartTime = performance.now();
    }

    // PRIORIDADE 2: Zonas de navegação — estado para hasMoved / GestureButton
    if (touches.length === 1) {
      const containerRect = containerEl.getBoundingClientRect();
      const relativeX = touches[0].clientX - containerRect.left;
      const quarterWidth = containerRect.width / 4;
      
      const isInLeftZone = relativeX < quarterWidth;
      const isInRightZone = relativeX > containerRect.width - quarterWidth;
      
      if (!isInLeftZone && !isInRightZone) {
        return;
      }
      
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
      if (!currentDistance || !pinchInitialDistance) {
        e.preventDefault();
        return;
      }
      const scaleRatio = currentDistance / pinchInitialDistance;
      const newScale = pinchInitialScale * scaleRatio;
      
      // Clamp scale to reasonable bounds (0.25x to 4x)
      const clampedScale = Math.max(0.25, Math.min(4, newScale));
      viewer.currentScale = clampedScale;

      if (ENABLE_PINCH_FOCAL_FIX) {
        // Reaplica o ponto de conteúdo inicial sob o centro dos dedos.
        const targetScrollLeft = pinchStartContentX * clampedScale - pinchStartFocalX;
        const targetScrollTop = pinchStartContentY * clampedScale - pinchStartFocalY;
        containerEl.scrollLeft = Math.max(0, targetScrollLeft);
        containerEl.scrollTop = Math.max(0, targetScrollTop);
      }
      
      e.preventDefault();
      return;
    }
    
    // Single touch: check if it moved significantly
    if (touches.length === 1 && !isPinching) {
      // Impede pan nativo da viewport durante swipe horizontal entre páginas.
      const swipeDx = touches[0].clientX - swipePageStartX;
      const swipeDy = touches[0].clientY - swipePageStartY;
      const isMostlyHorizontalSwipe = Math.abs(swipeDx) > Math.abs(swipeDy) * 1.1;
      if (ENABLE_SWIPE_PAGE_NAV && swipePageGestureValid && isMostlyHorizontalSwipe) {
        e.preventDefault();
      }

      // Em page-fit sem zoom relevante, evita micro-scroll vertical residual do browser.
      const currentScale = (viewer as any).currentScale ?? 1;
      if (preferredFitMode === 'page-fit' && currentScale <= 1.02) {
        e.preventDefault();
      }

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
      pinchStartFocalX = 0;
      pinchStartFocalY = 0;
      pinchStartContentX = 0;
      pinchStartContentY = 0;
      swipePageGestureValid = false;
      e.preventDefault();
      touchStartX = 0;
      touchStartY = 0;
      touchStartTime = 0;
      hasMoved = false;
      return;
    }

    if (e.type === 'touchcancel') {
      swipePageGestureValid = false;
    } else if (
      ENABLE_SWIPE_PAGE_NAV &&
      swipePageGestureValid &&
      !isPinching &&
      touches.length === 0
    ) {
      trySwipePageTurn(e);
    }

    swipePageGestureValid = false;
    
    // Navegação por toque simples é processada pelos GestureButtons
    touchStartX = 0;
    touchStartY = 0;
    touchStartTime = 0;
    hasMoved = false;
  }
  
  // Função para navegar para a tela inicial
  // Tenta usar history.go(-1) primeiro, se não houver histórico usa goto('/')
  // No Safari iOS, verificações de histórico não são confiáveis, então usamos uma abordagem simples
  function goToHome() {
    // Salvar a URL atual antes de tentar voltar
    const currentUrl = window.location.href;
    
    // Tentar voltar no histórico
    window.history.go(-1);
    
    // Se após um pequeno delay ainda estamos na mesma URL, não havia histórico
    // Nesse caso, navegar para home
    setTimeout(() => {
      // Se a URL não mudou, significa que history.go(-1) não funcionou (não havia histórico)
      if (window.location.href === currentUrl) {
        goto('/');
      }
    }, 100);
  }
  
  // Função para navegar para a página inicial em uma nova aba
  // Compatível com Chrome e Safari (incluindo mobile)
  function goToHomeNewHistory() {
    // Tentar abrir em nova aba usando window.open
    const newWindow = window.open('/', '_blank');
    
    // Se window.open foi bloqueado (comum em Safari mobile quando não é ação direta do usuário),
    // criar um link temporário e clicar nele
    if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
      const link = document.createElement('a');
      link.href = '/';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }
  
  // Função para navegar para PDF do carousel
  function navigateToPdf(louvor: any) {
    const pdfPath = getPdfRelPath(louvor);
    if (!pdfPath) return;
    
    const fileParam = encodeURIComponent(`/${pdfPath}`);
    const tituloParam = encodeURIComponent(louvor.nome || '');
    const subtituloText = `${louvor.categoria || ''} | ${louvor.classificacao || ''}`.trim();
    const subtituloParam = encodeURIComponent(subtituloText);
    goto(`/leitor?file=${fileParam}&titulo=${tituloParam}&subtitulo=${subtituloParam}&validated=true`, { replaceState: true });
  }
  
  // Função para toggle da barra superior (fullscreen)
  function toggleToolbar() {
    isToolbarVisible = !isToolbarVisible;
    if (containerEl) {
      if (isToolbarVisible) {
        toolbarHeight = toolbarEl ? toolbarEl.offsetHeight : 60;
      } else {
        toolbarHeight = 0;
      }
      containerEl.style.top = `${toolbarHeight}px`;
    }

    // Disparar evento resize para notificar o PDF.js sobre a mudança de tamanho
    if (eventBus) {
      eventBus.dispatch('resize', {});
    }
    
    // Recalcular zoom baseado no modo atual após um delay para garantir que o DOM tenha atualizado
    if (viewer) {
      // Limpar cache de zoom para forçar recálculo
      cachedPageWidthScale = null;
      
      setTimeout(() => {
        if (!viewer) return;
        
        if (preferredFitMode === 'page-width') {
          // Para page-width, calcular manualmente
          applyPageWidthZoom(true);
        } else {
          // Para page-fit, deixar o PDF.js recalcular automaticamente
          viewer.currentScaleValue = 'page-fit';
        }
      }, 150);
    }
  }
  
  // Função para mostrar a barra (desativar fullscreen)
  function showToolbar() {
    // Garantir que a barra seja mostrada
    isToolbarVisible = true;
    if (containerEl) {
      toolbarHeight = toolbarEl ? toolbarEl.offsetHeight : 60;
      containerEl.style.top = `${toolbarHeight}px`;
    }

    // Disparar evento resize para notificar o PDF.js sobre a mudança de tamanho
    if (eventBus) {
      eventBus.dispatch('resize', {});
    }
    
    // Recalcular zoom baseado no modo atual após um delay para garantir que o DOM tenha atualizado
    if (viewer) {
      // Limpar cache de zoom para forçar recálculo
      cachedPageWidthScale = null;
      
      setTimeout(() => {
        if (!viewer) return;
        
        if (preferredFitMode === 'page-width') {
          // Para page-width, calcular manualmente
          applyPageWidthZoom(true);
        } else {
          // Para page-fit, deixar o PDF.js recalcular automaticamente
          viewer.currentScaleValue = 'page-fit';
        }
      }, 150);
    }
  }
  
  // Reativo: atualizar altura do container quando a visibilidade da barra mudar
  $: if (containerEl) {
    if (isToolbarVisible) {
      toolbarHeight = toolbarEl ? toolbarEl.offsetHeight : 60;
    } else {
      toolbarHeight = 0;
    }
    containerEl.style.top = `${toolbarHeight}px`;
  }
  
  // Reload if the file query param changes, but only when it actually changes
  $: if (viewer && file && file !== lastLoadedFile) {
    Promise.resolve().then(() => load(file));
  }
</script>

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
    grid-template-columns: 1fr max-content max-content repeat(5, max-content);
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
    transition: transform 0.3s ease, opacity 0.3s ease;
  }
  
  .toolbar.hidden {
    transform: translateY(-100%);
    opacity: 0;
    pointer-events: none;
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
    user-select: none;
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
  }
  .btn:hover { filter: brightness(1.05); }
  .btn .icon {
    width: 20px;
    height: 20px;
    stroke: currentColor;
  }
  .title-wrap { display: flex; flex-direction: column; justify-content: center; min-width: 0; grid-column: 1; grid-row: 2 / 4; }
  
  /* Carousel navigator positioning */
  :global(.toolbar > :global(.carousel-navigator)) {
    grid-column: 2;
    grid-row: 1 / 4;
    align-self: center;
  }
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
    text-shadow: 2px 2px 4px rgba(0,0,0,0.5), 0 0 8px rgba(0,0,0,0.3); /* Sombra mais pronunciada para destacar */
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    position: relative;
    padding: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  
  /* Feixe de luz - sempre ativo */
  .brand .light-beam {
    position: absolute;
    bottom: -2px;
    left: 50%;
    transform: translateX(-50%);
    height: 4px;
    width: calc(100% - 2rem);
    background: linear-gradient(to right, 
      transparent 0%, 
      rgba(255, 240, 160, 0.95) 15%,
      rgba(255, 230, 120, 1) 30%,
      rgba(255, 220, 100, 1) 50%, 
      rgba(255, 230, 120, 1) 70%,
      rgba(255, 240, 160, 0.95) 85%,
      transparent 100%);
    box-shadow: 
      0 0 12px rgba(255, 220, 100, 1),
      0 0 24px rgba(255, 220, 100, 0.8),
      0 0 36px rgba(255, 220, 100, 0.6),
      0 0 48px rgba(255, 220, 100, 0.4),
      0 2px 8px rgba(255, 220, 100, 0.7);
    border-radius: 50%;
    opacity: 1;
    z-index: 1;
  }

  .indicator { display: flex; align-items: center; gap: 4px; min-width: 56px; justify-content: center; }
  .indicator .current { font-variant-numeric: tabular-nums; }
  .indicator .total { opacity: .9; }

  /* Grid placements for controls spanning all rows */
  /* Hide prev/next buttons on mobile */
  .page-nav-prev { 
    grid-column: 3; 
    grid-row: 1 / 4; 
    align-self: center;
    display: none; /* Hidden on mobile by default */
  }
  .indicator { 
    grid-column: 3; 
    grid-row: 1 / 4; 
    align-self: center; 
  }
  .page-nav-next { 
    grid-column: 3; 
    grid-row: 1 / 4; 
    align-self: center;
    display: none; /* Hidden on mobile by default */
  }
  .btn.zoom-minus { grid-column: 4; grid-row: 1 / 4; align-self: center; }
  .btn.zoom-fit { grid-column: 5; grid-row: 1 / 4; align-self: center; position: relative; }
  
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
  .btn.zoom-plus { grid-column: 6; grid-row: 1 / 4; align-self: center; }

  .btn-layout-reset {
    grid-column: 7;
    grid-row: 1 / 4;
    align-self: center;
    padding: 8px;
    opacity: 0.75;
  }
  .btn-layout-reset:hover {
    opacity: 1;
  }

  /* Wide screens: let content breathe */
  @media (min-width: 1024px) {
    .brand { font-size: 1.75rem; }
    .btn { padding: 12px 14px; }
    .title-main { font-size: 1rem; }
  }

  /* Mobile screens: limit PLPCG button to half toolbar height */
  @media (max-width: 767px) {
    .brand {
      max-height: 24px; /* Ajustado para 24px considerando os paddings */
      align-self: start; /* Alinhar ao topo da célula do grid */
      margin-bottom: 12px;
      padding: 4px; /* Padding ajustado sem espaço para seta */
      font-size: 1.25rem; /* Reduzir ligeiramente o tamanho da fonte */
    }
    
    .brand .light-beam {
      height: 3px;
      width: calc(100% - 1rem);
      box-shadow: 
        0 0 8px rgba(255, 220, 100, 1),
        0 0 16px rgba(255, 220, 100, 0.8),
        0 0 24px rgba(255, 220, 100, 0.6),
        0 2px 6px rgba(255, 220, 100, 0.7);
    }
  }

  /* Tablet+ layout: brand in its own column, title/subtitle to the right */
  @media (min-width: 768px) {
    .toolbar {
      grid-template-columns: auto 1fr max-content repeat(7, max-content);
    }
    .brand { grid-column: 1; grid-row: auto; align-self: center; }
    .title-wrap { grid-column: 2; grid-row: auto; }
    /* Carousel navigator in column 3 - after title-wrap */
    :global(.toolbar > :global(.carousel-navigator)) {
      grid-column: 3;
      grid-row: auto;
    }
    /* Show prev/next buttons on tablet+ */
    .page-nav-prev { 
      grid-column: 4;
      grid-row: auto;
      display: flex; /* Show on tablet+ */
    }
    .indicator { 
      grid-column: 5;
      grid-row: auto;
    }
    .page-nav-next { 
      grid-column: 6;
      grid-row: auto;
      display: flex; /* Show on tablet+ */
    }
    .btn.zoom-minus { 
      grid-column: 7;
      grid-row: auto;
    }
    .btn.zoom-fit { 
      grid-column: 8;
      grid-row: auto;
    }
    .btn.zoom-plus { 
      grid-column: 9;
      grid-row: auto;
    }
    .btn-layout-reset {
      grid-column: 10;
      grid-row: auto;
    }
  }

  /* Compact screens: stack title under PLPC, stack indicator, hide +/- */
  @media (max-width: 600px) {
    .btn.zoom-minus, .btn.zoom-plus { display: none; }
  }
  
  .pdf-loading-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(42, 42, 42, 0.9);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 2000;
    color: var(--text-light);
  }
  
  .loading-spinner {
    width: 48px;
    height: 48px;
    border: 4px solid rgba(255, 255, 255, 0.2);
    border-top-color: var(--gold-color);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 1rem;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  .pdf-error-banner {
    position: fixed;
    top: 60px;
    left: 50%;
    transform: translateX(-50%);
    max-width: 90%;
    width: 600px;
    background-color: rgba(220, 38, 38, 0.95);
    color: white;
    padding: 1rem 1.5rem;
    border-radius: 0.5rem;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    z-index: 2000;
    text-align: center;
  }
  
  .pdf-error-banner p {
    margin: 0 0 0.75rem 0;
    font-size: 0.9375rem;
  }
  
  .error-button {
    background-color: white;
    color: #dc2626;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 0.25rem;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.2s;
  }
  
  .error-button:hover {
    background-color: #f3f4f6;
  }
  
  .container.hidden {
    display: none;
  }
  
  .fab-exit-fullscreen {
    position: fixed;
    top: calc(12px + env(safe-area-inset-top));
    right: calc(12px + env(safe-area-inset-right));
    width: 44px;
    height: 44px;
    background: white;
    border: none;
    border-radius: 50%;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15), 0 4px 12px rgba(0, 0, 0, 0.1);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1500;
    transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.3s ease;
    opacity: 0.95;
    padding: 0;
  }
  
  .fab-exit-fullscreen:hover {
    transform: scale(1.05);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2), 0 6px 16px rgba(0, 0, 0, 0.15);
    opacity: 1;
  }
  
  .fab-exit-fullscreen:active {
    transform: scale(0.98);
  }
  
  .fab-exit-fullscreen svg {
    width: 20px;
    height: 20px;
    stroke: var(--gold-color, #d4af37);
    pointer-events: none;
  }

  /* Zonas de navegação nas laterais e centro */
  .navigation-zone {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 10; /* Acima do PDF, abaixo da toolbar */
    pointer-events: none; /* Container não captura, mas filhos sim */
  }

  .navigation-zone.left {
    left: 0;
    width: 25%; /* Primeiro quarto */
  }

  .navigation-zone.center {
    left: 25%;
    width: 50%; /* Meio da tela */
  }

  .navigation-zone.right {
    right: 0;
    width: 25%; /* Último quarto */
  }

  .navigation-zone :global(.gesture-button-wrapper) {
    width: 100%;
    height: 100%;
    pointer-events: auto; /* GestureButton captura toques */
  }

  .touch-zone {
    width: 100%;
    height: 100%;
    background: transparent;
    /* Invisível, apenas para capturar toques */
  }

  /* Feedback visual opcional durante long press */
  :global(.navigation-zone .gesture-button-wrapper.long-pressing .touch-zone) {
    background: rgba(212, 175, 55, 0.1); /* Gold color com opacidade */
  }
  /* Elemento focável invisível para ativar sistema de eventos de teclado no iOS */
  .keyboard-focus-input {
    position: fixed;
    top: 0;
    left: 0;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
    border: none;
    outline: none;
    padding: 0;
    margin: 0;
    z-index: -1;
    resize: none;
    overflow: hidden;
    background: transparent;
    color: transparent;
    caret-color: transparent;
  }
</style>

<div class="toolbar" bind:this={toolbarEl} class:hidden={!isToolbarVisible}>
  <GestureButton
    on:click={goToHome}
    on:longpress={goToHomeNewHistory}
    longPressDuration={500}
    hapticFeedback={true}
    preventDefault={true}
    preventClickOnLongPress={true}
  >
    <div class="brand">PLPCG<div class="light-beam"></div></div>
  </GestureButton>

  <div class="title-wrap">
    {#if titulo}
      <div class="title-main" title={titulo}>{titulo}</div>
    {/if}
    {#if subtitulo}
      <div class="title-sub" title={subtitulo}>{subtitulo}</div>
    {/if}
  </div>

  <CarouselNavigator
    currentFile={file}
    carousel={$carousel}
    on:navigate={(e) => navigateToPdf(e.detail.louvor)}
  />

  <div class="page-nav-prev">
    <GestureButton
      on:click={prevPage}
      on:longpress={goToFirstPage}
      longPressDuration={500}
      hapticFeedback={true}
      preventDefault={true}
    >
      <button class="btn prev" aria-label="Página anterior">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
        </svg>
      </button>
    </GestureButton>
  </div>
  <div class="indicator" aria-label="Página atual e total">
    <span class="current">{currentPage}</span>
    <span class="total">/ {totalPages}</span>
  </div>
  <div class="page-nav-next">
    <GestureButton
      on:click={nextPage}
      on:longpress={goToLastPage}
      longPressDuration={500}
      hapticFeedback={true}
      preventDefault={true}
    >
      <button class="btn next" aria-label="Próxima página">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
          <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
        </svg>
      </button>
    </GestureButton>
  </div>

  <button class="btn zoom-minus" on:click={zoomOut} aria-label="Diminuir zoom">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
      <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14" />
    </svg>
  </button>

  <GestureButton
    on:click={zoomFit}
    on:longpress={toggleFitMode}
    longPressDuration={500}
    hapticFeedback={true}
    preventDefault={true}
  >
    <button 
      class="btn zoom-fit" 
      class:page-fit={preferredFitMode === 'page-fit'}
      class:page-width={preferredFitMode === 'page-width'}
      aria-label="Ajustar zoom"
    >
      {zoomPercent}%
      <!-- Visual indicators for fit mode -->
      <div class="zoom-fit-indicator bar page-fit top"></div>
      <div class="zoom-fit-indicator bar page-fit bottom"></div>
      <div class="zoom-fit-indicator bar page-width left"></div>
      <div class="zoom-fit-indicator bar page-width right"></div>
    </button>
  </GestureButton>

  <button class="btn zoom-plus" on:click={zoomIn} aria-label="Aumentar zoom">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  </button>

  <button
    type="button"
    class="btn btn-layout-reset"
    on:click={() => dispatch('remountLayout')}
    aria-label="Corrigir posição da barra e do leitor (reinicia só esta tela)"
    title="Corrigir layout"
  >
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7m0 0L19.5 9.348m-4.686-4.686L12 12" />
    </svg>
  </button>

  <!-- Abra com /leitor?file=/pdfs/exemplo.pdf&titulo=Exemplo&subtitulo=Sub -->
  <!-- Atalhos: Ctrl/Cmd +/−/0, PgUp/PgDn/↑/↓ -->
  
</div>

<!-- FAB para desativar fullscreen -->
{#if !isToolbarVisible}
  <button 
    class="fab-exit-fullscreen" 
    on:click={showToolbar}
    aria-label="Sair do modo fullscreen"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2"/>
      <path d="M17 3h2a2 2 0 0 1 2 2v2"/>
      <path d="M21 17v2a2 2 0 0 1-2 2h-2"/>
      <path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
      <rect width="10" height="8" x="7" y="8" rx="1"/>
    </svg>
  </button>
{/if}

{#if pdfLoading}
  <div class="pdf-loading-overlay">
    <div class="loading-spinner"></div>
    <p>Carregando PDF...</p>
  </div>
{/if}

{#if pdfError}
  <div class="pdf-error-banner">
    <p>{pdfError}</p>
    {#if !navigator.onLine}
      <button class="error-button" on:click={() => window.location.href = '/offline'}>
        Ir para Configuração Offline
      </button>
    {/if}
  </div>
{/if}

<div id="viewerContainer" bind:this={containerEl} class="container {containerClass}" class:hidden={pdfLoading || pdfError}>
  <!-- Elemento focável invisível para ativar sistema de eventos de teclado no iOS -->
  <textarea
    bind:this={keyboardFocusEl}
    class="keyboard-focus-input"
    tabindex="0"
    aria-hidden="true"
    readonly
    inputmode="none"
    autocomplete="off"
    autocorrect="off"
    autocapitalize="off"
    spellcheck="false"
  ></textarea>
  
  <!-- Zona de navegação esquerda -->
  <div class="navigation-zone left">
    <GestureButton
      on:click={prevPage}
      on:longpress={goToFirstPage}
      longPressDuration={500}
      hapticFeedback={true}
      preventDefault={false}
    >
      <div class="touch-zone left"></div>
    </GestureButton>
  </div>

  <!-- Zona de navegação central -->
  <div class="navigation-zone center">
    <GestureButton
      on:longpress={toggleToolbar}
      longPressDuration={500}
      hapticFeedback={true}
      preventDefault={false}
    >
      <div class="touch-zone center"></div>
    </GestureButton>
  </div>

  <!-- Zona de navegação direita -->
  <div class="navigation-zone right">
    <GestureButton
      on:click={nextPage}
      on:longpress={goToLastPage}
      longPressDuration={500}
      hapticFeedback={true}
      preventDefault={false}
    >
      <div class="touch-zone right"></div>
    </GestureButton>
  </div>

  <div bind:this={viewerEl} class="viewer pdfViewer"></div>
  <!-- pdfjs-dist css hooks on .pdfViewer and .viewer -->
  
</div>