// PDF Index Utility
// Manages availability index for PDFs to enable fast validation

import { getCachedPDFsFast, waitForServiceWorker } from '$lib/utils/swRegistration';
import { getPdfRelPath } from '$lib/utils/pathUtils';
import urlNormalizer from '$lib/offline/normalization/UrlNormalizer.js';
import { buildPdfCacheIndex } from './pdfCacheIndex.js';

const PDF_INDEX_KEY = 'pdfAvailabilityIndex';
const INDEX_VERSION = 1;
const INDEX_TTL = 24 * 60 * 60 * 1000; // 24 hours

// SOLUÇÃO 1: Cache de sessão - rastrear última verificação
const SESSION_VERIFICATION_KEY = 'pdfIndexLastVerification';
const MIN_VERIFICATION_INTERVAL = 5 * 60 * 1000; // 5 minutos mínimo entre verificações

// SOLUÇÃO 2: Flag global de verificação em andamento
let isVerificationInProgress = false;
let verificationPromise = null;

// SOLUÇÃO 3: Sistema de debounce para agrupar chamadas
let debounceTimer = null;
let pendingLouvores = null;
const DEBOUNCE_DELAY = 2000; // 2 segundos para agrupar chamadas

/**
 * Generates availability index for PDFs
 * Processes in chunks to avoid blocking UI
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
    const cachedPdfs = await getCachedPDFsFast();

    // Mesma normalização de antes (minúsculas + sem acento), agora aplicada
    // uma vez na indexação e uma vez na consulta.
    const cacheIndex = buildPdfCacheIndex(cachedPdfs, {
      normalize: (path) => urlNormalizer.normalizePdfUrl(path)
    });

    // Process in chunks to avoid blocking UI
    const CHUNK_SIZE = 50; // Process 50 PDFs at a time
    const total = louvores.length;
    let processed = 0;

    // Helper function to process a chunk
    const processChunk = (chunk) => {
      for (const louvor of chunk) {
        if (!louvor.pdfId) {
          continue;
        }

        const pdfPath = getPdfRelPath(louvor);
        if (!pdfPath) {
          index.set(louvor.pdfId, false);
          continue;
        }

        index.set(louvor.pdfId, cacheIndex.has(pdfPath));
      }
    };

    // Process all chunks with yield to browser between chunks
    for (let i = 0; i < total; i += CHUNK_SIZE) {
      const chunk = louvores.slice(i, i + CHUNK_SIZE);
      processChunk(chunk);
      processed += chunk.length;

      // Yield to browser after each chunk to allow UI updates
      // Use requestIdleCallback if available, otherwise setTimeout
      if (i + CHUNK_SIZE < total) {
        await new Promise(resolve => {
          if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(resolve, { timeout: 50 });
          } else {
            setTimeout(resolve, 0);
          }
        });
      }
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
 * Checks if verification should be skipped based on session cache
 * @returns {boolean} - true if should skip, false if should verify
 */
function shouldSkipVerification() {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
    return false;
  }

  try {
    const lastVerification = sessionStorage.getItem(SESSION_VERIFICATION_KEY);
    if (!lastVerification) {
      return false; // Never verified in this session
    }

    const lastTime = parseInt(lastVerification, 10);
    const timeSinceLastVerification = Date.now() - lastTime;

    // Skip if verified recently (within minimum interval)
    if (timeSinceLastVerification < MIN_VERIFICATION_INTERVAL) {
      console.log(`[PDF Index] Skipping verification - last verified ${Math.round(timeSinceLastVerification / 1000)}s ago`);
      return true;
    }

    return false;
  } catch (err) {
    console.warn('[PDF Index] Error checking session cache:', err);
    return false;
  }
}

/**
 * Marks verification as completed in session cache
 */
function markVerificationComplete() {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
    return;
  }

  try {
    sessionStorage.setItem(SESSION_VERIFICATION_KEY, String(Date.now()));
  } catch (err) {
    console.warn('[PDF Index] Error saving session cache:', err);
  }
}

/**
 * Invalidates session cache (forces next verification)
 */
export function invalidatePdfIndexSession() {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
    return;
  }

  try {
    sessionStorage.removeItem(SESSION_VERIFICATION_KEY);
    console.log('[PDF Index] Session cache invalidated - next verification will run');
  } catch (err) {
    console.warn('[PDF Index] Error invalidating session cache:', err);
  }
}

/**
 * Updates index in background without blocking UI
 * Implementa 3 soluções para evitar verificações repetidas:
 * 1. Cache de sessão - verifica apenas uma vez a cada 5 minutos
 * 2. Flag global - evita múltiplas verificações simultâneas
 * 3. Debounce - agrupa chamadas próximas em uma única verificação
 * 
 * @param {Array} louvores - Array of louvor objects
 * @param {boolean} immediate - If true, forces immediate verification (ignora cache de sessão)
 * @param {boolean} force - If true, força verificação mesmo se já estiver em andamento
 */
export async function updatePdfIndexInBackground(louvores, immediate = false, force = false) {
  if (typeof window === 'undefined') return;
  if (!louvores || !Array.isArray(louvores) || louvores.length === 0) return;

  // SOLUÇÃO 1: Verificar cache de sessão (a menos que seja forçado)
  if (!force && !immediate && shouldSkipVerification()) {
    // Verificar se o index existe e está válido
    const existingIndex = loadPdfIndex();
    if (existingIndex && existingIndex.size > 0) {
      console.log('[PDF Index] Using cached index from session');
      return; // Usar index existente
    }
    // Se não há index válido, continuar com verificação
  }

  // SOLUÇÃO 2: Se já há verificação em andamento, aguardar ou retornar
  if (isVerificationInProgress && !force) {
    if (verificationPromise) {
      console.log('[PDF Index] Verification already in progress, waiting for completion...');
      return verificationPromise;
    }
  }

  // SOLUÇÃO 3: Debounce - agrupar chamadas próximas
  if (!force && !immediate) {
    // Armazenar louvores pendentes (sempre usar a versão mais recente)
    pendingLouvores = louvores;

    // Limpar timer anterior se existir
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Criar novo timer para agrupar chamadas
    return new Promise((resolve) => {
      debounceTimer = setTimeout(async () => {
        debounceTimer = null;
        // Usar a versão mais recente dos louvores
        const louvoresToProcess = pendingLouvores || louvores;
        pendingLouvores = null;
        
        // Executar verificação agrupada
        await executeVerification(louvoresToProcess, immediate);
        resolve();
      }, DEBOUNCE_DELAY);
    });
  }

  // Execução imediata ou forçada
  return executeVerification(louvores, immediate);
}

/**
 * Executa a verificação do index (função interna)
 * @param {Array} louvores - Array of louvor objects
 * @param {boolean} immediate - Se deve executar imediatamente
 */
async function executeVerification(louvores, immediate) {
  // Marcar como em andamento
  isVerificationInProgress = true;

  const startUpdate = async () => {
    try {
      console.log('[PDF Index] Updating index in background...');
      const index = await generatePdfIndex(louvores);
      savePdfIndex(index);
      
      // Marcar verificação como completa no cache de sessão
      markVerificationComplete();
      
      console.log('[PDF Index] Index updated successfully');
    } catch (err) {
      console.error('[PDF Index] Failed to update index:', err);
    } finally {
      // Limpar flag de verificação em andamento
      isVerificationInProgress = false;
      verificationPromise = null;
    }
  };

  // Criar promise para rastreamento
  verificationPromise = new Promise((resolve, reject) => {
    const wrappedStart = async () => {
      try {
        await startUpdate();
        resolve();
      } catch (err) {
        reject(err);
      }
    };

    if (immediate) {
      // Use requestIdleCallback if available for immediate but non-blocking execution
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(wrappedStart, { timeout: 100 });
      } else {
        // Fallback: use setTimeout with minimal delay
        setTimeout(wrappedStart, 0);
      }
    } else {
      // Wait a bit before starting to not interfere with current operations
      setTimeout(wrappedStart, 1000);
    }
  });

  return verificationPromise;
}

/**
 * Clears the PDF index and session cache
 */
export function clearPdfIndex() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(PDF_INDEX_KEY);
    invalidatePdfIndexSession();
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


