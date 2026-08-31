/**
 * Offline Bundle Importer
 * Imports zip-mãe (offline-manifest + louvores-manifest + part ZIPs) into Cache API
 * with staging + atomic commit (rollback on failure).
 */

import { unzip } from 'fflate';
import { browser } from '$app/environment';
import { getConfig } from '../core/OfflineConfig.js';
import { createLogger } from '../utils/OfflineLogger.js';
import PdfPathManager from '../utils/PdfPathManager.js';
import { CacheStorageAdapter } from '../storage/CacheStorageAdapter.js';
import {
  isUnsafeZipPath,
  zipEntryBasename,
  validateBundleRoot,
  listPartFilenames,
  listCategoriesFromOfflineManifest,
  initialImportConcurrency,
  buildImportChecklist,
  importChecklistPercentage
} from './bundleValidation.js';
import { iterateZipEntriesCd } from './zipCdReader.js';

const logger = createLogger('OfflineBundleImporter');
const LOG = '[Import]';

const OFFLINE_MANIFEST_NAME = 'offline-manifest.json';
const LOUVORES_MANIFEST_NAME = 'louvores-manifest.json';

/**
 * @param {Uint8Array} buffer
 * @returns {Promise<Record<string, Uint8Array>>}
 */
function unzipBuffer(buffer) {
  return new Promise((resolve, reject) => {
    unzip(buffer, (err, data) => {
      if (err) reject(err);
      else resolve(data || {});
    });
  });
}

/**
 * @param {AbortSignal[]} signals
 * @returns {AbortSignal}
 */
function mergeSignals(signals) {
  const filtered = signals.filter(Boolean);
  if (filtered.length === 0) {
    return new AbortController().signal;
  }
  if (filtered.length === 1) return filtered[0];
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any(filtered);
  }
  const ctrl = new AbortController();
  for (const s of filtered) {
    if (s.aborted) {
      ctrl.abort();
      break;
    }
    s.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return ctrl.signal;
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isMemoryPressureError(err) {
  if (!err) return false;
  const name = /** @type {{ name?: string }} */ (err).name || '';
  const msg = String(/** @type {{ message?: string }} */ (err).message || err);
  return name === 'QuotaExceededError' || /quota|out of memory|oom|allocation/i.test(msg);
}

export class OfflineBundleImporter {
  constructor() {
    this._abortController = /** @type {AbortController | null} */ (null);
    this._importing = false;
  }

  isImporting() {
    return this._importing;
  }

  cancel() {
    if (this._abortController) {
      this._abortController.abort();
    }
  }

  /**
   * @param {File|Blob} file
   * @param {object} [options]
   * @param {(p: { phase: string, completed: number, total: number, percentage: number, detail?: string }) => void} [options.onProgress]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<{ success: boolean, pdfsStored: number, categories: string[], cancelled?: boolean, error?: string }>}
   */
  async importFromFile(file, options = {}) {
    if (!browser) {
      throw new Error('Import only available in browser');
    }
    if (this._importing) {
      throw new Error('Import already in progress');
    }

    const stagingName =
      getConfig('PDF_IMPORT_STAGING_CACHE_NAME') || 'plpc-pdfs-import-staging';
    const mainName = getConfig('PDF_CACHE_NAME') || 'plpc-pdfs';
    const appCacheName = getConfig('APP_CACHE_NAME');

    this._importing = true;
    this._abortController = new AbortController();
    const signal = mergeSignals(
      [options.signal, this._abortController.signal].filter(Boolean)
    );

    const onProgress = options.onProgress || (() => {});
    let concurrency = initialImportConcurrency();

    /** @type {unknown} */
    let offlineManifest = null;
    /** @type {unknown} */
    let louvoresManifest = null;
    /** @type {string | null} */
    let louvoresRawText = null;
    /** @type {Set<string>} */
    const seenParts = new Set();
    /** @type {Set<string> | null} */
    let requiredParts = null;
    let offlineManifestDone = false;
    let louvoresManifestDone = false;
    let pdfsStored = 0;
    let completedParts = 0;
    // ponytail: degrau 0 serial; concurrency>1 reserved for future pool (heuristic already computed)
    void concurrency;

    const emitProgress = (
      phase,
      detail,
      { currentPart = null, partInFlight = false, commitCounts = null, commitFraction = 0 } = {}
    ) => {
      const totalParts = requiredParts?.size || 0;
      const checklist = buildImportChecklist({
        offlineManifest,
        offlineManifestDone,
        louvoresManifestDone,
        seenParts,
        currentPart,
        phase,
        commitCounts
      });
      const percentage = importChecklistPercentage({
        offlineManifestDone,
        louvoresManifestDone,
        completedParts,
        totalParts,
        phase,
        partInFlight,
        commitFraction
      });
      onProgress({
        phase,
        completed: completedParts,
        total: totalParts,
        percentage,
        detail,
        checklist
      });
    };

    const throwIfAborted = () => {
      if (signal.aborted) {
        throw new DOMException('Import cancelled', 'AbortError');
      }
    };

    const discardStaging = async () => {
      try {
        await caches.delete(stagingName);
      } catch (e) {
        logger.warn('Failed to delete staging cache', e);
      }
    };

    /**
     * @param {string} partName
     * @param {Uint8Array} data
     */
    const processPart = async (partName, data) => {
      throwIfAborted();
      const stagingAdapter = new CacheStorageAdapter(stagingName);
      stagingAdapter.startBatchMode();

      try {
        const entries = await unzipBuffer(data);
        const pdfEntries = Object.entries(entries).filter(([entryName]) => {
          if (isUnsafeZipPath(entryName)) return false;
          return zipEntryBasename(entryName).toLowerCase().endsWith('.pdf');
        });
        console.info(`${LOG}   extraindo ${pdfEntries.length} PDFs de ${partName}`);

        for (const [entryName, fileData] of pdfEntries) {
          throwIfAborted();
          const path = PdfPathManager.normalizeForStorage(entryName);
          if (!path) continue;
          await stagingAdapter._putPdfInternal(
            path,
            new Blob([fileData], { type: 'application/pdf' }),
            { emitEvents: false, notifyServiceWorker: false }
          );
          pdfsStored += 1;
        }
        return pdfEntries.length;
      } finally {
        stagingAdapter.endBatchMode();
      }
    };

    try {
      await discardStaging();
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      console.info(`${LOG} a ler zip-mãe (${sizeMb} MB)…`);
      emitProgress('scan', 'A ler pacote…');

      // ponytail: CD + slice — streaming Unzip breaks on yazl data-descriptors + nested zips
      for await (const entry of iterateZipEntriesCd(file, signal)) {
        throwIfAborted();
        if (isUnsafeZipPath(entry.name)) {
          throw new Error(`Entrada ZIP insegura: ${entry.name}`);
        }

        const base = zipEntryBasename(entry.name);
        if (!base || base.startsWith('.')) continue;

        if (base === OFFLINE_MANIFEST_NAME) {
          console.info(`${LOG} ▶ Manifesto Offline`);
          offlineManifest = JSON.parse(new TextDecoder().decode(entry.data));
          requiredParts = new Set(listPartFilenames(offlineManifest));
          if (requiredParts.size === 0) {
            throw new Error('offline-manifest.json não lista nenhuma part ZIP');
          }
          offlineManifestDone = true;
          console.info(
            `${LOG} ✓ Manifesto Offline — ${requiredParts.size} lotes`
          );
          emitProgress('scan', 'Manifesto Offline');
          continue;
        }

        if (base === LOUVORES_MANIFEST_NAME) {
          console.info(`${LOG} ▶ Manifesto Louvores`);
          louvoresRawText = new TextDecoder().decode(entry.data);
          louvoresManifest = JSON.parse(louvoresRawText);
          louvoresManifestDone = true;
          const n = Array.isArray(louvoresManifest) ? louvoresManifest.length : 0;
          console.info(`${LOG} ✓ Manifesto Louvores — ${n} entradas`);
          emitProgress('scan', 'Manifesto Louvores');
          continue;
        }

        if (!base.toLowerCase().endsWith('.zip')) continue;

        if (!offlineManifest || !requiredParts) {
          throw new Error(
            'offline-manifest.json deve vir antes das parts no zip-mãe (regenere o bundle)'
          );
        }

        if (!requiredParts.has(base)) {
          console.info(`${LOG} (ignorado) ${base}`);
          continue;
        }
        if (seenParts.has(base)) {
          throw new Error(`Part duplicada no zip-mãe: ${base}`);
        }

        const mb = (entry.data.byteLength / (1024 * 1024)).toFixed(1);
        console.info(
          `${LOG} ▶ ${base} (${completedParts + 1}/${requiredParts.size}, ${mb} MB)`
        );
        emitProgress('part', `A extrair ${base}…`, {
          currentPart: base,
          partInFlight: true
        });

        let pdfCount = 0;
        try {
          pdfCount = await processPart(base, entry.data);
        } catch (e) {
          if (isMemoryPressureError(e)) {
            throw new Error(
              'Memória ou quota insuficiente durante a importação. Feche outros separadores e tente de novo.'
            );
          }
          throw e;
        }
        seenParts.add(base);
        completedParts += 1;
        console.info(
          `${LOG} ✓ ${base} — ${pdfCount} PDFs (${completedParts}/${requiredParts.size})`
        );
        emitProgress('part', base);
      }

      if (!offlineManifest || !louvoresManifest || !louvoresRawText) {
        throw new Error(
          'Zip-mãe incompleto: faltam offline-manifest.json e/ou louvores-manifest.json'
        );
      }

      const rootCheck = validateBundleRoot({
        offlineManifest,
        louvoresManifest,
        entryBasenames: seenParts
      });
      if (!rootCheck.ok) {
        throw new Error(rootCheck.errors.join('; '));
      }

      console.info(`${LOG} ▶ Confirmar no cache…`);
      emitProgress('commit', 'A confirmar no cache…', {
        commitCounts: { ok: 0, fail: 0, total: 0 },
        commitFraction: 0
      });

      const commitResult = await this._commitStaging(stagingName, mainName, {
        signal,
        onProgress: ({ ok, fail, total }) => {
          const fraction = total > 0 ? (ok + fail) / total : 0;
          if ((ok + fail) === 1 || (ok + fail) % 25 === 0 || ok + fail >= total) {
            console.info(`${LOG}   cache ${ok} ok / ${fail} falha / ${total}`);
          }
          emitProgress('commit', 'A confirmar no cache…', {
            commitCounts: { ok, fail, total },
            commitFraction: fraction
          });
        }
      });
      console.info(
        `${LOG} ✓ Confirmar no cache — ${commitResult.ok} ok / ${commitResult.fail} falha / ${commitResult.total}`
      );

      await this._applyManifests(offlineManifest, louvoresManifest, louvoresRawText, appCacheName);

      const categories = listCategoriesFromOfflineManifest(offlineManifest);

      console.info(
        `${LOG} ✓ Concluído — ${pdfsStored} PDFs, ${categories.length} categorias`
      );
      emitProgress('done', 'Concluído');

      logger.info(`Import OK: ${pdfsStored} PDFs, ${categories.length} categories`);

      return { success: true, pdfsStored, categories };
    } catch (e) {
      await discardStaging();
      const err = /** @type {{ name?: string, message?: string }} */ (e);
      if (err?.name === 'AbortError' || signal.aborted) {
        console.info(`${LOG} cancelado`);
        return {
          success: false,
          pdfsStored: 0,
          categories: [],
          cancelled: true,
          error: 'Importação cancelada'
        };
      }
      console.error(`${LOG} falhou — staging descartado`, e);
      logger.error('Import failed; staging discarded', e instanceof Error ? e : new Error(String(e)));
      return {
        success: false,
        pdfsStored: 0,
        categories: [],
        error: err?.message || String(e)
      };
    } finally {
      this._importing = false;
      this._abortController = null;
    }
  }

  /**
   * @param {string} stagingName
   * @param {string} mainName
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @param {(p: { ok: number, fail: number, total: number }) => void} [options.onProgress]
   * @returns {Promise<{ ok: number, fail: number, total: number }>}
   * @private
   */
  async _commitStaging(stagingName, mainName, options = {}) {
    const staging = await caches.open(stagingName);
    const main = await caches.open(mainName);
    const keys = await staging.keys();
    const total = keys.length;
    let ok = 0;
    let fail = 0;
    const onProgress = options.onProgress || (() => {});
    // ponytail: report every 25 puts so UI breathes without 4k store updates
    const tick = () => {
      if (ok + fail === total || ok + fail === 1 || (ok + fail) % 25 === 0) {
        onProgress({ ok, fail, total });
      }
    };
    onProgress({ ok: 0, fail: 0, total });

    for (const request of keys) {
      if (options.signal?.aborted) {
        throw new DOMException('Import cancelled', 'AbortError');
      }
      try {
        const response = await staging.match(request);
        if (!response) {
          fail += 1;
        } else {
          await main.put(request, response.clone());
          ok += 1;
        }
      } catch {
        fail += 1;
      }
      tick();
    }
    await caches.delete(stagingName);
    onProgress({ ok, fail, total });
    return { ok, fail, total };
  }

  /**
   * @param {unknown} offlineManifest
   * @param {unknown} louvoresManifest
   * @param {string} louvoresRawText
   * @param {string} appCacheName
   * @private
   */
  async _applyManifests(offlineManifest, louvoresManifest, louvoresRawText, appCacheName) {
    const offlineKey = getConfig('OFFLINE_MANIFEST_KEY') || 'offlineManifest';
    try {
      localStorage.setItem(offlineKey, JSON.stringify(offlineManifest));
    } catch (e) {
      logger.warn('Could not cache offline-manifest in localStorage', e);
    }

    try {
      const appCache = await caches.open(appCacheName);
      const louvoresUrl = new URL(
        getConfig('LOUVORES_MANIFEST_URL') || '/louvores-manifest.json',
        window.location.origin
      ).href;
      await appCache.put(
        louvoresUrl,
        new Response(louvoresRawText, {
          headers: { 'Content-Type': 'application/json' }
        })
      );
      const offlineUrl = new URL(
        getConfig('OFFLINE_MANIFEST_URL') || '/offline-manifest.json',
        window.location.origin
      ).href;
      await appCache.put(
        offlineUrl,
        new Response(JSON.stringify(offlineManifest), {
          headers: { 'Content-Type': 'application/json' }
        })
      );
    } catch (e) {
      logger.warn('Could not put manifests in app cache', e);
    }

    const { hydrateLouvoresFromManifestData } = await import('$lib/stores/louvores.js');
    await hydrateLouvoresFromManifestData(louvoresManifest, louvoresRawText);

    const { offline } = await import('$lib/stores/offline.js');
    offline.updateState({ offlineManifest });

    const categories = listCategoriesFromOfflineManifest(offlineManifest);
    if (categories.length) {
      offline.saveCategories(categories);
      try {
        localStorage.setItem(
          getConfig('OFFLINE_CATEGORIAS_SALVAS') || 'OFFLINE_CATEGORIAS_SALVAS',
          JSON.stringify(categories)
        );
        localStorage.setItem(
          getConfig('DOWNLOADED_CATEGORIES_KEY') || 'downloadedCategories',
          JSON.stringify(categories)
        );
      } catch {
        // ignore
      }
    }

    try {
      localStorage.setItem('OFFLINE_AVAILABLE', 'TRUE');
      localStorage.setItem(getConfig('ALLOW_OFFLINE_KEY') || 'ALLOW_OFFLINE', 'true');
    } catch {
      // ignore
    }
  }
}

const offlineBundleImporter = new OfflineBundleImporter();
export default offlineBundleImporter;
