/**
 * Resolução de chave de PDF no bucket R2 a partir do pathname da requisição.
 *
 * Extraída de `src/hooks.server.js` (achado C2 da revisão final) por dois
 * motivos:
 *
 * 1. `hooks.server.js` importa `$lib/server/r2KeyMatch.js` pelo alias do
 *    Vite/SvelteKit, que não existe fora dele — não dá para importar
 *    `hooks.server.js` direto num teste `node --test`. Este módulo só usa
 *    caminhos relativos, então é testável isoladamente, com um bucket R2
 *    simulado (só precisa do mesmo contrato `get`/`list` do binding real).
 * 2. Dá ao algoritmo de resolução um único dono, coberto por um teste de
 *    corpus sobre os 4629 caminhos reais do acervo — em vez de duplicar a
 *    lógica dentro de um arquivo de teste que precisaria ser mantido à mão
 *    em sincronia com `hooks.server.js`.
 *
 * Ordem das tentativas (da mais barata/específica à mais genérica):
 *   1. GET direto pela chave decodificada da URL.
 *   2. GET após decodificações adicionais (lida com dupla/tripla
 *      codificação).
 *   3. GET direto nas duas formas de normalização Unicode (NFD/NFC) — a
 *      migração do cliente para NFC (#22.2) manda a chave em NFC, mas o R2
 *      ainda guarda em NFD os caminhos que existiam antes dela. Isto cobre
 *      inclusive os 3 caminhos do acervo em que o acento está no nome de um
 *      *diretório* (não do arquivo), onde o fallback de prefixo abaixo não
 *      encontra nada porque o prefixo em NFC não bate com o diretório em
 *      NFD gravado no bucket.
 *   4. Como último recurso, lista o diretório por prefixo e casa por
 *      igualdade exata após normalizar acento/caixa (`findExactKeyMatch`) —
 *      nunca por prefixo textual (esse era o defeito #09).
 */
import { findExactKeyMatch } from './r2KeyMatch.js';

/**
 * @typedef {{ get: (key: string) => Promise<any>, list: (opts: {prefix: string}) => Promise<{objects: {key: string}[]}> }} R2LikeBucket
 */

/**
 * @param {string} pathname - ex.: "/assets/ColAdultos/001.pdf"
 * @param {R2LikeBucket} bucket
 * @returns {Promise<{ object: any, key: string } | null>} o objeto encontrado e a
 *   chave real que o bucket reconhece (pode diferir do pathname pedido)
 */
export async function resolvePdfKey(pathname, bucket) {
  // pathname vem como "/assets/ColAdultos/001.pdf"; pode conter caracteres
  // percent-encoded (%20 para espaço, %5C para barra invertida) a serem
  // decodificados antes do GET no R2, cuja chave é "assets/ColAdultos/001.pdf"
  // (sem barra inicial).
  let r2Key = decodeURIComponent(pathname.substring(1));

  let object = await bucket.get(r2Key);

  // Decodificações adicionais: lida com dupla/tripla codificação.
  if (!object) {
    let decodedKey = r2Key;
    for (let i = 0; i < 5; i++) {
      try {
        decodedKey = decodeURIComponent(decodedKey);
        object = await bucket.get(decodedKey);
        if (object) {
          r2Key = decodedKey;
          break;
        }
      } catch {
        // Não dá para decodificar mais; para de tentar.
        break;
      }
    }
  }

  // NFD/NFC: ver motivo (3) no comentário do topo do arquivo.
  if (!object) {
    for (const candidate of [r2Key.normalize('NFD'), r2Key.normalize('NFC')]) {
      if (candidate === r2Key) continue;
      object = await bucket.get(candidate);
      if (object) {
        console.log(`[R2] Chave equivalente por normalização Unicode: ${r2Key} -> ${candidate}`);
        r2Key = candidate;
        break;
      }
    }
  }

  // Último recurso: a chave real pode diferir só em acento/caixa.
  // Correspondência exata após normalização — nunca por prefixo (achado #09).
  if (!object) {
    const pathParts = r2Key.split('/');
    const expectedFilename = pathParts.pop();
    const prefix = pathParts.join('/');

    const list = await bucket.list({ prefix });
    const matched = findExactKeyMatch(
      list.objects.map((item) => item.key),
      `${prefix}/${expectedFilename}`
    );

    if (matched) {
      object = await bucket.get(matched);
      if (object) {
        console.log(`[R2] Chave equivalente encontrada: ${r2Key} -> ${matched}`);
        r2Key = matched;
      }
    }
  }

  return object ? { object, key: r2Key } : null;
}
