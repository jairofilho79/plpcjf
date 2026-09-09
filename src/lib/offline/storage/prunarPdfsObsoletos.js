/**
 * Poda PDFs que já não existem no catálogo atual, do cache de PDFs.
 *
 * Existe para desbloquear quem já baixou o acervo inteiro e ficou sem espaço
 * para a atualização do catálogo persistir (ver `storageQuota.js` e
 * `catalogoCache.js`): antes de desistir por falta de espaço, vale tentar
 * liberar o que o próprio catálogo novo já descartou. Um PDF removido do
 * servidor não é conteúdo que a pessoa "escolheu manter" — é lixo que o
 * download antigo deixou para trás.
 *
 * Nunca remove um caminho que ainda esteja no catálogo novo, mesmo que ele
 * pertença a uma categoria que a pessoa não baixou (`caminhosValidos` é
 * calculado pelo chamador a partir do catálogo inteiro, não só do que está
 * salvo — podar por categoria salva é responsabilidade de outra função).
 *
 * Só importa por caminho relativo e não toca em `$app/*`: precisa rodar sob
 * `node --test`.
 */

import { decodeUrlUtf8 } from '../../utils/urlEncoding.js';
import PdfPathManager from '../utils/PdfPathManager.js';

/**
 * @param {string} cacheName nome do cache de PDFs (`PDF_CACHE_NAME`)
 * @param {Set<string> | string[]} caminhosValidos caminhos normalizados
 *   (`PdfPathManager.normalizeForStorage`) que devem sobreviver — tudo que
 *   estiver no cache e não estiver aqui é considerado obsoleto
 * @param {{ cachesImpl?: any }} [deps]
 * @returns {Promise<{ removidos: number }>}
 */
export async function podarPdfsObsoletos(cacheName, caminhosValidos, deps = {}) {
  const cachesImpl = 'cachesImpl' in deps ? deps.cachesImpl : globalThis.caches;
  const validos = caminhosValidos instanceof Set ? caminhosValidos : new Set(caminhosValidos || []);

  // Nunca poda contra um conjunto vazio: um catálogo vazio quase certo é uma
  // falha de rede/parse a montante, não "o servidor não tem mais nada" — não
  // é este código que deve decidir isso.
  if (validos.size === 0) return { removidos: 0 };
  if (!cachesImpl || typeof cachesImpl.open !== 'function') return { removidos: 0 };

  try {
    const cache = await cachesImpl.open(cacheName);
    const requests = await cache.keys();

    let removidos = 0;
    for (const req of requests) {
      let pathname;
      try {
        pathname = decodeUrlUtf8(new URL(req.url).pathname);
      } catch {
        continue;
      }
      if (!pathname.toLowerCase().endsWith('.pdf')) continue;

      const normalizado = PdfPathManager.normalizeForStorage(pathname);
      if (!normalizado || validos.has(normalizado)) continue;

      try {
        if (await cache.delete(req)) removidos++;
      } catch {
        // Segue podando o resto — uma falha isolada não deve travar as outras.
      }
    }

    return { removidos };
  } catch {
    // Best-effort: nunca deve impedir quem chamou de tentar gravar de novo.
    return { removidos: 0 };
  }
}
