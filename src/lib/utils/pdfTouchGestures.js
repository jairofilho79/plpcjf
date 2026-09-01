// Gestos de toque do leitor de PDF: swipe horizontal de página e
// pinch-to-zoom (preview via CSS transform + commit único no PDF.js).
// Responsabilidade única: traduzir eventos touch em "vira página" / "aplica
// zoom" — não decide layout, não sabe de teclado nem de toolbar.
// Extraído de src/routes/leitor/+page.svelte (#23), mesma forma de
// src/lib/components/gestures/TapStrategy.js: o componente injeta o que
// hoje é closure sobre variáveis do componente (getters para o estado que
// muda — viewer/containerEl/viewerEl/modo — mais as funções estáveis
// nextPage/prevPage e o zoomCtrl) e recebe de volta os três handlers DOM.
// O estado do gesto em si (posições de toque, progresso do pinch) passa a
// viver só aqui dentro, privado ao módulo.

const TOUCH_MOVE_THRESHOLD = 10; // pixels

const ENABLE_SWIPE_PAGE_NAV = true;
const SWIPE_MIN_DISTANCE_PX = 80;
const SWIPE_MAX_DURATION_MS = 400;
const SWIPE_HORIZONTAL_RATIO = 1.4;
const SWIPE_MIN_VELOCITY_PX_MS = 0.35;
const SWIPE_COOLDOWN_MS = 250;
const SWIPE_ZOOM_STRICT_SCALE = 1.15;
const SWIPE_EXTRA_DISTANCE_WHEN_ZOOMED_PX = 20;
const SWIPE_EXTRA_VELOCITY_WHEN_ZOOMED = 0.1;

/**
 * @typedef {object} PdfTouchGestureDeps
 * @property {() => any} getViewer - instância atual do PDFViewer (pdf.js); pode ser null/undefined
 * @property {() => HTMLElement | null} getContainerEl
 * @property {() => HTMLElement | null} getViewerEl
 * @property {() => 'horizontal' | 'vertical'} getNavigationMode
 * @property {() => 'page-width' | 'page-fit'} getPreferredFitMode
 * @property {{ cancelScheduled: () => void, setUserScale: (scale: number) => void }} zoomCtrl
 * @property {() => void} nextPage
 * @property {() => void} prevPage
 */

/**
 * Cria os três handlers de touch (onTouchStart/onTouchMove/onTouchEnd) do
 * leitor de PDF. O estado do gesto (posições de início, progresso do pinch)
 * fica encapsulado no closure retornado — cada chamada desta factory tem o
 * seu próprio estado independente.
 * @param {PdfTouchGestureDeps} deps
 */
export function createPdfTouchGestureHandlers(deps) {
  const { getViewer, getContainerEl, getViewerEl, getNavigationMode, getPreferredFitMode, zoomCtrl, nextPage, prevPage } = deps;

  // ── Pinch-to-zoom ──────────────────────────────────────────────────────────
  // A estratégia de preview-then-commit separa o feedback visual (rAF + CSS transform)
  // do re-render do PDF.js (feito uma única vez no final do gesto), dando ~60fps fluidos.
  let pinchInitialDistance = 0;
  let pinchInitialScale = 1;
  let pinchStartFocalX = 0;
  let pinchStartFocalY = 0;
  let pinchStartContentX = 0;
  let pinchStartContentY = 0;
  let pinchFocalXInViewer = 0;
  let pinchFocalYInViewer = 0;
  let pinchCurrentRatio = 1;
  /** @type {number | null} */
  let pinchRafId = null;
  let isPinching = false;

  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let hasMoved = false;

  let swipePageStartX = 0;
  let swipePageStartY = 0;
  let swipePageStartTime = 0;
  let swipePageGestureValid = false;
  let lastSwipePageTurnAt = 0;

  // Calculate distance between two touch points
  /**
   * @param {{ clientX: number, clientY: number }} touch1
   * @param {{ clientX: number, clientY: number }} touch2
   */
  function getTouchDistance(touch1, touch2) {
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Swipe horizontal rápido (1 dedo): dx negativo => próxima página; positivo => anterior.
   * Não substitui tap/long press nas zonas — GestureButton cancela tap se houve movimento grande.
   * @param {TouchEvent} e
   */
  function trySwipePageTurn(e) {
    const viewer = getViewer();
    if (!ENABLE_SWIPE_PAGE_NAV || !viewer) return;
    // Modo vertical: navegação por scroll, não por swipe horizontal
    if (getNavigationMode() === 'vertical') return;
    if (e.type === 'touchcancel') return;
    const t = e.changedTouches[0];
    if (!t) return;

    const now = performance.now();
    if (now - lastSwipePageTurnAt < SWIPE_COOLDOWN_MS) return;

    const dx = t.clientX - swipePageStartX;
    const dy = t.clientY - swipePageStartY;
    const dt = Math.max(now - swipePageStartTime, 1);

    const scale = viewer.currentScale ?? 1;
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

  /**
   * Inicia estado do gesto de pinch ao detectar 2 dedos.
   * Funciona em ambos os modos (horizontal e vertical).
   * @param {TouchEvent} e
   */
  function startPinch(e) {
    const viewer = getViewer();
    const containerEl = getContainerEl();
    if (!viewer || !containerEl) return;
    const touches = e.touches;
    isPinching = true;
    swipePageGestureValid = false;
    // Se havia page-width agendado (pagesloaded/resize/toolbar), ele não deve
    // sobrescrever o zoom manual que o usuário está iniciando agora.
    zoomCtrl.cancelScheduled();
    pinchInitialDistance = getTouchDistance(touches[0], touches[1]);
    pinchInitialScale = viewer.currentScale ?? 1;
    pinchCurrentRatio = 1;

    const containerRect = containerEl.getBoundingClientRect();
    const focalViewportX = (touches[0].clientX + touches[1].clientX) / 2;
    const focalViewportY = (touches[0].clientY + touches[1].clientY) / 2;

    // Posição do focal relativa à área visível do container
    pinchStartFocalX = focalViewportX - containerRect.left;
    pinchStartFocalY = focalViewportY - containerRect.top;

    // Coordenada de conteúdo sob o focal (para calcular scroll ao commitar)
    pinchStartContentX = (containerEl.scrollLeft + pinchStartFocalX) / Math.max(pinchInitialScale, 0.0001);
    pinchStartContentY = (containerEl.scrollTop + pinchStartFocalY) / Math.max(pinchInitialScale, 0.0001);

    // Ponto focal em coordenadas do viewerEl (para transform-origin do CSS preview)
    pinchFocalXInViewer = containerEl.scrollLeft + pinchStartFocalX;
    pinchFocalYInViewer = containerEl.scrollTop + pinchStartFocalY;

    e.preventDefault();
  }

  /**
   * Acumula o novo ratio a cada touchmove e agenda 1 frame rAF para o preview.
   * Nunca chama viewer.currentScale durante o movimento.
   * @param {TouchEvent} e
   */
  function movePinch(e) {
    const viewerEl = getViewerEl();
    const containerEl = getContainerEl();
    if (!isPinching || !viewerEl || !containerEl) return;
    const currentDistance = getTouchDistance(e.touches[0], e.touches[1]);
    if (currentDistance && pinchInitialDistance) {
      pinchCurrentRatio = currentDistance / pinchInitialDistance;
    }
    // Agendar preview apenas se não há rAF pendente
    if (!pinchRafId) {
      pinchRafId = requestAnimationFrame(applyPinchPreview);
    }
    e.preventDefault();
  }

  /**
   * Aplica CSS transform no viewerEl como preview visual barato (~60fps, sem re-render do PDF.js).
   * Chamado via rAF para garantir no máximo 1 update por frame.
   */
  function applyPinchPreview() {
    pinchRafId = null;
    const viewerEl = getViewerEl();
    if (!viewerEl || !isPinching) return;
    const clampedScale = Math.max(0.25, Math.min(4, pinchInitialScale * pinchCurrentRatio));
    const ratio = clampedScale / pinchInitialScale;
    viewerEl.style.transformOrigin = `${pinchFocalXInViewer}px ${pinchFocalYInViewer}px`;
    viewerEl.style.transform = `scale(${ratio})`;
  }

  /**
   * Remove o preview CSS e faz um único commit da escala final no PDF.js.
   * Chamado quando os dedos são levantados (touches.length < 2).
   */
  function commitPinch() {
    if (!isPinching) return;
    isPinching = false;

    // Cancelar rAF pendente
    if (pinchRafId !== null) {
      cancelAnimationFrame(pinchRafId);
      pinchRafId = null;
    }

    const viewerEl = getViewerEl();
    const containerEl = getContainerEl();
    const viewer = getViewer();

    // Remover preview CSS antes do commit
    if (viewerEl) {
      viewerEl.style.transform = '';
      viewerEl.style.transformOrigin = '';
    }

    const finalScale = Math.max(0.25, Math.min(4, pinchInitialScale * pinchCurrentRatio));
    const targetScrollLeft = Math.max(0, pinchStartContentX * finalScale - pinchStartFocalX);
    const targetScrollTop = Math.max(0, pinchStartContentY * finalScale - pinchStartFocalY);
    zoomCtrl.cancelScheduled();

    // CRÍTICO: definir userScale ANTES de viewer.currentScale.
    // O evento pagechanging disparado pelo PDF.js durante a mudança de escala consulta
    // zoomCtrl.userScale para decidir se chama schedulePageWidth. Se userScale for null
    // nesse momento, schedulePageWidth agenda applyPageWidth(~50ms depois), que reseta
    // a escala para page-width e provoca o scroll voltando para (0,0).
    zoomCtrl.setUserScale(finalScale);

    // Único commit no PDF.js — aqui ocorre o re-render
    if (viewer) {
      viewer.currentScale = finalScale;
    }

    // Após o PDF.js reposicionar o conteúdo via scrollPageIntoView, corrigir scroll
    // para preservar o ponto focal entre os dedos. Usar snapshots calculados antes
    // da limpeza do estado, senão a rAF leria variáveis já zeradas e iria para (0,0).
    requestAnimationFrame(() => {
      const el = getContainerEl();
      if (!el) return;
      el.scrollLeft = targetScrollLeft;
      el.scrollTop = targetScrollTop;
    });

    // Limpar estado do pinch
    pinchInitialDistance = 0;
    pinchInitialScale = 1;
    pinchCurrentRatio = 1;
    pinchStartFocalX = 0;
    pinchStartFocalY = 0;
    pinchStartContentX = 0;
    pinchStartContentY = 0;
    pinchFocalXInViewer = 0;
    pinchFocalYInViewer = 0;
  }
  // ──────────────────────────────────────────────────────────────────────────

  // Handle touch start for gestures
  /** @param {TouchEvent} e */
  function onTouchStart(e) {
    const viewer = getViewer();
    const containerEl = getContainerEl();
    if (!viewer || !containerEl) return;

    // PINCH (2 dedos) — funciona em ambos os modos
    if (e.touches.length === 2) {
      startPinch(e);
      return;
    }

    // Modo vertical: gestos de 1 dedo são nativos — scroll/pan do browser
    if (getNavigationMode() === 'vertical') return;

    const touches = e.touches;

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
  /** @param {TouchEvent} e */
  function onTouchMove(e) {
    const viewer = getViewer();
    const containerEl = getContainerEl();
    if (!viewer || !containerEl) return;

    // PINCH (2 dedos) — funciona em ambos os modos
    if (e.touches.length === 2 && isPinching) {
      movePinch(e);
      return;
    }

    // Modo vertical: gestos de 1 dedo são nativos — scroll/pan do browser
    if (getNavigationMode() === 'vertical') return;

    const touches = e.touches;

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
      const currentScale = viewer.currentScale ?? 1;
      if (getPreferredFitMode() === 'page-fit' && currentScale <= 1.02) {
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
  /** @param {TouchEvent} e */
  function onTouchEnd(e) {
    const viewer = getViewer();
    const containerEl = getContainerEl();
    if (!viewer || !containerEl) return;

    // PINCH terminou (dedos levantados abaixo de 2)
    if (isPinching && e.touches.length < 2) {
      commitPinch();
      swipePageGestureValid = false;
      touchStartX = 0;
      touchStartY = 0;
      touchStartTime = 0;
      hasMoved = false;
      return;
    }

    // Modo vertical: gestos de 1 dedo são nativos
    if (getNavigationMode() === 'vertical') return;

    const touches = e.touches;

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

  return { onTouchStart, onTouchMove, onTouchEnd };
}
