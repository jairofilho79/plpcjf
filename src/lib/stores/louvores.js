import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { clearLouvoresManifestFromSwCache } from '$lib/utils/swRegistration';
import { tokensContent, normalizeForSearch } from '$lib/utils/louvorSearch';

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

/** Persisted when a manifest response has been successfully applied for a given server version. */
export const LOUVORES_MANIFEST_VERSION_KEY = 'LOUVORES_MANIFEST_VERSION';

/** @type {import('svelte/store').Writable<any[]>} */
let louvores = writable([]);
let louvoresLoaded = writable(false);

let louvoresLoadGeneration = 0;

function readStoredVersion() {
  if (!browser || typeof localStorage === 'undefined') return null;
  try {
    const s = localStorage.getItem(LOUVORES_MANIFEST_VERSION_KEY);
    if (s === null || s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * @param {Response} response
 * @returns {Promise<any[]>}
 */
async function parseManifestFromResponse(response) {
  try {
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * @param {RequestInit} [init]
 * @returns {Promise<any[]>}
 */
async function fetchAndParseLouvoresManifest(init) {
  try {
    const response = await fetch('/louvores-manifest.json', init);
    return await parseManifestFromResponse(response);
  } catch {
    return [];
  }
}

/**
 * @returns {Promise<number|null>}
 */
async function fetchRemoteVersion() {
  try {
    const res = await fetch('/louvores-version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    if (typeof j?.version === 'number' && Number.isFinite(j.version)) return j.version;
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {any[]} data
 */
async function afterManifestLoaded(data) {
  if (typeof window === 'undefined') return;
  const { updatePdfIndexInBackground } = await import('$lib/utils/pdfIndex');
  updatePdfIndexInBackground(data);
}

/**
 * @param {number} remoteVersion
 * @param {number} scheduleGen
 */
function scheduleBackgroundRefresh(remoteVersion, scheduleGen) {
  queueMicrotask(async () => {
    if (scheduleGen !== louvoresLoadGeneration) return;
    try {
      // Ordem obrigatória: limpar APP_CACHE do SW, depois rede com no-store (evita HTTP cache da rota + garante manifest alinhado à nova versão).
      await clearLouvoresManifestFromSwCache();
      if (scheduleGen !== louvoresLoadGeneration) return;
      const data = await fetchAndParseLouvoresManifest({ cache: 'no-store' });
      if (scheduleGen !== louvoresLoadGeneration) return;
      const enriched = applyLouvoresManifest(data);
      localStorage.setItem(LOUVORES_MANIFEST_VERSION_KEY, String(remoteVersion));
      await afterManifestLoaded(enriched);
      try {
        const { offline } = await import('$lib/stores/offline.js');
        await offline.checkForNewPDFs();
      } catch (e) {
        console.warn('[Louvores] checkForNewPDFs after refresh:', e);
      }
    } catch (e) {
      console.error('[Louvores] background manifest refresh failed', e);
    }
  });
}

export async function loadLouvores() {
  if (!browser) return;

  const gen = ++louvoresLoadGeneration;

  try {
    const localVersion = readStoredVersion();

    if (!navigator.onLine) {
      const current = get(louvores);
      if (current.length > 0) {
        louvoresLoaded.set(true);
        return;
      }
      const data = await fetchAndParseLouvoresManifest();
      const enriched = applyLouvoresManifest(data);
      louvoresLoaded.set(true);
      await afterManifestLoaded(enriched);
      return;
    }

    const remoteVersion = await fetchRemoteVersion();

    // Manifest grande na rede: primeira sincronização e cada bump de versão (fase rápida com cache SW antigo + fase background com clear + no-store).
    // Se versão remota === local e já há dados em memória, não há fetch do manifest (evita ~1,3MB por visita).

    if (remoteVersion === null) {
      const data = await fetchAndParseLouvoresManifest();
      const enriched = applyLouvoresManifest(data);
      louvoresLoaded.set(true);
      console.log(`Loaded ${enriched.length} louvores (degraded, no version endpoint)`);
      await afterManifestLoaded(enriched);
      return;
    }

    const versionMismatch = localVersion === null || remoteVersion !== localVersion;
    const hasMemory = get(louvores).length > 0;

    if (!versionMismatch && hasMemory) {
      louvoresLoaded.set(true);
      return;
    }

    if (!versionMismatch && !hasMemory) {
      const data = await fetchAndParseLouvoresManifest();
      const enriched = applyLouvoresManifest(data);
      louvoresLoaded.set(true);
      localStorage.setItem(LOUVORES_MANIFEST_VERSION_KEY, String(remoteVersion));
      console.log(`Loaded ${enriched.length} louvores from manifest`);
      await afterManifestLoaded(enriched);
      return;
    }

    // version bump
    if (hasMemory) {
      louvoresLoaded.set(true);
      scheduleBackgroundRefresh(remoteVersion, gen);
      return;
    }

    if (localVersion === null) {
      const data = await fetchAndParseLouvoresManifest({ cache: 'no-store' });
      const enriched = applyLouvoresManifest(data);
      louvoresLoaded.set(true);
      localStorage.setItem(LOUVORES_MANIFEST_VERSION_KEY, String(remoteVersion));
      console.log(`Loaded ${enriched.length} louvores from manifest (first sync)`);
      await afterManifestLoaded(enriched);
      return;
    }

    const data = await fetchAndParseLouvoresManifest();
    const enriched = applyLouvoresManifest(data);
    louvoresLoaded.set(true);
    console.log(`Loaded ${enriched.length} louvores from manifest (stale until background refresh)`);
    await afterManifestLoaded(enriched);
    scheduleBackgroundRefresh(remoteVersion, gen);
  } catch (error) {
    console.error('Error loading louvores:', error);
    louvoresLoaded.set(true);
  }
}

export { louvores, louvoresLoaded };
