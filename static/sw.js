// Service Worker for PWA Offline Mode
// Handles caching of PDFs and app resources for offline access

// Import utilities for PDF path normalization
// NOTE: Service Workers cannot use ES6 imports, so we use importScripts
importScripts('/sw-utils.js');

// IMPORTANT: Cache names must match OfflineConfig.js
// All environments use the same cache name to avoid mismatches
const CACHE_VERSION = 'plpc-v3-dev';
const APP_CACHE = `${CACHE_VERSION}-app`;
const PDF_CACHE = 'plpc-pdfs'; // Single cache name for all environments
const PDFJS_CACHE = `${CACHE_VERSION}-pdfjs`;

// Detect if we're in development mode
function isDevelopmentMode() {
  try {
    const hostname = self.location.hostname;
    // Development mode: localhost, 127.0.0.1, or any local IP
    return hostname === 'localhost' || 
           hostname === '127.0.0.1' || 
           hostname.startsWith('192.168.') ||
           hostname.startsWith('10.') ||
           hostname.startsWith('172.16.') ||
           hostname.includes('.local');
  } catch {
    return false;
  }
}

// Check if a request is a development asset (JS/CSS from Vite/SvelteKit)
function isDevelopmentAsset(url) {
  const pathname = url.pathname;
  const hasQueryString = url.search.length > 0; // Vite adds query strings to dev assets
  
  return pathname.includes('/_app/') || 
         pathname.includes('/node_modules/') ||
         pathname.includes('/src/') ||
         (pathname.endsWith('.js') && hasQueryString) ||
         (pathname.endsWith('.mjs') && hasQueryString) ||
         (pathname.endsWith('.css') && hasQueryString) ||
         (pathname.endsWith('.ts') && hasQueryString);
}

const IS_DEV = isDevelopmentMode();

if (IS_DEV) {
  console.log('[SW] Development mode detected - caching disabled for JS/CSS assets');
}

// App shell resources to cache on install
// Note: Only cache the root '/' HTML shell, not individual SPA routes like '/leitor'
// SvelteKit's client-side router will handle routing to /leitor once the app shell loads
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/louvores-manifest.json',
  '/offline-manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png'
];

// PDF.js modules to cache for faster loading
const PDFJS_MODULES = [
  '/pdfjs/build/pdf.mjs',
  '/pdfjs/web/pdf_viewer.mjs',
  '/pdfjs/build/pdf.worker.min.mjs',
  '/pdfjs/web/pdf_viewer.css'
];

// State for batch downloading
let downloadState = {
  isDownloading: false,
  cancelled: false,
  currentBatch: 0
};

// Install event - cache app shell and PDF.js
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    Promise.all([
      // Cache app shell
      caches.open(APP_CACHE)
        .then(cache => {
          console.log('[SW] Caching app shell');
          return cache.addAll(APP_SHELL.map(url => new Request(url, { cache: 'no-cache' })));
        }),
      // Cache PDF.js modules (cache-first strategy for faster loading)
      caches.open(PDFJS_CACHE)
        .then(cache => {
          console.log('[SW] Caching PDF.js modules');
          // Use addAll but don't fail if some files are missing
          return Promise.allSettled(
            PDFJS_MODULES.map(url => 
              cache.add(new Request(url, { cache: 'no-cache' }))
                .catch(err => console.warn(`[SW] Failed to cache ${url}:`, err))
            )
          );
        })
    ])
      .then(() => self.skipWaiting())
      .catch(err => console.error('[SW] Install failed:', err))
  );
});

// Clean up package ZIP files from cache
// Packages are temporary and should not remain in cache storage
async function cleanupPackageZips() {
  try {
    const cache = await caches.open(APP_CACHE);
    const requests = await cache.keys();
    
    const zipRequests = requests.filter(req => {
      try {
        const url = new URL(req.url);
        return url.pathname.startsWith('/packages/') && url.pathname.endsWith('.zip');
      } catch {
        return false;
      }
    });
    
    if (zipRequests.length > 0) {
      console.log(`[SW] Cleaning up ${zipRequests.length} package ZIP files from cache`);
      await Promise.all(zipRequests.map(req => cache.delete(req)));
      console.log('[SW] Package ZIP files cleaned up');
    }
  } catch (err) {
    console.error('[SW] Error cleaning up package ZIPs:', err);
  }
}

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys()
        .then(cacheNames => {
          return Promise.all(
            cacheNames
              .filter(name => name.startsWith('plpc-') && name !== APP_CACHE && name !== PDF_CACHE && name !== PDFJS_CACHE)
              .map(name => {
                console.log('[SW] Deleting old cache:', name);
                return caches.delete(name);
              })
          );
        }),
      // Clean up package ZIPs from APP_CACHE
      cleanupPackageZips()
    ])
      .then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Only handle same-origin requests
  if (url.origin !== self.location.origin) {
    // Log cross-origin requests for debugging (but don't handle them)
    if (url.pathname.startsWith('/packages/') && url.pathname.endsWith('.zip')) {
      console.log('[SW] Cross-origin package request ignored:', url.href, 'SW origin:', self.location.origin);
    }
    return;
  }

  // Check if this is a navigation request (page load)
  const isNavigationRequest = event.request.mode === 'navigate';

  // Handle PDF.js module requests - Cache First strategy
  const isPdfJsRequest = !isNavigationRequest && 
    (url.pathname.startsWith('/pdfjs/') || url.pathname.includes('/pdfjs/'));
  
  if (isPdfJsRequest) {
    // Cache First strategy for PDF.js modules (faster loading after first visit)
    event.respondWith(
      caches.open(PDFJS_CACHE)
        .then(cache => {
          return cache.match(event.request)
            .then(cachedResponse => {
              if (cachedResponse) {
                console.log('[SW] Serving PDF.js from cache:', url.pathname);
                return cachedResponse;
              }
              
              // Not in cache, fetch from network and cache
              console.log('[SW] PDF.js not in cache, fetching from network:', url.pathname);
              return fetch(event.request)
                .then(response => {
                  // Only cache successful responses
                  if (response && response.status === 200) {
                    const responseClone = response.clone();
                    cache.put(event.request, responseClone);
                    console.log('[SW] Cached PDF.js module:', url.pathname);
                  }
                  return response;
                })
                .catch(err => {
                  console.error('[SW] Failed to fetch PDF.js:', url.pathname, err);
                  throw err;
                });
            });
        })
    );
    return;
  }
  
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
    // Cache First strategy with unified normalization
    // Normalize PDF path using same strategy as PdfPathManager
    // Try multiple URL variations for better cache matching
    event.respondWith(
      (async () => {
        try {
          // Normalize pathname using unified normalization
          const normalizedPath = normalizePdfPathForCache(url.pathname);
          
          // Generate URL variations for search
          const searchVariations = createPdfRequestVariations(url.pathname, self.location.origin);
          
          // Try direct match first (original request)
          const cache = await caches.open(PDF_CACHE);
          let cachedResponse = await cache.match(event.request);
          
          if (cachedResponse) {
            console.log('[SW] Serving PDF from cache (direct match):', url.pathname);
            return cachedResponse;
          }
          
          // Try variations if direct match failed
          for (const variationUrl of searchVariations) {
            try {
              const variationRequest = new Request(variationUrl);
              cachedResponse = await cache.match(variationRequest);
              if (cachedResponse) {
                console.log('[SW] Serving PDF from cache (variation match):', url.pathname, '->', variationUrl);
                return cachedResponse;
              }
            } catch (e) {
              // Continue to next variation
            }
          }
          
          // Not in cache, fetch from network
          console.log('[SW] PDF not in cache, fetching from network:', url.pathname);
          const response = await fetch(event.request);
          
          // Only cache successful responses
          if (response && response.status === 200) {
            const responseClone = response.clone();
            // Store using normalized path for consistency
            const normalizedRequestUrl = createUrlUtf8(`/${normalizedPath}`, self.location.origin);
            const normalizedRequest = new Request(normalizedRequestUrl);
            await cache.put(normalizedRequest, responseClone);
            console.log('[SW] Cached PDF (normalized):', normalizedPath);
            
            // Notify clients that cache was updated
            setTimeout(() => {
              notifyClientsCacheUpdated({ source: 'fetch-handler' });
            }, 100);
          }
          
          return response;
        } catch (err) {
          console.error('[SW] Failed to fetch PDF:', url.pathname, err);
          
          // Try cache one more time in case it was added between checks
          try {
            const cache = await caches.open(PDF_CACHE);
            const cached = await cache.match(event.request);
            if (cached) {
              console.log('[SW] Serving PDF from cache after network failure:', url.pathname);
              return cached;
            }
          } catch (cacheErr) {
            // Ignore cache errors
          }
          
          throw err;
        }
      })()
    );
    return;
  }

  // Handle navigation requests (page loads) - SvelteKit SPA routing
  if (isNavigationRequest) {
    // Log navigation request for debugging
    console.log('[SW] Navigation request:', url.pathname + url.search, 'mode:', event.request.mode);
    
    // In development mode, always fetch from network to get latest changes
    if (IS_DEV) {
      event.respondWith(
        fetch(event.request)
          .then(response => {
            // Don't cache navigation in development
            console.log('[SW] Dev: Fetched from network:', url.pathname, 'status:', response.status);
            return response;
          })
          .catch((err) => {
            // Fallback to cache only when offline in dev
            console.log('[SW] Dev: Network failed, trying cache:', url.pathname, err);
            return caches.match(event.request)
              .then(cached => {
                if (cached) {
                  console.log('[SW] Dev: Serving cached route:', url.pathname);
                  return cached;
                }
                console.log('[SW] Dev: Serving root shell for:', url.pathname);
                return caches.match('/');
              });
          })
      );
    } else {
      // Production: Network first, then cache
      event.respondWith(
        fetch(event.request)
          .then(response => {
            // Cache successful navigation responses
            if (response && response.status === 200) {
              const responseClone = response.clone();
              caches.open(APP_CACHE).then(cache => {
                cache.put(event.request, responseClone);
                console.log('[SW] Cached navigation response for:', url.pathname + url.search);
              });
            }
            console.log('[SW] Production: Fetched from network:', url.pathname, 'status:', response.status);
            return response;
          })
          .catch((err) => {
            // When offline, serve the cached HTML shell for SvelteKit SPA routing
            // SvelteKit's client-side router will handle the actual route based on the URL
            console.log('[SW] Production: Navigation request offline for:', url.pathname + url.search, err);
            
            // Try to serve the specific route from cache first (if previously visited)
            return caches.match(event.request)
              .then(cached => {
                if (cached) {
                  console.log('[SW] Production: Serving cached route:', url.pathname + url.search);
                  return cached;
                }
                
                // If specific route not cached, serve the root '/' HTML shell
                // This is the correct approach for SvelteKit SPA - the same HTML is served
                // for all routes, and the client-side router handles the actual routing
                // IMPORTANT: The URL in the address bar is preserved, so SvelteKit router will read it
                console.log('[SW] Production: Route not cached, serving / shell for SvelteKit routing:', url.pathname + url.search);
                return caches.match('/')
                  .then(shell => {
                    if (shell) {
                      // Ensure the response preserves the original URL information
                      // SvelteKit router reads from window.location, which is set by the browser
                      // based on the navigation request URL, not the response URL
                      // So we can safely return the shell root HTML
                      return shell;
                    }
                    // If even root is not cached, return a basic HTML that will load SvelteKit
                    console.warn('[SW] Production: Root shell not cached, returning basic response');
                    return new Response('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Loading...</title></head><body>Loading...</body></html>', {
                      headers: { 'Content-Type': 'text/html' }
                    });
                  });
              });
          })
      );
    }
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

  // Handle package ZIP files - do NOT cache these (they are temporary downloads)
  // Packages are downloaded, extracted, and then should be removed from cache
  const isPackageZip = !isNavigationRequest && 
    url.pathname.startsWith('/packages/') && 
    url.pathname.endsWith('.zip');
  
  if (isPackageZip) {
    console.log('[SW] Package ZIP detected:', url.pathname, 'Request URL:', event.request.url, 'Mode:', event.request.mode);
    
    // Network only - never cache package ZIPs
    // Use the original request URL (it should already be absolute)
    const requestUrl = event.request.url;
    
    console.log('[SW] Fetching package ZIP:', url.pathname, 'Full URL:', requestUrl, 'Origin match:', url.origin === self.location.origin);
    
    event.respondWith(
      fetch(event.request.clone(), { 
        cache: 'no-store'
        // Don't set mode: 'cors' for same-origin requests - it can cause issues
      })
        .then(response => {
          console.log('[SW] Package ZIP response:', url.pathname, 'status:', response.status, response.statusText);
          if (!response.ok) {
            console.error('[SW] Package ZIP failed:', url.pathname, response.status, response.statusText);
            // Try to get error body for debugging
            response.clone().text().then(text => {
              console.error('[SW] Package ZIP error body:', text.substring(0, 200));
            }).catch(() => {});
          }
          // Return response without caching
          return response;
        })
        .catch(err => {
          console.error('[SW] Failed to fetch package ZIP:', url.pathname, 'URL:', requestUrl, 'Error:', err, 'Error name:', err.name, 'Error message:', err.message);
          throw err;
        })
    );
    return;
  }

  // Check if this is a development asset (JS/CSS from Vite/SvelteKit)
  const isDevAsset = isDevelopmentAsset(url);

  // For development assets in dev mode: Network First (bypass cache entirely)
  if (IS_DEV && isDevAsset) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(response => {
          // Don't cache development assets
          return response;
        })
        .catch(() => {
          // Only use cache as last resort in dev mode
          return caches.match(event.request);
        })
    );
    return;
  }

  // For all other requests (JS, CSS, images, etc.)
  // In production: Cache first, then network
  // In development (non-dev assets): Network first
  if (IS_DEV) {
    // Development mode: Network First for non-dev assets (like images, fonts)
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Don't cache in development
          return response;
        })
        .catch(() => {
          // Fallback to cache if offline
          return caches.match(event.request);
        })
    );
  } else {
    // Production mode: Cache First
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
              // BUT exclude package ZIPs (they should not be cached)
              if (response && response.status === 200) {
                const shouldCache = !(url.pathname.startsWith('/packages/') && url.pathname.endsWith('.zip'));
                if (shouldCache) {
                  const responseClone = response.clone();
                  caches.open(APP_CACHE).then(cache => {
                    cache.put(event.request, responseClone);
                  });
                }
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
  }
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

    case 'CLEAR_PDF_CACHE_ENTRY':
      handleClearPdfCacheEntry(event, data);
      break;
    
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    
    case 'CACHE_UPDATED':
      // Client is notifying that cache was updated (e.g., from ZIP download)
      // Forward notification to all clients
      notifyClientsCacheUpdated({ source: data?.source || 'client' });
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
              // Notify clients that cache was updated
              notifyClientsCacheUpdated();
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

// Clear a specific PDF entry from the PDF cache to force refetch from network
async function handleClearPdfCacheEntry(event, data) {
  const pdfPath = data?.pdfPath || data?.url || data?.path;

  if (!pdfPath || typeof pdfPath !== 'string') {
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({
        type: 'ERROR',
        error: 'Invalid pdfPath for CLEAR_PDF_CACHE_ENTRY'
      });
    }
    return;
  }

  try {
    const cache = await caches.open(PDF_CACHE);
    const requests = await cache.keys();

    const normalizedTarget = normalizePdfPathForCache(pdfPath);
    let removedCount = 0;

    await Promise.all(
      requests.map(async (req) => {
        try {
          const url = new URL(req.url);
          const reqPathname = url.pathname || '';
          const normalizedReqPath = normalizePdfPathForCache(reqPathname);

          if (normalizedReqPath === normalizedTarget) {
            const deleted = await cache.delete(req);
            if (deleted) {
              removedCount++;
            }
          }
        } catch {
          // Ignore malformed URLs
        }
      })
    );

    console.log('[SW] Cleared PDF cache entry for', pdfPath, '- removed', removedCount, 'entries');

    // Notify clients that cache was updated after clearing a specific entry
    notifyClientsCacheUpdated({
      source: 'clear-pdf-entry',
      pdfPath,
      removedCount
    });

    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({
        type: 'PDF_CACHE_ENTRY_CLEARED',
        pdfPath,
        removedCount
      });
    }
  } catch (err) {
    console.error('[SW] Error clearing PDF cache entry for', pdfPath, err);
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({
        type: 'ERROR',
        error: err.message || 'Failed to clear PDF cache entry'
      });
    }
  }
}

// Clear all caches
async function handleClearCache(event) {
  try {
    await caches.delete(PDF_CACHE);
    await caches.delete(APP_CACHE);
    console.log('[SW] All caches cleared');
    // Notify clients that cache was cleared
    notifyClientsCacheUpdated({ cleared: true });
    event.ports[0].postMessage({ type: 'CACHE_CLEARED' });
  } catch (err) {
    console.error('[SW] Error clearing cache:', err);
    event.ports[0].postMessage({
      type: 'ERROR',
      error: err.message
    });
  }
}

// Notify all clients that cache was updated
async function notifyClientsCacheUpdated(data = {}) {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach(client => {
      client.postMessage({
        type: 'CACHE_UPDATED',
        timestamp: Date.now(),
        ...data
      });
    });
    console.log(`[SW] Notified ${clients.length} client(s) of cache update`);
  } catch (err) {
    console.error('[SW] Failed to notify clients:', err);
  }
}

