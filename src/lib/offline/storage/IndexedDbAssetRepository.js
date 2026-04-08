import { browser } from '$app/environment';
import { createLogger } from '../utils/OfflineLogger.js';
import PdfPathManager from '../utils/PdfPathManager.js';
import offlineDexieDb from './dexieDb.js';

const logger = createLogger('IndexedDbAssetRepository');

export class IndexedDbAssetRepository {
  constructor() {
    this.table = offlineDexieDb.table('assets');
  }

  _normalizeId(path) {
    const normalized = PdfPathManager.normalizeForStorage(path);
    if (!normalized) return '';
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }

  async putAsset(path, blob, metadata = {}) {
    if (!browser || !(blob instanceof Blob)) {
      return false;
    }

    const id = this._normalizeId(path);
    if (!id) return false;

    const row = {
      id,
      path: id,
      mimeType: metadata.mimeType || blob.type || 'application/octet-stream',
      size: Number(blob.size || 0),
      updatedAt: Date.now(),
      blob
    };

    await this.table.put(row);
    return true;
  }

  async getAssetBlob(path) {
    if (!browser) return null;
    const id = this._normalizeId(path);
    if (!id) return null;

    const row = await this.table.get(id);
    return row?.blob || null;
  }

  async hasAsset(path) {
    if (!browser) return false;
    const id = this._normalizeId(path);
    if (!id) return false;
    const count = await this.table.where('id').equals(id).count();
    return count > 0;
  }

  async deleteAsset(path) {
    if (!browser) return false;
    const id = this._normalizeId(path);
    if (!id) return false;
    await this.table.delete(id);
    return true;
  }

  async listAssets() {
    if (!browser) return [];
    const rows = await this.table.toArray();
    return rows.map((row) => row.path).filter(Boolean);
  }

  async clear() {
    if (!browser) return;
    await this.table.clear();
    logger.info('IndexedDbAssetRepository', 'Cleared IndexedDB assets table');
  }
}

const indexedDbAssetRepository = new IndexedDbAssetRepository();
export default indexedDbAssetRepository;
