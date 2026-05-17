import { WORKER_COMMANDS, WORKER_EVENTS } from './workerProtocol.js';

export class ZipWorkerClient {
  constructor() {
    this.worker = null;
    this.pending = new Map();
  }

  _ensureWorker() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./zipIngest.worker.js', import.meta.url), {
        type: 'module'
      });
      this.worker.onmessage = (event) => this._handleWorkerMessage(event.data);
    }
  }

  _handleWorkerMessage(message) {
    const { requestId, event } = message || {};
    if (!requestId || !this.pending.has(requestId)) return;

    const handlers = this.pending.get(requestId);
    if (!handlers) return;

    if (event === WORKER_EVENTS.PROGRESS || event === WORKER_EVENTS.ENTRY_ERROR || event === WORKER_EVENTS.STARTED) {
      handlers.onProgress?.(message);
      return;
    }

    if (event === WORKER_EVENTS.COMPLETE) {
      this.pending.delete(requestId);
      handlers.resolve(message);
      return;
    }

    if (event === WORKER_EVENTS.CANCELLED) {
      this.pending.delete(requestId);
      handlers.reject(new Error('DOWNLOAD_CANCELLED'));
      return;
    }

    if (event === WORKER_EVENTS.ERROR) {
      this.pending.delete(requestId);
      handlers.reject(new Error(message?.error || 'Erro no worker de ZIP'));
    }
  }

  /**
   * @param {{
   *   packageUrl: string,
   *   expectedPdfs?: string[],
   *   onProgress?: Function,
   *   abortSignal?: AbortSignal|null,
   *   pdfMetadata?: Record<string, {pdfId?: string, category?: string, manifestRevision?: string}>|null
   * }} options
   */
  ingestZip({ packageUrl, expectedPdfs = [], onProgress = null, abortSignal = null, pdfMetadata = null }) {
    this._ensureWorker();
    const requestId = `zip-worker-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {
        resolve,
        reject,
        onProgress
      });

      if (abortSignal) {
        abortSignal.addEventListener(
          'abort',
          () => {
            this.worker?.postMessage({
              command: WORKER_COMMANDS.CANCEL_JOB,
              requestId
            });
          },
          { once: true }
        );
      }

      this.worker.postMessage({
        command: WORKER_COMMANDS.INGEST_ZIP,
        requestId,
        packageUrl,
        expectedPdfs,
        pdfMetadata
      });
    });
  }
}

const zipWorkerClient = new ZipWorkerClient();
export default zipWorkerClient;
