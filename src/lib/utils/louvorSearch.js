/** Portuguese function words removed so title search tolerates omitted articles/prepositions (e.g. "senhor minha rocha" vs full title). */
export const STOP_WORDS = new Set([
  'a',
  'o',
  'os',
  'as',
  'um',
  'uma',
  'uns',
  'umas',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'd',
  'em',
  'no',
  'na',
  'nas',
  'ao',
  'aos',
  'à',
  'às',
  'pelo',
  'pela',
  'pelos',
  'pelas',
  'por',
  'para',
  'pra',
  'pro',
  'com',
  'sem',
  'sobre',
  'sob',
  'entre',
  'até',
  'ate',
  'desde',
  'após',
  'apos',
  'ante',
  'perante',
  'contra',
  'durante',
  'mediante',
  'e',
  'ou',
  'nem',
  'mas',
  'que',
  'se',
  'como',
  'pois',
  'logo',
  'cujo',
  'cuja',
  'cujos',
  'cujas',
  'é',
  'são',
  'sao',
  'foi',
  'ser',
  'era',
  'eram',
  'este',
  'esta',
  'estes',
  'estas',
  'esse',
  'essa',
  'esses',
  'essas',
  'aquele',
  'aquela',
  'aqueles',
  'aquelas',
  'isto',
  'isso',
  'aquilo',
  'lhe',
  'lhes',
  'me',
  'te',
  'vos',
  'lhos'
]);

/**
 * Same normalization as legacy search: lowercase, strip accents, keep letters/digits/spaces.
 * @param {string} str
 * @returns {string}
 */
export function normalizeForSearch(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, '');
}

/**
 * Split normalized text into tokens (non-empty).
 * @param {string} normalized
 * @returns {string[]}
 */
export function normalizedTokens(normalized) {
  if (!normalized) return [];
  return normalized.trim().split(/\s+/).filter(Boolean);
}

/**
 * Content tokens: normalized, split, minus Portuguese stop words.
 * @param {string} str
 * @returns {string[]}
 */
export function tokensContent(str) {
  return normalizedTokens(normalizeForSearch(str)).filter((t) => !STOP_WORDS.has(t));
}

/**
 * Every needle token appears in haystack in order (gaps allowed).
 * @param {string[]} haystack
 * @param {string[]} needle
 * @returns {boolean}
 */
export function isOrderedSubsequence(haystack, needle) {
  if (needle.length === 0) return true;
  let j = 0;
  for (let i = 0; i < haystack.length && j < needle.length; i++) {
    if (haystack[i] === needle[j]) j++;
  }
  return j === needle.length;
}

/**
 * @param {string} nome
 * @param {string} searchQuery
 * @param {string[] | undefined} precomputedTitleTokens content tokens for nome (from manifest enrich)
 * @returns {boolean}
 */
export function louvorNomeMatchesSearch(nome, searchQuery, precomputedTitleTokens) {
  const searchNorm = normalizeForSearch(searchQuery);
  const titleNorm = normalizeForSearch(nome ?? '');
  const queryTokens = tokensContent(searchQuery);
  const titleTokens = Array.isArray(precomputedTitleTokens)
    ? precomputedTitleTokens
    : tokensContent(nome ?? '');

  if (queryTokens.length === 0) {
    return titleNorm.includes(searchNorm);
  }
  return isOrderedSubsequence(titleTokens, queryTokens);
}
