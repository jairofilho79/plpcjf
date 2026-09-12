/**
 * Checksum esperado do louvores-manifest.json (Worker) e estado local para poll / backoff.
 */

// A guarda `typeof localStorage === 'undefined'` que estava aqui não protegia:
// `typeof` só suprime exceção para referência não resolvível (ECMA-262 §13.5.3),
// e `localStorage` é resolvível — o `[[Get]]` dela é que lança. Estas leituras
// rodam dentro de `loadLouvores()`, ou seja, no mount de `/`, `/listas`,
// `/biblioteca` e `/offline`: era ali que o app deixava de abrir.
import { safeGet, safeSet, safeRemove } from './safeStorage.js';
import { CATALOG_CACHE_NAME } from '../offline/sw/swCaches.js';

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

/** Limpa o hash local — força `ensureLouvoresManifestBodySha256Baseline` a estabelecer um novo. */
export function clearManifestBodySha256() {
  safeRemove(LS_MANIFEST_BODY_SHA256);
}

/**
 * Corrige o hash local para bater com o que está *realmente* persistido no
 * cache protegido, se os dois divergirem.
 *
 * Existe por causa de um bug já corrigido: `maybeCheckLouvoresManifestFromServer`
 * costumava avançar o hash local mesmo quando a escrita no cache protegido
 * falhava por falta de espaço (comum para quem já baixou o acervo inteiro).
 * Quem ficou nesse estado tem, até hoje, um hash local que "bate" com o que o
 * servidor reportou da última vez — mesmo sem nada persistido. A comparação
 * `expected === localHash` no poll por checksum nunca mais dispara um resync
 * para essas pessoas, porque, do ponto de vista dela, já está tudo sincronizado.
 * Corrigir a causa raiz do bug não desfaz esse estado — só impede que ele se
 * repita a partir de agora.
 *
 * Rodar isto uma vez, cedo, resolve: em vez de confiar cegamente no hash
 * local, ele é recalculado a partir do que de fato está no cache. Se bater,
 * nada muda. Se não bater (ou não houver nada persistido), o hash local passa
 * a refletir a realidade — e a próxima comparação contra o servidor volta a
 * ser honesta, disparando o resync de verdade se o catálogo já tiver mudado.
 *
 * @param {{ cachesImpl?: any }} [deps]
 * @returns {Promise<void>}
 */
export async function resyncManifestBodySha256WithCatalog(deps = {}) {
  const cachesImpl = 'cachesImpl' in deps ? deps.cachesImpl : (typeof caches !== 'undefined' ? caches : null);
  if (!cachesImpl || typeof cachesImpl.open !== 'function') return;

  const localHash = readManifestBodySha256();
  if (!localHash) return; // sem baseline: nada para corrigir aqui.

  try {
    const cache = await cachesImpl.open(CATALOG_CACHE_NAME);
    const cached = await cache.match('/louvores-manifest.json');
    if (!cached) {
      // O hash local afirma uma versão que não existe persistida: não há do
      // que "confiar". Limpa para a baseline ser refeita do zero.
      clearManifestBodySha256();
      return;
    }

    const text = await cached.text();
    const realHash = await sha256HexUtf8(text);
    if (realHash !== localHash) {
      writeManifestBodySha256(realHash);
    }
  } catch {
    // Best-effort: nunca pode travar o carregamento normal da tela.
  }
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

/**
 * Intervalo mínimo entre duas consultas ao checksum.
 *
 * Era 24 h, e isso fazia a atualização automática parecer inexistente: quem
 * publicava o catálogo pela admin às 15h só o via chegar aos dispositivos no
 * dia seguinte, porque cada um deles já tinha "conferido" naquela manhã. O GET
 * do checksum tem 64 bytes e sai com `no-store`; o manifesto de 1,4 MB só é
 * baixado quando o hash diverge. Consultar a cada abertura do app custa quase
 * nada — a janela existe só para não repetir a consulta a cada troca de aba.
 */
export const CHECKSUM_POLL_MIN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Baseline existe: automático pode comparar checksum.
 * @returns {boolean}
 */
export function hasLouvoresManifestBaseline() {
  return readManifestBodySha256() != null;
}

/**
 * Pode disparar GET do endpoint de checksum (janela mínima desde a última
 * consulta bem-sucedida, só com baseline e online).
 * @param {number} now
 * @param {boolean} isOnline
 * @returns {boolean}
 */
export function shouldFetchExpectedChecksum(now, isOnline) {
  if (!isOnline) return false;
  if (!hasLouvoresManifestBaseline()) return false;
  const last = readChecksumLastOkAt();
  if (last == null) return true;
  return now - last >= CHECKSUM_POLL_MIN_INTERVAL_MS;
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
