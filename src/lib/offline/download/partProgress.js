/**
 * Retomada e retentativa do download por partes.
 *
 * Cada pacote tem ~30 MB e uma categoria chega a 17 partes: sem isso, uma queda
 * de rede na parte 12 obrigava a refazer as 12 anteriores.
 *
 * Só importa por caminho relativo e não toca em `$app/*` — precisa rodar sob
 * `node --test`.
 */

const KEY_PREFIX = 'plpc:downloadParts:';

/** Versão do formato gravado. Registro de versão diferente é descartado. */
const RECORD_VERSION = 1;

/**
 * Validade do estado de retomada. Depois disso o servidor provavelmente já
 * regerou os pacotes e retomar é mais arriscado do que rebaixar tudo.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @typedef {{ getItem: (k: string) => string | null, setItem: (k: string, v: string) => void, removeItem: (k: string) => void }} PartStorage
 */

/**
 * @param {string} downloadKey
 * @returns {string}
 */
function storageKey(downloadKey) {
  return KEY_PREFIX + downloadKey;
}

/**
 * Hash FNV-1a de 32 bits em hexadecimal. Só precisa ser estável e barato:
 * serve para comparar dois conjuntos de partes, não para segurança.
 * @param {string} input
 * @returns {string}
 */
function fnv1a(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Impressão digital do conjunto de partes de uma categoria no servidor.
 *
 * É o que impede que uma retomada emende partes novas em partes velhas: se o
 * manifesto mudou (parte renomeada, redividida ou com outro tamanho), a
 * impressão muda e o estado antigo é descartado em vez de reaproveitado.
 *
 * @param {Array<{ filename?: string, size?: number }> | null | undefined} parts
 * @param {string} [manifestTag] versão/timestamp do manifesto, quando houver
 * @returns {string}
 */
export function computePartsFingerprint(parts, manifestTag = '') {
  const list = Array.isArray(parts) ? parts : [];
  const normalized = list
    .map((p) => `${p?.filename ?? ''}:${p?.size ?? 0}`)
    .sort()
    .join(',');
  return fnv1a(`${manifestTag}|${list.length}|${normalized}`);
}

/**
 * Lê o registro cru, já validado. Devolve null quando não há nada aproveitável.
 * @param {PartStorage} storage
 * @param {string} downloadKey
 * @returns {{ fingerprint: string, savedAt: number, parts: string[] } | null}
 */
function readRecord(storage, downloadKey) {
  try {
    const raw = storage.getItem(storageKey(downloadKey));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.v !== RECORD_VERSION) return null;
    if (!Array.isArray(parsed.parts)) return null;

    return {
      fingerprint: typeof parsed.fingerprint === 'string' ? parsed.fingerprint : '',
      savedAt: Number.isFinite(parsed.savedAt) ? parsed.savedAt : 0,
      parts: parsed.parts.filter((/** @type {unknown} */ p) => typeof p === 'string')
    };
  } catch {
    // JSON corrompido, storage bloqueado: trata como "nada gravado".
    return null;
  }
}

/**
 * Partes já gravadas em uma tentativa anterior deste mesmo download.
 *
 * Devolve conjunto vazio (e apaga o registro) quando o estado não vale mais:
 * formato antigo, JSON corrompido, mais de 7 dias, ou impressão digital
 * diferente da atual — ou seja, quando os pacotes mudaram no servidor.
 *
 * @param {PartStorage} storage
 * @param {string} downloadKey normalmente a categoria
 * @param {string} [expectedFingerprint] de `computePartsFingerprint`; sem ele não há checagem
 * @param {number} [now] injetável em teste
 * @returns {Set<string>} nomes de arquivo das partes já gravadas
 */
export function readCompletedParts(storage, downloadKey, expectedFingerprint, now = Date.now()) {
  const record = readRecord(storage, downloadKey);
  if (!record) return new Set();

  const expired = record.savedAt > 0 && now - record.savedAt > MAX_AGE_MS;
  const mismatch =
    typeof expectedFingerprint === 'string' &&
    expectedFingerprint.length > 0 &&
    record.fingerprint !== expectedFingerprint;

  if (expired || mismatch) {
    clearCompletedParts(storage, downloadKey);
    return new Set();
  }

  return new Set(record.parts);
}

/**
 * Registra uma parte inteiramente gravada no cache.
 *
 * Se a impressão digital mudou desde o registro anterior, recomeça a lista do
 * zero em vez de acrescentar a ela.
 *
 * @param {PartStorage} storage
 * @param {string} downloadKey
 * @param {string} filename
 * @param {string} [fingerprint]
 * @param {number} [now] injetável em teste
 */
export function markPartCompleted(storage, downloadKey, filename, fingerprint = '', now = Date.now()) {
  if (!filename) return;

  try {
    const done = readCompletedParts(storage, downloadKey, fingerprint, now);
    done.add(filename);
    storage.setItem(
      storageKey(downloadKey),
      JSON.stringify({
        v: RECORD_VERSION,
        fingerprint,
        savedAt: now,
        parts: [...done]
      })
    );
  } catch {
    // Sem persistência: o download continua, só perde a retomada.
  }
}

/**
 * @param {PartStorage} storage
 * @param {string} downloadKey
 */
export function clearCompletedParts(storage, downloadKey) {
  try {
    storage.removeItem(storageKey(downloadKey));
  } catch {
    // ignorar
  }
}

/**
 * Apaga o estado de retomada de todos os downloads.
 * Usado quando o cache de PDFs inteiro é limpo: sem os arquivos, retomar não
 * faz sentido nenhum.
 *
 * @param {PartStorage & { length?: number, key?: (i: number) => string | null }} storage
 */
export function clearAllCompletedParts(storage) {
  try {
    /** @type {string[]} */
    const keys = [];
    const total = typeof storage.length === 'number' ? storage.length : 0;
    for (let i = 0; i < total; i++) {
      const key = storage.key?.(i);
      if (typeof key === 'string' && key.startsWith(KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // ignorar
  }
}

/**
 * @param {string} [message]
 * @returns {Error}
 */
function abortError(message = 'Download cancelado pelo usuário.') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/**
 * @param {{ aborted?: boolean } | null | undefined} signal
 * @returns {boolean}
 */
function isAborted(signal) {
  return Boolean(signal && signal.aborted);
}

/**
 * Espera `ms`, mas acorda na hora se o sinal for abortado.
 *
 * É isso que impede que um cancelamento fique preso atrás de um backoff de
 * vários segundos: cancelar precisa vencer a retentativa.
 *
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function sleep(ms, signal) {
  if (isAborted(signal)) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }

    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

/**
 * Status HTTP que pode melhorar se tentar de novo.
 * 404/403 e afins não melhoram — repetir 17 vezes só faz o usuário esperar.
 * @param {number} status
 * @returns {boolean}
 */
export function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Wi-fi de portal cativo devolve HTTP 200 com uma página de login em HTML.
 * Repetir não resolve — é preciso falhar com uma mensagem que faça sentido.
 *
 * @param {{ headers?: { get?: (name: string) => string | null } } | null | undefined} response
 * @returns {boolean}
 */
export function looksLikeCaptivePortal(response) {
  try {
    const contentType = response?.headers?.get?.('content-type') || '';
    return contentType.toLowerCase().includes('text/html');
  } catch {
    return false;
  }
}

/**
 * `fetch` com backoff exponencial limitado.
 *
 * Limites (todos obrigatórios para não travar em wi-fi ruim):
 * - `attempts`: número máximo de tentativas;
 * - `maxDelayMs`: teto de cada espera;
 * - `maxElapsedMs`: teto do tempo total; estourado, desiste sem dormir de novo;
 * - `signal`: cancelamento vence tanto o `fetch` quanto o backoff.
 *
 * Não reintenta cancelamento nem 4xx (exceto 408/429).
 *
 * @param {string} url
 * @param {RequestInit} init
 * @param {{
 *   attempts?: number,
 *   baseDelayMs?: number,
 *   maxDelayMs?: number,
 *   maxElapsedMs?: number,
 *   signal?: AbortSignal,
 *   fetchImpl?: typeof fetch,
 *   jitter?: boolean,
 *   onRetry?: (attempt: number, error: Error) => void
 * }} [options]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, init, options = {}) {
  const attempts = Math.max(1, options.attempts ?? 4);
  const baseDelayMs = options.baseDelayMs ?? 800;
  const maxDelayMs = options.maxDelayMs ?? 15000;
  const maxElapsedMs = options.maxElapsedMs ?? 60000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = options.signal ?? /** @type {AbortSignal | undefined} */ (init?.signal ?? undefined);
  const useJitter = options.jitter !== false;
  const startedAt = Date.now();

  /** @type {Error | null} */
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (isAborted(signal)) throw abortError();

    if (attempt > 0) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= maxElapsedMs) break;

      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      // Jitter evita que todas as partes reintentem no mesmo instante.
      const delay = useJitter ? exponential * (0.5 + Math.random() * 0.5) : exponential;
      await sleep(Math.min(delay, Math.max(0, maxElapsedMs - elapsed)), signal);
    }

    /** @type {Response} */
    let response;

    // Só a chamada fica dentro do try: assim a decisão sobre o status HTTP
    // acontece fora, e um `throw` de erro não-retentável não é reengolido
    // pelo próprio catch.
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      // Cancelamento do usuário nunca é retentado.
      if (error?.name === 'AbortError' || isAborted(signal)) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      options.onRetry?.(attempt + 1, lastError);
      continue;
    }

    if (response.ok) return response;

    lastError = new Error(`HTTP ${response.status} ao baixar ${url}`);
    // 404, 403 e afins não melhoram com repetição — desiste imediatamente.
    if (!isRetryableStatus(response.status)) throw lastError;
    options.onRetry?.(attempt + 1, lastError);
  }

  throw lastError ?? new Error(`Falha ao baixar ${url}`);
}
