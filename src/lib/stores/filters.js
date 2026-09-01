import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { page } from '$app/stores';
import { lerEstadoDaUrl, updateUrlParams } from '$lib/utils/urlSync';

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
    
    const estado = lerEstadoDaUrl(currentPage.url);
    if (estado.temMateriais) {
      // Normalizar a ordem para manter a ordem manual
      return normalizeCategoryOrder(estado.materiais);
    }
  } catch (e) {
    console.warn('Erro ao ler filtros da URL:', e);
  }
  
  return CATEGORY_OPTIONS;
}

function createFiltersStore() {
  const { subscribe, set: setStore, update } = writable(getInitialFilters());
  let currentValue = getInitialFilters();

  // #21: leitor puro — a URL manda. Não há flag de "estou atualizando" porque
  // este bloco nunca escreve; quem escreve é `updateUrl`, abaixo, que também
  // atualiza `currentValue` antes do goto, então quando este subscribe reagir
  // à navegação o valor já bate e não há trabalho a refazer.
  if (browser) {
    page.subscribe($page => {
      if (!$page || !$page.url) return;

      const estado = lerEstadoDaUrl($page.url);
      // `estado.temMateriais` vem de `URLSearchParams.has`, não de um
      // `search.includes('materiais=')` — a substring dava falso-positivo
      // quando outro param continha esse texto no valor (D3).
      const newValue = estado.temMateriais
        ? normalizeCategoryOrder(estado.materiais)
        : CATEGORY_OPTIONS;

      if (!areCategoriesEqual(newValue, currentValue)) {
        setStore(newValue);
        currentValue = newValue;
      }
    });
  }

  function updateUrl(categories) {
    if (!browser) return;

    // Normalizar a ordem antes de salvar na URL para manter consistência
    const normalizedCategories = normalizeCategoryOrder(categories);
    currentValue = normalizedCategories;
    updateUrlParams({ materiais: normalizedCategories }, { defaultMateriais: CATEGORY_OPTIONS });
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

