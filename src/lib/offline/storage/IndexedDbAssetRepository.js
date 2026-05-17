import { browser } from '$app/environment';
import { createLogger } from '../utils/OfflineLogger.js';
import { normalizeIdbId } from '../utils/offlinePathNormalize.js';
import offlineDexieDb from './dexieDb.js';

const logger = createLogger('IndexedDbAssetRepository');

export class IndexedDbAssetRepository {
  constructor() {
    this.table = offlineDexieDb.table('assets');
  }

  _normalizeId(path) {
    return normalizeIdbId(path);
  }

  /**
   * Store a PDF blob with optional inventory metadata.
   *
   * New metadata fields (all optional, default gracefully):
   *   pdfId           — base64 manifest ID (indexes for fast lookup)
   *   category        — category name (indexed for per-category queries)
   *   status          — 'persisted' | 'migrated' | 'error' (default: 'persisted')
   *   manifestRevision — string revision from the manifest at download time
   */
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
      blob,
      pdfId: metadata.pdfId || undefined,
      category: metadata.category || undefined,
      status: metadata.status || 'persisted',
      manifestRevision: metadata.manifestRevision || undefined
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

  /** Returns the full row (metadata + blob) for a given path. */
  async getAssetRow(path) {
    if (!browser) return null;
    const id = this._normalizeId(path);
    if (!id) return null;
    return this.table.get(id) || null;
  }

  async hasAsset(path) {
    if (!browser) return false;
    const id = this._normalizeId(path);
    if (!id) return false;
    const count = await this.table.where('id').equals(id).count();
    return count > 0;
  }

  /** Returns true if a row with the given pdfId exists. */
  async hasByPdfId(pdfId) {
    if (!browser || !pdfId) return false;
    const count = await this.table.where('pdfId').equals(pdfId).count();
    return count > 0;
  }

  async deleteAsset(path) {
    if (!browser) return false;
    const id = this._normalizeId(path);
    if (!id) return false;
    await this.table.delete(id);
    return true;
  }

  /** Returns all stored normalized paths. */
  async listAssets() {
    if (!browser) return [];
    const rows = await this.table.toArray();
    return rows.map((row) => row.path).filter(Boolean);
  }

  /**
   * Returns lightweight rows (no blob) for efficient inventory queries.
   * Blob is excluded by only collecting the scalar fields.
   */
  async listAssetMeta() {
    if (!browser) return [];
    return this.table
      .toCollection()
      .toArray()
      .then((rows) =>
        rows.map(({ id, path, pdfId, category, status, size, mimeType, updatedAt, manifestRevision }) => ({
          id,
          path,
          pdfId,
          category,
          status,
          size,
          mimeType,
          updatedAt,
          manifestRevision
        }))
      );
  }

  /**
   * Returns lightweight rows for a specific category (no blob fetch).
   * Requires category index (schema v2).
   */
  async listAssetMetaByCategory(category) {
    if (!browser || !category) return [];
    return this.table
      .where('category')
      .equals(category)
      .toArray()
      .then((rows) =>
        rows.map(({ id, path, pdfId, category: cat, status, size, updatedAt }) => ({
          id,
          path,
          pdfId,
          category: cat,
          status,
          size,
          updatedAt
        }))
      );
  }

  /** Returns a Set of all normalized ids for O(1) membership tests. */
  async getPersistedIdSet() {
    if (!browser) return new Set();
    const ids = await this.table.toCollection().primaryKeys();
    return new Set(ids);
  }

  /**
   * Returns a Set combining all normalized paths AND pdfIds so callers can
   * check membership with either key in O(1).
   */
  async getPersistedLookupSet() {
    if (!browser) return new Set();
    const metas = await this.listAssetMeta();
    const set = new Set();
    for (const { id, pdfId } of metas) {
      if (id) set.add(id);
      if (pdfId) set.add(pdfId);
    }
    return set;
  }

  /** Total count, optionally filtered by category. */
  async countAssets(category) {
    if (!browser) return 0;
    if (category) {
      return this.table.where('category').equals(category).count();
    }
    return this.table.count();
  }

  async clear() {
    if (!browser) return;
    await this.table.clear();
    logger.info('IndexedDbAssetRepository', 'Cleared IndexedDB assets table');
  }
}

const indexedDbAssetRepository = new IndexedDbAssetRepository();
export default indexedDbAssetRepository;
