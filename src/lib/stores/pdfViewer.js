import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const PDF_VIEWER_STORAGE_KEY = 'pdfViewerMode';

function loadPdfViewerMode() {
  if (!browser) return 'leitor';
  
  try {
    const saved = localStorage.getItem(PDF_VIEWER_STORAGE_KEY);
    if (saved && ['leitor', 'online', 'newtab', 'share', 'save'].includes(saved)) {
      return saved;
    }
  } catch (e) {
    console.warn('Não foi possível ler o modo de visualização do localStorage:', e);
  }
  return 'leitor';
}

function createPdfViewerStore() {
  const { subscribe, set } = writable(loadPdfViewerMode());

  return {
    subscribe,
    set: (value) => {
      set(value);
      if (browser) {
        try {
          localStorage.setItem(PDF_VIEWER_STORAGE_KEY, value);
        } catch (e) {
          console.warn('Não foi possível salvar o modo de visualização no localStorage:', e);
        }
      }
    }
  };
}

export const pdfViewer = createPdfViewerStore();

