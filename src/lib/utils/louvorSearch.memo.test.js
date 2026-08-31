/**
 * Memoização sob demanda dos campos de busca.
 * Run: node --test src/lib/utils/louvorSearch.memo.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prepareSearchQuery, louvorRowMatchesPreparedSearch } from './louvorSearch.js';

describe('memoização dos campos de busca', () => {
  it('encontra o louvor sem campos pré-computados', () => {
    const row = { nome: 'Senhor, minha rocha' };
    assert.equal(louvorRowMatchesPreparedSearch(row, prepareSearchQuery('senhor')), true);
  });

  it('grava o título normalizado na linha, na primeira consulta', () => {
    const row = { nome: 'Bênção Aarônica' };
    assert.equal(row._searchTitleNorm, undefined);
    louvorRowMatchesPreparedSearch(row, prepareSearchQuery('bencao'));
    assert.equal(row._searchTitleNorm, 'bencao aaronica');
  });

  it('grava os tokens de conteúdo quando a busca por substring não casa', () => {
    const row = { nome: 'O Senhor é a minha rocha' };
    // "senhor rocha" não é substring, força o caminho de tokens.
    louvorRowMatchesPreparedSearch(row, prepareSearchQuery('senhor rocha'));
    assert.deepEqual(row._searchContentTokens, ['senhor', 'minha', 'rocha']);
  });

  it('os campos memoizados não vazam para JSON.stringify', () => {
    const row = { nome: 'Obra Santa', pdfId: 'abc' };
    louvorRowMatchesPreparedSearch(row, prepareSearchQuery('obra'));
    assert.equal(JSON.stringify(row), '{"nome":"Obra Santa","pdfId":"abc"}');
  });

  it('respeita campos já pré-computados sem recalcular', () => {
    const row = { nome: 'Qualquer coisa', _searchTitleNorm: 'valor injetado' };
    assert.equal(louvorRowMatchesPreparedSearch(row, prepareSearchQuery('injetado')), true);
  });
});
