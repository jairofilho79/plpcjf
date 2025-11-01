// Service Worker for Louvores PWA
const CACHE_NAME = 'pls-v2';
const RUNTIME_CACHE = 'pls-runtime-v2';
const LOUVORES_MANIFEST_URL = '/louvores-manifest.json';

let installProgress = { total: 0, current: 0 };

// === Sync metadata and guards ===
const META_BUCKET = 'pls-meta-v1';
const META_KEYS = {
  manifestHash: '/__meta__/manifest-hash',
  lastSyncAt: '/__meta__/last-sync-at',
  lastSummary: '/__meta__/last-summary'
};

let isSyncInProgress = false;

async function openMetaCache() {
  return caches.open(META_BUCKET);
}

async function getMeta(key) {
  const c = await openMetaCache();
  const res = await c.match(key);
  if (!res) return null;
  const text = await res.text();
  try { return JSON.parse(text); } catch (_) { return text; }
}

async function setMeta(key, value) {
  const c = await openMetaCache();
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  await c.put(key, new Response(body, { headers: { 'content-type': 'application/json' } }));
}

async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Install event - precache app shell and PDFs
self.addEventListener('install', (event) => {
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
          '/manifest.json',
          '/louvores-manifest.json'
        ]);
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
      const relPath = getLouvorRelPath(louvor);

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
        const relPath = getLouvorRelPath(louvor);
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

  const summary = { present, total: verified, missingSamples };

  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'VERIFY_SUMMARY',
      summary
    });
  });

  return summary;
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

// Função helper para decodificar base64 para UTF-8 corretamente
function atobUTF8(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(bytes);
}

// Retorna caminho com barra inicial, ex: "/assets/ColAdultos/arquivo.pdf"
function getLouvorRelPath(louvor) {
  try {
    const raw = louvor && (louvor.pdfId || louvor['pdfId']);
    if (raw && typeof raw === 'string') {
      let decoded = '';
      try {
        decoded = atobUTF8(raw).trim();
      } catch (_) {
        decoded = '';
      }
      if (decoded) {
        let path = decoded.replace(/^\/+/, '');
        // Decodifica caracteres URI-encoded se necessário (para evitar dupla codificação)
        try {
          if (path.includes('%')) {
            path = decodeURIComponent(path);
          }
        } catch (_) {
          // Se decodeURIComponent falhar, mantém o path original
        }
        if (path.toLowerCase().startsWith('assets/')) {
          return `/${path}`;
        }
        if (/\.pdf$/i.test(path) && path.includes('/')) {
          return `/assets/${path}`;
        }
      }
    }
  } catch (_) {}
  return `/assets/${getClassificationPath(louvor.classificacao)}${louvor.pdf}`;
}

// Fetch manifest and ensure all PDFs are cached (idempotent)
async function syncAllPdfs() {
  if (isSyncInProgress) {
    console.log('[SW] Sync requested but already in progress; ignoring.');
    return;
  }
  isSyncInProgress = true;
  try {
    // 1) Fetch manifest text for hashing and JSON for data
    const resp = await fetch(LOUVORES_MANIFEST_URL, { cache: 'no-cache' });
    if (!resp || !resp.ok) {
      console.warn('[SW] Manifest fetch failed');
      return;
    }
    const manifestText = await resp.text();
    const manifestHash = await sha256Hex(manifestText);

    let louvores;
    try {
      louvores = JSON.parse(manifestText);
    } catch (e) {
      console.warn('[SW] Manifest JSON parse failed', e);
      return;
    }
    if (!Array.isArray(louvores) || louvores.length === 0) {
      console.warn('[SW] Manifest is empty or invalid');
      return;
    }

    // 2) Verify current cache state
    const summaryBefore = await verifyCachedPdfs(louvores).catch(() => null);

    // 3) Short-circuit if manifest unchanged and all present
    const storedHash = await getMeta(META_KEYS.manifestHash);
    const allPresent = summaryBefore && summaryBefore.present === summaryBefore.total;

    if (storedHash === manifestHash && allPresent) {
      console.log('[SW] Sync skipped (manifest unchanged and all items present).');
      return;
    }

    // 4) Perform precache and re-verify
    installProgress = { total: louvores.length, current: 0 };
    await precachePdfs(louvores, 0);

    const summaryAfter = await verifyCachedPdfs(louvores).catch(() => null);

    // 5) Persist metadata
    await setMeta(META_KEYS.manifestHash, manifestHash);
    await setMeta(META_KEYS.lastSyncAt, new Date().toISOString());
    if (summaryAfter) await setMeta(META_KEYS.lastSummary, summaryAfter);
  } catch (e) {
    console.warn('[SW] syncAllPdfs failed', e);
  } finally {
    isSyncInProgress = false;
  }
}

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
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

  event.respondWith((async () => {
    // Determine if this request comes from an offline client (/offline)
    let isOfflineClient = false;
    try {
      if (event.clientId) {
        const client = await self.clients.get(event.clientId);
        if (client) {
          const clientPath = new URL(client.url).pathname;
          if (clientPath.startsWith('/offline')) {
            isOfflineClient = true;
          }
        }
      }
    } catch (_) {}

    // If navigating to /offline, always serve cached index.html
    if (event.request.mode === 'navigate') {
      if (url.pathname === '/offline') {
        const cachedIndex = await caches.match('/index.html');
        if (cachedIndex) return cachedIndex;
        try {
          const resp = await fetch('/index.html');
          return resp;
        } catch (_) {
          return new Response('Offline', { status: 503 });
        }
      }
    }

    // In offline-client mode, enforce cache-only for all requests
    if (isOfflineClient) {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      return new Response('Offline', { status: 503 });
    }

    // For PDFs with online fallback
    if (url.pathname.endsWith('.pdf')) {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      try {
        const resp = await fetch(event.request);
        const ct = (resp.headers.get('content-type') || '').toLowerCase();
        if (resp.ok && !ct.includes('text/html')) {
          const clone = resp.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(event.request, clone));
          return resp;
        }
      } catch (_) {}
      try {
        const fallbackUrl = new URL(url.pathname, 'https://plpcjf.org').href;
        const resp2 = await fetch(fallbackUrl, { redirect: 'follow' });
        if (resp2 && resp2.ok) {
          const clone2 = resp2.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(event.request, clone2));
          return resp2;
        }
      } catch (_) {}
      return new Response('Offline', { status: 503 });
    }

    // App shell: cache-first
    if (url.pathname === '/' ||
        url.pathname === '/index.html' ||
        url.pathname === '/main.js' ||
        url.pathname === '/louvores.js' ||
        url.pathname === '/manifest.json' ||
        url.pathname === '/louvores-manifest.json') {
      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) return cachedResponse;
      try {
        const response = await fetch(event.request);
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(event.request, responseClone));
        }
        return response;
      } catch (_) {
        return new Response('Offline', { status: 503 });
      }
    }

    // Default: network with cache fallback
    try {
      const response = await fetch(event.request);
      if (response && response.status === 200) {
        const responseClone = response.clone();
        caches.open(RUNTIME_CACHE).then(cache => cache.put(event.request, responseClone));
      }
      return response;
    } catch (_) {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      return new Response('Offline', { status: 503 });
    }
  })());
});

// Message handler for progress updates
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'SYNC_PDFS') {
    event.waitUntil(syncAllPdfs());
  }
});

console.log('[SW] Service worker script loaded');

// Optional: Periodic Background Sync handler
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'sync-pdfs') {
    event.waitUntil(syncAllPdfs());
  }
});

