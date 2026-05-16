/**
 * ZoomController
 *
 * Encapsula o estado e o cálculo de zoom do leitor de PDF.
 * - Gerencia o cache da escala de page-width para evitar recalcular a cada troca de página.
 * - Separa "modo de ajuste" (page-fit/page-width) de "escala manual do usuário".
 * - Expõe métodos para aplicar e agendar o ajuste de página.
 */
export class ZoomController {
  constructor() {
    /** @type {number | null} Escala calculada para page-width; null = stale */
    this.cachedPageWidthScale = null;
    /** @type {number} Largura do container na última vez que cachedPageWidthScale foi calculado */
    this.lastContainerWidth = 0;
    /** @type {boolean} Flag para bloquear reagendamentos durante ajuste manual */
    this.isManuallyAdjusting = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this._adjustTimeout = null;
    /**
     * Escala manual do usuário (pinch, +/-, atalhos de teclado).
     * null = sem override → usar fit mode.
     * @type {number | null}
     */
    this.userScale = null;
  }

  /** Invalida o cache de escala (ex: resize, troca de modo). */
  invalidateCache() {
    this.cachedPageWidthScale = null;
  }

  /**
   * Define uma escala manual do usuário, desvinculando do fit mode.
   * @param {number | null} scale
   */
  setUserScale(scale) {
    this.userScale = typeof scale === 'number' && scale > 0 ? scale : null;
  }

  /** Limpa a escala manual, voltando ao fit mode. */
  clearUserScale() {
    this.userScale = null;
  }

  /** Cancela qualquer ajuste agendado. */
  cancelScheduled() {
    if (this._adjustTimeout) {
      clearTimeout(this._adjustTimeout);
      this._adjustTimeout = null;
    }
  }

  /**
   * Aplica imediatamente o zoom de page-width, calculando a escala necessária
   * para que a página preencha a largura disponível do container.
   *
   * @param {{
   *   viewer: any,
   *   containerEl: HTMLElement,
   *   viewerEl: HTMLElement,
   *   forceRecalculate?: boolean
   * }} params
   */
  applyPageWidth({ viewer, containerEl, viewerEl, forceRecalculate = false }) {
    if (!viewer || !containerEl || !viewerEl) return;

    const currentContainerWidth = containerEl.clientWidth;

    // Reaproveitar escala em cache se o container não mudou de largura
    if (
      !forceRecalculate &&
      this.cachedPageWidthScale !== null &&
      this.lastContainerWidth === currentContainerWidth
    ) {
      this.isManuallyAdjusting = true;
      viewer.currentScale = this.cachedPageWidthScale;
      setTimeout(() => { this.isManuallyAdjusting = false; }, 100);
      return;
    }

    // Obter a largura natural da página em escala 1.0
    const pageView = viewer._pages?.[viewer.currentPageNumber - 1];
    if (!pageView) return;
    const pdfPage = pageView.pdfPage;
    if (!pdfPage) return;

    const naturalViewport = pdfPage.getViewport({ scale: 1.0 });
    const naturalWidth = naturalViewport.width;

    // Calcular largura disponível (considerar scrollbar em desktop)
    const scrollbarWidth = containerEl.offsetWidth - containerEl.clientWidth;
    const isMobileOrOverlayScrollbar = window.innerWidth <= 768 || scrollbarWidth === 0;
    let availableWidth = currentContainerWidth;
    if (!isMobileOrOverlayScrollbar && scrollbarWidth === 0) {
      availableWidth -= 17;
    }

    const targetScale = availableWidth / naturalWidth;
    if (targetScale <= 0) return;

    this.isManuallyAdjusting = true;
    viewer.currentScale = targetScale;

    // Verificar e corrigir após render se a largura real diferir
    setTimeout(() => {
      if (!viewerEl || !containerEl || !viewer) {
        this.isManuallyAdjusting = false;
        return;
      }
      const pageEl = /** @type {HTMLElement | null} */ (viewerEl.querySelector('.page'));
      if (pageEl) {
        const actualRenderedWidth = pageEl.offsetWidth;
        const desiredWidth = containerEl.clientWidth;
        if (Math.abs(actualRenderedWidth - desiredWidth) > 1) {
          const correctionFactor = desiredWidth / actualRenderedWidth;
          const correctedScale = viewer.currentScale * correctionFactor;
          viewer.currentScale = correctedScale;
          this.cachedPageWidthScale = correctedScale;
        } else {
          this.cachedPageWidthScale = viewer.currentScale;
        }
        this.lastContainerWidth = currentContainerWidth;
      }
      this.isManuallyAdjusting = false;
    }, 100);
  }

  /**
   * Agenda o ajuste de page-width com debounce.
   *
   * @param {{
   *   viewer: any,
   *   containerEl: HTMLElement,
   *   viewerEl: HTMLElement,
   *   forceRecalculate?: boolean,
   *   delayMs?: number
   * }} params
   */
  schedulePageWidth({ viewer, containerEl, viewerEl, forceRecalculate = false, delayMs = 150 }) {
    this.cancelScheduled();
    this._adjustTimeout = setTimeout(() => {
      this.applyPageWidth({ viewer, containerEl, viewerEl, forceRecalculate });
    }, delayMs);
  }
}
