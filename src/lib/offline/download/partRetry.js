/**
 * Retentativa da PARTE inteira: pedido e corpo, como uma coisa só.
 *
 * `fetchWithRetry` protege apenas o pedido — a promessa do `fetch` resolve
 * assim que os cabeçalhos chegam, e os ~30 MB do corpo vêm depois disso. Numa
 * rede móvel, é justamente durante esses megabytes que a conexão cai: o túnel
 * entre uma antena e outra, o elevador, a troca de wi-fi para dados. A queda
 * acontecia fora de qualquer retentativa, e derrubava o download inteiro —
 * medido no banco de ensaio: uma única queda no meio da parte 2 deixou 40 dos
 * 192 PDFs baixados e abandonou as outras 5 partes.
 *
 * Aqui a unidade de retentativa é a parte: se o corpo se perde no meio, o
 * pedido é refeito do começo, os bytes da tentativa perdida são devolvidos
 * para quem os contabiliza, e a espera cresce a cada tentativa.
 *
 * Só importa por caminho relativo e não toca em `$app/*`: precisa rodar sob
 * `node --test`.
 */

import { readBodyWithProgress } from './partBody.js';
import { isRetryableStatus } from './partProgress.js';

/**
 * @typedef {Object} DownloadPartOptions
 * @property {typeof fetch} fetchImpl
 * @property {RequestInit} [init]
 * @property {number} [attempts=4]
 * @property {number} [baseDelayMs=800]
 * @property {number} [maxDelayMs=15000]
 * @property {boolean} [jitter=true]
 * @property {string} [type] tipo MIME do Blob devolvido
 * @property {(response: Response) => void} [validateResponse] inspeciona a
 *   resposta antes de ler o corpo; um throw daqui é definitivo (não retenta)
 * @property {(bytes: number) => void} onBytes bytes deste pedaço
 * @property {(tentativa: number, erro: Error, bytesPerdidos: number) => void} [onAttemptFailed]
 * @property {() => boolean} [isCancelled]
 * @property {(ms: number) => Promise<void>} [sleepImpl]
 */

/**
 * @param {string} url
 * @param {DownloadPartOptions} options
 * @returns {Promise<Blob>}
 */
export async function downloadPartWithRetry(url, options) {
  const {
    fetchImpl,
    init,
    attempts = 4,
    baseDelayMs = 800,
    maxDelayMs = 15000,
    jitter = true,
    type,
    validateResponse,
    onBytes,
    onAttemptFailed,
    isCancelled = () => false,
    sleepImpl = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms))
  } = options;

  /** @type {Error | null} */
  let ultimoErro = null;

  for (let tentativa = 1; tentativa <= attempts; tentativa++) {
    if (isCancelled()) throw new Error('DOWNLOAD_CANCELLED');

    if (tentativa > 1) {
      const exponencial = Math.min(maxDelayMs, baseDelayMs * 2 ** (tentativa - 2));
      await sleepImpl(jitter ? Math.round(exponencial * (0.5 + Math.random() * 0.5)) : exponencial);
      if (isCancelled()) throw new Error('DOWNLOAD_CANCELLED');
    }

    // Bytes desta tentativa: contabilizados na hora (para a tela se mexer) e
    // devolvidos se a tentativa não chegar ao fim (para o total não inflar).
    let bytesDaTentativa = 0;

    try {
      const response = await fetchImpl(url, init);

      if (!response.ok) {
        const erro = new Error(`HTTP ${response.status} ao baixar ${url}`);
        // 404 e 403 não melhoram com insistência: falha na hora.
        if (!isRetryableStatus(response.status)) throw erro;
        ultimoErro = erro;
        onAttemptFailed?.(tentativa, erro, 0);
        continue;
      }

      // Portal cativo e afins: a resposta é 200, mas não é o pacote. Insistir
      // não muda nada — quem decide é o validador, e o erro dele é definitivo.
      if (validateResponse) validateResponse(response);

      return await readBodyWithProgress(response, {
        type,
        onBytes: (bytes) => {
          bytesDaTentativa += bytes;
          onBytes(bytes);
        }
      });
    } catch (erro) {
      if (isCancelled()) throw new Error('DOWNLOAD_CANCELLED');

      const e = erro instanceof Error ? erro : new Error(String(erro));

      // Cancelamento pelo usuário e status não retentável saem inteiros.
      if (e.name === 'AbortError' || e.message === 'DOWNLOAD_CANCELLED') throw e;
      if (/** @type {any} */ (e).naoRetentavel) throw e;
      if (/^HTTP \d{3} /.test(e.message) && !isRetryableStatus(Number(e.message.slice(5, 8)))) {
        throw e;
      }

      ultimoErro = e;
      onAttemptFailed?.(tentativa, e, bytesDaTentativa);
    }
  }

  throw ultimoErro ?? new Error(`Falha ao baixar ${url}`);
}
