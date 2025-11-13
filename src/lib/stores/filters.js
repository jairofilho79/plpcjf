import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export const CATEGORY_OPTIONS = ['Partitura', 'Cifra', 'Gestos em Gravura'];
const FILTER_STORAGE_KEY = 'categoryFilters';

function loadFiltersFromStorage() {
  if (!browser) return CATEGORY_OPTIONS;
  
  try {
    const saved = localStorage.getItem(FILTER_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Não foi possível ler os filtros do localStorage:', e);
  }
  return CATEGORY_OPTIONS;
}

function createFiltersStore() {
  const { subscribe, set: setStore, update } = writable(loadFiltersFromStorage());

  return {
    subscribe,
    set: (categories) => {
      setStore(categories);
      if (browser) {
        try {
          localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(categories));
        } catch (e) {
          console.warn('Não foi possível salvar os filtros no localStorage:', e);
        }
      }
    },
    toggleCategory: (category) => {
      update(categories => {
        const filtered = categories.includes(category)
          ? categories.filter(c => c !== category)
          : [...categories, category];
        
        if (browser) {
          try {
            localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filtered));
          } catch (e) {
            console.warn('Não foi possível salvar os filtros no localStorage:', e);
          }
        }
        
        return filtered;
      });
    },
    selectOnly: (category) => {
      setStore([category]);
      if (browser) {
        try {
          localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify([category]));
        } catch (e) {
          console.warn('Não foi possível salvar os filtros no localStorage:', e);
        }
      }
    },
    selectAll: () => {
      setStore(CATEGORY_OPTIONS);
      if (browser) {
        try {
          localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(CATEGORY_OPTIONS));
        } catch (e) {
          console.warn('Não foi possível salvar os filtros no localStorage:', e);
        }
      }
    },
    deselectAll: () => {
      setStore([]);
      if (browser) {
        try {
          localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify([]));
        } catch (e) {
          console.warn('Não foi possível salvar os filtros no localStorage:', e);
        }
      }
    }
  };
}

export const filters = createFiltersStore();

