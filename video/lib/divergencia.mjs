/**
 * Quão longe o que o modelo disse ficou do que lhe pedimos, entre 0 e 1.
 *
 * O gpt-audio devolve uma transcrição do que narrou. Comparar essa transcrição
 * com o texto pedido é a única defesa contra o modelo acrescentar um "Claro!
 * Aqui está:" no início de um tutorial — coisa que ninguém repara até o vídeo
 * estar montado.
 *
 * Compara por palavras e não por letras: o TTS transcreve com pontuação e caixa
 * próprias, e uma vírgula a mais não é improviso.
 */
function normalizar(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // tira acentos
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')                   // tira pontuação
    .split(/\s+/)
    .filter(Boolean);
}

function levenshteinPalavras(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) {
      atual[j] = Math.min(
        anterior[j] + 1,
        atual[j - 1] + 1,
        anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    anterior = atual;
  }
  return anterior[b.length];
}

export function divergencia(pedido, dito) {
  const a = normalizar(pedido);
  const b = normalizar(dito);
  if (a.length === 0 && b.length === 0) return 0;
  const dist = levenshteinPalavras(a, b);
  return Math.min(1, dist / Math.max(a.length, b.length));
}
