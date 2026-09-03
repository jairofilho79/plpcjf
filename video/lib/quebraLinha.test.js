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

  test('devolve no maximo tres linhas, para nao tapar a tela', () => {
    assert.ok(quebrar('palavra '.repeat(60), 38).length <= 3);
  });

  test('quando corta, a ultima linha acaba em reticencias', () => {
    assert.ok(quebrar('palavra '.repeat(60), 38).at(-1).endsWith('…'));
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
