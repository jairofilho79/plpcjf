/**
 * Correspondência de chave no R2. Run: node --test src/lib/server/r2KeyMatch.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeR2Key, findExactKeyMatch } from './r2KeyMatch.js';

describe('normalizeR2Key', () => {
  it('remove acentos, caixa e separadores, preservando a estrutura', () => {
    assert.equal(normalizeR2Key('assets/Coleânea/Cifra nível I.pdf'), 'assets/coleanea/cifranivelipdf');
  });

  it('normaliza barra invertida para barra', () => {
    assert.equal(normalizeR2Key('assets\\Col\\Cifra.pdf'), 'assets/col/cifrapdf');
  });

  it('aceita entrada vazia', () => {
    assert.equal(normalizeR2Key(''), '');
    assert.equal(normalizeR2Key(null), '');
  });
});

describe('findExactKeyMatch', () => {
  const candidates = [
    'assets/05042026/Obra Santa/Coro.pdf',
    'assets/05042026/Obedecer/Coro.pdf',
    'assets/05042026/O Rei Vem!/Coro.pdf'
  ];

  it('acerta a chave equivalente após normalização', () => {
    assert.equal(
      findExactKeyMatch(candidates, 'assets/05042026/Obra Santa/Coro.pdf'),
      'assets/05042026/Obra Santa/Coro.pdf'
    );
  });

  it('acerta quando só o acento difere', () => {
    const comAcento = ['assets/Colêtanea/Cifra.pdf'];
    assert.equal(findExactKeyMatch(comAcento, 'assets/Coletanea/Cifra.pdf'), 'assets/Colêtanea/Cifra.pdf');
  });

  it('NÃO acerta por prefixo — este era o defeito #09', () => {
    // "Obra Santa/Coro.pdf" e "Obedecer/Coro.pdf" compartilham prefixo normalizado
    // longo o bastante para a heurística antiga de 10 caracteres casar errado.
    assert.equal(findExactKeyMatch(candidates, 'assets/05042026/Outro Louvor/Coro.pdf'), null);
  });

  it('devolve null quando não há candidato', () => {
    assert.equal(findExactKeyMatch([], 'assets/x/Coro.pdf'), null);
    assert.equal(findExactKeyMatch(null, 'assets/x/Coro.pdf'), null);
  });

  it('devolve a primeira ocorrência quando há empate exato', () => {
    const dup = ['assets/a/Coro.pdf', 'assets/A/Coro.pdf'];
    assert.equal(findExactKeyMatch(dup, 'assets/a/Coro.pdf'), 'assets/a/Coro.pdf');
  });
});
