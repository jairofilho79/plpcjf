/**
 * Ponte entre a camada de estado de URL (urlEstado.js / urlParams.js) e a
 * navegação do SvelteKit. Todo o cálculo mora nos outros dois módulos, que
 * rodam sob `node --test`; aqui só ficam as três coisas que exigem o
 * framework: ler a URL corrente de `$app/stores`, acumular escritas do mesmo
 * tick e navegar com `goto` (#21).
 *
 * Design (Tarefa 11): a URL é a fonte de verdade. Não há mais nenhuma flag de
 * "estou atualizando" nem religamento por `setTimeout` — o que segura os
 * laços agora é: (1) cada escrita é idempotente (depois dela, a condição que
 * a disparou fica falsa) e (2) a guarda de rota abaixo, conferida tanto na
 * chamada quanto no flush.
 */

import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { get } from 'svelte/store';
import { aplicarParamsNaQuery, lerEstadoDaUrl } from './urlEstado.js';
import { podeEscreverNaUrl } from './urlParams.js';

export { lerEstadoDaUrl };

// #21: só `biblioteca/+page.svelte`, `bibliotecaSort.js` e
// `bibliotecaItemsPerPage.js` ainda usam isto. A Tarefa 12 apaga o re-export.
export { serializeArrayParam, deserializeArrayParam, parseUrlParams } from './urlParams.js';

/**
 * Query acumulada até o próximo flush, e a rota em que foi acumulada. Sem
 * isto, duas chamadas de `updateUrlParams` no mesmo tick partiriam ambas de
 * `get(page).url.search` e a segunda descartaria a primeira — era o bug que
 * `homeSearchUrlParams` remendava à mão só para a paginação (§4.9).
 * @type {string | null}
 */
let queryPendente = null;
/** @type {string | null} */
let rotaPendente = null;
let flushAgendado = false;
let versaoFlush = 0;

function agendarFlush() {
  if (flushAgendado) return;
  flushAgendado = true;

  queueMicrotask(async () => {
    flushAgendado = false;
    const query = queryPendente;
    const rota = rotaPendente;
    const minhaVersao = ++versaoFlush;

    // #21/R4: a rota pode ter mudado entre a chamada e o flush — digitar e
    // clicar num louvor em menos de 500ms levava a escrita da busca para
    // dentro da URL do leitor. A guarda da Tarefa 4 (podeEscreverNaUrl) é
    // conferida de novo aqui, não só na chamada de updateUrlParams.
    const atual = get(page);
    const rotaAgora = atual && atual.url ? atual.url.pathname : null;
    if (rotaAgora !== rota || !podeEscreverNaUrl(rotaAgora)) {
      if (minhaVersao === versaoFlush) {
        queryPendente = null;
        rotaPendente = null;
      }
      return;
    }

    await goto(rota + (query ? `?${query}` : ''), {
      replaceState: true,
      noScroll: true,
      keepFocus: true
    });

    // Só limpa o acumulado se ninguém escreveu por cima durante o goto.
    if (minhaVersao === versaoFlush) {
      queryPendente = null;
      rotaPendente = null;
    }
  });
}

/**
 * Atualiza params da URL mantendo os existentes e adicionando/atualizando os
 * novos. Remove params vazios ou com valores padrão (ver aplicarParamsNaQuery).
 * Sempre `replaceState` (D-1): filtro, busca e paginação não entram no
 * histórico do navegador.
 *
 * @param {Object} newParams - Objeto com os params a atualizar
 * @param {Object} [options]
 * @param {string[]} [options.defaultMateriais] - Materiais padrão (somem da URL se todos selecionados)
 */
export function updateUrlParams(newParams, options = {}) {
  const atual = get(page);
  if (!atual || !atual.url || !atual.url.pathname) {
    console.warn('updateUrlParams: página inválida', atual);
    return;
  }

  const pathname = atual.url.pathname;

  // #21: nenhuma escrita de URL em /leitor. A guarda mora aqui (checagem
  // imediata) e de novo no flush (checagem tardia, acima) — as stores globais
  // (filters, classificationFilters, pdfViewer) escrevem a partir de um
  // page.subscribe de módulo, que roda em qualquer rota.
  if (!podeEscreverNaUrl(pathname)) return;

  const base = queryPendente !== null && rotaPendente === pathname ? queryPendente : atual.url.search;
  queryPendente = aplicarParamsNaQuery(base, newParams, {
    materiaisPadrao: options.defaultMateriais
  });
  rotaPendente = pathname;
  agendarFlush();
}
