import { test, describe } from 'node:test';
import assert from 'node:assert';
import { divergencia } from './divergencia.mjs';

describe('divergencia', () => {
  test('texto idêntico não diverge', () => {
    assert.equal(divergencia('Toque em Filtros.', 'Toque em Filtros.'), 0);
  });

  test('ignora caixa, acento e pontuação — o TTS transcreve à sua maneira', () => {
    assert.equal(divergencia('Toque em Filtros.', 'toque em filtros'), 0);
    assert.equal(divergencia('número', 'numero'), 0);
  });

  test('uma palavra trocada numa fala de tamanho real diverge pouco', () => {
    const pedido = 'Toque no botão de mais para adicionar o louvor à sua playlist.';
    const dito = 'Toque no botao de mais pra adicionar o louvor à sua playlist.';
    assert.ok(divergencia(pedido, dito) < 0.2);
  });

  test('numa fala curta, uma palavra trocada já pesa muito — por isso a política tolera um mínimo absoluto', () => {
    // 1 troca em 4 palavras é 0,25 redondos. O limiar em razão pura reprovaria
    // uma fala boa só por ser curta; quem decide (vozes.mjs) usa
    // `max(2 palavras, 35%)`, e este teste existe para fixar o porquê.
    assert.equal(divergencia('abra o leitor agora', 'abra o leitor depois'), 0.25);
  });

  test('o modelo a improvisar em cima do tutorial diverge muito', () => {
    const pedido = 'Toque em Filtros para escolher o material.';
    const dito = 'Claro! Aqui está: Toque em Filtros para escolher o material. Espero ter ajudado!';
    assert.ok(divergencia(pedido, dito) > 0.25);
  });

  test('transcrição vazia é divergência total, não zero', () => {
    assert.equal(divergencia('qualquer coisa', ''), 1);
  });

  test('pedido vazio não rebenta', () => {
    assert.equal(divergencia('', ''), 0);
  });
});
