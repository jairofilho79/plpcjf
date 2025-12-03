import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { page } from '$app/stores';
import { parseUrlParams, updateUrlParams } from '$lib/utils/urlSync';

export const CATEGORY_OPTIONS = ['Partitura', 'Cifra', 'Gestos em Gravura'];

/**
 * Normaliza os valores de categoria para manter a ordem manual definida em CATEGORY_OPTIONS
 * @param {string[]} categories - Array de categorias (pode estar em qualquer ordem)
 * @returns {string[]} Array de categorias na ordem manual
 */
function normalizeCategoryOrder(categories) {
  if (!Array.isArray(categories) || categories.length === 0) {
    return [];
  }
  
  // Filtrar apenas categorias válidas e manter a ordem manual
  const normalized = CATEGORY_OPTIONS.filter(cat => categories.includes(cat));
  
  // Se houver categorias que não estão em CATEGORY_OPTIONS, adicionar no final
  const extraCategories = categories.filter(cat => !CATEGORY_OPTIONS.includes(cat));
  
  return [...normalized, ...extraCategories];
}

/**
 * Compara dois arrays de categorias ignorando a ordem
 * @param {string[]} arr1 
 * @param {string[]} arr2 
 * @returns {boolean}
 */
function areCategoriesEqual(arr1, arr2) {
  if (arr1.length !== arr2.length) return false;
  const set1 = new Set(arr1);
  const set2 = new Set(arr2);
  if (set1.size !== set2.size) return false;
  for (const item of set1) {
    if (!set2.has(item)) return false;
  }
  return true;
}

function getInitialFilters() {
  if (!browser) return CATEGORY_OPTIONS;
  
  try {
    const currentPage = get(page);
    if (!currentPage || !currentPage.url) return CATEGORY_OPTIONS;
    
    const urlParams = parseUrlParams(currentPage.url);
    if (urlParams.materiais && urlParams.materiais.length > 0) {
      // Normalizar a ordem para manter a ordem manual
      return normalizeCategoryOrder(urlParams.materiais);
    }
  } catch (e) {
    console.warn('Erro ao ler filtros da URL:', e);
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
      if (isUpdatingUrl || !$page || !$page.url) return; // Evitar loop
      
      const urlParams = parseUrlParams($page.url);
      const urlHasMateriais = $page.url.search && $page.url.search.includes('materiais=');
      
      if (urlHasMateriais) {
        // URL tem param materiais
        const rawValue = urlParams.materiais && urlParams.materiais.length > 0 
          ? urlParams.materiais 
          : [];
        // Normalizar a ordem para manter a ordem manual
        const newValue = normalizeCategoryOrder(rawValue);
        if (!areCategoriesEqual(newValue, currentValue)) {
          isUpdatingFromUrl = true;
          setStore(newValue);
          currentValue = newValue;
          isUpdatingFromUrl = false;
        }
      } else {
        // URL não tem param materiais, usar default se necessário
        if (!areCategoriesEqual(currentValue, CATEGORY_OPTIONS)) {
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
    // Normalizar a ordem antes de salvar na URL para manter consistência
    const normalizedCategories = normalizeCategoryOrder(categories);
    updateUrlParams({ materiais: normalizedCategories }, { defaultMateriais: CATEGORY_OPTIONS });
    // Usar setTimeout para garantir que a atualização da URL aconteça após o estado
    setTimeout(() => {
      isUpdatingUrl = false;
    }, 0);
  }

  return {
    subscribe,
    set: (categories) => {
      // Normalizar a ordem antes de salvar na store
      const normalizedCategories = normalizeCategoryOrder(categories);
      setStore(normalizedCategories);
      updateUrl(normalizedCategories);
    },
    toggleCategory: (category) => {
      update(categories => {
        const filtered = categories.includes(category)
          ? categories.filter(c => c !== category)
          : [...categories, category];
        
        // Normalizar a ordem antes de salvar
        const normalized = normalizeCategoryOrder(filtered);
        updateUrl(normalized);
        return normalized;
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

