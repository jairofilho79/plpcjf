/**
 * Decisão de qual estado a área de resultados deve mostrar.
 *
 * Existe como módulo próprio por um motivo específico: `node --test` não
 * monta componente Svelte, então a única parte desta lógica que dá para
 * cobrir automaticamente é a tabela de decisão. O template consome o
 * resultado e não decide nada por conta própria.
 */

/**
 * @typedef {'carregando' | 'com-resultados' | 'filtros-sem-resultado' | 'catalogo-vazio'} EstadoVazio
 */

/**
 * @param {Object} entrada
 * @param {boolean} entrada.carregado - O catálogo terminou de carregar (com ou sem sucesso)
 * @param {number} entrada.totalCatalogo - Quantos louvores o catálogo tem ao todo
 * @param {number} entrada.totalVisivel - Quantos itens a página atual mostraria
 * @returns {EstadoVazio}
 */
export function estadoVazioBiblioteca({ carregado, totalCatalogo, totalVisivel }) {
  if (!carregado) return 'carregando';
  if (totalVisivel > 0) return 'com-resultados';
  if (totalCatalogo > 0) return 'filtros-sem-resultado';
  return 'catalogo-vazio';
}
