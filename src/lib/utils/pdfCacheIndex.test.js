/**
 * Índice de PDFs em cache. Run: node --test src/lib/utils/pdfCacheIndex.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toComparablePath, basenameOf, buildPdfCacheIndex } from './pdfCacheIndex.js';

describe('toComparablePath', () => {
  it('extrai o pathname de uma URL completa e remove a barra inicial', () => {
    assert.equal(
      toComparablePath('https://plpcg.com/assets/ColAdultos/001.pdf'),
      'assets/ColAdultos/001.pdf'
    );
  });

  it('aceita caminho relativo direto', () => {
    assert.equal(toComparablePath('assets/ColAdultos/001.pdf'), 'assets/ColAdultos/001.pdf');
    assert.equal(toComparablePath('/assets/ColAdultos/001.pdf'), 'assets/ColAdultos/001.pdf');
  });

  it('decodifica acentos, inclusive em dupla codificação', () => {
    assert.equal(
      toComparablePath('https://plpcg.com/assets/Cole%C3%A2nea/Cifra.pdf'),
      'assets/Coleânea/Cifra.pdf'
    );
    assert.equal(
      toComparablePath('/assets/Cole%25C3%25A2nea/Cifra.pdf'),
      'assets/Coleânea/Cifra.pdf'
    );
  });

  it('devolve string vazia para entrada inútil', () => {
    assert.equal(toComparablePath(''), '');
    assert.equal(toComparablePath(null), '');
    assert.equal(toComparablePath('/'), '');
  });
});

describe('basenameOf', () => {
  it('devolve o último segmento', () => {
    assert.equal(basenameOf('assets/ColAdultos/001.pdf'), '001.pdf');
    assert.equal(basenameOf('001.pdf'), '001.pdf');
  });
});

describe('buildPdfCacheIndex', () => {
  const cached = [
    'https://plpcg.com/assets/ColAdultos/001.pdf',
    'https://plpcg.com/assets/PES%20CIAs/Conhe%C3%A7amos/Cifra.pdf'
  ];

  it('acerta por caminho exato', () => {
    const index = buildPdfCacheIndex(cached);
    assert.equal(index.has('assets/ColAdultos/001.pdf'), true);
    assert.equal(index.has('/assets/ColAdultos/001.pdf'), true);
  });

  it('acerta por nome de arquivo quando o diretório difere', () => {
    const index = buildPdfCacheIndex(cached);
    assert.equal(index.has('assets/OutraPasta/001.pdf'), true);
  });

  it('acerta com acento após decodificação', () => {
    const index = buildPdfCacheIndex(cached);
    assert.equal(index.has('assets/PES CIAs/Conheçamos/Cifra.pdf'), true);
  });

  it('erra o que não está em cache', () => {
    const index = buildPdfCacheIndex(cached);
    assert.equal(index.has('assets/ColAdultos/999.pdf'), false);
    assert.equal(index.has(''), false);
  });

  it('aceita lista vazia ou inválida sem lançar', () => {
    assert.equal(buildPdfCacheIndex([]).has('assets/x.pdf'), false);
    assert.equal(buildPdfCacheIndex(null).size, 0);
  });

  it('aplica a normalização opcional na indexação e na consulta', () => {
    const lower = (p) => p.toLowerCase();
    const index = buildPdfCacheIndex(['/assets/ColAdultos/001.pdf'], { normalize: lower });
    assert.equal(index.has('assets/coladultos/001.pdf'), true);
  });

  it('substitui a antiga Estratégia 3: sufixo com mesmo nome de arquivo', () => {
    // cached tem prefixo extra; a comparação por basename cobre o caso.
    const index = buildPdfCacheIndex(['/prefixo/extra/assets/ColAdultos/001.pdf']);
    assert.equal(index.has('assets/ColAdultos/001.pdf'), true);
  });
});
