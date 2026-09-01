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
 * Catálogo (louvores-manifest.json + offline-manifest.json).
 *
 * Também sem versão e protegido, pelo mesmo motivo dos PDFs: quando o usuário
 * importa o bundle offline, estes dois arquivos são a única cópia do catálogo
 * que existe no dispositivo — não estão no precache (são rotas de servidor, não
 * entram em `files`) e não há espelho em IndexedDB nem localStorage. Guardá-los
 * no cache do app, que morre a cada deploy, apagaria o acervo importado.
 */
export const CATALOG_CACHE_NAME = 'plpc-catalog';

/** Os dois caminhos que compõem o catálogo, servidos do `CATALOG_CACHE_NAME`. */
export const CATALOG_MANIFEST_PATHS = Object.freeze([
  '/louvores-manifest.json',
  '/offline-manifest.json'
]);

/**
 * Caches que o `activate` nunca pode apagar, aconteça o que acontecer.
 * Lista explícita em vez de regex: é a última linha de defesa dos dados do usuário.
 */
export const PROTECTED_CACHE_NAMES = Object.freeze([
  PDF_CACHE_NAME,
  PDF_IMPORT_STAGING_CACHE_NAME,
  CATALOG_CACHE_NAME
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
 * **Permitir por forma conhecida, não negar por lista.** A versão anterior
 * apagava tudo sob `plpc-` que não estivesse numa lista de exceções, o que
 * transformava "criar um cache novo" em "perder dados no próximo deploy" por
 * omissão — foi exatamente assim que o catálogo importado quase se perdeu.
 * Agora só morre o que casa com uma forma reconhecidamente descartável:
 * o cache de app de um deploy que não é o atual, ou o cache legado do PDF.js.
 * Qualquer `plpc-*` novo sobrevive por padrão.
 *
 * @param {unknown} name nome do cache vindo de `caches.keys()` — aceita não-string
 *   porque a função já se defende disso em runtime (ver o `typeof` abaixo)
 * @param {string | undefined} currentAppCache resultado de `appCacheName(version)`
 * @returns {boolean}
 */
export function isObsoleteCacheName(name, currentAppCache) {
  if (typeof name !== 'string' || !name.startsWith(CACHE_PREFIX)) return false;
  // Cinto e suspensório: mesmo que um protegido passasse a casar com um padrão.
  if (PROTECTED_CACHE_NAMES.includes(name)) return false;
  if (name === currentAppCache) return false;
  return APP_CACHE_NAME_PATTERN.test(name) || LEGACY_PDFJS_CACHE_NAME_PATTERN.test(name);
}

/**
 * Copia o catálogo de qualquer cache de app sobrevivente para o cache protegido.
 *
 * Existe por causa da migração: até esta mudança, `OfflineBundleImporter`
 * gravava os dois manifests no cache do app, que agora tem o nome atrelado ao
 * deploy e é apagado pelo `activate`. Sem esta cópia, todo usuário que já tinha
 * importado o bundle perderia o catálogo no primeiro deploy desta mudança — uma
 * vez só, e depois invisível.
 *
 * Precisa rodar ANTES da poda, e é idempotente: nunca sobrescreve o que já está
 * no cache protegido, então rodar em todo `activate` não custa nada.
 *
 * @param {CacheStorage} cacheStorage normalmente o `caches` global
 * @returns {Promise<number>} quantas entradas foram migradas
 */
export async function migrateCatalogManifests(cacheStorage) {
  const names = await cacheStorage.keys();
  const appCaches = names.filter((name) => APP_CACHE_NAME_PATTERN.test(name));
  if (appCaches.length === 0) return 0;

  const target = await cacheStorage.open(CATALOG_CACHE_NAME);
  let migrated = 0;

  for (const name of appCaches) {
    const source = await cacheStorage.open(name);
    const requests = await source.keys();

    for (const request of requests) {
      let pathname;
      try {
        pathname = new URL(request.url).pathname;
      } catch {
        continue;
      }
      if (!CATALOG_MANIFEST_PATHS.includes(pathname)) continue;

      // Já migrado: o cache protegido é a autoridade, não sobrescreve.
      const existing = await target.match(request);
      if (existing) continue;

      const response = await source.match(request);
      if (!response) continue;

      await target.put(request, response);
      migrated++;
    }
  }

  return migrated;
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
