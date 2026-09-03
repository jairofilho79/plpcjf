import { test, describe } from 'node:test';
import assert from 'node:assert';
import { quebrar } from './quebraLinha.mjs';

describe('quebrar', () => {
  test('nao parte palavras ao meio', () => {
    const linhas = quebrar('Disponibilizar offline baixa o acervo inteiro', 20);
    for (const l of linhas) {
      assert.ok(l.length <= 20 || !l.includes(' '), `linha longa demais: "${l}"`);
    }
    assert.equal(linhas.join(' '), 'Disponibilizar offline baixa o acervo inteiro');
  });

  test('uma palavra maior que a largura fica sozinha, sem ser partida', () => {
    assert.deepEqual(quebrar('Pesquisador supercalifragilisticexpialidoce fim', 12), [
      'Pesquisador',
      'supercalifragilisticexpialidoce',
      'fim'
    ]);
  });

  test('devolve no maximo quatro linhas, para nao tapar a tela', () => {
    assert.ok(quebrar('palavra '.repeat(60), 40).length <= 4);
  });

  test('uma fala longa de verdade cabe sem ser cortada', () => {
    // Esta fala saia com reticencias em 38 caracteres e 3 linhas, e a legenda
    // dizia menos do que a voz.
    const fala = 'Em Como abrir você decide o que acontece ao tocar num louvor: abrir no leitor, abrir em outra aba, compartilhar ou baixar.';
    const linhas = quebrar(fala, 40);
    assert.ok(!linhas.at(-1).endsWith('…'), linhas.join(' | '));
    assert.equal(linhas.join(' '), fala);
  });

  test('quando corta, a ultima linha acaba em reticencias', () => {
    assert.ok(quebrar('palavra '.repeat(60), 40).at(-1).endsWith('…'));
  });

  test('texto vazio devolve lista vazia, nao uma linha em branco', () => {
    assert.deepEqual(quebrar('   ', 38), []);
  });

  test('uma fala de tamanho tipico cabe em duas linhas', () => {
    const linhas = quebrar('Toque no botao de mais para adicionar o louvor a sua playlist.', 38);
    assert.equal(linhas.length, 2);
  });

  test('espacos repetidos nao viram linhas vazias', () => {
    assert.deepEqual(quebrar('um    dois', 38), ['um dois']);
  });
});
