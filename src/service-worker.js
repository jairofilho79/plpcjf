/// <reference types="@sveltejs/kit" />

/**
 * Service Worker do PLPC.
 *
 * Precache derivado do manifesto de build do SvelteKit: `build` traz todos os
 * chunks versionados do deploy atual e `files` traz o conteúdo de `static/`.
 * Nada de lista fixa mantida à mão — rota ou chunk novo entra sozinho, e a
 * `version` do deploy faz o `activate` invalidar o cache antigo sem ninguém
 * lembrar de incrementar nada (achado #04).
 *
 * As estratégias por rota são uma tabela de dados, não uma cadeia de `if`
 * (achado #02): `matchSwRoute` diz qual rota é, a tabela diz o que fazer.
 */

import { build, files, version } from '$service-worker';
import { matchSwRoute } from '$lib/offline/sw/swRouter.js';
import {
  appCacheName,
  isObsoleteCacheName,
  migrateCatalogManifests,
  CATALOG_CACHE_NAME,
  CATALOG_MANIFEST_PATHS,
  PDF_CACHE_NAME,
  PDF_IMPORT_STAGING_CACHE_NAME
} from '$lib/offline/sw/swCaches.js';
import PdfPathManager from '$lib/offline/utils/PdfPathManager.js';
import { createUrlUtf8 } from '$lib/utils/urlEncoding.js';

/** Cache do app, atrelado ao deploy. Espelhado em OfflineConfig.APP_CACHE_NAME. */
const APP_CACHE = appCacheName(version);

/** Cache dos PDFs baixados pelo usuário — sem versão, sobrevive a todo deploy. */
const PDF_CACHE = PDF_CACHE_NAME;

/**
 * Cache do catálogo (os dois manifests) — também sem versão. Quando o usuário
 * importa o bundle offline, é a única cópia do acervo no dispositivo.
 */
const CATALOG_CACHE = CATALOG_CACHE_NAME;

/** Área de espera da importação de bundle offline — também precisa sumir em "Limpar tudo". */
const PDF_IMPORT_STAGING_CACHE = PDF_IMPORT_STAGING_CACHE_NAME;

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

/**
 * Gate de debug. Desligado por padrão; o cliente liga com
 * `postMessage({ type: 'SET_DEBUG', data: { enabled: true } })`.
 * @type {boolean}
 */
let DEBUG = false;

/** @param {...any} args */
function debug(...args) {
  if (DEBUG) console.log('[SW]', ...args);
}

/** @param {...any} args */
function warn(...args) {
  console.warn('[SW]', ...args);
}

/** @param {...any} args */
function error(...args) {
  console.error('[SW]', ...args);
}

// ---------------------------------------------------------------------------
// Precache
// ---------------------------------------------------------------------------

/**
 * Assets de `static/` que fazem parte do shell.
 *
 * `/pdfjs/` fica de fora inteiro: são 3,1 MB de módulos legados que o app não
 * consome mais (o PDF.js real vem do npm pelo Vite e cai em `/_app/immutable/`,
 * já coberto por `build`). O único arquivo de lá que o app pede em runtime é a
 * folha de estilo do viewer, reintroduzida logo abaixo. Pré-cachear o diretório
 * inteiro reintroduziria exatamente o peso que o achado #03 removeu.
 *
 * PDFs de exemplo em `static/` também ficam de fora: são servidos pela rota
 * 'pdf', que usa o cache de PDFs, não o do app.
 */
const STATIC_SHELL = files.filter(
  (f) =>
    !f.startsWith('/pdfjs/') &&
    !f.startsWith('/pdfs/') &&
    !f.endsWith('.pdf') &&
    !f.endsWith('.map') &&
    !f.endsWith('.d.mts')
);

/** Única folha de `/pdfjs/` que o leitor realmente carrega (leitor/+page.svelte). */
const PDFJS_VIEWER_CSS = '/pdfjs/web/pdf_viewer.css';

/** Tudo que precisa existir para o app abrir offline logo após o primeiro load. */
const PRECACHE_CRITICAL = [...build];
const PRECACHE_BEST_EFFORT = [...STATIC_SHELL, PDFJS_VIEWER_CSS];

/**
 * O `addAll` é tudo-ou-nada: se um asset opcional der 404, a instalação inteira
 * falha e o worker novo nunca ativa. Por isso os chunks do build (que sempre
 * existem) vão por `addAll`, e o resto vai por melhor esforço.
 */
async function precache() {
  const cache = await caches.open(APP_CACHE);

  // Chunks versionados: hash na URL, o cache HTTP do browser pode servir.
  await cache.addAll(PRECACHE_CRITICAL);

  // Shell raiz: sempre da rede, para não gravar um HTML de deploy anterior.
  await cache.add(new Request('/', { cache: 'reload' }));

  const results = await Promise.allSettled(PRECACHE_BEST_EFFORT.map((url) => cache.add(url)));
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) warn(`${failed} asset(s) opcionais fora do precache`);
}

self.addEventListener('install', (event) => {
  debug('instalando', APP_CACHE, `(${PRECACHE_CRITICAL.length + PRECACHE_BEST_EFFORT.length + 1} entradas)`);
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

/**
 * A ordem aqui é obrigatória: **migrar o catálogo e só depois podar**.
 * A poda apaga o cache de app do deploy anterior, que é exatamente de onde o
 * catálogo importado precisa ser copiado. Se a migração falhar, a poda é adiada
 * para o próximo `activate` — sobra de cache é barata, catálogo perdido não.
 */
async function activateFlow() {
  let canPrune = true;

  try {
    const migrated = await migrateCatalogManifests(caches);
    if (migrated > 0) debug(`Catálogo migrado para ${CATALOG_CACHE}: ${migrated} entrada(s)`);
  } catch (err) {
    canPrune = false;
    error('Falha ao migrar o catálogo; poda adiada para o próximo activate:', err);
  }

  if (canPrune) {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => isObsoleteCacheName(name, APP_CACHE))
        .map((name) => caches.delete(name))
    );
  }

  await self.clients.claim();
}

self.addEventListener('activate', (event) => {
  event.waitUntil(activateFlow());
});

// ---------------------------------------------------------------------------
// Estratégias por rota (achado #02: tabela de dados, não cadeia de `if`)
// ---------------------------------------------------------------------------

/**
 * @param {FetchEvent} event
 * @param {string} cacheName
 * @returns {Promise<Response>}
 */
async function cacheFirst(event, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);
  if (cached) return cached;

  const response = await fetch(event.request);
  if (response && response.status === 200) {
    cache.put(event.request, response.clone());
  }
  return response;
}

/**
 * Rede primeiro, cache como rede de segurança. Não grava nada.
 * @param {FetchEvent} event
 * @returns {Promise<Response>}
 */
async function networkFirst(event) {
  try {
    return await fetch(event.request);
  } catch {
    const cached = await caches.match(event.request);
    return cached || Response.error();
  }
}

/**
 * PDFs do acervo: cache primeiro, por chave exata. Desde #22.1/#22.2 há um só
 * codificador e uma só forma Unicode, então a chave que se procura é sempre a
 * chave que foi gravada. É o conteúdo que o modo offline existe para servir.
 *
 * @param {FetchEvent} event
 * @param {URL} url
 * @returns {Promise<Response>}
 */
async function handlePdf(event, url) {
  const cache = await caches.open(PDF_CACHE);

  // #22.5: uma chave só, a canônica. O `event.request` já chega nela — a
  // instrumentação da Tarefa 5 mediu zero acertos por variação num navegador
  // real —, mas derivar a chave do pathname garante que uma query string
  // acidental não vire um miss (`cache.match` compara a URL inteira).
  const chave = PdfPathManager.createRequestUrl(url.pathname, self.location.origin);
  const cached = await cache.match(chave || event.request);
  if (cached) return cached;

  try {
    const response = await fetch(event.request);
    if (response && response.status === 200) {
      // #22.1: a chave de gravação sai do mesmo construtor que o leitor usa.
      const normalizedPath = PdfPathManager.normalizeForStorage(url.pathname);
      const normalizedRequest = new Request(
        PdfPathManager.createRequestUrl(url.pathname, self.location.origin)
      );
      await cache.put(normalizedRequest, response.clone());
      debug('PDF gravado (normalizado):', normalizedPath);
      setTimeout(() => notifyClientsCacheUpdated({ source: 'fetch-handler' }), 100);
    }
    return response;
  } catch (err) {
    // Corrida: o PDF pode ter entrado no cache entre as duas checagens.
    const late = await cache.match(event.request);
    if (late) return late;
    throw err;
  }
}

/**
 * Navegação (roteamento SPA do SvelteKit): rede primeiro, com o shell '/'
 * pré-cacheado como último recurso — é o que faz qualquer rota abrir offline
 * mesmo que nunca tenha sido visitada online.
 *
 * @param {FetchEvent} event
 * @returns {Promise<Response>}
 */
async function handleNavigation(event) {
  try {
    const response = await fetch(event.request);
    if (response && response.status === 200) {
      const clone = response.clone();
      caches.open(APP_CACHE).then((cache) => cache.put(event.request, clone));
    }
    return response;
  } catch {
    const cached = await caches.match(event.request);
    if (cached) return cached;

    const shell = await caches.match('/');
    if (shell) return shell;

    return new Response(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Carregando…</title></head><body>Carregando…</body></html>',
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}

/**
 * Uma estratégia por rota. A tabela é a única definição de comportamento de
 * cache do app — nada de `if` encadeado (achado #02).
 * @type {Record<string, (event: FetchEvent, url: URL) => Promise<Response>>}
 */
const STRATEGIES = {
  navigation: (event) => handleNavigation(event),

  pdf: (event, url) => handlePdf(event, url),

  // CSS do viewer, servido de /pdfjs/.
  pdfjs: (event) => cacheFirst(event, APP_CACHE),

  // Catálogo: cache protegido, não o do app. A invalidação é por checksum
  // (CLEAR_LOUVORES_MANIFEST_CACHE), nunca por troca de deploy.
  catalog: (event) => cacheFirst(event, CATALOG_CACHE),

  // Checksum: sempre fresco, nunca em cache.
  checksum: (event) => fetch(event.request.clone(), { cache: 'no-store' }),

  // Pacotes de ~30 MB: rede apenas; entram no cache já extraídos, como PDFs.
  'package-zip': (event) => fetch(event.request.clone(), { cache: 'no-store' }),

  // Chunks versionados: já estão no precache; cache primeiro é seguro e rápido.
  'hashed-asset': (event) => cacheFirst(event, APP_CACHE),

  'app-shell': (event) => cacheFirst(event, APP_CACHE),

  default: (event) => cacheFirst(event, APP_CACHE)
};

/**
 * Em desenvolvimento os assets do Vite mudam a cada recarga e não têm hash:
 * cache primeiro serviria código velho. Sobrescreve só as rotas afetadas —
 * PDFs e pacotes continuam idênticos.
 * @type {Record<string, (event: FetchEvent, url: URL) => Promise<Response>>}
 */
const DEV_OVERRIDES = {
  navigation: (event) => networkFirst(event),
  pdfjs: (event) => networkFirst(event),
  catalog: (event) => networkFirst(event),
  'hashed-asset': (event) => networkFirst(event),
  'app-shell': (event) => networkFirst(event),
  default: (event) => networkFirst(event)
};

/** Detecta ambiente de desenvolvimento pelo hostname (o worker não vê `dev`). */
function isDevelopmentMode() {
  try {
    const hostname = self.location.hostname;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.16.') ||
      hostname.includes('.local')
    );
  } catch {
    return false;
  }
}

const ACTIVE_STRATEGIES = isDevelopmentMode()
  ? { ...STRATEGIES, ...DEV_OVERRIDES }
  : STRATEGIES;

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const route = matchSwRoute(url.pathname, { isNavigation: event.request.mode === 'navigate' });
  event.respondWith(ACTIVE_STRATEGIES[route](event, url));
});

// ---------------------------------------------------------------------------
// Mensagens do cliente
// ---------------------------------------------------------------------------

/** Estado do download em lote disparado pela página offline. */
const downloadState = {
  isDownloading: false,
  cancelled: false,
  currentBatch: 0
};

self.addEventListener('message', (event) => {
  const { type, data } = event.data || {};

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

    case 'CLEAR_LOUVORES_MANIFEST_CACHE':
      handleClearLouvoresManifestCache(event);
      break;

    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'SET_DEBUG':
      DEBUG = !!(data && data.enabled);
      break;

    case 'CACHE_UPDATED':
      // O cliente avisa que o cache mudou (ex.: importação de ZIP): repassa a todos.
      notifyClientsCacheUpdated({ source: (data && data.source) || 'client' });
      break;

    default:
      warn('Tipo de mensagem desconhecido:', type);
  }
});

/**
 * Baixa PDFs em lotes, reportando progresso pela porta da mensagem.
 * @param {ExtendableMessageEvent} event
 * @param {{ pdfsToDownload: string[], batchSize?: number }} data
 */
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

  debug(`Baixando ${total} PDFs em lotes de ${batchSize}`);

  try {
    const cache = await caches.open(PDF_CACHE);

    for (let i = 0; i < pdfsToDownload.length; i += batchSize) {
      if (downloadState.cancelled) {
        debug('Download cancelado pelo usuário');
        event.ports[0].postMessage({ type: 'CANCELLED', completed, failed, total });
        downloadState.isDownloading = false;
        return;
      }

      const batch = pdfsToDownload.slice(i, i + batchSize);
      downloadState.currentBatch++;

      const results = await Promise.allSettled(
        batch.map(async (pdfUrl) => {
          try {
            const request = new Request(pdfUrl, { cache: 'no-cache' });
            const response = await fetch(request);

            if (response && response.status === 200) {
              await cache.put(request, response);
              notifyClientsCacheUpdated();
              return { success: true, url: pdfUrl };
            }
            throw new Error(`HTTP ${response.status}`);
          } catch (err) {
            error('Falha ao baixar PDF:', pdfUrl, err);
            return { success: false, url: pdfUrl, error: err.message };
          }
        })
      );

      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value.success) {
          completed++;
        } else {
          failed++;
        }
      });

      event.ports[0].postMessage({
        type: 'PROGRESS',
        completed,
        failed,
        total,
        percentage: Math.round((completed / total) * 100)
      });
    }

    debug(`Download concluído: ${completed} ok, ${failed} falhas`);
    event.ports[0].postMessage({
      type: 'COMPLETE',
      completed,
      failed,
      total,
      success: failed === 0 && completed >= total,
      partialSuccess: completed > 0 && (failed > 0 || completed < total)
    });
  } catch (err) {
    error('Erro no download:', err);
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

/** @param {ExtendableMessageEvent} event */
function handleCancelDownload(event) {
  debug('Cancelando download…');
  downloadState.cancelled = true;
  event.ports[0].postMessage({ type: 'CANCEL_CONFIRMED' });
}

/** @param {ExtendableMessageEvent} event */
async function handleGetCachedPDFs(event) {
  try {
    const cache = await caches.open(PDF_CACHE);
    const requests = await cache.keys();
    const pdfUrls = requests
      .map((req) => req.url)
      .filter((url) => {
        try {
          const urlObj = new URL(url);
          return (
            urlObj.pathname.endsWith('.pdf') &&
            !urlObj.pathname.includes('/_app/') &&
            !urlObj.pathname.includes('/node_modules/')
          );
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
    error('Erro ao listar PDFs em cache:', err);
    event.ports[0].postMessage({ type: 'ERROR', error: err.message });
  }
}

/**
 * Remove uma entrada específica do cache de PDFs para forçar novo download.
 * @param {ExtendableMessageEvent} event
 * @param {{ pdfPath?: string, url?: string, path?: string }} data
 */
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

    const normalizedTarget = PdfPathManager.normalizeForStorage(pdfPath);
    let removedCount = 0;

    await Promise.all(
      requests.map(async (req) => {
        try {
          const url = new URL(req.url);
          const normalizedReqPath = PdfPathManager.normalizeForStorage(url.pathname || '');

          if (normalizedReqPath === normalizedTarget) {
            const deleted = await cache.delete(req);
            if (deleted) removedCount++;
          }
        } catch {
          // URL malformada: ignora.
        }
      })
    );

    debug('Entrada de PDF removida:', pdfPath, '-', removedCount, 'entradas');

    notifyClientsCacheUpdated({ source: 'clear-pdf-entry', pdfPath, removedCount });

    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({
        type: 'PDF_CACHE_ENTRY_CLEARED',
        pdfPath,
        removedCount
      });
    }
  } catch (err) {
    error('Erro ao remover entrada de PDF:', pdfPath, err);
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({
        type: 'ERROR',
        error: err.message || 'Failed to clear PDF cache entry'
      });
    }
  }
}

/**
 * Remove os dois manifests do catálogo (louvores-manifest.json e
 * offline-manifest.json) em cache para a próxima busca ir à rede.
 * É a invalidação usada pela sincronização por checksum — e a única que existe,
 * já que o catálogo vive num cache sem versão que nenhum deploy renova sozinho.
 * Limpar só o primeiro deixava o segundo servido cache-first e os dois
 * manifests divergiam até o usuário limpar tudo.
 * Varre também o cache do app, para o caso de sobra anterior à migração.
 */
async function handleClearLouvoresManifestCache(event) {
  try {
    let removedCount = 0;

    for (const cacheName of [CATALOG_CACHE, APP_CACHE]) {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();

      await Promise.all(
        requests.map(async (req) => {
          try {
            const u = new URL(req.url);
            if (CATALOG_MANIFEST_PATHS.includes(u.pathname)) {
              const deleted = await cache.delete(req);
              if (deleted) removedCount++;
            }
          } catch {
            // ignora
          }
        })
      );
    }

    debug('manifests do catálogo removidos do cache:', removedCount, 'entradas');

    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({
        type: 'LOUVORES_MANIFEST_CACHE_CLEARED',
        removedCount
      });
    }
  } catch (err) {
    error('Erro ao limpar cache do louvores-manifest:', err);
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({
        type: 'ERROR',
        error: err.message || 'Failed to clear louvores manifest cache'
      });
    }
  }
}

/** Apaga PDFs, catálogo e cache do app (ação explícita do usuário). */
async function handleClearCache(event) {
  try {
    await caches.delete(PDF_CACHE);
    await caches.delete(CATALOG_CACHE);
    await caches.delete(APP_CACHE);
    await caches.delete(PDF_IMPORT_STAGING_CACHE);
    debug('Todos os caches limpos');
    notifyClientsCacheUpdated({ cleared: true });
    event.ports[0].postMessage({ type: 'CACHE_CLEARED' });
  } catch (err) {
    error('Erro ao limpar caches:', err);
    event.ports[0].postMessage({ type: 'ERROR', error: err.message });
  }
}

/**
 * Avisa todos os clientes que o cache mudou.
 * @param {Record<string, any>} [data]
 */
async function notifyClientsCacheUpdated(data = {}) {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach((client) => {
      client.postMessage({
        type: 'CACHE_UPDATED',
        timestamp: Date.now(),
        ...data
      });
    });
    debug(`Notificados ${clients.length} cliente(s) de atualização de cache`);
  } catch (err) {
    error('Falha ao notificar clientes:', err);
  }
}
