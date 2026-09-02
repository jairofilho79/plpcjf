/**
 * As duas perguntas que a paginação de louvores faz antes de mexer na URL —
 * uma só versão delas, para as duas páginas que paginam (`/` e `/biblioteca`).
 *
 * Existe como módulo próprio pelo mesmo motivo de `estadosVazios.js`:
 * `node --test` não monta componente Svelte, então a parte desta decisão que
 * dá para cobrir automaticamente são os predicados. Quem guarda a **trava** em
 * si é cada página, porque uma trava é estado mutável que vive entre passadas
 * reativas do Svelte — isso não é função pura e não caberia aqui (ver o
 * comentário no ponto onde cada página a seta).
 *
 * São dois predicados porque são duas perguntas diferentes, e confundi-las é
 * como o defeito nasce:
 *
 * - `houveFiltragemReal` — "há AGORA uma lista produzida por filtro de
 *   verdade?". Reversível. É o gatilho certo para "o critério de filtro
 *   mudou, volte para a página 1", que é sobre a transição de agora.
 * - `podeCorrigirPaginacao` — "a contagem de páginas que estou vendo já é a
 *   definitiva, ou ainda é o transiente do carregamento?". É o que destranca a
 *   correção de `?pagina=`, e é o predicado da trava.
 *
 * Por que `podeCorrigirPaginacao` não é só "o catálogo carregou": enquanto
 * `classificationFilters.aplicarPadrao(...)` não tiver rodado, a seleção de
 * Arranjos está vazia por **transiente**, não por escolha; a lista renderizada
 * é vazia, `currentPage` desaba para 1, e corrigir a URL nesse instante
 * apagaria o `?pagina=3` de um deep link em aba fria. É a corrida D-3, achada
 * em navegador.
 *
 * E por que ele aceita `selecaoDeArranjoDefinida`: existe um segundo jeito de a
 * seleção estar vazia, que **não** é transiente — a URL dizer explicitamente
 * qual é a seleção e essa seleção ser nenhuma (`?arranjo=` sem valores, estado
 * real e alcançável pela interface, gravado de propósito por
 * `urlParams.js`). Nesse caso `aplicarPadrao` é pulado de propósito nas duas
 * páginas (guarda `!estadoAtual.temArranjo`), a seleção fica vazia para sempre,
 * e não há nada por que esperar: a lista vazia já é a definitiva. Distinguir os
 * dois casos é o que permite corrigir um `?arranjo=&pagina=999` recebido por
 * link **sem** afrouxar a proteção da D-3 — os dois estados são diferentes e o
 * `temArranjo` da URL os separa desde antes de `instance()` rodar.
 */

/**
 * Há, neste instante, uma filtragem real: catálogo carregado, com conteúdo, e
 * pelo menos um Arranjo selecionado. Reversível — desmarcar todos os Arranjos
 * derruba isto.
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

/**
 * Já é seguro corrigir `?pagina=` — a contagem de páginas visível é a
 * definitiva, e não o transiente de antes de `aplicarPadrao`.
 *
 * `selecaoDeArranjoDefinida` é `estadoUrl.temArranjo`: a URL declara qual é a
 * seleção de Arranjos, ainda que a declaração seja "nenhum". Ela nunca pode
 * estar ligada durante a janela D-3, porque essa janela é exatamente o caso
 * `temArranjo === false` — quando o param existe, `aplicarPadrao` é pulado e a
 * seleção nunca muda depois.
 *
 * @param {Object} entrada
 * @param {boolean} entrada.carregado - O catálogo terminou de carregar
 * @param {number} entrada.totalCatalogo - Quantos louvores o catálogo tem ao todo
 * @param {number} entrada.totalArranjos - Quantos Arranjos estão selecionados
 * @param {boolean} entrada.selecaoDeArranjoDefinida - A URL traz o param `arranjo` (`estadoUrl.temArranjo`)
 * @returns {boolean}
 */
export function podeCorrigirPaginacao({
  carregado,
  totalCatalogo,
  totalArranjos,
  selecaoDeArranjoDefinida
}) {
  return (
    Boolean(carregado) &&
    totalCatalogo > 0 &&
    (totalArranjos > 0 || Boolean(selecaoDeArranjoDefinida))
  );
}
