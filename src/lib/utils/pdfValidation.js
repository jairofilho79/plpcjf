// PDF Validation Utility
// Validates PDF availability and identifies missing PDFs

import { getCachedPDFsFast, waitForServiceWorker, downloadPDFsViaSW, invalidateCachedPDFsLocal, getCachedPDFs } from '$lib/utils/swRegistration';
import { getPdfRelPath } from '$lib/utils/pathUtils';
import { isPdfAvailableInIndex } from '$lib/utils/pdfIndex';
import compositeValidator from '$lib/offline/validation/CompositeValidator.js';
import cacheStorageAdapter from '$lib/offline/storage/CacheStorageAdapter.js';
import { createUrlUtf8, decodeUrlUtf8Multiple } from '$lib/utils/urlEncoding.js';

// Cache de validação de PDFs - Fase 2
const VALIDATION_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas
const VALIDATION_CACHE_PREFIX = 'pdfValidation_';

/**
 * Verifica conectividade efetiva com a rede (não apenas navigator.onLine).
 * Usa endpoint que o SW força para rede/no-store.
 *
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<boolean>}
 */
export async function checkEffectiveConnectivity(options = {}) {
  const timeoutMs = Number.isFinite(options?.timeoutMs) ? options.timeoutMs : 1500;
  const browserOnline = typeof navigator !== 'undefined' ? navigator.onLine : false;
  if (browserOnline === false) {
    return false;
  }
  if (typeof window === 'undefined') {
    return false;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('/louvores-manifest.sha256', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal
    });
    return !!res && res.ok;
  } catch {
    // Fallback: avoid false-offline when the probe endpoint is temporarily unavailable.
    return browserOnline === true;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Obtém resultado de validação do cache
 * @param {string} pdfId - PDF ID (base64)
 * @returns {{available: boolean, url: string} | null} - Resultado do cache ou null se não encontrado/expirado
 */
export function getCachedValidation(pdfId) {
  if (!pdfId) return null;
  
  try {
    const key = `${VALIDATION_CACHE_PREFIX}${pdfId}`;
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    
    const { available, timestamp, url } = JSON.parse(cached);
    const age = Date.now() - timestamp;
    
    if (age > VALIDATION_CACHE_TTL) {
      localStorage.removeItem(key);
      return null;
    }
    
    return { available, url };
  } catch (error) {
    console.warn('[PDF Validation Cache] Error reading cache:', error);
    return null;
  }
}

/**
 * Armazena resultado de validação no cache
 * @param {string} pdfId - PDF ID (base64)
 * @param {{available: boolean, url: string}} result - Resultado da validação
 */
export function cacheValidation(pdfId, result) {
  if (!pdfId || !result) return;
  
  try {
    const key = `${VALIDATION_CACHE_PREFIX}${pdfId}`;
    localStorage.setItem(key, JSON.stringify({
      available: result.available,
      url: result.url,
      timestamp: Date.now()
    }));
  } catch (error) {
    console.warn('[PDF Validation Cache] Error writing cache:', error);
    // Se localStorage estiver cheio, tentar limpar entradas antigas
    if (error.name === 'QuotaExceededError') {
      clearExpiredValidationCache();
    }
  }
}

/**
 * Limpa cache de validação expirado
 */
function clearExpiredValidationCache() {
  try {
    const now = Date.now();
    const keysToRemove = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(VALIDATION_CACHE_PREFIX)) {
        try {
          const cached = localStorage.getItem(key);
          if (cached) {
            const { timestamp } = JSON.parse(cached);
            if (now - timestamp > VALIDATION_CACHE_TTL) {
              keysToRemove.push(key);
            }
          }
        } catch {
          // Se não conseguir parsear, remover
          keysToRemove.push(key);
        }
      }
    }
    
    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch (error) {
    console.warn('[PDF Validation Cache] Error clearing expired cache:', error);
  }
}

/**
 * Invalida cache de validação para um PDF específico
 * @param {string} pdfId - PDF ID (base64)
 */
export function invalidateValidationCache(pdfId) {
  if (!pdfId) return;
  
  try {
    const key = `${VALIDATION_CACHE_PREFIX}${pdfId}`;
    localStorage.removeItem(key);
  } catch (error) {
    console.warn('[PDF Validation Cache] Error invalidating cache:', error);
  }
}

/**
 * Limpa todo o cache de validação
 */
export function clearAllValidationCache() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(VALIDATION_CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch (error) {
    console.warn('[PDF Validation Cache] Error clearing all cache:', error);
  }
}

/**
 * Validates PDF availability with fast optimization using index and validation cache
 * Checks cache first, then index, then falls back to full validation if needed
 * @param {string} pdfPath - Relative path of the PDF
 * @param {string} pdfId - Optional PDF ID for cache and index lookup
 * @returns {Promise<{available: boolean, needsDownload: boolean, url: string}>}
 */
export async function validatePdfAvailabilityFast(pdfPath, pdfId = null) {
  if (!pdfPath) {
    return { available: false, needsDownload: false, url: null };
  }

  const normalizedPath = pdfPath.startsWith('/') ? pdfPath.substring(1) : pdfPath;
  const fullUrl = createUrlUtf8(`/${normalizedPath}`, window.location.origin);

  // Strategy 1: Check validation cache (if PDF ID is provided) - Fase 2
  if (pdfId) {
    const cached = getCachedValidation(pdfId);
    if (cached) {
      const effectiveOnline = await checkEffectiveConnectivity({ timeoutMs: 1000 });
      return {
        available: cached.available,
        needsDownload: !cached.available && effectiveOnline,
        url: cached.url || fullUrl
      };
    }
  }

  // Strategy 2: Use CompositeValidator with optimized options
  const result = await compositeValidator.validate(normalizedPath, {
    useIndex: true,
    checkNetwork: false, // Skip network for fast validation
    pdfId: pdfId
  });
  
  // Convert ValidationResult to legacy format
  const legacyResult = {
    available: result.available,
    needsDownload: result.needsDownload,
    url: result.url || fullUrl
  };
  
  // Cache the result if PDF ID is provided
  if (pdfId && legacyResult.url) {
    cacheValidation(pdfId, { available: legacyResult.available, url: legacyResult.url });
  }
  
  return legacyResult;
}

/**
 * Validates if a PDF is available in cache
 * @param {string} pdfPath - Relative path of the PDF (ex: "assets/ColAdultos/001.pdf")
 * @param {string} pdfId - Optional PDF ID for caching results
 * @returns {Promise<{available: boolean, needsDownload: boolean, url: string}>}
 */
export async function validatePdfAvailability(pdfPath, pdfId = null) {
  if (!pdfPath) {
    return { available: false, needsDownload: false, url: null };
  }

  // Normalize path (remove leading slash if present)
  const normalizedPath = pdfPath.startsWith('/') ? pdfPath.substring(1) : pdfPath;
  const fullUrl = createUrlUtf8(`/${normalizedPath}`, window.location.origin);

  // Wait for Service Worker to be ready (reduzido para 500ms para melhor performance)
  const swReady = await waitForServiceWorker(500);
  if (!swReady) {
    console.warn('[PDF Validation] Service Worker not ready, but allowing check to proceed');
    // Não retornar false imediatamente - tentar verificar cache mesmo assim
  }

  try {
    const effectiveOnline = await checkEffectiveConnectivity({ timeoutMs: 1500 });
    // Use CompositeValidator with full validation (cache + network)
    const result = await compositeValidator.validate(normalizedPath, {
      useIndex: true,
      checkNetwork: effectiveOnline,
      pdfId: pdfId
    });
    
    // Convert ValidationResult to legacy format
    const legacyResult = {
      available: result.available,
      needsDownload: result.needsDownload,
      url: result.url || fullUrl
    };
    
    // Cache the result if PDF ID is provided
    if (pdfId && legacyResult.url) {
      cacheValidation(pdfId, { available: legacyResult.available, url: legacyResult.url });
    }
    
    // Debug: Log when PDF is not found (only for first few misses to avoid spam)
    if (!legacyResult.available) {
      if (!validatePdfAvailability._missCount) {
        validatePdfAvailability._missCount = 0;
      }
      if (validatePdfAvailability._missCount < 3) {
        validatePdfAvailability._missCount++;
        console.warn(`[PDF Validation] PDF not found: ${pdfPath}`);
        console.warn(`[PDF Validation] Source: ${result.source}`);
      }
    }
    
    return legacyResult;
  } catch (error) {
    console.error('[PDF Validation] Error:', error);
    const result = { available: false, needsDownload: false, url: fullUrl };
    // Do not cache negative results on transient validation failures.
    return result;
  }
}

/**
 * Ensures PDF is available before navigation
 * @param {string} pdfPath - Path of the PDF
 * @returns {Promise<boolean>} - true if available, false otherwise
 */
export async function ensurePdfAvailable(pdfPath) {
  const validation = await validatePdfAvailability(pdfPath);

  if (validation.available) {
    return true;
  }

  const effectiveOnline = await checkEffectiveConnectivity({ timeoutMs: 1500 });
  if (validation.needsDownload && effectiveOnline) {
    // Try to download automatically
    try {
      console.log('[PDF Validation] Attempting auto-download:', validation.url);
      await downloadPDFsViaSW([validation.url], 1, (progress) => {
        if (progress.completed > 0) {
          console.log('[PDF Validation] Auto-download completed');
        }
      });
      
      // Wait a bit for SW to process
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Verify it was cached
      const recheck = await validatePdfAvailability(pdfPath);
      return recheck.available;
    } catch (err) {
      console.error('[PDF Validation] Auto-download failed:', err);
    }
  }

  return false;
}

/**
 * Finds missing PDFs by comparing louvores with cached PDFs
 * @param {Array} louvores - Array of louvor objects
 * @param {Array} cachedPdfs - Array of cached PDF URLs
 * @returns {Array} - Array of louvor objects with missing PDFs
 */
export function findMissingPdfs(louvores, cachedPdfs) {
  const detailed = findMissingPdfsDetailed(louvores, cachedPdfs);
  return detailed.confirmedMissing;
}

/**
 * Finds missing PDFs with deterministic states.
 * Separates confirmed missing from unresolved/unknown items.
 *
 * @param {Array} louvores - Array of louvor objects
 * @param {Array} cachedPdfs - Array of cached PDF URLs
 * @returns {{confirmedMissing: Array, unknown: Array}}
 */
export function findMissingPdfsDetailed(louvores, cachedPdfs) {
  if (!louvores || !Array.isArray(louvores) || louvores.length === 0) {
    return { confirmedMissing: [], unknown: [] };
  }

  if (!cachedPdfs || !Array.isArray(cachedPdfs)) {
    // Unknown cache state: avoid claiming confirmed missing without a real cache snapshot.
    return {
      confirmedMissing: [],
      unknown: louvores.filter(l => l.pdfId)
    };
  }

  // Prepare cached PDFs for comparison
  // Extract pathname from full URLs, decode URL encoding, and preserve exact paths (no normalization)
  const cachedPdfsSet = new Set();
  
  cachedPdfs.forEach(url => {
    try {
      // Extract pathname from full URL
      let pathname = '';
      try {
        const urlObj = new URL(url);
        pathname = urlObj.pathname;
      } catch {
        // If URL parsing fails, try to extract path manually
        // Remove protocol and domain
        const match = url.match(/https?:\/\/[^\/]+(\/.*)/);
        if (match) {
          pathname = match[1];
        } else {
          // Assume it's already a path
          pathname = url;
        }
      }
      
      // Remove leading slash
      pathname = pathname.replace(/^\/+/, '');
      
      if (!pathname) {
        return;
      }
      
      // Decode URL encoding to get the actual saved path (preserve accents, case, etc.)
      // Do NOT normalize - we need the exact path as saved
      const decodedPath = decodeUrlUtf8Multiple(pathname, 3);
      
      // Add decoded path to set
      cachedPdfsSet.add(decodedPath);
      
      // Also add filename-only for matching
      const filename = decodedPath.split('/').pop();
      if (filename) {
        cachedPdfsSet.add(filename);
      }
    } catch (error) {
      // If processing fails, try to add the original URL as fallback
      console.warn('[PDF Validation] Error processing cached URL:', url, error);
      const fallbackPath = url.replace(/^\/+/, '').replace(/^https?:\/\/[^\/]+/, '');
      if (fallbackPath) {
        cachedPdfsSet.add(fallbackPath);
      }
    }
  });

  const confirmedMissing = [];
  const debugInfo = []; // Collect debug info for first few misses

  for (const louvor of louvores) {
    if (!louvor.pdfId) {
      continue;
    }

    const pdfPath = getPdfRelPath(louvor);
    if (!pdfPath) {
      continue;
    }

    // Use original path for comparison (no normalization)
    // Remove leading slash only - preserve exact path as from getPdfRelPath
    const pdfPathForComparison = pdfPath.replace(/^\/+/, '');
    
    // Check multiple matching strategies (all using decoded, non-normalized paths)
    let isCached = false;
    
    // Strategy 1: Exact match (decoded cached path vs expected path)
    if (cachedPdfsSet.has(pdfPathForComparison)) {
      isCached = true;
    }
    
    // Strategy 2: Filename match (handle different directory structures)
    if (!isCached) {
      const filename = pdfPathForComparison.split('/').pop();
      if (filename && cachedPdfsSet.has(filename)) {
        isCached = true;
      }
    }
    
    // Strategy 3: Partial match (check if any decoded cached path matches expected path)
    if (!isCached) {
      isCached = Array.from(cachedPdfsSet).some(cached => {
        // Exact match
        if (cached === pdfPathForComparison) return true;
        
        // Check if cached path ends with expected path (handles nested directory structures)
        if (cached.endsWith(pdfPathForComparison)) return true;
        
        // Check if expected path ends with cached path (handles reverse case)
        if (pdfPathForComparison.endsWith(cached)) return true;
        
        // Check filename match (exact, no normalization)
        const cachedFilename = cached.split('/').pop();
        const expectedFilename = pdfPathForComparison.split('/').pop();
        if (cachedFilename && expectedFilename && cachedFilename === expectedFilename) {
          return true;
        }
        
        return false;
      });
    }

    if (!isCached) {
      confirmedMissing.push(louvor);
      
      // Collect debug info for first 10 missing PDFs
      if (debugInfo.length < 10) {
        debugInfo.push({
          louvor: louvor.nome || louvor.pdfId,
          expectedPath: pdfPath,
          sampleCached: Array.from(cachedPdfsSet).slice(0, 3)
        });
      }
    }
  }

  // Log debug info if there are missing PDFs (only log once per unique count to reduce console spam)
  // Use a simple cache to track what we've already logged
  if (confirmedMissing.length > 0 && debugInfo.length > 0) {
    // Only log if this is a new count or significant change
    const cacheKey = `missing_${confirmedMissing.length}_${louvores.length}`;
    if (!findMissingPdfs._lastLog || findMissingPdfs._lastLog !== cacheKey) {
      findMissingPdfs._lastLog = cacheKey;
      console.warn(`[PDF Validation] Found ${confirmedMissing.length} confirmed missing PDFs. Sample debug info:`, debugInfo);
    }
  }

  return {
    confirmedMissing,
    unknown: []
  };
}

/**
 * Finds required packages based on missing PDFs and offline manifest
 * @param {Array} missingPdfs - Array of louvor objects with missing PDFs
 * @param {Object} offlineManifest - Offline manifest object
 * @returns {Array} - Array of package parts that need to be downloaded
 */
export function findRequiredPackages(missingPdfs, offlineManifest) {
  if (!missingPdfs || missingPdfs.length === 0) {
    return [];
  }

  if (!offlineManifest || !offlineManifest.packages) {
    return [];
  }

  // Create set of missing pdfIds for fast lookup
  const missingPdfIds = new Set(missingPdfs.map(l => l.pdfId).filter(Boolean));

  if (missingPdfIds.size === 0) {
    return [];
  }

  const requiredParts = [];

  // Iterate through packages
  for (const [category, packageData] of Object.entries(offlineManifest.packages)) {
    if (!packageData.parts || !Array.isArray(packageData.parts)) {
      continue;
    }

    // Check each part
    for (const part of packageData.parts) {
      if (!part.pdfs || !Array.isArray(part.pdfs)) {
        continue;
      }

      // Check if this part contains any missing PDFs
      const hasMissingPdf = part.pdfs.some(pdfId => missingPdfIds.has(pdfId));

      if (hasMissingPdf) {
        requiredParts.push({
          category,
          filename: part.filename,
          url: part.url,
          size: part.size || 0,
          pdfs: part.pdfs.filter(pdfId => missingPdfIds.has(pdfId))
        });
      }
    }
  }

  return requiredParts;
}

/**
 * Finds missing PDFs using IndexedDB as the canonical source of truth.
 *
 * Preferred over findMissingPdfs() because it avoids Cache API URL parsing
 * and is deterministic: only blobs persisted in IndexedDB count as available.
 *
 * @param {Array} louvores - Array of louvor objects
 * @returns {Promise<Array>} Louvores whose PDFs are not in IndexedDB
 */
export async function findMissingPdfsFromInventory(louvores) {
  const { default: offlineInventoryRepository } = await import(
    '$lib/offline/storage/OfflineInventoryRepository.js'
  );
  return offlineInventoryRepository.findMissingPdfs(louvores);
}

/**
 * Validates PDF availability using multiple strategies
 * @param {Object} louvor - Louvor object
 * @param {Function} indexCheck - Function to check index (optional)
 * @returns {Promise<{available: boolean, needsDownload: boolean, url: string, method: string}>}
 */
export async function validatePdfWithStrategies(louvor, indexCheck = null) {
  if (!louvor || !louvor.pdfId) {
    return { available: false, needsDownload: false, url: null, method: 'none' };
  }

  // Strategy 1: Quick index check (if available)
  if (indexCheck && typeof indexCheck === 'function') {
    const indexResult = indexCheck(louvor.pdfId);
    if (indexResult === false) {
      // Index says not available
      return { available: false, needsDownload: navigator.onLine, url: null, method: 'index' };
    }
    // If index says available or null, continue to full validation
  }

  // Strategy 2: Full cache validation using CompositeValidator
  const pdfPath = getPdfRelPath(louvor);
  if (!pdfPath) {
    return { available: false, needsDownload: false, url: null, method: 'validation' };
  }

  const validation = await compositeValidator.validate(pdfPath, {
    useIndex: true,
    checkNetwork: navigator.onLine,
    pdfId: louvor.pdfId
  });
  
  return {
    available: validation.available,
    needsDownload: validation.needsDownload,
    url: validation.url || null,
    method: validation.source === 'cache' ? 'cache' : validation.source === 'index' ? 'index' : 'validation'
  };
}

