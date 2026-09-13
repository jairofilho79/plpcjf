import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { clearLouvoresManifestFromSwCache } from '$lib/utils/swRegistration';
import { guardarManifestNoCatalogo } from '$lib/offline/storage/catalogoCache.js';
import {
  markUpdateQuotaBlocked,
  clearUpdateQuotaBlocked,
  quotaErrorMessage
} from '$lib/offline/storage/storageQuota.js';
import { dismissSnackbar, showErrorSnackbar, showInfoSnackbar, showSuccessSnackbar } from '$lib/utils/appSnackbar.js';
import { prepareLouvoresManifestPayload } from '$lib/utils/manifestPayload.js';
import {
  LOUVORES_MANIFEST_CHECKSUM_URL,
  isManifestSyncBlocked,
  parseExpectedChecksumFromResponseBody,
  readManifestBodySha256,
  recordManifestSyncFailure,
  resetManifestSyncPenalty,
  resyncManifestBodySha256WithCatalog,
  sha256HexUtf8,
  shouldFetchExpectedChecksum,
  writeChecksumLastOkAt,
  writeManifestBodySha256
} from '$lib/utils/louvoresManifestChecksum.js';

/**
 * Aplica o manifesto ao store sem derivar nada.
 *
 * Os campos de busca (_searchTitleNorm, _searchContentTokens) são calculados sob
 * demanda e memoizados em louvorSearch.js — enriquecer aqui custava ~14 mil
 * normalizações Unicode bloqueando a primeira pintura.
 *
 * @param {any[]} data
 * @returns {any[]}
 */
function applyLouvoresManifest(data) {
  const list = Array.isArray(data) ? data : [];
  louvores.set(list);
  return list;
}

/** @type {import('svelte/store').Writable<any[]>} */
let louvores = writable([]);
let louvoresLoaded = writable(false);

let louvoresLoadGeneration = 0;

/** Evita corridas no poll automático de checksum. */
let louvoresChecksumCheckRunning = false;

/**
 * `resyncManifestBodySha256WithCatalog` só precisa rodar uma vez por sessão
 * do app: uma vez corrigido, o hash local só volta a divergir do persistido
 * por uma escrita nova (que já passa pelo mesmo tratamento). Sem esta guarda,
 * toda navegação entre `/`, `/listas`, `/biblioteca` e `/offline` pagaria de
 * novo o custo de ler e hashear ~1,4 MB à toa.
 */
let manifestBodySha256Resynced = false;

/** Tentativas por “onda” de fetch (conexão instável). */
const MANIFEST_RETRY_MAX_ATTEMPTS = 4;
const MANIFEST_RETRY_BASE_MS = 450;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Movida para utils/manifestPayload.js para ser testável sob node --test.
export { prepareLouvoresManifestPayload } from '$lib/utils/manifestPayload.js';

/**
 * Hydrate louvores store from a local zip-mãe (offline-first import).
 * @param {unknown} raw
 * @param {string} [rawText] - original JSON text for checksum
 * @returns {Promise<any[]>}
 */
export async function hydrateLouvoresFromManifestData(raw, rawText = '') {
  const prepared = prepareLouvoresManifestPayload(raw) || (Array.isArray(raw) ? raw : []);
  const enriched = applyLouvoresManifest(prepared);
  louvoresLoaded.set(true);
  try {
    const hex =
      rawText && typeof rawText === 'string'
        ? await sha256HexUtf8(rawText)
        : await sha256HexUtf8(JSON.stringify(raw));
    writeManifestBodySha256(hex);
    writeChecksumLastOkAt(Date.now());
    resetManifestSyncPenalty();
  } catch (e) {
    console.warn('[Louvores] checksum after local hydrate failed', e);
  }
  await afterManifestLoaded(enriched);
  return enriched;
}

/**
 * @param {RequestInit} [init]
 * @param {{ awaitCatalogWrite?: boolean }} [options] `awaitCatalogWrite`: espera a escrita no
 *   cache protegido e devolve o resultado dela em `catalogWriteResult`, em vez do
 *   melhor-esforço padrão (que nunca atrasa a tela). Só quem precisa saber se a
 *   atualização ficou persistida — a sincronização por checksum — usa `true`.
 * @returns {Promise<{ kind: 'ok'; data: unknown[]; rawSha256: string; catalogWriteResult?: import('$lib/offline/storage/catalogoCache.js').ResultadoGuarda } | { kind: 'http'; status: number } | { kind: 'transport' } | { kind: 'parse' } | { kind: 'shape' }>}
 */
async function fetchLouvoresManifestOnce(init, options = {}) {
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

    // Guarda o catálogo no cache protegido com o texto que já está na mão.
    //
    // Na primeira visita o Service Worker ainda está instalando quando esta
    // requisição sai, então ela não passa por ele e o catálogo não é guardado
    // por ninguém — quem instalava a app e perdia a conexão em seguida
    // encontrava /biblioteca e /listas vazias. Ver `catalogoCache.js`.
    //
    // Por padrão não espera o resultado: é melhor esforço e não pode atrasar
    // a tela numa carga normal. `awaitCatalogWrite` existe só para quem
    // precisa confirmar a escrita antes de declarar sucesso — a sincronização
    // por checksum, que sem isso continuava "confirmando" uma atualização que
    // nunca chegou a ser gravada (silenciosa sob pressão de cota).
    const guarda = guardarManifestNoCatalogo('/louvores-manifest.json', text);
    if (options.awaitCatalogWrite) {
      let catalogWriteResult = await guarda;

      // Sem espaço: antes de desistir, tenta liberar o que o próprio
      // catálogo novo já descartou (PDFs que não estão mais nele) e regrava
      // uma vez. É o que desbloqueia quem já baixou o acervo inteiro e não
      // tem folga nenhuma — 1 PDF já libera espaço de sobra para este texto
      // (~1,4 MB). Ver `pruneObsoletePdfsFromCache`.
      if (catalogWriteResult === 'sem-espaco') {
        try {
          const { offline } = await import('$lib/stores/offline.js');
          const poda = await offline.pruneObsoletePdfsFromCache(data);
          if (poda.removidos > 0) {
            catalogWriteResult = await guardarManifestNoCatalogo('/louvores-manifest.json', text);
          }
        } catch (e) {
          console.warn('[Louvores] poda de PDFs obsoletos antes de regravar catálogo:', e);
        }
      }

      if (catalogWriteResult === 'guardado') console.info('[Louvores] catálogo guardado para uso offline');
      return { kind: 'ok', data, rawSha256, catalogWriteResult };
    }
    guarda.then((r) => {
      if (r === 'guardado') console.info('[Louvores] catálogo guardado para uso offline');
    });

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
 * @param {{ maxAttempts?: number; isCancelled?: () => boolean; awaitCatalogWrite?: boolean }} [options]
 *   `awaitCatalogWrite`: repassado a `fetchLouvoresManifestOnce` — ver o motivo lá.
 * @returns {Promise<{ ok: true; data: any[]; rawSha256: string; catalogWriteResult?: import('$lib/offline/storage/catalogoCache.js').ResultadoGuarda } | { ok: false; reason: 'cancelled' | 'transport' | 'http' | 'parse' | 'shape' | 'empty' | 'filtered_empty' }>}
 */
export async function fetchLouvoresManifestPrepared(init, options = {}) {
  const maxAttempts = options.maxAttempts ?? MANIFEST_RETRY_MAX_ATTEMPTS;
  const isCancelled = options.isCancelled;
  const awaitCatalogWrite = options.awaitCatalogWrite ?? false;

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

    const res = await fetchLouvoresManifestOnce(init, { awaitCatalogWrite });

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
      return { ok: true, data: prepared, rawSha256: res.rawSha256, catalogWriteResult: res.catalogWriteResult };
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
        isCancelled: () => refreshGen !== louvoresLoadGeneration,
        // Ação explícita da pessoa: vale a pena esperar a confirmação da
        // escrita para não dizer "atualizado com sucesso" sem ter persistido
        // nada (mesmo problema que a sincronização automática tinha).
        awaitCatalogWrite: true
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
    await afterManifestLoaded(enriched);
    try {
      const { offline } = await import('$lib/stores/offline.js');
      await offline.checkForNewPDFs();
    } catch (e) {
      console.warn('[Louvores] checkForNewPDFs after refresh:', e);
    }
    dismissSnackbar(refreshInfoId);

    if (result.catalogWriteResult === 'guardado' || result.catalogWriteResult === 'ja-tinha') {
      clearUpdateQuotaBlocked();
      writeManifestBodySha256(result.rawSha256);
      resetManifestSyncPenalty();
      showSuccessSnackbar('Banco de louvores atualizado com sucesso.', { durationMs: 3000 });
      return;
    }

    // Aplicado na tela, mas não persistido: a pessoa vê os dados novos agora,
    // mas sem espaço a atualização não sobrevive a um recarregamento offline.
    // Não avança o hash local nem reseta a penalidade — a próxima tentativa
    // (automática ou manual) precisa continuar tentando persistir de verdade.
    if (result.catalogWriteResult === 'sem-espaco') {
      markUpdateQuotaBlocked();
      showErrorSnackbar(
        `Os dados foram atualizados na tela, mas não puderam ser salvos para uso offline. ${quotaErrorMessage({})}`,
        { durationMs: 9000 }
      );
      return;
    }

    showErrorSnackbar(
      'Os dados foram atualizados na tela, mas não foi possível salvá-los para uso offline. Tente novamente.',
      { durationMs: 9000 }
    );
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
  const enriched = applyLouvoresManifest(result.data);
  await afterManifestLoaded(enriched);
}

export async function loadLouvores() {
  if (!browser) return;

  // Corrige o hash local se ele mentir sobre o que está realmente persistido
  // (ver `resyncManifestBodySha256WithCatalog`) — sem isto, quem ficou preso
  // pelo bug antigo de falso sucesso continua preso para sempre, mesmo com a
  // causa raiz já corrigida: o poll por checksum acha que já está sincronizado.
  if (!manifestBodySha256Resynced) {
    manifestBodySha256Resynced = true;
    await resyncManifestBodySha256WithCatalog();
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
      if (gen === louvoresLoadGeneration) void maybeCheckLouvoresManifestFromServer();
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
    const enriched = applyLouvoresManifest(result.data);
    if (gen !== louvoresLoadGeneration) return;
    louvoresLoaded.set(true);
    await afterManifestLoaded(enriched);
    if (gen !== louvoresLoadGeneration) return;

    // A tela já está servida (quase sempre pelo cache protegido do Service
    // Worker, que é cache-first e nunca expira sozinho). Só agora existe a
    // baseline que a comparação com o servidor exige — o gatilho por
    // `requestIdleCallback` do layout costuma disparar antes disto e sair
    // sem fazer nada. Conferir aqui garante uma consulta por abertura do app.
    void maybeCheckLouvoresManifestFromServer();
  } catch (error) {
    console.error('Error loading louvores:', error);
    if (gen === louvoresLoadGeneration) {
      louvoresLoaded.set(true);
    }
  }
}

/**
 * GET do checksum no servidor (a cada abertura do app, respeitando
 * `CHECKSUM_POLL_MIN_INTERVAL_MS`; só com baseline e online). Se o esperado ≠
 * hash local, limpa o catálogo do cache protegido, baixa o manifesto com
 * no-store e só aplica se o SHA-256 do corpo for o esperado.
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

    // `awaitCatalogWrite`: precisa saber se a escrita no cache protegido
    // realmente aconteceu antes de declarar sincronizado — sem isso, uma
    // falha por cota (frequente para quem já baixou o acervo inteiro) ficava
    // indistinguível de sucesso: os dados chegavam à store em memória, o hash
    // local avançava para bater com o do servidor, e a próxima checagem via
    // `expected === localHash` acima nunca mais tentava de novo, mesmo sem
    // nada persistido.
    const mres = await fetchLouvoresManifestOnce({ cache: 'no-store' }, { awaitCatalogWrite: true });
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

    // Aplicado em memória (a tela já mostra os dados novos), mas só é
    // seguro declarar sincronizado — e só então avançar o hash local — se a
    // escrita no cache protegido de fato aconteceu. Do contrário, quem está
    // sem rede na próxima vez que abrir o app volta a ver a versão antiga,
    // silenciosamente, para sempre (até o catálogo mudar de novo no servidor).
    if (mres.catalogWriteResult === 'guardado' || mres.catalogWriteResult === 'ja-tinha') {
      clearUpdateQuotaBlocked();
      writeManifestBodySha256(mres.rawSha256);
      resetManifestSyncPenalty();
      writeChecksumLastOkAt(Date.now());
      console.info('[Louvores] Catálogo atualizado automaticamente (checksum).');
      return;
    }

    if (mres.catalogWriteResult === 'sem-espaco') {
      console.warn('[Louvores] checksum sync: catálogo aplicado em memória, mas sem espaço para persistir');
      markUpdateQuotaBlocked();
    } else {
      console.warn('[Louvores] checksum sync: catálogo aplicado em memória, mas não persistido:', mres.catalogWriteResult);
    }
    recordManifestSyncFailure(tAfter);
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
