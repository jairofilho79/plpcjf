/**
 * Offline Bundle Importer
 * Imports zip-mãe (offline-manifest + louvores-manifest + part ZIPs) into Cache API
 * with staging + atomic commit (rollback on failure).
 */

import { Unzip, UnzipInflate, unzip } from 'fflate';
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
  initialImportConcurrency
} from './bundleValidation.js';

const logger = createLogger('OfflineBundleImporter');

const OFFLINE_MANIFEST_NAME = 'offline-manifest.json';
const LOUVORES_MANIFEST_NAME = 'louvores-manifest.json';

/**
 * @param {Uint8Array[]} chunks
 * @returns {Uint8Array}
 */
function concatUint8(chunks) {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

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
 * Stream zip entries with light backpressure (max 2 buffered).
 * @param {Blob} blob
 * @param {AbortSignal} [signal]
 * @returns {AsyncGenerator<{ name: string, data: Uint8Array }>}
 */
async function* iterateZipEntries(blob, signal) {
  /** @type {{ name: string, data: Uint8Array }[]} */
  const queue = [];
  let readDone = false;
  /** @type {Error | null} */
  let readError = null;
  /** @type {(() => void) | null} */
  let wake = null;

  const notify = () => {
    if (wake) {
      const w = wake;
      wake = null;
      w();
    }
  };

  const wait = () =>
    new Promise((resolve) => {
      wake = resolve;
    });

  const uz = new Unzip((err) => {
    if (err) {
      readError = err instanceof Error ? err : new Error(String(err));
      notify();
    }
  });
  uz.register(UnzipInflate);
  uz.onfile = (file) => {
    /** @type {Uint8Array[]} */
    const chunks = [];
    file.ondata = (err, dat, final) => {
      if (err) {
        readError = err instanceof Error ? err : new Error(String(err));
        notify();
        return;
      }
      if (dat) chunks.push(dat);
      if (final) {
        queue.push({ name: file.name, data: concatUint8(chunks) });
        notify();
      }
    };
    file.start();
  };

  const reader = blob.stream().getReader();
  const pump = (async () => {
    try {
      while (true) {
        if (signal?.aborted) {
          throw new DOMException('Import cancelled', 'AbortError');
        }
        while (queue.length >= 2) {
          await wait();
          if (signal?.aborted) {
            throw new DOMException('Import cancelled', 'AbortError');
          }
        }
        const { done, value } = await reader.read();
        if (done) {
          uz.push(new Uint8Array(0), true);
          break;
        }
        uz.push(value, false);
      }
    } catch (e) {
      readError = e instanceof Error ? e : new Error(String(e));
    } finally {
      readDone = true;
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
      notify();
    }
  })();

  try {
    while (!readDone || queue.length > 0) {
      if (readError) throw readError;
      if (queue.length > 0) {
        const entry = queue.shift();
        notify();
        if (entry) yield entry;
      } else {
        await wait();
      }
    }
    if (readError) throw readError;
  } finally {
    await pump;
  }
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
    const appCacheName = getConfig('APP_CACHE_NAME') || 'plpc-v4-app';

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
    let pdfsStored = 0;
    let completedParts = 0;
    // ponytail: degrau 0 serial; concurrency>1 reserved for future pool (heuristic already computed)
    void concurrency;

    const throwIfAborted = () => {
      if (signal.aborted) {
        throw new DOMException('Import cancelled', 'AbortError');
      }
    };

    const discardStaging = async () => {
      try {
        await caches.delete(stagingName);
      } catch (e) {
        logger.warn('OfflineBundleImporter', 'Failed to delete staging cache', e);
      }
    };

    /**
     * @param {string} partName
     * @param {Uint8Array} data
     */
    const processPart = async (partName, data) => {
      throwIfAborted();
      logger.info('OfflineBundleImporter', `Processing part: ${partName}`);
      const stagingAdapter = new CacheStorageAdapter(stagingName);
      stagingAdapter.startBatchMode();

      try {
        const entries = await unzipBuffer(data);
        const pdfEntries = Object.entries(entries).filter(([entryName]) => {
          if (isUnsafeZipPath(entryName)) return false;
          return zipEntryBasename(entryName).toLowerCase().endsWith('.pdf');
        });

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
      } finally {
        stagingAdapter.endBatchMode();
      }
    };

    try {
      await discardStaging();
      onProgress({ phase: 'scan', completed: 0, total: 1, percentage: 0, detail: 'A ler pacote…' });

      for await (const entry of iterateZipEntries(file, signal)) {
        throwIfAborted();
        if (isUnsafeZipPath(entry.name)) {
          throw new Error(`Entrada ZIP insegura: ${entry.name}`);
        }

        const base = zipEntryBasename(entry.name);
        if (!base || base.startsWith('.')) continue;

        if (base === OFFLINE_MANIFEST_NAME) {
          offlineManifest = JSON.parse(new TextDecoder().decode(entry.data));
          requiredParts = new Set(listPartFilenames(offlineManifest));
          if (requiredParts.size === 0) {
            throw new Error('offline-manifest.json não lista nenhuma part ZIP');
          }
          continue;
        }

        if (base === LOUVORES_MANIFEST_NAME) {
          louvoresRawText = new TextDecoder().decode(entry.data);
          louvoresManifest = JSON.parse(louvoresRawText);
          continue;
        }

        if (!base.toLowerCase().endsWith('.zip')) continue;

        if (!offlineManifest || !requiredParts) {
          throw new Error(
            'offline-manifest.json deve vir antes das parts no zip-mãe (regenere o bundle)'
          );
        }

        if (!requiredParts.has(base)) {
          logger.info('OfflineBundleImporter', `Ignoring extra part: ${base}`);
          continue;
        }
        if (seenParts.has(base)) {
          throw new Error(`Part duplicada no zip-mãe: ${base}`);
        }
        seenParts.add(base);

        try {
          await processPart(base, entry.data);
        } catch (e) {
          if (isMemoryPressureError(e)) {
            throw new Error(
              'Memória ou quota insuficiente durante a importação. Feche outros separadores e tente de novo.'
            );
          }
          throw e;
        }
        completedParts += 1;
        onProgress({
          phase: 'part',
          completed: completedParts,
          total: requiredParts.size,
          percentage: Math.floor((completedParts / Math.max(requiredParts.size, 1)) * 90),
          detail: base
        });
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

      onProgress({
        phase: 'commit',
        completed: completedParts,
        total: completedParts,
        percentage: 92,
        detail: 'A confirmar no cache…'
      });

      await this._commitStaging(stagingName, mainName);
      await this._applyManifests(offlineManifest, louvoresManifest, louvoresRawText, appCacheName);

      const categories = listCategoriesFromOfflineManifest(offlineManifest);

      onProgress({
        phase: 'done',
        completed: pdfsStored,
        total: pdfsStored,
        percentage: 100,
        detail: 'Concluído'
      });

      logger.info(
        'OfflineBundleImporter',
        `Import OK: ${pdfsStored} PDFs, ${categories.length} categories`
      );

      return { success: true, pdfsStored, categories };
    } catch (e) {
      await discardStaging();
      const err = /** @type {{ name?: string, message?: string }} */ (e);
      if (err?.name === 'AbortError' || signal.aborted) {
        return {
          success: false,
          pdfsStored: 0,
          categories: [],
          cancelled: true,
          error: 'Importação cancelada'
        };
      }
      logger.error('OfflineBundleImporter', 'Import failed; staging discarded', e);
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
   * @private
   */
  async _commitStaging(stagingName, mainName) {
    const staging = await caches.open(stagingName);
    const main = await caches.open(mainName);
    const keys = await staging.keys();
    for (const request of keys) {
      const response = await staging.match(request);
      if (response) {
        await main.put(request, response);
      }
    }
    await caches.delete(stagingName);
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
      logger.warn('OfflineBundleImporter', 'Could not cache offline-manifest in localStorage', e);
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
      logger.warn('OfflineBundleImporter', 'Could not put manifests in app cache', e);
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
