import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const SAVED_PLAYLISTS_STORAGE_KEY = 'savedPlaylists';

/**
 * Generate default playlist name: "lista dd/mm/yyyy HH:mm:ss"
 * @returns {string}
 */
function generateDefaultPlaylistName() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  return `lista ${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

/**
 * Generate unique ID for playlist
 * @returns {string}
 */
function generatePlaylistId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function loadSavedPlaylistsFromStorage() {
  if (!browser) return [];
  
  try {
    const raw = localStorage.getItem(SAVED_PLAYLISTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Ensure all playlists have the favorita field for backward compatibility
      return parsed.map(p => ({
        ...p,
        favorita: p.favorita !== undefined ? p.favorita : false
      }));
    }
  } catch (e) {
    console.warn('Não foi possível ler as playlists salvas do localStorage:', e);
  }
  return [];
}

function createSavedPlaylistsStore() {
  const { subscribe, set, update } = writable(loadSavedPlaylistsFromStorage());

  return {
    subscribe,
    /**
     * Save a new playlist
     * @param {string[]} pdfIds - Array of PDF IDs in order
     * @param {string} [nome] - Optional playlist name, defaults to generated name
     * @returns {string} - The ID of the saved playlist
     */
    savePlaylist: (pdfIds, nome) => {
      const playlistName = nome || generateDefaultPlaylistName();
      const newPlaylist = {
        id: generatePlaylistId(),
        nome: playlistName,
        pdfIds: [...pdfIds],
        createdAt: new Date().toISOString(),
        favorita: false
      };
      
      update(playlists => {
        const updated = [...playlists, newPlaylist];
        
        if (browser) {
          try {
            localStorage.setItem(SAVED_PLAYLISTS_STORAGE_KEY, JSON.stringify(updated));
          } catch (e) {
            console.warn('Não foi possível salvar a playlist no localStorage:', e);
          }
        }
        
        return updated;
      });
      
      return newPlaylist.id;
    },
    /**
     * Get all saved playlists
     * @returns {Array<{id: string, nome: string, pdfIds: string[], createdAt: string}>}
     */
    getAllPlaylists: () => {
      let playlists = [];
      subscribe(value => {
        playlists = value;
      })();
      return playlists;
    },
    /**
     * Get a specific playlist by ID
     * @param {string} id
     * @returns {{id: string, nome: string, pdfIds: string[], createdAt: string} | null}
     */
    getPlaylist: (id) => {
      let playlist = null;
      subscribe(value => {
        playlist = value.find(p => p.id === id) || null;
      })();
      return playlist;
    },
    /**
     * Remove a playlist by ID
     * @param {string} id
     */
    removePlaylist: (id) => {
      update(playlists => {
        const filtered = playlists.filter(p => p.id !== id);
        
        if (browser) {
          try {
            localStorage.setItem(SAVED_PLAYLISTS_STORAGE_KEY, JSON.stringify(filtered));
          } catch (e) {
            console.warn('Não foi possível remover a playlist do localStorage:', e);
          }
        }
        
        return filtered;
      });
    },
    /**
     * Update playlist name
     * @param {string} id
     * @param {string} newName
     */
    updatePlaylistName: (id, newName) => {
      update(playlists => {
        const updated = playlists.map(p => 
          p.id === id ? { ...p, nome: newName } : p
        );
        
        if (browser) {
          try {
            localStorage.setItem(SAVED_PLAYLISTS_STORAGE_KEY, JSON.stringify(updated));
          } catch (e) {
            console.warn('Não foi possível atualizar o nome da playlist no localStorage:', e);
          }
        }
        
        return updated;
      });
    },
    /**
     * Find a playlist with the same pdfIds in the same order
     * @param {string[]} pdfIds - Array of PDF IDs in order
     * @returns {{id: string, nome: string, pdfIds: string[], createdAt: string, favorita: boolean} | null}
     */
    findPlaylistByPdfIds: (pdfIds) => {
      let found = null;
      subscribe(value => {
        const pdfIdsStr = pdfIds.join(',');
        found = value.find(p => p.pdfIds.join(',') === pdfIdsStr) || null;
      })();
      return found;
    },
    /**
     * Toggle favorite status of a playlist
     * @param {string} id
     */
    toggleFavorite: (id) => {
      update(playlists => {
        const updated = playlists.map(p => 
          p.id === id ? { ...p, favorita: !p.favorita } : p
        );
        
        if (browser) {
          try {
            localStorage.setItem(SAVED_PLAYLISTS_STORAGE_KEY, JSON.stringify(updated));
          } catch (e) {
            console.warn('Não foi possível atualizar o favorito da playlist no localStorage:', e);
          }
        }
        
        return updated;
      });
    }
  };
}

export const savedPlaylists = createSavedPlaylistsStore();

