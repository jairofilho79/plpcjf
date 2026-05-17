/**
 * OfflineInventoryRepository
 *
 * Single source of truth for offline PDF availability.
 *
 * Design goals:
 *  - Queries consult IndexedDB exclusively — never the Cache API or network.
 *  - "Persisted" means a valid IDB row exists with a blob; no other signal counts.
 *  - Provides synchronous helpers that accept a pre-fetched Set (for bulk ops in loops)
 *    and async helpers that fetch the set internally (for one-off queries).
 *  - All status answers are deterministic: 'persisted' | 'missing' | 'unknown'.
 */

import { browser } from '$app/environment';
import indexedDbAssetRepository from './IndexedDbAssetRepository.js';
import { getPdfRelPath } from '$lib/utils/pathUtils.js';
import { createLogger } from '../utils/OfflineLogger.js';
import PdfPathManager from '../utils/PdfPathManager.js';

const logger = createLogger('OfflineInventoryRepository');

/** Offline availability status values. */
export const PDF_STATUS = /** @type {const} */ ({
  PERSISTED: 'persisted',
  MISSING: 'missing',
  UNKNOWN: 'unknown'
});

export class OfflineInventoryRepository {
  constructor(repo = indexedDbAssetRepository) {
    this._repo = repo;
  }

  // ---------------------------------------------------------------------------
  // Write helpers
  // ---------------------------------------------------------------------------

  /**
   * Canonical write path: stores a PDF blob with full inventory metadata.
   *
   * @param {string} path         - Normalized storage path (e.g. 'assets/ColAdultos/001.pdf')
   * @param {Blob}   blob         - The PDF blob
   * @param {{
   *   pdfId?: string,
   *   category?: string,
   *   status?: string,
   *   manifestRevision?: string,
   *   mimeType?: string
   * }} [meta]
   * @returns {Promise<boolean>}
   */
  async storePdf(path, blob, meta = {}) {
    return this._repo.putAsset(path, blob, {
      pdfId: meta.pdfId,
      category: meta.category,
      status: meta.status || 'persisted',
      manifestRevision: meta.manifestRevision,
      mimeType: meta.mimeType
    });
  }

  // ---------------------------------------------------------------------------
  // Lookup set — the fast-path for bulk queries
  // ---------------------------------------------------------------------------

  /**
   * Builds a Set containing both normalized paths AND pdfIds for every persisted
   * entry.  Callers can check membership in O(1) with either key.
   *
   * @returns {Promise<Set<string>>}
   */
  async getPersistedLookupSet() {
    return this._repo.getPersistedLookupSet();
  }

  // ---------------------------------------------------------------------------
  // Single-PDF queries
  // ---------------------------------------------------------------------------

  /**
   * Checks whether a louvor PDF is persisted in IndexedDB.
   *
   * Tries pdfId first (exact match), then the decoded path.
   *
   * @param {object} louvor - louvor entry with pdfId
   * @returns {Promise<boolean>}
   */
  async hasPdf(louvor) {
    if (!browser || !louvor?.pdfId) return false;

    // Try pdfId-based lookup first (v2 index, avoids full path decode)
    if (await this._repo.hasByPdfId(louvor.pdfId)) return true;

    // Fall back to path-based lookup (also handles legacy rows without pdfId stored)
    const relPath = getPdfRelPath(louvor);
    if (relPath) {
      return this._repo.hasAsset(relPath);
    }
    return false;
  }

  /**
   * Returns the PDF blob for a louvor, or null if not persisted.
   *
   * @param {object} louvor
   * @returns {Promise<Blob|null>}
   */
  async getBlob(louvor) {
    if (!browser || !louvor?.pdfId) return null;
    const relPath = getPdfRelPath(louvor);
    if (!relPath) return null;
    return this._repo.getAssetBlob(relPath);
  }

  // ---------------------------------------------------------------------------
  // Bulk / category queries
  // ---------------------------------------------------------------------------

  /**
   * Returns all normalized paths persisted in IndexedDB.
   *
   * @returns {Promise<string[]>}
   */
  async listPersistedPaths() {
    return this._repo.listAssets();
  }

  /**
   * Returns lightweight metadata rows (no blob) for a given category.
   *
   * @param {string} category
   * @returns {Promise<Array>}
   */
  async listByCategoryMeta(category) {
    return this._repo.listAssetMetaByCategory(category);
  }

  /**
   * Total count of persisted PDFs, optionally filtered by category.
   *
   * @param {string} [category]
   * @returns {Promise<number>}
   */
  async count(category) {
    return this._repo.countAssets(category);
  }

  // ---------------------------------------------------------------------------
  // Missing-PDF computation
  // ---------------------------------------------------------------------------

  /**
   * Synchronously computes missing PDFs given a pre-fetched Set.
   *
   * Returns an object with:
   *   confirmedMissing — louvores definitely not in the set
   *   unknown          — louvores with no pdfId (cannot determine)
   *
   * This is intentionally synchronous so it can be called in tight loops without
   * awaiting IDB on every iteration.
   *
   * @param {object[]} louvores     - Full louvor array
   * @param {Set<string>} persistedSet  - Result of getPersistedLookupSet()
   * @returns {{ confirmedMissing: object[], unknown: object[] }}
   */
  computeMissingPdfsDetailed(louvores, persistedSet) {
    if (!louvores || louvores.length === 0) {
      return { confirmedMissing: [], unknown: [] };
    }

    if (!persistedSet || !(persistedSet instanceof Set)) {
      return {
        confirmedMissing: [],
        unknown: louvores.filter((l) => l.pdfId)
      };
    }

    const confirmedMissing = [];
    const unknown = [];

    for (const louvor of louvores) {
      if (!louvor.pdfId) {
        continue;
      }

      // Primary check: pdfId is directly in the set (v2 rows)
      if (persistedSet.has(louvor.pdfId)) continue;

      // Secondary check: try decoded path variants
      const relPath = getPdfRelPath(louvor);
      if (relPath) {
        // Normalized id stored in IDB starts with '/'
        const withSlash = relPath.startsWith('/') ? relPath : `/${relPath}`;
        if (persistedSet.has(withSlash) || persistedSet.has(relPath)) continue;

        // Also try PdfPathManager normalization (handles legacy v1 rows)
        const normalized = PdfPathManager.normalizeForStorage(relPath);
        if (normalized) {
          const normWithSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
          if (persistedSet.has(normWithSlash) || persistedSet.has(normalized)) continue;
        }
      }

      confirmedMissing.push(louvor);
    }

    return { confirmedMissing, unknown };
  }

  /**
   * Synchronous variant that returns only the missing array.
   *
   * @param {object[]} louvores
   * @param {Set<string>} persistedSet
   * @returns {object[]}
   */
  computeMissingPdfs(louvores, persistedSet) {
    return this.computeMissingPdfsDetailed(louvores, persistedSet).confirmedMissing;
  }

  /**
   * Async convenience: fetches the persisted set then computes missing PDFs.
   *
   * @param {object[]} louvores
   * @returns {Promise<object[]>}
   */
  async findMissingPdfs(louvores) {
    const set = await this.getPersistedLookupSet();
    return this.computeMissingPdfs(louvores, set);
  }

  /**
   * Async convenience returning both lists.
   *
   * @param {object[]} louvores
   * @returns {Promise<{ confirmedMissing: object[], unknown: object[] }>}
   */
  async findMissingPdfsDetailed(louvores) {
    const set = await this.getPersistedLookupSet();
    return this.computeMissingPdfsDetailed(louvores, set);
  }

  // ---------------------------------------------------------------------------
  // Statistics computation
  // ---------------------------------------------------------------------------

  /**
   * Computes per-category stats in a single IDB scan (no per-category round trips).
   *
   * @param {string[]} categories   - Category names to compute stats for
   * @param {Map<string, object[]>} louvoresDataMap - Map<category, louvorArray>
   * @param {Set<string>} [persistedSet] - Pre-fetched set (fetched internally if omitted)
   * @returns {Promise<Map<string, { total: number, available: number, missing: number, percentage: number }>>}
   */
  async computeStats(categories, louvoresDataMap, persistedSet) {
    const set = persistedSet || (await this.getPersistedLookupSet());

    /** @type {Map<string, { total: number, available: number, missing: number, percentage: number }>} */
    const stats = new Map();

    for (const category of categories) {
      const louvores = louvoresDataMap.get(category) || [];
      const total = louvores.filter((l) => l.pdfId).length;
      const missing = this.computeMissingPdfs(louvores, set).length;
      const available = total - missing;
      const percentage = total > 0 ? Math.round((available / total) * 100) : 0;

      stats.set(category, { total, available, missing, percentage });
    }

    return stats;
  }

  /**
   * Computes stats for all categories visible in a louvoresDataMap.
   * Convenience wrapper around computeStats.
   *
   * @param {Map<string, object[]>} louvoresDataMap
   * @returns {Promise<Map<string, { total: number, available: number, missing: number, percentage: number }>>}
   */
  async computeAllStats(louvoresDataMap) {
    return this.computeStats(Array.from(louvoresDataMap.keys()), louvoresDataMap);
  }

  // ---------------------------------------------------------------------------
  // Diagnostic helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns a per-louvor status map for diagnostic/debug use.
   *
   * @param {object[]} louvores
   * @returns {Promise<Map<string, 'persisted'|'missing'|'unknown'>>}
   */
  async getStatusMap(louvores) {
    const set = await this.getPersistedLookupSet();
    /** @type {Map<string, string>} */
    const map = new Map();

    for (const louvor of louvores) {
      if (!louvor.pdfId) {
        map.set(louvor.pdfId || louvor.id, PDF_STATUS.UNKNOWN);
        continue;
      }

      const { confirmedMissing } = this.computeMissingPdfsDetailed([louvor], set);
      map.set(louvor.pdfId, confirmedMissing.length === 0 ? PDF_STATUS.PERSISTED : PDF_STATUS.MISSING);
    }

    return map;
  }
}

const offlineInventoryRepository = new OfflineInventoryRepository();
export default offlineInventoryRepository;
