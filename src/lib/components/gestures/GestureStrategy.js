/**
 * Interface base para estratégias de detecção de gestos
 * Implementa o padrão Strategy para permitir diferentes critérios de validação
 */
export class GestureStrategy {
  /**
   * Valida se o gesto atende aos critérios desta estratégia
   * @param {Object} gestureData - Dados do gesto (duração, movimento, etc)
   * @returns {boolean} - true se o gesto atende aos critérios
   */
  validate(gestureData) {
    throw new Error('validate() must be implemented by subclass');
  }

  /**
   * Retorna o nome do tipo de gesto
   * @returns {string}
   */
  getGestureType() {
    throw new Error('getGestureType() must be implemented by subclass');
  }
}

