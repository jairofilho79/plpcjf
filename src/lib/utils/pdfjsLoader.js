/**
 * PDF.js Loader - Módulo centralizado para carregamento inteligente do PDF.js
 * 
 * Implementa:
 * - Pré-carregamento com prioridades baseado em rota
 * - Carregamento progressivo (core → worker → viewer)
 * - Verificação de conexão (não pré-carregar em modo economia)
 * - Prefetch de PDFs
 * - Gerenciamento de estado global
 */

const PDFJS_VERSION = '4.8.69';
const PRELOAD_PRIORITIES = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  NONE: 'none'
};

let preloadPromise = null;
let preloadState = {
  core: null,
  viewer: null,
  workerUrl: null,
  coreUrl: null,
  viewerUrl: null,
  loaded: false,
  loading: false,
  partial: false // true se apenas core foi carregado
};

// Polyfill para requestIdleCallback (Safari)
const requestIdleCallback = typeof window !== 'undefined' && window.requestIdleCallback
  ? window.requestIdleCallback
  : (callback, options) => {
      const timeout = options?.timeout || 2000;
      return setTimeout(() => {
        callback({
          didTimeout: false,
          timeRemaining: () => 5
        });
      }, Math.min(timeout, 1));
    };

/**
 * Determina prioridade de pré-carregamento baseado na rota
 * @param {string} pathname - Caminho da rota atual
 * @returns {string} Prioridade (high/medium/low/none)
 */
export function getPdfJsPriority(pathname) {
  if (pathname.startsWith('/leitor')) return PRELOAD_PRIORITIES.HIGH;
  if (pathname === '/' || pathname === '/biblioteca') return PRELOAD_PRIORITIES.MEDIUM;
  return PRELOAD_PRIORITIES.LOW;
}

/**
 * Verifica se deve pré-carregar baseado em condições
 * @param {string} priority - Prioridade de pré-carregamento
 * @param {NetworkInformation} connection - Informações de conexão (opcional)
 * @returns {boolean} true se deve pré-carregar
 */
export function shouldPreload(priority, connection) {
  if (priority === PRELOAD_PRIORITIES.NONE) return false;
  
  // Não pré-carregar em modo economia de dados
  if (connection?.saveData) {
    console.log('[PDF.js Loader] Modo economia de dados ativo - pré-carregamento desabilitado');
    return false;
  }
  
  // Não pré-carregar em conexões muito lentas
  if (connection?.effectiveType === 'slow-2g') {
    console.log('[PDF.js Loader] Conexão muito lenta - pré-carregamento desabilitado');
    return false;
  }
  
  return true;
}

/**
 * Atualiza progresso do carregamento (dispara evento customizado)
 * @param {number} percent - Percentual de progresso (0-1)
 * @param {string} message - Mensagem de status
 */
function updateProgress(percent, message) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pdfjs-progress', {
      detail: { percent, message }
    }));
  }
}

/**
 * Pré-carrega PDF.js com prioridade especificada
 * @param {Object} options - Opções de pré-carregamento
 * @param {string} options.priority - Prioridade (high/medium/low)
 * @param {boolean} options.showProgress - Se deve disparar eventos de progresso
 * @param {boolean} options.loadViewer - Se deve carregar viewer (padrão: true para high, false para outros)
 * @returns {Promise<Object>} Promise que resolve com módulos carregados
 */
export async function preloadPdfJs(options = {}) {
  const { 
    priority = PRELOAD_PRIORITIES.MEDIUM, 
    showProgress = false,
    loadViewer = priority === PRELOAD_PRIORITIES.HIGH
  } = options;
  
  // Se já está carregado completamente, retornar
  if (preloadState.loaded && (!loadViewer || preloadState.viewer)) {
    return window.__pdfjsPreloaded;
  }
  
  // Se já está carregando, retornar promise existente
  if (preloadState.loading && preloadPromise) {
    return preloadPromise;
  }
  
  preloadState.loading = true;
  
  // Carregamento progressivo
  preloadPromise = (async () => {
    try {
      // Etapa 1: Core (necessário primeiro)
      if (showProgress) updateProgress(0.3, 'Carregando PDF.js...');
      
      if (!preloadState.core) {
        const coreUrlMod = await import('pdfjs-dist/build/pdf.mjs?url');
        const coreMod = await import(/* @vite-ignore */ coreUrlMod.default);
        const core = coreMod?.default ?? coreMod;
        
        preloadState.core = core;
        preloadState.coreUrl = coreUrlMod.default;
      }
      
      // Etapa 2: Worker (não bloqueia)
      if (showProgress) updateProgress(0.6, 'Carregando worker...');
      
      if (!preloadState.workerUrl) {
        const workerUrlMod = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        preloadState.workerUrl = workerUrlMod.default;
      }
      
      // Etapa 3: Viewer (pode ser lazy loaded)
      if (loadViewer && !preloadState.viewer) {
        if (showProgress) updateProgress(0.9, 'Carregando viewer...');
        
        const viewerUrlMod = await import('pdfjs-dist/web/pdf_viewer.mjs?url');
        const viewerNS = await import(/* @vite-ignore */ viewerUrlMod.default);
        
        preloadState.viewer = viewerNS;
        preloadState.viewerUrl = viewerUrlMod.default;
      }
      
      // Armazenar globalmente
      window.__pdfjsPreloaded = {
        core: preloadState.core,
        viewer: preloadState.viewer,
        workerUrl: preloadState.workerUrl,
        coreUrl: preloadState.coreUrl,
        viewerUrl: preloadState.viewerUrl,
        version: PDFJS_VERSION,
        partial: !preloadState.viewer
      };
      
      preloadState.loaded = !loadViewer || !!preloadState.viewer;
      preloadState.partial = !preloadState.viewer;
      preloadState.loading = false;
      
      if (showProgress) updateProgress(1, 'Concluído');
      
      // Disparar evento
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pdfjs-preloaded', {
          detail: { partial: preloadState.partial }
        }));
      }
      
      console.log('[PDF.js Loader] PDF.js pré-carregado', preloadState.partial ? '(parcial)' : '(completo)');
      
      return window.__pdfjsPreloaded;
    } catch (error) {
      preloadState.loading = false;
      console.error('[PDF.js Loader] Erro ao pré-carregar:', error);
      throw error;
    }
  })();
  
  return preloadPromise;
}

/**
 * Carrega viewer se ainda não foi carregado
 * @returns {Promise<Object>} Promise que resolve com viewer
 */
export async function loadPdfJsViewer() {
  if (preloadState.viewer) {
    return preloadState.viewer;
  }
  
  // Se core não foi carregado, carregar tudo
  if (!preloadState.core) {
    return preloadPdfJs({ priority: PRELOAD_PRIORITIES.HIGH, loadViewer: true });
  }
  
  // Carregar apenas viewer
  const viewerUrlMod = await import('pdfjs-dist/web/pdf_viewer.mjs?url');
  const viewerNS = await import(/* @vite-ignore */ viewerUrlMod.default);
  
  preloadState.viewer = viewerNS;
  preloadState.viewerUrl = viewerUrlMod.default;
  
  if (window.__pdfjsPreloaded) {
    window.__pdfjsPreloaded.viewer = viewerNS;
    window.__pdfjsPreloaded.viewerUrl = viewerUrlMod.default;
    window.__pdfjsPreloaded.partial = false;
  }
  
  preloadState.loaded = true;
  preloadState.partial = false;
  
  return viewerNS;
}

/**
 * Prefetch de PDF usando link rel=prefetch
 * @param {string} pdfPath - Caminho do PDF (relativo ou absoluto)
 */
export function prefetchPdf(pdfPath) {
  if (typeof document === 'undefined') return;
  
  // Normalizar caminho
  const normalizedPath = pdfPath.startsWith('/') ? pdfPath : `/${pdfPath}`;
  
  // Verificar se já existe link de prefetch
  const existing = document.querySelector(`link[rel="prefetch"][href="${normalizedPath}"]`);
  if (existing) return;
  
  // Verificar limite de prefetches simultâneos (máximo 10)
  const existingPrefetches = document.querySelectorAll('link[rel="prefetch"]').length;
  if (existingPrefetches >= 10) {
    console.warn('[PDF.js Loader] Limite de prefetches atingido');
    return;
  }
  
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'document';
  link.href = normalizedPath;
  document.head.appendChild(link);
  
  console.log('[PDF.js Loader] Prefetch de PDF:', normalizedPath);
}

/**
 * Setup prefetch inteligente para cards
 * @param {HTMLElement} cardElement - Elemento do card
 * @param {string} pdfPath - Caminho do PDF
 */
export function setupCardPrefetch(cardElement, pdfPath) {
  if (typeof window === 'undefined' || !cardElement) return;
  
  // Prefetch no hover
  let hoverTimeout;
  const handleMouseEnter = () => {
    hoverTimeout = setTimeout(() => {
      // Prefetch PDF.js se ainda não carregado
      if (!window.__pdfjsPreloaded) {
        preloadPdfJs({ priority: PRELOAD_PRIORITIES.LOW });
      }
      // Prefetch PDF
      prefetchPdf(pdfPath);
    }, 100);
  };
  
  const handleMouseLeave = () => {
    clearTimeout(hoverTimeout);
  };
  
  cardElement.addEventListener('mouseenter', handleMouseEnter, { once: true });
  cardElement.addEventListener('mouseleave', handleMouseLeave);
  
  // Prefetch quando entra no viewport
  if (typeof IntersectionObserver !== 'undefined') {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // Prefetch PDF.js se ainda não carregado
          if (!window.__pdfjsPreloaded) {
            preloadPdfJs({ priority: PRELOAD_PRIORITIES.LOW });
          }
          // Prefetch PDF
          prefetchPdf(pdfPath);
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '200px' });
    
    observer.observe(cardElement);
    
    // Cleanup quando elemento for removido
    return () => {
      observer.disconnect();
      cardElement.removeEventListener('mouseenter', handleMouseEnter);
      cardElement.removeEventListener('mouseleave', handleMouseLeave);
    };
  }
  
  return () => {
    clearTimeout(hoverTimeout);
    cardElement.removeEventListener('mouseenter', handleMouseEnter);
    cardElement.removeEventListener('mouseleave', handleMouseLeave);
  };
}

/**
 * Carrega PDF.js completo (core + viewer) - usado no leitor
 * @param {Object} options - Opções
 * @param {boolean} options.showProgress - Se deve mostrar progresso
 * @returns {Promise<Object>} Promise que resolve com módulos carregados
 */
export async function loadPdfJsComplete(options = {}) {
  const { showProgress = false } = options;
  
  // Se já está carregado completamente, retornar
  if (preloadState.loaded && preloadState.viewer) {
    return window.__pdfjsPreloaded;
  }
  
  // Se está parcialmente carregado, carregar viewer
  if (preloadState.core && !preloadState.viewer) {
    await loadPdfJsViewer();
    return window.__pdfjsPreloaded;
  }
  
  // Carregar tudo
  return preloadPdfJs({ 
    priority: PRELOAD_PRIORITIES.HIGH, 
    loadViewer: true,
    showProgress 
  });
}

/**
 * Polyfill para requestIdleCallback (exportado para uso externo)
 */
export { requestIdleCallback };

