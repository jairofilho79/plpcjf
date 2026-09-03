// Offline Store - Manages offline mode state and PDF caching
import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import {
  downloadPDFsViaSW,
  cancelDownload as cancelDownloadSW,
  getCachedPDFsFast,
  clearCache as clearCacheSW,
  isServiceWorkerReady,
  waitForServiceWorker,
  invalidateCachedPDFsLocal
} from '$lib/utils/swRegistration';
import { iterateZipEntriesCd } from '$lib/offline/import/zipCdReader.js';
import { buildPdfCacheIndex, toComparablePath } from '$lib/utils/pdfCacheIndex.js';
import {
  readCompletedParts,
  markPartCompleted,
  clearCompletedParts,
  clearAllCompletedParts,
  computePartsFingerprint,
  looksLikeCaptivePortal,
  excludeSkippedPartFromBytesTotal
} from '$lib/offline/download/partProgress.js';
import { verifyCompletedPart } from '$lib/offline/download/partVerification.js';
import { mensagemDeErroDeDownload } from '$lib/offline/download/downloadErrors.js';
import { downloadPartWithRetry } from '$lib/offline/download/partRetry.js';
import { cacheAppPages } from '$lib/offline/utils/AppPagesCache.js';
import {
  checkQuota,
  ensurePersistentStorage,
  isQuotaError,
  quotaErrorMessage
} from '$lib/offline/storage/storageQuota.js';
import { louvores } from './louvores';
import { validateManifestsIntegrity } from '$lib/utils/manifestValidation';
import { CATEGORY_OPTIONS } from './filters';
import { getPdfRelPath } from '$lib/utils/pathUtils';
import PdfPathManager from '$lib/offline/utils/PdfPathManager.js';
import {
  encodeUrlUtf8,
  decodeUrlUtf8,
  encodeUrlComponentUtf8,
  decodeUrlComponentUtf8,
  createUrlUtf8,
  decodeUrlUtf8Multiple
} from '$lib/utils/urlEncoding.js';
import {
  normalizeCategory,
  getCategoryVariants,
  openPdfCache,
  getPdfUrl,
  getSavedCategories,
  saveCategories,
  getDownloadedCategories,
  saveDownloadedCategories,
  isCategoryCompletelyDownloaded,
  getCompletelyDownloadedCategories,
  SELECTED_CATEGORIES_KEY,
  DOWNLOADED_CATEGORIES_KEY,
  OFFLINE_CATEGORIAS_SALVAS
} from './offlineDownloadedCategories.js';
import {
  identifyMissingPdfs,
  findRequiredPackagesForMissing,
  clearStatsCalculationCache,
  getCategoryAvailabilityStats,
  getRequiredPackagesInfo
} from './offlineStats.js';
import { safeGet, safeSet, safeRemoveMany } from '$lib/utils/safeStorage.js';
import { IS_LEITOR_OFFLINE_KEY } from '$lib/utils/storageKeys.js';

const ALLOW_OFFLINE_KEY = 'ALLOW_OFFLINE';
const CACHED_PDFS_KEY = 'cachedPdfsList';
const LAST_MANIFEST_HASH_KEY = 'lastManifestHash';
const OFFLINE_MANIFEST_KEY = 'offlineManifest';

const PACKAGES_BASE_PATH = '/packages';
/**
 * @type {AbortController | null}
 */
let zipDownloadController = null;
let isZipDownloadActive = false;
let zipDownloadCancelled = false;

/**
 * Normalize package URL - converts absolute URLs to relative paths
 * Handles cases where manifest contains absolute URLs with old domains (e.g., plpcjf.org)
 * @param {string | undefined} url - Package URL (can be absolute, relative, or filename); pode faltar no manifesto
 * @param {string} filename - Fallback filename if url is not available
 * @returns {string} Normalized relative URL
 */
function normalizePackageUrl(url, filename) {
  // If no URL provided, use filename with base path
  if (!url) {
    return `${PACKAGES_BASE_PATH}/${filename}`;
  }
  
  // If URL is absolute (http:// or https://), extract the pathname
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname; // Extract only the pathname (e.g., /packages/file.zip)
      // If pathname is valid, use it; otherwise fall back to filename
      return pathname.startsWith('/') ? pathname : `${PACKAGES_BASE_PATH}/${filename}`;
    } catch (error) {
      // If URL parsing fails, try to extract path manually
      const match = url.match(/https?:\/\/[^\/]+(\/.*)/);
      if (match && match[1]) {
        return match[1];
      }
      // Fall back to filename if extraction fails
      return `${PACKAGES_BASE_PATH}/${filename}`;
    }
  }
  
  // If URL is relative (starts with /), use as-is
  if (url.startsWith('/')) {
    return url;
  }
  
  // Otherwise, treat as filename and add base path
  return `${PACKAGES_BASE_PATH}/${url}`;
}

// Offline state
const initialState = {
  enabled: false, // Offline mode enabled/disabled
  downloading: false, // Currently downloading
  progress: 0, // Download progress (0-100)
  completed: 0, // Number of PDFs downloaded
  failed: 0, // Number of failed downloads
  total: 0, // Total PDFs to download
  selectedCategories: [], // Categories selected for download
  cachedPdfs: [], // List of cached PDF URLs
  cachedCount: 0, // Number of cached PDFs
  showModal: false, // Show offline modal
  // `string | null` explícito: sem a anotação o TS infere o tipo literal
  // `null` a partir do valor inicial, e toda escrita de mensagem de erro neste
  // arquivo vira "Type 'string' is not assignable to type 'null'".
  error: /** @type {string | null} */ (null), // Error message
  autoDownloading: false, // Auto-downloading new PDFs
  offlineManifest: null, // Offline manifest data
  categorySizes: {}, // Map of category -> total size in bytes
  downloadPhase: 'idle', // Current download phase: 'idle' | 'downloading' | 'storing' | 'complete'
  phaseProgress: 0, // Progress of current phase (0-100)
  currentPackage: 0, // Current package being processed (1-indexed)
  totalPackages: 0, // Total number of packages to download

  // Progresso legível do download por partes (ver startZipDownload / startZipDownloadWithSpecificParts)
  currentPart: 0, // Parte atual (1-indexed) entre todas as categorias deste download
  totalParts: 0, // Total de partes deste download
  currentPartName: '', // Nome do arquivo da parte atual (ex.: "Partitura-4.zip")
  bytesDownloaded: 0, // Bytes já baixados neste download (somados pedaço a pedaço, durante a leitura do corpo)
  bytesTotal: /** @type {number | null} */ (0), // Estimativa de bytes do download; null quando o manifesto não permite estimar com segurança
  phase: /** @type {'baixando' | 'extraindo' | 'gravando' | null} */ (null) // Fase da parte atual (nada em andamento/parte pulada = null)
};

const offlineState = writable(initialState);

/**
 * Fetch offline manifest from backend
 * FASE 2: Usa ManifestRepository quando disponível, mantém compatibilidade
 */
async function fetchOfflineManifest() {
  try {
    // Tentar usar ManifestRepository primeiro (nova arquitetura)
    try {
      const manifestRepository = await import('$lib/offline/manifest/ManifestRepository.js');
      const manifest = await manifestRepository.default.getOfflineManifest(true);
      
      if (manifest && manifest.packages) {
        // Calculate category sizes
        const categorySizes = {};
        for (const [category, packageData] of Object.entries(manifest.packages)) {
          categorySizes[category] = packageData.totalSize || 0;
        }

        // Update state with manifest
        offlineState.update(state => ({
          ...state,
          offlineManifest: manifest,
          categorySizes
        }));

        // Validate integrity in background
        validateManifestsIntegrity()
          .then(result => {
            if (!result.valid) {
              console.warn('[Manifest Validation] Manifest integrity issues detected:', {
                missingInOffline: result.missingInOffline.length,
                extraInOffline: result.extraInOffline.length,
                stats: result.stats
              });
            } else {
              console.log('[Manifest Validation] Manifest integrity check passed:', result.stats);
            }
          })
          .catch(error => {
            console.error('[Manifest Validation] Error during integrity check:', error);
          });

        return manifest;
      }
    } catch (e) {
      // Fallback para método antigo se ManifestRepository não disponível
      console.debug('[Offline Store] ManifestRepository not available, using fallback');
    }

    // Fallback: método original
    const response = await fetch('/offline-manifest.json', {
      cache: 'no-cache'
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch offline manifest: ${response.status}`);
    }

    const manifest = await response.json();
    
    // Calculate category sizes
    const categorySizes = {};
    if (manifest.packages) {
      for (const [category, packageData] of Object.entries(manifest.packages)) {
        categorySizes[category] = packageData.totalSize || 0;
      }
    }

    // Update state with manifest
    offlineState.update(state => ({
      ...state,
      offlineManifest: manifest,
      categorySizes
    }));

    // Validate integrity between louvores-manifest.json and offline-manifest.json
    // Run validation in background (don't block manifest loading)
    validateManifestsIntegrity()
      .then(result => {
        if (!result.valid) {
          console.warn('[Manifest Validation] Manifest integrity issues detected:', {
            missingInOffline: result.missingInOffline.length,
            extraInOffline: result.extraInOffline.length,
            stats: result.stats
          });
          
          if (result.missingInOffline.length > 0) {
            console.warn('[Manifest Validation] PDFs in louvores-manifest.json missing in offline-manifest.json:', 
              result.missingInOffline.slice(0, 10)); // Log first 10
          }
          
          if (result.extraInOffline.length > 0) {
            console.warn('[Manifest Validation] PDFs in offline-manifest.json not found in louvores-manifest.json:', 
              result.extraInOffline.slice(0, 10)); // Log first 10
          }
        } else {
          console.log('[Manifest Validation] Manifest integrity check passed:', result.stats);
        }
      })
      .catch(error => {
        console.error('[Manifest Validation] Error during integrity check:', error);
        // Don't fail manifest loading if validation fails
      });

    // Cache manifest in localStorage
    if (browser) {
      localStorage.setItem(OFFLINE_MANIFEST_KEY, JSON.stringify(manifest));
    }

    return manifest;
  } catch (error) {
    console.error('[Offline Store] Failed to fetch offline manifest:', error);
    
    // Try to load from localStorage as fallback
    if (browser) {
      try {
        const cached = localStorage.getItem(OFFLINE_MANIFEST_KEY);
        if (cached) {
          const manifest = JSON.parse(cached);
          const categorySizes = {};
          if (manifest.packages) {
            for (const [category, packageData] of Object.entries(manifest.packages)) {
              categorySizes[category] = packageData.totalSize || 0;
            }
          }
          offlineState.update(state => ({
            ...state,
            offlineManifest: manifest,
            categorySizes
          }));
          return manifest;
        }
      } catch (e) {
        console.warn('[Offline Store] Failed to load cached manifest:', e);
      }
    }
    
    throw error;
  }
}

/**
 * Initialize offline store
 */
async function initialize() {
  if (!browser) return;

  try {
    // Fetch offline manifest
    await fetchOfflineManifest();

    // Check if offline mode was previously enabled
    const allowOffline = localStorage.getItem(ALLOW_OFFLINE_KEY) === 'true';
    
    if (allowOffline) {
      // Wait for service worker to be ready
      const isReady = await waitForServiceWorker(5000);
      
      if (isReady) {
        // Load cached PDFs list
        await loadCachedPdfsList();
        
        // Check for new PDFs
        await checkForNewPDFs();
      }
    }
  } catch (error) {
    console.error('[Offline Store] Initialization error:', error);
  }
}

/**
 * Load list of cached PDFs from service worker
 * @param {boolean} forceRefresh - Force refresh of cache
 * @param {boolean} skipEvent - Skip dispatching offline-cache-updated event (prevents infinite loops)
 */
async function loadCachedPdfsList(forceRefresh = false, skipEvent = false) {
  try {
    // FASE 4: Invalidar cache de stats quando recarregamos lista de PDFs
    // pois os dados podem ter mudado
    clearStatsCalculationCache();
    // Invalidar também no StatsCalculator
    try {
      const { default: statsCalculator } = await import('$lib/offline/stats/StatsCalculator.js');
      statsCalculator.invalidateAll();
    } catch (e) {
      // Ignorar erro se StatsCalculator não disponível
    }
    
    // If force refresh, invalidate local cache first
    if (forceRefresh && browser) {
      const { invalidateCachedPDFsLocal } = await import('$lib/utils/swRegistration');
      invalidateCachedPDFsLocal();
    }
    
    const cachedUrls = await getCachedPDFsFast();
    
    offlineState.update(state => ({
      ...state,
      cachedPdfs: cachedUrls,
      cachedCount: cachedUrls.length,
      enabled: cachedUrls.length > 0
    }));
    
    // Save to localStorage for quick access
    if (browser) {
      localStorage.setItem(CACHED_PDFS_KEY, JSON.stringify(cachedUrls));
      
      // Dispatch event to notify UI of cache update (only if not skipped)
      if (!skipEvent) {
        window.dispatchEvent(new CustomEvent('offline-cache-updated', {
          detail: {
            source: forceRefresh ? 'force-reload' : 'cache-reload',
            cachedCount: cachedUrls.length,
            timestamp: Date.now()
          }
        }));
      }
      
      // FASE 2: Invalidar cache de validação quando cache é atualizado
      if (typeof window !== 'undefined') {
        const { clearAllValidationCache } = await import('$lib/utils/pdfValidation');
        clearAllValidationCache();
      }
    }
    
    console.log('[Offline Store] Loaded cached PDFs list:', cachedUrls.length, 'PDFs');
  } catch (error) {
    console.error('[Offline Store] Failed to load cached PDFs:', error);
  }
}

/**
 * Sync all information after download completion
 * Reloads cached PDFs, updates downloaded categories, and validates consistency
 */
async function syncAfterDownload() {
  if (!browser) return;
  
  try {
    // Wait longer for Service Worker to process all cached PDFs
    // Increased delay to ensure cache is fully updated
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Reload cached PDFs list with retry logic
    let updatedCachedPdfs = [];
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
      // Force refresh on first attempt and retries
      await loadCachedPdfsList(true);
      
      // Get updated state
      const updatedState = get(offlineState);
      updatedCachedPdfs = updatedState.cachedPdfs || [];
      
      // If we got PDFs, break. Otherwise retry after a delay
      if (updatedCachedPdfs.length > 0 || retryCount === maxRetries - 1) {
        break;
      }
      
      retryCount++;
      console.log(`[Offline Store] Retry ${retryCount}/${maxRetries} loading cached PDFs list...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    /**
     * @type {any[]}
     */
    const louvoresData = get(louvores);
    
    if (!louvoresData || louvoresData.length === 0) {
      return;
    }
    
    // Update downloaded categories list
    // After successful download, verify which categories are now completely downloaded
    const completelyDownloaded = await getCompletelyDownloadedCategories(louvoresData, updatedCachedPdfs);
    
    // Save to OFFLINE_CATEGORIAS_SALVAS flag
    saveDownloadedCategories(completelyDownloaded);
    
    // Update state with new cached count
    offlineState.update(state => ({
      ...state,
      cachedPdfs: updatedCachedPdfs,
      cachedCount: updatedCachedPdfs.length
    }));
    
    // Validate and clear error if no PDFs are actually missing
    const currentState = get(offlineState);
    if (currentState.error) {
      // Check if error is still valid by verifying actual missing PDFs
      const allCategories = [...new Set(louvoresData.map(l => l.categoria).filter(Boolean))];
      let hasAnyMissing = false;
      
      for (const category of allCategories) {
        const missing = identifyMissingPdfs(
          louvoresData.filter(l => l.categoria === category),
          updatedCachedPdfs
        );
        if (missing.length > 0) {
          hasAnyMissing = true;
          break;
        }
      }
      
      // Clear error if no PDFs are actually missing
      if (!hasAnyMissing) {
        offlineState.update(state => ({
          ...state,
          error: null
        }));
      }
    }
    
    console.log('[Offline Store] Post-download sync completed', {
      cachedPdfsCount: updatedCachedPdfs.length,
      downloadedCategories: completelyDownloaded.length
    });
  } catch (error) {
    console.error('[Offline Store] Error during post-download sync:', error);
  }
}

/**
 * Get hash of manifest for change detection
 * @param {any[]} louvoresData
 */
function getManifestHash(louvoresData) {
  const sortedPdfs = louvoresData
    .map((/** @type {{ pdfId: any; pdf: any; }} */ l) => l.pdfId || l.pdf)
    .sort()
    .join('|');
  return sortedPdfs;
}

/**
 * Remove arquivo ZIP do cache após descompactação
 * @param {RequestInfo | URL} zipUrl
 */
async function removeZipFromCache(zipUrl) {
  if (!browser || typeof caches === 'undefined') {
    return;
  }

  try {
    const cacheKeys = await caches.keys();
    
    // Remove de todos os caches possíveis (APP_CACHE e PDF_CACHE)
    for (const cacheKey of cacheKeys) {
      const cache = await caches.open(cacheKey);
      const zipRequest = new Request(zipUrl);
      await cache.delete(zipRequest);
    }
    
    console.log(`[Offline Store] Removed ZIP from cache: ${zipUrl}`);
  } catch (error) {
    console.warn(`[Offline Store] Failed to remove ZIP from cache: ${zipUrl}`, error);
  }
}

/**
 * @param {any} packageName
 */
function getPackageUrl(packageName) {
  return `${PACKAGES_BASE_PATH}/${packageName}`;
}

/**
 * Get package parts for a category from manifest
 * @param {string | number} category
 * @param {{ packages: { [x: string]: { parts: any; }; }; } | null} manifest
 */
function getPackageParts(category, manifest) {
  if (!manifest || !manifest.packages || !manifest.packages[category]) {
    return [];
  }
  return manifest.packages[category].parts || [];
}

/**
 * `localStorage` quando dá para usar, `null` quando não dá.
 *
 * No Firefox com dados do site bloqueados o próprio getter global lança. Como as
 * chamadas de retomada acontecem no meio do download, um throw aqui derrubaria o
 * download inteiro com "Erro ao baixar pacotes ZIP." — as funções de
 * `partProgress.js` toleram `null` e apenas perdem a retomada.
 *
 * @returns {Storage | null}
 */
function safeStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Grava em `localStorage` sem derrubar quem chamou se o storage estiver
 * indisponível ou bloqueado.
 *
 * Existe porque um `localStorage.setItem` desprotegido, chamado logo depois do
 * laço de download ter dado certo, faz o Firefox com dados do site bloqueados
 * lançar ali — e esse throw cai no `catch` externo, que reporta "Erro ao baixar
 * pacotes ZIP." mesmo com todos os PDFs já gravados no cache com sucesso.
 *
 * @param {string} key
 * @param {string} value
 */
function safeSetItem(key, value) {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Sem persistência: não deve derrubar um download que já terminou.
  }
}

/**
 * Soma o tamanho (`size`, em bytes) das partes, quando confiável.
 *
 * `null` quando qualquer parte não declara um tamanho válido — mostrar um total
 * de bytes errado (ou uma barra que passa de 100%) é pior do que não mostrar
 * total nenhum.
 *
 * @param {Array<{ size?: number }>} parts
 * @returns {number | null}
 */
function sumKnownPartsSize(parts) {
  let total = 0;
  for (const part of parts) {
    const size = Number(part?.size);
    if (!Number.isFinite(size) || size <= 0) return null;
    total += size;
  }
  return total;
}

/**
 * Mesma soma de `sumKnownPartsSize`, para um mapa categoria -> partes.
 * @param {Record<string, Array<{ size?: number }>>} partsByCategory
 * @returns {number | null}
 */
function sumPartsSizeByCategory(partsByCategory) {
  return sumKnownPartsSize(Object.values(partsByCategory).flat());
}

/**
 * O laço percorreu todas as partes que a categoria tem no manifesto?
 *
 * Só nesse caso a retomada pode ser apagada. Um "baixar faltantes" que rodou 1
 * de 17 partes não pode apagar o estado de um download completo interrompido na
 * parte 12 — apagar ali custaria ao usuário os ~300 MB de novo.
 *
 * @param {string | number} category
 * @param {any} manifest
 * @param {Array<any>} processedParts
 * @returns {boolean}
 */
function coversEveryPart(category, manifest, processedParts) {
  const allParts = getPackageParts(category, manifest);
  if (allParts.length === 0) return true;
  const seen = new Set(processedParts.map((part) => part?.filename));
  return allParts.every((part) => seen.has(part?.filename));
}

/**
 * Identificação da versão do manifesto, usada na impressão digital das partes.
 * Se o manifesto for regerado, a retomada antiga deixa de valer.
 * @param {any} manifest
 * @returns {string}
 */
function getManifestTag(manifest) {
  if (!manifest) return '';
  return `${manifest.version ?? ''}|${manifest.timestamp ?? ''}`;
}

/**
 * Impressão digital do conjunto de partes de uma categoria.
 * Prefere a lista completa do manifesto; sem ela, usa as partes pedidas.
 * @param {string | number} category
 * @param {any} manifest
 * @param {Array<any>} fallbackParts
 * @returns {string}
 */
function fingerprintForCategory(category, manifest, fallbackParts) {
  const allParts = getPackageParts(category, manifest);
  const source = allParts.length > 0 ? allParts : fallbackParts;
  return computePartsFingerprint(source, getManifestTag(manifest));
}

/**
 * Conjunto dos caminhos que já estão no cache de PDFs.
 *
 * Era "estrito de propósito" porque `buildPdfCacheIndex` casava por nome de
 * arquivo e daria falso positivo justamente na hora de decidir se uma parte pode
 * ser pulada. #22.3 removeu esse fallback: o índice agora é tão estrito quanto
 * este Set, e esta função sobrevive só por ser o caminho mais direto para ler o
 * cache de uma vez.
 *
 * Achado I1: `toComparablePath` desfaz percent-encoding mas não unifica a
 * forma Unicode. As chaves do cache pós-migração já são NFC (#22.2); sem
 * normalizar aqui também, os caminhos comparados contra este Set em
 * `verifyCompletedPart` (ver `getPdfRelPathNormalizado` abaixo) nunca batiam
 * para os 8 caminhos do acervo que chegam em NFD — a retomada rebaixava até
 * 3 das 31 partes (~30 MB) já presentes no cache.
 *
 * @param {Cache} cache
 * @returns {Promise<Set<string> | null>} null quando não deu para ler o cache
 */
async function readCachedPdfPaths(cache) {
  try {
    const keys = await cache.keys();
    /** @type {Set<string>} */
    const paths = new Set();
    for (const request of keys) {
      const path = PdfPathManager.normalizeForStorage(toComparablePath(request.url));
      if (path) paths.add(path);
    }
    return paths;
  } catch (error) {
    console.warn('[Offline Store] Não foi possível listar o cache de PDFs:', error);
    return null;
  }
}

/**
 * `getPdfRelPath` devolve o caminho cru decodificado do `pdfId` — NFD para os
 * 8 caminhos do acervo que chegam assim. `readCachedPdfPaths` acima e o
 * `remaining` da retomada (mais abaixo, via `prepareForComparison`) já
 * normalizam para NFC com `PdfPathManager.normalizeForStorage`; sem fazer o
 * mesmo aqui, `verifyCompletedPart` compara um caminho NFD contra as duas
 * outras pontas em NFC e nunca marca a parte como pulável (achado I1).
 * @param {{ pdfId: string }} louvor
 * @returns {string | null}
 */
function getPdfRelPathNormalizado(louvor) {
  const relPath = getPdfRelPath(louvor);
  return relPath ? PdfPathManager.normalizeForStorage(relPath) : null;
}

/**
 * Erro traduzido para respostas que chegam OK mas não são um pacote —
 * o caso clássico é o wi-fi de portal cativo devolvendo a página de login.
 * @param {Response} response
 * @param {string} filename
 */
function assertPackageResponse(response, filename) {
  if (looksLikeCaptivePortal(response)) {
    const erro = new Error(
      `A rede devolveu uma página de login em vez do pacote ${filename}. ` +
        'Confirme o acesso ao wi-fi e tente novamente.'
    );
    // Retentar não tira ninguém da tela de login do wi-fi: só adia a mensagem
    // que resolve o problema. Ver `partRetry.js`.
    /** @type {any} */ (erro).naoRetentavel = true;
    throw erro;
  }
}

/**
 * Deixa o leitor pronto para abrir sem rede, sem navegar nem abrir aba.
 *
 * Melhor esforço: falha aqui não derruba o download nem vira erro na tela — só
 * deixa de marcar `IS_LEITOR_OFFLINE`, que é o que o indicador lê para dizer
 * "app pronta para uso offline".
 *
 * @returns {Promise<void>}
 */
async function garantirLeitorOffline() {
  if (!browser || typeof caches === 'undefined') return;

  try {
    const { prepararLeitorOffline } = await import('$lib/offline/utils/leitorOffline.js');
    const { getConfig } = await import('$lib/offline/core/OfflineConfig.js');
    const cache = await caches.open(getConfig('APP_CACHE_NAME'));

    const r = await prepararLeitorOffline({
      cache,
      fetchImpl: (/** @type {any} */ url) => fetch(url),
      setFlag: (valor) => safeSet(IS_LEITOR_OFFLINE_KEY, valor)
    });

    console.info(
      `[Offline Store] Leitor offline: ${r.pronto ? 'pronto' : 'incompleto'} ` +
        `(${r.guardadas} guardadas, ${r.falharam} falharam)`
    );
  } catch (err) {
    console.warn('[Offline Store] Não foi possível preparar o leitor offline:', err);
  }
}

/**
 * Baixa uma parte inteira, com retentativa e com os bytes indo para a tela.
 *
 * O contador de bytes é o único sinal de vida durante os minutos que uma parte
 * de ~30 MB leva em rede móvel: sem ele a tela fica congelada no mesmo número
 * do começo ao fim da parte, e não há como distinguir "baixando devagar" de
 * "travado". A retentativa cobre pedido E corpo — ver `partRetry.js`.
 *
 * @param {string} packageUrl
 * @param {{ filename: string }} part
 * @returns {Promise<Blob>}
 */
async function baixarParte(packageUrl, part) {
  return downloadPartWithRetry(packageUrl, {
    fetchImpl: (/** @type {any} */ url, /** @type {any} */ init) => fetch(url, init),
    init: { signal: zipDownloadController?.signal, cache: 'no-store' },
    type: 'application/zip',
    attempts: 4,
    isCancelled: () => zipDownloadCancelled,
    validateResponse: (resposta) => assertPackageResponse(resposta, part.filename),
    onBytes: (bytes) => somarBytes(bytes),
    onAttemptFailed: (tentativa, erro, bytesPerdidos) => {
      console.warn(`[Offline Store] Tentativa ${tentativa} de ${part.filename}:`, erro.message);
      // Os bytes que chegaram antes da queda já foram somados na tela; sem
      // devolvê-los, uma retentativa faria o contador passar do total e a
      // barra encostar em 100% com a parte ainda pela metade.
      if (bytesPerdidos > 0) somarBytes(-bytesPerdidos);
    }
  });
}

/**
 * Soma (ou devolve) bytes ao contador da tela, movendo a barra junto.
 * @param {number} bytes
 */
function somarBytes(bytes) {
  offlineState.update((s) => {
    const bytesDownloaded = Math.max(0, s.bytesDownloaded + bytes);
    return { ...s, bytesDownloaded, progress: progressoPorBytes(s, bytesDownloaded) };
  });
}

/**
 * Porcentagem da barra durante o download, medida em bytes.
 *
 * A barra media PDFs gravados, que só mudam quando uma parte inteira termina
 * de chegar: em 31 partes, eram 31 saltos com longos minutos de imobilidade
 * entre eles. Bytes se movem a cada pedaço que a rede entrega.
 *
 * Sem estimativa de total (manifesto sem `size`), mantém o valor que já estava
 * — quem grava os PDFs continua atualizando a barra por contagem.
 *
 * Nunca recua e nunca chega a 100 antes do fim: os 100% são dados pelo bloco
 * de conclusão, depois da conferência contra o cache.
 *
 * @param {{ progress?: number, bytesTotal?: number | null }} state
 * @param {number} bytesDownloaded
 * @returns {number}
 */
function progressoPorBytes(state, bytesDownloaded) {
  const total = state.bytesTotal;
  if (typeof total !== 'number' || total <= 0) return state.progress || 0;
  const pct = Math.min(99, Math.floor((bytesDownloaded / total) * 100));
  return Math.max(state.progress || 0, pct);
}

/**
 * Grava um PDF no cache traduzindo falta de espaço em erro fatal e legível.
 *
 * Um `cache.put` que falha por cota nunca melhora na próxima entrada: continuar
 * o laço só produz um download que "termina com sucesso" sem ter gravado nada
 * — que era exatamente o que acontecia antes, um PDF de cada vez.
 *
 * @param {Cache} cache
 * @param {Request} request
 * @param {Response} response
 */
async function gravarPdfNoCache(cache, request, response) {
  try {
    await cache.put(request, response);
  } catch (err) {
    if (isQuotaError(err)) {
      throw new Error(quotaErrorMessage({}));
    }
    throw err;
  }
}

/**
 * Download ZIP packages with specific parts only (optimized)
 * @param {Array} categories - Categories to download
 * @param {Array} pdfUrls - All PDF URLs for validation
 * @param {Record<string, Array<{ filename: string, url?: string, size?: number, pdfs?: string[] }>>} partsByCategory - Map of category -> array of specific parts to download
 * @param {Object} manifest - Offline manifest
 */
async function startZipDownloadWithSpecificParts(categories, pdfUrls, partsByCategory, manifest) {
  if (!browser) return;

  if (zipDownloadController) {
    try {
      zipDownloadController.abort();
    } catch (err) {
      console.warn('[Offline Store] Could not abort previous zip download controller:', err);
    }
  }

  zipDownloadCancelled = false;
  zipDownloadController = new AbortController();
  isZipDownloadActive = true;

  const total = pdfUrls.length;
  // #22.2: os dois lados da comparação passam pelo normalizador canônico, senão
  // um caminho em NFD vindo do pdfId nunca casa com a entrada de ZIP já em NFC.
  const prepareForComparison = (/** @type {string} */ url) =>
    PdfPathManager.normalizeForStorage(url);
  
  // Índice O(1) dos PDFs desejados; `remaining` controla o que ainda falta gravar.
  // #22.2: sem o `normalize` aqui, `wantedIndex.has(preparedPath)` compara um
  // `preparedPath` já em NFC (via normalizeForStorage) contra entradas ainda
  // em NFD (pdfUrls vem do pdfId, sem NFC) — para os 5 dos 8 caminhos NFD cujo
  // acento está no próprio nome de arquivo, nem o basename bate, e o PDF
  // deixaria de ser gravado a partir do ZIP, silenciosamente.
  // #22.3: `buildPdfCacheIndex` perdeu o fallback por nome de arquivo que
  // disfarçava esse mesmo problema para outros casos — o `normalize` acima
  // agora é a única guarda contra o PDF em NFD ser pulado em silêncio.
  const wantedIndex = buildPdfCacheIndex(pdfUrls, { normalize: PdfPathManager.normalizeForStorage });
  const remaining = new Set(pdfUrls.map(prepareForComparison));
  let completed = 0;

  const totalParts = Object.values(partsByCategory).reduce((n, parts) => n + parts.length, 0);
  const bytesTotal = sumPartsSizeByCategory(partsByCategory); // number | null (null = não estimável)
  let partIndex = 0;

  offlineState.update(state => ({
    ...state,
    downloading: true,
    autoDownloading: false,
    progress: total === 0 ? 100 : 0,
    completed: 0,
    failed: 0,
    total,
    currentPart: 0,
    totalParts,
    currentPartName: '',
    bytesDownloaded: 0,
    bytesTotal,
    phase: null,
    selectedCategories: categories,
    error: null
  }));

  try {
    const cache = await openPdfCache();
    // Pode ser null (Firefox com dados do site bloqueados); partProgress tolera.
    const partsStorage = safeStorage();

    // Iterar pelas categorias
    for (const category of categories) {
      if (zipDownloadCancelled) {
        throw new Error('DOWNLOAD_CANCELLED');
      }

      // Obter apenas as partes necessárias para esta categoria
      const requiredParts = partsByCategory[category] || [];
      
      if (requiredParts.length === 0) {
        console.log(`[Offline Store] No required parts for category ${category}, skipping`);
        continue;
      }

      console.log(`[Offline Store] Downloading ${requiredParts.length} parts for category ${category}`);

      // Retomada: partes gravadas em uma tentativa anterior deste mesmo conjunto
      // de pacotes. A impressão digital garante que não estamos emendando
      // partes novas do servidor em partes velhas do dispositivo.
      const partsFingerprint = fingerprintForCategory(category, manifest, requiredParts);
      const completedParts = readCompletedParts(partsStorage, category, partsFingerprint);
      const cachedPaths = completedParts.size > 0 ? await readCachedPdfPaths(cache) : null;

      // Baixar apenas as partes necessárias
      for (const part of requiredParts) {
        if (zipDownloadCancelled) {
          throw new Error('DOWNLOAD_CANCELLED');
        }

        // Conta a parte no total mesmo quando ela vai ser pulada: é isso que
        // impede a retomada de "voltar" para a parte 1 de N.
        partIndex++;
        offlineState.update(s => ({
          ...s,
          currentPart: partIndex,
          currentPartName: part.filename
        }));

        if (completedParts.has(part.filename)) {
          const { skippable, paths } = verifyCompletedPart(part, cachedPaths, getPdfRelPathNormalizado);

          if (skippable) {
            console.info(`[Offline Store] Parte já baixada, pulando: ${part.filename}`);

            for (const relPath of paths) {
              if (remaining.delete(relPath)) {
                completed++;
              }
            }

            offlineState.update(state => ({
              ...state,
              completed,
              failed: 0,
              // Sem fase: nada está sendo baixado/extraído/gravado agora, só
              // reconhecido como já pronto de uma tentativa anterior.
              phase: null,
              // A parte pulada não passa pelo fetch que soma bytesDownloaded:
              // encolhe o total pelo tamanho dela para o contador de bytes
              // continuar honesto numa retomada (senão trava abaixo de 100%
              // com a barra de progresso já cheia).
              bytesTotal: excludeSkippedPartFromBytesTotal(state.bytesTotal, part.size),
              progress: total === 0 ? 100 : Math.min(99, Math.floor((completed / total) * 100))
            }));

            continue;
          }

          console.warn(
            `[Offline Store] Parte marcada como concluída mas ausente do cache, refazendo: ${part.filename}`
          );
        }

        const packageUrl = normalizePackageUrl(part.url, part.filename);

        offlineState.update(s => ({ ...s, phase: 'baixando' }));

        // Pedido e corpo retentados como uma unidade — ver `partRetry.js`.
        // `fetchWithRetry` sozinho só protegia até os cabeçalhos chegarem, e é
        // durante os ~30 MB seguintes que a rede móvel cai.
        //
        // Os bytes sobem pedaço a pedaço, e não de uma vez no fim: entre o
        // começo e o fim da leitura de uma parte passam-se minutos, e somar só
        // no fim deixava a tela igual a uma tela travada durante todo esse
        // tempo.
        const blob = await baixarParte(packageUrl, part);

        if (zipDownloadCancelled) {
          throw new Error('DOWNLOAD_CANCELLED');
        }

        offlineState.update(s => ({ ...s, phase: 'extraindo' }));

        // Extrai as entradas do ZIP uma a uma (streaming via central directory),
        // em vez de descomprimir o pacote inteiro em memória de uma só vez.
        for await (const { name, data } of iterateZipEntriesCd(blob, zipDownloadController.signal)) {
          if (zipDownloadCancelled) {
            throw new Error('DOWNLOAD_CANCELLED');
          }

          // #22.5: o normalizador canônico direto, sem o invólucro que só
          // acrescentava a barra inicial.
          const preparedPath = PdfPathManager.normalizeForStorage(name);
          if (!preparedPath || !preparedPath.endsWith('.pdf')) continue;

          const pathForComparison = prepareForComparison(preparedPath);

          // Só grava o que foi pedido e ainda não foi gravado.
          if (!wantedIndex.has(preparedPath)) continue;
          if (!remaining.has(pathForComparison)) continue;

          const pdfBlob = new Blob([data], { type: 'application/pdf' });
          const requestUrl = PdfPathManager.createRequestUrl(preparedPath, location.origin);
          const pdfResponse = new Response(pdfBlob, {
            headers: { 'Content-Type': 'application/pdf' }
          });

          await gravarPdfNoCache(cache, new Request(requestUrl), pdfResponse);

          remaining.delete(pathForComparison);
          completed++;

          const porPdfs = total === 0 ? 100 : Math.min(99, Math.floor((completed / total) * 100));

          offlineState.update(state => ({
            ...state,
            completed,
            failed: 0,
            // `Math.max`: a barra passou a ser medida em bytes durante o
            // download (ver `progressoPorBytes`), e as duas medidas não batem
            // exatamente. Sem isto, a barra recuava ao começar a gravar.
            progress: Math.max(state.progress || 0, porPdfs),
            // Só passa a 'gravando' na primeira escrita real: até aqui o laço
            // ainda está lendo o índice central do ZIP e decidindo o que interessa.
            phase: 'gravando'
          }));
        }

        // Remove o arquivo ZIP do cache após processar todos os PDFs
        const fullPackageUrl = createUrlUtf8(packageUrl, location.origin);
        await removeZipFromCache(fullPackageUrl);

        // Parte inteira gravada: se o download cair na próxima, esta não volta.
        markPartCompleted(partsStorage, category, part.filename, partsFingerprint);
      }

      // Categoria concluída — mas só limpa se este laço cobriu todas as partes
      // que ela tem no manifesto. Ver `coversEveryPart`.
      if (coversEveryPart(category, manifest, requiredParts)) {
        clearCompletedParts(partsStorage, category);
      }
    }

    if (zipDownloadCancelled) {
      throw new Error('DOWNLOAD_CANCELLED');
    }

    // Concilia o que sobrou com o cache real. Sem isso, os PDFs vindos de partes
    // puladas na retomada seriam contados como "não encontrados".
    if (remaining.size > 0) {
      const cachedAfterDownload = await readCachedPdfPaths(cache);
      if (cachedAfterDownload) {
        for (const path of [...remaining]) {
          if (cachedAfterDownload.has(toComparablePath(path))) {
            remaining.delete(path);
            completed++;
          }
        }
      }
    }

    const failed = remaining.size;
    const finalCompleted = Math.min(completed, total - failed);
    const finalProgress = total === 0 ? 100 : Math.floor((finalCompleted / total) * 100);

    // Calculate error message based on actual failed count
    // Only set error if there are actually failed PDFs after verification
    let errorMessage = null;
    if (failed > 0) {
      errorMessage = `${failed} PDFs não foram encontrados nos pacotes selecionados.`;
    }

    offlineState.update(state => ({
      ...state,
      downloading: false,
      progress: finalProgress,
      completed: finalCompleted,
      failed,
      error: errorMessage,
      phase: null
    }));

    if (!zipDownloadCancelled) {
      // Grava sem derrubar um download que já terminou com sucesso: ver
      // `safeSetItem`.
      safeSetItem(ALLOW_OFFLINE_KEY, 'true');
      /**
       * @type {string | any[]}
       */
      const louvoresData = get(louvores);
      if (louvoresData && louvoresData.length > 0) {
        const currentHash = getManifestHash(louvoresData);
        safeSetItem(LAST_MANIFEST_HASH_KEY, currentHash);

        // Update PDF index after ZIP extraction (force update after download)
        if (browser) {
          const { updatePdfIndexInBackground, invalidatePdfIndexSession } = await import('$lib/utils/pdfIndex');
          invalidatePdfIndexSession(); // Invalidar cache de sessão para forçar nova verificação
          updatePdfIndexInBackground(louvoresData, true, true); // immediate = true, force = true
          
          // Notify cache update for sync
          const { notifyCacheUpdate, updateCacheVersion } = await import('$lib/utils/cacheSync');
          notifyCacheUpdate({ source: 'zip-download' });
          await updateCacheVersion();
        }
      }

      // Sync all information after download
      await syncAfterDownload();
      
      // Notify Service Worker once at the end of batch download
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'CACHE_UPDATED',
            timestamp: Date.now(),
            source: 'zip-download-batch',
            count: finalCompleted
          });
        }
      } catch (err) {
        console.warn('[Offline Store] Failed to notify Service Worker:', err);
      }
      
      // Dispatch event to notify UI of cache update
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('offline-cache-updated', {
          detail: {
            source: 'zip-download-specific',
            cachedCount: get(offlineState).cachedCount,
            timestamp: Date.now()
          }
        }));
        
        // FASE 2: Invalidar cache de validação após download
        const { clearAllValidationCache } = await import('$lib/utils/pdfValidation');
        clearAllValidationCache();
      }
    }

  } catch (error) {
    console.error('[Offline Store] ZIP download error:', error);
    offlineState.update(state => ({
      ...state,
      downloading: false,
      phase: null,
      // A frase vem de `mensagemDeErroDeDownload`: o que chegava aqui era a
      // mensagem escrita para o console ("HTTP 500 ao baixar /packages/..."),
      // e era ela que aparecia na tela de quem tinha acabado de esperar
      // dezenas de minutos por um download.
      error: mensagemDeErroDeDownload(error)
    }));
  } finally {
    isZipDownloadActive = false;
    zipDownloadController = null;
  }
}

/**
 * Check for new PDFs and auto-download if enabled
 */
async function checkForNewPDFs() {
  if (!browser) return;

  const allowOffline = safeGet(ALLOW_OFFLINE_KEY) === 'true';
  if (!allowOffline) return;

  // Get saved categories - only download PDFs from selected categories
  const savedCategories = getSavedCategories();
  if (!savedCategories || savedCategories.length === 0) {
    console.log('[Offline Store] No categories selected for auto-download');
    return;
  }

  /**
   * @type {any[]}
   */
  const louvoresData = get(louvores);
  if (!louvoresData || louvoresData.length === 0) return;

  const currentHash = getManifestHash(louvoresData);
  const lastHash = safeGet(LAST_MANIFEST_HASH_KEY);

  // First time or manifest changed
  if (lastHash && lastHash !== currentHash) {
    console.log('[Offline Store] Manifest changed, checking for new PDFs');
    
    const state = get(offlineState);
    /**
     * @type {any[]}
     */
    const cachedPdfs = state.cachedPdfs;

    const indiceDeCache = buildPdfCacheIndex(cachedPdfs, {
      normalize: (/** @type {string} */ path) => PdfPathManager.normalizeForStorage(path)
    });

    // Find new PDFs that aren't cached yet AND are in the selected categories
    const newPdfs = louvoresData.filter(louvor => {
      // Only include PDFs from selected categories
      if (!savedCategories.includes(louvor.categoria)) {
        return false;
      }

      const pdfUrl = getPdfUrl(louvor);
      if (!pdfUrl) {
        return false;
      }

      // #22.4: era `cached.includes(pdfUrl)` — substring pura sobre milhares de
      // URLs. Como a chave gravada é percent-encoded, ela dizia "novo" para os
      // 2597 caminhos do acervo que têm espaço ou acento, mandando baixar de
      // novo o que já estava no aparelho a cada mudança de manifesto.
      return !indiceDeCache.has(pdfUrl);
    });

    if (newPdfs.length > 0) {
      console.log(`[Offline Store] Found ${newPdfs.length} new PDFs in selected categories:`, savedCategories);
      
      // Auto-download new PDFs
      offlineState.update(s => ({ ...s, autoDownloading: true }));
      
      const pdfUrls = newPdfs.map(getPdfUrl).filter(url => url !== null);
      await startDownload(pdfUrls);
      
      offlineState.update(s => ({ ...s, autoDownloading: false }));
    }
  }

  // Save current hash
  safeSet(LAST_MANIFEST_HASH_KEY, currentHash);
}

/**
 * Downloads only the packages needed for missing PDFs
 * @param {Array} missingPdfs - Array of louvor objects with missing PDFs
 * @returns {Promise<void>}
 */
async function downloadMissingPackages(missingPdfs) {
  if (!browser || !missingPdfs || missingPdfs.length === 0) {
    return;
  }

  // Get offline manifest
  const state = get(offlineState);
  let manifest = state.offlineManifest;

  if (!manifest) {
    try {
      manifest = await fetchOfflineManifest();
    } catch (error) {
      console.error('[Offline Store] Failed to fetch manifest:', error);
      offlineState.update(s => ({
        ...s,
        error: 'Não foi possível carregar o manifest de pacotes offline.'
      }));
      return;
    }
  }

  // Find required packages
  const requiredParts = findRequiredPackagesForMissing(missingPdfs, manifest);

  if (requiredParts.length === 0) {
    console.log('[Offline Store] No packages needed for missing PDFs');
    return;
  }

  console.log(`[Offline Store] Found ${requiredParts.length} packages needed for ${missingPdfs.length} missing PDFs`);

  // Group by category and download
  const categoriesToDownload = [...new Set(requiredParts.map(part => part.category))];
  
  // Get all PDF URLs for these categories
  /**
   * @type {any[]}
   */
  const louvoresData = get(louvores);
  const pdfUrls = louvoresData
    .filter(louvor => categoriesToDownload.includes(louvor.categoria))
    .map(getPdfUrl)
    .filter(url => url !== null);

  if (pdfUrls.length > 0) {
    // Use existing zip download function
    await startZipDownload(categoriesToDownload, pdfUrls);
  }
}

/**
 * Start downloading PDFs
 * @param {string | any[]} pdfUrls
 */
async function startDownload(pdfUrls, selectedCategories = []) {
  if (!browser) return;

  if (!isServiceWorkerReady()) {
    console.error('[Offline Store] Service worker not ready');
    offlineState.update(state => ({
      ...state,
      error: 'Service worker nao esta pronto. Recarregue a pagina.'
    }));
    return;
  }

  offlineState.update(state => ({
    ...state,
    downloading: true,
    progress: 0,
    completed: 0,
    failed: 0,
    total: pdfUrls.length,
    selectedCategories,
    error: null
  }));

  try {
    const result = await downloadPDFsViaSW(pdfUrls, 10, (/** @type {{ percentage: any; completed: any; failed: any; }} */ progressData) => {
      // Update progress
      offlineState.update(state => ({
        ...state,
        progress: progressData.percentage || 0,
        completed: progressData.completed || 0,
        failed: progressData.failed || 0
      }));
    });

    // Download completed
    offlineState.update(state => ({
      ...state,
      downloading: false,
      progress: 100,
      completed: result.completed || 0,
      failed: result.failed || 0
    }));

    // Mark offline mode as enabled
    if (browser && !result.cancelled) {
      localStorage.setItem(ALLOW_OFFLINE_KEY, 'true');
      
      // Update manifest hash
      /**
       * @type {never[]}
       */
      const louvoresData = get(louvores);
      const currentHash = getManifestHash(louvoresData);
      localStorage.setItem(LAST_MANIFEST_HASH_KEY, currentHash);
    }

    // Reload cached PDFs list
    await loadCachedPdfsList();
    
    // Update PDF index after download
    if (browser && !result.cancelled) {
      const { updatePdfIndexInBackground, invalidatePdfIndexSession } = await import('$lib/utils/pdfIndex');
      invalidatePdfIndexSession(); // Invalidar cache de sessão para forçar nova verificação
      /**
       * @type {any[]}
       */
      const louvoresData = get(louvores);
      updatePdfIndexInBackground(louvoresData, true, true); // immediate = true, force = true
      
      // Notify cache update for sync
      const { notifyCacheUpdate, updateCacheVersion } = await import('$lib/utils/cacheSync');
      notifyCacheUpdate({ source: 'pdf-download' });
      await updateCacheVersion();
    }

  } catch (error) {
    console.error('[Offline Store] Download error:', error);
    offlineState.update(state => ({
      ...state,
      downloading: false,
      error: error.message || 'Erro ao baixar PDFs'
    }));
  }
}

/**
 * Download PDFs by categories
 * @param {any[]} categories
 * @param {Iterable<any> | null | undefined} pdfUrls
 */
async function startZipDownload(categories, pdfUrls, alreadyDownloadedCategories = []) {
  if (!browser) return;

  if (zipDownloadController) {
    try {
      zipDownloadController.abort();
    } catch (err) {
      console.warn('[Offline Store] Could not abort previous zip download controller:', err);
    }
  }

  zipDownloadCancelled = false;
  zipDownloadController = new AbortController();
  isZipDownloadActive = true;

  const total = pdfUrls.length;
  // #22.2: os dois lados da comparação passam pelo normalizador canônico, senão
  // um caminho em NFD vindo do pdfId nunca casa com a entrada de ZIP já em NFC.
  const prepareForComparison = (/** @type {string} */ url) =>
    PdfPathManager.normalizeForStorage(url);
  
  // Índice O(1) dos PDFs desejados; `remaining` controla o que ainda falta gravar.
  // #22.2: sem o `normalize` aqui, `wantedIndex.has(preparedPath)` compara um
  // `preparedPath` já em NFC (via normalizeForStorage) contra entradas ainda
  // em NFD (pdfUrls vem do pdfId, sem NFC) — para os 5 dos 8 caminhos NFD cujo
  // acento está no próprio nome de arquivo, nem o basename bate, e o PDF
  // deixaria de ser gravado a partir do ZIP, silenciosamente.
  // #22.3: `buildPdfCacheIndex` perdeu o fallback por nome de arquivo que
  // disfarçava esse mesmo problema para outros casos — o `normalize` acima
  // agora é a única guarda contra o PDF em NFD ser pulado em silêncio.
  const wantedIndex = buildPdfCacheIndex(pdfUrls, { normalize: PdfPathManager.normalizeForStorage });
  const remaining = new Set(pdfUrls.map(prepareForComparison));
  let completed = 0;

  // Get manifest
  const state = get(offlineState);
  let manifest = state.offlineManifest;

  if (!manifest) {
    // Try to fetch manifest if not available
    try {
      manifest = await fetchOfflineManifest();
    } catch (error) {
      offlineState.update(s => ({
        ...s,
        downloading: false,
        error: 'Não foi possível carregar o manifest de pacotes offline. Tente novamente.'
      }));
      return;
    }
  }

  // Partes de todas as categorias, calculadas de uma vez para o total do
  // cabeçalho (parte X de Y) e para a estimativa de bytes.
  /** @type {Record<string, any[]>} */
  const allPartsByCategory = {};
  for (const category of categories) {
    allPartsByCategory[category] = getPackageParts(category, manifest);
  }
  const totalParts = Object.values(allPartsByCategory).reduce((n, parts) => n + parts.length, 0);
  const bytesTotal = sumPartsSizeByCategory(allPartsByCategory); // number | null
  let partIndex = 0;

  offlineState.update(state => ({
    ...state,
    downloading: true,
    autoDownloading: false,
    progress: total === 0 ? 100 : 0,
    completed: 0,
    failed: 0,
    total,
    currentPart: 0,
    totalParts,
    currentPartName: '',
    bytesDownloaded: 0,
    bytesTotal,
    phase: null,
    selectedCategories: categories,
    error: null
  }));

  try {
    const cache = await openPdfCache();
    // Pode ser null (Firefox com dados do site bloqueados); partProgress tolera.
    const partsStorage = safeStorage();

    for (const category of categories) {
      if (zipDownloadCancelled) {
        throw new Error('DOWNLOAD_CANCELLED');
      }

      // Partes desta categoria, já calculadas acima.
      const packageParts = allPartsByCategory[category] || [];

      if (packageParts.length === 0) {
        console.warn(`[Offline Store] No package parts found for category ${category}`);
        continue;
      }

      // Retomada: mesmas regras da versão por partes específicas.
      const partsFingerprint = fingerprintForCategory(category, manifest, packageParts);
      const completedParts = readCompletedParts(partsStorage, category, partsFingerprint);
      const cachedPaths = completedParts.size > 0 ? await readCachedPdfPaths(cache) : null;

      // Download each part
      for (const part of packageParts) {
        if (zipDownloadCancelled) {
          throw new Error('DOWNLOAD_CANCELLED');
        }

        // Conta a parte no total mesmo quando ela vai ser pulada: é isso que
        // impede a retomada de "voltar" para a parte 1 de N.
        partIndex++;
        offlineState.update(s => ({
          ...s,
          currentPart: partIndex,
          currentPartName: part.filename
        }));

        if (completedParts.has(part.filename)) {
          const { skippable, paths } = verifyCompletedPart(part, cachedPaths, getPdfRelPathNormalizado);

          if (skippable) {
            console.info(`[Offline Store] Parte já baixada, pulando: ${part.filename}`);

            for (const relPath of paths) {
              if (remaining.delete(relPath)) {
                completed++;
              }
            }

            offlineState.update(state => ({
              ...state,
              completed,
              failed: 0,
              // Sem fase: nada está sendo baixado/extraído/gravado agora, só
              // reconhecido como já pronto de uma tentativa anterior.
              phase: null,
              // A parte pulada não passa pelo fetch que soma bytesDownloaded:
              // encolhe o total pelo tamanho dela para o contador de bytes
              // continuar honesto numa retomada (senão trava abaixo de 100%
              // com a barra de progresso já cheia).
              bytesTotal: excludeSkippedPartFromBytesTotal(state.bytesTotal, part.size),
              progress: total === 0 ? 100 : Math.min(99, Math.floor((completed / total) * 100))
            }));

            continue;
          }

          console.warn(
            `[Offline Store] Parte marcada como concluída mas ausente do cache, refazendo: ${part.filename}`
          );
        }

        const packageUrl = normalizePackageUrl(part.url, part.filename);

        offlineState.update(s => ({ ...s, phase: 'baixando' }));

        // Pedido e corpo retentados como uma unidade — ver `partRetry.js`.
        // `fetchWithRetry` sozinho só protegia até os cabeçalhos chegarem, e é
        // durante os ~30 MB seguintes que a rede móvel cai.
        //
        // Os bytes sobem pedaço a pedaço, e não de uma vez no fim: entre o
        // começo e o fim da leitura de uma parte passam-se minutos, e somar só
        // no fim deixava a tela igual a uma tela travada durante todo esse
        // tempo.
        const blob = await baixarParte(packageUrl, part);

        if (zipDownloadCancelled) {
          throw new Error('DOWNLOAD_CANCELLED');
        }

        offlineState.update(s => ({ ...s, phase: 'extraindo' }));

        // Extrai as entradas do ZIP uma a uma (streaming via central directory),
        // em vez de descomprimir o pacote inteiro em memória de uma só vez.
        for await (const { name, data } of iterateZipEntriesCd(blob, zipDownloadController.signal)) {
          if (zipDownloadCancelled) {
            throw new Error('DOWNLOAD_CANCELLED');
          }

          // #22.5: o normalizador canônico direto, sem o invólucro que só
          // acrescentava a barra inicial.
          const preparedPath = PdfPathManager.normalizeForStorage(name);
          if (!preparedPath || !preparedPath.endsWith('.pdf')) continue;

          const pathForComparison = prepareForComparison(preparedPath);

          // Só grava o que foi pedido e ainda não foi gravado.
          if (!wantedIndex.has(preparedPath)) continue;
          if (!remaining.has(pathForComparison)) continue;

          const pdfBlob = new Blob([data], { type: 'application/pdf' });
          const requestUrl = PdfPathManager.createRequestUrl(preparedPath, location.origin);
          const pdfResponse = new Response(pdfBlob, {
            headers: { 'Content-Type': 'application/pdf' }
          });

          await gravarPdfNoCache(cache, new Request(requestUrl), pdfResponse);

          remaining.delete(pathForComparison);
          completed++;

          const porPdfs = total === 0 ? 100 : Math.min(99, Math.floor((completed / total) * 100));

          offlineState.update(state => ({
            ...state,
            completed,
            failed: 0,
            // `Math.max`: a barra passou a ser medida em bytes durante o
            // download (ver `progressoPorBytes`), e as duas medidas não batem
            // exatamente. Sem isto, a barra recuava ao começar a gravar.
            progress: Math.max(state.progress || 0, porPdfs),
            // Só passa a 'gravando' na primeira escrita real: até aqui o laço
            // ainda está lendo o índice central do ZIP e decidindo o que interessa.
            phase: 'gravando'
          }));
        }

        // Remove o arquivo ZIP do cache após processar todos os PDFs
        const fullPackageUrl = createUrlUtf8(packageUrl, location.origin);
        await removeZipFromCache(fullPackageUrl);

        // Parte inteira gravada: se o download cair na próxima, esta não volta.
        markPartCompleted(partsStorage, category, part.filename, partsFingerprint);
      }

      // Categoria concluída — aqui o laço é sempre o conjunto completo de partes.
      if (coversEveryPart(category, manifest, packageParts)) {
        clearCompletedParts(partsStorage, category);
      }
    }

    if (zipDownloadCancelled) {
      throw new Error('DOWNLOAD_CANCELLED');
    }

    // Concilia o que sobrou com o cache real. Sem isso, os PDFs vindos de partes
    // puladas na retomada seriam contados como "não encontrados".
    if (remaining.size > 0) {
      const cachedAfterDownload = await readCachedPdfPaths(cache);
      if (cachedAfterDownload) {
        for (const path of [...remaining]) {
          if (cachedAfterDownload.has(toComparablePath(path))) {
            remaining.delete(path);
            completed++;
          }
        }
      }
    }

    const failed = remaining.size;
    const finalCompleted = Math.min(completed, total - failed);
    const finalProgress = total === 0 ? 100 : Math.floor((finalCompleted / total) * 100);

    // Calculate error message based on actual failed count
    let errorMessage = null;
    if (failed > 0) {
      errorMessage = `${failed} PDFs não foram encontrados nos pacotes selecionados.`;
    }

    offlineState.update(state => ({
      ...state,
      downloading: false,
      progress: finalProgress,
      completed: finalCompleted,
      failed,
      error: errorMessage,
      phase: null
    }));

    if (!zipDownloadCancelled) {
      // Grava sem derrubar um download que já terminou com sucesso: ver
      // `safeSetItem`.
      safeSetItem(ALLOW_OFFLINE_KEY, 'true');
      /**
       * @type {string | any[]}
       */
      const louvoresData = get(louvores);
      if (louvoresData && louvoresData.length > 0) {
        const currentHash = getManifestHash(louvoresData);
        safeSetItem(LAST_MANIFEST_HASH_KEY, currentHash);

        // Update PDF index after ZIP extraction
        if (browser) {
          const { updatePdfIndexInBackground, invalidatePdfIndexSession } = await import('$lib/utils/pdfIndex');
          invalidatePdfIndexSession(); // Invalidar cache de sessão para forçar nova verificação
          updatePdfIndexInBackground(louvoresData, true, true); // immediate = true, force = true
        }
      }

      // Sync all information after download
      await syncAfterDownload();
      
      // Merge with already downloaded categories if provided
      if (alreadyDownloadedCategories && alreadyDownloadedCategories.length > 0) {
        const currentDownloaded = getDownloadedCategories();
        const allDownloaded = [...new Set([...currentDownloaded, ...alreadyDownloadedCategories])];
        saveDownloadedCategories(allDownloaded);
        
        console.log('[Offline Store] Updated downloaded categories:', allDownloaded);
      }
      
      // Notify Service Worker once at the end of batch download
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'CACHE_UPDATED',
            timestamp: Date.now(),
            source: 'zip-download-batch',
            count: finalCompleted
          });
        }
      } catch (err) {
        console.warn('[Offline Store] Failed to notify Service Worker:', err);
      }
      
      // Dispatch event to notify UI of cache update
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('offline-cache-updated', {
          detail: {
            source: 'zip-download',
            cachedCount: get(offlineState).cachedCount,
            timestamp: Date.now()
          }
        }));
        
        // FASE 2: Invalidar cache de validação após download
        const { clearAllValidationCache } = await import('$lib/utils/pdfValidation');
        clearAllValidationCache();
      }

      // Prepara o leitor sem sair da página. Antes daqui saía um `goto()` para
      // o leitor no fim do download: quem tinha acabado de acompanhar a barra
      // até 100% era jogado para outra tela sem ter pedido nada.
      await garantirLeitorOffline();
    }
  } catch (error) {
    if (error?.message !== 'DOWNLOAD_CANCELLED' && error?.name !== 'AbortError') {
      console.error('[Offline Store] Zip download error:', error);
    }
    offlineState.update(state => ({
      ...state,
      downloading: false,
      phase: null,
      error: mensagemDeErroDeDownload(error)
    }));
  } finally {
    zipDownloadController = null;
    isZipDownloadActive = false;
    zipDownloadCancelled = false;
  }
}

/**
 * @param {any} categories
 */
async function downloadByCategories(categories) {
  if (!browser) return;

  /**
   * @type {any[]}
   */
  const louvoresData = get(louvores);
  if (!louvoresData || louvoresData.length === 0) {
    console.error('[Offline Store] No louvores data available');
    return;
  }

  const validCategories = (categories || []).filter(Boolean);
  if (validCategories.length === 0) {
    offlineState.update(state => ({
      ...state,
      error: 'Selecione ao menos uma categoria para download.'
    }));
    return;
  }

  // Load cached PDFs to check which PDFs are already downloaded
  const state = get(offlineState);
  /**
   * @type {string | any[]}
   */
  let cachedPdfs = state.cachedPdfs;
  
  // If cached PDFs are not loaded, load them
  if (!cachedPdfs || cachedPdfs.length === 0) {
        try {
          cachedPdfs = await getCachedPDFsFast();
      offlineState.update(s => ({
        ...s,
        cachedPdfs,
        cachedCount: cachedPdfs.length
      }));
    } catch (error) {
      console.error('[Offline Store] Failed to load cached PDFs:', error);
      cachedPdfs = [];
    }
  }

  // Filter louvores by selected categories (including variants for normalized categories)
  // For "Cifra", include "Cifra nível I" and "Cifra nível II"
  const categoryVariantsMap = new Map();
  validCategories.forEach(cat => {
    const normalized = normalizeCategory(cat);
    const variants = getCategoryVariants(normalized);
    categoryVariantsMap.set(normalized, variants);
  });
  
  const allCategoryVariants = Array.from(categoryVariantsMap.values()).flat();
  const filteredLouvores = louvoresData.filter(louvor =>
    allCategoryVariants.includes(louvor.categoria)
  );

  if (filteredLouvores.length === 0) {
    offlineState.update(state => ({
      ...state,
      downloading: false,
      progress: 0,
      completed: 0,
      failed: 0,
      total: 0,
      error: 'Nenhum PDF encontrado para as categorias selecionadas.'
    }));
    return;
  }

  // NOVA LÓGICA: Identificar PDFs faltantes específicos
  let missingPdfs = identifyMissingPdfs(filteredLouvores, cachedPdfs);

  // "Nada falta" é a única conclusão que faz este botão não fazer nada. Antes
  // de aceitá-la, confere contra o Cache Storage de verdade.
  //
  // A lista de PDFs em cache vem de `getCachedPDFsFast`, que serve por até 5
  // minutos uma cópia guardada em localStorage. Se o navegador despejou o cache
  // dos PDFs por pressão de disco (ele pode, quando o armazenamento não é
  // persistente), a cópia continua dizendo que está tudo lá — e o clique
  // devolvia "Download concluído!" com progresso 100% sem ter baixado nada.
  if (missingPdfs.length === 0) {
    try {
      invalidateCachedPDFsLocal();
      const conferido = await getCachedPDFsFast();
      missingPdfs = identifyMissingPdfs(filteredLouvores, conferido);
      if (missingPdfs.length > 0) {
        console.warn(
          `[Offline Store] A lista guardada dizia que não faltava nada, mas o cache real tem ${conferido.length} PDFs: ${missingPdfs.length} faltando de verdade.`
        );
        cachedPdfs = conferido;
        offlineState.update(s => ({ ...s, cachedPdfs: conferido, cachedCount: conferido.length }));
      }
    } catch (err) {
      console.warn('[Offline Store] Não foi possível reconferir o cache de PDFs:', err);
    }
  }

  console.log(`[Offline Store] Found ${missingPdfs.length} missing PDFs out of ${filteredLouvores.length} total in selected categories`);

  // If all PDFs are already downloaded, show message and return
  if (missingPdfs.length === 0) {
    offlineState.update(state => ({
      ...state,
      downloading: false,
      progress: 100,
      completed: 0,
      failed: 0,
      total: 0,
      error: null
    }));
    console.log('[Offline Store] All PDFs in selected categories are already downloaded.');
    
    // Update downloaded categories list - check which categories are now complete
    // Normalize categories before checking to aggregate subcategories
    const normalizedCategories = [...new Set(validCategories.map(cat => normalizeCategory(cat)))];
    const completelyDownloaded = [];
    for (const normalizedCategory of normalizedCategories) {
      const isDownloaded = await isCategoryCompletelyDownloaded(normalizedCategory, cachedPdfs, louvoresData);
      if (isDownloaded) {
        completelyDownloaded.push(normalizedCategory);
      }
    }
    const currentDownloaded = getDownloadedCategories();
    const updatedDownloaded = [...new Set([...currentDownloaded, ...completelyDownloaded])];
    saveDownloadedCategories(updatedDownloaded);
    return;
  }

  // Save selected categories for future auto-downloads
  saveCategories(validCategories);

  // As rotas do app entram no cache junto com os PDFs.
  //
  // Sem isto, o acervo fica no aparelho mas as telas que o mostram não: sem
  // rede, abrir /biblioteca ou /offline cai no shell da raiz (ou em nada).
  // Roda em segundo plano e nunca derruba o download — é o que já fazia o
  // motor antigo, e precisa continuar acontecendo neste.
  cacheAppPages()
    .then((r) => {
      console.info(`[Offline Store] Páginas do app em cache: ${r.success}/${r.total}`);
      if (r.failed > 0) console.warn('[Offline Store] Páginas que falharam:', r.errors);
    })
    .catch((err) => console.warn('[Offline Store] cacheAppPages falhou (não crítico):', err));

  // O leitor é preparado aqui mesmo, sem abrir aba.
  //
  // Até 2026-09-02 esta linha era `navigateToRoute(leitorUrl, { newTab: true })`
  // — uma função que nunca foi definida nem importada (introduzida em f104c21).
  // Ou seja: quem nunca tinha aberto o leitor, que é exatamente quem clica em
  // "Disponibilizar offline" pela primeira vez, tomava um
  // `ReferenceError: navigateToRoute is not defined` ANTES do try/catch abaixo.
  // O download não começava e a tela não dizia nada. Era a falha silenciosa.
  //
  // A aba nova também não volta: no celular ela roubava o foco e mandava para
  // segundo plano a aba que estava baixando, onde o navegador estrangula a
  // rede. Ver `prepararLeitorOffline`.
  await garantirLeitorOffline();

  // NOVA LÓGICA: Obter manifest e identificar lotes necessários
  let manifest = state.offlineManifest;
  if (!manifest) {
    try {
      manifest = await fetchOfflineManifest();
    } catch (error) {
      console.error('[Offline Store] Failed to fetch manifest:', error);
      offlineState.update(s => ({
        ...s,
        error: 'Não foi possível carregar o manifest de pacotes offline. Tente novamente.'
      }));
      return;
    }
  }

  // Encontrar lotes necessários baseado nos PDFs faltantes
  const requiredParts = findRequiredPackagesForMissing(missingPdfs, manifest);
  
  if (requiredParts.length === 0) {
    console.warn('[Offline Store] No packages found for missing PDFs, falling back to full category download');
    // Fallback: baixar todas as categorias se não conseguir identificar lotes
    // Use normalized categories for download
    const normalizedCategories = [...new Set(validCategories.map(cat => normalizeCategory(cat)))];
    const pdfUrls = filteredLouvores.map(getPdfUrl).filter(url => url !== null);
    await startZipDownload(normalizedCategories, pdfUrls);
    return;
  }

  console.log(`[Offline Store] Identified ${requiredParts.length} package parts needed for ${missingPdfs.length} missing PDFs`);

  // Agrupar partes por categoria (normalize categories)
  /** @type {Record<string, Array<{ filename: string, url?: string, size?: number, pdfs?: string[] }>>} */
  const partsByCategory = {};
  for (const part of requiredParts) {
    const normalizedCategory = normalizeCategory(part.category);
    if (!partsByCategory[normalizedCategory]) {
      partsByCategory[normalizedCategory] = [];
    }
    partsByCategory[normalizedCategory].push(part);
  }

  // Obter todos os PDFs das categorias (para validação durante extração)
  const pdfUrls = filteredLouvores.map(getPdfUrl).filter(url => url !== null);
  const categoriesToDownload = Object.keys(partsByCategory);

  // Espaço em disco: perguntar antes vale mais do que descobrir na metade.
  //
  // O acervo inteiro passa de 800 MB. Sem esta checagem, um aparelho apertado
  // baixava por vários minutos e só então o `cache.put` começava a falhar por
  // cota — e falhava em silêncio, um PDF de cada vez. `persist()` na sequência
  // é o que impede o navegador de descartar o acervo baixado quando o disco
  // apertar depois.
  const bytesNecessarios = sumPartsSizeByCategory(partsByCategory);
  const espaco = await checkQuota(typeof navigator !== 'undefined' ? navigator : null, bytesNecessarios || 0);

  if (!espaco.ok) {
    offlineState.update(s => ({
      ...s,
      downloading: false,
      error: quotaErrorMessage({ faltam: espaco.faltam })
    }));
    return;
  }

  const persistente = await ensurePersistentStorage(typeof navigator !== 'undefined' ? navigator : null);
  console.info(
    `[Offline Store] Armazenamento persistente: ${persistente ? 'concedido' : 'melhor esforço'}`
  );

  // Usar nova função que baixa apenas os lotes específicos
  await startZipDownloadWithSpecificParts(categoriesToDownload, pdfUrls, partsByCategory, manifest);
}

/**
 * Cancel ongoing download
 */
async function cancelDownload() {
  if (!browser) return;

  if (isZipDownloadActive) {
    zipDownloadCancelled = true;
    if (zipDownloadController) {
      try {
        zipDownloadController.abort();
      } catch (err) {
        console.warn('[Offline Store] Failed to abort ZIP download controller:', err);
      }
    }

    offlineState.update(state => ({
      ...state,
      error: 'Cancelando download...'
    }));
    return;
  }

  try {
    await cancelDownloadSW();
    offlineState.update(state => ({
      ...state,
      downloading: false,
      error: 'Download cancelado'
    }));
  } catch (error) {
    console.error('[Offline Store] Failed to cancel download:', error);
  }
}

/**
 * Clear all cached data
 */
async function clearAllCache() {
  if (!browser) return;

  try {
    await clearCacheSW();
    
    // Invalidate local PDFs cache
    invalidateCachedPDFsLocal();
    
    // Clear localStorage
    // Tenta remover todas as chaves de uma vez, mesmo que alguma falhe no meio:
    // seis removeItem crus em sequência abortavam no primeiro que lançasse e
    // deixavam o resto de pé (ex.: ALLOW_OFFLINE_KEY limpa mas categorias
    // baixadas intactas, fazendo o app achar que não tem permissão de offline
    // e mesmo assim continuar listando categorias como baixadas).
    const { removed, failed } = safeRemoveMany([
      ALLOW_OFFLINE_KEY,
      CACHED_PDFS_KEY,
      LAST_MANIFEST_HASH_KEY,
      SELECTED_CATEGORIES_KEY,
      DOWNLOADED_CATEGORIES_KEY,
      OFFLINE_CATEGORIAS_SALVAS
    ]);
    if (failed.length > 0) {
      const total = removed.length + failed.length;
      const erro = new Error(
        `Erro ao limpar cache: ${removed.length} de ${total} chaves removidas`
      );
      erro.failed = failed;
      throw erro;
    }
    // Sem PDFs no cache, retomar um download interrompido não faz sentido.
    clearAllCompletedParts(safeStorage());
    
    // Reset state
    offlineState.set(initialState);
    
    console.log('[Offline Store] All cache cleared');
  } catch (error) {
    console.error('[Offline Store] Failed to clear cache:', error);
    throw error;
  }
}

/**
 * Show offline modal
 */
function showOfflineModal() {
  offlineState.update(state => ({ ...state, showModal: true }));
}

/**
 * Hide offline modal
 */
function hideOfflineModal() {
  offlineState.update(state => ({ ...state, showModal: false }));
}

/**
 * Enable offline mode
 */
function enableOffline() {
  if (browser) {
    safeSet(ALLOW_OFFLINE_KEY, 'true');
  }
  offlineState.update(state => ({ ...state, enabled: true }));
}

/**
 * Disable offline mode
 */
async function disableOffline() {
  await clearAllCache();
}

/**
 * Clear error message
 */
function clearError() {
  offlineState.update(state => ({ ...state, error: null }));
}

// Lazy initialization - não inicializar automaticamente
// Será inicializado explicitamente na página /offline quando necessário
let isInitialized = false;

/**
 * Lazy initialization function - must be called explicitly
 */
async function lazyInitialize() {
  if (!browser || isInitialized) {
    return;
  }
  isInitialized = true;
  await initialize();
}

/**
 * Validate and clear error if it's no longer relevant
 * Checks if there are actually missing PDFs and clears error if not
 */
async function validateAndClearError() {
  if (!browser) return;
  
  try {
    const state = get(offlineState);
    if (!state.error) {
      return; // No error to validate
    }
    
    // Reload cached PDFs to get latest state
    await loadCachedPdfsList();
    const updatedState = get(offlineState);
    /**
     * @type {any[]}
     */
    const cachedPdfs = updatedState.cachedPdfs || [];
    /**
     * @type {any[]}
     */
    const louvoresData = get(louvores);
    
    if (!louvoresData || louvoresData.length === 0) {
      return;
    }
    
    // Check if there are actually any missing PDFs
    const allCategories = [...new Set(louvoresData.map(l => l.categoria).filter(Boolean))];
    let hasAnyMissing = false;
    let totalMissing = 0;
    
    for (const category of allCategories) {
      const categoryLouvores = louvoresData.filter(l => l.categoria === category);
      const missing = identifyMissingPdfs(categoryLouvores, cachedPdfs);
      if (missing.length > 0) {
        hasAnyMissing = true;
        totalMissing += missing.length;
      }
    }
    
    // Clear error if no PDFs are actually missing
    if (!hasAnyMissing) {
      offlineState.update(s => ({
        ...s,
        error: null
      }));
      console.log('[Offline Store] Error cleared - no PDFs are actually missing');
    } else {
      // Update error message with accurate count if different
      const currentError = state.error;
      const expectedError = `${totalMissing} PDFs não foram encontrados nos pacotes selecionados.`;
      
      // Only update if the count is significantly different (more than 10% difference)
      if (currentError && !currentError.includes(String(totalMissing))) {
        // Check if the error message contains a number
        const errorMatch = currentError.match(/(\d+)\s+PDFs/);
        if (errorMatch) {
          const errorCount = parseInt(errorMatch[1], 10);
          const difference = Math.abs(errorCount - totalMissing);
          const percentDifference = (difference / Math.max(errorCount, totalMissing)) * 100;
          
          // Update if difference is more than 10%
          if (percentDifference > 10) {
            offlineState.update(s => ({
              ...s,
              error: expectedError
            }));
            console.log(`[Offline Store] Error message updated: ${errorCount} -> ${totalMissing} missing PDFs`);
          }
        }
      }
    }
  } catch (error) {
    console.error('[Offline Store] Error validating error message:', error);
  }
}

/**
 * Validate and sync all statistics to ensure consistency
 * This function:
 * 1. Reloads cached PDFs
 * 2. Recalculates all category stats
 * 3. Recalculates downloaded categories
 * 4. Verifies consistency between stats and downloaded categories
 * 5. Fixes inconsistencies automatically
 * 6. Clears errors if no PDFs are actually missing
 * 
 * @returns {Promise<{stats: Object, downloaded: string[], fixed: boolean}>}
 */
async function validateAndSyncStats() {
  if (!browser) {
    return { stats: {}, downloaded: [], fixed: false };
  }
  
  try {
    console.log('[Offline Store] Starting validation and sync...');
    
    // 1. Reload PDFs in cache
    await loadCachedPdfsList();
    
    // 2. Get updated state
    const updatedState = get(offlineState);
    /**
     * @type {any[]}
     */
    const cachedPdfs = updatedState.cachedPdfs || [];
    /**
     * @type {any[]}
     */
    const louvoresData = get(louvores);
    
    if (!louvoresData || louvoresData.length === 0) {
      return { stats: {}, downloaded: [], fixed: false };
    }
    
    // 3. Recalculate all category stats
    const allStats = {};
    const categories = [...new Set(louvoresData.map(l => l.categoria).filter(Boolean))];
    
    for (const category of categories) {
      allStats[category] = await getCategoryAvailabilityStats(category, louvoresData, cachedPdfs);
    }
    
    // 4. Recalculate downloaded categories
    // #22.4: getCompletelyDownloadedCategories verifica direto no Cache Storage para todas as categorias
    const downloaded = await getCompletelyDownloadedCategories(louvoresData, cachedPdfs);
    
    // 5. Verify consistency and fix if needed
    let fixed = false;
    const correctedDownloaded = [...downloaded];
    
    for (const category of categories) {
      const stats = allStats[category];
      const isDownloaded = downloaded.includes(category);
      const isActuallyComplete = stats.percentage === 100 && stats.missing === 0;
      
      if (isDownloaded !== isActuallyComplete) {
        console.warn(`[Sync] Inconsistency detected for ${category}: marked as ${isDownloaded ? 'downloaded' : 'not downloaded'}, but actually ${isActuallyComplete ? 'complete' : 'incomplete'} (${stats.missing} missing)`);
        
        // Fix: if marked as downloaded but not actually complete, remove from list
        if (isDownloaded && !isActuallyComplete) {
          const index = correctedDownloaded.indexOf(category);
          if (index > -1) {
            correctedDownloaded.splice(index, 1);
            fixed = true;
            console.log(`[Sync] Fixed: Removed ${category} from downloaded list (has ${stats.missing} missing PDFs)`);
          }
        }
        // Fix: if actually complete but not marked, add to list
        else if (!isDownloaded && isActuallyComplete) {
          correctedDownloaded.push(category);
          fixed = true;
          console.log(`[Sync] Fixed: Added ${category} to downloaded list (100% complete)`);
        }
      }
    }
    
    // 6. Save corrected downloaded categories if fixed
    if (fixed) {
      saveDownloadedCategories(correctedDownloaded);
    }
    
    // 7. Clear error if no PDFs are actually missing
    const hasAnyMissing = Object.values(allStats).some(s => s.missing > 0);
    if (!hasAnyMissing && updatedState.error) {
      offlineState.update(s => ({
        ...s,
        error: null
      }));
      fixed = true;
      console.log('[Sync] Fixed: Cleared error message (no PDFs are actually missing)');
    }
    
    // 8. Update state with new stats if available
    if (Object.keys(allStats).length > 0) {
      // Stats will be updated by the page component when it calls loadCategoryStats
      // We just return them here for reference
    }
    
    console.log('[Offline Store] Validation and sync completed', { fixed, downloadedCount: correctedDownloaded.length });
    
    return {
      stats: allStats,
      downloaded: correctedDownloaded,
      fixed
    };
  } catch (error) {
    console.error('[Offline Store] Error during validation and sync:', error);
    return { stats: {}, downloaded: [], fixed: false };
  }
}

/**
 * Check and update downloaded categories based on current cache storage
 * IMPORTANT: This function verifies PDFs in cache storage, NOT ZIP files.
 * ZIP files are removed from cache after extraction, so we check if all PDFs
 * from a category are present in the cache storage.
 * Uses OFFLINE_CATEGORIAS_SALVAS flag to store the list of saved categories.
 * 
 * FIX: Now uses strict validation for problematic categories.
 */
async function checkAndUpdateDownloadedCategories() {
  if (!browser) return [];

  try {
    /**
     * @type {string | any[]}
     */
    const louvoresData = get(louvores);
    if (!louvoresData || louvoresData.length === 0) {
      return getDownloadedCategories();
    }

    // Load cached PDFs from cache storage (NOT ZIPs - ZIPs are removed after extraction)
    const state = get(offlineState);
    /**
     * @type {string | any[]}
     */
    let cachedPdfs = state.cachedPdfs;
    
    if (!cachedPdfs || cachedPdfs.length === 0) {
      try {
        cachedPdfs = await getCachedPDFsFast();
        offlineState.update(s => ({
          ...s,
          cachedPdfs,
          cachedCount: cachedPdfs.length
        }));
      } catch (error) {
        console.error('[Offline Store] Failed to load cached PDFs:', error);
        return getDownloadedCategories();
      }
    }

    // Check which categories are completely downloaded (all PDFs are in cache storage)
    // This verifies PDFs, not ZIPs, since ZIPs are removed after extraction
    // #22.4: verificação direta no Cache Storage para todas as categorias
    const completelyDownloaded = await getCompletelyDownloadedCategories(louvoresData, cachedPdfs);
    
    // Save to OFFLINE_CATEGORIAS_SALVAS flag
    saveDownloadedCategories(completelyDownloaded);
    
    return completelyDownloaded;
  } catch (error) {
    console.error('[Offline Store] Failed to check downloaded categories:', error);
    return getDownloadedCategories();
  }
}

/**
 * Force revalidation of a specific category
 * This clears the category from the downloaded list and revalidates it
 * Useful for fixing inconsistent states, especially for categories with many
 * same-named files.
 *
 * @param {string} category - Category name to revalidate
 * @returns {Promise<boolean>} - true if category is actually downloaded, false otherwise
 */
async function forceRevalidateCategory(category) {
  if (!browser || !category) {
    return false;
  }

  try {
    console.log(`[Offline Store] Force revalidating category: ${category}`);
    
    // Remove category from downloaded list temporarily
    const currentDownloaded = getDownloadedCategories();
    const filteredDownloaded = currentDownloaded.filter((/** @type {string} */ cat) => cat !== category);
    saveDownloadedCategories(filteredDownloaded);
    
    // Reload cached PDFs to ensure we have the latest state
    await loadCachedPdfsList();
    
    // Get updated state
    const state = get(offlineState);
    /**
     * @type {never[]}
     */
    const cachedPdfs = state.cachedPdfs || [];
    /**
     * @type {string | any[]}
     */
    const louvoresData = get(louvores);
    
    if (!louvoresData || louvoresData.length === 0) {
      return false;
    }
    
    // #22.4: revalida com verificação direta no Cache Storage — o modo
    // estrito é o único modo agora, não há mais quarto argumento.
    const isDownloaded = await isCategoryCompletelyDownloaded(category, cachedPdfs, louvoresData);
    
    // Update downloaded categories list
    if (isDownloaded) {
      const updatedDownloaded = [...new Set([...filteredDownloaded, category])];
      saveDownloadedCategories(updatedDownloaded);
      console.log(`[Offline Store] Category "${category}" revalidated: DOWNLOADED`);
    } else {
      saveDownloadedCategories(filteredDownloaded);
      console.log(`[Offline Store] Category "${category}" revalidated: NOT DOWNLOADED`);
    }
    
    return isDownloaded;
  } catch (error) {
    console.error(`[Offline Store] Error force revalidating category "${category}":`, error);
    return false;
  }
}

/**
 * Update offline state directly (for use by DownloadManager)
 * @param {Object} updates - State updates
 */
function updateOfflineState(updates) {
  offlineState.update(state => ({
    ...state,
    ...updates
  }));
}

// Export store and methods
export const offline = {
  subscribe: offlineState.subscribe,
  downloadByCategories,
  cancelDownload,
  clearAllCache,
  showOfflineModal,
  hideOfflineModal,
  enableOffline,
  disableOffline,
  clearError,
  loadCachedPdfsList,
  checkForNewPDFs,
  getSavedCategories,
  saveCategories,
  getDownloadedCategories,
  checkAndUpdateDownloadedCategories,
  fetchOfflineManifest,
  identifyMissingPdfs,
  findRequiredPackagesForMissing,
  downloadMissingPackages,
  getCategoryAvailabilityStats,
  getRequiredPackagesInfo,
  validateAndClearError,
  validateAndSyncStats,
  forceRevalidateCategory,
  lazyInitialize, // Export lazy initialization function
  updateState: updateOfflineState // Export state update function for DownloadManager
};

// Derived store for offline status
export const isOfflineEnabled = derived(
  offlineState,
  $state => $state.enabled && $state.cachedCount > 0
);

// Derived store for download status
export const isDownloading = derived(
  offlineState,
  $state => $state.downloading || $state.autoDownloading
);

