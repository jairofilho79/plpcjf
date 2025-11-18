// PDF Validation Utility
// Validates PDF availability and identifies missing PDFs

import { getCachedPDFs, waitForServiceWorker, downloadPDFsViaSW } from '$lib/utils/swRegistration';
import { getPdfRelPath } from '$lib/utils/pathUtils';

/**
 * Validates if a PDF is available in cache
 * @param {string} pdfPath - Relative path of the PDF (ex: "assets/ColAdultos/001.pdf")
 * @returns {Promise<{available: boolean, needsDownload: boolean, url: string}>}
 */
export async function validatePdfAvailability(pdfPath) {
  if (!pdfPath) {
    return { available: false, needsDownload: false, url: null };
  }

  // Normalize path (remove leading slash if present)
  const normalizedPath = pdfPath.startsWith('/') ? pdfPath.substring(1) : pdfPath;
  const fullUrl = new URL(`/${normalizedPath}`, window.location.origin).href;

  // Wait for Service Worker to be ready (mas não bloqueia se não estiver pronto)
  const swReady = await waitForServiceWorker(3000); // Reduzido para 3s para ser mais responsivo
  if (!swReady) {
    console.warn('[PDF Validation] Service Worker not ready, but allowing check to proceed');
    // Não retornar false imediatamente - tentar verificar cache mesmo assim
  }

  try {
    // Check cache via Service Worker
    const cachedPdfs = await getCachedPDFs();
    
    // Normalize target path using centralized function
    const normalizedTarget = normalizePathForComparison(normalizedPath);
    
    // Create normalized set of cached PDFs (same logic as findMissingPdfs)
    const normalizedCacheSet = new Set();
    cachedPdfs.forEach(url => {
      const normalized = normalizePathForComparison(url);
      normalizedCacheSet.add(normalized);
      
      // Also add filename-only variation
      try {
        const urlObj = new URL(url);
        const filename = urlObj.pathname.split('/').pop();
        if (filename) {
          const normalizedFilename = normalizePathForComparison(filename);
          normalizedCacheSet.add(normalizedFilename);
        }
      } catch {
        const parts = url.split('/');
        const filename = parts[parts.length - 1];
        if (filename) {
          const normalizedFilename = normalizePathForComparison(filename);
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

    if (isCached) {
      return { available: true, needsDownload: false, url: fullUrl };
    }
    
    // Debug: Log when PDF is not found (only for first few misses to avoid spam)
    if (!validatePdfAvailability._missCount) {
      validatePdfAvailability._missCount = 0;
    }
    if (validatePdfAvailability._missCount < 3) {
      validatePdfAvailability._missCount++;
      console.warn(`[PDF Validation] PDF not found in cache: ${pdfPath} (normalized: ${normalizedTarget})`);
      console.warn(`[PDF Validation] Sample cached PDFs:`, Array.from(normalizedCacheSet).slice(0, 5));
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

    return { available: false, needsDownload: false, url: fullUrl };
  } catch (error) {
    console.error('[PDF Validation] Error:', error);
    return { available: false, needsDownload: false, url: fullUrl };
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
 * Normalize path for comparison (handles encoding, case, and path variations)
 * Centralized function to ensure consistent normalization across all PDF comparison operations
 * @param {string} path - Path to normalize
 * @returns {string} - Normalized path
 */
export function normalizePathForComparison(path) {
  if (!path) return '';
  
  try {
    // Remove protocol and domain if present
    let normalized = path.replace(/^https?:\/\/[^/]+/, '');
    
    // Remove leading/trailing slashes
    normalized = normalized.replace(/^\/+/, '').replace(/\/+$/, '');
    
    // Decode URI encoding (handle multiple encodings)
    try {
      // Try decoding up to 3 times to handle double/triple encoding
      for (let i = 0; i < 3; i++) {
        if (normalized.includes('%')) {
          const decoded = decodeURIComponent(normalized);
          if (decoded !== normalized) {
            normalized = decoded;
          } else {
            break;
          }
        } else {
          break;
        }
      }
    } catch {
      // If decoding fails, continue with original
    }
    
    // Normalize to lowercase
    normalized = normalized.toLowerCase();
    
    // Normalize path separators
    normalized = normalized.replace(/\\/g, '/');
    
    return normalized;
  } catch {
    // Fallback: simple normalization
    return path.toLowerCase().replace(/^\/+/, '').replace(/\\/g, '/');
  }
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
    const normalized = normalizePathForComparison(url);
    normalizedCacheSet.add(normalized);
    normalizedCacheVariations.set(normalized, url);
    
    // Also add variations (filename only, without directory)
    try {
      const urlObj = new URL(url);
      const filename = urlObj.pathname.split('/').pop();
      if (filename) {
        const normalizedFilename = normalizePathForComparison(filename);
        normalizedCacheSet.add(normalizedFilename);
      }
    } catch {
      const parts = url.split('/');
      const filename = parts[parts.length - 1];
      if (filename) {
        const normalizedFilename = normalizePathForComparison(filename);
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
    const normalizedPath = normalizePathForComparison(pdfPath);
    
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

