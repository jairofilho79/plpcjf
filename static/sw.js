// Service Worker for PWA Offline Mode
// Handles caching of PDFs and app resources for offline access

const CACHE_VERSION = 'plpc-v2';
const APP_CACHE = `${CACHE_VERSION}-app`;
const PDF_CACHE = `${CACHE_VERSION}-pdfs`;

// App shell resources to cache on install
// Note: Only cache the root '/' HTML shell, not individual SPA routes like '/leitor'
// SvelteKit's client-side router will handle routing to /leitor once the app shell loads
const APP_SHELL = [
  '/',
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

  // Check if this is a navigation request (page load)
  const isNavigationRequest = event.request.mode === 'navigate';

  // Handle PDF requests (but not navigation requests for PDF URLs)
  // Intercept ALL PDF files regardless of path (/pdfs/, /assets/, etc.)
  // Exclude SvelteKit's internal assets (like JS bundles) by checking URL structure
  const isPdfRequest = !isNavigationRequest && 
    url.pathname.endsWith('.pdf') &&
    // Exclude SvelteKit internal assets by checking if it's a real PDF file request
    // (not a JS/CSS bundle that happens to have .pdf in the name)
    !url.pathname.includes('/_app/') &&
    !url.pathname.includes('/node_modules/');
  
  if (isPdfRequest) {
    // Cache First strategy: Check cache FIRST, then network
    // This avoids network timeout delays when PDF is already cached
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          if (cachedResponse) {
            console.log('[SW] Serving PDF from cache (Cache First):', url.pathname);
            return cachedResponse;
          }
          
          // Not in cache, fetch from network
          console.log('[SW] PDF not in cache, fetching from network:', url.pathname);
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
              // Try cache one more time in case it was added between checks
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

  // Handle navigation requests (page loads) - SvelteKit SPA routing
  if (isNavigationRequest) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache successful navigation responses
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(APP_CACHE).then(cache => {
              cache.put(event.request, responseClone);
              console.log('[SW] Cached navigation response for:', url.pathname);
            });
          }
          return response;
        })
        .catch(() => {
          // When offline, serve the cached HTML shell for SvelteKit SPA routing
          // SvelteKit's client-side router will handle the actual route based on the URL
          console.log('[SW] Navigation request offline for:', url.pathname);
          
          // Try to serve the specific route from cache first (if previously visited)
          return caches.match(event.request)
            .then(cached => {
              if (cached) {
                console.log('[SW] Serving cached route:', url.pathname);
                return cached;
              }
              
              // If specific route not cached, serve the root '/' HTML shell
              // This is the correct approach for SvelteKit SPA - the same HTML is served
              // for all routes, and the client-side router handles the actual routing
              console.log('[SW] Route not cached, serving / shell for SvelteKit routing:', url.pathname);
              return caches.match('/');
            });
        })
    );
    return;
  }

  // Handle app shell and manifest requests (non-navigation)
  if (APP_SHELL.some(path => url.pathname === path || url.pathname.startsWith(path))) {
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          return fetch(event.request)
            .then(response => {
              if (response && response.status === 200) {
                const responseClone = response.clone();
                caches.open(APP_CACHE).then(cache => {
                  cache.put(event.request, responseClone);
                });
              }
              return response;
            })
            .catch(() => {
              // If offline and not in cache, return the cached index if available
              // This helps ensure the app shell is always available
              return caches.match('/').catch(() => {
                // If even index is not cached, let the request fail normally
                return fetch(event.request);
              });
            });
        })
        .catch(() => {
          // If cache.match fails entirely, try network
          return fetch(event.request);
        })
    );
    return;
  }

  // For all other requests (JS, CSS, images, etc.), cache first when offline
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        // Not in cache, try network
        return fetch(event.request)
          .then(response => {
            // Cache successful responses for future offline use
            if (response && response.status === 200) {
              const responseClone = response.clone();
              caches.open(APP_CACHE).then(cache => {
                cache.put(event.request, responseClone);
              });
            }
            return response;
          })
          .catch(() => {
            // Offline and not in cache - fetch will fail, but let it fail gracefully
            // Return a rejected promise so the browser can handle it
            return Promise.reject(new Error('Network error and not in cache'));
          });
      })
      .catch(() => {
        // If cache.match fails, try network one more time
        return fetch(event.request);
      })
  );
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
    // Filter for all PDF files regardless of path
    const pdfUrls = requests
      .map(req => req.url)
      .filter(url => {
        try {
          const urlObj = new URL(url);
          return urlObj.pathname.endsWith('.pdf') && 
                 !urlObj.pathname.includes('/_app/') &&
                 !urlObj.pathname.includes('/node_modules/');
        } catch {
          return false;
        }
      });
    
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

