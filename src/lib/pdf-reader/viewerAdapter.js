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
   * Recria o viewer com um novo modo. Passa a responsabilidade de restaurar
   * documento/página/escala ao chamador (via pagesinit ou diretamente).
   *
   * @param {'horizontal' | 'vertical'} newMode
   * @param {any} viewerNS
   * @returns {any} novo viewer PDF.js criado
   */
  switchMode(newMode, viewerNS) {
    this.mode = newMode;
    if (this.viewerEl) this.viewerEl.replaceChildren();
    return this.create(viewerNS);
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
