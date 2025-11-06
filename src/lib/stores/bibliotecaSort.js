import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const SORT_STORAGE_KEY = 'bibliotecaSortBy';

function loadSortFromStorage() {
  if (!browser) return 'numero';
  
  try {
    const saved = localStorage.getItem(SORT_STORAGE_KEY);
    if (saved === 'numero' || saved === 'nome') {
      return saved;
    }
  } catch (e) {
    console.warn('Não foi possível ler a ordenação do localStorage:', e);
  }
  return 'numero';
}

function createBibliotecaSortStore() {
  const { subscribe, set } = writable(loadSortFromStorage());

  return {
    subscribe,
    set: (value) => {
      if (value === 'numero' || value === 'nome') {
        set(value);
        if (browser) {
          try {
            localStorage.setItem(SORT_STORAGE_KEY, value);
          } catch (e) {
            console.warn('Não foi possível salvar a ordenação no localStorage:', e);
          }
        }
      }
    }
  };
}

export const bibliotecaSort = createBibliotecaSortStore();

