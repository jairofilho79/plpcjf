import Dexie from 'dexie';
import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';
import { WORKER_COMMANDS, WORKER_EVENTS } from './workerProtocol.js';

const DB_NAME = 'plpc-offline-db';
const PROGRESS_EVERY = 5;
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

function normalizePath(path) {
  if (!path) return '';
  const value = String(path).replace(/^\/+/, '').trim();
  if (!value) return '';
  return `/${value}`;
}

function shouldIngestEntry(entryName, expectedSet) {
  const normalized = normalizePath(entryName);
  if (!normalized || !normalized.toLowerCase().endsWith('.pdf')) return false;
  if (!expectedSet || expectedSet.size === 0) return true;

  return (
    expectedSet.has(normalized) ||
    expectedSet.has(normalized.slice(1))
  );
}

async function yieldMicroTask() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * @param {{
 *   requestId: string,
 *   packageUrl: string,
 *   expectedPdfs?: string[],
 *   pdfMetadata?: Record<string, {pdfId?: string, category?: string, manifestRevision?: string}>|null
 * }} params
 */
async function ingestZip({ requestId, packageUrl, expectedPdfs = [], pdfMetadata = null }) {
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

    const response = await fetch(packageUrl, {
      signal: controller.signal,
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`Falha ao baixar pacote: ${response.status} ${response.statusText}`);
    }

    zipBlob = await response.blob();
    zipReader = new ZipReader(new BlobReader(zipBlob));
    const entries = await zipReader.getEntries();
    const expectedSet = new Set(expectedPdfs.map((p) => normalizePath(p)).filter(Boolean));

    let totalCandidates = 0;
    for (const entry of entries) {
      if (!entry?.directory && shouldIngestEntry(entry.filename, expectedSet)) {
        totalCandidates++;
      }
    }

    let processed = 0;
    let stored = 0;
    let failed = 0;

    for (const entry of entries) {
      if (controller.signal.aborted) {
        throw new Error('DOWNLOAD_CANCELLED');
      }

      const normalizedPath = normalizePath(entry?.filename || '');
      if (entry?.directory || !shouldIngestEntry(entry?.filename, expectedSet)) {
        continue;
      }

      try {
        const blob = await entry.getData(new BlobWriter('application/pdf'));

        // Resolve inventory metadata: try both "/path" and "path" key variants
        const meta = pdfMetadata
          ? (pdfMetadata[normalizedPath] || pdfMetadata[normalizedPath.slice(1)] || {})
          : {};

        await assetsTable.put({
          id: normalizedPath,
          path: normalizedPath,
          mimeType: blob.type || 'application/pdf',
          size: Number(blob.size || 0),
          updatedAt: Date.now(),
          blob,
          // v2 inventory fields
          pdfId: meta.pdfId || undefined,
          category: meta.category || undefined,
          status: 'persisted',
          manifestRevision: meta.manifestRevision || undefined
        });
        stored++;

        // release blob ref ASAP to reduce peak RAM pressure
      } catch (entryError) {
        failed++;
        self.postMessage({
          event: WORKER_EVENTS.ENTRY_ERROR,
          requestId,
          path: normalizedPath,
          error: entryError?.message || 'Erro ao processar entrada ZIP'
        });
      } finally {
        processed++;
      }

      if (processed % PROGRESS_EVERY === 0 || processed === totalCandidates) {
        self.postMessage({
          event: WORKER_EVENTS.PROGRESS,
          requestId,
          completed: processed,
          total: totalCandidates,
          stored,
          failed
        });
      }

      if (processed % YIELD_EVERY === 0) {
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
