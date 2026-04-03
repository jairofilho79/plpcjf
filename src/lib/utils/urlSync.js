import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { get } from 'svelte/store';

/**
 * Serializa um array em um único valor de query (vírgulas entre itens).
 * Não use encodeURIComponent por item: URLSearchParams.set já codifica o valor inteiro
 * uma vez; codificar antes geraria %2520 etc.
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

function safeDecodeURIComponent(value) {
  if (value == null || value === '') return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Deserializa uma string de URL param em array
 * @param {string} param
 * @returns {string[]}
 */
export function deserializeArrayParam(param) {
  if (!param || typeof param !== 'string') {
    return [];
  }
  return param.split(',').map((item) => safeDecodeURIComponent(item.trim())).filter(Boolean);
}

/**
 * Parseia todos os params relevantes da URL atual
 * @param {URL} url - URL object (pode ser $page.url)
 * @returns {Object}
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
    comoAbrir: safeDecodeURIComponent(comoAbrirParam || ''),
    pesquisa: safeDecodeURIComponent(pesquisaParam || ''),
    ordenar: safeDecodeURIComponent(ordenarParam || ''),
    itensPorPagina: itensPorPaginaParam ? parseInt(itensPorPaginaParam, 10) : null,
    pagina: paginaParam ? parseInt(paginaParam, 10) : null
  };
}

/**
 * Atualiza os params da URL mantendo os existentes e adicionando/atualizando os novos
 * Remove params vazios ou com valores padrão
 * @param {Object} newParams - Objeto com os params a atualizar
 * @param {Object} options - Opções
 * @param {string[]} options.defaultMateriais - Array de materiais padrão (para não incluir na URL se todos selecionados)
 * @param {string} options.defaultComoAbrir - Valor padrão de comoAbrir (geralmente 'leitor')
 * @param {boolean} options.replaceState - Se true, usa replaceState (default: true)
 */
export function updateUrlParams(newParams, options = {}) {
  const {
    defaultMateriais = [],
    defaultComoAbrir = 'leitor',
    replaceState = true
  } = options;
  
  const currentUrl = get(page);
  if (!currentUrl || !currentUrl.url || !currentUrl.url.pathname) {
    console.warn('updateUrlParams: currentUrl inválido', currentUrl);
    return;
  }
  
  const search = currentUrl.url.search || '';
  const currentParams = new URLSearchParams(search);
  
  // Atualizar params
  if (newParams.materiais !== undefined) {
    const materiais = Array.isArray(newParams.materiais) ? newParams.materiais : [];
    // Se todos os materiais estão selecionados, remover o param
    const allSelected = materiais.length === defaultMateriais.length && 
                       defaultMateriais.every(m => materiais.includes(m));
    if (allSelected || materiais.length === 0) {
      currentParams.delete('materiais');
    } else {
      const serialized = serializeArrayParam(materiais);
      if (serialized) {
        currentParams.set('materiais', serialized);
      } else {
        currentParams.delete('materiais');
      }
    }
  }
  
  if (newParams.arranjo !== undefined) {
    const arranjo = Array.isArray(newParams.arranjo) ? newParams.arranjo : [];
    // Se array vazio, remover param
    if (arranjo.length === 0) {
      currentParams.delete('arranjo');
    } else {
      const serialized = serializeArrayParam(arranjo);
      if (serialized) {
        currentParams.set('arranjo', serialized);
      } else {
        currentParams.delete('arranjo');
      }
    }
  }
  
  if (newParams.arranjoEspecial !== undefined) {
    const arranjoEspecial = Array.isArray(newParams.arranjoEspecial) ? newParams.arranjoEspecial : [];
    if (arranjoEspecial.length === 0) {
      currentParams.delete('arranjoEspecial');
    } else {
      const serialized = serializeArrayParam(arranjoEspecial);
      if (serialized) {
        currentParams.set('arranjoEspecial', serialized);
      } else {
        currentParams.delete('arranjoEspecial');
      }
    }
  }
  
  if (newParams.comoAbrir !== undefined) {
    const comoAbrir = newParams.comoAbrir || '';
    // Se é o valor padrão, remover param
    if (comoAbrir === defaultComoAbrir || !comoAbrir) {
      currentParams.delete('comoAbrir');
    } else {
      // URLSearchParams.set já aplica percent-encoding
      currentParams.set('comoAbrir', comoAbrir);
    }
  }
  
  if (newParams.pesquisa !== undefined) {
    const pesquisa = (newParams.pesquisa || '').trim();
    if (!pesquisa) {
      currentParams.delete('pesquisa');
    } else {
      currentParams.set('pesquisa', pesquisa);
    }
  }
  
  if (newParams.ordenar !== undefined) {
    const ordenar = (newParams.ordenar || '').trim();
    // Se é o valor padrão ('numero'), remover param
    if (ordenar === 'numero' || !ordenar) {
      currentParams.delete('ordenar');
    } else {
      currentParams.set('ordenar', ordenar);
    }
  }
  
  if (newParams.itensPorPagina !== undefined) {
    const itensPorPagina = parseInt(newParams.itensPorPagina, 10);
    // Se é o valor padrão (10) ou inválido, remover param
    if (isNaN(itensPorPagina) || itensPorPagina === 10) {
      currentParams.delete('itensPorPagina');
    } else {
      currentParams.set('itensPorPagina', itensPorPagina.toString());
    }
  }
  
  if (newParams.pagina !== undefined) {
    const pagina = parseInt(newParams.pagina, 10);
    // Se é o valor padrão (1) ou inválido, remover param
    if (isNaN(pagina) || pagina <= 1) {
      currentParams.delete('pagina');
    } else {
      currentParams.set('pagina', pagina.toString());
    }
  }
  
  // Construir nova URL
  const newSearch = currentParams.toString();
  const pathname = currentUrl.url.pathname || '/';
  const newUrl = pathname + (newSearch ? `?${newSearch}` : '');
  
  // Atualizar URL usando replaceState para não adicionar ao histórico
  goto(newUrl, { 
    replaceState, 
    noScroll: true,
    keepFocus: true
  });
}
