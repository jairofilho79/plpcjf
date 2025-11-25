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
import { unzip } from 'fflate';
import { louvores } from './louvores';
import { validateManifestsIntegrity } from '$lib/utils/manifestValidation';
import { CATEGORY_OPTIONS } from './filters';
import { atobUTF8 } from '$lib/utils/pathUtils';
import { findMissingPdfs, findRequiredPackages } from '$lib/utils/pdfValidation';
import { getConfig } from '$lib/offline/core/OfflineConfig.js';
import { 
  encodeUrlUtf8, 
  decodeUrlUtf8, 
  encodeUrlComponentUtf8, 
  decodeUrlComponentUtf8, 
  createUrlUtf8,
  decodeUrlUtf8Multiple
} from '$lib/utils/urlEncoding.js';

const ALLOW_OFFLINE_KEY = 'ALLOW_OFFLINE';
const CACHED_PDFS_KEY = 'cachedPdfsList';
const LAST_MANIFEST_HASH_KEY = 'lastManifestHash';
const SELECTED_CATEGORIES_KEY = 'selectedCategoriesForDownload';
const DOWNLOADED_CATEGORIES_KEY = 'downloadedCategories';
const OFFLINE_CATEGORIAS_SALVAS = 'OFFLINE_CATEGORIAS_SALVAS';
const OFFLINE_MANIFEST_KEY = 'offlineManifest';

const PACKAGES_BASE_PATH = '/packages';
// Use centralized cache name from OfflineConfig - ensures consistency across all code
const DEFAULT_PDF_CACHE_FALLBACK = getConfig('PDF_CACHE_NAME') || 'plpc-pdfs';
/**
 * @type {AbortController | null}
 */
let zipDownloadController = null;
let isZipDownloadActive = false;
let zipDownloadCancelled = false;

/**
 * Normalize category name - aggregates subcategories into main category
 * Maps "Cifra nível I" and "Cifra nível II" to "Cifra"
 * @param {string} category - Category name to normalize
 * @returns {string} Normalized category name
 */
function normalizeCategory(category) {
  if (!category) return category;
  if (category === 'Cifra nível I' || category === 'Cifra nível II') {
    return 'Cifra';
  }
  return category;
}

/**
 * Get all categories that should be aggregated into a normalized category
 * @param {string} normalizedCategory - Normalized category name
 * @returns {string[]} Array of category names that map to this normalized category
 */
function getCategoryVariants(normalizedCategory) {
  if (normalizedCategory === 'Cifra') {
    return ['Cifra', 'Cifra nível I', 'Cifra nível II'];
  }
  return [normalizedCategory];
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
  error: null, // Error message
  autoDownloading: false, // Auto-downloading new PDFs
  offlineManifest: null, // Offline manifest data
  categorySizes: {}, // Map of category -> total size in bytes
  downloadPhase: 'idle', // Current download phase: 'idle' | 'downloading' | 'storing' | 'complete'
  phaseProgress: 0, // Progress of current phase (0-100)
  currentPackage: 0, // Current package being processed (1-indexed)
  totalPackages: 0 // Total number of packages to download
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

async function openPdfCache() {
  if (!browser || typeof caches === 'undefined') {
    throw new Error('Caches API nao esta disponivel neste ambiente');
  }

  // Always use the configured cache name to ensure consistency
  // Don't search for any cache ending with '-pdfs' as this can cause mismatches
  return caches.open(DEFAULT_PDF_CACHE_FALLBACK);
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
 * Prepare ZIP entry name for cache storage (preserves case and accents)
 * CRITICAL: Does NOT normalize (no lowercase, no accent removal) - only prepares path format
 * @param {string} entryName
 */
function normalizeZipEntryName(entryName) {
  if (!entryName) {
    return '';
  }

  // Prepare path preserving original case and accents
  // Only do basic preparation: remove protocol, trim slashes, decode URI, normalize separators, ensure assets/ prefix
  let prepared = entryName.replace(/^https?:\/\/[^/]+/, '');
  prepared = prepared.replace(/^\/+/, '').replace(/\/+$/, '');
  
  // Decode URI encoding (handle multiple encodings) but preserve case and accents
  // Use UTF-8 explicit decoding
  try {
    if (prepared.includes('%')) {
      prepared = decodeUrlUtf8Multiple(prepared, 3);
    }
  } catch {
    // If decoding fails, continue with original
  }
  
  // Normalize path separators (Windows vs Unix)
  prepared = prepared.replace(/\\/g, '/');
  
  // Ensure starts with 'assets/' (case-insensitive check, but preserve original case)
  if (!prepared.toLowerCase().startsWith('assets/')) {
    prepared = `assets/${prepared}`;
  }
  
  if (!prepared || prepared.endsWith('/')) {
    return '';
  }

  // Return with leading slash for consistency with existing cache storage format
  return `/${prepared}`;
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
 * Download ZIP packages with specific parts only (optimized)
 * @param {Array} categories - Categories to download
 * @param {Array} pdfUrls - All PDF URLs for validation
 * @param {Object} partsByCategory - Map of category -> array of specific parts to download
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
  // Use original PDF URLs for comparison (no normalization)
  // Prepare paths for comparison (remove leading slash, preserve case and accents)
  const prepareForComparison = (/** @type {string} */ url) => {
    const path = url.replace(/^\/+/, '');
    return path || '';
  };
  
  // Create sets for comparison using original paths
  const pdfSet = new Set(pdfUrls.map(prepareForComparison));
  const pdfSetOriginal = new Set(pdfUrls); // Keep original for exact match
  const remainingSet = new Set(pdfUrls.map(prepareForComparison));
  let completed = 0;

  offlineState.update(state => ({
    ...state,
    downloading: true,
    autoDownloading: false,
    progress: total === 0 ? 100 : 0,
    completed: 0,
    failed: 0,
    total,
    selectedCategories: categories,
    error: null
  }));

  try {
    const cache = await openPdfCache();

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

      // Baixar apenas as partes necessárias
      for (const part of requiredParts) {
        if (zipDownloadCancelled) {
          throw new Error('DOWNLOAD_CANCELLED');
        }

        const packageUrl = part.url.startsWith('/') ? part.url : `${PACKAGES_BASE_PATH}/${part.filename}`;
        let response;

        try {
          response = await fetch(packageUrl, {
            signal: zipDownloadController.signal,
            cache: 'no-store'
          });
        } catch (err) {
          if (zipDownloadCancelled || err?.name === 'AbortError') {
            throw new Error('DOWNLOAD_CANCELLED');
          }
          throw err;
        }

        if (!response.ok) {
          throw new Error(`Falha ao baixar o pacote ${part.filename} (${response.status})`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const entries = await unzipEntries(new Uint8Array(arrayBuffer));
        const entryNames = Object.keys(entries);

        for (const entryName of entryNames) {
          if (zipDownloadCancelled) {
            throw new Error('DOWNLOAD_CANCELLED');
          }

          const preparedPath = normalizeZipEntryName(entryName);

          if (!preparedPath || !preparedPath.endsWith('.pdf')) {
            delete entries[entryName];
            continue;
          }

          // Prepare path for comparison (remove leading slash, preserve case and accents)
          const pathForComparison = prepareForComparison(preparedPath);
          
          // Só cachear se o PDF está na lista de PDFs necessários
          // Check both prepared and original sets for maximum compatibility
          const isInSet = pdfSet.has(pathForComparison) || 
                         pdfSetOriginal.has(preparedPath) ||
                         pdfSetOriginal.has(preparedPath.replace(/^\/+/, '')) ||
                         Array.from(pdfSetOriginal).some(url => {
                           const urlPrepared = prepareForComparison(url);
                           return urlPrepared === pathForComparison ||
                                  urlPrepared.endsWith(pathForComparison) ||
                                  pathForComparison.endsWith(urlPrepared);
                         });
          
          const isInRemaining = remainingSet.has(pathForComparison) ||
                                Array.from(remainingSet).some(rem => {
                                  return rem === pathForComparison ||
                                         rem.endsWith(pathForComparison) ||
                                         pathForComparison.endsWith(rem);
                                });
          
          if (!isInSet || !isInRemaining) {
            delete entries[entryName];
            continue;
          }

          const fileData = entries[entryName];
          delete entries[entryName];

          if (!fileData) {
            continue;
          }

          const pdfBlob = new Blob([fileData], { type: 'application/pdf' });
          const requestUrl = createUrlUtf8(preparedPath, location.origin);
          const pdfResponse = new Response(pdfBlob, {
            headers: { 'Content-Type': 'application/pdf' }
          });

          await cache.put(new Request(requestUrl), pdfResponse);

          remainingSet.delete(pathForComparison);
          completed++;

          const progress = total === 0 ? 100 : Math.min(99, Math.floor((completed / total) * 100));

          offlineState.update(state => ({
            ...state,
            completed,
            failed: 0,
            progress
          }));

        }

        // Remove o arquivo ZIP do cache após processar todos os PDFs
        const fullPackageUrl = createUrlUtf8(packageUrl, location.origin);
        await removeZipFromCache(fullPackageUrl);
      }
    }

    if (zipDownloadCancelled) {
      throw new Error('DOWNLOAD_CANCELLED');
    }

    const failed = remainingSet.size;
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
      error: errorMessage
    }));

    if (!zipDownloadCancelled) {
      localStorage.setItem(ALLOW_OFFLINE_KEY, 'true');
      /**
       * @type {string | any[]}
       */
      const louvoresData = get(louvores);
      if (louvoresData && louvoresData.length > 0) {
        const currentHash = getManifestHash(louvoresData);
        localStorage.setItem(LAST_MANIFEST_HASH_KEY, currentHash);
        
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
      error: error.message === 'DOWNLOAD_CANCELLED' 
        ? 'Download cancelado pelo usuário.' 
        : error.message || 'Erro ao baixar pacotes ZIP.'
    }));
  } finally {
    isZipDownloadActive = false;
    zipDownloadController = null;
  }
}

/**
 * @param {Uint8Array<ArrayBufferLike>} buffer
 */
function unzipEntries(buffer) {
  return new Promise((resolve, reject) => {
    unzip(buffer, (err, data) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(data || {});
    });
  });
}

/**
 * Get saved selected categories from localStorage
 */
function getSavedCategories() {
  if (!browser) return [];
  try {
    const saved = localStorage.getItem(SELECTED_CATEGORIES_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Save selected categories to localStorage
 * @param {any} categories
 */
function saveCategories(categories) {
  if (!browser) return;
  try {
    localStorage.setItem(SELECTED_CATEGORIES_KEY, JSON.stringify(categories));
  } catch (e) {
    console.error('[Offline Store] Failed to save categories:', e);
  }
}

/**
 * Get downloaded categories from localStorage
 * Uses OFFLINE_CATEGORIAS_SALVAS flag to store categories that are saved in cache storage
 */
function getDownloadedCategories() {
  if (!browser) return [];
  try {
    // First try the new flag
    const saved = localStorage.getItem(OFFLINE_CATEGORIAS_SALVAS);
    if (saved) {
      return JSON.parse(saved);
    }
    // Fallback to old key for migration
    const oldSaved = localStorage.getItem(DOWNLOADED_CATEGORIES_KEY);
    if (oldSaved) {
      const categories = JSON.parse(oldSaved);
      // Migrate to new key
      localStorage.setItem(OFFLINE_CATEGORIAS_SALVAS, oldSaved);
      return categories;
    }
    return [];
  } catch (e) {
    console.error('[Offline Store] Failed to get downloaded categories:', e);
    return [];
  }
}

/**
 * Save downloaded categories to localStorage
 * Uses OFFLINE_CATEGORIAS_SALVAS flag to store categories that are saved in cache storage
 * @param {any[]} categories
 */
function saveDownloadedCategories(categories) {
  if (!browser) return;
  try {
    localStorage.setItem(OFFLINE_CATEGORIAS_SALVAS, JSON.stringify(categories));
    // Also save to old key for backward compatibility
    localStorage.setItem(DOWNLOADED_CATEGORIES_KEY, JSON.stringify(categories));
  } catch (e) {
    console.error('[Offline Store] Failed to save downloaded categories:', e);
  }
}

/**
 * Verify if a PDF actually exists in Cache Storage
 * This performs a real check in the cache, not just in the list
 * @param {string | URL} pdfUrl
 */
async function verifyPdfInCacheStorage(pdfUrl) {
  if (!browser || typeof caches === 'undefined') {
    return false;
  }
  
  try {
    const cache = await openPdfCache();
    
    // CRITICAL: Cache stores with URL encoding (new URL() does automatic encoding)
    // So we must try with URL encoding FIRST to match what's actually stored
    // Ensure pdfUrl is a string
    const pdfUrlStr = typeof pdfUrl === 'string' ? pdfUrl : String(pdfUrl);
    
    const urlVariations = [
      // Try with URL encoding first (as stored in cache by new URL())
      new URL(pdfUrlStr, location.origin).toString(),
      // Also try with explicit encoding
      new URL(encodeURI(pdfUrlStr), location.origin).toString(),
      // Try path with leading slash and encoding
      new URL(pdfUrlStr.startsWith('/') ? pdfUrlStr : `/${pdfUrlStr}`, location.origin).toString(),
      // Fallback: try without encoding (for compatibility)
      pdfUrlStr.startsWith('/') ? pdfUrlStr : `/${pdfUrlStr}`,
      pdfUrlStr.replace(/^\/+/, ''),
      pdfUrlStr
    ];
    
    for (const url of urlVariations) {
      try {
        const request = new Request(url);
        const response = await cache.match(request);
        if (response) {
          return true;
        }
      } catch (e) {
        // Continue to next variation
      }
    }
    
    return false;
  } catch (error) {
    console.warn(`[Offline Store] Error verifying PDF in cache: ${pdfUrl}`, error);
    return false;
  }
}

/**
 * Check if a category is completely downloaded (all PDFs are in cache storage)
 * IMPORTANT: This checks PDFs in cache storage, NOT ZIP files.
 * ZIP files are removed from cache after extraction, so we verify PDFs directly.
 * Uses unified normalization function for consistency.
 * 
 * FIX: Added strict validation mode for problematic categories like "Gestos em Gravura"
 * that verifies directly in Cache Storage to avoid false positives from filename matching.
 * FIX: Now handles category normalization - aggregates "Cifra nível I" and "Cifra nível II" into "Cifra"
 * @param {string} category
 * @param {any[]} cachedPdfs
 * @param {any[]} louvoresData
 */
async function isCategoryCompletelyDownloaded(category, cachedPdfs, louvoresData, strictMode = false) {
  if (!category || !louvoresData || !cachedPdfs) {
    return false;
  }

  // Normalize category name - aggregate subcategories
  const normalizedCategory = normalizeCategory(category);
  
  // Get all PDFs for this category and its variants (e.g., for "Cifra" include "Cifra nível I" and "Cifra nível II")
  const categoryVariants = getCategoryVariants(normalizedCategory);
  const categoryLouvores = louvoresData.filter((/** @type {{ categoria: any; }} */ louvor) => 
    categoryVariants.includes(louvor.categoria)
  );
  
  if (categoryLouvores.length === 0) {
    return false;
  }

  // FIX: For "Gestos em Gravura", always use strict mode to avoid false positives
  // This category has many PDFs with the same filename, causing validation issues
  if (category === 'Gestos em Gravura') {
    strictMode = true;
  }

  // Use original paths for comparison (no normalization)
  // Create set of cached PDFs using original paths
  const cachedPdfsSet = new Set(
    cachedPdfs.map((/** @type {string} */ url) => {
      // Prepare path (remove leading slash for comparison)
      const path = url.replace(/^\/+/, '');
      return path;
    })
  );

  // Track unique PDFs found for counting validation
  const foundPdfs = new Set();
  let missingCount = 0;

  // Check if all PDFs for this category are in cache
  for (const louvor of categoryLouvores) {
    const pdfUrl = getPdfUrl(louvor);
    if (!pdfUrl) {
      continue;
    }

    // Prepare PDF URL for comparison (remove leading slash, preserve original case and accents)
    const pdfPath = pdfUrl.replace(/^\/+/, '');

    // CRITICAL: Always verify directly in Cache Storage first
    // The cache stores with URL encoding, so direct verification is most reliable
    let isCached = false;
    
    // Primary strategy: Direct verification in Cache Storage (most reliable)
    // This handles URL encoding correctly and doesn't use normalization
    const existsInCache = await verifyPdfInCacheStorage(pdfUrl);
    if (existsInCache) {
      isCached = true;
      foundPdfs.add(pdfPath);
    }
    
    // Fallback strategies: Use original path comparison only if direct verification fails
    // This provides compatibility with old cache entries or edge cases
    if (!isCached && !strictMode) {
      // Strategy 1: Exact match in cached list
      if (cachedPdfsSet.has(pdfPath)) {
        isCached = true;
        foundPdfs.add(pdfPath);
      }
      
      // Strategy 2: Partial match (check if any cached path ends with expected path)
      if (!isCached) {
        isCached = Array.from(cachedPdfsSet).some(cached => {
          // Check if paths match (handling different URL formats)
          if (cached === pdfPath) return true;
          // Only accept if cached path ends with expected path (not vice versa)
          if (cached.endsWith(pdfPath)) return true;
          
          // Check filename match only if paths are similar
          const cachedFilename = cached.split('/').pop();
          const expectedFilename = pdfPath.split('/').pop();
          if (cachedFilename && expectedFilename && cachedFilename === expectedFilename) {
            // Additional check: paths should be similar (same directory structure)
            const cachedDir = cached.replace(cachedFilename, '');
            const expectedDir = pdfPath.replace(expectedFilename, '');
            if (cachedDir && expectedDir && cachedDir.includes(expectedDir)) {
              return true;
            }
          }
          
          return false;
        });
        
        if (isCached) {
          foundPdfs.add(pdfPath);
        }
      }
    }

    if (!isCached) {
      missingCount++;
      if (missingCount <= 3) { // Log first 3 missing PDFs to avoid spam
        console.warn(`[Offline Store] PDF not found in cache: ${pdfUrl}`);
        if (strictMode) {
          console.warn(`[Offline Store] Strict mode: verified directly in cache storage - NOT FOUND`);
        }
      }
    }
  }

  // FIX: Additional validation - count unique PDFs found vs expected
  const expectedCount = categoryLouvores.filter((/** @type {any} */ l) => getPdfUrl(l)).length;
  const foundCount = foundPdfs.size;
  
  // FIX: Tolerância de 99% - considerar completa se tiver 99% ou mais dos PDFs
  // Isso evita marcar como incompleta categorias que estão praticamente completas
  // (ex: 1631/1633 = 99.88% deve ser considerada completa)
  const COMPLETION_THRESHOLD = 0.99; // 99%
  const completionPercentage = foundCount / expectedCount;
  
  if (completionPercentage < COMPLETION_THRESHOLD) {
    console.warn(`[Offline Store] Category "${category}": Found ${foundCount}/${expectedCount} PDFs (${(completionPercentage * 100).toFixed(2)}%). Marking as incomplete.`);
    return false;
  }
  
  // Log success for debugging
  if (completionPercentage >= COMPLETION_THRESHOLD) {
    if (foundCount === expectedCount) {
      console.log(`[Offline Store] Category "${normalizedCategory}": Strict validation passed - ${foundCount} PDFs verified.`);
    } else {
      console.log(`[Offline Store] Category "${normalizedCategory}": ${(completionPercentage * 100).toFixed(2)}% complete (${foundCount}/${expectedCount} PDFs). Marking as complete.`);
    }
  }

  // Invalidate stats cache for the normalized category after validation completes
  // This ensures UI updates with fresh stats
  try {
    const { invalidateCategory } = await import('$lib/utils/statsCache');
    invalidateCategory(normalizedCategory);
    
    // Also invalidate in StatsCalculator if available
    try {
      const { default: statsCalculator } = await import('$lib/offline/stats/StatsCalculator.js');
      statsCalculator.invalidateCategory(normalizedCategory);
    } catch (e) {
      // Ignore if StatsCalculator not available
    }
  } catch (e) {
    // Ignore errors in stats invalidation - not critical
    console.debug('[Offline Store] Could not invalidate stats cache:', e);
  }

  return true;
}

/**
 * Get list of completely downloaded categories
 * FIX: Now normalizes categories - aggregates "Cifra nível I" and "Cifra nível II" into "Cifra"
 * @param {any[]} louvoresData
 * @param {any[]} cachedPdfs
 */
async function getCompletelyDownloadedCategories(louvoresData, cachedPdfs) {
  if (!louvoresData || !cachedPdfs || louvoresData.length === 0) {
    return [];
  }

  // Get all unique categories and normalize them
  const allCategories = [...new Set(louvoresData.map((/** @type {{ categoria: any; }} */ l) => l.categoria).filter(Boolean))];
  const normalizedCategories = [...new Set(allCategories.map(cat => normalizeCategory(cat)))];
  
  const downloadedCategories = [];

  // Check each normalized category (this will aggregate subcategories)
  for (const normalizedCategory of normalizedCategories) {
    // Check if all variants of this normalized category are downloaded
    // We check using the normalized category name, which will aggregate subcategories
    const isDownloaded = await isCategoryCompletelyDownloaded(normalizedCategory, cachedPdfs, louvoresData);
    if (isDownloaded) {
      downloadedCategories.push(normalizedCategory);
    }
  }

  return downloadedCategories;
}

/**
 * Check for new PDFs and auto-download if enabled
 */
async function checkForNewPDFs() {
  if (!browser) return;

  const allowOffline = localStorage.getItem(ALLOW_OFFLINE_KEY) === 'true';
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
  const lastHash = localStorage.getItem(LAST_MANIFEST_HASH_KEY);

  // First time or manifest changed
  if (lastHash && lastHash !== currentHash) {
    console.log('[Offline Store] Manifest changed, checking for new PDFs');
    
    const state = get(offlineState);
    /**
     * @type {any[]}
     */
    const cachedPdfs = state.cachedPdfs;
    
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
      
      return !cachedPdfs.some(cached => cached.includes(pdfUrl));
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
  localStorage.setItem(LAST_MANIFEST_HASH_KEY, currentHash);
}

/**
 * Get PDF URL from louvor object
 * @param {{ pdfId: any; }} louvor
 */
function getPdfUrl(louvor) {
  if (!louvor || !louvor.pdfId) {
    return null;
  }
  
  try {
    // CRÍTICO: Usar atobUTF8 (UTF-8), NÃO atob() (latin-1)
    // pdfId está codificado em base64 UTF-8, não latin-1
    const decoded = atobUTF8(louvor.pdfId);
    // normaliza removendo barras iniciais
    let path = decoded.replace(/^\/+/, '').trim();
    
    if (!path) {
      return null;
    }
    
    // assegura prefixo assets/
    if (!path.toLowerCase().startsWith('assets/')) {
      path = `assets/${path}`;
    }
    
    return `/${path}`;
  } catch (e) {
    console.error('[Offline Store] Failed to decode pdfId:', e);
    return null;
  }
}

/**
 * Identifies missing PDFs by comparing louvores-manifest.json with cache
 * @param {Array} louvoresData - Array of louvor objects
 * @param {Array} cachedPdfs - Array of cached PDF URLs
 * @returns {Array} - Array of louvor objects with missing PDFs
 */
function identifyMissingPdfs(louvoresData, cachedPdfs) {
  return findMissingPdfs(louvoresData, cachedPdfs);
}

/**
 * Finds required packages based on missing PDFs and offline manifest
 * @param {Array} missingPdfs - Array of louvor objects with missing PDFs
 * @param {Object} offlineManifest - Offline manifest object
 * @returns {Array} - Array of package parts that need to be downloaded
 */
function findRequiredPackagesForMissing(missingPdfs, offlineManifest) {
  return findRequiredPackages(missingPdfs, offlineManifest);
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

// FASE 3: Cache de memoização removido - agora usando StatsCalculator
// Função mantida apenas para compatibilidade com código existente
function clearStatsCalculationCache() {
  // StatsCalculator gerencia seu próprio cache
  // Esta função é mantida para compatibilidade mas não faz nada
}

/**
 * Get availability statistics for a category
 * FASE 4: Delegado para StatsCalculator
 * @param {string} category - Category name
 * @param {Array} louvoresData - All louvores
 * @param {Array} cachedPdfs - Cached PDF URLs
 * @returns {Promise<{total: number, available: number, missing: number, percentage: number}>}
 */
async function getCategoryAvailabilityStats(category, louvoresData, cachedPdfs) {
  // Usar StatsCalculator que já gerencia cache e otimizações
  const { default: statsCalculator } = await import('$lib/offline/stats/StatsCalculator.js');
  return await statsCalculator.getCategoryStats(category, {
    louvoresData,
    cachedPdfs,
    useCache: true
  });
}

/**
 * Get required packages info for selected categories
 * @param {Array} categories - Selected categories
 * @param {Array} louvoresData - All louvores
 * @param {Array} cachedPdfs - Cached PDF URLs
 * @param {Object} manifest - Offline manifest
 * @returns {Promise<{totalParts: number, totalSize: number, partsByCategory: Object}>}
 */
async function getRequiredPackagesInfo(categories, louvoresData, cachedPdfs, manifest) {
  if (!categories || categories.length === 0 || !manifest) {
    return { totalParts: 0, totalSize: 0, partsByCategory: {} };
  }

  // Get all category variants (e.g., for "Cifra" include "Cifra nível I" and "Cifra nível II")
  const categoryVariantsMap = new Map();
  categories.forEach(cat => {
    const normalized = normalizeCategory(cat);
    const variants = getCategoryVariants(normalized);
    categoryVariantsMap.set(normalized, variants);
  });
  
  const allCategoryVariants = Array.from(categoryVariantsMap.values()).flat();
  const filteredLouvores = louvoresData.filter(l => allCategoryVariants.includes(l.categoria));
  const missingPdfs = identifyMissingPdfs(filteredLouvores, cachedPdfs);
  const requiredParts = findRequiredPackagesForMissing(missingPdfs, manifest);

  const partsByCategory = {};
  let totalSize = 0;

  for (const part of requiredParts) {
    // Normalize category name when grouping parts
    const normalizedCategory = normalizeCategory(part.category);
    if (!partsByCategory[normalizedCategory]) {
      partsByCategory[normalizedCategory] = [];
    }
    partsByCategory[normalizedCategory].push(part);
    totalSize += part.size || 0;
  }

  return {
    totalParts: requiredParts.length,
    totalSize,
    partsByCategory
  };
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
  // Use original PDF URLs for comparison (no normalization)
  // Prepare paths for comparison (remove leading slash, preserve case and accents)
  const prepareForComparison = (/** @type {string} */ url) => {
    const path = url.replace(/^\/+/, '');
    return path || '';
  };
  
  // Create sets for comparison using original paths
  const pdfSet = new Set(pdfUrls.map(prepareForComparison));
  const pdfSetOriginal = new Set(pdfUrls); // Keep original for exact match
  const remainingSet = new Set(pdfUrls.map(prepareForComparison));
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

  offlineState.update(state => ({
    ...state,
    downloading: true,
    autoDownloading: false,
    progress: total === 0 ? 100 : 0,
    completed: 0,
    failed: 0,
    total,
    selectedCategories: categories,
    error: null
  }));

  try {
    const cache = await openPdfCache();

    for (const category of categories) {
      if (zipDownloadCancelled) {
        throw new Error('DOWNLOAD_CANCELLED');
      }

      // Get all package parts for this category from manifest
      const packageParts = getPackageParts(category, manifest);
      
      if (packageParts.length === 0) {
        console.warn(`[Offline Store] No package parts found for category ${category}`);
        continue;
      }

      // Download each part
      for (const part of packageParts) {
        if (zipDownloadCancelled) {
          throw new Error('DOWNLOAD_CANCELLED');
        }

        const packageUrl = part.url.startsWith('/') ? part.url : `${PACKAGES_BASE_PATH}/${part.filename}`;
        let response;

        try {
          response = await fetch(packageUrl, {
            signal: zipDownloadController.signal,
            cache: 'no-store'
          });
        } catch (err) {
          if (zipDownloadCancelled || err?.name === 'AbortError') {
            throw new Error('DOWNLOAD_CANCELLED');
          }
          throw err;
        }

        if (!response.ok) {
          throw new Error(`Falha ao baixar o pacote ${part.filename} (${response.status})`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const entries = await unzipEntries(new Uint8Array(arrayBuffer));
        const entryNames = Object.keys(entries);

        for (const entryName of entryNames) {
          if (zipDownloadCancelled) {
            throw new Error('DOWNLOAD_CANCELLED');
          }

          const preparedPath = normalizeZipEntryName(entryName);

          if (!preparedPath || !preparedPath.endsWith('.pdf')) {
            delete entries[entryName];
            continue;
          }

          // Prepare path for comparison (remove leading slash, preserve case and accents)
          const pathForComparison = prepareForComparison(preparedPath);
          
          // Só cachear se o PDF está na lista de PDFs necessários
          // Check both prepared and original sets for maximum compatibility
          const isInSet = pdfSet.has(pathForComparison) || 
                         pdfSetOriginal.has(preparedPath) ||
                         pdfSetOriginal.has(preparedPath.replace(/^\/+/, '')) ||
                         Array.from(pdfSetOriginal).some(url => {
                           const urlPrepared = prepareForComparison(url);
                           return urlPrepared === pathForComparison ||
                                  urlPrepared.endsWith(pathForComparison) ||
                                  pathForComparison.endsWith(urlPrepared);
                         });
          
          const isInRemaining = remainingSet.has(pathForComparison) ||
                                Array.from(remainingSet).some(rem => {
                                  return rem === pathForComparison ||
                                         rem.endsWith(pathForComparison) ||
                                         pathForComparison.endsWith(rem);
                                });
          
          if (!isInSet || !isInRemaining) {
            delete entries[entryName];
            continue;
          }

          const fileData = entries[entryName];
          delete entries[entryName];

          if (!fileData) {
            continue;
          }

          const pdfBlob = new Blob([fileData], { type: 'application/pdf' });
          const requestUrl = createUrlUtf8(preparedPath, location.origin);
          const pdfResponse = new Response(pdfBlob, {
            headers: { 'Content-Type': 'application/pdf' }
          });

          await cache.put(new Request(requestUrl), pdfResponse);

          remainingSet.delete(pathForComparison);
          completed++;

          const progress = total === 0 ? 100 : Math.min(99, Math.floor((completed / total) * 100));

          offlineState.update(state => ({
            ...state,
            completed,
            failed: 0,
            progress
          }));

        }

        // Remove o arquivo ZIP do cache após processar todos os PDFs
        const fullPackageUrl = createUrlUtf8(packageUrl, location.origin);
        await removeZipFromCache(fullPackageUrl);
      }
    }

    if (zipDownloadCancelled) {
      throw new Error('DOWNLOAD_CANCELLED');
    }

    const failed = remainingSet.size;
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
      error: errorMessage
    }));

    if (!zipDownloadCancelled) {
      localStorage.setItem(ALLOW_OFFLINE_KEY, 'true');
      /**
       * @type {string | any[]}
       */
      const louvoresData = get(louvores);
      if (louvoresData && louvoresData.length > 0) {
        const currentHash = getManifestHash(louvoresData);
        localStorage.setItem(LAST_MANIFEST_HASH_KEY, currentHash);
        
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

      // Check if IS_LEITOR_OFFLINE flag exists, if not open PDF in leitor
      const isLeitorOffline = localStorage.getItem('IS_LEITOR_OFFLINE');
      if (!isLeitorOffline || isLeitorOffline !== 'true') {
        // Open offline-setup.pdf in leitor to set the flag
        const leitorUrl = '/leitor?file=/offline-setup.pdf&titulo=Configuração Offline&subtitulo=Página de funcionamento';
        window.open(leitorUrl, '_blank', 'noopener');
      }
    }
  } catch (error) {
    if (error?.message === 'DOWNLOAD_CANCELLED' || error?.name === 'AbortError') {
      offlineState.update(state => ({
        ...state,
        downloading: false,
        error: 'Download cancelado'
      }));
    } else {
      console.error('[Offline Store] Zip download error:', error);
      offlineState.update(state => ({
        ...state,
        downloading: false,
        error: error?.message || 'Erro ao baixar pacotes ZIP'
      }));
    }
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
  const missingPdfs = identifyMissingPdfs(filteredLouvores, cachedPdfs);
  
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

  // Check if IS_LEITOR_OFFLINE flag exists, if not open PDF in leitor
  const isLeitorOffline = localStorage.getItem('IS_LEITOR_OFFLINE');
  if (!isLeitorOffline || isLeitorOffline !== 'true') {
    // Open offline-setup.pdf in leitor to set the flag
    const leitorUrl = '/leitor?file=/offline-setup.pdf&titulo=Configuração Offline&subtitulo=Página de funcionamento';
    window.open(leitorUrl, '_blank', 'noopener');
  }

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
    localStorage.removeItem(ALLOW_OFFLINE_KEY);
    localStorage.removeItem(CACHED_PDFS_KEY);
    localStorage.removeItem(LAST_MANIFEST_HASH_KEY);
    localStorage.removeItem(SELECTED_CATEGORIES_KEY);
    localStorage.removeItem(DOWNLOADED_CATEGORIES_KEY);
    localStorage.removeItem(OFFLINE_CATEGORIAS_SALVAS);
    
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
    localStorage.setItem(ALLOW_OFFLINE_KEY, 'true');
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
    // FIX: getCompletelyDownloadedCategories now automatically uses strict mode for Gestos em Gravura
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
    // FIX: Uses strict mode for Gestos em Gravura automatically
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
 * Useful for fixing inconsistent states, especially for "Gestos em Gravura"
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
    
    // Revalidate with strict mode (always use strict for revalidation)
    const isDownloaded = await isCategoryCompletelyDownloaded(category, cachedPdfs, louvoresData, true);
    
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


