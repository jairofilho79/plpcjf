// Offline Store - Manages offline mode state and PDF caching
import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import {
  downloadPDFsViaSW,
  cancelDownload as cancelDownloadSW,
  getCachedPDFs,
  clearCache as clearCacheSW,
  isServiceWorkerReady,
  waitForServiceWorker
} from '$lib/utils/swRegistration';
import { unzip } from 'fflate';
import { louvores } from './louvores';
import { CATEGORY_OPTIONS } from './filters';
import { atobUTF8 } from '$lib/utils/pathUtils';

const ALLOW_OFFLINE_KEY = 'ALLOW_OFFLINE';
const CACHED_PDFS_KEY = 'cachedPdfsList';
const LAST_MANIFEST_HASH_KEY = 'lastManifestHash';
const SELECTED_CATEGORIES_KEY = 'selectedCategoriesForDownload';
const DOWNLOADED_CATEGORIES_KEY = 'downloadedCategories';
const OFFLINE_CATEGORIAS_SALVAS = 'OFFLINE_CATEGORIAS_SALVAS';
const OFFLINE_MANIFEST_KEY = 'offlineManifest';

const PACKAGES_BASE_PATH = '/packages';
const DEFAULT_PDF_CACHE_FALLBACK = 'plpc-v2-pdfs';
let zipDownloadController = null;
let isZipDownloadActive = false;
let zipDownloadCancelled = false;

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
  categorySizes: {} // Map of category -> total size in bytes
};

const offlineState = writable(initialState);

/**
 * Fetch offline manifest from backend
 */
async function fetchOfflineManifest() {
  try {
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
 */
async function loadCachedPdfsList() {
  try {
    const cachedUrls = await getCachedPDFs();
    
    offlineState.update(state => ({
      ...state,
      cachedPdfs: cachedUrls,
      cachedCount: cachedUrls.length,
      enabled: cachedUrls.length > 0
    }));
    
    // Save to localStorage for quick access
    if (browser) {
      localStorage.setItem(CACHED_PDFS_KEY, JSON.stringify(cachedUrls));
    }
  } catch (error) {
    console.error('[Offline Store] Failed to load cached PDFs:', error);
  }
}

/**
 * Get hash of manifest for change detection
 */
function getManifestHash(louvoresData) {
  const sortedPdfs = louvoresData
    .map(l => l.pdfId || l.pdf)
    .sort()
    .join('|');
  return sortedPdfs;
}

async function openPdfCache() {
  if (!browser || typeof caches === 'undefined') {
    throw new Error('Caches API nao esta disponivel neste ambiente');
  }

  const cacheKeys = await caches.keys();
  const pdfCacheKey = cacheKeys.find(key => key.endsWith('-pdfs'));

  if (pdfCacheKey) {
    return caches.open(pdfCacheKey);
  }

  return caches.open(DEFAULT_PDF_CACHE_FALLBACK);
}

/**
 * Remove arquivo ZIP do cache após descompactação
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

function normalizeZipEntryName(entryName) {
  if (!entryName) {
    return '';
  }

  const normalized = entryName.trim().replace(/\\/g, '/').replace(/^\/+/, '');

  if (!normalized || normalized.endsWith('/')) {
    return '';
  }

  return `/${normalized}`;
}

function getPackageUrl(packageName) {
  return `${PACKAGES_BASE_PATH}/${packageName}`;
}

/**
 * Get package parts for a category from manifest
 */
function getPackageParts(category, manifest) {
  if (!manifest || !manifest.packages || !manifest.packages[category]) {
    return [];
  }
  return manifest.packages[category].parts || [];
}

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
 * Normalize URL for comparison (remove protocol and domain)
 */
function normalizeUrlForComparison(url) {
  if (!url) return '';
  // Remove protocol and domain, keep only path
  let normalized = url.replace(/^https?:\/\/[^/]+/, '');
  // Ensure starts with /
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }
  // Remove trailing slashes (except root)
  normalized = normalized.replace(/\/+$/, '') || '/';
  return normalized.toLowerCase();
}

/**
 * Check if a category is completely downloaded (all PDFs are in cache storage)
 * IMPORTANT: This checks PDFs in cache storage, NOT ZIP files.
 * ZIP files are removed from cache after extraction, so we verify PDFs directly.
 */
async function isCategoryCompletelyDownloaded(category, cachedPdfs, louvoresData) {
  if (!category || !louvoresData || !cachedPdfs) {
    return false;
  }

  // Get all PDFs for this category
  const categoryLouvores = louvoresData.filter(louvor => louvor.categoria === category);
  
  if (categoryLouvores.length === 0) {
    return false;
  }

  // Normalize cached PDFs URLs for comparison
  const normalizedCachedPdfs = cachedPdfs.map(url => normalizeUrlForComparison(url));

  // Check if all PDFs for this category are in cache
  for (const louvor of categoryLouvores) {
    const pdfUrl = getPdfUrl(louvor);
    if (!pdfUrl) {
      continue;
    }

    // Normalize PDF URL for comparison
    const normalizedPdfUrl = normalizeUrlForComparison(pdfUrl);

    // Check if PDF is in cache
    const isCached = normalizedCachedPdfs.some(cached => {
      // Exact match
      if (cached === normalizedPdfUrl) {
        return true;
      }
      // Check if cached URL ends with PDF URL (handles full URLs vs relative paths)
      if (cached.endsWith(normalizedPdfUrl)) {
        return true;
      }
      // Check if PDF URL ends with cached URL (handles different path formats)
      if (normalizedPdfUrl.endsWith(cached)) {
        return true;
      }
      // Check if both URLs contain the same path segments
      const cachedSegments = cached.split('/').filter(s => s);
      const pdfSegments = normalizedPdfUrl.split('/').filter(s => s);
      if (cachedSegments.length > 0 && pdfSegments.length > 0) {
        // Check if the last segments match (filename)
        const cachedFilename = cachedSegments[cachedSegments.length - 1];
        const pdfFilename = pdfSegments[pdfSegments.length - 1];
        if (cachedFilename === pdfFilename && cachedFilename.endsWith('.pdf')) {
          return true;
        }
      }
      return false;
    });

    if (!isCached) {
      console.log(`[Offline Store] PDF not found in cache: ${pdfUrl} (normalized: ${normalizedPdfUrl})`);
      console.log(`[Offline Store] Cached PDFs (first 5):`, normalizedCachedPdfs.slice(0, 5));
      return false;
    }
  }

  return true;
}

/**
 * Get list of completely downloaded categories
 */
async function getCompletelyDownloadedCategories(louvoresData, cachedPdfs) {
  if (!louvoresData || !cachedPdfs || louvoresData.length === 0) {
    return [];
  }

  const categories = [...new Set(louvoresData.map(l => l.categoria).filter(Boolean))];
  const downloadedCategories = [];

  for (const category of categories) {
    const isDownloaded = await isCategoryCompletelyDownloaded(category, cachedPdfs, louvoresData);
    if (isDownloaded) {
      downloadedCategories.push(category);
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

  const louvoresData = get(louvores);
  if (!louvoresData || louvoresData.length === 0) return;

  const currentHash = getManifestHash(louvoresData);
  const lastHash = localStorage.getItem(LAST_MANIFEST_HASH_KEY);

  // First time or manifest changed
  if (lastHash && lastHash !== currentHash) {
    console.log('[Offline Store] Manifest changed, checking for new PDFs');
    
    const state = get(offlineState);
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
 */
function getPdfUrl(louvor) {
  if (!louvor || !louvor.pdfId) {
    return null;
  }
  
  try {
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
 * Start downloading PDFs
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
    const result = await downloadPDFsViaSW(pdfUrls, 10, (progressData) => {
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
      const louvoresData = get(louvores);
      const currentHash = getManifestHash(louvoresData);
      localStorage.setItem(LAST_MANIFEST_HASH_KEY, currentHash);
    }

    // Reload cached PDFs list
    await loadCachedPdfsList();

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
  const pdfSet = new Set(pdfUrls);
  const remainingSet = new Set(pdfUrls);
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

          const normalizedPath = normalizeZipEntryName(entryName);

          if (!normalizedPath || !normalizedPath.endsWith('.pdf')) {
            delete entries[entryName];
            continue;
          }

          if (!pdfSet.has(normalizedPath) || !remainingSet.has(normalizedPath)) {
            delete entries[entryName];
            continue;
          }

          const fileData = entries[entryName];
          delete entries[entryName];

          if (!fileData) {
            continue;
          }

          const pdfBlob = new Blob([fileData], { type: 'application/pdf' });
          const requestUrl = new URL(normalizedPath, location.origin).toString();
          const pdfResponse = new Response(pdfBlob, {
            headers: { 'Content-Type': 'application/pdf' }
          });

          await cache.put(new Request(requestUrl), pdfResponse);

          remainingSet.delete(normalizedPath);
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
        const fullPackageUrl = new URL(packageUrl, location.origin).toString();
        await removeZipFromCache(fullPackageUrl);
      }
    }

    if (zipDownloadCancelled) {
      throw new Error('DOWNLOAD_CANCELLED');
    }

    const failed = remainingSet.size;
    const finalCompleted = Math.min(completed, total - failed);
    const finalProgress = total === 0 ? 100 : Math.floor((finalCompleted / total) * 100);

    offlineState.update(state => ({
      ...state,
      downloading: false,
      progress: finalProgress,
      completed: finalCompleted,
      failed,
      error: failed > 0 ? `${failed} PDFs nao foram encontrados nos pacotes selecionados.` : null
    }));

    if (!zipDownloadCancelled) {
      localStorage.setItem(ALLOW_OFFLINE_KEY, 'true');
      const louvoresData = get(louvores);
      if (louvoresData && louvoresData.length > 0) {
        const currentHash = getManifestHash(louvoresData);
        localStorage.setItem(LAST_MANIFEST_HASH_KEY, currentHash);
      }

      // Reload cached PDFs list to get updated cache
      await loadCachedPdfsList();

      // Update downloaded categories list
      // After successful download, verify which categories are now completely downloaded
      const updatedState = get(offlineState);
      const updatedCachedPdfs = updatedState.cachedPdfs;
      
      if (updatedCachedPdfs && updatedCachedPdfs.length > 0 && louvoresData && louvoresData.length > 0) {
        // Check which categories are now completely downloaded
        const completelyDownloaded = await getCompletelyDownloadedCategories(louvoresData, updatedCachedPdfs);
        
        // Merge with already downloaded categories
        const currentDownloaded = getDownloadedCategories();
        const allDownloaded = [...new Set([...currentDownloaded, ...completelyDownloaded, ...alreadyDownloadedCategories])];
        saveDownloadedCategories(allDownloaded);
        
        console.log('[Offline Store] Updated downloaded categories:', allDownloaded);
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

async function downloadByCategories(categories) {
  if (!browser) return;

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

  // Load cached PDFs to check which categories are already downloaded
  const state = get(offlineState);
  let cachedPdfs = state.cachedPdfs;
  
  // If cached PDFs are not loaded, load them
  if (!cachedPdfs || cachedPdfs.length === 0) {
    try {
      cachedPdfs = await getCachedPDFs();
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

  // Check which categories are already completely downloaded
  const alreadyDownloadedCategories = [];
  const categoriesToDownload = [];

  for (const category of validCategories) {
    const isDownloaded = await isCategoryCompletelyDownloaded(category, cachedPdfs, louvoresData);
    if (isDownloaded) {
      alreadyDownloadedCategories.push(category);
      console.log(`[Offline Store] Category ${category} is already completely downloaded, skipping.`);
    } else {
      categoriesToDownload.push(category);
    }
  }

  // If all categories are already downloaded, show message and return
  if (categoriesToDownload.length === 0) {
    offlineState.update(state => ({
      ...state,
      downloading: false,
      progress: 100,
      completed: 0,
      failed: 0,
      total: 0,
      error: null
    }));
    console.log('[Offline Store] All selected categories are already downloaded.');
    // Update downloaded categories list
    const currentDownloaded = getDownloadedCategories();
    const updatedDownloaded = [...new Set([...currentDownloaded, ...alreadyDownloadedCategories])];
    saveDownloadedCategories(updatedDownloaded);
    return;
  }

  // Save selected categories for future auto-downloads (including already downloaded ones)
  saveCategories(validCategories);

  // Check if IS_LEITOR_OFFLINE flag exists, if not open PDF in leitor
  const isLeitorOffline = localStorage.getItem('IS_LEITOR_OFFLINE');
  if (!isLeitorOffline || isLeitorOffline !== 'true') {
    // Open offline-setup.pdf in leitor to set the flag
    const leitorUrl = '/leitor?file=/offline-setup.pdf&titulo=Configuração Offline&subtitulo=Página de funcionamento';
    window.open(leitorUrl, '_blank', 'noopener');
  }

  // Filter louvores by categories to download (excluding already downloaded)
  const filteredLouvores = louvoresData.filter(louvor =>
    categoriesToDownload.includes(louvor.categoria)
  );

  const pdfUrls = filteredLouvores.map(getPdfUrl).filter(url => url !== null);

  if (pdfUrls.length === 0) {
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

  console.log(`[Offline Store] Downloading ${pdfUrls.length} PDFs via ZIP packages for ${categoriesToDownload.length} categories (${alreadyDownloadedCategories.length} already downloaded)`);

  // Download only categories that are not already downloaded
  await startZipDownload(categoriesToDownload, pdfUrls, alreadyDownloadedCategories);
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

// Initialize on module load
if (browser) {
  initialize();
}

/**
 * Check and update downloaded categories based on current cache storage
 * IMPORTANT: This function verifies PDFs in cache storage, NOT ZIP files.
 * ZIP files are removed from cache after extraction, so we check if all PDFs
 * from a category are present in the cache storage.
 * Uses OFFLINE_CATEGORIAS_SALVAS flag to store the list of saved categories.
 */
async function checkAndUpdateDownloadedCategories() {
  if (!browser) return [];

  try {
    const louvoresData = get(louvores);
    if (!louvoresData || louvoresData.length === 0) {
      return getDownloadedCategories();
    }

    // Load cached PDFs from cache storage (NOT ZIPs - ZIPs are removed after extraction)
    const state = get(offlineState);
    let cachedPdfs = state.cachedPdfs;
    
    if (!cachedPdfs || cachedPdfs.length === 0) {
      try {
        cachedPdfs = await getCachedPDFs();
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
    const completelyDownloaded = await getCompletelyDownloadedCategories(louvoresData, cachedPdfs);
    
    // Save to OFFLINE_CATEGORIAS_SALVAS flag
    saveDownloadedCategories(completelyDownloaded);
    
    return completelyDownloaded;
  } catch (error) {
    console.error('[Offline Store] Failed to check downloaded categories:', error);
    return getDownloadedCategories();
  }
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
  getDownloadedCategories,
  checkAndUpdateDownloadedCategories,
  fetchOfflineManifest
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

