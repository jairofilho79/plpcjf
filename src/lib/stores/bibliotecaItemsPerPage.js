import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const ITEMS_PER_PAGE_STORAGE_KEY = 'bibliotecaItemsPerPage';
const DEFAULT_ITEMS_PER_PAGE = 10;
const VALID_OPTIONS = [10, 25, 50];

function loadItemsPerPageFromStorage() {
  if (!browser) return DEFAULT_ITEMS_PER_PAGE;
  
  try {
    const saved = localStorage.getItem(ITEMS_PER_PAGE_STORAGE_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (VALID_OPTIONS.includes(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Não foi possível ler os itens por página do localStorage:', e);
  }
  return DEFAULT_ITEMS_PER_PAGE;
}

function createItemsPerPageStore() {
  const { subscribe, set } = writable(loadItemsPerPageFromStorage());

  return {
    subscribe,
    set: (value) => {
      const numValue = parseInt(value, 10);
      if (VALID_OPTIONS.includes(numValue)) {
        set(numValue);
        if (browser) {
          try {
            localStorage.setItem(ITEMS_PER_PAGE_STORAGE_KEY, numValue.toString());
          } catch (e) {
            console.warn('Não foi possível salvar os itens por página no localStorage:', e);
          }
        }
      }
    }
  };
}

export const bibliotecaItemsPerPage = createItemsPerPageStore();
export { VALID_OPTIONS };

