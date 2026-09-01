import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { page } from '$app/stores';
import { lerEstadoDaUrl, updateUrlParams } from '$lib/utils/urlSync';

function getInitialFilters() {
  if (!browser) return [];

  try {
    const currentPage = get(page);
    if (!currentPage || !currentPage.url) return [];

    const estado = lerEstadoDaUrl(currentPage.url);
    if (estado.temArranjo) {
      return estado.arranjo;
    }
  } catch (e) {
    console.warn('Erro ao ler filtros de classificação da URL:', e);
  }

  return [];
}

/**
 * Compara dois conjuntos de arranjo ignorando a ordem, sem `.sort()` — o
 * `.sort()` do código antigo mutava in-place o array já guardado no store.
 * @param {string[]} a
 * @param {string[]} b
 */
function mesmosArranjos(a, b) {
  if (a.length !== b.length) return false;
  const conjunto = new Set(a);
  return b.every((item) => conjunto.has(item));
}

function createClassificationFiltersStore() {
  const { subscribe, set, update } = writable(getInitialFilters());
  let currentValue = getInitialFilters();

  // #21: leitor puro. O param manda quando existe; ausente significa
  // "mantenha o valor atual" — quem decide qual é o padrão nesse caso é a
  // página, por `aplicarPadrao` (abaixo), não este subscribe.
  if (browser) {
    page.subscribe($page => {
      if (!$page || !$page.url) return;

      const estado = lerEstadoDaUrl($page.url);
      if (!estado.temArranjo) return;

      if (!mesmosArranjos(estado.arranjo, currentValue)) {
        set(estado.arranjo);
        currentValue = estado.arranjo;
      }
    });
  }

  function updateUrl(classifications) {
    if (!browser) return;

    currentValue = classifications;
    updateUrlParams({ arranjo: classifications });
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
    },
    /**
     * Popula o store com o padrão calculado pela página, SEM escrever na URL
     * (D-2). É o que substitui o `?arranjo=<5 valores>` que a home gravava
     * sozinha ~200ms depois de abrir — links já compartilhados nesse formato
     * continuam sendo lidos normalmente pelo subscribe acima.
     * @param {string[]} todas
     */
    aplicarPadrao: (todas) => {
      set(todas);
      currentValue = todas;
    }
  };
}

export const classificationFilters = createClassificationFiltersStore();

