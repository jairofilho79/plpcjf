/**
 * Checksum esperado do louvores-manifest.json (Worker) e estado local para poll / backoff.
 */

// A guarda `typeof localStorage === 'undefined'` que estava aqui não protegia:
// `typeof` só suprime exceção para referência não resolvível (ECMA-262 §13.5.3),
// e `localStorage` é resolvível — o `[[Get]]` dela é que lança. Estas leituras
// rodam dentro de `loadLouvores()`, ou seja, no mount de `/`, `/listas`,
// `/biblioteca` e `/offline`: era ali que o app deixava de abrir.
import { safeGet, safeSet } from './safeStorage.js';

export const LOUVORES_MANIFEST_CHECKSUM_URL = '/louvores-manifest.sha256';

const LS_PREFIX = 'plpcjf:louvores:';
export const LS_CHECKSUM_LAST_OK_AT = `${LS_PREFIX}checksumLastOkAt`;
export const LS_MANIFEST_BODY_SHA256 = `${LS_PREFIX}manifestBodySha256`;
/** JSON: { failStreak, nextRetryAt, cooldownUntil } */
export const LS_MANIFEST_SYNC_PENALTY = `${LS_PREFIX}manifestSyncPenalty`;

/** Minutos entre tentativas após cada falha (1ª→2ª, …, 4ª→5ª). */
export const MANIFEST_SYNC_RETRY_DELAYS_MIN = [1, 2, 4, 8, 16];

const MS_PER_MIN = 60_000;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

const HEX64 = /^[a-f0-9]{64}$/i;

/**
 * @param {string} text
 * @returns {Promise<string>} hex lowercase
 */
export async function sha256HexUtf8(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = new Uint8Array(digest);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {string} body
 * @returns {string | null}
 */
export function parseExpectedChecksumFromResponseBody(body) {
  if (body == null) return null;
  const t = String(body).trim().toLowerCase();
  return HEX64.test(t) ? t : null;
}

/** @returns {number | null} */
export function readChecksumLastOkAt() {
  const v = safeGet(LS_CHECKSUM_LAST_OK_AT);
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** @param {number} ms */
export function writeChecksumLastOkAt(ms) {
  safeSet(LS_CHECKSUM_LAST_OK_AT, String(ms));
}

/** @returns {string | null} */
export function readManifestBodySha256() {
  const v = safeGet(LS_MANIFEST_BODY_SHA256);
  if (v == null) return null;
  const t = v.trim().toLowerCase();
  return HEX64.test(t) ? t : null;
}

/** @param {string} hexLower */
export function writeManifestBodySha256(hexLower) {
  safeSet(LS_MANIFEST_BODY_SHA256, hexLower);
}

/**
 * @typedef {{ failStreak: number; nextRetryAt: number; cooldownUntil: number }} ManifestSyncPenalty
 */

/** @returns {ManifestSyncPenalty} */
export function readManifestSyncPenalty() {
  const empty = { failStreak: 0, nextRetryAt: 0, cooldownUntil: 0 };
  try {
    // `safeGet` devolve `null` tanto para chave ausente quanto para storage
    // indisponível — os dois casos já caíam no mesmo `empty` aqui.
    const raw = safeGet(LS_MANIFEST_SYNC_PENALTY);
    if (!raw) return empty;
    const o = JSON.parse(raw);
    return {
      failStreak: Math.max(0, Math.min(5, Number(o.failStreak) || 0)),
      nextRetryAt: Math.max(0, Number(o.nextRetryAt) || 0),
      cooldownUntil: Math.max(0, Number(o.cooldownUntil) || 0)
    };
  } catch {
    return empty;
  }
}

/** @param {ManifestSyncPenalty} p */
export function writeManifestSyncPenalty(p) {
  safeSet(LS_MANIFEST_SYNC_PENALTY, JSON.stringify(p));
}

export function resetManifestSyncPenalty() {
  writeManifestSyncPenalty({ failStreak: 0, nextRetryAt: 0, cooldownUntil: 0 });
}

const TWENTY_FOUR_H_MS = 24 * 60 * 60 * 1000;

/**
 * Baseline existe: automático pode comparar checksum.
 * @returns {boolean}
 */
export function hasLouvoresManifestBaseline() {
  return readManifestBodySha256() != null;
}

/**
 * Pode disparar GET do endpoint de checksum (24h desde último sucesso, só se online).
 * @param {number} now
 * @param {boolean} isOnline
 * @returns {boolean}
 */
export function shouldFetchExpectedChecksum(now, isOnline) {
  if (!isOnline) return false;
  if (!hasLouvoresManifestBaseline()) return false;
  const last = readChecksumLastOkAt();
  if (last == null) return true;
  return now - last >= TWENTY_FOUR_H_MS;
}

/**
 * @param {number} now
 * @returns {boolean}
 */
export function isManifestSyncBlocked(now) {
  const p = readManifestSyncPenalty();
  if (p.cooldownUntil > now) return true;
  if (p.nextRetryAt > now) return true;
  return false;
}

/**
 * Após falha ao obter/aplicar manifesto com hash esperado.
 * @param {number} now
 */
export function recordManifestSyncFailure(now) {
  const p = readManifestSyncPenalty();
  if (p.cooldownUntil > now) return;

  const nextStreak = p.failStreak + 1;
  if (nextStreak >= 5) {
    writeManifestSyncPenalty({
      failStreak: 0,
      nextRetryAt: 0,
      cooldownUntil: now + COOLDOWN_MS
    });
    return;
  }

  const delayMin = MANIFEST_SYNC_RETRY_DELAYS_MIN[nextStreak - 1] ?? 16;
  writeManifestSyncPenalty({
    failStreak: nextStreak,
    nextRetryAt: now + delayMin * MS_PER_MIN,
    cooldownUntil: 0
  });
}
