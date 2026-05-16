import Dexie from 'dexie';
import { getConfig } from '../core/OfflineConfig.js';

const DB_NAME = getConfig('OFFLINE_IDB_NAME') || 'plpc-offline-db';

/**
 * Dexie schema — version history:
 *
 * v1: id, path, updatedAt, mimeType, size, blob
 * v2: + pdfId (base64 manifest ID), category, status, manifestRevision indexes
 *
 * The version is hardcoded in the class, not driven by config, so that
 * schema migrations always run correctly regardless of OfflineConfig values.
 */
class OfflineDexieDb extends Dexie {
  constructor() {
    super(DB_NAME);

    // v1 — original schema; must be declared so Dexie can upgrade existing DBs
    this.version(1).stores({
      assets: '&id,path,updatedAt,mimeType,size'
    });

    // v2 — canonical inventory: indexes for pdfId, category and status
    // allow efficient per-category listing and pdfId-based lookups without
    // scanning the full blob table.
    this.version(2).stores({
      assets: '&id,path,pdfId,category,updatedAt,mimeType,size,status,manifestRevision'
    });
  }
}

export const offlineDexieDb = new OfflineDexieDb();

export default offlineDexieDb;
