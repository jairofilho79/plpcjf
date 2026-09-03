const MAX_LINHAS = 3;

/**
 * Quebra a fala em linhas de legenda.
 *
 * Guloso por palavras, sem nunca partir uma palavra: um numero de louvor ou um
 * rotulo de botao cortado ao meio deixa de ser legivel, que e o oposto do que a
 * legenda existe para fazer. Se nao couber em tres linhas, corta e assinala com
 * reticencias em vez de tapar meia tela - mas isso e sinal de que a fala esta
 * comprida demais para um beat e devia ser dividida em dois.
 *
 * @param {string} texto
 * @param {number} largura em caracteres
 * @returns {string[]}
 */
export function quebrar(texto, largura) {
  const palavras = String(texto).trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return [];

  const linhas = [];
  let atual = '';

  for (const palavra of palavras) {
    if (atual === '') {
      atual = palavra;
    } else if (atual.length + 1 + palavra.length <= largura) {
      atual += ' ' + palavra;
    } else {
      linhas.push(atual);
      atual = palavra;
    }
  }
  if (atual) linhas.push(atual);

  if (linhas.length <= MAX_LINHAS) return linhas;

  const cortadas = linhas.slice(0, MAX_LINHAS);
  const ultima = cortadas[MAX_LINHAS - 1];
  cortadas[MAX_LINHAS - 1] =
    ultima.length >= largura ? ultima.slice(0, largura - 1).trimEnd() + '…' : ultima + '…';
  return cortadas;
}
