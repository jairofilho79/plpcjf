// Cache Synchronization Utility
// Handles synchronization between tabs and Service Worker notifications

import { getConfig } from '$lib/offline/core/OfflineConfig.js';
// `typeof localStorage === 'undefined'` não protegia nada: no Firefox com dados
// bloqueados é o getter global que lança, e a própria guarda lançava. Ver o
// comentário de topo de `safeStorage.js`.
import { getStorage, safeGet, safeSet, safeRemove } from '$lib/utils/safeStorage.js';

const CACHE_SYNC_CHANNEL = 'pdf-cache-sync';
const CACHE_VERSION_KEY = 'pdfCacheVersion';

let syncChannel = null;
let syncListeners = [];

/**
 * Initialize cache synchronization
 * @returns {BroadcastChannel|null}
 */
export function setupCacheSync() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }

  if (syncChannel) {
    return syncChannel;
  }

  try {
    syncChannel = new BroadcastChannel(CACHE_SYNC_CHANNEL);

    // Listen for cache updates from other tabs
    syncChannel.onmessage = async (event) => {
      if (event.data && event.data.type === 'CACHE_UPDATED') {
        console.log('[Cache Sync] Cache updated in another tab, triggering sync...');
        
        // Notify all listeners
        syncListeners.forEach(listener => {
          try {
            listener(event.data);
          } catch (err) {
            console.error('[Cache Sync] Error in sync listener:', err);
          }
        });

        // Dispatch custom event for components
        if (typeof window !== 'undefined' && window.dispatchEvent) {
          window.dispatchEvent(new CustomEvent('cache-sync-required', {
            detail: { source: 'broadcast', timestamp: event.data.timestamp }
          }));
        }
      }
    };

    console.log('[Cache Sync] BroadcastChannel initialized');
    return syncChannel;
  } catch (error) {
    console.error('[Cache Sync] Failed to setup BroadcastChannel:', error);
    return null;
  }
}

/**
 * Notify other tabs that cache has been updated
 * @param {object} data - Additional data to send
 */
export function notifyCacheUpdate(data = {}) {
  if (!syncChannel) {
    setupCacheSync();
  }

  if (syncChannel) {
    try {
      syncChannel.postMessage({
        type: 'CACHE_UPDATED',
        timestamp: Date.now(),
        ...data
      });
      console.log('[Cache Sync] Notified other tabs of cache update');
    } catch (error) {
      console.error('[Cache Sync] Failed to notify cache update:', error);
    }
  }
}

/**
 * Add a listener for cache sync events
 * @param {Function} listener - Callback function
 * @returns {Function} Unsubscribe function
 */
export function onCacheSync(listener) {
  if (typeof listener !== 'function') {
    console.warn('[Cache Sync] Listener must be a function');
    return () => {};
  }

  syncListeners.push(listener);

  // Return unsubscribe function
  return () => {
    const index = syncListeners.indexOf(listener);
    if (index > -1) {
      syncListeners.splice(index, 1);
    }
  };
}

/**
 * Get current cache version (based on cache size and timestamp)
 * @returns {Promise<string|null>}
 */
export async function getCacheVersion() {
  if (typeof caches === 'undefined') {
    return null;
  }

  try {
    // Use centralized cache name from OfflineConfig to ensure consistency
    const pdfCacheName = getConfig('PDF_CACHE_NAME') || getConfig('DEFAULT_PDF_CACHE_FALLBACK') || 'plpc-pdfs';
    const cache = await caches.open(pdfCacheName);
    const keys = await cache.keys();
    
    // Generate version based on count and a hash of URLs
    const urls = keys.map(req => req.url).sort().join('|');
    const hash = await simpleHash(urls);
    const version = `${keys.length}-${hash}`;
    
    return version;
  } catch (error) {
    console.error('[Cache Sync] Failed to get cache version:', error);
    return null;
  }
}

/**
 * Simple hash function for cache versioning
 * @param {string} str - String to hash
 * @returns {Promise<string>}
 */
async function simpleHash(str) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(str);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
    } catch (error) {
      console.warn('[Cache Sync] Crypto API not available, using fallback hash');
    }
  }
  
  // Fallback hash
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).substring(0, 16);
}

/**
 * Check if cache version has changed
 * @returns {Promise<boolean>}
 */
export async function checkCacheVersionChanged() {
  if (typeof window === 'undefined' || !getStorage()) {
    return false;
  }

  try {
    const currentVersion = await getCacheVersion();

    if (!currentVersion) {
      return false;
    }

    const storedVersion = safeGet(CACHE_VERSION_KEY);

    if (!storedVersion) {
      // First time, store current version
      if (!safeSet(CACHE_VERSION_KEY, currentVersion)) {
        console.error('[Cache Sync] Failed to check cache version: gravação da versão recusada');
      }
      return false;
    }

    if (storedVersion !== currentVersion) {
      // Version changed, update stored version.
      // A gravação faz parte da resposta: o `true` promete que a versão nova
      // ficou registada. Num storage que lê e recusa gravar (cota estourada), o
      // `setItem` cru lançava, caía no `catch` abaixo e devolvia `false` — sem
      // este `if`, quem chama remarcaria "precisa sincronizar" a cada foco de
      // janela, para sempre, porque a versão nova nunca chega a ser gravada.
      if (!safeSet(CACHE_VERSION_KEY, currentVersion)) {
        console.error('[Cache Sync] Failed to check cache version: gravação da versão recusada');
        return false;
      }
      console.log('[Cache Sync] Cache version changed');
      return true;
    }

    return false;
  } catch (error) {
    console.error('[Cache Sync] Failed to check cache version:', error);
    return false;
  }
}

/**
 * Update cache version after cache changes
 * @returns {Promise<void>}
 */
export async function updateCacheVersion() {
  if (typeof window === 'undefined' || !getStorage()) {
    return;
  }

  try {
    const version = await getCacheVersion();
    if (version && !safeSet(CACHE_VERSION_KEY, version)) {
      // Mesmo motivo do `clearCacheVersion`: `safeSet` engole a exceção que
      // antes caía no `catch` abaixo, e o aviso tem de sobreviver a ela.
      console.error('[Cache Sync] Failed to update cache version: gravação recusada');
    }
  } catch (error) {
    console.error('[Cache Sync] Failed to update cache version:', error);
  }
}

/**
 * Clear cache version (useful when cache is cleared)
 */
export function clearCacheVersion() {
  if (typeof window === 'undefined') {
    return;
  }

  // Sem guarda de `getStorage()` aqui, de propósito: com o storage bloqueado
  // ela devolveria `null` e esta função sairia calada, engolindo o
  // `console.error` que o código antigo emitia — ficaríamos sem rasto nenhum
  // na consola justamente no cenário desta fase (Firefox estrito a limpar
  // dados). `safeRemove` devolve `false` só quando o acesso lançou, que é
  // exatamente o caso que caía no `catch`, e nunca lança.
  if (safeRemove(CACHE_VERSION_KEY)) {
    console.log('[Cache Sync] Cache version cleared');
  } else {
    console.error('[Cache Sync] Failed to clear cache version: acesso ao localStorage lançou');
  }
}

/**
 * Close sync channel (cleanup)
 */
export function closeCacheSync() {
  if (syncChannel) {
    try {
      syncChannel.close();
      syncChannel = null;
      syncListeners = [];
      console.log('[Cache Sync] BroadcastChannel closed');
    } catch (error) {
      console.error('[Cache Sync] Failed to close channel:', error);
    }
  }
}



