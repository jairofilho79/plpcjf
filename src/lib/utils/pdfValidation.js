// PDF Validation Utility
// Validates PDF availability and identifies missing PDFs

import { getCachedPDFsFast, waitForServiceWorker, downloadPDFsViaSW, invalidateCachedPDFsLocal, getCachedPDFs, debugLog } from '$lib/utils/swRegistration';
import { getPdfRelPath } from '$lib/utils/pathUtils';
import { isPdfAvailableInIndex } from '$lib/utils/pdfIndex';
import compositeValidator from '$lib/offline/validation/CompositeValidator.js';
import cacheStorageAdapter from '$lib/offline/storage/CacheStorageAdapter.js';
import PdfPathManager from '$lib/offline/utils/PdfPathManager.js';
import { buildPdfCacheIndex } from './pdfCacheIndex.js';
// A guarda `typeof localStorage === 'undefined'` que estava nestas funções não
// protegia: `typeof` só suprime exceção para referência não resolvível
// (ECMA-262 §13.5.3), e é o `[[Get]]` de `localStorage` que lança no Firefox
// com dados de site bloqueados. Nenhuma destas quatro lança.
import { getStorage, safeGet, safeSet, safeRemove } from './safeStorage.js';
import {
  readValidationEntry,
  writeValidationEntry,
  removeValidationEntry,
  clearValidationCache,
  migrateLegacyValidationKeys
} from './validationCacheStore.js';

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
 * O storage entregue a `validationCacheStore.js` para o registro único.
 *
 * **Não** é `getStorage()`, de propósito. A sonda de `getStorage()` exige
 * `key()` e `length`, e aqui só se lê e grava UMA chave: um stub parcial de
 * extensão de privacidade — só `getItem`/`setItem`/`removeItem` — reprovaria na
 * sonda e desligaria o cache de validação inteiro, mandando cada PDF ser
 * revalidado pela rede, em silêncio. `safeGet`/`safeSet`/`safeRemove` não
 * passam pela sonda: cada uma tem o seu próprio `try` e lê
 * `globalThis.localStorage` diretamente.
 *
 * Os dois métodos de escrita **lançam** quando a operação falha, e isso é
 * deliberado: `writeAll`, em `validationCacheStore.js`, usa a exceção como
 * canal de erro — é assim que ele reconhece cota estourada, descarta o registro
 * inteiro e tenta de novo, e é assim que `migrateLegacyValidationKeys` sabe que
 * não pode apagar as chaves antigas. Um `setItem` que falhasse em silêncio
 * deixaria o cache grande e inútil para sempre. Nenhuma exceção escapa daqui:
 * todos os usos destes três métodos naquele arquivo estão dentro de `try/catch`
 * próprios.
 *
 * @type {Storage}
 */
const registroDeValidacao = /** @type {any} */ ({
  getItem: (/** @type {string} */ chave) => safeGet(chave),
  setItem: (/** @type {string} */ chave, /** @type {string} */ valor) => {
    if (!safeSet(chave, valor)) throw new Error('localStorage recusou a gravação');
  },
  removeItem: (/** @type {string} */ chave) => {
    if (!safeRemove(chave)) throw new Error('localStorage recusou a remoção');
  }
});

let legacyMigrationDone = false;

/**
 * Migra as chaves antigas `pdfValidation_<id>` para o registro único, uma vez por sessão.
 * `localStorage` indisponível — ausente (SSR), em modo privado do Safari ou bloqueado
 * pelo Firefox estrito — apenas faz a função retornar sem migrar, e sem marcar a
 * migração como feita: se o storage voltar a ser utilizável, a próxima chamada tenta.
 *
 * Esta é a única função do arquivo que precisa mesmo do objeto `Storage`, e por
 * isso a única que ainda usa `getStorage()`: `migrateLegacyValidationKeys`
 * **enumera** o storage (`storage.length` e `storage.key(i)`) à procura das
 * chaves `pdfValidation_*`. Num stub parcial, sem `key()`, não há como enumerar
 * — pular a migração é a resposta correta, não um estreitamento.
 */
function ensureLegacyMigration() {
  if (legacyMigrationDone) return;
  const storage = getStorage();
  if (!storage) return;
  legacyMigrationDone = true;
  const removed = migrateLegacyValidationKeys(storage);
  if (removed > 0) {
    console.info(`[PDF Validation] ${removed} chaves de cache antigas consolidadas`);
  }
}

/**
 * Obtém resultado de validação do cache
 * @param {string} pdfId - PDF ID (base64)
 * @returns {{available: boolean, url: string} | null} - Resultado do cache ou null se não encontrado/expirado
 */
export function getCachedValidation(pdfId) {
  if (!pdfId) return null;
  ensureLegacyMigration();
  return readValidationEntry(registroDeValidacao, pdfId, Date.now());
}

/**
 * Armazena resultado de validação no cache
 * @param {string} pdfId - PDF ID (base64)
 * @param {{available: boolean, url: string}} result - Resultado da validação
 */
export function cacheValidation(pdfId, result) {
  if (!pdfId || !result) return;
  ensureLegacyMigration();
  writeValidationEntry(registroDeValidacao, pdfId, result, Date.now());
}

/**
 * Invalida cache de validação para um PDF específico
 * @param {string} pdfId - PDF ID (base64)
 */
export function invalidateValidationCache(pdfId) {
  if (!pdfId) return;
  removeValidationEntry(registroDeValidacao, pdfId);
}

/**
 * Limpa todo o cache de validação
 */
export function clearAllValidationCache() {
  clearValidationCache(registroDeValidacao);
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

  // #22.1: um só construtor de URL de PDF em todo o cliente.
  const normalizedPath = PdfPathManager.normalizeForStorage(pdfPath);
  const fullUrl = PdfPathManager.createRequestUrl(pdfPath, window.location.origin);

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

  // #22.1: um só construtor de URL de PDF em todo o cliente.
  const normalizedPath = PdfPathManager.normalizeForStorage(pdfPath);
  const fullUrl = PdfPathManager.createRequestUrl(pdfPath, window.location.origin);

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

  const effectiveOnline = await checkEffectiveConnectivity({ timeoutMs: 1500 });
  if (validation.needsDownload && effectiveOnline) {
    // Try to download automatically
    try {
      debugLog('[PDF Validation] Attempting auto-download:', validation.url);
      await downloadPDFsViaSW([validation.url], 1, (progress) => {
        if (progress.completed > 0) {
          debugLog('[PDF Validation] Auto-download completed');
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

  // #22.2: a chave real do cache está em NFC (normalizeForStorage/migração de
  // chaves); getPdfRelPath(louvor) devolve o pdfPath cru, NFD para 8 caminhos
  // do acervo. Sem normalizar aqui, esses 8 apareceriam como "faltando" para
  // sempre depois da migração — a comparação, não a leitura, é que quebraria.
  // #22.3: `buildPdfCacheIndex` perdeu o fallback por nome de arquivo. A
  // contagem de faltantes sobe em relação à versão anterior — é o número
  // verdadeiro: antes, um homônimo em cache escondia a lacuna.
  const cacheIndex = buildPdfCacheIndex(cachedPdfs, { normalize: PdfPathManager.normalizeForStorage });

  const missing = [];

  for (const louvor of louvores) {
    if (!louvor.pdfId) continue;

    const pdfPath = getPdfRelPath(louvor);
    if (!pdfPath) continue;

    if (!cacheIndex.has(pdfPath)) {
      missing.push(louvor);
    }
  }

  if (missing.length > 0) {
    const cacheKey = `missing_${missing.length}_${louvores.length}`;
    if (findMissingPdfs._lastLog !== cacheKey) {
      findMissingPdfs._lastLog = cacheKey;
      console.warn(`[PDF Validation] ${missing.length} PDFs ausentes de ${louvores.length} louvores`);
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

