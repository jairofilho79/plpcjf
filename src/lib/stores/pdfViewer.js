import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { page } from '$app/stores';
import { lerEstadoDaUrl, updateUrlParams } from '$lib/utils/urlSync';

const DEFAULT_VIEWER_MODE = 'leitor';
const VALID_MODES = ['leitor', 'online', 'newtab', 'share', 'save'];

function getInitialViewerMode() {
  if (!browser) return DEFAULT_VIEWER_MODE;

  try {
    const currentPage = get(page);
    if (!currentPage || !currentPage.url) return DEFAULT_VIEWER_MODE;

    // `lerEstadoDaUrl` já normaliza ausente/inválido para o padrão.
    return lerEstadoDaUrl(currentPage.url).comoAbrir;
  } catch (e) {
    console.warn('Erro ao ler modo de visualização da URL:', e);
  }

  return DEFAULT_VIEWER_MODE;
}

function createPdfViewerStore() {
  const { subscribe, set } = writable(getInitialViewerMode());
  let currentValue = getInitialViewerMode();

  // #21: leitor puro — sem flag, porque este bloco nunca escreve.
  if (browser) {
    page.subscribe($page => {
      if (!$page || !$page.url) return;

      const newValue = lerEstadoDaUrl($page.url).comoAbrir;
      if (newValue !== currentValue) {
        set(newValue);
        currentValue = newValue;
      }
    });
  }

  function updateUrl(value) {
    if (!browser) return;

    currentValue = value;
    updateUrlParams({ comoAbrir: value });
  }

  return {
    subscribe,
    set: (value) => {
      if (!VALID_MODES.includes(value)) {
        console.warn(`Modo de visualização inválido: ${value}`);
        return;
      }
      set(value);
      updateUrl(value);
    }
  };
}

export const pdfViewer = createPdfViewerStore();
