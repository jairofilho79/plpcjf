// Service Worker Registration Utility
// Handles registration and communication with the service worker

let swRegistration = null;

/**
 * Register the service worker
 * @returns {Promise<ServiceWorkerRegistration|null>}
 */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[SW Registration] Service workers not supported');
    return null;
  }

  try {
    // Register the service worker
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/'
    });

    swRegistration = registration;

    // Check for updates periodically
    setInterval(() => {
      registration.update();
    }, 60 * 60 * 1000); // Check every hour

    // Handle updates
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New service worker available
            console.log('[SW Registration] New service worker available');
            // Notify user about update
            dispatchUpdateEvent();
          }
        });
      }
    });

    console.log('[SW Registration] Service worker registered successfully');
    return registration;
  } catch (error) {
    console.error('[SW Registration] Failed to register service worker:', error);
    return null;
  }
}

/**
 * Unregister the service worker
 */
export async function unregisterServiceWorker() {
  if (!swRegistration) {
    return false;
  }

  try {
    const success = await swRegistration.unregister();
    console.log('[SW Registration] Service worker unregistered:', success);
    swRegistration = null;
    return success;
  } catch (error) {
    console.error('[SW Registration] Failed to unregister service worker:', error);
    return false;
  }
}

/**
 * Send a message to the service worker and wait for response
 * @param {object} message - Message to send
 * @returns {Promise<any>}
 */
export function sendMessageToSW(message, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;
  return new Promise((resolve, reject) => {
    if (!navigator.serviceWorker.controller) {
      reject(new Error('No service worker controller'));
      return;
    }

    const messageChannel = new MessageChannel();

    messageChannel.port1.onmessage = (event) => {
      resolve(event.data);
    };

    navigator.serviceWorker.controller.postMessage(message, [messageChannel.port2]);

    // Use bounded timeout to avoid UI hanging indefinitely.
    setTimeout(() => {
      reject(new Error('Service worker message timeout'));
    }, timeoutMs);
  });
}

/**
 * Download PDFs via service worker
 * @param {string[]} pdfUrls - Array of PDF URLs to download
 * @param {number} batchSize - Number of PDFs to download in parallel
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<object>}
 */
export async function downloadPDFsViaSW(pdfUrls, batchSize = 10, onProgress = null) {
  return new Promise((resolve, reject) => {
    if (!navigator.serviceWorker.controller) {
      reject(new Error('No service worker controller'));
      return;
    }

    const messageChannel = new MessageChannel();

    messageChannel.port1.onmessage = (event) => {
      const { type, ...data } = event.data;

      switch (type) {
        case 'PROGRESS':
          if (onProgress) {
            onProgress(data);
          }
          break;
        
        case 'COMPLETE':
          resolve(data);
          break;
        
        case 'ERROR':
          reject(new Error(data.error || 'Download failed'));
          break;
        
        case 'CANCELLED':
          resolve({ ...data, cancelled: true });
          break;
        
        default:
          console.warn('[SW Message] Unknown response type:', type);
      }
    };

    navigator.serviceWorker.controller.postMessage(
      {
        type: 'DOWNLOAD_PDFS',
        data: {
          pdfsToDownload: pdfUrls,
          batchSize
        }
      },
      [messageChannel.port2]
    );
  });
}

/**
 * Cancel ongoing download
 * @returns {Promise<void>}
 */
export async function cancelDownload() {
  try {
    await sendMessageToSW({ type: 'CANCEL_DOWNLOAD', data: {} });
  } catch (error) {
    console.error('[SW Message] Failed to cancel download:', error);
  }
}

const CACHED_PDFS_LOCAL_KEY = 'cachedPdfsListLocal';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/**
 * Check if cache storage is actually available
 * @returns {Promise<boolean>}
 */
async function isCacheStorageAvailable() {
  if (typeof caches === 'undefined') {
    return false;
  }
  
  try {
    // Try to open the PDF cache to verify it exists
    const cache = await caches.open('plpc-pdfs');
    // If we can open it, cache storage is available
    return true;
  } catch (err) {
    // If we can't open it, cache storage is not available
    return false;
  }
}

/**
 * Get list of cached PDFs with local cache optimization
 * Uses localStorage cache first, then falls back to Service Worker
 * IMPORTANT: Invalidates localStorage cache if cache storage is not available
 * @param {{ preferFresh?: boolean }} [options]
 * @returns {Promise<string[]>}
 */
export async function getCachedPDFsFast(options = {}) {
  const preferFresh = options.preferFresh === true;

  // Verificar se cache storage está disponível
  const cacheStorageAvailable = await isCacheStorageAvailable();
  
  // Se cache storage não está disponível, invalidar cache do localStorage
  if (!cacheStorageAvailable) {
    console.log('[SW Message] Cache storage not available, invalidating localStorage cache');
    invalidateCachedPDFsLocal();
    return [];
  }
  
  // Verificar cache local primeiro (exceto quando fluxo crítico pede leitura fresca)
  if (!preferFresh && typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const cached = localStorage.getItem(CACHED_PDFS_LOCAL_KEY);
      if (cached) {
        const { pdfs, timestamp } = JSON.parse(cached);
        // Verificar se cache ainda é válido (TTL de 5 minutos)
        if (Date.now() - timestamp < CACHE_TTL) {
          console.log('[SW Message] Using cached PDFs list from localStorage');
          return pdfs;
        }
      }
    } catch (err) {
      console.warn('[SW Message] Failed to read local cache:', err);
    }
  }

  // Cache expirado ou não disponível - buscar do Service Worker
  const pdfs = await getCachedPDFs();
  
  // Se Service Worker retornou array vazio, verificar novamente se cache storage existe
  // Isso pode acontecer se o cache foi limpo mas localStorage ainda tem dados antigos
  if (pdfs.length === 0 && cacheStorageAvailable) {
    // Verificar diretamente no cache storage se há PDFs
    try {
      const cache = await caches.open('plpc-pdfs');
      const requests = await cache.keys();
      const pdfCount = requests.filter(req => {
        try {
          const url = new URL(req.url);
          return url.pathname.endsWith('.pdf') && 
                 !url.pathname.includes('/_app/') &&
                 !url.pathname.includes('/node_modules/');
        } catch {
          return false;
        }
      }).length;
      
      // Se não há PDFs no cache storage, invalidar localStorage
      if (pdfCount === 0) {
        console.log('[SW Message] No PDFs in cache storage, invalidating localStorage cache');
        invalidateCachedPDFsLocal();
        return [];
      }
    } catch (err) {
      console.warn('[SW Message] Failed to verify cache storage:', err);
    }
  }
  
  // Atualizar cache local apenas se houver PDFs
  if (pdfs.length > 0 && typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(CACHED_PDFS_LOCAL_KEY, JSON.stringify({
        pdfs,
        timestamp: Date.now()
      }));
    } catch (err) {
      console.warn('[SW Message] Failed to update local cache:', err);
    }
  } else if (pdfs.length === 0) {
    // Se não há PDFs, limpar cache do localStorage para evitar dados antigos
    invalidateCachedPDFsLocal();
  }
  
  return pdfs;
}

/**
 * Invalidate local cache of PDFs
 */
export function invalidateCachedPDFsLocal() {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(CACHED_PDFS_LOCAL_KEY);
      console.log('[SW Message] Invalidated local PDFs cache');
    } catch (err) {
      console.warn('[SW Message] Failed to invalidate local cache:', err);
    }
  }
}

/**
 * Get list of cached PDFs (original function - kept for compatibility)
 * @returns {Promise<string[]>}
 */
export async function getCachedPDFs() {
  try {
    // Verificar se service worker está disponível
    if (!('serviceWorker' in navigator)) {
      console.warn('[SW Message] Service workers not supported');
      return [];
    }

    // Aguardar service worker estar pronto (reduzido para 500ms para melhor performance)
    const isReady = await waitForServiceWorker(500);
    
    if (!isReady || !navigator.serviceWorker.controller) {
      console.warn('[SW Message] Service worker not ready, returning empty list');
      return [];
    }

    // Keep timeout short for read operations; if SW is unhealthy, fail fast.
    const response = await sendMessageToSW(
      { type: 'GET_CACHED_PDFS', data: {} },
      { timeoutMs: navigator.onLine ? 5000 : 2000 }
    );
    return response.pdfs || [];
  } catch (error) {
    // Log apenas se for erro diferente de "no controller"
    if (!error.message.includes('No service worker controller')) {
      console.error('[SW Message] Failed to get cached PDFs:', error);
    }
    return [];
  }
}

/**
 * Clear all caches
 * @returns {Promise<void>}
 */
export async function clearCache() {
  try {
    await sendMessageToSW({ type: 'CLEAR_CACHE', data: {} });
  } catch (error) {
    console.error('[SW Message] Failed to clear cache:', error);
    throw error;
  }
}

/**
 * Clear a specific PDF entry from the Service Worker PDF cache
 * to force a refetch from the network on the next request.
 *
 * @param {string} pdfPath - PDF path (e.g., "assets/ColAdultos/000.pdf" or "/assets/ColAdultos/000.pdf")
 * @returns {Promise<{ pdfPath: string, removedCount: number } | void>}
 */
export async function clearPdfFromSwCache(pdfPath) {
  try {
    const response = await sendMessageToSW({
      type: 'CLEAR_PDF_CACHE_ENTRY',
      data: { pdfPath }
    });

    return response;
  } catch (error) {
    console.error('[SW Message] Failed to clear PDF cache entry:', error);
    throw error;
  }
}

/**
 * Remove cached louvores-manifest.json from the app shell cache so the next fetch hits the network.
 * No-op when there is no controlling service worker.
 */
export async function clearLouvoresManifestFromSwCache() {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
    return;
  }
  try {
    await sendMessageToSW({ type: 'CLEAR_LOUVORES_MANIFEST_CACHE', data: {} });
  } catch (error) {
    console.warn('[SW Registration] clearLouvoresManifestFromSwCache:', error);
  }
}

/**
 * Check if service worker is ready
 * @returns {boolean}
 */
export function isServiceWorkerReady() {
  return !!(navigator.serviceWorker && navigator.serviceWorker.controller);
}

/**
 * Wait for service worker to be ready
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>}
 */
export function waitForServiceWorker(timeout = 10000) {
  return new Promise((resolve) => {
    if (isServiceWorkerReady()) {
      resolve(true);
      return;
    }

    const timeoutId = setTimeout(() => {
      resolve(false);
    }, timeout);

    navigator.serviceWorker.ready.then(() => {
      clearTimeout(timeoutId);
      resolve(true);
    });
  });
}

/**
 * Dispatch custom event when service worker updates
 */
function dispatchUpdateEvent() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sw-update-available'));
  }
}

/**
 * Get the current service worker registration
 * @returns {ServiceWorkerRegistration|null}
 */
export function getRegistration() {
  return swRegistration;
}

/**
 * Setup Service Worker message listener for cache updates
 * @returns {Function} Cleanup function
 */
export function setupServiceWorkerMessageListener() {
  if (!('serviceWorker' in navigator)) {
    return () => {};
  }

  const messageHandler = async (event) => {
    if (event.data && event.data.type === 'CACHE_UPDATED') {
      console.log('[SW Registration] Cache updated notification received from Service Worker');
      
      // Invalidate local cache when SW cache is updated
      invalidateCachedPDFsLocal();
      
      // Import and notify cache sync system
      const { notifyCacheUpdate, updateCacheVersion } = await import('$lib/utils/cacheSync');
      notifyCacheUpdate({ source: 'service-worker' });
      
      // Update cache version
      await updateCacheVersion();
      
      // Dispatch custom event for components (cache sync)
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('cache-sync-required', {
          detail: { 
            source: 'service-worker', 
            timestamp: event.data.timestamp,
            cleared: event.data.cleared || false
          }
        }));
        
        // Also dispatch offline-cache-updated event for offline page
        window.dispatchEvent(new CustomEvent('offline-cache-updated', {
          detail: {
            source: 'service-worker',
            timestamp: event.data.timestamp || Date.now(),
            cleared: event.data.cleared || false
          }
        }));
      }
    }
  };

  navigator.serviceWorker.addEventListener('message', messageHandler);

  // Return cleanup function
  return () => {
    navigator.serviceWorker.removeEventListener('message', messageHandler);
  };
}

