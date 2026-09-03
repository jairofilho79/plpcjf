/**
 * Guarda o catálogo no cache protegido a partir do texto que a app acabou de
 * baixar — sem gastar um segundo download.
 *
 * O Service Worker guarda os manifests sozinho (estratégia `catalog`,
 * cache-first), mas só a partir da SEGUNDA visita: na primeira, o worker ainda
 * está instalando quando a página busca o catálogo, e a resposta passa longe
 * dele. Medido em 02/09/2026 num perfil limpo: depois de uma primeira visita
 * inteira à home, `plpc-catalog` estava vazio; só depois de recarregar é que o
 * manifesto aparecia lá.
 *
 * Consequência para quem instala a app e perde a conexão logo em seguida:
 * /biblioteca e /listas abrem — o shell está pré-cacheado — mas abrem vazias,
 * porque as duas dependem do catálogo.
 *
 * Buscar o manifesto de novo dentro do `install` do worker resolveria, ao custo
 * de baixar 1,4 MB duas vezes na primeira visita. Guardar o texto que a página
 * já tem na mão custa zero byte de rede.
 *
 * Só importa por caminho relativo e não toca em `$app/*`: precisa rodar sob
 * `node --test`.
 */

import { CATALOG_CACHE_NAME, CATALOG_MANIFEST_PATHS } from '../sw/swCaches.js';

/**
 * @typedef {'guardado' | 'ja-tinha' | 'ignorado' | 'indisponivel' | 'falhou'} ResultadoGuarda
 */

/**
 * @param {string} path caminho do manifesto (deve ser um dos do catálogo)
 * @param {string} texto corpo já lido da resposta
 * @param {{ cachesImpl?: any }} [deps]
 * @returns {Promise<ResultadoGuarda>}
 */
export async function guardarManifestNoCatalogo(path, texto, deps = {}) {
  const cachesImpl = 'cachesImpl' in deps ? deps.cachesImpl : globalThis.caches;

  if (!CATALOG_MANIFEST_PATHS.includes(path)) return 'ignorado';
  if (!texto) return 'ignorado';
  if (!cachesImpl || typeof cachesImpl.open !== 'function') return 'indisponivel';

  try {
    const cache = await cachesImpl.open(CATALOG_CACHE_NAME);

    // Só preenche o que falta. Reescrever a cada carregamento gastaria 1,4 MB
    // de escrita à toa, e um catálogo vindo do pacote offline importado não
    // pode ser substituído pelo da rede por este caminho — quem decide trocar
    // é a sincronização por checksum, que limpa este cache antes.
    if (await cache.match(path)) return 'ja-tinha';

    await cache.put(
      path,
      new Response(texto, { headers: { 'Content-Type': 'application/json' } })
    );
    return 'guardado';
  } catch {
    // Cota, modo privado, dados de site bloqueados: nada aqui vale derrubar o
    // carregamento do catálogo, que já deu certo.
    return 'falhou';
  }
}
