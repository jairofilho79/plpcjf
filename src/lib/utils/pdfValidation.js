// PDF Validation Utility
// Validates PDF availability and identifies missing PDFs

import { getCachedPDFsFast, waitForServiceWorker, downloadPDFsViaSW, invalidateCachedPDFsLocal, getCachedPDFs } from '$lib/utils/swRegistration';
import { getPdfRelPath, normalizePdfUrl } from '$lib/utils/pathUtils';
import { isPdfAvailableInIndex } from '$lib/utils/pdfIndex';

// Cache de validação de PDFs - Fase 2
const VALIDATION_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas
const VALIDATION_CACHE_PREFIX = 'pdfValidation_';

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
  const fullUrl = new URL(`/${normalizedPath}`, window.location.origin).href;

  // Strategy 1: Check validation cache (if PDF ID is provided) - Fase 2
  if (pdfId) {
    const cached = getCachedValidation(pdfId);
    if (cached) {
      return {
        available: cached.available,
        needsDownload: !cached.available && navigator.onLine,
        url: cached.url || fullUrl
      };
    }
  }

  // Strategy 2: Quick index check (if PDF ID is provided)
  if (pdfId) {
    const indexCheck = isPdfAvailableInIndex(pdfId);
    if (indexCheck === true) {
      // Index says available - trust it and return quickly
      // Cache the result for future use
      cacheValidation(pdfId, { available: true, url: fullUrl });
      return { available: true, needsDownload: false, url: fullUrl };
    } else if (indexCheck === false) {
      // Index says not available - check if can be downloaded
      // Cache the result for future use
      cacheValidation(pdfId, { available: false, url: fullUrl });
      return { available: false, needsDownload: navigator.onLine, url: fullUrl };
    }
    // If indexCheck is null, index doesn't have info - continue to full validation
  }

  // Strategy 3: Full validation (index unavailable or no PDF ID provided)
  const result = await validatePdfAvailability(pdfPath);
  
  // Cache the result if PDF ID is provided
  if (pdfId && result.url) {
    cacheValidation(pdfId, { available: result.available, url: result.url });
  }
  
  return result;
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
  const fullUrl = new URL(`/${normalizedPath}`, window.location.origin).href;

  // Wait for Service Worker to be ready (reduzido para 500ms para melhor performance)
  const swReady = await waitForServiceWorker(500);
  if (!swReady) {
    console.warn('[PDF Validation] Service Worker not ready, but allowing check to proceed');
    // Não retornar false imediatamente - tentar verificar cache mesmo assim
  }

  try {
    // Check cache via Service Worker (using fast version with local cache)
    let cachedPdfs = await getCachedPDFsFast();
    
    // Normalize target path using centralized function
    const normalizedTarget = normalizePdfUrl(normalizedPath);
    
    // Helper function to check if PDF is in cached set
    const checkPdfInCache = (pdfList) => {
      const normalizedCacheSet = new Set();
      pdfList.forEach(url => {
        const normalized = normalizePdfUrl(url);
        normalizedCacheSet.add(normalized);
        
        // Also add filename-only variation
        try {
          const urlObj = new URL(url);
          const filename = urlObj.pathname.split('/').pop();
          if (filename) {
            const normalizedFilename = normalizePdfUrl(filename);
            normalizedCacheSet.add(normalizedFilename);
          }
        } catch {
          const parts = url.split('/');
          const filename = parts[parts.length - 1];
          if (filename) {
            const normalizedFilename = normalizePdfUrl(filename);
            normalizedCacheSet.add(normalizedFilename);
          }
        }
      });
      
      // Check using same strategies as findMissingPdfs
      let isCached = false;
      
      // Strategy 1: Exact match
      if (normalizedCacheSet.has(normalizedTarget)) {
        isCached = true;
      }
      
      // Strategy 2: Filename match
      if (!isCached) {
        const filename = normalizedTarget.split('/').pop();
        if (filename && normalizedCacheSet.has(filename)) {
          isCached = true;
        }
      }
      
      // Strategy 3: Partial match (same logic as findMissingPdfs)
      if (!isCached) {
        isCached = Array.from(normalizedCacheSet).some(cached => {
          if (cached === normalizedTarget) return true;
          if (cached.endsWith(normalizedTarget)) return true;
          if (normalizedTarget.endsWith(cached)) return true;
          
          const cachedFilename = cached.split('/').pop();
          const expectedFilename = normalizedTarget.split('/').pop();
          if (cachedFilename && expectedFilename && cachedFilename === expectedFilename) {
            return true;
          }
          
          if (cachedFilename && expectedFilename) {
            const cachedBase = cachedFilename.replace(/\.pdf$/i, '');
            const expectedBase = expectedFilename.replace(/\.pdf$/i, '');
            if (cachedBase && expectedBase && cachedBase === expectedBase) {
              return true;
            }
          }
          
          return false;
        });
      }
      
      return { isCached, normalizedCacheSet };
    };
    
    // First check with cached list
    let { isCached, normalizedCacheSet } = checkPdfInCache(cachedPdfs);
    
    // If not found and we're using cached data, invalidate cache and try again
    // This fixes the issue where lazy loading might use stale cache
    if (!isCached && cachedPdfs.length > 0) {
      // Invalidate local cache to force fresh fetch from Service Worker
      invalidateCachedPDFsLocal();
      
      // Try again with fresh data from Service Worker
      cachedPdfs = await getCachedPDFs();
      const retryCheck = checkPdfInCache(cachedPdfs);
      isCached = retryCheck.isCached;
      normalizedCacheSet = retryCheck.normalizedCacheSet;
    }

    if (isCached) {
      const result = { available: true, needsDownload: false, url: fullUrl };
      // Cache the result if PDF ID is provided
      if (pdfId) {
        cacheValidation(pdfId, { available: true, url: fullUrl });
      }
      return result;
    }
    
    // Debug: Log when PDF is not found (only for first few misses to avoid spam)
    if (!validatePdfAvailability._missCount) {
      validatePdfAvailability._missCount = 0;
    }
    if (validatePdfAvailability._missCount < 3) {
      validatePdfAvailability._missCount++;
      console.warn(`[PDF Validation] PDF not found in cache: ${pdfPath} (normalized: ${normalizedTarget})`);
      console.warn(`[PDF Validation] Sample cached PDFs:`, Array.from(normalizedCacheSet).slice(0, 5));
      console.warn(`[PDF Validation] Total cached PDFs: ${cachedPdfs.length}`);
    }

    // If not in cache, check if it can be downloaded (online)
    if (navigator.onLine) {
      // Try HEAD request to verify if PDF exists
      try {
        const response = await fetch(fullUrl, { 
          method: 'HEAD', 
          cache: 'no-cache',
          signal: AbortSignal.timeout(5000) // 5 second timeout
        });
        if (response.ok) {
          return { available: false, needsDownload: true, url: fullUrl };
        }
      } catch (err) {
        // Network error or timeout - assume not available
        console.warn('[PDF Validation] Network check failed:', err);
      }
    }

    const result = { available: false, needsDownload: false, url: fullUrl };
    // Cache the result if PDF ID is provided
    if (pdfId) {
      cacheValidation(pdfId, { available: false, url: fullUrl });
    }
    return result;
  } catch (error) {
    console.error('[PDF Validation] Error:', error);
    const result = { available: false, needsDownload: false, url: fullUrl };
    // Don't cache errors, but cache negative results if PDF ID is provided
    if (pdfId && !error.message?.includes('timeout')) {
      cacheValidation(pdfId, { available: false, url: fullUrl });
    }
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

  if (validation.needsDownload && navigator.onLine) {
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
  if (!louvores || !Array.isArray(louvores) || louvores.length === 0) {
    return [];
  }

  if (!cachedPdfs || !Array.isArray(cachedPdfs)) {
    // If no cached PDFs, all are missing
    return louvores.filter(l => l.pdfId);
  }

  // Normalize cached PDFs for comparison - create multiple variations
  const normalizedCacheSet = new Set();
  const normalizedCacheVariations = new Map(); // Map normalized -> original for debugging
  
  cachedPdfs.forEach(url => {
    const normalized = normalizePdfUrl(url);
    normalizedCacheSet.add(normalized);
    normalizedCacheVariations.set(normalized, url);
    
    // Also add variations (filename only, without directory)
    try {
      const urlObj = new URL(url);
      const filename = urlObj.pathname.split('/').pop();
      if (filename) {
        const normalizedFilename = normalizePdfUrl(filename);
        normalizedCacheSet.add(normalizedFilename);
      }
    } catch {
      const parts = url.split('/');
      const filename = parts[parts.length - 1];
      if (filename) {
        const normalizedFilename = normalizePdfUrl(filename);
        normalizedCacheSet.add(normalizedFilename);
      }
    }
  });

  const missing = [];
  const debugInfo = []; // Collect debug info for first few misses

  for (const louvor of louvores) {
    if (!louvor.pdfId) {
      continue;
    }

    const pdfPath = getPdfRelPath(louvor);
    if (!pdfPath) {
      continue;
    }

    // Normalize expected path
    const normalizedPath = normalizePdfUrl(pdfPath);
    
    // Check multiple matching strategies
    let isCached = false;
    
    // Strategy 1: Exact match
    if (normalizedCacheSet.has(normalizedPath)) {
      isCached = true;
    }
    
    // Strategy 2: Filename match (handle different directory structures)
    if (!isCached) {
      const filename = normalizedPath.split('/').pop();
      if (filename && normalizedCacheSet.has(filename)) {
        isCached = true;
      }
    }
    
    // Strategy 3: Partial match (check if any cached path ends with expected path or vice versa)
    if (!isCached) {
      isCached = Array.from(normalizedCacheSet).some(cached => {
        // Check if paths match (handling different URL formats)
        if (cached === normalizedPath) return true;
        if (cached.endsWith(normalizedPath)) return true;
        if (normalizedPath.endsWith(cached)) return true;
        
        // Check filename match
        const cachedFilename = cached.split('/').pop();
        const expectedFilename = normalizedPath.split('/').pop();
        if (cachedFilename && expectedFilename && cachedFilename === expectedFilename) {
          return true;
        }
        
        // Check if both contain the same filename (handling encoding differences)
        if (cachedFilename && expectedFilename) {
          // Remove file extension and compare
          const cachedBase = cachedFilename.replace(/\.pdf$/i, '');
          const expectedBase = expectedFilename.replace(/\.pdf$/i, '');
          if (cachedBase && expectedBase && cachedBase === expectedBase) {
            return true;
          }
        }
        
        return false;
      });
    }

    if (!isCached) {
      missing.push(louvor);
      
      // Collect debug info for first 10 missing PDFs
      if (debugInfo.length < 10) {
        debugInfo.push({
          louvor: louvor.nome || louvor.pdfId,
          expectedPath: pdfPath,
          normalizedPath: normalizedPath,
          sampleCached: Array.from(normalizedCacheSet).slice(0, 3)
        });
      }
    }
  }

  // Log debug info if there are missing PDFs (only log once per unique count to reduce console spam)
  // Use a simple cache to track what we've already logged
  if (missing.length > 0 && debugInfo.length > 0) {
    // Only log if this is a new count or significant change
    const cacheKey = `missing_${missing.length}_${louvores.length}`;
    if (!findMissingPdfs._lastLog || findMissingPdfs._lastLog !== cacheKey) {
      findMissingPdfs._lastLog = cacheKey;
      console.warn(`[PDF Validation] Found ${missing.length} missing PDFs. Sample debug info:`, debugInfo);
    }
  }

  return missing;
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

  // Strategy 2: Full cache validation
  const pdfPath = getPdfRelPath(louvor);
  if (!pdfPath) {
    return { available: false, needsDownload: false, url: null, method: 'validation' };
  }

  const validation = await validatePdfAvailability(pdfPath);
  return {
    ...validation,
    method: validation.available ? 'cache' : 'validation'
  };
}

