/**
 * ViewerAdapter
 *
 * Abstrai a criação e o ciclo de vida dos viewers do PDF.js,
 * permitindo alternar entre modo horizontal (PDFSinglePageViewer)
 * e modo vertical contínuo (PDFViewer) sem recarregar o PDF.
 *
 * Uso:
 *   const adapter = new ViewerAdapter({ container, viewerEl, eventBus, linkService, mode });
 *   const viewer = adapter.create(viewerNS); // retorna o viewer PDF.js criado
 *   adapter.destroy();                       // limpa DOM e libera referência
 */
export class ViewerAdapter {
  /**
   * @param {{
   *   container: HTMLElement,
   *   viewerEl: HTMLElement,
   *   eventBus: any,
   *   linkService: any,
   *   mode: 'horizontal' | 'vertical'
   * }} opts
   */
  constructor({ container, viewerEl, eventBus, linkService, mode }) {
    this.container = container;
    this.viewerEl = viewerEl;
    this.eventBus = eventBus;
    this.linkService = linkService;
    this.mode = mode;
    /** @type {any | null} Instância do viewer PDF.js (PDFSinglePageViewer ou PDFViewer) */
    this.instance = null;
  }

  /**
   * Cria e retorna a instância do viewer PDF.js adequada ao modo configurado.
   *
   * @param {any} viewerNS Namespace exportado pelo pdf_viewer.mjs (contém as classes PDF.js)
   * @returns {any} viewer PDF.js criado
   */
  create(viewerNS) {
    this.destroy();

    const commonOpts = {
      container: this.container,
      viewer: this.viewerEl,
      eventBus: this.eventBus,
      linkService: this.linkService,
      useOnlyCssZoom: true,
      textLayerMode: 2,
    };

    if (this.mode === 'vertical') {
      // PDFViewer: renderiza todas as páginas em scroll contínuo
      this.instance = new viewerNS.PDFViewer(commonOpts);
    } else {
      // PDFSinglePageViewer: exibe uma página por vez (modo padrão/horizontal)
      this.instance = new viewerNS.PDFSinglePageViewer(commonOpts);
    }

    return this.instance;
  }

  /**
   * Recria o viewer com um novo modo, preservando o documento atual e a página.
   * Deve ser chamado depois que um documento já foi carregado.
   *
   * @param {'horizontal' | 'vertical'} newMode
   * @param {any} viewerNS
   * @param {{ pdfDocument: any, currentPage: number, currentScale: number }} state Estado para restaurar
   * @returns {any} novo viewer PDF.js
   */
  switchMode(newMode, viewerNS, { pdfDocument, currentPage, currentScale }) {
    this.mode = newMode;

    // Limpar DOM do viewerEl antes de recriar
    if (this.viewerEl) this.viewerEl.replaceChildren();

    const viewer = this.create(viewerNS);

    // Restaurar documento e posição
    if (pdfDocument) {
      this.linkService.setDocument(pdfDocument);
      this.linkService.setViewer(viewer);
      viewer.setDocument(pdfDocument);

      // Restaurar página e escala após o primeiro render
      this.eventBus.on('pagesinit', () => {
        if (currentScale && currentScale > 0) {
          viewer.currentScale = currentScale;
        }
        if (currentPage && currentPage > 1) {
          viewer.currentPageNumber = currentPage;
        }
      }, { once: true });
    }

    return viewer;
  }

  /**
   * Destrói o viewer atual e limpa o conteúdo do DOM.
   * Seguro chamar múltiplas vezes.
   */
  destroy() {
    if (!this.instance) return;
    try {
      if (this.viewerEl) this.viewerEl.replaceChildren();
    } catch {}
    this.instance = null;
  }
}
