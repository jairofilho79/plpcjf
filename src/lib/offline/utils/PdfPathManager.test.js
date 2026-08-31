/**
 * Normalização de caminho que preserva caixa e acentos.
 * Run: node --test src/lib/offline/utils/PdfPathManager.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import PdfPathManager from './PdfPathManager.js';

describe('PdfPathManager.normalizeForStorage', () => {
  it('preserva caixa e acentos', () => {
    assert.equal(
      PdfPathManager.normalizeForStorage('assets/Cifra nível I/arquivo.pdf'),
      'assets/Cifra nível I/arquivo.pdf'
    );
  });

  it('preserva maiúsculas em nome de categoria', () => {
    assert.equal(
      PdfPathManager.normalizeForStorage('assets/ColAdultos/001.pdf'),
      'assets/ColAdultos/001.pdf'
    );
  });

  it('acrescenta o prefixo assets/ quando falta', () => {
    assert.equal(
      PdfPathManager.normalizeForStorage('Categoria/arquivo.pdf'),
      'assets/Categoria/arquivo.pdf'
    );
  });

  it('não duplica o prefixo assets/ quando já existe', () => {
    assert.equal(
      PdfPathManager.normalizeForStorage('assets/Categoria/arquivo.pdf'),
      'assets/Categoria/arquivo.pdf'
    );
  });

  it('remove barras iniciais', () => {
    assert.equal(
      PdfPathManager.normalizeForStorage('/assets/Categoria/arquivo.pdf'),
      'assets/Categoria/arquivo.pdf'
    );
  });

  it('remove protocolo e domínio', () => {
    assert.equal(
      PdfPathManager.normalizeForStorage('https://example.com/assets/Categoria/arquivo.pdf'),
      'assets/Categoria/arquivo.pdf'
    );
  });

  it('converte separador do Windows para barra', () => {
    assert.equal(
      PdfPathManager.normalizeForStorage('assets\\Categoria\\arquivo.pdf'),
      'assets/Categoria/arquivo.pdf'
    );
  });

  it('devolve string vazia para string vazia', () => {
    assert.equal(PdfPathManager.normalizeForStorage(''), '');
  });

  it('devolve string vazia para null e undefined', () => {
    assert.equal(PdfPathManager.normalizeForStorage(null), '');
    assert.equal(PdfPathManager.normalizeForStorage(undefined), '');
  });
});

describe('PdfPathManager.createRequestUrl', () => {
  it('monta a URL completa a partir da origem', () => {
    const url = PdfPathManager.createRequestUrl('assets/Categoria/arquivo.pdf', 'https://example.com');
    assert.equal(url, 'https://example.com/assets/Categoria/arquivo.pdf');
  });

  it('normaliza o caminho antes de montar a URL', () => {
    const url = PdfPathManager.createRequestUrl('Categoria/arquivo.pdf', 'https://example.com');
    assert.equal(url, 'https://example.com/assets/Categoria/arquivo.pdf');
  });

  it('devolve string vazia para caminho vazio', () => {
    assert.equal(PdfPathManager.createRequestUrl(''), '');
  });
});

describe('PdfPathManager.createSearchVariations', () => {
  it('gera pelo menos uma variação, todas string', () => {
    const variacoes = PdfPathManager.createSearchVariations(
      'assets/Categoria/arquivo.pdf',
      'https://example.com'
    );
    assert.ok(variacoes.length > 0);
    assert.ok(variacoes.every((v) => typeof v === 'string'));
  });

  it('as variações incluem o caminho normalizado', () => {
    const variacoes = PdfPathManager.createSearchVariations(
      'Categoria/arquivo.pdf',
      'https://example.com'
    );
    assert.ok(variacoes.some((v) => v.includes('assets/Categoria/arquivo.pdf')));
  });

  it('não repete variações', () => {
    const variacoes = PdfPathManager.createSearchVariations(
      'assets/Categoria/arquivo.pdf',
      'https://example.com'
    );
    assert.equal(variacoes.length, new Set(variacoes).size);
  });

  it('devolve lista vazia para caminho vazio', () => {
    assert.deepEqual(PdfPathManager.createSearchVariations(''), []);
  });
});
