export const WORKER_COMMANDS = {
  INGEST_ZIP: 'INGEST_ZIP',
  CANCEL_JOB: 'CANCEL_JOB'
};

export const WORKER_EVENTS = {
  /** Emitted periodically while the ZIP is being fetched from the network. */
  DOWNLOADING: 'DOWNLOADING',
  /** Emitted as ZIP entries are decoded (extract phase). */
  EXTRACTING: 'EXTRACTING',
  /** Emitted as extracted PDFs are written to IndexedDB (store phase). */
  STORING: 'STORING',
  /** Legacy alias for STORING — kept for backward compat, maps to same semantics. */
  PROGRESS: 'PROGRESS',
  STARTED: 'STARTED',
  ENTRY_ERROR: 'ENTRY_ERROR',
  COMPLETE: 'COMPLETE',
  ERROR: 'ERROR',
  CANCELLED: 'CANCELLED'
};
