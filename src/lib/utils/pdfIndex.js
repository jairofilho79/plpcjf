// PDF Index Utility
// Manages availability index for PDFs to enable fast validation

import { getCachedPDFs, waitForServiceWorker } from '$lib/utils/swRegistration';
import { getPdfRelPath } from '$lib/utils/pathUtils';
import { normalizePathForComparison } from '$lib/utils/pdfValidation';

const PDF_INDEX_KEY = 'pdfAvailabilityIndex';
const INDEX_VERSION = 1;
const INDEX_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Generates availability index for PDFs
 * @param {Array} louvores - Array of louvor objects
 * @returns {Promise<Map<string, boolean>>}
 */
export async function generatePdfIndex(louvores) {
  if (!louvores || !Array.isArray(louvores) || louvores.length === 0) {
    return new Map();
  }

  const index = new Map();

  // Wait for Service Worker to be ready
  const swReady = await waitForServiceWorker(5000);
  if (!swReady) {
    console.warn('[PDF Index] Service Worker not ready, generating empty index');
    return index;
  }

  try {
    const cachedPdfs = await getCachedPDFs();

    // Normalize cached PDF URLs using centralized function (same as findMissingPdfs)
    const normalizedCacheSet = new Set();
    cachedPdfs.forEach(url => {
      const normalized = normalizePathForComparison(url);
      normalizedCacheSet.add(normalized);
      
      // Also add filename-only variation (same logic as findMissingPdfs)
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

    // Validate each PDF using same strategies as findMissingPdfs
    for (const louvor of louvores) {
      if (!louvor.pdfId) {
        continue;
      }

      const pdfPath = getPdfRelPath(louvor);
      if (!pdfPath) {
        index.set(louvor.pdfId, false);
        continue;
      }

      // Normalize expected path using centralized function
      const normalizedPath = normalizePathForComparison(pdfPath);
      
      // Check using same strategies as findMissingPdfs
      let isAvailable = false;
      
      // Strategy 1: Exact match
      if (normalizedCacheSet.has(normalizedPath)) {
        isAvailable = true;
      }
      
      // Strategy 2: Filename match
      if (!isAvailable) {
        const filename = normalizedPath.split('/').pop();
        if (filename && normalizedCacheSet.has(filename)) {
          isAvailable = true;
        }
      }
      
      // Strategy 3: Partial match (same logic as findMissingPdfs)
      if (!isAvailable) {
        isAvailable = Array.from(normalizedCacheSet).some(cached => {
          if (cached === normalizedPath) return true;
          if (cached.endsWith(normalizedPath)) return true;
          if (normalizedPath.endsWith(cached)) return true;
          
          const cachedFilename = cached.split('/').pop();
          const expectedFilename = normalizedPath.split('/').pop();
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

      index.set(louvor.pdfId, isAvailable);
    }

    console.log(`[PDF Index] Generated index for ${index.size} PDFs`);
    return index;
  } catch (error) {
    console.error('[PDF Index] Error generating index:', error);
    return index;
  }
}

/**
 * Saves index to localStorage
 * @param {Map<string, boolean>} index - Index map
 */
export function savePdfIndex(index) {
  if (typeof window === 'undefined') return;

  const indexData = {
    version: INDEX_VERSION,
    timestamp: Date.now(),
    index: Object.fromEntries(index)
  };

  try {
    localStorage.setItem(PDF_INDEX_KEY, JSON.stringify(indexData));
    console.log(`[PDF Index] Saved index with ${index.size} entries`);
  } catch (err) {
    console.error('[PDF Index] Failed to save index:', err);
    // If quota exceeded, try to clear old data
    if (err.name === 'QuotaExceededError') {
      try {
        localStorage.removeItem(PDF_INDEX_KEY);
        localStorage.setItem(PDF_INDEX_KEY, JSON.stringify(indexData));
      } catch (retryErr) {
        console.error('[PDF Index] Failed to save after cleanup:', retryErr);
      }
    }
  }
}

/**
 * Loads index from localStorage
 * @returns {Map<string, boolean>|null}
 */
export function loadPdfIndex() {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(PDF_INDEX_KEY);
    if (!stored) return null;

    const indexData = JSON.parse(stored);

    // Validate version
    if (indexData.version !== INDEX_VERSION) {
      console.log('[PDF Index] Index version mismatch, clearing old index');
      localStorage.removeItem(PDF_INDEX_KEY);
      return null;
    }

    // Validate TTL
    if (Date.now() - indexData.timestamp > INDEX_TTL) {
      console.log('[PDF Index] Index expired, clearing old index');
      localStorage.removeItem(PDF_INDEX_KEY);
      return null;
    }

    return new Map(Object.entries(indexData.index));
  } catch (err) {
    console.error('[PDF Index] Failed to load index:', err);
    return null;
  }
}

/**
 * Checks if a PDF is available using the index
 * @param {string} pdfId - PDF ID to check
 * @returns {boolean|null} - true if available, false if not, null if index unavailable
 */
export function isPdfAvailableInIndex(pdfId) {
  if (!pdfId) return null;

  const index = loadPdfIndex();
  if (!index) return null;

  return index.get(pdfId) ?? false;
}

/**
 * Updates index in background without blocking UI
 * @param {Array} louvores - Array of louvor objects
 */
export async function updatePdfIndexInBackground(louvores) {
  if (typeof window === 'undefined') return;
  if (!louvores || !Array.isArray(louvores) || louvores.length === 0) return;

  // Execute in background with a small delay to not block UI
  setTimeout(async () => {
    try {
      console.log('[PDF Index] Updating index in background...');
      const index = await generatePdfIndex(louvores);
      savePdfIndex(index);
      console.log('[PDF Index] Index updated successfully');
    } catch (err) {
      console.error('[PDF Index] Failed to update index:', err);
    }
  }, 1000);
}

/**
 * Clears the PDF index
 */
export function clearPdfIndex() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(PDF_INDEX_KEY);
    console.log('[PDF Index] Index cleared');
  } catch (err) {
    console.error('[PDF Index] Failed to clear index:', err);
  }
}

/**
 * Gets index statistics
 * @returns {object|null}
 */
export function getIndexStats() {
  const index = loadPdfIndex();
  if (!index) return null;

  let available = 0;
  let unavailable = 0;

  for (const [_, isAvailable] of index) {
    if (isAvailable) {
      available++;
    } else {
      unavailable++;
    }
  }

  return {
    total: index.size,
    available,
    unavailable,
    coverage: index.size > 0 ? (available / index.size) * 100 : 0
  };
}


