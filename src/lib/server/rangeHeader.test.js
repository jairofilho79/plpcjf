import { test, describe } from 'node:test';
import assert from 'node:assert';
import { analisarRange } from './rangeHeader.js';

describe('analisarRange', () => {
  test('sem cabeçalho não há pedido de intervalo', () => {
    assert.equal(analisarRange(null), null);
    assert.equal(analisarRange(undefined), null);
    assert.equal(analisarRange(''), null);
  });

  test('intervalo fechado vira deslocamento mais comprimento', () => {
    // `bytes=0-99` são 100 bytes, não 99: as duas pontas são inclusivas.
    assert.deepEqual(analisarRange('bytes=0-99'), { offset: 0, length: 100 });
    assert.deepEqual(analisarRange('bytes=1000-2000'), { offset: 1000, length: 1001 });
  });

  test('intervalo aberto pede daí até ao fim', () => {
    assert.deepEqual(analisarRange('bytes=1000-'), { offset: 1000 });
  });

  test('sufixo pede os últimos N bytes', () => {
    // É assim que o navegador vai buscar o índice `moov` de um mp4 quando ele
    // está no fim do ficheiro.
    assert.deepEqual(analisarRange('bytes=-500'), { suffix: 500 });
  });

  test('espaços em volta não atrapalham', () => {
    assert.deepEqual(analisarRange('  bytes=0-10  '), { offset: 0, length: 11 });
  });

  test('unidade diferente de bytes é recusada', () => {
    assert.equal(analisarRange('items=0-10'), null);
  });

  test('intervalos múltiplos caem para o ficheiro inteiro', () => {
    // Servir o ficheiro todo é resposta válida, e nenhum navegador pede
    // intervalos múltiplos para vídeo.
    assert.equal(analisarRange('bytes=0-99,200-299'), null);
  });

  test('intervalo invertido é pedido inválido, não zero bytes', () => {
    assert.equal(analisarRange('bytes=500-100'), null);
  });

  test('bytes=- sem números nenhuns é recusado', () => {
    assert.equal(analisarRange('bytes=-'), null);
  });

  test('sufixo zero é recusado em vez de pedir nada', () => {
    assert.equal(analisarRange('bytes=-0'), null);
  });

  test('lixo não rebenta', () => {
    assert.equal(analisarRange('bytes=abc-def'), null);
    assert.equal(analisarRange('bytes'), null);
  });
});
