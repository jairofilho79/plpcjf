/**
 * Nomes de cache do Service Worker — fonte única de verdade.
 *
 * Este módulo é carregado por três mundos diferentes: o próprio Service Worker,
 * o app no browser (via OfflineConfig) e o `node --test`. Por isso ele não pode
 * importar nada — nem `$lib`, nem `$app/environment`, nem `$service-worker`.
 * A `version` do deploy entra sempre como argumento.
 */

/** Prefixo de todo cache criado pelo app. */
export const CACHE_PREFIX = 'plpc-';

/**
 * PDFs baixados pelo usuário. Deliberadamente sem versão: são dezenas ou
 * centenas de MB que o usuário baixou de propósito e que precisam sobreviver
 * a todo deploy. Nunca pode ser apagado pelo `activate`.
 */
export const PDF_CACHE_NAME = 'plpc-pdfs';

/** Área de espera da importação de bundle offline — também sobrevive ao `activate`. */
export const PDF_IMPORT_STAGING_CACHE_NAME = 'plpc-pdfs-import-staging';

/**
 * Caches que o `activate` nunca pode apagar, aconteça o que acontecer.
 * Lista explícita em vez de regex: é a última linha de defesa dos PDFs do usuário.
 */
export const PROTECTED_CACHE_NAMES = Object.freeze([
  PDF_CACHE_NAME,
  PDF_IMPORT_STAGING_CACHE_NAME
]);

/** Formato do cache do app shell: `plpc-<version>-app`. */
export const APP_CACHE_NAME_PATTERN = /^plpc-[\w.-]+-app$/;

/** Formato legado (`plpc-v5-pdfjs`), mantido só para reconhecer e limpar sobras. */
export const LEGACY_PDFJS_CACHE_NAME_PATTERN = /^plpc-[\w.-]+-pdfjs$/;

/**
 * Nome do cache do app para um deploy.
 *
 * @param {string} version identificador do deploy (`version` de `$service-worker`
 *   no worker e de `$app/environment` no cliente — é o mesmo valor).
 * @returns {string}
 */
export function appCacheName(version) {
  return `${CACHE_PREFIX}${version}-app`;
}

/**
 * Decide se um cache é sobra de um deploy anterior e pode ser apagado.
 *
 * Regras, nesta ordem:
 * 1. só mexe em caches com o prefixo `plpc-` (nada de terceiros);
 * 2. nunca apaga um cache protegido (PDFs do usuário e staging da importação);
 * 3. nunca apaga o cache do deploy atual.
 *
 * @param {string} name nome do cache vindo de `caches.keys()`
 * @param {string} currentAppCache resultado de `appCacheName(version)`
 * @returns {boolean}
 */
export function isObsoleteCacheName(name, currentAppCache) {
  if (typeof name !== 'string' || !name.startsWith(CACHE_PREFIX)) return false;
  if (PROTECTED_CACHE_NAMES.includes(name)) return false;
  if (name === currentAppCache) return false;
  return true;
}

/**
 * Caches que a recuperação de chunk velho (`staleChunkRecovery`) pode apagar:
 * só shell do app e o cache legado do PDF.js embutido.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isRecoverableShellCacheName(name) {
  if (typeof name !== 'string') return false;
  if (PROTECTED_CACHE_NAMES.includes(name)) return false;
  return APP_CACHE_NAME_PATTERN.test(name) || LEGACY_PDFJS_CACHE_NAME_PATTERN.test(name);
}
