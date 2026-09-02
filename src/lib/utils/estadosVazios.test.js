/**
 * Tabela de decisão dos estados vazios. Run:
 * node --test src/lib/utils/estadosVazios.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estadoVazioBiblioteca } from './estadosVazios.js';

describe('estadoVazioBiblioteca', () => {
  it('mostra o esqueleto enquanto o catálogo não carregou', () => {
    assert.equal(
      estadoVazioBiblioteca({ carregado: false, totalCatalogo: 0, totalVisivel: 0 }),
      'carregando'
    );
  });

  it('mostra a lista quando há resultados na página', () => {
    assert.equal(
      estadoVazioBiblioteca({ carregado: true, totalCatalogo: 4630, totalVisivel: 50 }),
      'com-resultados'
    );
  });

  it('atribui a página vazia aos filtros quando o catálogo tem conteúdo', () => {
    assert.equal(
      estadoVazioBiblioteca({ carregado: true, totalCatalogo: 4630, totalVisivel: 0 }),
      'filtros-sem-resultado'
    );
  });

  it('distingue catálogo vazio de filtro sem resultado — o caso que renderizava nada', () => {
    assert.equal(
      estadoVazioBiblioteca({ carregado: true, totalCatalogo: 0, totalVisivel: 0 }),
      'catalogo-vazio'
    );
  });

  it('não confunde catálogo vazio com carregamento em curso', () => {
    // Antes de 2026-09-01 estes dois casos caíam no mesmo buraco do template:
    // o esqueleto sumia e nada tomava o lugar.
    assert.notEqual(
      estadoVazioBiblioteca({ carregado: false, totalCatalogo: 0, totalVisivel: 0 }),
      estadoVazioBiblioteca({ carregado: true, totalCatalogo: 0, totalVisivel: 0 })
    );
  });
});
