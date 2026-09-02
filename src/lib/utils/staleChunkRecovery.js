/**
 * Após deploy, o browser pode pedir chunks antigos (404). Sem tratativa, reload pode repetir o mesmo estado.
 * Uma limpeza de SW + caches + reload costuma destravar; limitamos a 2 tentativas por sessão.
 */

import { browser } from '$app/environment';
import { isRecoverableShellCacheName } from '$lib/offline/sw/swCaches.js';

const STORAGE_KEY = 'plpcjf:staleChunkRecovery';

function readState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { n: 0 };
    const o = JSON.parse(raw);
    return { n: Number(o.n) || 0 };
  } catch {
    return { n: 0 };
  }
}

function matchesChunkFailureMessage(msg) {
  if (!msg || typeof msg !== 'string') return false;
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Loading chunk [\w-]+ failed/i.test(msg) ||
    /ChunkLoadError/i.test(msg)
  );
}

async function hardResetSwAndAppCaches() {
  if (!browser) return;
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.filter(isRecoverableShellCacheName).map((k) => caches.delete(k)));
    }
  } catch (e) {
    console.warn('[staleChunkRecovery] cleanup failed', e);
  }
}

/**
 * @param {string} reason
 * @returns {Promise<boolean>} true se disparou reload
 */
export async function tryRecoverFromStaleDeployment(reason) {
  if (!browser) return false;
  const s = readState();
  if (s.n >= 2) {
    console.error('[staleChunkRecovery] Desistindo após 2 tentativas:', reason);
    return false;
  }
  // A contagem é um limitador de segurança, não o objetivo. Com sessionStorage
  // bloqueado o `readState` já devolve `{ n: 0 }` e esta gravação lançaria —
  // abortando o resgate justamente no navegador onde o app está partido.
  // Perder a contagem custa, no pior caso, reloads a mais; perder o resgate
  // custa o app.
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ n: s.n + 1, at: Date.now() }));
  } catch { /* armazenamento bloqueado: seguir sem contar */ }
  console.warn('[staleChunkRecovery] Tentativa', s.n + 1, reason);
  await hardResetSwAndAppCaches();
  window.location.reload();
  return true;
}

/**
 * @returns {() => void} cleanup
 */
export function installStaleChunkRecoveryListeners() {
  if (!browser) return () => {};

  const onRejection = (ev) => {
    const msg = ev.reason?.message || String(ev.reason || '');
    if (!matchesChunkFailureMessage(msg)) return;
    ev.preventDefault?.();
    void tryRecoverFromStaleDeployment(msg);
  };

  const onError = (ev) => {
    const t = ev.target;
    if (!t || t.tagName !== 'SCRIPT' || !t.src) return;
    if (!t.src.includes('/_app/')) return;
    void tryRecoverFromStaleDeployment(`script:${t.src}`);
  };

  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('error', onError, true);

  return () => {
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('error', onError, true);
  };
}

/** Reseta o contador após carga estável (permite recuperar num deploy futuro na mesma sessão). */
export function scheduleStaleRecoveryCounterReset() {
  if (!browser) return () => {};
  const id = window.setTimeout(() => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, 12_000);
  return () => window.clearTimeout(id);
}
