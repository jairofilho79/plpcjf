import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const FILTER_STORAGE_KEY = 'bibliotecaClassificationFilters';

function loadFiltersFromStorage() {
  if (!browser) return [];
  
  try {
    const saved = localStorage.getItem(FILTER_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Não foi possível ler os filtros de classificação do localStorage:', e);
  }
  return [];
}

function createClassificationFiltersStore() {
  const { subscribe, set, update } = writable(loadFiltersFromStorage());

  return {
    subscribe,
    toggleClassification: (classification) => {
      update(classifications => {
        const filtered = classifications.includes(classification)
          ? classifications.filter(c => c !== classification)
          : [...classifications, classification];
        
        if (browser) {
          try {
            localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filtered));
          } catch (e) {
            console.warn('Não foi possível salvar os filtros de classificação no localStorage:', e);
          }
        }
        
        return filtered;
      });
    },
    selectOnly: (classification) => {
      set([classification]);
      if (browser) {
        try {
          localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify([classification]));
        } catch (e) {
          console.warn('Não foi possível salvar os filtros de classificação no localStorage:', e);
        }
      }
    },
    selectAll: (allClassifications) => {
      set(allClassifications);
      if (browser) {
        try {
          localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(allClassifications));
        } catch (e) {
          console.warn('Não foi possível salvar os filtros de classificação no localStorage:', e);
        }
      }
    },
    deselectAll: () => {
      set([]);
      if (browser) {
        try {
          localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify([]));
        } catch (e) {
          console.warn('Não foi possível salvar os filtros de classificação no localStorage:', e);
        }
      }
    }
  };
}

export const classificationFilters = createClassificationFiltersStore();

