import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { clearLouvoresManifestFromSwCache } from '$lib/utils/swRegistration';
import { tokensContent, normalizeForSearch } from '$lib/utils/louvorSearch';
import { dismissSnackbar, showErrorSnackbar, showInfoSnackbar, showSuccessSnackbar } from '$lib/utils/appSnackbar.js';
import {
  LOUVORES_MANIFEST_CHECKSUM_URL,
  isManifestSyncBlocked,
  parseExpectedChecksumFromResponseBody,
  readManifestBodySha256,
  recordManifestSyncFailure,
  resetManifestSyncPenalty,
  sha256HexUtf8,
  shouldFetchExpectedChecksum,
  writeChecksumLastOkAt,
  writeManifestBodySha256
} from '$lib/utils/louvoresManifestChecksum.js';
import { setManifestRevision } from '$lib/offline/core/OfflineRevision.js';

/**
 * Enrich manifest rows with precomputed title tokens and replace store contents.
 * @param {any[]} data
 * @returns {any[]}
 */
function applyLouvoresManifest(data) {
  const list = Array.isArray(data) ? data : [];
  const enriched = list.map((item) => ({
    ...item,
    _searchContentTokens: tokensContent(item?.nome ?? ''),
    _searchTitleNorm: normalizeForSearch(item?.nome ?? '')
  }));
  louvores.set(enriched);
  return enriched;
}

/** @type {import('svelte/store').Writable<any[]>} */
let louvores = writable([]);
let louvoresLoaded = writable(false);

let louvoresLoadGeneration = 0;

/** Evita corridas no poll automático de checksum. */
let louvoresChecksumCheckRunning = false;

/** Tentativas por “onda” de fetch (conexão instável). */
const MANIFEST_RETRY_MAX_ATTEMPTS = 4;
const MANIFEST_RETRY_BASE_MS = 450;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normaliza linhas e descarta só o que é claramente inútil (sem pdfId válido).
 * Nome vira string (inclui número/boolean do JSON) para não rejeitar dados válidos por tipo.
 *
 * @param {unknown} raw
 * @returns {any[] | null} null se não houver nenhuma linha aplicável
 */
export function prepareLouvoresManifestPayload(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const pid = /** @type {{ pdfId?: unknown }} */ (item).pdfId;
    if (pid === null || pid === undefined) continue;
    if (typeof pid === 'string') {
      if (pid.trim() === '') continue;
    } else if (typeof pid === 'number') {
      if (!Number.isFinite(pid)) continue;
    } else {
      continue;
    }

    let nome = '';
    try {
      const nomeRaw = /** @type {{ nome?: unknown }} */ (item).nome;
      if (nomeRaw === null || nomeRaw === undefined) {
        nome = '';
      } else if (typeof nomeRaw === 'string') {
        nome = nomeRaw;
      } else {
        nome = String(nomeRaw);
      }
    } catch {
      continue;
    }

    out.push({ ...item, nome, pdfId: pid });
  }
  return out.length > 0 ? out : null;
}

/**
 * @param {RequestInit} [init]
 * @returns {Promise<{ kind: 'ok'; data: unknown[]; rawSha256: string } | { kind: 'http'; status: number } | { kind: 'transport' } | { kind: 'parse' } | { kind: 'shape' }>}
 */
async function fetchLouvoresManifestOnce(init) {
  try {
    const response = await fetch('/louvores-manifest.json', init);
    if (!response.ok) {
      return { kind: 'http', status: response.status };
    }
    let text;
    try {
      text = await response.text();
    } catch {
      return { kind: 'transport' };
    }
    let rawSha256;
    try {
      rawSha256 = await sha256HexUtf8(text);
    } catch {
      return { kind: 'transport' };
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { kind: 'parse' };
    }
    if (!Array.isArray(data)) {
      return { kind: 'shape' };
    }
    return { kind: 'ok', data, rawSha256 };
  } catch {
    return { kind: 'transport' };
  }
}

/**
 * @param {number} status
 */
function shouldRetryHttpStatus(status) {
  if (status === 408 || status === 429) return true;
  if (status >= 500) return true;
  return false;
}

/**
 * Baixa o manifesto com várias tentativas (backoff) para falhas típicas de rede.
 * Não confunde “lista vazia confirmada” (HTTP 200 + []) com falha transitória — não reintenta à toa nesse caso.
 *
 * @param {RequestInit} init
 * @param {{ maxAttempts?: number; isCancelled?: () => boolean }} [options]
 * @returns {Promise<{ ok: true; data: any[]; rawSha256: string } | { ok: false; reason: 'cancelled' | 'transport' | 'http' | 'parse' | 'shape' | 'empty' | 'filtered_empty' }>}
 */
export async function fetchLouvoresManifestPrepared(init, options = {}) {
  const maxAttempts = options.maxAttempts ?? MANIFEST_RETRY_MAX_ATTEMPTS;
  const isCancelled = options.isCancelled;

  /** @type {'transport' | 'http' | 'parse' | 'shape' | 'empty' | 'filtered_empty'} */
  let lastReason = 'transport';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (isCancelled?.()) {
      return { ok: false, reason: 'cancelled' };
    }

    if (attempt > 0) {
      await sleep(MANIFEST_RETRY_BASE_MS * 2 ** (attempt - 1));
      if (isCancelled?.()) {
        return { ok: false, reason: 'cancelled' };
      }
    }

    const res = await fetchLouvoresManifestOnce(init);

    if (res.kind === 'http') {
      lastReason = 'http';
      if (!shouldRetryHttpStatus(res.status)) {
        break;
      }
      continue;
    }

    if (res.kind === 'transport' || res.kind === 'parse' || res.kind === 'shape') {
      lastReason = res.kind;
      continue;
    }

    const raw = res.data;
    if (raw.length === 0) {
      lastReason = 'empty';
      break;
    }

    const prepared = prepareLouvoresManifestPayload(raw);
    if (prepared) {
      return { ok: true, data: prepared, rawSha256: res.rawSha256 };
    }

    lastReason = 'filtered_empty';
    // Corpo JSON grande mas nenhuma linha válida: pode ser resposta truncada/corrompida — vale reintentar.
    continue;
  }

  return { ok: false, reason: lastReason };
}

/**
 * @param {any[]} data
 */
async function afterManifestLoaded(data) {
  if (typeof window === 'undefined') return;
  const { updatePdfIndexInBackground } = await import('$lib/utils/pdfIndex');
  updatePdfIndexInBackground(data);
}

function snackbarForManifestFailure(reason) {
  if (reason === 'empty') {
    return 'O servidor devolveu uma lista de louvores vazia. Os dados atuais foram mantidos.';
  }
  if (reason === 'filtered_empty') {
    return 'A resposta não continha nenhum louvor utilizável (dados incompletos). Os dados atuais foram mantidos.';
  }
  if (reason === 'http') {
    return 'O servidor não respondeu como esperado. Verifique a conexão e tente novamente. Os dados atuais foram mantidos.';
  }
  return 'Conexão instável ou resposta incompleta ao baixar o banco de louvores. Os dados atuais foram mantidos — tente de novo em instantes.';
}

/**
 * Atualização manual: limpa cache do SW, baixa com no-store, retries e só aplica payload preparado.
 *
 * @param {number} refreshGen
 */
async function runLouvoresManifestNetworkRefresh(refreshGen) {
  if (refreshGen !== louvoresLoadGeneration) return;
  const refreshInfoId = `louvores-refresh-${refreshGen}`;
  showInfoSnackbar(
    'Atualizando o banco de louvores. Em conexões lentas isso pode levar até ~15 segundos; não recarregue a página.',
    { id: refreshInfoId, durationMs: 16000 }
  );

  try {
    await clearLouvoresManifestFromSwCache();
    if (refreshGen !== louvoresLoadGeneration) {
      dismissSnackbar(refreshInfoId);
      return;
    }

    const result = await fetchLouvoresManifestPrepared(
      { cache: 'no-store' },
      {
        maxAttempts: MANIFEST_RETRY_MAX_ATTEMPTS,
        isCancelled: () => refreshGen !== louvoresLoadGeneration
      }
    );

    if (refreshGen !== louvoresLoadGeneration) {
      dismissSnackbar(refreshInfoId);
      return;
    }

    if (!result.ok) {
      dismissSnackbar(refreshInfoId);
      if (result.reason !== 'cancelled') {
        showErrorSnackbar(snackbarForManifestFailure(result.reason), { durationMs: 9000 });
      }
      return;
    }

    const enriched = applyLouvoresManifest(result.data);
    writeManifestBodySha256(result.rawSha256);
    setManifestRevision(result.rawSha256);
    resetManifestSyncPenalty();
    await afterManifestLoaded(enriched);
    try {
      const { offline } = await import('$lib/stores/offline.js');
      await offline.checkForNewPDFs();
    } catch (e) {
      console.warn('[Louvores] checkForNewPDFs after refresh:', e);
    }
    dismissSnackbar(refreshInfoId);
    showSuccessSnackbar('Banco de louvores atualizado com sucesso.', { durationMs: 3000 });
  } catch (e) {
    console.error('[Louvores] manifest network refresh failed', e);
    dismissSnackbar(refreshInfoId);
    showErrorSnackbar(
      'Não foi possível concluir a atualização. Os dados atuais foram mantidos — tente novamente.',
      { durationMs: 7000 }
    );
  }
}

/**
 * Atualização manual do banco de louvores na rede.
 */
export async function forceRefreshLouvoresFromNetwork() {
  if (!browser) return;
  if (!navigator.onLine) {
    showErrorSnackbar('Conecte-se à internet para atualizar o banco de louvores.', { durationMs: 5000 });
    return;
  }
  const gen = ++louvoresLoadGeneration;
  await runLouvoresManifestNetworkRefresh(gen);
}

async function loadLouvoresManifestForInitialLoad() {
  let result = await fetchLouvoresManifestPrepared(
    {},
    { maxAttempts: MANIFEST_RETRY_MAX_ATTEMPTS }
  );
  if (result.ok) return result;

  result = await fetchLouvoresManifestPrepared(
    { cache: 'no-store' },
    { maxAttempts: MANIFEST_RETRY_MAX_ATTEMPTS }
  );
  return result;
}

/**
 * Se ainda não há hash do manifesto no localStorage, obtém o manifesto (cache → rede)
 * e grava/aplica para manter hash e dados coerentes (útil quando loadLouvores saía cedo com dados em memória).
 *
 * @param {{ isCancelled?: () => boolean }} [options]
 */
async function ensureLouvoresManifestBodySha256Baseline(options = {}) {
  if (readManifestBodySha256()) return;

  const { isCancelled } = options;
  if (isCancelled?.()) return;

  let result = await fetchLouvoresManifestPrepared(
    {},
    { maxAttempts: MANIFEST_RETRY_MAX_ATTEMPTS, isCancelled }
  );
  if (!result.ok) {
    result = await fetchLouvoresManifestPrepared(
      { cache: 'no-store' },
      { maxAttempts: MANIFEST_RETRY_MAX_ATTEMPTS, isCancelled }
    );
  }
  if (!result.ok || isCancelled?.()) return;

  writeManifestBodySha256(result.rawSha256);
  setManifestRevision(result.rawSha256);
  const enriched = applyLouvoresManifest(result.data);
  await afterManifestLoaded(enriched);
}

export async function loadLouvores() {
  if (!browser) return;

  const localManifestHash = readManifestBodySha256();
  if (localManifestHash) {
    setManifestRevision(localManifestHash);
  }

  const gen = ++louvoresLoadGeneration;

  try {
    if (!navigator.onLine) {
      const current = get(louvores);
      if (current.length > 0) {
        louvoresLoaded.set(true);
        await ensureLouvoresManifestBodySha256Baseline({
          isCancelled: () => gen !== louvoresLoadGeneration
        });
        return;
      }
      const result = await loadLouvoresManifestForInitialLoad();
      if (gen !== louvoresLoadGeneration) return;
      if (result.ok) {
        writeManifestBodySha256(result.rawSha256);
        setManifestRevision(result.rawSha256);
        const enriched = applyLouvoresManifest(result.data);
        await afterManifestLoaded(enriched);
        if (gen !== louvoresLoadGeneration) return;
      } else {
        console.warn('[Louvores] manifest indisponível na carga inicial offline/sem cache válido:', result.reason);
      }
      louvoresLoaded.set(true);
      return;
    }

    const hasMemory = get(louvores).length > 0;
    if (hasMemory) {
      louvoresLoaded.set(true);
      await ensureLouvoresManifestBodySha256Baseline({
        isCancelled: () => gen !== louvoresLoadGeneration
      });
      return;
    }

    const result = await loadLouvoresManifestForInitialLoad();
    if (gen !== louvoresLoadGeneration) return;
    if (!result.ok) {
      console.error('[Louvores] manifest inválido ou indisponível na carga inicial:', result.reason);
      louvoresLoaded.set(true);
      return;
    }
    writeManifestBodySha256(result.rawSha256);
    setManifestRevision(result.rawSha256);
    const enriched = applyLouvoresManifest(result.data);
    if (gen !== louvoresLoadGeneration) return;
    louvoresLoaded.set(true);
    await afterManifestLoaded(enriched);
    if (gen !== louvoresLoadGeneration) return;
  } catch (error) {
    console.error('Error loading louvores:', error);
    if (gen === louvoresLoadGeneration) {
      louvoresLoaded.set(true);
    }
  }
}

/**
 * GET do checksum no Worker (24h, só com baseline e online). Se o esperado ≠ hash local,
 * baixa o manifesto com no-store e só aplica se o SHA-256 do corpo for o esperado.
 */
export async function maybeCheckLouvoresManifestFromServer() {
  if (!browser) return;
  if (louvoresChecksumCheckRunning) return;
  louvoresChecksumCheckRunning = true;
  try {
    const now = Date.now();
    if (!navigator.onLine) return;
    if (!shouldFetchExpectedChecksum(now, true)) return;

    let res;
    try {
      res = await fetch(LOUVORES_MANIFEST_CHECKSUM_URL, { cache: 'no-store' });
    } catch {
      return;
    }
    if (res.status === 204) return;
    if (!res.ok) return;

    let bodyText;
    try {
      bodyText = await res.text();
    } catch {
      return;
    }

    const expected = parseExpectedChecksumFromResponseBody(bodyText);
    if (!expected) return;

    const localHash = readManifestBodySha256();
    if (!localHash) return;

    if (expected === localHash) {
      writeChecksumLastOkAt(now);
      return;
    }

    const tBlocked = Date.now();
    if (isManifestSyncBlocked(tBlocked)) return;

    try {
      await clearLouvoresManifestFromSwCache();
    } catch (e) {
      console.warn('[Louvores] checksum sync: clear SW cache', e);
    }

    const mres = await fetchLouvoresManifestOnce({ cache: 'no-store' });
    const tAfter = Date.now();
    if (mres.kind !== 'ok') {
      recordManifestSyncFailure(tAfter);
      return;
    }
    if (mres.rawSha256 !== expected) {
      recordManifestSyncFailure(tAfter);
      return;
    }
    const prepared = prepareLouvoresManifestPayload(mres.data);
    if (!prepared) {
      recordManifestSyncFailure(tAfter);
      return;
    }

    const enriched = applyLouvoresManifest(prepared);
    await afterManifestLoaded(enriched);
    try {
      const { offline } = await import('$lib/stores/offline.js');
      await offline.checkForNewPDFs();
    } catch (e) {
      console.warn('[Louvores] checksum sync: checkForNewPDFs', e);
    }
    writeManifestBodySha256(mres.rawSha256);
    setManifestRevision(mres.rawSha256);
    resetManifestSyncPenalty();
    writeChecksumLastOkAt(Date.now());
    console.info('[Louvores] Catálogo atualizado automaticamente (checksum).');
  } finally {
    louvoresChecksumCheckRunning = false;
  }
}

/**
 * Registra gatilhos (online, visibilidade, idle) e devolve cleanup.
 * @returns {() => void}
 */
export function setupLouvoresManifestChecksumTriggers() {
  if (!browser) return () => {};
  const run = () => {
    void maybeCheckLouvoresManifestFromServer();
  };
  const onOnline = () => run();
  const onVis = () => {
    if (document.visibilityState === 'visible') run();
  };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVis);
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => run(), { timeout: 8000 });
  } else {
    setTimeout(run, 4000);
  }
  return () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVis);
  };
}

export { louvores, louvoresLoaded };
