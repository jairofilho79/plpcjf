/**
 * Codificação e limpeza do link de compartilhamento de listas.
 *
 * Formato do link: `{origin}/?sharepdfs=<id>,<id>&sharename=<nome>`.
 * Cada `pdfId` é base64 padrão (não base64url) do caminho relativo do PDF,
 * então pode conter `=`, `/` e — no futuro — `+`. O `+` cru numa query é lido
 * como espaço pelo URLSearchParams, o que corrompe o id sem nenhum erro.
 *
 * Módulo puro de propósito: `+page.svelte` não é testável sob `node --test`.
 */

/**
 * Serializa os ids para ir depois de `sharepdfs=` na URL.
 *
 * Escapa só o `+` (vira `%2B`) — o único caractere do alfabeto Base64 padrão
 * que uma query string lê errado (`URLSearchParams` decodifica `+` como
 * espaço). `=` e `/` já atravessam a URL sem problema hoje (2 198 e 9 ids do
 * acervo, respectivamente) e um `encodeURIComponent` cheio os escaparia à toa,
 * mudando a aparência de todo link novo sem necessidade.
 * @param {string[]} pdfIds
 * @returns {string}
 */
export function encodeSharePdfIds(pdfIds) {
  if (!Array.isArray(pdfIds)) return '';
  return pdfIds
    .filter((id) => typeof id === 'string' && id.trim() !== '')
    .map((id) => id.trim().replace(/\+/g, '%2B'))
    .join(',');
}

/**
 * Lê o valor de `sharepdfs` já decodificado por `URLSearchParams.get`.
 * Aceita tanto o formato novo (cada id codificado) quanto o cru dos links
 * antigos: depois do decode do URLSearchParams os dois são a mesma string.
 * @param {string | null | undefined} param
 * @returns {string[]}
 */
export function parseSharePdfIds(param) {
  if (typeof param !== 'string' || param === '') return [];
  return param
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Remove só `sharepdfs` e `sharename` da query, preservando todo o resto
 * (`utm_source`, `fbclid` e afins chegam nesses links).
 * @param {string} search - `location.search`, com ou sem `?`
 * @returns {string} `''` ou `'?resto=...'`
 */
export function stripShareParams(search) {
  const params = new URLSearchParams(search || '');
  params.delete('sharepdfs');
  params.delete('sharename');
  const resto = params.toString();
  return resto ? `?${resto}` : '';
}

/**
 * Filtra os ids que o catálogo realmente conhece, preservando a ordem pedida.
 * Mesmo critério de `carousel.loadPlaylist`: casar por `pdfId`.
 * @param {string[]} pdfIds
 * @param {Array<{pdfId?: string}>} louvores
 * @returns {string[]}
 */
export function resolveKnownPdfIds(pdfIds, louvores) {
  if (!Array.isArray(pdfIds) || !Array.isArray(louvores)) return [];
  const conhecidos = new Set(
    louvores.map((louvor) => louvor && louvor.pdfId).filter(Boolean)
  );
  return pdfIds.filter((id) => conhecidos.has(id));
}
