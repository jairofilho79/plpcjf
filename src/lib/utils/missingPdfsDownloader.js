/**
 * Missing PDFs Downloader Utility
 * Downloads missing PDFs without modifying existing classes
 * Uses existing functions: findMissingPdfs, downloadPDFsViaSW, getCachedPDFsFast
 */

import { findMissingPdfs } from './pdfValidation.js';
import { getPdfRelPath } from './pathUtils.js';
import { getCachedPDFsFast } from './swRegistration.js';
import { downloadPDFsViaSW } from './swRegistration.js';
import { createUrlUtf8 } from './urlEncoding.js';
import { louvores } from '$lib/stores/louvores.js';
import { get } from 'svelte/store';
import { browser } from '$app/environment';

/**
 * Format error message based on error type
 * @param {Error} error - Error object
 * @returns {string} Formatted error message
 */
function formatErrorMessage(error) {
  if (!error) {
    return 'Erro desconhecido ao baixar PDFs.';
  }

  const message = error.message || error.toString();
  
  // Check for specific error types
  if (message.includes('404') || message.includes('not found')) {
    return 'PDF não encontrado no servidor. O arquivo pode ter sido removido ou movido.';
  }
  
  if (message.includes('network') || message.includes('fetch') || message.includes('Failed to fetch')) {
    return 'Erro de conexão. Verifique sua internet e tente novamente.';
  }
  
  if (message.includes('timeout') || message.includes('Timeout')) {
    return 'Tempo limite excedido. Tente novamente.';
  }
  
  if (message.includes('Service worker')) {
    return 'Service Worker não disponível. Recarregue a página e tente novamente.';
  }
  
  // Return generic error with details
  return `Erro ao baixar PDFs: ${message}`;
}

/**
 * Download missing PDFs
 * @param {Object} [options] - Download options
 * @param {Function} [options.onProgress] - Progress callback
 * @param {Array} [options.louvoresData] - Louvores data (if not provided, will be fetched from store)
 * @returns {Promise<{success: boolean, completed: number, failed: number, total: number, errors: string[]}>}
 */
export async function downloadMissingPdfs(options = {}) {
  if (!browser) {
    throw new Error('Download only available in browser');
  }

  const { onProgress = null, louvoresData = null } = options;

  try {
    // 1. Get louvores data from store
    const louvoresDataToUse = louvoresData || get(louvores);
    
    if (!louvoresDataToUse || louvoresDataToUse.length === 0) {
      return {
        success: false,
        completed: 0,
        failed: 0,
        total: 0,
        errors: ['Nenhum louvor encontrado. Carregue os louvores primeiro.']
      };
    }

    // 2. Get cached PDFs
    let cachedPdfs = [];
    try {
      cachedPdfs = await getCachedPDFsFast();
    } catch (error) {
      console.warn('[Missing PDFs Downloader] Could not get cached PDFs, using empty array', error);
      cachedPdfs = [];
    }

    // 3. Find missing PDFs
    const missingPdfs = findMissingPdfs(louvoresDataToUse, cachedPdfs);
    
    if (missingPdfs.length === 0) {
      return {
        success: true,
        completed: 0,
        failed: 0,
        total: 0,
        errors: []
      };
    }

    // 4. Extract URLs from missing PDFs
    const pdfUrls = [];
    const errors = [];

    for (const louvor of missingPdfs) {
      try {
        const pdfPath = getPdfRelPath(louvor);
        if (!pdfPath) {
          errors.push(`PDF ID inválido para louvor: ${louvor.nome || louvor.pdfId}`);
          continue;
        }

        // Create full URL using createUrlUtf8 to handle UTF-8 encoding
        const fullUrl = createUrlUtf8(`/${pdfPath}`, window.location.origin);
        pdfUrls.push(fullUrl);
      } catch (error) {
        console.error('[Missing PDFs Downloader] Error extracting PDF URL:', error);
        errors.push(`Erro ao processar PDF: ${louvor.nome || louvor.pdfId} - ${error.message}`);
      }
    }

    if (pdfUrls.length === 0) {
      return {
        success: false,
        completed: 0,
        failed: missingPdfs.length,
        total: missingPdfs.length,
        errors: errors.length > 0 ? errors : ['Nenhum URL válido encontrado para os PDFs faltantes.']
      };
    }

    // 5. Download PDFs via Service Worker
    try {
      const result = await downloadPDFsViaSW(
        pdfUrls,
        10, // batchSize
        (progress) => {
          // Call progress callback if provided
          if (onProgress) {
            onProgress({
              completed: progress.completed || 0,
              failed: progress.failed || 0,
              total: progress.total || pdfUrls.length,
              percentage: progress.percentage || 0
            });
          }
        }
      );

      // Combine errors from URL extraction with download errors
      const allErrors = [...errors];
      if (result.failed > 0 && result.errors) {
        allErrors.push(...result.errors);
      }

      return {
        success: result.failed === 0,
        completed: result.completed || 0,
        failed: result.failed || 0,
        total: pdfUrls.length,
        errors: allErrors
      };
    } catch (error) {
      // Format error message
      const errorMessage = formatErrorMessage(error);
      
      return {
        success: false,
        completed: 0,
        failed: pdfUrls.length,
        total: pdfUrls.length,
        errors: [...errors, errorMessage]
      };
    }
  } catch (error) {
    console.error('[Missing PDFs Downloader] Error:', error);
    const errorMessage = formatErrorMessage(error);
    
    return {
      success: false,
      completed: 0,
      failed: 0,
      total: 0,
      errors: [errorMessage]
    };
  }
}

