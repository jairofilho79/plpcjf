// PDF Index Utility
// Manages availability index for PDFs to enable fast validation

import { getCachedPDFsFast, waitForServiceWorker, debugLog } from '$lib/utils/swRegistration';
import { getPdfRelPath } from '$lib/utils/pathUtils';
import PdfPathManager from '$lib/offline/utils/PdfPathManager.js';
import { buildPdfCacheIndex } from './pdfCacheIndex.js';
import { criarCedente } from '../offline/stats/yieldScheduler.js';

const PDF_INDEX_KEY = 'pdfAvailabilityIndex';
// #22.3: bumpado de 1 para 2 porque o índice gravado antes desta versão foi
// construído com a normalização minúscula e contaminado pelo falso positivo de
// basename. `loadPdfIndex` (:148-152) descarta sozinho o de versão diferente —
// é como o índice velho morre no próximo carregamento, e não em 24 h de TTL.
const INDEX_VERSION = 2;
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
 * Uma passagem só, cedendo a thread por orçamento de relógio
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

    // #22.3: a régua canônica — preserva caixa e acento e unifica a forma
    // Unicode. Aplicada aos dois lados (lista em cache e candidato), como antes.
    const cacheIndex = buildPdfCacheIndex(cachedPdfs, {
      normalize: (path) => PdfPathManager.normalizeForStorage(path)
    });

    // Uma passagem, cedência por relógio — a mesma correção já feita na
    // varredura de estatísticas, pelo mesmo motivo e no mesmo módulo.
    //
    // O laço antigo fatiava os 4629 louvores em chunks de 50 (93 chunks) e
    // esperava, entre cada dois, um `requestIdleCallback` com `timeout: 50` ou,
    // onde ele não existe — Safari < 17.4, ou seja iOS 16 —, um `setTimeout(…, 0)`
    // aninhado. A partir do quinto nível de aninhamento o navegador trava esse
    // temporizador em 1000 ms com a aba não visível, e é exatamente essa a
    // situação aqui: `updatePdfIndexInBackground(…, true, true)` corre logo
    // depois de cada descarga, que acontece depois de um `window.open()`.
    // Eram ~93 s de espera pura, com o índice a ficar velho durante todo esse
    // tempo. `criarCedente` mede o relógio e agenda por `MessageChannel`, que
    // não é temporizador e não sofre clamp nenhum.
    //
    // A ordem de visita, as chaves e os valores são os mesmos do laço de chunks:
    // o que mudou foi só quando se cede, nunca o que se escreve.
    const cedente = criarCedente();

    for (const louvor of louvores) {
      if (louvor.pdfId) {
        const pdfPath = getPdfRelPath(louvor);
        index.set(louvor.pdfId, pdfPath ? cacheIndex.has(pdfPath) : false);
      }

      await cedente.talvezCeder();
    }

    debugLog(`[PDF Index] Generated index for ${index.size} PDFs`);
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
    debugLog(`[PDF Index] Saved index with ${index.size} entries`);
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
      debugLog('[PDF Index] Index version mismatch, clearing old index');
      localStorage.removeItem(PDF_INDEX_KEY);
      return null;
    }

    // Validate TTL
    if (Date.now() - indexData.timestamp > INDEX_TTL) {
      debugLog('[PDF Index] Index expired, clearing old index');
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
      debugLog(`[PDF Index] Skipping verification - last verified ${Math.round(timeSinceLastVerification / 1000)}s ago`);
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
    debugLog('[PDF Index] Session cache invalidated - next verification will run');
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
      debugLog('[PDF Index] Using cached index from session');
      return; // Usar index existente
    }
    // Se não há index válido, continuar com verificação
  }

  // SOLUÇÃO 2: Se já há verificação em andamento, aguardar ou retornar
  if (isVerificationInProgress && !force) {
    if (verificationPromise) {
      debugLog('[PDF Index] Verification already in progress, waiting for completion...');
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
      debugLog('[PDF Index] Updating index in background...');
      const index = await generatePdfIndex(louvores);
      savePdfIndex(index);
      
      // Marcar verificação como completa no cache de sessão
      markVerificationComplete();
      
      debugLog('[PDF Index] Index updated successfully');
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
    debugLog('[PDF Index] Index cleared');
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


