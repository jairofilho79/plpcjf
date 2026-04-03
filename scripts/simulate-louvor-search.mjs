/**
 * Random search simulations against a louvores-manifest.json (read-only QA).
 * Usage: node scripts/simulate-louvor-search.mjs [path/to/louvores-manifest.json]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  louvorNomeMatchesSearch,
  tokensContent,
  normalizeForSearch,
  normalizedTokens,
  STOP_WORDS
} from '../src/lib/utils/louvorSearch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultManifest = '/Volumes/SSD 2TB SD/louvores-manifest.json';
const manifestPath = process.argv[2] || defaultManifest;

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomFuzzString() {
  const len = randInt(0, 40);
  let s = '';
  for (let i = 0; i < len; i++) {
    const r = Math.random();
    if (r < 0.1) s += ' ';
    else if (r < 0.15) s += String.fromCharCode(randInt(0x20, 0x7e));
    else if (r < 0.25) s += String.fromCharCode(randInt(0xc0, 0x24f)); // latin extended-ish
    else if (r < 0.35) s += 'áéíóúãõç';
    else s += String.fromCharCode(randInt(0x61, 0x7a));
  }
  return s;
}

/** Query formada só por stops + espaços: força ramo fallback */
function randomStopsOnlyQuery() {
  const arr = [...STOP_WORDS];
  const n = randInt(1, 6);
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(arr[randInt(0, arr.length - 1)]);
  return parts.join(' '.repeat(randInt(1, 3)));
}

function assert(cond, msg, ctx) {
  if (!cond) {
    const e = new Error(msg);
    e.ctx = ctx;
    throw e;
  }
}

function legacyIncludes(nome, q) {
  const t = normalizeForSearch(nome ?? '');
  const s = normalizeForSearch(q ?? '');
  return t.includes(s);
}

const raw = fs.readFileSync(manifestPath, 'utf8');
const data = JSON.parse(raw);
if (!Array.isArray(data)) {
  console.error('Manifest must be a JSON array');
  process.exit(1);
}

const N = 5000;
let throws = [];
let assertionFails = [];
let legacyStrictCount = 0;
let legacyTrueNewFalse = [];

for (let iter = 0; iter < N; iter++) {
  const louvor = data[randInt(0, data.length - 1)];
  const nome = louvor?.nome ?? '';
  const pre = tokensContent(nome);

  try {
    assert(
      JSON.stringify(pre) === JSON.stringify(tokensContent(nome)),
      'precomputed replay',
      { iter, nome }
    );

    const mFull = louvorNomeMatchesSearch(nome, nome, pre);
    const mFullUndef = louvorNomeMatchesSearch(nome, nome, undefined);
    assert(mFull === true, 'full title must match (with pre)', { iter, nome });
    assert(mFullUndef === true, 'full title must match (no pre)', { iter, nome });
    assert(mFull === mFullUndef, 'pre vs compute divergence on full title', { iter, nome });

    if (pre.length > 0) {
      const joined = pre.join(' ');
      assert(louvorNomeMatchesSearch(nome, joined, pre) === true, 'all content tokens joined', {
        iter,
        nome,
        joined
      });

      const i = randInt(0, pre.length - 1);
      const j = randInt(i, pre.length - 1);
      const sub = pre.slice(i, j + 1);
      const subQ = sub.join(' ');
      assert(louvorNomeMatchesSearch(nome, subQ, pre) === true, 'random content substring order', {
        iter,
        nome,
        subQ
      });

      const dropTail = pre.slice(0, randInt(1, pre.length));
      if (dropTail.length > 0) {
        assert(louvorNomeMatchesSearch(nome, dropTail.join(' '), pre) === true, 'prefix of content tokens', {
          iter,
          nome
        });
      }
    }

    const allNorm = normalizedTokens(normalizeForSearch(nome));
    const nonStopQuery = allNorm.filter((t) => !STOP_WORDS.has(t)).join(' ');
    if (nonStopQuery.length > 0) {
      assert(
        louvorNomeMatchesSearch(nome, nonStopQuery, pre) === true,
        'query with all non-stop tokens from title in order',
        { iter, nome, nonStopQuery }
      );
    }

    for (let f = 0; f < 3; f++) {
      louvorNomeMatchesSearch(nome, randomFuzzString(), pre);
    }
    louvorNomeMatchesSearch(nome, randomStopsOnlyQuery(), pre);

    const probeQ = `probe${iter}`;
    const leg = legacyIncludes(nome, probeQ);
    const neu = louvorNomeMatchesSearch(nome, probeQ, pre);
    if (leg && !neu) legacyTrueNewFalse.push({ nome, probeQ, iter });
    if (leg) legacyStrictCount++;
  } catch (e) {
    if (e.ctx) assertionFails.push({ message: e.message, ...e.ctx });
    else throws.push({ message: e.message, stack: e.stack, iter, nome });
  }
}

console.log(`Manifest: ${manifestPath}`);
console.log(`Entries: ${data.length}`);
console.log(`Simulations: ${N}`);
console.log(`Exceptions (unexpected): ${throws.length}`);
if (throws.length) console.log(throws.slice(0, 5));
console.log(`Assertion failures: ${assertionFails.length}`);
if (assertionFails.length) console.log(assertionFails.slice(0, 10));

console.log(
  `\nLegacy includes === true + novo === false (amostras aleatórias com probeQ aleatório): ${legacyTrueNewFalse.length} (esperado ~0 com probe improvável)`
);
if (legacyTrueNewFalse.length > 0) console.log(legacyTrueNewFalse.slice(0, 5));

const systematicLegacy = [];
for (let i = 0; i < Math.min(data.length, 2000); i++) {
  const nome = data[i]?.nome ?? '';
  const pre = tokensContent(nome);
  const allNorm = normalizedTokens(normalizeForSearch(nome));
  for (let a = 0; a < allNorm.length; a++) {
    for (let b = a; b < Math.min(a + 8, allNorm.length); b++) {
      const frag = allNorm.slice(a, b + 1).join(' ');
      if (!frag.trim()) continue;
      if (legacyIncludes(nome, frag) && !louvorNomeMatchesSearch(nome, frag, pre)) {
        systematicLegacy.push({ nome, frag });
        if (systematicLegacy.length >= 20) break;
      }
    }
    if (systematicLegacy.length >= 20) break;
  }
  if (systematicLegacy.length >= 20) break;
}

console.log(
  `\nChecagem sistemática (até 2000 louvores, fatias de até 9 tokens do título normalizado):`
);
console.log(`Casos legacy includes true e novo false: ${systematicLegacy.length}`);
if (systematicLegacy.length) {
  console.log('Exemplos (comportamento legado vs novo — pode incluir correspondência por prefixo de palavra):');
  console.log(systematicLegacy.slice(0, 15));
}

if (throws.length || assertionFails.length) process.exit(1);
console.log('\nOK — nenhuma exceção nem falha de invariante nas simulações.');
