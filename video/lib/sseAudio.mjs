/**
 * Extrai áudio e transcrição de uma resposta SSE do OpenRouter.
 *
 * O endpoint recusa saída de áudio sem `stream: true` — devolve
 * `400 Audio output requires stream: true` —, então o áudio chega sempre
 * fatiado nos deltas, nunca num campo único. E o erro vem *dentro* do fluxo,
 * com HTTP 200 por fora: é por isso que `erro` é um valor de retorno e não uma
 * exceção do transporte. Quem chamar tem de o olhar.
 *
 * @param {string} texto corpo bruto da resposta
 * @returns {{ pcmBase64: string[], transcricao: string, erro: object|null }}
 */
export function extrairAudioSSE(texto) {
  /** @type {string[]} */
  const pcmBase64 = [];
  let transcricao = '';
  /** @type {object|null} */
  let erro = null;

  for (const linha of String(texto).split('\n')) {
    const t = linha.trim();
    if (!t.startsWith('data:')) continue;      // comentários de keep-alive caem aqui
    const carga = t.slice(5).trim();
    if (carga === '[DONE]') break;

    let d;
    try {
      d = JSON.parse(carga);
    } catch {
      continue;                                 // linha truncada: as boas seguem
    }

    if (d.error && !erro) erro = d.error;
    for (const escolha of d.choices || []) {
      const audio = (escolha.delta || {}).audio;
      if (!audio) continue;
      if (audio.data) pcmBase64.push(audio.data);
      if (audio.transcript) transcricao += audio.transcript;
    }
  }

  return { pcmBase64, transcricao, erro };
}
