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
export function sendMessageToSW(message) {
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

    // Timeout after 5 minutes for long operations
    setTimeout(() => {
      reject(new Error('Service worker message timeout'));
    }, 5 * 60 * 1000);
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

/**
 * Get list of cached PDFs
 * @returns {Promise<string[]>}
 */
export async function getCachedPDFs() {
  try {
    const response = await sendMessageToSW({ type: 'GET_CACHED_PDFS', data: {} });
    return response.pdfs || [];
  } catch (error) {
    console.error('[SW Message] Failed to get cached PDFs:', error);
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

