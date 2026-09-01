/**
 * Cache de validação de PDFs em um único registro de storage.
 *
 * Antes: uma chave por pdfId (`pdfValidation_<base64>`) — milhares de chaves,
 * encostando no teto de ~5 MB, com varredura síncrona de todo o localStorage
 * quando a cota estourava.
 *
 * Recebe o storage por parâmetro para ser testável sob `node --test` sem DOM.
 */

export const VALIDATION_CACHE_KEY = 'pdfValidationCache_v1';
export const VALIDATION_CACHE_TTL = 24 * 60 * 60 * 1000;

const LEGACY_PREFIX = 'pdfValidation_';

/**
 * @param {Storage} storage
 * @returns {{ v: number, entries: Record<string, [0|1, string, number]> }}
 */
function readAll(storage) {
  try {
    const raw = storage.getItem(VALIDATION_CACHE_KEY);
    if (!raw) return { v: 1, entries: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1 || typeof parsed.entries !== 'object') {
      return { v: 1, entries: {} };
    }
    return parsed;
  } catch {
    return { v: 1, entries: {} };
  }
}

/**
 * @param {Storage} storage
 * @param {{ v: number, entries: Record<string, [0|1, string, number]> }} data
 * @returns {boolean} true se a gravação (ou o fallback de cache vazio) teve sucesso
 */
function writeAll(storage, data) {
  try {
    storage.setItem(VALIDATION_CACHE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    // Cota estourada: descarta o cache inteiro (é reconstruível) e tenta uma vez.
    try {
      storage.removeItem(VALIDATION_CACHE_KEY);
      storage.setItem(VALIDATION_CACHE_KEY, JSON.stringify({ v: 1, entries: {} }));
    } catch {
      // Storage indisponível (modo privado): seguir sem cache.
    }
    return false;
  }
}

/**
 * @param {Storage} storage
 * @param {string} pdfId
 * @param {number} now
 * @returns {{ available: boolean, url: string } | null}
 */
export function readValidationEntry(storage, pdfId, now) {
  if (!pdfId) return null;
  const data = readAll(storage);
  const entry = data.entries[pdfId];
  if (!Array.isArray(entry)) return null;

  const [available, url, timestamp] = entry;
  if (now - timestamp > VALIDATION_CACHE_TTL) {
    delete data.entries[pdfId];
    writeAll(storage, data);
    return null;
  }

  return { available: available === 1, url: url || '' };
}

/**
 * @param {Storage} storage
 * @param {string} pdfId
 * @param {{ available: boolean, url: string }} entry
 * @param {number} now
 */
export function writeValidationEntry(storage, pdfId, entry, now) {
  if (!pdfId || !entry) return;
  const data = readAll(storage);
  data.entries[pdfId] = [entry.available ? 1 : 0, entry.url || '', now];
  writeAll(storage, data);
}

/**
 * @param {Storage} storage
 * @param {string} pdfId
 */
export function removeValidationEntry(storage, pdfId) {
  if (!pdfId) return;
  const data = readAll(storage);
  if (data.entries[pdfId] === undefined) return;
  delete data.entries[pdfId];
  writeAll(storage, data);
}

/** @param {Storage} storage */
export function clearValidationCache(storage) {
  try {
    storage.removeItem(VALIDATION_CACHE_KEY);
  } catch {
    // ignorar
  }
}

/**
 * Move as chaves antigas `pdfValidation_*` para o registro único e as apaga.
 * Roda uma vez por sessão; é barato quando não há nada a migrar.
 *
 * @param {Storage} storage
 * @returns {number} quantidade de chaves antigas removidas
 */
export function migrateLegacyValidationKeys(storage) {
  /** @type {string[]} */
  const legacyKeys = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(LEGACY_PREFIX) && key !== VALIDATION_CACHE_KEY) {
        legacyKeys.push(key);
      }
    }
  } catch {
    return 0;
  }

  if (legacyKeys.length === 0) return 0;

  const data = readAll(storage);
  for (const key of legacyKeys) {
    try {
      const raw = storage.getItem(key);
      if (raw) {
        const { available, url, timestamp } = JSON.parse(raw);
        const pdfId = key.slice(LEGACY_PREFIX.length);
        data.entries[pdfId] = [available ? 1 : 0, url || '', timestamp || 0];
      }
    } catch {
      // entrada ilegível: apenas descartar
    }
  }

  // Grava o registro consolidado ANTES de apagar as chaves antigas: se a
  // gravação falhar (cota estourada, storage bloqueado), aborta sem apagar
  // nada — o pior caso vira "migra de novo na próxima sessão", nunca "perdeu
  // o dado porque a chave antiga já tinha sumido antes do registro existir".
  if (!writeAll(storage, data)) return 0;

  for (const key of legacyKeys) {
    try {
      storage.removeItem(key);
    } catch {
      // ignorar
    }
  }

  return legacyKeys.length;
}
