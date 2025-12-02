import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { page } from '$app/stores';
import { parseUrlParams, updateUrlParams } from '$lib/utils/urlSync';

function getInitialFilters() {
  if (!browser) return [];
  
  const urlParams = parseUrlParams(get(page));
  if (urlParams.arranjo && urlParams.arranjo.length > 0) {
    return urlParams.arranjo;
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
      if (isUpdatingUrl) return; // Evitar loop
      
      const urlParams = parseUrlParams($page);
      const urlHasArranjo = $page.search.includes('arranjo=');
      const newValue = urlHasArranjo ? (urlParams.arranjo || []) : [];
      
      if (JSON.stringify(newValue.sort()) !== JSON.stringify(currentValue.sort())) {
        isUpdatingFromUrl = true;
        set(newValue);
        currentValue = newValue;
        isUpdatingFromUrl = false;
      }
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

