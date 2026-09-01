/**
 * A chave exata cobre o que as estratégias difusas cobriam (#22.4).
 * Run: node --test src/lib/utils/correspondenciaExata.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import PdfPathManager from '../offline/utils/PdfPathManager.js';
import { encodeUrlComponentUtf8 } from './urlEncoding.js';
import { buildPdfCacheIndex } from './pdfCacheIndex.js';

const ORIGEM = 'https://plpcg.com';

/** Caminhos reais do acervo, escolhidos por exercitarem escape de URL. */
const REAIS = [
  'assets/ColCIAs/001.pdf',
  'assets/04112025/Conheçamos e prossigamos/Gestos CIAs.pdf',
  'assets/30102025/Sobe aqui [26-07-2025] - Coro.pdf',
  'assets/Louvores Coletânea de Partituras/255 - Meu Coração Engrandece ao Senhor - Cântico de Vitória/Cifra I.pdf'
];

/** A chave que os quatro escritores do cache gravam. */
const chave = (/** @type {string} */ p) => PdfPathManager.createRequestUrl(p, ORIGEM);

describe('F4 — o fallback do CacheStorageAdapter era duplicata e armadilha', () => {
  it('o primeiro fallback é byte a byte a chave canônica', () => {
    for (const p of REAIS) {
      const normalizado = PdfPathManager.normalizeForStorage(p);
      assert.equal(PdfPathManager.createRequestUrl(normalizado, ORIGEM), chave(p));
    }
  });

  it('o segundo fallback também: normalizeForStorage desfaz o encodeURIComponent', () => {
    for (const p of REAIS) {
      const normalizado = PdfPathManager.normalizeForStorage(p);
      const agressivo = encodeUrlComponentUtf8(normalizado);
      assert.equal(PdfPathManager.createRequestUrl(agressivo, ORIGEM), chave(p));
    }
  });

  it('o terceiro fallback, o basename nu, nunca resolve para /assets/', () => {
    // `new Request('Cifra I.pdf')` resolve contra o diretório da página. Se um dia
    // acertasse, seria em outro PDF: 1036 arquivos do acervo se chamam assim.
    for (const pagina of ['https://plpcg.com/', 'https://plpcg.com/biblioteca', 'https://plpcg.com/leitor']) {
      for (const p of REAIS) {
        const basename = PdfPathManager.normalizeForStorage(p).split('/').pop() || '';
        const resolvida = new URL(basename, pagina).href;
        assert.ok(!resolvida.includes('/assets/'), `resolveu para dentro de assets: ${resolvida}`);
        assert.notEqual(resolvida, chave(p));
      }
    }
  });

  it('sobre os 4629 caminhos reais, os dois primeiros fallbacks são a chave canônica', () => {
    const manifesto = 'louvores-manifest.json';
    if (!fs.existsSync(manifesto)) return; // fixture opcional: não versionado
    let divergentes = 0;
    for (const p of caminhosDoManifesto(manifesto)) {
      const normalizado = PdfPathManager.normalizeForStorage(p);
      if (PdfPathManager.createRequestUrl(normalizado, ORIGEM) !== chave(p)) divergentes++;
      if (PdfPathManager.createRequestUrl(encodeUrlComponentUtf8(normalizado), ORIGEM) !== chave(p)) divergentes++;
    }
    assert.equal(divergentes, 0);
  });
});

/** A regra de F9, copiada verbatim de src/lib/stores/offline.js:1335-1353. */
function predicadoF9(/** @type {string[]} */ cache, /** @type {string} */ pdfPath) {
  return cache.some((cached) => {
    if (cached === pdfPath) return true;
    if (cached.endsWith(pdfPath)) return true;
    const cachedFilename = cached.split('/').pop();
    const expectedFilename = pdfPath.split('/').pop();
    if (cachedFilename && expectedFilename && cachedFilename === expectedFilename) {
      const cachedDir = cached.replace(cachedFilename, '');
      const expectedDir = pdfPath.replace(expectedFilename, '');
      if (cachedDir && expectedDir && cachedDir.includes(expectedDir)) return true;
    }
    return false;
  });
}

/** A regra de F10, copiada verbatim de src/lib/stores/offline.js:1495. */
function predicadoF10(/** @type {string[]} */ cache, /** @type {string} */ pdfUrl) {
  return cache.some((cached) => cached.includes(pdfUrl));
}

/** O substituto: índice exato com a régua canônica nos dois lados. */
function indiceExato(/** @type {string[]} */ cache) {
  return buildPdfCacheIndex(cache, {
    normalize: (/** @type {string} */ p) => PdfPathManager.normalizeForStorage(p)
  });
}

describe('F9 e F10 — dominadas pela chave exata', () => {
  const emCache = REAIS.map(chave);

  it('F9 não acha 3 dos 4 PDFs que estão de fato em cache', () => {
    // Só o caminho sem espaço nem acento sobrevive: a chave gravada é
    // percent-encoded e `pdfPath` não é, então endsWith falha nos outros três.
    const achados = REAIS.filter((p) => predicadoF9(emCache, p));
    assert.deepEqual(achados, ['assets/ColCIAs/001.pdf']);
  });

  it('F10 falha exatamente nos mesmos três', () => {
    const achados = REAIS.filter((p) => predicadoF10(emCache, `/${p}`));
    assert.deepEqual(achados, ['assets/ColCIAs/001.pdf']);
  });

  it('o índice exato acha os quatro', () => {
    const indice = indiceExato(emCache);
    for (const p of REAIS) {
      assert.equal(indice.has(p), true, `não achou: ${p}`);
    }
  });

  it('F9 arma um falso positivo assim que o acervo ganhar uma subpasta', () => {
    // Hoje o acervo não tem esse par (medido: 0 falsos positivos em 4629).
    // Mas a regra `cachedDir.includes(expectedDir)` já está pronta para ele.
    const cacheComSubpasta = [chave('assets/ColCIAs/2026/001.pdf')];
    assert.equal(predicadoF9(cacheComSubpasta, 'assets/ColCIAs/001.pdf'), true);
    // O índice exato responde a verdade: são dois PDFs diferentes.
    assert.equal(indiceExato(cacheComSubpasta).has('assets/ColCIAs/001.pdf'), false);
  });

  it('o caso Gestos em Gravura: 254 arquivos com o mesmo nome', () => {
    // Era a categoria para a qual offline.js forçava um modo estrito à parte
    // (a exceção saiu com #22.4). Com a chave exata, cada um dos 254 é ele
    // mesmo — sem precisar de exceção nenhuma.
    const a = 'assets/04112025/Conheçamos e prossigamos/Gestos CIAs.pdf';
    const b = 'assets/04112025/A luz que brilha mais que o sol/Gestos CIAs.pdf';
    const indice = indiceExato([chave(a)]);
    assert.equal(indice.has(a), true);
    assert.equal(indice.has(b), false);
  });
});

/** @param {string} arquivo */
function caminhosDoManifesto(arquivo) {
  const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  return dados.map((/** @type {{pdfId: string}} */ l) => {
    let p = Buffer.from(l.pdfId, 'base64').toString('utf8').replace(/^\/+/, '').trim();
    if (!p.toLowerCase().startsWith('assets/')) p = `assets/${p}`;
    return p;
  });
}
