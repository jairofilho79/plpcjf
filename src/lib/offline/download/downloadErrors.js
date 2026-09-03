/**
 * Tradução de falhas de download para a tela.
 *
 * A mensagem que chegava ao usuário era a mensagem escrita para o console:
 * "HTTP 500 ao baixar /packages/Cifra-1.zip". Quem lê isso numa tela de celular
 * não sabe se o problema é o aparelho, a internet ou o app, nem o que fazer a
 * seguir — e o download de 800 MB que acabou de falhar merece melhor do que um
 * código de status.
 *
 * Cada frase daqui diz três coisas: o que aconteceu, o que fazer, e que o que
 * já foi baixado continua guardado (é verdade: cada parte concluída fica
 * marcada e não é rebaixada na tentativa seguinte — ver `partProgress.js`).
 *
 * Só importa por caminho relativo e não toca em `$app/*`: precisa rodar sob
 * `node --test`.
 */

// Sem citar o rótulo de um botão: depois de uma falha total o botão da tela
// ainda é "Disponibilizar offline", e mandar tocar em "Baixar PDFs faltantes"
// manda procurar um botão que não está ali.
const TENTE_DE_NOVO =
  ' Tente de novo quando a conexão melhorar: o download continua de onde parou, e o que já foi baixado continua guardado.';

/**
 * Mensagens que já foram escritas para gente passam intactas.
 *
 * O critério é o que elas têm e um erro técnico não tem: uma instrução em
 * português. Sem isto, uma frase boa seria reescrita numa genérica.
 *
 * @param {string} msg
 * @returns {boolean}
 */
function jaEhParaGente(msg) {
  return /wi-fi|espaço|libere|confirme|tente novamente/i.test(msg) && /[a-z] [a-z]+ [a-z]+/i.test(msg);
}

/**
 * @param {unknown} erro
 * @returns {string}
 */
export function mensagemDeErroDeDownload(erro) {
  const e = /** @type {any} */ (erro);
  const msg = String(e?.message ?? e ?? '');

  if (msg === 'DOWNLOAD_CANCELLED' || e?.name === 'AbortError') {
    return 'Download cancelado. O que já foi baixado continua guardado.';
  }

  if (jaEhParaGente(msg)) return msg;

  const arquivo = msg.match(/([\w .-]+\.zip)/)?.[1];
  const sufixoArquivo = arquivo ? ` (lote ${arquivo})` : '';

  // Pelas mensagens que cada navegador usa, e não por `instanceof TypeError`:
  // um TypeError de programação cairia aqui e seria reportado como falta de
  // internet, mandando a pessoa checar o wi-fi por causa de um bug nosso.
  if (/Failed to fetch|NetworkError|network error|Load failed|conex/i.test(msg)) {
    return `Sem conexão com a internet durante o download${sufixoArquivo}.${TENTE_DE_NOVO}`;
  }

  if (/Tempo esgotado|timeout/i.test(msg)) {
    return `A rede demorou demais para responder${sufixoArquivo}. Numa conexão mais estável o download costuma passar.${TENTE_DE_NOVO}`;
  }

  const status = Number(msg.match(/HTTP (\d{3})/)?.[1]);

  if (status === 404 || status === 410) {
    return `Um dos lotes não está mais disponível no servidor${sufixoArquivo}. Recarregue a página para buscar a lista atualizada e tente de novo.`;
  }

  if (status >= 500 || /Falha ao baixar o pacote/i.test(msg)) {
    return `O servidor não respondeu por um dos lotes${sufixoArquivo}. Costuma ser temporário: tente de novo em alguns minutos.${TENTE_DE_NOVO}`;
  }

  if (status >= 400) {
    return `O servidor recusou o download de um dos lotes${sufixoArquivo} (HTTP ${status}).${TENTE_DE_NOVO}`;
  }

  return `Não foi possível concluir o download${sufixoArquivo}.${TENTE_DE_NOVO}${
    msg ? ` (detalhe: ${msg})` : ''
  }`;
}
