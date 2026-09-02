/**
 * O predicado que destranca a correção de `?pagina=`. Run:
 * node --test src/lib/utils/resultadosProntos.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { houveFiltragemReal } from './resultadosProntos.js';

describe('houveFiltragemReal', () => {
  it('é falso enquanto o catálogo não carregou', () => {
    assert.equal(
      houveFiltragemReal({ carregado: false, totalCatalogo: 0, totalArranjos: 0 }),
      false
    );
  });

  it('é falso quando o catálogo carregou vazio', () => {
    assert.equal(
      houveFiltragemReal({ carregado: true, totalCatalogo: 0, totalArranjos: 5 }),
      false
    );
  });

  it('é falso na janela em que o catálogo já chegou mas o padrão de Arranjos ainda não foi aplicado', () => {
    // Esta é a corrida D-3: corrigir a URL aqui apagaria o `?pagina=3` do link.
    assert.equal(
      houveFiltragemReal({ carregado: true, totalCatalogo: 4630, totalArranjos: 0 }),
      false
    );
  });

  it('é verdadeiro com catálogo carregado e ao menos um Arranjo selecionado', () => {
    assert.equal(
      houveFiltragemReal({ carregado: true, totalCatalogo: 4630, totalArranjos: 1 }),
      true
    );
  });

  it('devolve booleano, nunca o valor cru recebido', () => {
    // As páginas passam `$louvoresLoaded`, que pode chegar como qualquer
    // valor verdadeiro/falso; o resultado alimenta um `if`, então precisa ser
    // previsível.
    const resultado = houveFiltragemReal({
      carregado: /** @type {any} */ (undefined),
      totalCatalogo: 4630,
      totalArranjos: 5
    });
    assert.equal(resultado, false);
    assert.equal(typeof resultado, 'boolean');
  });

  it('desmarcar todos os Arranjos volta a ser falso — é por isso que a página precisa de trava, e não desta condição direto', () => {
    const carregado = true;
    const totalCatalogo = 4630;
    assert.equal(houveFiltragemReal({ carregado, totalCatalogo, totalArranjos: 5 }), true);
    assert.equal(houveFiltragemReal({ carregado, totalCatalogo, totalArranjos: 0 }), false);
  });
});
