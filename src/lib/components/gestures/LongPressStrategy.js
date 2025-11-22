import { GestureStrategy } from './GestureStrategy.js';

/**
 * Estratégia para detecção de long press
 * 
 * Critérios para um long press válido:
 * - Duração mínima: 500ms (padrão) ou configurável
 * - Movimento máximo: 10px (sem arrastar)
 * - Deve ter sido iniciado e mantido
 */
export class LongPressStrategy extends GestureStrategy {
  constructor(options = {}) {
    super();
    this.minDuration = options.minDuration || 500; // ms
    this.maxMovement = options.maxMovement || 10; // pixels
  }

  validate(gestureData) {
    const {
      duration,
      movement,
      hasLongPressStarted,
      wasCancelled
    } = gestureData;

    // Se foi cancelado, não é um long press válido
    if (wasCancelled) {
      return false;
    }

    // Deve ter iniciado o long press
    if (!hasLongPressStarted) {
      return false;
    }

    // Duração deve ser maior ou igual ao mínimo requerido
    if (duration < this.minDuration) {
      return false;
    }

    // Movimento deve ser menor que o máximo permitido
    if (movement > this.maxMovement) {
      return false;
    }

    return true;
  }

  getGestureType() {
    return 'longpress';
  }
}

