import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { page } from '$app/stores';
import { parseUrlParams, updateUrlParams } from '$lib/utils/urlSync';

export const CATEGORY_OPTIONS = ['Partitura', 'Cifra', 'Gestos em Gravura'];

function getInitialFilters() {
  if (!browser) return CATEGORY_OPTIONS;
  
  const urlParams = parseUrlParams(get(page));
  if (urlParams.materiais && urlParams.materiais.length > 0) {
    return urlParams.materiais;
  }
  
  return CATEGORY_OPTIONS;
}

function createFiltersStore() {
  const { subscribe, set: setStore, update } = writable(getInitialFilters());
  let isUpdatingFromUrl = false;
  let isUpdatingUrl = false;

  // Reagir a mudanças na URL
  if (browser) {
    let currentValue = getInitialFilters();
    page.subscribe($page => {
      if (isUpdatingUrl) return; // Evitar loop
      
      const urlParams = parseUrlParams($page);
      const urlHasMateriais = $page.search.includes('materiais=');
      
      if (urlHasMateriais) {
        // URL tem param materiais
        const newValue = urlParams.materiais && urlParams.materiais.length > 0 
          ? urlParams.materiais 
          : [];
        if (JSON.stringify(newValue.sort()) !== JSON.stringify(currentValue.sort())) {
          isUpdatingFromUrl = true;
          setStore(newValue);
          currentValue = newValue;
          isUpdatingFromUrl = false;
        }
      } else {
        // URL não tem param materiais, usar default se necessário
        if (JSON.stringify(currentValue.sort()) !== JSON.stringify(CATEGORY_OPTIONS.sort())) {
          isUpdatingFromUrl = true;
          setStore(CATEGORY_OPTIONS);
          currentValue = CATEGORY_OPTIONS;
          isUpdatingFromUrl = false;
        }
      }
    });
  }

  function updateUrl(categories) {
    if (!browser || isUpdatingFromUrl) return;
    
    isUpdatingUrl = true;
    updateUrlParams({ materiais: categories }, { defaultMateriais: CATEGORY_OPTIONS });
    // Usar setTimeout para garantir que a atualização da URL aconteça após o estado
    setTimeout(() => {
      isUpdatingUrl = false;
    }, 0);
  }

  return {
    subscribe,
    set: (categories) => {
      setStore(categories);
      updateUrl(categories);
    },
    toggleCategory: (category) => {
      update(categories => {
        const filtered = categories.includes(category)
          ? categories.filter(c => c !== category)
          : [...categories, category];
        
        updateUrl(filtered);
        return filtered;
      });
    },
    selectOnly: (category) => {
      setStore([category]);
      updateUrl([category]);
    },
    selectAll: () => {
      setStore(CATEGORY_OPTIONS);
      updateUrl(CATEGORY_OPTIONS);
    },
    deselectAll: () => {
      setStore([]);
      updateUrl([]);
    }
  };
}

export const filters = createFiltersStore();

