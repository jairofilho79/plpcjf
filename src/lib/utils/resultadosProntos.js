/**
 * A condição que destranca a correção de `?pagina=` — uma só, para as duas
 * páginas que paginam louvores (`/` e `/biblioteca`).
 *
 * Existe como módulo próprio pelo mesmo motivo de `estadosVazios.js`:
 * `node --test` não monta componente Svelte, então a única parte desta
 * decisão que dá para cobrir automaticamente é o predicado. Quem guarda a
 * **trava** em si é cada página, porque uma trava é estado mutável que vive
 * entre passadas reativas do Svelte — isso não é função pura e não caberia
 * aqui (ver o comentário no ponto onde cada página a seta).
 *
 * Por que as três condições, e não só "o catálogo carregou": enquanto
 * `classificationFilters.aplicarPadrao(...)` não tiver rodado, a seleção de
 * Arranjos está vazia por transiente, não por escolha; a lista renderizada é
 * vazia, `currentPage` desaba para 1, e corrigir a URL nesse instante apagaria
 * o `?pagina=3` de um deep link em aba fria. É a corrida D-3, achada em
 * navegador. A terceira condição — ter pelo menos um Arranjo selecionado — é
 * justamente o que garante que `aplicarPadrao` (ou o `?arranjo=` do link) já
 * chegou. Afrouxá-la reintroduz o defeito.
 */

/**
 * Houve, neste instante, uma filtragem real: catálogo carregado, com conteúdo,
 * e pelo menos um Arranjo selecionado.
 *
 * @param {Object} entrada
 * @param {boolean} entrada.carregado - O catálogo terminou de carregar
 * @param {number} entrada.totalCatalogo - Quantos louvores o catálogo tem ao todo
 * @param {number} entrada.totalArranjos - Quantos Arranjos estão selecionados
 * @returns {boolean}
 */
export function houveFiltragemReal({ carregado, totalCatalogo, totalArranjos }) {
  return Boolean(carregado) && totalCatalogo > 0 && totalArranjos > 0;
}
