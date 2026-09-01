/**
 * Verificação de "parte já baixada" contra o cache real.
 * Run: node --test src/lib/offline/download/partVerification.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPartPdfPaths, verifyCompletedPart } from './partVerification.js';

/**
 * Resolvedor de teste: só resolve o que está no mapa.
 * @param {Record<string, string>} map
 * @returns {(louvor: { pdfId: string }) => string | null}
 */
function makeResolver(map) {
  return ({ pdfId }) => map[pdfId] ?? null;
}

describe('getPartPdfPaths', () => {
  it('resolve todos os ids válidos', () => {
    const resolver = makeResolver({ a: 'assets/a.pdf', b: 'assets/b.pdf' });
    const part = { pdfs: ['a', 'b'] };
    assert.deepEqual(getPartPdfPaths(part, resolver), {
      paths: ['assets/a.pdf', 'assets/b.pdf'],
      unresolved: 0
    });
  });

  it('conta em unresolved, não descarta em silêncio', () => {
    const resolver = makeResolver({ a: 'assets/a.pdf' });
    const part = { pdfs: ['a', 123, 'b-sem-mapa'] };
    const { paths, unresolved } = getPartPdfPaths(part, resolver);
    assert.deepEqual(paths, ['assets/a.pdf']);
    assert.equal(unresolved, 2);
  });

  it('parte sem pdfs devolve vazio', () => {
    assert.deepEqual(getPartPdfPaths({}, makeResolver({})), { paths: [], unresolved: 0 });
  });
});

describe('verifyCompletedPart', () => {
  it('pula quando todos os caminhos resolvidos estão no cache', () => {
    const resolver = makeResolver({ a: 'assets/a.pdf', b: 'assets/b.pdf' });
    const part = { pdfs: ['a', 'b'] };
    const cached = new Set(['assets/a.pdf', 'assets/b.pdf']);
    assert.equal(verifyCompletedPart(part, cached, resolver).skippable, true);
  });

  it('não pula se falta algum caminho no cache', () => {
    const resolver = makeResolver({ a: 'assets/a.pdf', b: 'assets/b.pdf' });
    const part = { pdfs: ['a', 'b'] };
    const cached = new Set(['assets/a.pdf']);
    assert.equal(verifyCompletedPart(part, cached, resolver).skippable, false);
  });

  it('não pula se algum id não resolveu — é o bug que este teste fecha', () => {
    const resolver = makeResolver({ a: 'assets/a.pdf' });
    const part = { pdfs: ['a', 'id-sem-mapa'] };
    // O único caminho resolvido está no cache — mas o outro id nunca foi checado.
    const cached = new Set(['assets/a.pdf']);
    assert.equal(verifyCompletedPart(part, cached, resolver).skippable, false);
  });

  it('sem cachedPaths, nunca pula', () => {
    const resolver = makeResolver({ a: 'assets/a.pdf' });
    assert.equal(verifyCompletedPart({ pdfs: ['a'] }, null, resolver).skippable, false);
  });
});
