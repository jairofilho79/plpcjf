// Service Worker for Louvores PWA
const CACHE_NAME = 'pls-v1';
const RUNTIME_CACHE = 'pls-runtime-v1';
const LOUVORES_MANIFEST_URL = '/louvores-manifest.json';

let installProgress = { total: 0, current: 0 };

// Install event - precache app shell and PDFs
self.addEventListener('install', (event) => {
  // Apenas funciona em plpcjf.pages.dev
  if (self.location.hostname !== 'plpcjf.pages.dev') {
    console.log('[SW] Skipping install - wrong domain');
    return; // Não instalar em outros domínios
  }
  
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Precache app shell
        return cache.addAll([
          '/',
          '/index.html',
          '/main.js',
          '/louvores.js',
          '/manifest.json'
        ]);
      })
      .then(() => {
        // Try to fetch manifest and precache PDFs
        // If manifest not available, skip precaching (fallback to louvores.js)
        return fetch(LOUVORES_MANIFEST_URL)
          .then(response => {
            if (response.ok) {
              return response.json();
            }
            console.warn('[SW] Manifest not found, skipping PDF precache');
            return null;
          })
          .then(data => {
            if (data && data.length > 0) {
              const louvores = data;
              installProgress.total = louvores.length;
              console.log(`[SW] Starting precache of ${louvores.length} PDFs...`);
              
              // Precache PDFs in batches to avoid timeout
              return precachePdfs(louvores, 0);
            } else {
              console.log('[SW] No manifest data, skipping PDF precache');
              return Promise.resolve();
            }
          })
          .catch(error => {
            console.warn('[SW] Failed to fetch manifest:', error);
            return Promise.resolve(); // Continue without precache
          });
      })
      .then(() => {
        console.log('[SW] Precache complete');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('[SW] Install failed:', error);
      })
  );
});

// Helper to precache PDFs in batches
async function precachePdfs(louvores, startIndex) {
  const BATCH_SIZE = 10;
  const endIndex = Math.min(startIndex + BATCH_SIZE, louvores.length);
  
  console.log(`[SW] Precaching batch ${startIndex + 1}-${endIndex} of ${louvores.length}`);
  
  // Update progress and notify clients
  installProgress.current = endIndex;
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'PROGRESS',
      progress: installProgress
    });
  });
  
  // Cache batch
  const batch = louvores.slice(startIndex, endIndex);
  const pdfPaths = batch.map(louvor => {
    const classificationPath = getClassificationPath(louvor.classificacao);
    const path = `/assets/${classificationPath}${louvor.pdf}`;
    // Decodificar URL para garantir consistência (caso já venha codificada)
    try {
      return decodeURIComponent(path);
    } catch {
      return path; // Se já estiver decodificada ou erro, usar original
    }
  });
  
  try {
    const cache = await caches.open(CACHE_NAME);
    const results = await Promise.allSettled(
      pdfPaths.map(url => {
        // Criar URL absoluta com origin
        const absoluteUrl = new URL(url, self.location.origin).href;
        return cache.add(absoluteUrl).catch(err => {
          console.warn(`[SW] Failed to cache ${absoluteUrl}:`, err);
          return null;
        });
      })
    );
    
    console.log(`[SW] Cached batch ${startIndex + 1}-${endIndex}`);
  } catch (error) {
    console.error(`[SW] Error caching batch ${startIndex + 1}-${endIndex}:`, error);
  }
  
  // Continue with next batch if needed
  if (endIndex < louvores.length) {
    return new Promise(resolve => {
      setTimeout(() => {
        precachePdfs(louvores, endIndex).then(resolve);
      }, 100);
    });
  }
  
  return Promise.resolve();
}

// Get classification folder path
function getClassificationPath(classification) {
  const mapping = {
    'ColAdultos': 'ColAdultos/',
    'ColCIAs': 'ColCIAs/',
    'Adicionados': 'Adicionados/',
  };
  return mapping[classification] || 'Avulsos/';
}

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  // Apenas funciona em plpcjf.pages.dev
  if (self.location.hostname !== 'plpcjf.pages.dev') {
    console.log('[SW] Skipping activate - wrong domain');
    return; // Não ativar em outros domínios
  }
  
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name !== CACHE_NAME && name !== RUNTIME_CACHE)
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        return self.clients.claim();
      })
      .catch(error => {
        console.error('[SW] Activate failed:', error);
      })
  );
});

// Fetch event - serve cached content
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Skip cross-origin requests
  if (url.origin !== location.origin) {
    return;
  }
  
  // Apenas funciona em plpcjf.pages.dev
  if (url.hostname !== 'plpcjf.pages.dev') {
    return; // Não intercepta, deixa passar para network
  }
  
  // For PDFs: decodificar URL antes de processar para evitar problemas com espaços e caracteres especiais
  if (url.pathname.endsWith('.pdf')) {
    try {
      // Decodificar URL para garantir consistência com o Worker
      const decodedPathname = decodeURIComponent(url.pathname);
      const decodedUrl = new URL(decodedPathname, url.origin);
      const decodedRequest = new Request(decodedUrl, event.request);
      
      event.respondWith(
        caches.match(decodedRequest) // Buscar no cache com URL decodificada
          .then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Se não tem cache, buscar do network com URL decodificada
            return fetch(decodedRequest)
              .then(response => {
                if (!response || response.status !== 200) {
                  return response;
                }
                const responseClone = response.clone();
                caches.open(RUNTIME_CACHE)
                  .then(cache => {
                    cache.put(decodedRequest, responseClone); // Cachear com URL decodificada
                  });
                return response;
              });
          })
          .catch(() => {
            // If offline and not in cache, return offline page
            return new Response('Offline', { status: 503 });
          })
      );
      return;
    } catch (error) {
      // Se houver erro na decodificação, usar requisição original
      console.warn('[SW] Error decoding URL, using original:', error);
    }
  }
  
  // For app shell, use cache-first strategy
  if (url.pathname === '/' || 
      url.pathname === '/index.html' ||
      url.pathname === '/main.js' ||
      url.pathname === '/louvores.js' ||
      url.pathname === '/manifest.json') {
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // If not in cache, fetch from network and cache it
          return fetch(event.request)
            .then(response => {
              if (!response || response.status !== 200) {
                return response;
              }
              const responseClone = response.clone();
              caches.open(RUNTIME_CACHE)
                .then(cache => {
                  cache.put(event.request, responseClone);
                });
              return response;
            });
        })
        .catch(() => {
          // If offline and not in cache, return offline page
          return new Response('Offline', { status: 503 });
        })
    );
    return;
  }
  
  // For louvores manifest, check network first for updates
  if (url.pathname === LOUVORES_MANIFEST_URL) {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          const responseClone = networkResponse.clone();
          caches.open(RUNTIME_CACHE)
            .then(cache => cache.put(event.request, responseClone));
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
    return;
  }
  
  // For other requests, try network with cache fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(RUNTIME_CACHE)
            .then(cache => cache.put(event.request, responseClone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// Message handler for progress updates
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('[SW] Service worker script loaded');

