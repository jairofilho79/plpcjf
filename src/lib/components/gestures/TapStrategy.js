import { GestureStrategy } from './GestureStrategy.js';

/**
 * Estratégia para detecção de toque simples (tap)
 * 
 * Critérios para um tap válido:
 * - Duração máxima: 300ms (toque rápido)
 * - Movimento máximo: 10px (sem arrastar)
 * - Não deve ter iniciado long press
 */
export class TapStrategy extends GestureStrategy {
  constructor(options = {}) {
    super();
    this.maxDuration = options.maxDuration || 300; // ms
    this.maxMovement = options.maxMovement || 10; // pixels
  }

  validate(gestureData) {
    const {
      duration,
      movement,
      hasLongPressStarted,
      wasCancelled
    } = gestureData;

    // Se foi cancelado, não é um tap válido
    if (wasCancelled) {
      return false;
    }

    // Se iniciou long press, não é um tap
    if (hasLongPressStarted) {
      return false;
    }

    // Duração deve ser menor que o máximo permitido
    if (duration > this.maxDuration) {
      return false;
    }

    // Movimento deve ser menor que o máximo permitido
    if (movement > this.maxMovement) {
      return false;
    }

    return true;
  }

  getGestureType() {
    return 'tap';
  }
}

