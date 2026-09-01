<script lang="ts">
  /// <reference types="@sveltejs/kit" />
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import GestureButton from '$lib/components/GestureButton.svelte';
  import CarouselNavigator from '$lib/components/CarouselNavigator.svelte';
  import { carousel } from '$lib/stores/carousel';
  import { getPdfRelPath } from '$lib/utils/pathUtils';
  import { loadPdfJsComplete, loadPdfJsViewer } from '$lib/utils/pdfjsLoader';
  import { clearPdfFromSwCache } from '$lib/utils/swRegistration';
  import { checkEffectiveConnectivity } from '$lib/utils/pdfValidation';
  import { getFitMode, setFitMode, getNavigationMode, setNavigationMode, getBrightness, setBrightness, BRIGHTNESS_PRESETS, DEFAULT_BRIGHTNESS } from '$lib/pdf-reader/readerPreferences';
  import { ZoomController } from '$lib/pdf-reader/zoomController';
  import { resolvePdfSourceUrl as resolveSource } from '$lib/pdf-reader/pdfSourceResolver';
  import { ViewerAdapter } from '$lib/pdf-reader/viewerAdapter';
  import PdfPathManager from '$lib/offline/utils/PdfPathManager.js';
  import { createPdfTouchGestureHandlers } from '$lib/utils/pdfTouchGestures.js';

  // ── Performance Debug ────────────────────────────────────────────────────────
  const _perfEnabled = () =>
    typeof window !== 'undefined' &&
    localStorage.getItem('plpcjf_perf_debug') === '1'

  function perfMark(name: string) {
    if (!_perfEnabled()) return
    try { performance.mark(name) } catch {}
  }

  function perfMeasure(name: string, start: string, end: string) {
    if (!_perfEnabled()) return
    try { performance.measure(name, start, end) } catch {}
  }

  function perfReport() {
    if (!_perfEnabled()) return
    try {
      const entries = performance.getEntriesByType('measure')
        .filter(e => e.name.startsWith('pdf'))
      const lines = entries.map(e => `  ${e.name}: ${e.duration.toFixed(1)}ms`)
      console.log('[PLPCJF Perf]\n' + lines.join('\n'))
      performance.clearMarks()
      performance.clearMeasures()
    } catch {}
  }
  // ────────────────────────────────────────────────────────────────────────────

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
  let viewerAdapterInst: ViewerAdapter | null = null;
  /** @type {'horizontal' | 'vertical'} */
  let navigationMode: 'horizontal' | 'vertical' = getNavigationMode();
  // viewerNS guardado para poder recriar o viewer ao trocar de modo
  let _viewerNS: any = null;
  let cleanup: (() => void) | null = null;
  const trackedObjectUrls = new Set<string>();
  const objectUrlManager = {
    create(blob: Blob): string {
      const objectUrl = URL.createObjectURL(blob);
      trackedObjectUrls.add(objectUrl);
      return objectUrl;
    },
    revoke(objectUrl: string) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {}
      trackedObjectUrls.delete(objectUrl);
    },
    revokeAll() {
      for (const objectUrl of trackedObjectUrls) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {}
      }
      trackedObjectUrls.clear();
    },
  };
  let activePdfObjectUrl: string | null = null;
  let toolbarEl: HTMLDivElement | null = null;
  let toolbarHeight = 60;
  // Estado para controlar visibilidade da barra superior (fullscreen)
  // Sempre começa como true (barra visível) quando a página é carregada
  let isToolbarVisible = true;

  // Toolbar layer system
  type DeviceType = 'mobile' | 'tablet' | 'desktop';
  let deviceType: DeviceType = 'desktop';
  let activeToolbarLayer = 1;
  let _mqlCleanup: (() => void) | null = null;

  $: searchParams = new URLSearchParams($page.url.search);
  $: file = searchParams.get('file') ?? '/pdfs/exemplo.pdf';
  $: titulo = searchParams.get('titulo') ?? '';
  $: subtitulo = searchParams.get('subtitulo') ?? '';
  $: skipValidation = searchParams.get('validated') === 'true';

  let currentPage = 1;
  let totalPages = 0;
  let zoomPercent = 100;
  let lastLoadedFile: string | null = null;
  // Preferred fit mode: 'page-width' or 'page-fit' — persistido via readerPreferences
  let preferredFitMode: 'page-width' | 'page-fit' = getFitMode();
  // Controlador de zoom: encapsula cache de escala e cálculos de page-width
  const zoomCtrl = new ZoomController();

  // Swipe horizontal de página + pinch-to-zoom — ver src/lib/utils/pdfTouchGestures.js.
  // nextPage/prevPage são function declarations (hoisted), podem ser referenciadas aqui
  // mesmo estando definidas mais abaixo no script.
  const touchHandlers = createPdfTouchGestureHandlers({
    getViewer: () => viewer,
    getContainerEl: () => containerEl,
    getViewerEl: () => viewerEl,
    getNavigationMode: () => navigationMode,
    getPreferredFitMode: () => preferredFitMode,
    zoomCtrl,
    nextPage,
    prevPage
  });

  // Brilho da página do PDF (não da toolbar) — persistido via readerPreferences
  let readerBrightness: number = getBrightness();

  function cycleBrightness() {
    const idx = BRIGHTNESS_PRESETS.indexOf(readerBrightness);
    const next = BRIGHTNESS_PRESETS[(idx + 1) % BRIGHTNESS_PRESETS.length];
    readerBrightness = next;
    setBrightness(next);
  }

  function resetBrightness() {
    readerBrightness = DEFAULT_BRIGHTNESS;
    setBrightness(DEFAULT_BRIGHTNESS);
  }
  
  // PDF validation states
  type PdfUiState =
    | 'idle'
    | 'loading'
    | 'autoDownloading'
    | 'retryableError'
    | 'fatalError'
    | 'forceOnlineLoading';

  let pdfUiState: PdfUiState = 'idle';
  let pdfUiMessage: string | null = null;
  let lastPdfPathForRecovery: string | null = null;
  let lastOriginalFullUrlForRecovery: string | null = null;
  let activeForcedObjectUrl: string | null = null;

  // Backward-compatible bindings for existing template (will be driven by state)
  let pdfLoading = false;
  let pdfError: string | null = null;
  let retryCount = 0;
  const MAX_RETRIES = 2;

  function setPdfUi(state: PdfUiState, message: string | null = null) {
    pdfUiState = state;
    pdfUiMessage = message;

    pdfLoading = state === 'loading' || state === 'autoDownloading' || state === 'forceOnlineLoading';
    pdfError = state === 'retryableError' || state === 'fatalError' ? message : null;
  }
  
  // Apply CSS class to container based on fit mode
  $: containerClass = preferredFitMode === 'page-fit' ? 'page-fit-mode' : 'page-width-mode';
  
  // Persiste modo de ajuste sempre que mudar
  $: if (typeof window !== 'undefined') {
    setFitMode(preferredFitMode);
  }

  // Delega ao ZoomController para calcular e aplicar page-width zoom
  function applyPageWidthZoom(forceRecalculate = false) {
    if (!viewer || !containerEl || !viewerEl) return;
    if (preferredFitMode !== 'page-width') return;
    zoomCtrl.applyPageWidth({ viewer, containerEl, viewerEl, forceRecalculate });
  }

  const TOUCH_TIME_THRESHOLD = 300; // ms

  async function resolvePdfSourceUrl(fileUrl: string): Promise<string> {
    const { url, newObjectUrl } = await resolveSource(fileUrl, {
      objectUrlManager,
      activeObjectUrl: activePdfObjectUrl,
    });
    if (newObjectUrl) activePdfObjectUrl = newObjectUrl;
    return url;
  }
  // Load PDF directly without validation (optimization: skip validation if already validated)
  async function loadDirectly(fileUrl: string) {
    const getDocument = (window as any).__pdfjsGetDocument as PDFJSGetDocument | undefined;
    if (!getDocument) return;
    
    // Avoid duplicate loads of the same file
    if (lastLoadedFile === fileUrl && !pdfError) return;
    
    setPdfUi('loading', null);
    
    try {
      // Try to load directly - Service Worker will intercept and serve from cache if available
      perfMark('pdf-source-resolve-start')
      const sourceUrl = await resolvePdfSourceUrl(fileUrl);
      perfMark('pdf-source-resolve-end')
      perfMeasure('pdf-source-resolve', 'pdf-source-resolve-start', 'pdf-source-resolve-end')
      perfMark('pdf-getdocument-start')
      const loadingTask = getDocument({ url: sourceUrl, withCredentials: false });
      const pdfDocument = await loadingTask.promise;
      perfMark('pdf-getdocument-end')
      perfMeasure('pdf-getdocument', 'pdf-getdocument-start', 'pdf-getdocument-end')
      perfMark('pdf-setdocument-start')
      linkService.setDocument(pdfDocument);
      viewer.setDocument(pdfDocument);
      perfMark('pdf-setdocument-end')
      perfMeasure('pdf-setdocument', 'pdf-setdocument-start', 'pdf-setdocument-end')
      totalPages = pdfDocument.numPages ?? 0;
      currentPage = 1;
      lastLoadedFile = fileUrl;
      retryCount = 0;
      setPdfUi('idle', null);
    } catch (error) {
      console.warn('[Leitor] Direct load failed, falling back to validation:', error);
      // If direct load fails, fall back to full validation
      await load(fileUrl);
    } finally {
      if (pdfUiState === 'loading') {
        setPdfUi('idle', null);
      }
    }
  }

  async function load(fileUrl: string) {
    const getDocument = (window as any).__pdfjsGetDocument as PDFJSGetDocument | undefined;
    if (!getDocument) return;
    
    // Avoid duplicate loads of the same file
    if (lastLoadedFile === fileUrl && !pdfError) return;
    
    setPdfUi('loading', null);
    
    // Extract PDF path from URL - usar caminho original (NÃO normalizar)
    // O PDF deve ser carregado e validado usando o caminho original (preserva case e acentos)
    const urlObj = new URL(fileUrl, window.location.origin);
    const pdfPath = urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
    // Achado I3 (corrigido): dois caminhos que o leitor abre não são do
    // acervo — o exemplo padrão (`/pdfs/exemplo.pdf`, quando não há
    // `?file=`) e a página de configuração offline (`/offline-setup.pdf`,
    // aberta por `stores/offline.js`). Ambos vivem em `static/`, fora de
    // `assets/`. A tentativa original de distinguir os dois olhando se
    // `pdfPath` começa com `assets/` inverte o contrato: um link de acervo
    // legado (`?file=` sem o prefixo `assets/`, formato suportado desde
    // sempre — ver `urlParams.test.js` §5.5) também não começa com
    // `assets/`, e passava a ser tratado como estático, pulando a
    // normalização que o fazia resolver. A lista curta é a única forma
    // segura: só os dois arquivos estáticos conhecidos usam o caminho como
    // está; qualquer outro — incluindo formatos de acervo que não previmos —
    // continua indo por `PdfPathManager`/validação, como sempre foi.
    const isKnownStaticFile =
      pdfPath.toLowerCase() === 'pdfs/exemplo.pdf' || pdfPath.toLowerCase() === 'offline-setup.pdf';
    const isCatalogAsset = !isKnownStaticFile;
    // #22.1: um só codificador. O parser WHATWG deixa `[` e `]` literais e o
    // escritor do cache os escapa — para os 3 PDFs do acervo com colchetes no
    // nome, a URL pedida aqui nunca era a chave gravada.
    const originalFullUrl = isCatalogAsset
      ? PdfPathManager.createRequestUrl(pdfPath, window.location.origin)
      : new URL(`/${pdfPath}`, window.location.origin).toString();
    lastPdfPathForRecovery = pdfPath;
    lastOriginalFullUrlForRecovery = originalFullUrl;

    try {

      if (isCatalogAsset) {
        // VALIDAÇÃO: Check if PDF is available in cache using original path (no normalization)
        const { validatePdfAvailability } = await import('$lib/utils/pdfValidation');
        const { downloadPDFsViaSW } = await import('$lib/utils/swRegistration');

        const validation = await validatePdfAvailability(pdfPath);

        if (!validation.available) {
          // Try to download automatically if online
          const effectiveOnline = await checkEffectiveConnectivity({ timeoutMs: 1500 });
          if (validation.needsDownload && effectiveOnline && retryCount < MAX_RETRIES) {
            retryCount++;
            console.log('[Leitor] auto-download-start', { pdfPath, attempt: retryCount });

            // Show feedback
            setPdfUi('autoDownloading', 'Baixando PDF...');

            try {
              // Download via Service Worker
              const result = await downloadPDFsViaSW(
                [validation.url],
                1,
                undefined,
                { timeoutMs: 30000 }
              );

              if (!result.success) {
                const msg = result.partialSuccess
                  ? 'Download parcial do PDF. Tente novamente ou use “Buscar online”.'
                  : 'Não foi possível baixar o PDF automaticamente. Tente novamente ou use “Buscar online”.';
                console.log('[Leitor] auto-download-partial', { pdfPath, ...result });
                setPdfUi('retryableError', msg);
                return;
              }

              // Revalidar antes de carregar para evitar falso-sucesso
              const recheck = await validatePdfAvailability(pdfPath);
              if (!recheck.available) {
                setPdfUi('retryableError', 'O PDF ainda não está disponível após o download. Tente “Buscar online”.');
                return;
              }

              // Voltar para estado normal e seguir carregamento
              setPdfUi('loading', null);
            } catch (downloadErr) {
              const isTimeout = String((downloadErr as any)?.message || '').includes('timeout');
              if (isTimeout) {
                console.log('[Leitor] auto-download-timeout', { pdfPath });
              }
              console.error('[Leitor] Download automático falhou:', downloadErr);
              setPdfUi('retryableError', 'Erro ao baixar PDF. Verifique sua conexão ou use “Buscar online”.');

              // FASE 2: Invalidar cache de validação quando download falha
              try {
                const { clearAllValidationCache } = await import('$lib/utils/pdfValidation');
                clearAllValidationCache();
              } catch (err) {
                console.warn('[Leitor] Erro ao invalidar cache de validação:', err);
              }

              return;
            }
          } else {
            // PDF not available and cannot be downloaded
            setPdfUi('fatalError', 'PDF não está disponível offline. Por favor, baixe primeiro na página de configuração offline.');
            return;
          }
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
      setPdfUi('idle', null);
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
      
      // #22.5: não há mais variações a tentar. `originalFullUrl` é a chave
      // canônica — a mesma string que o escritor do cache grava e que o Service
      // Worker procura. As seis tentativas do bloco antigo eram a mesma URL em
      // seis formatos, e cada uma custava um `getDocument` completo.
      setPdfUi('retryableError', 'Erro ao carregar PDF. Verifique se o arquivo está disponível.');

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
    } finally {
      if (pdfUiState === 'loading' || pdfUiState === 'autoDownloading') {
        // Mantém erro se estiver em estado de erro; senão volta ao idle
        setPdfUi(pdfError ? pdfUiState : 'idle', pdfUiMessage);
      }
    }
  }

  async function handleForceOnlineFetch() {
    const getDocument = (window as any).__pdfjsGetDocument as PDFJSGetDocument | undefined;
    if (!getDocument) return;

    const effectiveOnline = await checkEffectiveConnectivity({ timeoutMs: 1500 });
    if (!effectiveOnline) {
      setPdfUi('fatalError', 'Sem conexão com a internet para buscar online.');
      return;
    }

    if (!lastPdfPathForRecovery || !lastOriginalFullUrlForRecovery) {
      setPdfUi('fatalError', 'Não foi possível identificar o PDF para buscar online.');
      return;
    }

    setPdfUi('forceOnlineLoading', 'Buscando online...');
    console.log('[Leitor] force-online-start', { pdfPath: lastPdfPathForRecovery });

    try {
      // Limpar entrada específica do cache do SW para forçar refetch
      await clearPdfFromSwCache(lastPdfPathForRecovery);
    } catch (err) {
      // Não bloquear a tentativa online por falha de limpeza
      console.warn('[Leitor] Falha ao limpar cache do PDF antes de buscar online:', err);
    }

    // Invalidate validation cache (best effort; we don't have pdfId here)
    try {
      const { clearAllValidationCache } = await import('$lib/utils/pdfValidation');
      clearAllValidationCache();
    } catch {}

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(lastOriginalFullUrlForRecovery, {
        cache: 'no-store',
        signal: controller.signal
      });

      if (!res.ok) {
        if (res.status === 404) {
          setPdfUi('fatalError', 'PDF não encontrado online (404).');
          return;
        }
        setPdfUi('retryableError', `Falha ao buscar PDF online (HTTP ${res.status}).`);
        return;
      }

      const blob = await res.blob();
      if (!blob || blob.size === 0) {
        setPdfUi('retryableError', 'PDF online retornou vazio. Tente novamente.');
        return;
      }

      if (activeForcedObjectUrl) {
        try { URL.revokeObjectURL(activeForcedObjectUrl); } catch {}
        activeForcedObjectUrl = null;
      }
      activeForcedObjectUrl = URL.createObjectURL(blob);

      const loadingTask = getDocument({ url: activeForcedObjectUrl, withCredentials: false });
      const pdfDocument = await loadingTask.promise;
      linkService.setDocument(pdfDocument);
      viewer.setDocument(pdfDocument);
      totalPages = pdfDocument.numPages ?? 0;
      currentPage = 1;
      lastLoadedFile = lastOriginalFullUrlForRecovery;
      retryCount = 0;
      setPdfUi('idle', null);
      console.log('[Leitor] force-online-success', { pdfPath: lastPdfPathForRecovery });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        console.log('[Leitor] force-online-fail', { pdfPath: lastPdfPathForRecovery, reason: 'timeout' });
        setPdfUi('retryableError', 'Tempo limite ao buscar o PDF online. Tente novamente.');
        return;
      }
      console.log('[Leitor] force-online-fail', { pdfPath: lastPdfPathForRecovery, reason: 'error' });
      setPdfUi('retryableError', 'Erro ao buscar o PDF online. Tente novamente.');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function updateDeviceType() {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(max-width: 767px)').matches) {
      deviceType = 'mobile';
    } else if (window.matchMedia('(max-width: 1023px)').matches) {
      deviceType = 'tablet';
    } else {
      deviceType = 'desktop';
    }
  }

  function cycleToolbarLayer() {
    activeToolbarLayer = (activeToolbarLayer % toolbarLayerCount) + 1;
    requestAnimationFrame(() => {
      if (toolbarEl && containerEl) {
        toolbarHeight = toolbarEl.offsetHeight;
        containerEl.style.top = `${toolbarHeight}px`;
      }
    });
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!viewer) return;
    // Basic shortcuts
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      const newScale = viewer.currentScale * 1.1;
      viewer.currentScale = newScale;
      zoomCtrl.setUserScale(newScale);
    } else if ((e.ctrlKey || e.metaKey) && (e.key === '-' )) {
      e.preventDefault();
      const newScale = viewer.currentScale / 1.1;
      viewer.currentScale = newScale;
      zoomCtrl.setUserScale(newScale);
    } else if ((e.ctrlKey || e.metaKey) && (e.key === '0')) {
      e.preventDefault();
      zoomCtrl.clearUserScale();
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

    // Setup device type detection for toolbar layers
    updateDeviceType();
    const mqlMobile = window.matchMedia('(max-width: 767px)');
    const mqlTablet = window.matchMedia('(max-width: 1023px)');
    const handleMediaChange = () => { updateDeviceType(); };
    mqlMobile.addEventListener('change', handleMediaChange);
    mqlTablet.addEventListener('change', handleMediaChange);
    _mqlCleanup = () => {
      mqlMobile.removeEventListener('change', handleMediaChange);
      mqlTablet.removeEventListener('change', handleMediaChange);
    };
    
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
    perfMark('pdfjs-load-start')
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
    
    perfMark('pdfjs-load-end')
    perfMeasure('pdfjs-load', 'pdfjs-load-start', 'pdfjs-load-end')

    // Register on globals for viewer expectations
    // @ts-ignore
    globalThis.pdfjsLib = core;
    // @ts-ignore
    window.pdfjsLib = core;
    // Expose getDocument for load()
    // @ts-ignore
    window.__pdfjsGetDocument = core.getDocument;
    core.GlobalWorkerOptions.workerSrc = workerUrl;

    const { EventBus, PDFLinkService } = viewerNS as any;
    _viewerNS = viewerNS;

    eventBus = new EventBus();
    linkService = new PDFLinkService({ eventBus });
    viewerAdapterInst = new ViewerAdapter({ container: containerEl!, viewerEl: viewerEl!, eventBus, linkService, mode: navigationMode });
    viewer = viewerAdapterInst.create(viewerNS);
    linkService.setViewer(viewer);

    const resize = () => {
      // apenas notifica o viewer para recalcular o layout/textLayer
      eventBus.dispatch('resize', {});
      // Recalcular zoom após resize se necessário
      if (preferredFitMode === 'page-width') {
        zoomCtrl.invalidateCache();
        zoomCtrl.schedulePageWidth({ viewer, containerEl: containerEl!, viewerEl: viewerEl!, forceRecalculate: true, delayMs: 150 });
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
      touchHandlers.onTouchStart(e);
    };

    // Add touch gesture handlers
    if (containerEl) {
      containerEl.addEventListener('touchstart', touchStartWrapper, { passive: false });
      containerEl.addEventListener('touchmove', touchHandlers.onTouchMove, { passive: false });
      containerEl.addEventListener('touchend', touchHandlers.onTouchEnd, { passive: false });
      containerEl.addEventListener('touchcancel', touchHandlers.onTouchEnd, { passive: false });
      containerEl.addEventListener('click', handleFirstInteraction, { passive: true, capture: true });
    }
    
    // Também ativar em qualquer clique na página
    document.addEventListener('click', handleFirstInteraction, { passive: true, capture: true });
    document.addEventListener('touchstart', handleFirstInteraction, { passive: true, capture: true });

    // Define escala inicial e sincroniza estados
    eventBus.on('pagesinit', () => {
      if (viewer) {
        // Modo vertical usa page-width por padrão para melhor leitura contínua
        const effectiveFitMode = navigationMode === 'vertical' ? 'page-width' : preferredFitMode;
        if (effectiveFitMode === 'page-width') {
          if (navigationMode === 'vertical') {
            // Garantir que a preferência também fique salva como page-width no vertical
            preferredFitMode = 'page-width';
            setFitMode('page-width');
            zoomCtrl.clearUserScale();
          }
          setTimeout(() => { applyPageWidthZoom(true); }, 100);
        } else {
          viewer.currentScaleValue = effectiveFitMode;
        }
      }
      perfMark('pdf-pagesinit')
      perfMeasure('pdf-total-ttfr', 'pdfjs-load-start', 'pdf-pagesinit')
      perfReport()
    });
    eventBus.on('scalechanging', (e: any) => {
      const newScale = e?.scale ?? (viewer as any)?.currentScale ?? 1;
      zoomPercent = Math.round(newScale * 100);
      
      // Se o ZoomController está no meio de um ajuste, ignorar para evitar loops
      if (zoomCtrl.isManuallyAdjusting) {
        return;
      }
    });
    eventBus.on('pagesloaded', (e: any) => {
      totalPages = e?.pagesCount ?? totalPages;
      currentPage = (viewer as any)?.currentPageNumber ?? currentPage;
      if (preferredFitMode === 'page-width') {
        zoomCtrl.schedulePageWidth({ viewer, containerEl: containerEl!, viewerEl: viewerEl!, delayMs: 150 });
      }
    });
    eventBus.on('pagechanging', (e: any) => {
      currentPage = e?.pageNumber ?? currentPage;
      // Modo vertical: o scroll nativo conduz a troca de página — não resetar
      if (navigationMode === 'horizontal') {
        resetFitModeScrollPosition();
        requestAnimationFrame(() => resetFitModeScrollPosition());
      }

      if (zoomCtrl.userScale !== null) {
        // Usuário tem zoom manual: preservar escala ao trocar de página
        const savedScale = zoomCtrl.userScale;
        setTimeout(() => {
          if (viewer) viewer.currentScale = savedScale;
        }, 50);
      } else if (preferredFitMode === 'page-width') {
        zoomCtrl.schedulePageWidth({ viewer, containerEl: containerEl!, viewerEl: viewerEl!, forceRecalculate: false, delayMs: 50 });
      }
      // page-fit: PDF.js mantém a escala automaticamente
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
        containerEl.removeEventListener('touchmove', touchHandlers.onTouchMove);
        containerEl.removeEventListener('touchend', touchHandlers.onTouchEnd);
        containerEl.removeEventListener('touchcancel', touchHandlers.onTouchEnd);
        containerEl.removeEventListener('click', handleFirstInteraction, true);
      }
      try { if (toolbarEl) ro.unobserve(toolbarEl); } catch {}
      viewerAdapterInst?.destroy();
    };
  });

  onDestroy(() => {
    zoomCtrl.cancelScheduled();
    cleanup?.();
    _mqlCleanup?.();
    if (activePdfObjectUrl) {
      objectUrlManager.revoke(activePdfObjectUrl);
      activePdfObjectUrl = null;
    }
    objectUrlManager.revokeAll();
    if (activeForcedObjectUrl) {
      try { URL.revokeObjectURL(activeForcedObjectUrl); } catch {}
      activeForcedObjectUrl = null;
    }
  });

  function zoomIn() {
    if (!viewer) return;
    const newScale = viewer.currentScale * 1.1;
    viewer.currentScale = newScale;
    zoomCtrl.setUserScale(newScale);
  }
  function zoomOut() {
    if (!viewer) return;
    const newScale = viewer.currentScale / 1.1;
    viewer.currentScale = newScale;
    zoomCtrl.setUserScale(newScale);
  }
  function zoomFit() {
    if (!viewer) return;
    zoomCtrl.clearUserScale();
    if (preferredFitMode === 'page-width') {
      setTimeout(() => applyPageWidthZoom(false), 100);
    } else {
      viewer.currentScaleValue = preferredFitMode;
    }
  }
  
  function toggleFitMode() {
    preferredFitMode = preferredFitMode === 'page-fit' ? 'page-width' : 'page-fit';
    zoomCtrl.clearUserScale();
    if (viewer) {
      if (preferredFitMode === 'page-width') {
        setTimeout(() => applyPageWidthZoom(true), 100);
      } else {
        zoomCtrl.invalidateCache();
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
    // Apenas no modo horizontal e page-fit: evita deslocamento residual após swipe/troca de página.
    if (!containerEl || navigationMode !== 'horizontal' || preferredFitMode !== 'page-fit') return;
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
    
    // Recalcular zoom após o DOM atualizar
    if (viewer) {
      zoomCtrl.invalidateCache();
      setTimeout(() => {
        if (!viewer) return;
        if (preferredFitMode === 'page-width') {
          applyPageWidthZoom(true);
        } else {
          viewer.currentScaleValue = 'page-fit';
        }
      }, 150);
    }
  }
  
  // Função para mostrar a barra (desativar fullscreen)
  function showToolbar() {
    isToolbarVisible = true;
    if (containerEl) {
      toolbarHeight = toolbarEl ? toolbarEl.offsetHeight : 60;
      containerEl.style.top = `${toolbarHeight}px`;
    }
    if (eventBus) {
      eventBus.dispatch('resize', {});
    }
    if (viewer) {
      zoomCtrl.invalidateCache();
      setTimeout(() => {
        if (!viewer) return;
        if (preferredFitMode === 'page-width') {
          applyPageWidthZoom(true);
        } else {
          viewer.currentScaleValue = 'page-fit';
        }
      }, 150);
    }
  }
  
  /**
   * Alterna entre modo de navegação horizontal (página única) e vertical (scroll contínuo).
   * Preserva o documento, página atual e escala ao trocar de modo.
   */
  async function toggleNavigationMode() {
    if (!viewerAdapterInst || !_viewerNS || !eventBus) return;

    const newMode = navigationMode === 'horizontal' ? 'vertical' : 'horizontal';
    navigationMode = newMode;
    setNavigationMode(newMode);
    zoomCtrl.invalidateCache();
    zoomCtrl.clearUserScale();

    // Modo vertical sempre começa com page-width para leitura contínua
    if (newMode === 'vertical') {
      preferredFitMode = 'page-width';
      setFitMode('page-width');
    }

    const savedPdfDoc = viewer?.pdfDocument ?? null;
    const savedPage = (viewer as any)?.currentPageNumber ?? 1;

    // Criar novo viewer com o modo escolhido
    viewer = viewerAdapterInst.switchMode(newMode, _viewerNS);
    linkService.setViewer(viewer);

    if (!savedPdfDoc) return;

    // Recarregar documento e restaurar posição
    linkService.setDocument(savedPdfDoc);
    viewer.setDocument(savedPdfDoc);

    const restoreOnInit = () => {
      // Aplicar page-width sempre ao entrar no vertical; no horizontal respeitar preferência
      if (preferredFitMode === 'page-width') {
        zoomCtrl.schedulePageWidth({ viewer, containerEl: containerEl!, viewerEl: viewerEl!, forceRecalculate: true, delayMs: 80 });
      } else {
        viewer.currentScaleValue = preferredFitMode;
      }
      if (savedPage > 1) {
        viewer.currentPageNumber = savedPage;
      }
    };

    // Aguardar primeiro render
    const onPagesinit = () => {
      eventBus.off('pagesinit', onPagesinit);
      restoreOnInit();
    };
    eventBus.on('pagesinit', onPagesinit);
  }

  // ─── Toolbar layer system ─────────────────────────────────────────────────────
  $: toolbarLayerCount = deviceType === 'mobile' ? 3 : 1;
  $: if (activeToolbarLayer > toolbarLayerCount) activeToolbarLayer = 1;

  // Visibility per control based on active layer
  $: showCarousel = deviceType !== 'mobile' || activeToolbarLayer === 1;
  $: showPagePrev = deviceType !== 'mobile' || activeToolbarLayer === 2;
  $: showPageNext = deviceType !== 'mobile' || activeToolbarLayer === 2;
  $: showPageIndicator = deviceType !== 'mobile' || activeToolbarLayer === 1 || activeToolbarLayer === 2;
  $: showNavMode = deviceType !== 'mobile' || activeToolbarLayer === 2;
  $: showZoomMinus = deviceType !== 'mobile' || activeToolbarLayer === 3;
  $: showZoomFit = deviceType !== 'mobile' || activeToolbarLayer === 1 || activeToolbarLayer === 3;
  $: showZoomPlus = deviceType !== 'mobile' || activeToolbarLayer === 3;
  $: showLayerToggle = deviceType === 'mobile';
  $: showBrightness = deviceType !== 'mobile' || activeToolbarLayer === 3;
  // ──────────────────────────────────────────────────────────────────────────────

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

<svelte:head>
  <link rel="stylesheet" href="/pdfjs/web/pdf_viewer.css" />
</svelte:head>

<style>
  /* Travar scroll de html/body no leitor para evitar scroll residual no iOS */
  :global(html), :global(body) {
    margin: 0;
    padding: 0;
    overflow-x: hidden;
    height: 100%;
    overscroll-behavior: none;
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
    /* Impede que o scroll do PDF se propague para a página — crítico no iOS */
    overscroll-behavior: contain;
    /* Scroll suave e inercia no iOS/Safari */
    -webkit-overflow-scrolling: touch;
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

  /* ── Modo vertical (scroll contínuo) ──────────────────────────────────── */
  /* Em modo vertical, as páginas ficam empilhadas verticalmente com gap */
  .container.vertical-nav :global(.pdfViewer) {
    display: flex;
    flex-direction: column;
    /*
     * flex-start em vez de center: quando a página é mais larga que o container
     * (após zoom), ela começa no bordo esquerdo e o overflow vai para a direita,
     * tornando-o acessível via scrollLeft. O margin: 0 auto nas páginas cuida
     * da centralização quando elas cabem no container.
     */
    align-items: flex-start;
    min-width: 100%;
    padding-bottom: 24px !important;
  }
  .container.vertical-nav :global(.pdfViewer .page) {
    margin: 0 auto 8px !important; /* centraliza quando cabe; auto=0 quando overflow */
  }
  /* ───────────────────────────────────────────────────────────────────────── */
  /* ─── Toolbar layout ─────────────────────────────────────────────────────── */
  .toolbar {
    --tbtn-h: 36px;
    --tbtn-px: 10px;
    --tbtn-r: 6px;
    --tbtn-gap: 6px;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: var(--tbtn-gap);
    /* Safe area: recuo para notch/câmera (iOS/Android) */
    padding: env(safe-area-inset-top, 0px) calc(8px + env(safe-area-inset-right, 0px)) 6px calc(8px + env(safe-area-inset-left, 0px));
    background: var(--background-color);
    color: var(--text-light);
    border-bottom: 4px solid var(--gold-color);
    z-index: 1000;
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

  /* Área esquerda: marca + título */
  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    flex: 0 1 auto;
    overflow: hidden;
  }

  /* Área de controles à direita */
  .toolbar-controls {
    display: flex;
    align-items: center;
    gap: var(--tbtn-gap);
    flex: 1 0 auto;
    justify-content: flex-end;
    min-width: 0;
  }

  /* Marca PLPCG */
  .brand {
    white-space: nowrap;
    font-weight: 700;
    font-family: "EB Garamond", Garamond, Georgia, serif;
    font-size: 1.25rem;
    line-height: 1;
    color: var(--placeholder-color);
    letter-spacing: .03em;
    text-shadow: 2px 2px 4px rgba(0,0,0,0.5), 0 0 8px rgba(0,0,0,0.3);
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    position: relative;
    padding: 6px 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .brand .light-beam {
    position: absolute;
    bottom: -2px;
    left: 50%;
    transform: translateX(-50%);
    height: 3px;
    width: calc(100% - 1rem);
    background: linear-gradient(to right,
      transparent 0%,
      rgba(255, 240, 160, 0.95) 15%,
      rgba(255, 230, 120, 1) 30%,
      rgba(255, 220, 100, 1) 50%,
      rgba(255, 230, 120, 1) 70%,
      rgba(255, 240, 160, 0.95) 85%,
      transparent 100%);
    box-shadow:
      0 0 8px rgba(255, 220, 100, 1),
      0 0 16px rgba(255, 220, 100, 0.8),
      0 0 24px rgba(255, 220, 100, 0.6),
      0 2px 6px rgba(255, 220, 100, 0.7);
    border-radius: 50%;
    opacity: 1;
    z-index: 1;
  }

  /* Título */
  .title-wrap {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
    overflow: hidden;
  }
  .title-main {
    font-weight: 600;
    font-size: 0.875rem;
    line-height: 1.1;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
  }
  .title-sub {
    font-size: 0.75rem;
    opacity: .8;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
  }

  /* Botões padronizados */
  .btn {
    height: var(--tbtn-h);
    min-width: var(--tbtn-h);
    padding: 0 var(--tbtn-px);
    border-radius: var(--tbtn-r);
    background: var(--btn-background-color);
    border: 1px solid rgba(255,255,255,0.12);
    color: var(--text-light);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    -webkit-user-select: none;
    box-sizing: border-box;
    flex-shrink: 0;
  }
  .btn:hover { filter: brightness(1.05); }
  .btn .icon {
    width: 18px;
    height: 18px;
    stroke: currentColor;
    flex-shrink: 0;
  }

  /* Indicador de página */
  .indicator {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 0.875rem;
    opacity: .9;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .indicator .current { font-variant-numeric: tabular-nums; }
  .indicator .total { opacity: .9; }

  /* Wrappers GestureButton nas setas de página (.ctrl) */
  .ctrl :global(.gesture-button-wrapper) {
    height: var(--tbtn-h);
    min-width: var(--tbtn-h);
    padding: 0 var(--tbtn-px);
    border-radius: var(--tbtn-r);
    background: var(--btn-background-color);
    border: 1px solid rgba(255,255,255,0.12);
    color: var(--text-light);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    flex-shrink: 0;
  }
  .ctrl :global(.gesture-button-wrapper):hover { filter: brightness(1.05); }
  .ctrl .icon {
    width: 18px;
    height: 18px;
    stroke: currentColor;
    flex-shrink: 0;
  }

  /* zoom-fit: GestureButton preenche toda a área clicável do .btn */
  .btn.zoom-fit {
    padding: 0;
    cursor: pointer;
    position: relative;
  }
  .btn.zoom-fit :global(.gesture-button-wrapper) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-width: var(--tbtn-h);
    padding: 0 var(--tbtn-px);
    position: relative;
    box-sizing: border-box;
  }

  /* nav-mode-toggle active */
  .btn.nav-mode-toggle.active { color: #4fc3f7; }

  /* Botão de camada (layer toggle) */
  .btn.layer-toggle {
    font-weight: 700;
    font-size: 0.875rem;
    min-width: var(--tbtn-h);
  }

  /* brightness-toggle: mesma estrutura de zoom-fit — GestureButton preenche a área do .btn */
  .btn.brightness-toggle {
    padding: 0;
    cursor: pointer;
    position: relative;
  }
  .btn.brightness-toggle :global(.gesture-button-wrapper) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    height: 100%;
    min-width: var(--tbtn-h);
    padding: 0 var(--tbtn-px);
    position: relative;
    box-sizing: border-box;
  }
  .brightness-value {
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* Indicadores de modo no zoom-fit */
  .zoom-fit-indicator {
    position: absolute;
    pointer-events: none;
    transition: all 0.3s ease;
  }
  .zoom-fit-indicator.bar {
    background: white;
    border-radius: 1px;
  }
  .btn.zoom-fit.page-fit .zoom-fit-indicator.page-fit.top,
  .btn.zoom-fit.page-fit .zoom-fit-indicator.page-fit.bottom { opacity: 1; }
  .btn.zoom-fit.page-fit .zoom-fit-indicator.page-fit.top {
    top: 6px; left: 50%; transform: translateX(-50%); width: 16px; height: 2px;
  }
  .btn.zoom-fit.page-fit .zoom-fit-indicator.page-fit.bottom {
    bottom: 6px; left: 50%; transform: translateX(-50%); width: 16px; height: 2px;
  }
  .btn.zoom-fit.page-width .zoom-fit-indicator.page-width.left,
  .btn.zoom-fit.page-width .zoom-fit-indicator.page-width.right { opacity: 1; }
  .btn.zoom-fit.page-width .zoom-fit-indicator.page-width.left {
    left: 6px; top: 50%; transform: translateY(-50%); width: 2px; height: 16px;
  }
  .btn.zoom-fit.page-width .zoom-fit-indicator.page-width.right {
    right: 6px; top: 50%; transform: translateY(-50%); width: 2px; height: 16px;
  }
  .btn.zoom-fit.page-fit .zoom-fit-indicator.page-width.left,
  .btn.zoom-fit.page-fit .zoom-fit-indicator.page-width.right { opacity: 0; width: 0; height: 0; }
  .btn.zoom-fit.page-width .zoom-fit-indicator.page-fit.top,
  .btn.zoom-fit.page-width .zoom-fit-indicator.page-fit.bottom { opacity: 0; width: 0; height: 0; }

  /* Compatibilidade do CarouselNavigator com a toolbar */
  :global(.toolbar-controls .carousel-control) {
    height: var(--tbtn-h, 36px);
    padding: 0 var(--tbtn-px, 10px);
    border-radius: var(--tbtn-r, 6px);
    box-sizing: border-box;
  }
  :global(.toolbar-controls .carousel-navigator .gesture-button-wrapper) {
    display: inline-flex !important;
    align-items: center;
    flex-shrink: 0;
  }

  /* Desktop: botões ligeiramente maiores */
  @media (min-width: 1024px) {
    .toolbar { --tbtn-h: 40px; --tbtn-px: 12px; }
    .brand { font-size: 1.5rem; padding: 8px 10px; }
    .title-main { font-size: 1rem; }
  }

  /* Mobile: ocultar subtítulo para economizar espaço */
  @media (max-width: 767px) {
    .title-sub { display: none; }
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

  <!-- Área esquerda: marca + título (sempre visíveis) -->
  <div class="toolbar-left">
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
  </div>

  <!-- Área de controles: conteúdo varia por camada ativa -->
  <div class="toolbar-controls">

    {#if showCarousel}
      <CarouselNavigator
        currentFile={file}
        carousel={$carousel}
        on:navigate={(e) => navigateToPdf(e.detail.louvor)}
      />
    {/if}

    {#if showPagePrev}
      <div class="ctrl page-nav-prev">
        <GestureButton
          on:click={prevPage}
          on:longpress={goToFirstPage}
          longPressDuration={500}
          hapticFeedback={true}
          preventDefault={true}
          ariaLabel="Página anterior (long press: primeira página)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
        </GestureButton>
      </div>
    {/if}

    {#if showPageIndicator}
      <div class="indicator" aria-label="Página atual e total">
        <span class="current">{currentPage}</span>
        <span class="total">/ {totalPages}</span>
      </div>
    {/if}

    {#if showPageNext}
      <div class="ctrl page-nav-next">
        <GestureButton
          on:click={nextPage}
          on:longpress={goToLastPage}
          longPressDuration={500}
          hapticFeedback={true}
          preventDefault={true}
          ariaLabel="Próxima página (long press: última página)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
          </svg>
        </GestureButton>
      </div>
    {/if}

    {#if showZoomMinus}
      <button class="btn zoom-minus" on:click={zoomOut} aria-label="Diminuir zoom">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14" />
        </svg>
      </button>
    {/if}

    {#if showZoomFit}
      <!-- zoom-fit: GestureButton age como o elemento interativo (sem button aninhado) -->
      <div class="btn zoom-fit" class:page-fit={preferredFitMode === 'page-fit'} class:page-width={preferredFitMode === 'page-width'}>
        <GestureButton
          on:click={zoomFit}
          on:longpress={toggleFitMode}
          longPressDuration={500}
          hapticFeedback={true}
          preventDefault={true}
          ariaLabel="Ajustar zoom (long press: alternar page-fit/page-width)"
        >
          {zoomPercent}%
          <div class="zoom-fit-indicator bar page-fit top"></div>
          <div class="zoom-fit-indicator bar page-fit bottom"></div>
          <div class="zoom-fit-indicator bar page-width left"></div>
          <div class="zoom-fit-indicator bar page-width right"></div>
        </GestureButton>
      </div>
    {/if}

    {#if showZoomPlus}
      <button class="btn zoom-plus" on:click={zoomIn} aria-label="Aumentar zoom">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      </button>
    {/if}

    {#if showBrightness}
      <!-- brightness-toggle: mesma estrutura de zoom-fit — GestureButton preenche o .btn, sem button aninhado -->
      <div class="btn brightness-toggle">
        <GestureButton
          on:click={cycleBrightness}
          on:longpress={resetBrightness}
          longPressDuration={500}
          hapticFeedback={true}
          preventDefault={true}
          ariaLabel="Brilho da página: {readerBrightness}% — toque para alternar entre predefinições, toque longo para voltar ao padrão"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
          </svg>
          <span class="brightness-value">{readerBrightness}%</span>
        </GestureButton>
      </div>
    {/if}

    {#if showNavMode}
      <button
        class="btn nav-mode-toggle"
        class:active={navigationMode === 'vertical'}
        on:click={toggleNavigationMode}
        aria-label={navigationMode === 'vertical' ? 'Mudar para modo horizontal (página única)' : 'Mudar para modo vertical (scroll contínuo)'}
        title={navigationMode === 'vertical' ? 'Modo vertical ativo — clique para horizontal' : 'Modo horizontal ativo — clique para scroll contínuo'}
      >
        {#if navigationMode === 'vertical'}
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 5h18M3 9h18M3 13h18M3 17h18" />
          </svg>
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 4.5v15m6-15v15M3 9h18M3 15h18" />
          </svg>
        {/if}
      </button>
    {/if}

    {#if showLayerToggle}
      <button
        class="btn layer-toggle"
        on:click={cycleToolbarLayer}
        aria-label="Camada {activeToolbarLayer} de {toolbarLayerCount} — clique para alternar controles"
        title="Camada {activeToolbarLayer} de {toolbarLayerCount}"
      >
        {activeToolbarLayer}
      </button>
    {/if}

  </div>
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
    {#if pdfUiState === 'retryableError' && navigator.onLine}
      <button class="error-button" on:click={handleForceOnlineFetch}>
        Buscar online
      </button>
    {/if}
    {#if !navigator.onLine}
      <button class="error-button" on:click={() => window.location.href = '/offline'}>
        Ir para Configuração Offline
      </button>
    {/if}
  </div>
{/if}

<div id="viewerContainer" bind:this={containerEl} class="container {containerClass}" class:vertical-nav={navigationMode === 'vertical'} class:hidden={pdfLoading || pdfError} style:filter="brightness({readerBrightness}%)">
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
  
  <!-- Zonas de navegação: apenas no modo horizontal -->
  {#if navigationMode === 'horizontal'}
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

    <!-- Zona central: long press ativa/desativa toolbar -->
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
  {/if}

  <div bind:this={viewerEl} class="viewer pdfViewer"></div>
  <!-- pdfjs-dist css hooks on .pdfViewer and .viewer -->
  
</div>