import { TapStrategy } from './TapStrategy.js';
import { LongPressStrategy } from './LongPressStrategy.js';

/**
 * Detector de gestos usando o padrão Strategy
 * 
 * Valida gestos contra múltiplas estratégias e retorna o tipo de gesto
 * que melhor corresponde aos critérios, ou null se nenhum critério for atendido
 */
export class GestureDetector {
  constructor(options = {}) {
    this.strategies = [
      new LongPressStrategy({
        minDuration: options.longPressDuration || 500,
        maxMovement: options.maxMovement || 10
      }),
      new TapStrategy({
        maxDuration: options.tapMaxDuration || 300,
        maxMovement: options.maxMovement || 10
      })
    ];

    // Ordem de prioridade: long press primeiro, depois tap
    // Isso garante que se ambos os critérios forem atendidos, long press prevalece
    this.strategies.sort((a, b) => {
      if (a.getGestureType() === 'longpress') return -1;
      if (b.getGestureType() === 'longpress') return 1;
      return 0;
    });
  }

  /**
   * Detecta o tipo de gesto baseado nos dados fornecidos
   * @param {Object} gestureData - Dados do gesto
   * @returns {string|null} - Tipo do gesto detectado ou null se nenhum critério for atendido
   */
  detect(gestureData) {
    // Tenta cada estratégia na ordem de prioridade
    for (const strategy of this.strategies) {
      if (strategy.validate(gestureData)) {
        return strategy.getGestureType();
      }
    }

    // Se nenhuma estratégia validou, retorna null
    return null;
  }

  /**
   * Adiciona uma estratégia customizada
   * @param {GestureStrategy} strategy - Estratégia a ser adicionada
   */
  addStrategy(strategy) {
    this.strategies.push(strategy);
  }

  /**
   * Remove uma estratégia pelo tipo
   * @param {string} gestureType - Tipo do gesto a remover
   */
  removeStrategy(gestureType) {
    this.strategies = this.strategies.filter(
      s => s.getGestureType() !== gestureType
    );
  }
}

