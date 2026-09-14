/**
 * Codificação e limpeza do link de compartilhamento de listas.
 *
 * Formato do link: `{origin}/?sharepdfs=<id>,<id>&sharename=<nome>`.
 * Cada `pdfId` é base64 padrão (não base64url) do caminho relativo do PDF,
 * então pode conter `=`, `/` e — no futuro — `+`. O `+` cru numa query é lido
 * como espaço pelo URLSearchParams, o que corrompe o id sem nenhum erro.
 *
 * Módulo puro de propósito: `+page.svelte` não é testável sob `node --test`.
 *
 * ## Formato curto (2026-09 — contrato compartilhado com o app v2)
 *
 *   `{origin}/?s=1a2f-0c3d-ffe1&n=Culto%20de%20domingo`
 *
 * - `s`: `shortId`s (string hex minúscula, `[0-9a-f]{4,8}`, "0000" é válido)
 *   separados por `-`, na ordem da lista; repetidos permitidos.
 * - `n`: nome da lista (`encodeURIComponent`). Obrigatório — marca a URL como share.
 * - Leitura: normaliza maiúsculas; token inválido ou desconhecido é ignorado;
 *   `s` presente vence os params legados. Nunca converter `shortId` em número.
 * - Emissão: só quando TODOS os pdfIds têm `shortId` no catálogo; senão, legado.
 */

export const SHORT_SHARE_PARAM = 's';
export const SHORT_SHARE_NAME_PARAM = 'n';
const SHORT_ID_PATTERN = /^[0-9a-f]{4,8}$/;

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
  params.delete(SHORT_SHARE_PARAM);
  params.delete(SHORT_SHARE_NAME_PARAM);
  const resto = params.toString();
  return resto ? `?${resto}` : '';
}

/**
 * Lê um link/texto colado pelo usuário («Importar link» em /listas) e devolve
 * a query só com os params de share, pronta para `goto('/' + query)` — a
 * home então importa pelo mesmo caminho do link clicado.
 *
 * Aceita a URL inteira, a query solta (com ou sem `?`) ou o texto que o
 * WhatsApp cola junto com o link (legenda + link). Tenta o texto inteiro,
 * depois cada linha, depois cada palavra: a primeira leitura válida vence.
 * Válido = `s` e `n` não vazios (`s` vence) ou `sharepdfs` não vazio.
 * @param {unknown} texto
 * @returns {string | null} `'?s=...&n=...'`, `'?sharepdfs=...&sharename=...'` ou `null`
 */
export function extractShareQueryFromText(texto) {
  if (typeof texto !== 'string') return null;
  const inteiro = texto.trim();
  if (inteiro === '') return null;

  const candidatos = [inteiro, ...inteiro.split(/\r?\n/), ...inteiro.split(/\s+/)];
  for (const candidato of candidatos) {
    const query = shareQueryDoTrecho(candidato);
    if (query) return query;
  }
  return null;
}

/**
 * @param {string} trecho
 * @returns {string | null}
 */
function shareQueryDoTrecho(trecho) {
  const semFragmento = trecho.split('#')[0];
  const interrogacao = semFragmento.indexOf('?');
  const bruto = interrogacao >= 0 ? semFragmento.slice(interrogacao + 1) : semFragmento;
  if (!bruto.includes('=')) return null;

  const params = new URLSearchParams(bruto);
  const s = params.get(SHORT_SHARE_PARAM);
  const n = params.get(SHORT_SHARE_NAME_PARAM);
  const soShare = new URLSearchParams();
  if (s && n) {
    soShare.set(SHORT_SHARE_PARAM, s);
    soShare.set(SHORT_SHARE_NAME_PARAM, n);
  } else if (params.get('sharepdfs')) {
    soShare.set('sharepdfs', /** @type {string} */ (params.get('sharepdfs')));
    soShare.set('sharename', params.get('sharename') || '');
  } else {
    return null;
  }
  return `?${soShare.toString()}`;
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

/**
 * `shortId` válido: string hex minúscula de 4 a 8 caracteres.
 * @param {unknown} value
 * @returns {value is string}
 */
export function isShortId(value) {
  return typeof value === 'string' && SHORT_ID_PATTERN.test(value);
}

/**
 * Serializa os shortIds para `s=`. Minúsculo; ignora o que não é shortId.
 * @param {unknown[]} shortIds
 * @returns {string}
 */
export function encodeShortShareIds(shortIds) {
  if (!Array.isArray(shortIds)) return '';
  return shortIds
    .map((id) => (typeof id === 'string' ? id.toLowerCase() : id))
    .filter(isShortId)
    .join('-');
}

/**
 * Lê `s=` já decodificado por `URLSearchParams.get`. Normaliza maiúsculas,
 * ignora tokens fora do padrão, preserva ordem e repetições.
 * @param {string | null | undefined} param
 * @returns {string[]}
 */
export function parseShortShareIds(param) {
  if (typeof param !== 'string' || param === '') return [];
  return param
    .split('-')
    .map((token) => token.trim().toLowerCase())
    .filter(isShortId);
}

/**
 * `shortId → pdfId` pelo catálogo, na ordem pedida, sem repetição — a UI do
 * plpcjf nunca repete louvor (`addToCarousel` recusa duplicata). Desconhecido
 * é ignorado.
 * Comparação textual: um `shortId` numérico no catálogo não casa.
 * @param {string[]} shortIds
 * @param {Array<{pdfId?: string, shortId?: unknown}>} louvores
 * @returns {string[]}
 */
export function resolveShortIds(shortIds, louvores) {
  if (!Array.isArray(shortIds) || !Array.isArray(louvores)) return [];
  const porShortId = new Map();
  for (const louvor of louvores) {
    if (louvor && isShortId(louvor.shortId) && typeof louvor.pdfId === 'string') {
      porShortId.set(louvor.shortId, louvor.pdfId);
    }
  }
  const vistos = new Set();
  const pdfIds = [];
  for (const shortId of shortIds) {
    const pdfId = porShortId.get(shortId);
    if (pdfId === undefined || vistos.has(pdfId)) continue;
    vistos.add(pdfId);
    pdfIds.push(pdfId);
  }
  return pdfIds;
}

/**
 * `pdfId → shortId` para emissão. `null` se a lista está vazia ou se algum
 * pdfId não tem shortId — aí o link tem de sair no formato legado.
 * @param {string[]} pdfIds
 * @param {Array<{pdfId?: string, shortId?: unknown}>} louvores
 * @returns {string[] | null}
 */
export function shortIdsForPdfIds(pdfIds, louvores) {
  if (!Array.isArray(pdfIds) || pdfIds.length === 0 || !Array.isArray(louvores)) return null;
  const porPdfId = new Map();
  for (const louvor of louvores) {
    if (louvor && typeof louvor.pdfId === 'string' && isShortId(louvor.shortId)) {
      porPdfId.set(louvor.pdfId, louvor.shortId);
    }
  }
  const shortIds = [];
  for (const pdfId of pdfIds) {
    const shortId = porPdfId.get(pdfId);
    if (shortId === undefined) return null;
    shortIds.push(shortId);
  }
  return shortIds;
}
