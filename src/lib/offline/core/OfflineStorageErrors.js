/**
 * Offline storage error helpers.
 */

export const OFFLINE_ERROR_CODES = {
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED'
};

/**
 * @param {any} error
 * @returns {boolean}
 */
export function isQuotaExceededError(error) {
  if (!error) return false;
  const name = String(error.name || '');
  const message = String(error.message || '').toLowerCase();
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    message.includes('quota exceeded') ||
    message.includes('storage quota')
  );
}

/**
 * @param {Object} [details]
 * @param {number} [details.neededBytes]
 * @param {number} [details.quotaBytes]
 * @param {number} [details.usageBytes]
 * @param {string} [details.causeMessage]
 */
export function createQuotaExceededError(details = {}) {
  const error = /** @type {any} */ (new Error('Espaco insuficiente no navegador para concluir o download offline.'));
  error.name = 'OfflineStorageQuotaError';
  error.code = OFFLINE_ERROR_CODES.QUOTA_EXCEEDED;
  error.errorCode = OFFLINE_ERROR_CODES.QUOTA_EXCEEDED;
  error.neededBytes = details.neededBytes;
  error.quotaBytes = details.quotaBytes;
  error.usageBytes = details.usageBytes;
  error.causeMessage = details.causeMessage;
  return /** @type {Error} */ (error);
}

/**
 * @param {number} neededBytes
 * @param {number} [safetyFactor]
 * @returns {Promise<{supported: boolean, ok: boolean, usageBytes?: number, quotaBytes?: number, neededBytes: number}>}
 */
export async function checkStorageCapacity(neededBytes, safetyFactor = 1.2) {
  const hasEstimateApi =
    typeof navigator !== 'undefined' &&
    navigator.storage &&
    typeof navigator.storage.estimate === 'function';

  if (!hasEstimateApi) {
    return { supported: false, ok: true, neededBytes };
  }

  const estimate = await navigator.storage.estimate();
  const usageBytes = Number(estimate?.usage || 0);
  const quotaBytes = Number(estimate?.quota || 0);

  if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) {
    return { supported: true, ok: true, usageBytes, quotaBytes, neededBytes };
  }

  const reservedNeeded = Math.ceil(Math.max(0, neededBytes) * safetyFactor);
  const freeBytes = Math.max(0, quotaBytes - usageBytes);

  return {
    supported: true,
    ok: freeBytes >= reservedNeeded,
    usageBytes,
    quotaBytes,
    neededBytes: reservedNeeded
  };
}

/**
 * Best-effort request for persistent storage.
 * Browsers may ignore or auto-decide without showing a prompt.
 *
 * @returns {Promise<{supported: boolean, persisted: boolean}>}
 */
export async function requestPersistentStorage() {
  const hasPersistApi =
    typeof navigator !== 'undefined' &&
    navigator.storage &&
    typeof navigator.storage.persist === 'function';

  if (!hasPersistApi) {
    return { supported: false, persisted: false };
  }

  try {
    const persisted = await navigator.storage.persist();
    return { supported: true, persisted: persisted === true };
  } catch {
    return { supported: true, persisted: false };
  }
}
