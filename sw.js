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

// Helper to precache PDFs in batches, com fallback para domínio online e
// contagem de sucessos reais
async function precachePdfs(louvores, startIndex) {
  const BATCH_SIZE = 10;
  const endIndex = Math.min(startIndex + BATCH_SIZE, louvores.length);

  console.log(`[SW] Precaching batch ${startIndex + 1}-${endIndex} of ${louvores.length}`);

  const batch = louvores.slice(startIndex, endIndex);

  let successesThisBatch = 0;
  const cache = await caches.open(CACHE_NAME);

  await Promise.allSettled(
    batch.map(async (louvor) => {
      const classificationPath = getClassificationPath(louvor.classificacao);
      const relPath = `/assets/${classificationPath}${louvor.pdf}`;

      const localUrl = new URL(relPath, self.location.origin).href;
      const remoteUrl = new URL(relPath, 'https://plpcjf.org').href;

      // Tenta baixar localmente primeiro
      let response = null;
      try {
        const r = await fetch(localUrl, { redirect: 'follow' });
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        if (r.ok && !ct.includes('text/html')) {
          response = r;
        }
      } catch (_) {}

      // Fallback para domínio online
      if (!response) {
        try {
          const r2 = await fetch(remoteUrl, { redirect: 'follow' });
          const ct2 = (r2.headers.get('content-type') || '').toLowerCase();
          if (r2.ok && !ct2.includes('text/html')) {
            response = r2;
          }
        } catch (e2) {
          console.warn('[SW] Fallback failed for', relPath, e2);
        }
      }

      if (response) {
        try {
          // Cachear usando a URL local como chave, para que event.request funcione
          await cache.put(localUrl, response.clone());
          successesThisBatch += 1;
        } catch (e3) {
          console.warn('[SW] Failed to cache response for', relPath, e3);
        }
      }
    })
  );

  // Atualiza progresso com base em sucessos reais
  installProgress.current += successesThisBatch;
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'PROGRESS',
      progress: installProgress
    });
  });

  console.log(`[SW] Cached batch ${startIndex + 1}-${endIndex}`);

  // Continue with next batch if needed
  if (endIndex < louvores.length) {
    return new Promise(resolve => {
      setTimeout(() => {
        precachePdfs(louvores, endIndex).then(resolve);
      }, 100);
    });
  }

  // Após finalizar todos os lotes, executa verificação do cache
  try {
    await verifyCachedPdfs(louvores);
  } catch (e) {
    console.warn('[SW] verifyCachedPdfs failed', e);
  }

  return Promise.resolve();
}

// Verifica presença dos PDFs no cache em lotes de 10 e envia resumo ao cliente
async function verifyCachedPdfs(louvores) {
  const cache = await caches.open(CACHE_NAME);
  const BATCH_SIZE = 10;
  let verified = 0;
  let present = 0;
  const missingSamples = [];

  for (let i = 0; i < louvores.length; i += BATCH_SIZE) {
    const slice = louvores.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      slice.map(async (louvor) => {
        const classificationPath = getClassificationPath(louvor.classificacao);
        const relPath = `/assets/${classificationPath}${louvor.pdf}`;
        const localUrl = new URL(relPath, self.location.origin).href;
        const match = await cache.match(localUrl);
        verified += 1;
        if (match) {
          present += 1;
        } else if (missingSamples.length < 5) {
          missingSamples.push(relPath);
        }
      })
    );
  }

  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'VERIFY_SUMMARY',
      summary: {
        present,
        total: verified,
        missingSamples
      }
    });
  });
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
  
  // For PDFs: usar a request original e aplicar fallback para plpcjf.org quando necessário
  if (url.pathname.endsWith('.pdf')) {
    event.respondWith((async () => {
      // 1) cache primeiro
      const cached = await caches.match(event.request);
      if (cached) return cached;

      // 2) tentar origin atual
      try {
        const resp = await fetch(event.request);
        const ct = (resp.headers.get('content-type') || '').toLowerCase();
        if (resp.ok && !ct.includes('text/html')) {
          const clone = resp.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(event.request, clone));
          return resp;
        }
      } catch (_) {}

      // 3) fallback para domínio online com o mesmo pathname
      try {
        const fallbackUrl = new URL(url.pathname, 'https://plpcjf.org').href;
        const fallbackReq = new Request(fallbackUrl, {
          method: event.request.method,
          headers: event.request.headers,
          redirect: 'follow'
        });
        const resp2 = await fetch(fallbackReq);
        if (resp2 && resp2.ok) {
          const clone2 = resp2.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(event.request, clone2));
          return resp2;
        }
      } catch (_) {}

      return new Response('Offline', { status: 503 });
    })());
    return;
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

