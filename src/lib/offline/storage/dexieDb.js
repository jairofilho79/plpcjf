import Dexie from 'dexie';
import { getConfig } from '../core/OfflineConfig.js';

const DB_NAME = getConfig('OFFLINE_IDB_NAME') || 'plpc-offline-db';
const DB_VERSION = Number(getConfig('OFFLINE_IDB_VERSION') || 1);

/**
 * Dexie schema:
 * - id: stable normalized key (path)
 * - path: original/normalized path
 * - mimeType: media type
 * - size: blob size
 * - updatedAt: epoch millis
 * - blob: payload (Blob)
 */
class OfflineDexieDb extends Dexie {
  constructor() {
    super(DB_NAME);
    this.version(DB_VERSION).stores({
      assets: '&id,path,updatedAt,mimeType,size'
    });
  }
}

export const offlineDexieDb = new OfflineDexieDb();

export default offlineDexieDb;
