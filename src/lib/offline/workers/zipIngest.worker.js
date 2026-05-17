import Dexie from 'dexie';
import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';
import { WORKER_COMMANDS, WORKER_EVENTS } from './workerProtocol.js';
import {
  normalizeIdbId,
  normalizeStoragePath,
  buildExpectedSet,
  shouldIngestZipEntry
} from '../utils/offlinePathNormalize.js';

const DB_NAME = 'plpc-offline-db';
const STORE_PROGRESS_EVERY = 5;
const YIELD_EVERY = 10;

// Mirror the same versioned schema as dexieDb.js so IDB upgrades are consistent
// when both the main thread and the worker open the same database.
class WorkerDexieDb extends Dexie {
  constructor() {
    super(DB_NAME);
    // v1 — original schema (must be declared for upgrades from existing DBs)
    this.version(1).stores({
      assets: '&id,path,updatedAt,mimeType,size'
    });
    // v2 — adds inventory indexes (pdfId, category, status, manifestRevision)
    this.version(2).stores({
      assets: '&id,path,pdfId,category,updatedAt,mimeType,size,status,manifestRevision'
    });
  }
}

const db = new WorkerDexieDb();
const assetsTable = db.table('assets');
const abortControllers = new Map();

async function yieldMicroTask() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Download a ZIP with streaming progress reports.
 * Emits WORKER_EVENTS.DOWNLOADING messages as bytes arrive.
 *
 * @param {string} packageUrl
 * @param {AbortSignal} signal
 * @param {string} requestId
 * @param {number} [contentLengthHint] - Size hint from the manifest (bytes)
 * @returns {Promise<Blob>}
 */
async function fetchZipWithProgress(packageUrl, signal, requestId, contentLengthHint = 0) {
  const response = await fetch(packageUrl, {
    signal,
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Falha ao baixar pacote: ${response.status} ${response.statusText}`);
  }

  const contentLength =
    Number(response.headers.get('Content-Length') || 0) ||
    contentLengthHint ||
    0;

  // If the response body is not streamable (some SW responses), fall back to blob()
  if (!response.body) {
    const blob = await response.blob();
    self.postMessage({
      event: WORKER_EVENTS.DOWNLOADING,
      requestId,
      receivedBytes: blob.size,
      totalBytes: blob.size,
      percentage: 100
    });
    return blob;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let receivedBytes = 0;
  let lastReportedPct = -1;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedBytes += value.byteLength;

    const pct = contentLength > 0
      ? Math.min(99, Math.floor((receivedBytes / contentLength) * 100))
      : 0;

    if (pct !== lastReportedPct) {
      lastReportedPct = pct;
      self.postMessage({
        event: WORKER_EVENTS.DOWNLOADING,
        requestId,
        receivedBytes,
        totalBytes: contentLength,
        percentage: pct
      });
    }
  }

  // Final 100% signal
  self.postMessage({
    event: WORKER_EVENTS.DOWNLOADING,
    requestId,
    receivedBytes,
    totalBytes: receivedBytes,
    percentage: 100
  });

  // Concatenate chunks into a single Blob
  return new Blob(chunks, { type: 'application/zip' });
}

/**
 * @param {{
 *   requestId: string,
 *   packageUrl: string,
 *   expectedPdfs?: string[],
 *   pdfMetadata?: Record<string, {pdfId?: string, category?: string, manifestRevision?: string}> | null,
 *   contentLength?: number
 * }} params
 */
async function ingestZip({ requestId, packageUrl, expectedPdfs = [], pdfMetadata = null, contentLength = 0 }) {
  const controller = new AbortController();
  abortControllers.set(requestId, controller);

  let zipBlob = null;
  let zipReader = null;

  try {
    self.postMessage({
      event: WORKER_EVENTS.STARTED,
      requestId,
      packageUrl
    });

    // Phase 1: Download with streaming progress
    zipBlob = await fetchZipWithProgress(packageUrl, controller.signal, requestId, contentLength);

    if (controller.signal.aborted) throw new Error('DOWNLOAD_CANCELLED');

    // Phase 2: Extract — list entries and count candidates
    zipReader = new ZipReader(new BlobReader(zipBlob));
    const entries = await zipReader.getEntries();

    // Build the expected set using the shared normalizer so that both
    // /assets/... and assets/... variants are covered.
    const expectedSet = buildExpectedSet(expectedPdfs);

    let totalCandidates = 0;
    for (const entry of entries) {
      if (!entry?.directory && shouldIngestZipEntry(entry.filename, expectedSet)) {
        totalCandidates++;
      }
    }

    // Emit initial EXTRACTING message so the UI can show the extract phase
    self.postMessage({
      event: WORKER_EVENTS.EXTRACTING,
      requestId,
      completed: 0,
      total: totalCandidates,
      percentage: 0
    });

    let extractedCount = 0;
    let stored = 0;
    let failed = 0;

    // Phase 3: Store each PDF entry into IndexedDB
    for (const entry of entries) {
      if (controller.signal.aborted) throw new Error('DOWNLOAD_CANCELLED');

      if (entry?.directory || !shouldIngestZipEntry(entry?.filename, expectedSet)) {
        continue;
      }

      // Emit EXTRACTING progress as we process each entry
      extractedCount++;
      self.postMessage({
        event: WORKER_EVENTS.EXTRACTING,
        requestId,
        completed: extractedCount,
        total: totalCandidates,
        percentage: totalCandidates > 0
          ? Math.floor((extractedCount / totalCandidates) * 100)
          : 0
      });

      const idbId = normalizeIdbId(entry.filename);
      const storagePath = normalizeStoragePath(entry.filename);

      if (!idbId || !storagePath) {
        failed++;
        continue;
      }

      try {
        const blob = await entry.getData(new BlobWriter('application/pdf'));

        // Resolve inventory metadata using both /assets/... and assets/... variants
        const meta = pdfMetadata
          ? (pdfMetadata[idbId] || pdfMetadata[storagePath] || {})
          : {};

        await assetsTable.put({
          id: idbId,
          path: idbId,
          mimeType: blob.type || 'application/pdf',
          size: Number(blob.size || 0),
          updatedAt: Date.now(),
          blob,
          pdfId: meta.pdfId || undefined,
          category: meta.category || undefined,
          status: 'persisted',
          manifestRevision: meta.manifestRevision || undefined
        });

        stored++;
      } catch (entryError) {
        failed++;
        self.postMessage({
          event: WORKER_EVENTS.ENTRY_ERROR,
          requestId,
          path: idbId,
          error: entryError?.message || 'Erro ao processar entrada ZIP'
        });
      }

      // Emit STORING progress periodically
      if (stored % STORE_PROGRESS_EVERY === 0 || stored === totalCandidates) {
        self.postMessage({
          event: WORKER_EVENTS.STORING,
          requestId,
          completed: stored,
          total: totalCandidates,
          percentage: totalCandidates > 0
            ? Math.floor((stored / totalCandidates) * 100)
            : 0
        });
      }

      // Also emit legacy PROGRESS for backward compat
      if (stored % STORE_PROGRESS_EVERY === 0 || stored === totalCandidates) {
        self.postMessage({
          event: WORKER_EVENTS.PROGRESS,
          requestId,
          completed: stored,
          total: totalCandidates,
          stored,
          failed
        });
      }

      if (extractedCount % YIELD_EVERY === 0) {
        await yieldMicroTask();
      }
    }

    self.postMessage({
      event: WORKER_EVENTS.COMPLETE,
      requestId,
      stored,
      extracted: totalCandidates,
      failed,
      bytesDownloaded: Number(zipBlob?.size || 0)
    });
  } catch (error) {
    if (error?.message === 'DOWNLOAD_CANCELLED') {
      self.postMessage({
        event: WORKER_EVENTS.CANCELLED,
        requestId
      });
      return;
    }

    self.postMessage({
      event: WORKER_EVENTS.ERROR,
      requestId,
      error: error?.message || 'Erro inesperado no worker de ZIP'
    });
  } finally {
    abortControllers.delete(requestId);
    if (zipReader) {
      try {
        await zipReader.close();
      } catch {
        // noop
      }
    }
    zipBlob = null;
    zipReader = null;
  }
}

self.onmessage = async (event) => {
  const message = event?.data || {};
  const { command, requestId } = message;

  if (command === WORKER_COMMANDS.CANCEL_JOB) {
    const controller = abortControllers.get(requestId);
    if (controller) controller.abort();
    return;
  }

  if (command === WORKER_COMMANDS.INGEST_ZIP) {
    await ingestZip(message);
  }
};
