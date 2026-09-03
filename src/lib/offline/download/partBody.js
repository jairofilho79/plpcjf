/**
 * Leitura do corpo de uma parte com progresso por bytes.
 *
 * Existe por um motivo só: `await response.blob()` devolve tudo de uma vez, e
 * entre a chamada e o retorno passam-se minutos numa parte de ~30 MB em rede
 * móvel. Nesse intervalo a tela não tinha nada para mostrar — o contador ficava
 * parado no mesmo número, e quem estava do outro lado concluía que o download
 * tinha travado. Lendo o corpo pelo `ReadableStream`, cada pedaço que chega da
 * rede vira um número que se move.
 *
 * Só importa por caminho relativo e não toca em `$app/*`: precisa rodar sob
 * `node --test`.
 */

/**
 * @typedef {Object} ReadBodyOptions
 * @property {(bytes: number) => void} onBytes chamada a cada pedaço, com o
 *   tamanho DESTE pedaço (incremental, não acumulado)
 * @property {string} [type] tipo MIME do Blob devolvido
 */

/**
 * Lê o corpo inteiro devolvendo um Blob, reportando os bytes conforme chegam.
 *
 * @param {Response} response
 * @param {ReadBodyOptions} options
 * @returns {Promise<Blob>}
 */
export async function readBodyWithProgress(response, options) {
  const { onBytes, type } = options;
  const opcoesBlob = type ? { type } : undefined;

  const reader =
    response.body && typeof response.body.getReader === 'function'
      ? response.body.getReader()
      : null;

  // Sem `ReadableStream` (Safari antigo, resposta sem corpo expostos): melhor
  // um relatório único no fim do que nenhum.
  if (!reader) {
    const blob = await response.blob();
    onBytes(blob.size);
    return blob;
  }

  /** @type {Uint8Array[]} */
  const pedacos = [];

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    pedacos.push(value);
    onBytes(value.byteLength);
  }

  // Cast: `Uint8Array` é sempre um BlobPart válido em runtime; o typing de
  // lib.dom exige `ArrayBuffer` (não `ArrayBufferLike`) desde o TS 5.9.
  return new Blob(/** @type {BlobPart[]} */ (/** @type {unknown} */ (pedacos)), opcoesBlob);
}

/**
 * Tamanho anunciado pelo servidor, quando ele anuncia.
 *
 * Serve para a barra de uma parte; o total do download continua vindo do
 * manifesto. Devolve null quando o cabeçalho falta (resposta em chunks) ou não
 * é um número — nesse caso quem chama mostra só os bytes acumulados.
 *
 * @param {Response} response
 * @returns {number | null}
 */
export function declaredBodySize(response) {
  const bruto = response.headers?.get?.('content-length');
  if (!bruto) return null;
  const n = Number(bruto);
  return Number.isFinite(n) && n > 0 ? n : null;
}
