/**
 * Índice de PDFs em cache. Run: node --test src/lib/utils/pdfCacheIndex.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toComparablePath, buildPdfCacheIndex } from './pdfCacheIndex.js';
import PdfPathManager from '../offline/utils/PdfPathManager.js';

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

  it('NÃO acerta por nome de arquivo quando o diretório difere (#22.3)', () => {
    // Era o fallback F6. Com 3311 dos 4629 caminhos do acervo partilhando
    // basename, ele fazia o índice mentir para milhares de louvores.
    const index = buildPdfCacheIndex(cached);
    assert.equal(index.has('assets/OutraPasta/001.pdf'), false);
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

  it('a antiga Estratégia 3 (sufixo) também sai: só caminho exato conta', () => {
    const index = buildPdfCacheIndex(['/prefixo/extra/assets/ColAdultos/001.pdf']);
    assert.equal(index.has('assets/ColAdultos/001.pdf'), false);
  });

  it('o caso real: 1036 louvores se chamam Cifra I.pdf e não são o mesmo PDF', () => {
    const emCache = ['https://plpcg.com/assets/Coletanea/001 - Louvor A/Cifra I.pdf'];
    const index = buildPdfCacheIndex(emCache);
    assert.equal(index.has('assets/Coletanea/001 - Louvor A/Cifra I.pdf'), true);
    assert.equal(index.has('assets/Coletanea/002 - Louvor B/Cifra I.pdf'), false);
    assert.equal(index.has('assets/PES/Cifra I.pdf'), false);
  });

  it('com normalizeForStorage nos dois lados, NFD e NFC casam', () => {
    // É esta a régua que os quatro consumidores passam a usar. Sem ela, os 8
    // caminhos NFD do acervo (Tarefa 6, Step 1) deixariam de casar assim que o
    // fallback por basename saísse.
    const normalize = (/** @type {string} */ p) => PdfPathManager.normalizeForStorage(p);
    const nfd = 'assets/PES/Alto preço - CIFRA.pdf'.normalize('NFD');
    const nfc = 'assets/PES/Alto preço - CIFRA.pdf'.normalize('NFC');
    const index = buildPdfCacheIndex([`https://plpcg.com/${nfd}`], { normalize });
    assert.equal(index.has(nfc), true);
  });
});
