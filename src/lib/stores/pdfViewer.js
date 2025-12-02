import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { page } from '$app/stores';
import { parseUrlParams, updateUrlParams } from '$lib/utils/urlSync';

const DEFAULT_VIEWER_MODE = 'leitor';
const VALID_MODES = ['leitor', 'online', 'newtab', 'share', 'save'];

function getInitialViewerMode() {
  if (!browser) return DEFAULT_VIEWER_MODE;
  
  const urlParams = parseUrlParams(get(page));
  if (urlParams.comoAbrir && VALID_MODES.includes(urlParams.comoAbrir)) {
    return urlParams.comoAbrir;
  }
  
  return DEFAULT_VIEWER_MODE;
}

function createPdfViewerStore() {
  const { subscribe, set } = writable(getInitialViewerMode());
  let isUpdatingFromUrl = false;
  let isUpdatingUrl = false;

  // Reagir a mudanças na URL
  if (browser) {
    let currentValue = getInitialViewerMode();
    page.subscribe($page => {
      if (isUpdatingUrl) return; // Evitar loop
      
      const urlParams = parseUrlParams($page);
      const urlHasComoAbrir = $page.search.includes('comoAbrir=');
      const newValue = urlHasComoAbrir && urlParams.comoAbrir && VALID_MODES.includes(urlParams.comoAbrir)
        ? urlParams.comoAbrir
        : DEFAULT_VIEWER_MODE;
      
      if (newValue !== currentValue) {
        isUpdatingFromUrl = true;
        set(newValue);
        currentValue = newValue;
        isUpdatingFromUrl = false;
      }
    });
  }

  function updateUrl(value) {
    if (!browser || isUpdatingFromUrl) return;
    
    isUpdatingUrl = true;
    updateUrlParams({ comoAbrir: value }, { defaultComoAbrir: DEFAULT_VIEWER_MODE });
    setTimeout(() => {
      isUpdatingUrl = false;
    }, 0);
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

