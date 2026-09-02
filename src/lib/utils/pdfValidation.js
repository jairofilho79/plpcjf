// PDF Validation Utility
// Validates PDF availability and identifies missing PDFs

// `downloadPDFsViaSW` e `debugLog` saíram com o auto-download que vivia em
// `ensurePdfAvailable` — função que, entretanto, deixou de existir. Validar já
// não baixa nada.
import { getCachedPDFsFast, waitForServiceWorker, invalidateCachedPDFsLocal, getCachedPDFs } from '$lib/utils/swRegistration';
import { getPdfRelPath } from '$lib/utils/pathUtils';
// `isPdfAvailableInIndex` saiu daqui com `validatePdfAvailabilityFast`, a única
// coisa neste ficheiro que consultava o índice diretamente. Quem ainda o usa é
// `IndexValidator.js`, por dentro do `CompositeValidator` — este ficheiro chega
// lá pelo validador composto, não por atalho.
import compositeValidator from '$lib/offline/validation/CompositeValidator.js';
import cacheStorageAdapter from '$lib/offline/storage/CacheStorageAdapter.js';
import PdfPathManager from '$lib/offline/utils/PdfPathManager.js';
import { buildPdfCacheIndex } from './pdfCacheIndex.js';
import { resolveAvailabilityInOrder } from './pdfValidationOrder.js';
// A guarda `typeof localStorage === 'undefined'` que estava nestas funções não
// protegia: `typeof` só suprime exceção para referência não resolvível
// (ECMA-262 §13.5.3), e é o `[[Get]]` de `localStorage` que lança no Firefox
// com dados de site bloqueados. Nenhuma destas quatro lança.
import { getStorage, safeGet, safeSet, safeRemove } from './safeStorage.js';
// `readValidationEntry` deixou de ser importada com a saída de
// `getCachedValidation`; continua exportada e testada em
// `validationCacheStore.js`, que não se mexeu.
import {
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

// `getCachedValidation` foi removida: o seu único leitor era
// `validatePdfAvailabilityFast`, que saiu junto. O consumidor quente — o
// caminho rápido do clique em `LouvorCard` — tinha desaparecido antes, quando o
// clique passou a navegar sem validar. Ler um cache que ninguém escreve para
// responder a ninguém era só peso.

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
 * Limpa todo o cache de validação.
 *
 * Migra antes de limpar, e é aqui que está o ponto: o registro único
 * (`pdfValidationCache_v1`) não é o único lixo no `localStorage` de quem já
 * usou a app. Versões antigas gravavam uma chave `pdfValidation_<pdfId>` por
 * PDF — milhares delas, a encostar no teto de ~5 MB por origem — e
 * `clearValidationCache` não lhes toca: só remove a chave consolidada. Quem as
 * apaga é `migrateLegacyValidationKeys`, que as recolhe para o registro único
 * e só então as remove.
 *
 * Essa migração corria por dentro de `getCachedValidation`/`cacheValidation`.
 * Quando o clique deixou de validar, as duas ficaram sem caminho quente e a
 * limpeza deixou de acontecer em aparelhos reais — o lixo antigo ficou lá,
 * sem ninguém para o apagar. Estas seis chamadas vivas (`stores/offline.js` e
 * `routes/leitor/+page.svelte`) são agora o gatilho. A enumeração do storage é
 * síncrona, mas `ensureLegacyMigration` corre uma vez por sessão e, feita a
 * migração, as chaves antigas deixam de existir para sempre.
 */
export function clearAllValidationCache() {
  ensureLegacyMigration();
  clearValidationCache(registroDeValidacao);
}

// `validatePdfAvailabilityFast` foi removida: zero chamadores em todo o `src/`.
// Era o caminho rápido do clique, e o clique deixou de validar. O que ela fazia
// de diferente — consultar o cache de validação antes do validador composto —
// não tem hoje quem o peça; quem valida é o leitor, uma vez, por
// `validatePdfAvailability`.

/**
 * Validates if a PDF is available in cache
 * @param {string} pdfPath - Relative path of the PDF (ex: "assets/ColAdultos/001.pdf")
 * @param {string | null} [pdfId] - Optional PDF ID for caching results
 * @returns {Promise<{available: boolean, needsDownload: boolean, url: string, effectiveOnline: boolean | undefined}>}
 *   `effectiveOnline` é o veredito da sonda de rede, para o chamador não ter de
 *   a repetir. `undefined` quando a sonda não correu — o cache respondeu, ou
 *   houve exceção antes de se chegar lá.
 */
export async function validatePdfAvailability(pdfPath, pdfId = null) {
  if (!pdfPath) {
    // `effectiveOnline` explícito porque este é o único retorno que o omitia,
    // e a diferença entre "campo ausente" e "campo `undefined`" é invisível a
    // quem lê o objeto mas não a quem o declara: o leitor faz
    // `validation.effectiveOnline ?? await checkEffectiveConnectivity(1500)`,
    // e um retorno sem o campo mandava-o sondar a rede 1,5 s para saber o que
    // já se sabe — que não há caminho nenhum para validar. Hoje inalcançável
    // (o leitor chega sempre com caminho); fechado na mesma, porque o custo de
    // o deixar aberto é uma espera de 1,5 s e o de o fechar é uma linha.
    return { available: false, needsDownload: false, url: null, effectiveOnline: false };
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
    // A ordem é o ponto: cache primeiro, rede só se o cache falhar. Ver
    // `pdfValidationOrder.js` — a política mora lá para poder ser testada.
    const { result, effectiveOnline } = await resolveAvailabilityInOrder({
      validate: (options) => compositeValidator.validate(normalizedPath, options),
      checkConnectivity: () => checkEffectiveConnectivity({ timeoutMs: 1500 }),
      pdfId
    });

    // Convert ValidationResult to legacy format
    const legacyResult = {
      available: result.available,
      needsDownload: result.needsDownload,
      url: result.url || fullUrl,
      // Vai junto para o chamador não ter de sondar outra vez o que já foi
      // sondado aqui. `undefined` quando o cache respondeu e a sonda não correu.
      effectiveOnline
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
    const result = { available: false, needsDownload: false, url: fullUrl, effectiveOnline: undefined };
    // Don't cache errors, but cache negative results if PDF ID is provided
    if (pdfId && !error.message?.includes('timeout')) {
      cacheValidation(pdfId, { available: false, url: fullUrl });
    }
    return result;
  }
}

// `ensurePdfAvailable` foi removida: depois de o clique deixar de validar, ficou
// com zero chamadores em todo o `src/`. Dar-lhe um `pdfId` para o cache voltar a
// ser escrito seria consertar uma função que ninguém chama — o cache de
// validação perdeu o consumidor quente quando `LouvorCard` e
// `navigateLouvorToLeitor` deixaram de o ler.

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

