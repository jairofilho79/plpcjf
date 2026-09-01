/**
 * Camada de ESTADO derivado da URL, para a Tarefa 11 (#21 parte 2).
 *
 * Diferença para `urlParams.js` (Tarefa 3), que já resolvia toda a regra de
 * parsing/serialização de cada param isoladamente: este módulo não reimplementa
 * nenhuma dessas regras — importa `parseUrlParams`, `construirQueryAtualizada`
 * e as funções `normalizarX` de lá. O que ele acrescenta é o que faltava:
 *
 * - `lerEstadoDaUrl` compõe os params individuais num objeto de ESTADO —
 *   nunca `null`, nunca `NaN` — com as flags `temMateriais`/`temArranjo`/
 *   `temArranjoEspecial` (presença do param, distinta de vazio) e a lista
 *   `paramsInvalidos` (D-9). `parseUrlParams` deliberadamente devolve `NaN`
 *   para `?pagina=abc` (armadilha preservada para quem já blinda); esta função
 *   é a normalização que os componentes da home passam a consumir no lugar.
 * - `aplicarParamsNaQuery` é a fachada com o nome de parâmetro que a Tarefa 11
 *   usa (`materiaisPadrao`) sobre `construirQueryAtualizada` — não há regra
 *   nova aqui, só a tradução do nome da opção.
 *
 * Roda sob `node --test`: nenhum import de `$app` ou `svelte`.
 */

import {
  parseUrlParams,
  construirQueryAtualizada,
  normalizarPagina,
  normalizarItensPorPagina,
  normalizarOrdenacao,
  normalizarModoAbertura,
  MODOS_ABERTURA_VALIDOS,
  ORDENACOES_VALIDAS
} from './urlParams.js';

/** Materiais selecionados por padrão quando nenhum `aplicarParamsNaQuery` especifica outro. */
export const CATEGORIAS_PADRAO = ['Partitura', 'Cifra', 'Gestos em Gravura'];

/**
 * Params conhecidos presentes na URL com valor que não sobrevive à
 * normalização — os que `aplicarParamsNaQuery` arruma na próxima escrita (D-9).
 * @param {URLSearchParams} params
 * @returns {string[]}
 */
function listarParamsInvalidos(params) {
  const invalidos = [];
  if (params.has('comoAbrir') && !MODOS_ABERTURA_VALIDOS.includes(params.get('comoAbrir'))) {
    invalidos.push('comoAbrir');
  }
  if (params.has('ordenar') && !ORDENACOES_VALIDAS.includes(params.get('ordenar'))) {
    invalidos.push('ordenar');
  }
  if (params.has('itensPorPagina')) {
    const raw = params.get('itensPorPagina');
    if (String(normalizarItensPorPagina(raw)) !== raw) invalidos.push('itensPorPagina');
  }
  if (params.has('pagina')) {
    const raw = params.get('pagina');
    if (String(normalizarPagina(raw)) !== raw) invalidos.push('pagina');
  }
  return invalidos;
}

/**
 * Estado completo derivado da URL — nunca `null`, nunca `NaN`. Aceita um
 * `URL`, um `$page.url` do SvelteKit, ou qualquer objeto com `.search`.
 * @param {{search?: string} | URL} url
 * @returns {{
 *   pesquisa: string, materiais: string[], temMateriais: boolean,
 *   arranjo: string[], temArranjo: boolean,
 *   arranjoEspecial: string[], temArranjoEspecial: boolean,
 *   comoAbrir: string, ordenar: string, itensPorPagina: number, pagina: number,
 *   paramsInvalidos: string[]
 * }}
 */
export function lerEstadoDaUrl(url) {
  const bruto = parseUrlParams(url || {});
  const params = new URLSearchParams((url && url.search) || '');

  return {
    pesquisa: bruto.pesquisa,
    materiais: bruto.materiais,
    temMateriais: params.has('materiais'),
    arranjo: bruto.arranjo,
    temArranjo: params.has('arranjo'),
    arranjoEspecial: bruto.arranjoEspecial,
    temArranjoEspecial: params.has('arranjoEspecial'),
    comoAbrir: normalizarModoAbertura(bruto.comoAbrir),
    ordenar: normalizarOrdenacao(bruto.ordenar),
    itensPorPagina: normalizarItensPorPagina(bruto.itensPorPagina),
    pagina: normalizarPagina(bruto.pagina),
    paramsInvalidos: listarParamsInvalidos(params)
  };
}

/**
 * Aplica um conjunto de params sobre uma query existente e devolve a query
 * nova (sem `?`). Fachada de `construirQueryAtualizada` (urlParams.js) — toda
 * a regra mora lá; aqui só se traduz `opcoes.materiaisPadrao` para o nome que
 * `construirQueryAtualizada` já usa.
 *
 * @param {string} search - query atual, com ou sem `?`
 * @param {Object} novos
 * @param {{materiaisPadrao?: string[]}} [opcoes]
 * @returns {string}
 */
export function aplicarParamsNaQuery(search, novos = {}, opcoes = {}) {
  const { materiaisPadrao = CATEGORIAS_PADRAO } = opcoes;
  return construirQueryAtualizada(search, novos, { defaultMateriais: materiaisPadrao });
}
