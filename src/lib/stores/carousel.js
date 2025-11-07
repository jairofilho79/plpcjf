import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const CAROUSEL_STORAGE_KEY = 'carouselLouvores';

function loadCarouselFromStorage() {
  if (!browser) return [];
  
  try {
    const raw = localStorage.getItem(CAROUSEL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    console.warn('Não foi possível ler o carousel do localStorage:', e);
  }
  return [];
}

function createCarouselStore() {
  const { subscribe, set, update } = writable(loadCarouselFromStorage());

  return {
    subscribe,
    addLouvor: (/** @type {{ pdfId: any; }} */ louvor) => {
      update(louvores => {
        // Check if already exists
        if (louvores.some(item => item.pdfId === louvor.pdfId)) {
          return louvores;
        }
        
        const updated = [...louvores, louvor];
        
        if (browser) {
          try {
            localStorage.setItem(CAROUSEL_STORAGE_KEY, JSON.stringify(updated));
          } catch (e) {
            console.warn('Não foi possível salvar o carousel no localStorage:', e);
          }
        }
        
        return updated;
      });
    },
    removeLouvor: (/** @type {any} */ pdfId) => {
      update(louvores => {
        const filtered = louvores.filter(item => item.pdfId !== pdfId);
        
        if (browser) {
          try {
            localStorage.setItem(CAROUSEL_STORAGE_KEY, JSON.stringify(filtered));
          } catch (e) {
            console.warn('Não foi possível salvar o carousel no localStorage:', e);
          }
        }
        
        return filtered;
      });
    },
    clearCarousel: () => {
      set([]);
      if (browser) {
        try {
          localStorage.removeItem(CAROUSEL_STORAGE_KEY);
        } catch (e) {
          console.warn('Não foi possível limpar o carousel do localStorage:', e);
        }
      }
    },
    reorderCarousel: (/** @type {number} */ fromIndex, /** @type {number} */ toIndex) => {
      update(louvores => {
        if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= louvores.length || toIndex >= louvores.length) {
          return louvores;
        }
        
        const reordered = [...louvores];
        const [removed] = reordered.splice(fromIndex, 1);
        reordered.splice(toIndex, 0, removed);
        
        if (browser) {
          try {
            localStorage.setItem(CAROUSEL_STORAGE_KEY, JSON.stringify(reordered));
          } catch (e) {
            console.warn('Não foi possível salvar o carousel no localStorage:', e);
          }
        }
        
        return reordered;
      });
    },
    /**
     * Set the entire carousel with a list of louvores
     * @param {Array<any>} louvoresList - Array of louvor objects
     */
    setCarousel: (/** @type {Array<any>} */ louvoresList) => {
      const carouselLouvores = Array.isArray(louvoresList) ? [...louvoresList] : [];
      set(carouselLouvores);
      
      if (browser) {
        try {
          localStorage.setItem(CAROUSEL_STORAGE_KEY, JSON.stringify(carouselLouvores));
        } catch (e) {
          console.warn('Não foi possível salvar o carousel no localStorage:', e);
        }
      }
    },
    /**
     * Load playlist from array of pdfIds
     * Requires louvores store to be available
     * @param {string[]} pdfIds - Array of PDF IDs in order
     * @param {Array<any>} allLouvores - Array of all available louvores
     */
    loadPlaylist: (/** @type {string[]} */ pdfIds, /** @type {Array<any>} */ allLouvores) => {
      if (!Array.isArray(pdfIds) || !Array.isArray(allLouvores)) {
        console.warn('loadPlaylist: pdfIds e allLouvores devem ser arrays');
        return;
      }
      
      // Create a map for quick lookup
      const louvoresMap = new Map();
      allLouvores.forEach(louvor => {
        if (louvor.pdfId) {
          louvoresMap.set(louvor.pdfId, louvor);
        }
      });
      
      // Build playlist in order
      const playlistLouvores = pdfIds
        .map(pdfId => louvoresMap.get(pdfId))
        .filter(louvor => louvor !== undefined);
      
      // Set the carousel with the loaded playlist
      const carouselLouvores = [...playlistLouvores];
      set(carouselLouvores);
      
      if (browser) {
        try {
          localStorage.setItem(CAROUSEL_STORAGE_KEY, JSON.stringify(carouselLouvores));
        } catch (e) {
          console.warn('Não foi possível salvar o carousel no localStorage:', e);
        }
      }
    }
  };
}

export const carousel = createCarouselStore();

