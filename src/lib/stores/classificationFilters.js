import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { page } from '$app/stores';
import { parseUrlParams, updateUrlParams } from '$lib/utils/urlSync';

function getInitialFilters() {
  if (!browser) return [];
  
  try {
    const currentPage = get(page);
    if (!currentPage || !currentPage.url) return [];
    
    const urlParams = parseUrlParams(currentPage.url);
    if (urlParams.arranjo && urlParams.arranjo.length > 0) {
      return urlParams.arranjo;
    }
  } catch (e) {
    console.warn('Erro ao ler filtros de classificação da URL:', e);
  }
  
  return [];
}

function createClassificationFiltersStore() {
  const { subscribe, set, update } = writable(getInitialFilters());
  let isUpdatingFromUrl = false;
  let isUpdatingUrl = false;

  // Reagir a mudanças na URL
  if (browser) {
    let currentValue = getInitialFilters();
    page.subscribe($page => {
      if (isUpdatingUrl || !$page || !$page.url) return; // Evitar loop
      
      const urlParams = parseUrlParams($page.url);
      const urlHasArranjo = $page.url.search && $page.url.search.includes('arranjo=');
      
      // Só atualizar se houver parâmetro na URL
      // Se não houver parâmetro, manter o valor atual (não limpar)
      if (urlHasArranjo) {
        const newValue = urlParams.arranjo || [];
        
        if (JSON.stringify(newValue.sort()) !== JSON.stringify(currentValue.sort())) {
          isUpdatingFromUrl = true;
          set(newValue);
          currentValue = newValue;
          isUpdatingFromUrl = false;
        }
      }
      // Se não há parâmetro na URL, não fazer nada (manter valor atual)
    });
  }

  function updateUrl(classifications) {
    if (!browser || isUpdatingFromUrl) return;
    
    isUpdatingUrl = true;
    updateUrlParams({ arranjo: classifications });
    setTimeout(() => {
      isUpdatingUrl = false;
    }, 0);
  }

  return {
    subscribe,
    toggleClassification: (classification) => {
      update(classifications => {
        const filtered = classifications.includes(classification)
          ? classifications.filter(c => c !== classification)
          : [...classifications, classification];
        
        updateUrl(filtered);
        return filtered;
      });
    },
    selectOnly: (classification) => {
      set([classification]);
      updateUrl([classification]);
    },
    selectAll: (allClassifications) => {
      set(allClassifications);
      updateUrl(allClassifications);
    },
    deselectAll: () => {
      set([]);
      updateUrl([]);
    }
  };
}

export const classificationFilters = createClassificationFiltersStore();

