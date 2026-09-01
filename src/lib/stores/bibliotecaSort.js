import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { page } from '$app/stores';
import { get } from 'svelte/store';
import { lerEstadoDaUrl } from '$lib/utils/urlSync';

const DEFAULT_SORT = 'numero';

function loadSortFromUrl() {
  if (!browser) return DEFAULT_SORT;
  
  try {
    const currentPage = get(page);
    if (!currentPage || !currentPage.url) return DEFAULT_SORT;
    
    const urlParams = lerEstadoDaUrl(currentPage.url);
    const ordenar = urlParams.ordenar;
    
    if (ordenar === 'numero' || ordenar === 'nome') {
      return ordenar;
    }
  } catch (e) {
    console.warn('Erro ao ler ordenação da URL:', e);
  }
  
  return DEFAULT_SORT;
}

function createBibliotecaSortStore() {
  const { subscribe, set } = writable(loadSortFromUrl());

  return {
    subscribe,
    set: (value) => {
      if (value === 'numero' || value === 'nome') {
        set(value);
      }
    }
  };
}

export const bibliotecaSort = createBibliotecaSortStore();

