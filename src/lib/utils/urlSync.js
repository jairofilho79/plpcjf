/**
 * Ponte entre a camada pura de parâmetros de URL (urlParams.js) e a navegação
 * do SvelteKit. Todo o cálculo mora em urlParams.js, que roda sob `node --test`;
 * aqui só ficam as duas coisas que exigem o framework: ler a URL corrente de
 * `$app/stores` e navegar com `goto`.
 *
 * As assinaturas exportadas são as mesmas de sempre — os dezenove pontos de uso
 * não mudam.
 */

import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { get } from 'svelte/store';
import { construirQueryAtualizada, podeEscreverNaUrl } from './urlParams.js';

export { serializeArrayParam, deserializeArrayParam, parseUrlParams } from './urlParams.js';

/**
 * Atualiza os params da URL mantendo os existentes e adicionando/atualizando os
 * novos. Remove params vazios ou com valores padrão.
 * @param {Object} newParams - Objeto com os params a atualizar
 * @param {Object} options - Opções
 * @param {string[]} [options.defaultMateriais] - Materiais padrão (não vão para a URL se todos selecionados)
 * @param {string} [options.defaultComoAbrir] - Valor padrão de comoAbrir (normalmente 'leitor')
 * @param {boolean} [options.replaceState] - Se true, usa replaceState (default: true)
 */
export function updateUrlParams(newParams, options = {}) {
  const { replaceState = true } = options;

  const currentUrl = get(page);
  if (!currentUrl || !currentUrl.url || !currentUrl.url.pathname) {
    console.warn('updateUrlParams: currentUrl inválido', currentUrl);
    return;
  }

  const pathname = currentUrl.url.pathname || '/';

  // #21: nenhuma escrita de URL em /leitor. A guarda mora aqui, e não só nos
  // chamadores, porque as stores globais (filters, classificationFilters,
  // pdfViewer) escrevem a partir de um page.subscribe de módulo, que roda em
  // qualquer rota.
  if (!podeEscreverNaUrl(pathname)) {
    return;
  }

  const newSearch = construirQueryAtualizada(currentUrl.url.search || '', newParams, options);
  const newUrl = pathname + (newSearch ? `?${newSearch}` : '');

  // replaceState para não empilhar cada filtro no histórico do navegador.
  goto(newUrl, {
    replaceState,
    noScroll: true,
    keepFocus: true
  });
}
