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

  // Wait for Service Worker to be ready
  const swReady = await waitForServiceWorker(5000);
  if (!swReady) {
    console.warn('[PDF Validation] Service Worker not ready');
    return { available: false, needsDownload: navigator.onLine, url: fullUrl };
  }

  try {
    // Check cache via Service Worker
    const cachedPdfs = await getCachedPDFs();
    const isCached = cachedPdfs.some(cachedUrl => {
      try {
        const cachedPath = new URL(cachedUrl).pathname;
        const normalizedCached = cachedPath.replace(/^\/+/, '').toLowerCase();
        const normalizedTarget = normalizedPath.toLowerCase();
        
        // Exact match
        if (normalizedCached === normalizedTarget) {
          return true;
        }
        
        // Check if paths match (handling different URL formats)
        if (normalizedCached.endsWith(normalizedTarget) || normalizedTarget.endsWith(normalizedCached)) {
          return true;
        }
        
        // Check filename match
        const cachedFilename = cachedPath.split('/').pop();
        const targetFilename = normalizedPath.split('/').pop();
        if (cachedFilename && targetFilename && cachedFilename.toLowerCase() === targetFilename.toLowerCase()) {
          return true;
        }
      } catch {
        // If URL parsing fails, try simple string comparison
        const normalizedCached = cachedUrl.replace(/^\/+/, '').toLowerCase();
        const normalizedTarget = normalizedPath.toLowerCase();
        return normalizedCached.includes(normalizedTarget) || normalizedTarget.includes(normalizedCached);
      }
      return false;
    });

    if (isCached) {
      return { available: true, needsDownload: false, url: fullUrl };
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

  // Normalize cached PDFs for comparison
  const normalizedCache = new Set(
    cachedPdfs.map(url => {
      try {
        const urlObj = new URL(url);
        return urlObj.pathname.replace(/^\/+/, '').toLowerCase();
      } catch {
        return url.replace(/^\/+/, '').toLowerCase();
      }
    })
  );

  const missing = [];

  for (const louvor of louvores) {
    if (!louvor.pdfId) {
      continue;
    }

    const pdfPath = getPdfRelPath(louvor);
    if (!pdfPath) {
      continue;
    }

    const normalizedPath = pdfPath.toLowerCase().replace(/^\/+/, '');
    const isCached = normalizedCache.has(normalizedPath) ||
      Array.from(normalizedCache).some(cached => {
        return cached.endsWith(normalizedPath) || normalizedPath.endsWith(cached);
      });

    if (!isCached) {
      missing.push(louvor);
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

