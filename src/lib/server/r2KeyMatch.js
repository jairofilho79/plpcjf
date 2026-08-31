/**
 * Correspondência de chave no bucket R2.
 *
 * Substitui a heurística de prefixo de 10 caracteres (achado #09), que podia
 * servir a partitura errada: neste acervo os nomes de arquivo se repetem
 * (Cifra.pdf, Coro.pdf, Partitura.pdf) e a normalização remove tudo que não é
 * alfanumérico, então prefixos curtos colidem com facilidade.
 *
 * Regra: igualdade após uma normalização única. Sem correspondência, 404 —
 * errar explicitamente é melhor que acertar por acaso.
 */

/**
 * Minúsculas, sem acentos, sem separadores dentro de cada segmento;
 * a estrutura de diretórios (as barras) é preservada.
 * @param {string | null | undefined} key
 * @returns {string}
 */
export function normalizeR2Key(key) {
  if (!key || typeof key !== 'string') return '';
  return key
    .replace(/\\/g, '/')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split('/')
    .map((segment) => segment.replace(/[^a-z0-9]/g, ''))
    .join('/');
}

/**
 * @param {string[] | null | undefined} candidates chaves reais do bucket
 * @param {string} expected chave pedida
 * @returns {string | null} a chave real equivalente, ou null
 */
export function findExactKeyMatch(candidates, expected) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const target = normalizeR2Key(expected);
  if (!target) return null;

  for (const candidate of candidates) {
    if (normalizeR2Key(candidate) === target) return candidate;
  }
  return null;
}
