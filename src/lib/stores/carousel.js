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
    addLouvor: (louvor) => {
      update(louvores => {
        // Check if already exists
        if (louvores.some(item => 
          item.numero === louvor.numero && 
          item.nome === louvor.nome && 
          item.classificacao === louvor.classificacao
        )) {
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
    removeLouvor: (numero, nome, classificacao) => {
      update(louvores => {
        const filtered = louvores.filter(item => 
          !(item.numero === numero && item.nome === nome && item.classificacao === classificacao)
        );
        
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
    }
  };
}

export const carousel = createCarouselStore();

