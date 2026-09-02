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
 * Quantas chaves antigas por lote de migração. Ver `migrateLegacyValidationKeys`.
 */
const MIGRATION_BATCH_SIZE = 200;

/**
 * Move as chaves antigas `pdfValidation_*` para o registro único e as apaga.
 * Roda uma vez por sessão; é barato quando não há nada a migrar.
 *
 * Migra **por lotes**, e apaga as chaves de cada lote mesmo quando a gravação
 * consolidada falha. As duas coisas existem pela mesma razão, e é o aparelho
 * com o problema que as exige: quem tem milhares de chaves antigas é
 * exatamente quem está encostado ao teto de ~5 MB por origem.
 *
 * A versão anterior montava o registro inteiro e gravava-o de uma vez, com
 * todas as chaves antigas ainda no storage — o pico de ocupação era
 * "antigo + consolidado", que é justamente o que não cabe. O `setItem`
 * estourava, o fallback de `writeAll` descartava o registro, e a função saía
 * com `return 0` sem apagar nada. Nesse aparelho a limpeza nunca acontecia:
 * pagava-se a enumeração do storage e um `JSON.stringify` de vários MB em
 * cada sessão, para sempre, sem libertar um byte.
 *
 * Por lotes, o apagamento de cada lote liberta espaço para a gravação do
 * seguinte, e o pior caso deixa de ser "não liberta nada".
 *
 * **O que se perde quando um lote não cabe é mais do que esse lote.** O
 * fallback de `writeAll` descarta o registro **inteiro** e regrava-o vazio,
 * portanto um lote que estoure a meio leva com ele tudo o que os lotes
 * anteriores já tinham consolidado. Na prática, uma falha tardia aproxima-se
 * de "perdeu-se o cache todo". Continua a ser um cache reconstruível com TTL
 * de 24 h — o custo é revalidar, não perder dado do utilizador — contra
 * megabytes que de outro modo ficavam presos para sempre. A troca é
 * deliberada e não é simétrica; quem a quiser mudar tem de mudar antes o
 * fallback de `writeAll`, não este laço.
 *
 * @param {Storage} storage
 * @returns {{ removidas: number, restantes: number }}
 *   `restantes > 0` é uma tentativa incompleta: quem chama **não** deve marcar
 *   a migração como feita.
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
    // Sem conseguir enumerar não há nada a migrar nem nada a apagar.
    return { removidas: 0, restantes: 0 };
  }

  if (legacyKeys.length === 0) return { removidas: 0, restantes: 0 };

  let removidas = 0;

  for (let inicio = 0; inicio < legacyKeys.length; inicio += MIGRATION_BATCH_SIZE) {
    const lote = legacyKeys.slice(inicio, inicio + MIGRATION_BATCH_SIZE);

    const data = readAll(storage);
    for (const key of lote) {
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

    // O resultado de `writeAll` diz se o dado foi preservado, não se o lote
    // sai. O lote sai sempre — é o apagamento que liberta o espaço, e negá-lo
    // por a gravação ter falhado era o que trancava o aparelho cheio.
    writeAll(storage, data);

    for (const key of lote) {
      try {
        storage.removeItem(key);
        removidas++;
      } catch {
        // Chave que resistiu: fica contada em `restantes` e tenta-se de novo
        // na próxima sessão.
      }
    }
  }

  return { removidas, restantes: legacyKeys.length - removidas };
}
