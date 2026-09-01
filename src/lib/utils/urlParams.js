/**
 * Leitura e escrita dos parâmetros de URL da aplicação, sem nenhuma dependência
 * de framework.
 *
 * Este módulo existe separado de urlSync.js por um motivo único e importante:
 * urlSync.js importa $app/navigation e $app/stores, que só existem dentro do
 * SvelteKit, e por isso a camada de URL nunca pôde ser testada. Tudo o que é
 * cálculo sobre strings mora aqui e roda sob `node --test`; urlSync.js fica só
 * com o `get(page)` e o `goto`.
 *
 * NÃO importe nada de $app, $lib ou svelte aqui.
 */

/**
 * Serializa um array em um único valor de query (vírgulas entre itens).
 * Não use encodeURIComponent por item: URLSearchParams.set já codifica o valor
 * inteiro uma vez; codificar antes geraria %2520 etc.
 * Itens não devem conter vírgula literal (não há escape por item neste formato).
 * @param {string[]} array
 * @returns {string}
 */
export function serializeArrayParam(array) {
  if (!Array.isArray(array) || array.length === 0) {
    return '';
  }
  return array.map((item) => String(item)).join(',');
}

/**
 * Deserializa uma string de URL param em array.
 *
 * O valor que chega aqui vem de `URLSearchParams.get()`, que JÁ decodificou o
 * percent-encoding uma vez. Decodificar de novo corrompia qualquer `%XX` que o
 * usuário tivesse digitado de verdade (`a%20b` virava `a b`).
 *
 * Tolerante de propósito: `trim()` por item e descarte de vazios, para aceitar
 * `?arranjo= PES , ,PES CIAs ` digitado à mão. Isso é contrato (caso F3) e não
 * pode sair.
 * @param {string} param
 * @returns {string[]}
 */
export function deserializeArrayParam(param) {
  if (!param || typeof param !== 'string') {
    return [];
  }
  return param.split(',').map((item) => item.trim()).filter(Boolean);
}

/**
 * Parseia todos os params relevantes da URL atual.
 * Atenção: `itensPorPagina` e `pagina` devolvem NaN (não null) quando o valor
 * não é numérico — quem consome tem de blindar com `> 0`.
 * @param {URL} url
 * @returns {{materiais: string[], arranjo: string[], arranjoEspecial: string[], comoAbrir: string, pesquisa: string, ordenar: string, itensPorPagina: number | null, pagina: number | null}}
 */
export function parseUrlParams(url) {
  const search = url.search || '';
  const params = new URLSearchParams(search);

  const comoAbrirParam = params.get('comoAbrir');
  const pesquisaParam = params.get('pesquisa');

  const ordenarParam = params.get('ordenar');
  const itensPorPaginaParam = params.get('itensPorPagina');
  const paginaParam = params.get('pagina');

  return {
    materiais: deserializeArrayParam(params.get('materiais') || ''),
    arranjo: deserializeArrayParam(params.get('arranjo') || ''),
    arranjoEspecial: deserializeArrayParam(params.get('arranjoEspecial') || ''),
    // Sem decode extra: URLSearchParams.get() já decodificou uma vez.
    comoAbrir: comoAbrirParam || '',
    pesquisa: pesquisaParam || '',
    ordenar: ordenarParam || '',
    itensPorPagina: itensPorPaginaParam ? parseInt(itensPorPaginaParam, 10) : null,
    pagina: paginaParam ? parseInt(paginaParam, 10) : null
  };
}

/** Os cinco modos de abertura do leitor (src/lib/stores/pdfViewer.js). */
export const MODOS_ABERTURA_VALIDOS = ['leitor', 'online', 'newtab', 'share', 'save'];
export const MODO_ABERTURA_PADRAO = 'leitor';
export const ORDENACOES_VALIDAS = ['numero', 'nome'];
export const ORDENACAO_PADRAO = 'numero';
export const ITENS_POR_PAGINA_VALIDOS = [10, 25, 50];
export const ITENS_POR_PAGINA_PADRAO = 10;

/**
 * Normaliza `pagina`: qualquer coisa que não seja um inteiro positivo vira 1.
 * Fonte única da regra — `parseUrlParams` continua devolvendo o valor cru
 * (armadilha de NaN preservada para quem já blinda) e `lerEstadoDaUrl`
 * (urlEstado.js) usa esta função para nunca devolver NaN.
 * @param {string | number | null} valor
 * @returns {number}
 */
export function normalizarPagina(valor) {
  const n = typeof valor === 'number' ? valor : parseInt(valor, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** @param {string | number | null} valor @returns {number} */
export function normalizarItensPorPagina(valor) {
  const n = typeof valor === 'number' ? valor : parseInt(valor, 10);
  return ITENS_POR_PAGINA_VALIDOS.includes(n) ? n : ITENS_POR_PAGINA_PADRAO;
}

/** @param {string | null} valor @returns {string} */
export function normalizarOrdenacao(valor) {
  return ORDENACOES_VALIDAS.includes(valor) ? valor : ORDENACAO_PADRAO;
}

/** @param {string | null} valor @returns {string} */
export function normalizarModoAbertura(valor) {
  return MODOS_ABERTURA_VALIDOS.includes(valor) ? valor : MODO_ABERTURA_PADRAO;
}

/**
 * Constrói a query nova a partir da atual, mantendo todo param não citado em
 * `newParams` — inclusive os de terceiros (`utm_source`, `fbclid`).
 * Params com valor padrão ou vazio são removidos.
 *
 * #21/D-8: `materiais`, `arranjo` e `arranjoEspecial` deixam de ser apagados
 * quando a lista fica vazia — passam a ser gravados como `chave=` vazio, que é
 * um estado real e alcançável pela UI ("desmarquei tudo"). A única exceção
 * continua sendo `materiais` quando a seleção é IGUAL ao padrão: aí sim o
 * param some, porque ausência de `materiais` já significa "todos".
 *
 * #21/D-9: um param conhecido (`comoAbrir`, `ordenar`, `itensPorPagina`,
 * `pagina`) que sobrou inválido na query atual é normalizado nesta escrita,
 * mesmo que `newParams` não fale dele — é o que tira o `?comoAbrir=lixo` que
 * antes ficava pendurado na URL para sempre.
 *
 * @param {string} searchAtual - a query atual, com ou sem o `?` inicial
 * @param {Object} newParams - os params a atualizar
 * @param {Object} [options]
 * @param {string[]} [options.defaultMateriais] - se todos estiverem selecionados, o param sai da URL
 * @param {string} [options.defaultComoAbrir] - valor padrão de comoAbrir (normalmente 'leitor')
 * @returns {string} a query nova, SEM o `?` inicial
 */
export function construirQueryAtualizada(searchAtual, newParams, options = {}) {
  const { defaultMateriais = [], defaultComoAbrir = MODO_ABERTURA_PADRAO } = options;

  const currentParams = new URLSearchParams(searchAtual || '');

  if (newParams.materiais !== undefined) {
    const materiais = Array.isArray(newParams.materiais) ? newParams.materiais : [];
    // Se todos os materiais estão selecionados, remover o param: ausência já
    // significa "todos". Qualquer outra coisa — inclusive lista vazia — grava.
    const allSelected =
      materiais.length === defaultMateriais.length &&
      defaultMateriais.every((m) => materiais.includes(m));
    if (allSelected) {
      currentParams.delete('materiais');
    } else {
      currentParams.set('materiais', serializeArrayParam(materiais));
    }
  }

  if (newParams.arranjo !== undefined) {
    const arranjo = Array.isArray(newParams.arranjo) ? newParams.arranjo : [];
    // Sem "todos = padrão" aqui: o padrão de arranjo é a AUSÊNCIA do param,
    // calculada pela página, não uma lista fixa. Grava sempre, mesmo vazio.
    currentParams.set('arranjo', serializeArrayParam(arranjo));
  }

  if (newParams.arranjoEspecial !== undefined) {
    const arranjoEspecial = Array.isArray(newParams.arranjoEspecial) ? newParams.arranjoEspecial : [];
    currentParams.set('arranjoEspecial', serializeArrayParam(arranjoEspecial));
  }

  if (newParams.comoAbrir !== undefined) {
    const comoAbrir = normalizarModoAbertura(newParams.comoAbrir || '');
    if (comoAbrir === defaultComoAbrir) {
      currentParams.delete('comoAbrir');
    } else {
      // URLSearchParams.set já aplica percent-encoding
      currentParams.set('comoAbrir', comoAbrir);
    }
  }

  if (newParams.pesquisa !== undefined) {
    const pesquisa = (newParams.pesquisa || '').trim();
    if (!pesquisa) currentParams.delete('pesquisa');
    else currentParams.set('pesquisa', pesquisa);
  }

  if (newParams.ordenar !== undefined) {
    const ordenar = normalizarOrdenacao((newParams.ordenar || '').trim());
    if (ordenar === ORDENACAO_PADRAO) currentParams.delete('ordenar');
    else currentParams.set('ordenar', ordenar);
  }

  if (newParams.itensPorPagina !== undefined) {
    const itensPorPagina = normalizarItensPorPagina(newParams.itensPorPagina);
    if (itensPorPagina === ITENS_POR_PAGINA_PADRAO) currentParams.delete('itensPorPagina');
    else currentParams.set('itensPorPagina', itensPorPagina.toString());
  }

  if (newParams.pagina !== undefined) {
    const pagina = normalizarPagina(newParams.pagina);
    if (pagina === 1) currentParams.delete('pagina');
    else currentParams.set('pagina', pagina.toString());
  }

  // D-9: um param conhecido que sobrou inválido na query (não necessariamente
  // citado acima) é normalizado agora. Idempotente: um valor já válido passa
  // por aqui sem mudar nada.
  if (currentParams.has('comoAbrir')) {
    const valor = normalizarModoAbertura(currentParams.get('comoAbrir'));
    if (valor === defaultComoAbrir) currentParams.delete('comoAbrir');
    else currentParams.set('comoAbrir', valor);
  }
  if (currentParams.has('ordenar')) {
    const valor = normalizarOrdenacao(currentParams.get('ordenar'));
    if (valor === ORDENACAO_PADRAO) currentParams.delete('ordenar');
    else currentParams.set('ordenar', valor);
  }
  if (currentParams.has('itensPorPagina')) {
    const valor = normalizarItensPorPagina(currentParams.get('itensPorPagina'));
    if (valor === ITENS_POR_PAGINA_PADRAO) currentParams.delete('itensPorPagina');
    else currentParams.set('itensPorPagina', String(valor));
  }
  if (currentParams.has('pagina')) {
    const valor = normalizarPagina(currentParams.get('pagina'));
    if (valor === 1) currentParams.delete('pagina');
    else currentParams.set('pagina', String(valor));
  }

  return currentParams.toString();
}

/**
 * Rotas em que NENHUMA escrita de URL pode ocorrer.
 *
 * O `/leitor` recebe o PDF exclusivamente pelo query param `?file=`, que é
 * também um link público e compartilhável — existem links assim em conversas de
 * WhatsApp e um está hard-coded em src/routes/offline/+page.svelte:1117.
 * Qualquer reescrita de query nessa rota pode competir com a navegação que está
 * abrindo o PDF ou sobrescrever o histórico. Hoje isso é evitado por acidente
 * (nenhum componente que escreve filtro é montado lá); esta lista torna a
 * garantia explícita.
 */
const ROTAS_SEM_ESCRITA_DE_URL = ['/leitor'];

/**
 * A rota corrente aceita escrita de URL?
 * Na dúvida (pathname vazio ou não-string), devolve false: não escrever é
 * sempre mais seguro que escrever no lugar errado.
 * @param {string} pathname
 * @returns {boolean}
 */
export function podeEscreverNaUrl(pathname) {
  if (!pathname || typeof pathname !== 'string') return false;
  return !ROTAS_SEM_ESCRITA_DE_URL.some(
    (rota) => pathname === rota || pathname.startsWith(`${rota}/`)
  );
}
