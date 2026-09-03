/**
 * Deixa o leitor pronto para abrir sem rede — sem abrir aba nenhuma.
 *
 * Antes, "preparar o leitor" era literalmente `window.open('/leitor?...')` no
 * meio do clique de "Disponibilizar offline": a aba nova roubava o foco e
 * mandava para segundo plano exatamente a aba que estava baixando 800 MB. No
 * celular, uma aba em segundo plano é estrangulada pelo navegador — e é por
 * isso que o download "ficava lento ou parado". A aba servia só para marcar
 * `IS_LEITOR_OFFLINE` e para aquecer o que o leitor pede em runtime.
 *
 * O que o leitor realmente precisa ter em cache:
 *  - os chunks do PDF.js, que vêm de `/_app/immutable/` e já entram no
 *    precache do Service Worker (`build`);
 *  - `/pdfjs/web/pdf_viewer.css` e as imagens que essa folha referencia
 *    (ícones, cursores, spinner), que ficam em `static/`.
 *
 * Este módulo garante o segundo grupo lendo o próprio CSS: a lista de imagens
 * sai do `url(...)` da folha, não de uma cópia à mão que envelhece sozinha
 * quando o pdfjs-dist é atualizado.
 *
 * Só importa por caminho relativo e não toca em `$app/*`: precisa rodar sob
 * `node --test`.
 */

/** Folha que `leitor/+page.svelte` carrega por `<link>`. */
export const PDFJS_VIEWER_CSS = '/pdfjs/web/pdf_viewer.css';

/** Base para resolver os `url(images/...)` de dentro da folha. */
const PDFJS_WEB_BASE = '/pdfjs/web/';

/**
 * URLs das imagens que a folha de estilo referencia, na ordem em que aparecem.
 *
 * Ignora `data:` e qualquer coisa absoluta: só interessa o que é servido pela
 * própria origem e portanto pode faltar quando não há rede.
 *
 * @param {string} css
 * @param {string} [base]
 * @returns {string[]}
 */
export function imagensDaFolhaDeEstilo(css, base = PDFJS_WEB_BASE) {
  if (!css) return [];

  const achadas = new Set();
  const padrao = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

  for (const [, , alvo] of css.matchAll(padrao)) {
    const limpo = alvo.trim();
    if (!limpo) continue;
    // `data:` e absolutas não são desta origem; `#alttext-manager-mask` e afins
    // são referências a fragmentos SVG dentro da própria folha, não arquivos —
    // pedi-las à rede rendia um 404 contado como falha a cada preparação.
    if (/^(data:|https?:|\/\/|#)/i.test(limpo)) continue;
    achadas.add(limpo.startsWith('/') ? limpo : `${base}${limpo}`);
  }

  return [...achadas];
}

/**
 * Garante no cache do app tudo que o leitor pede de `static/` em runtime.
 *
 * Nunca lança: é uma etapa de melhor esforço dentro de um download que já
 * levou minutos. Devolve `pronto: false` em vez de derrubar quem chamou.
 *
 * @param {Object} deps
 * @param {any} deps.cache Cache aberto (o do app)
 * @param {typeof fetch} deps.fetchImpl
 * @param {(valor: string) => void} deps.setFlag grava IS_LEITOR_OFFLINE
 * @returns {Promise<{ pronto: boolean, guardadas: number, falharam: number }>}
 */
export async function prepararLeitorOffline({ cache, fetchImpl, setFlag }) {
  let guardadas = 0;
  let falharam = 0;

  if (!cache) return { pronto: false, guardadas, falharam };

  /**
   * Busca e guarda uma URL; devolve o texto quando pedido.
   * @param {string} url
   * @param {boolean} [querTexto]
   * @returns {Promise<string | null>}
   */
  async function guardar(url, querTexto = false) {
    try {
      const jaTem = await cache.match(url);
      if (jaTem) {
        // Já guardada numa execução anterior: relê do cache só se o texto for
        // preciso, e nunca gasta rede de novo.
        return querTexto && typeof jaTem.text === 'function' ? await jaTem.text() : null;
      }

      const resposta = await fetchImpl(url);
      if (!resposta || !resposta.ok) {
        falharam++;
        return null;
      }

      // O clone vai para o cache e o original é lido: uma resposta só pode
      // ser consumida uma vez, e é o corpo do original que ainda é preciso.
      await cache.put(url, resposta.clone ? resposta.clone() : resposta);
      guardadas++;
      return querTexto ? await resposta.text() : null;
    } catch {
      falharam++;
      return null;
    }
  }

  let css = await guardar(PDFJS_VIEWER_CSS, true);

  // A folha só conta como pronta se está no cache — guardada agora ou antes.
  let temFolha = false;
  try {
    temFolha = !!(await cache.match(PDFJS_VIEWER_CSS));
  } catch {
    temFolha = false;
  }

  if (temFolha && !css) {
    // Estava em cache mas sem texto legível: as imagens já devem ter sido
    // guardadas na execução que a colocou lá.
    css = '';
  }

  for (const imagem of imagensDaFolhaDeEstilo(css || '')) {
    await guardar(imagem);
  }

  if (temFolha) setFlag('true');

  return { pronto: temFolha, guardadas, falharam };
}
