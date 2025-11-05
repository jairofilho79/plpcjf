// Service Worker for PWA Offline Mode
// Handles caching of PDFs and app resources for offline access

const CACHE_VERSION = 'plpc-v1';
const APP_CACHE = `${CACHE_VERSION}-app`;
const PDF_CACHE = `${CACHE_VERSION}-pdfs`;

// App shell resources to cache on install
const APP_SHELL = [
  '/',
  '/leitor',
  '/manifest.json',
  '/louvores-manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png'
];

// State for batch downloading
let downloadState = {
  isDownloading: false,
  cancelled: false,
  currentBatch: 0
};

// Install event - cache app shell
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => {
        console.log('[SW] Caching app shell');
        return cache.addAll(APP_SHELL.map(url => new Request(url, { cache: 'no-cache' })));
      })
      .then(() => self.skipWaiting())
      .catch(err => console.error('[SW] Install failed:', err))
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name.startsWith('plpc-') && name !== APP_CACHE && name !== PDF_CACHE)
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Only handle same-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // Handle PDF requests
  if (url.pathname.includes('.pdf') || url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          if (cachedResponse) {
            console.log('[SW] Serving PDF from cache:', url.pathname);
            return cachedResponse;
          }
          
          // Not in cache, fetch from network
          return fetch(event.request)
            .then(response => {
              // Only cache successful responses
              if (response && response.status === 200) {
                const responseClone = response.clone();
                caches.open(PDF_CACHE).then(cache => {
                  cache.put(event.request, responseClone);
                  console.log('[SW] Cached PDF:', url.pathname);
                });
              }
              return response;
            })
            .catch(err => {
              console.error('[SW] Failed to fetch PDF:', url.pathname, err);
              // Try cache again in case it was just added
              return caches.match(event.request)
                .then(cached => {
                  if (cached) {
                    console.log('[SW] Serving PDF from cache after network failure:', url.pathname);
                    return cached;
                  }
                  throw err;
                });
            });
        })
    );
    return;
  }

  // Handle SvelteKit routes for offline access (like /leitor)
  // This needs to be checked before the general app shell handler
  if (url.pathname.startsWith('/leitor')) {
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          if (cachedResponse) {
            console.log('[SW] Serving /leitor route from cache:', url.pathname);
            return cachedResponse;
          }
          
          // Network first for navigation requests
          return fetch(event.request)
            .then(response => {
              // Cache successful responses (including HTML, JS, CSS)
              if (response && response.status === 200) {
                const responseClone = response.clone();
                caches.open(APP_CACHE).then(cache => {
                  cache.put(event.request, responseClone);
                });
              }
              return response;
            })
            .catch(err => {
              // If offline and route not cached, try to serve from cache
              // or fallback to index page
              console.log('[SW] Network failed for /leitor, trying cache fallback');
              return caches.match(event.request)
                .then(cached => cached || caches.match('/'));
            });
        })
    );
    return;
  }

  // Handle app shell and manifest requests
  if (APP_SHELL.some(path => url.pathname === path || url.pathname.startsWith(path))) {
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          return fetch(event.request).then(response => {
            if (response && response.status === 200) {
              const responseClone = response.clone();
              caches.open(APP_CACHE).then(cache => {
                cache.put(event.request, responseClone);
              });
            }
            return response;
          });
        })
    );
    return;
  }

  // For all other requests, network first
  event.respondWith(fetch(event.request));
});

// Message handling for download control
self.addEventListener('message', (event) => {
  const { type, data } = event.data;

  switch (type) {
    case 'DOWNLOAD_PDFS':
      handleDownloadPDFs(event, data);
      break;
    
    case 'CANCEL_DOWNLOAD':
      handleCancelDownload(event);
      break;
    
    case 'GET_CACHED_PDFS':
      handleGetCachedPDFs(event);
      break;
    
    case 'CLEAR_CACHE':
      handleClearCache(event);
      break;
    
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    
    default:
      console.warn('[SW] Unknown message type:', type);
  }
});

// Download PDFs in batches
async function handleDownloadPDFs(event, data) {
  const { pdfsToDownload, batchSize = 10 } = data;
  
  if (!pdfsToDownload || !Array.isArray(pdfsToDownload)) {
    event.ports[0].postMessage({ type: 'ERROR', error: 'Invalid PDFs list' });
    return;
  }

  downloadState.isDownloading = true;
  downloadState.cancelled = false;
  downloadState.currentBatch = 0;

  const total = pdfsToDownload.length;
  let completed = 0;
  let failed = 0;

  console.log(`[SW] Starting download of ${total} PDFs in batches of ${batchSize}`);
  
  try {
    const cache = await caches.open(PDF_CACHE);
    
    // Process in batches
    for (let i = 0; i < pdfsToDownload.length; i += batchSize) {
      if (downloadState.cancelled) {
        console.log('[SW] Download cancelled by user');
        event.ports[0].postMessage({ 
          type: 'CANCELLED', 
          completed, 
          failed, 
          total 
        });
        downloadState.isDownloading = false;
        return;
      }

      const batch = pdfsToDownload.slice(i, i + batchSize);
      downloadState.currentBatch++;
      
      // Download batch in parallel
      const results = await Promise.allSettled(
        batch.map(async (pdfUrl) => {
          try {
            const request = new Request(pdfUrl, { cache: 'no-cache' });
            const response = await fetch(request);
            
            if (response && response.status === 200) {
              await cache.put(request, response);
              return { success: true, url: pdfUrl };
            } else {
              throw new Error(`HTTP ${response.status}`);
            }
          } catch (err) {
            console.error('[SW] Failed to download PDF:', pdfUrl, err);
            return { success: false, url: pdfUrl, error: err.message };
          }
        })
      );

      // Count successes and failures
      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value.success) {
          completed++;
        } else {
          failed++;
        }
      });

      // Send progress update
      event.ports[0].postMessage({
        type: 'PROGRESS',
        completed,
        failed,
        total,
        percentage: Math.round((completed / total) * 100)
      });
    }

    // Download complete
    console.log(`[SW] Download complete: ${completed} successful, ${failed} failed`);
    event.ports[0].postMessage({
      type: 'COMPLETE',
      completed,
      failed,
      total
    });

  } catch (err) {
    console.error('[SW] Download error:', err);
    event.ports[0].postMessage({
      type: 'ERROR',
      error: err.message,
      completed,
      failed,
      total
    });
  } finally {
    downloadState.isDownloading = false;
  }
}

// Cancel ongoing download
function handleCancelDownload(event) {
  console.log('[SW] Cancelling download...');
  downloadState.cancelled = true;
  event.ports[0].postMessage({ type: 'CANCEL_CONFIRMED' });
}

// Get list of cached PDFs
async function handleGetCachedPDFs(event) {
  try {
    const cache = await caches.open(PDF_CACHE);
    const requests = await cache.keys();
    const pdfUrls = requests
      .map(req => req.url)
      .filter(url => url.includes('.pdf') || url.includes('/assets/'));
    
    event.ports[0].postMessage({
      type: 'CACHED_PDFS',
      pdfs: pdfUrls,
      count: pdfUrls.length
    });
  } catch (err) {
    console.error('[SW] Error getting cached PDFs:', err);
    event.ports[0].postMessage({
      type: 'ERROR',
      error: err.message
    });
  }
}

// Clear all caches
async function handleClearCache(event) {
  try {
    await caches.delete(PDF_CACHE);
    await caches.delete(APP_CACHE);
    console.log('[SW] All caches cleared');
    event.ports[0].postMessage({ type: 'CACHE_CLEARED' });
  } catch (err) {
    console.error('[SW] Error clearing cache:', err);
    event.ports[0].postMessage({
      type: 'ERROR',
      error: err.message
    });
  }
}

