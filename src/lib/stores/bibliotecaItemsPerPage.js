import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { page } from '$app/stores';
import { get } from 'svelte/store';
import { lerEstadoDaUrl } from '$lib/utils/urlSync';

const DEFAULT_ITEMS_PER_PAGE = 10;
const VALID_OPTIONS = [10, 25, 50];

function loadItemsPerPageFromUrl() {
  if (!browser) return DEFAULT_ITEMS_PER_PAGE;
  
  try {
    const currentPage = get(page);
    if (!currentPage || !currentPage.url) return DEFAULT_ITEMS_PER_PAGE;
    
    const urlParams = lerEstadoDaUrl(currentPage.url);
    const itensPorPagina = urlParams.itensPorPagina;
    
    if (itensPorPagina !== null && VALID_OPTIONS.includes(itensPorPagina)) {
      return itensPorPagina;
    }
  } catch (e) {
    console.warn('Erro ao ler itens por página da URL:', e);
  }
  
  return DEFAULT_ITEMS_PER_PAGE;
}

function createItemsPerPageStore() {
  const { subscribe, set } = writable(loadItemsPerPageFromUrl());

  return {
    subscribe,
    set: (value) => {
      const numValue = parseInt(value, 10);
      if (VALID_OPTIONS.includes(numValue)) {
        set(numValue);
      }
    }
  };
}

export const bibliotecaItemsPerPage = createItemsPerPageStore();
export { VALID_OPTIONS };

