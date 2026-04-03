<script>
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { GestureDetector } from './gestures/GestureDetector.js';
  
  export let longPressDuration = 500;
  export let tapMaxDuration = 300;
  export let hapticFeedback = true;
  export let visualFeedback = true;
  export let disabled = false;
  export let preventClickOnLongPress = true;
  export let clickDelay = 0;
  export let preventDefault = true;
  export let maxMovement = 10; // pixels
  /** @type {string | undefined} */
  export let ariaLabel = undefined;

  const dispatch = createEventDispatcher();
  
  // Inicializar detector de gestos com estratégias
  let gestureDetector;
  $: {
    gestureDetector = new GestureDetector({
      longPressDuration,
      tapMaxDuration,
      maxMovement
    });
  }
  
  // Estado do gesto atual
  let longPressTimer = null;
  let isLongPressing = false;
  let touchEventOccurred = false;
  let gestureStartTime = 0;
  let gestureStartPosition = { x: 0, y: 0 };
  let maxMovementDistance = 0;
  let gestureCancelled = false;
  let currentGestureType = null; // 'touch' ou 'mouse'
  
  // Detectar se é dispositivo touch
  let isTouchDevice = false;
  if (typeof window !== 'undefined') {
    isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }
  
  function triggerHapticFeedback() {
    if (hapticFeedback && 'vibrate' in navigator) {
      navigator.vibrate(50);
    }
  }
  
  function cancelLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    if (isLongPressing) {
      isLongPressing = false;
      dispatch('longpressend', {});
    }
  }
  
  function resetGestureState() {
    cancelLongPress();
    gestureStartTime = 0;
    gestureStartPosition = { x: 0, y: 0 };
    maxMovementDistance = 0;
    gestureCancelled = false;
    currentGestureType = null;
  }
  
  function calculateMovement(currentPosition) {
    if (!gestureStartPosition || !currentPosition) return 0;
    const dx = Math.abs(currentPosition.x - gestureStartPosition.x);
    const dy = Math.abs(currentPosition.y - gestureStartPosition.y);
    return Math.max(dx, dy);
  }
  
  function detectAndDispatchGesture(event, endPosition) {
    if (!gestureDetector || gestureStartTime === 0) return;
    
    const duration = Date.now() - gestureStartTime;
    const movement = maxMovementDistance;
    
    // Preparar dados do gesto para validação
    const gestureData = {
      duration,
      movement,
      hasLongPressStarted: isLongPressing,
      wasCancelled: gestureCancelled
    };
    
    // Detectar o tipo de gesto usando as estratégias
    const detectedGesture = gestureDetector.detect(gestureData);
    
    // Só disparar eventos se um gesto válido foi detectado
    if (detectedGesture === 'longpress') {
      // Se o long press não foi iniciado pelo timer (caso raro), iniciar agora
      if (!isLongPressing) {
        isLongPressing = true;
        triggerHapticFeedback();
        dispatch('longpressstart', { originalEvent: event });
      }
      // Disparar evento de long press completo
      dispatch('longpress', {
        originalEvent: event,
        duration
      });
    } else if (detectedGesture === 'tap') {
      // Disparar evento de tap (click) apenas se não estiver em long press
      // ou se preventClickOnLongPress estiver desabilitado
      if (!isLongPressing || !preventClickOnLongPress) {
        if (clickDelay > 0) {
          setTimeout(() => {
            dispatch('click', event);
          }, clickDelay);
        } else {
          dispatch('click', event);
        }
      }
    }
    // Se detectedGesture for null, nenhum evento é disparado
  }
  
  function handleTouchStart(event) {
    if (disabled) return;
    
    if (preventDefault) {
      event.preventDefault();
    }
    
    touchEventOccurred = true;
    isTouchDevice = true;
    
    // Cancelar qualquer long press anterior
    resetGestureState();
    
    // Inicializar novo gesto
    currentGestureType = 'touch';
    const touch = event.touches[0];
    gestureStartTime = Date.now();
    gestureStartPosition = { x: touch.clientX, y: touch.clientY };
    maxMovementDistance = 0;
    gestureCancelled = false;
    
    // Iniciar timer para long press (apenas para feedback visual e haptic)
    // A validação final será feita no touchEnd
    longPressTimer = setTimeout(() => {
      if (!gestureCancelled) {
        isLongPressing = true;
        triggerHapticFeedback();
        dispatch('longpressstart', { originalEvent: event });
      }
      longPressTimer = null;
    }, longPressDuration);
    
    // Resetar flag após delay para permitir mouse events em dispositivos híbridos
    setTimeout(() => {
      touchEventOccurred = false;
    }, 300);
  }
  
  function handleTouchMove(event) {
    if (disabled || !gestureStartPosition) return;
    
    const touch = event.touches[0];
    const currentPosition = { x: touch.clientX, y: touch.clientY };
    const movement = calculateMovement(currentPosition);
    
    // Atualizar movimento máximo
    maxMovementDistance = Math.max(maxMovementDistance, movement);
    
    // Se movimento foi principalmente vertical (scroll), cancelar gesto
    const dx = Math.abs(currentPosition.x - gestureStartPosition.x);
    const dy = Math.abs(currentPosition.y - gestureStartPosition.y);
    const isVerticalScroll = dy > dx * 1.5; // 50% mais vertical que horizontal
    
    // Se moveu muito ou foi scroll vertical, cancelar gesto
    if (isVerticalScroll || movement > maxMovement) {
      gestureCancelled = true;
      cancelLongPress();
    }
  }
  
  function handleTouchEnd(event) {
    if (disabled) return;
    
    const touch = event.changedTouches[0];
    const endPosition = touch ? { x: touch.clientX, y: touch.clientY } : null;
    
    // Atualizar movimento máximo com posição final
    if (endPosition) {
      const finalMovement = calculateMovement(endPosition);
      maxMovementDistance = Math.max(maxMovementDistance, finalMovement);
    }
    
    // Detectar e disparar gesto válido
    detectAndDispatchGesture(event, endPosition);
    
    // Limpar estado
    resetGestureState();
  }
  
  function handleTouchCancel(event) {
    if (disabled) return;
    gestureCancelled = true;
    resetGestureState();
    dispatch('gesturecancel', event);
  }
  
  function handleMouseDown(event) {
    if (disabled) return;
    
    // Ignorar mouse events se touch event ocorreu recentemente
    if (touchEventOccurred && isTouchDevice) {
      event.preventDefault();
      return;
    }
    
    if (preventDefault) {
      event.preventDefault();
    }
    
    // Cancelar qualquer long press anterior
    resetGestureState();
    
    // Inicializar novo gesto
    currentGestureType = 'mouse';
    gestureStartTime = Date.now();
    gestureStartPosition = { x: event.clientX, y: event.clientY };
    maxMovementDistance = 0;
    gestureCancelled = false;
    
    // Iniciar timer para long press (apenas para feedback visual e haptic)
    // A validação final será feita no mouseUp
    longPressTimer = setTimeout(() => {
      if (!gestureCancelled) {
        isLongPressing = true;
        triggerHapticFeedback();
        dispatch('longpressstart', { originalEvent: event });
      }
      longPressTimer = null;
    }, longPressDuration);
  }
  
  function handleMouseMove(event) {
    if (disabled || !gestureStartPosition || currentGestureType !== 'mouse') return;
    
    const currentPosition = { x: event.clientX, y: event.clientY };
    const movement = calculateMovement(currentPosition);
    
    // Atualizar movimento máximo
    maxMovementDistance = Math.max(maxMovementDistance, movement);
    
    // Se moveu muito, cancelar gesto
    if (movement > maxMovement) {
      gestureCancelled = true;
      cancelLongPress();
    }
  }
  
  function handleMouseUp(event) {
    if (disabled) return;
    
    const endPosition = { x: event.clientX, y: event.clientY };
    
    // Atualizar movimento máximo com posição final
    const finalMovement = calculateMovement(endPosition);
    maxMovementDistance = Math.max(maxMovementDistance, finalMovement);
    
    // Detectar e disparar gesto válido
    detectAndDispatchGesture(event, endPosition);
    
    // Limpar estado
    resetGestureState();
  }
  
  function handleMouseLeave(event) {
    if (disabled) return;
    gestureCancelled = true;
    resetGestureState();
  }
  
  function handleClick(event) {
    if (disabled) return;
    
    // Ignorar click se touch event ocorreu recentemente
    if (touchEventOccurred && isTouchDevice) {
      event.preventDefault();
      return;
    }
    
    // Click já foi emitido no touchend/mouseup através do detector de gestos
    // Este handler é principalmente para compatibilidade e deve ser ignorado
    // para evitar duplicação de eventos
    event.preventDefault();
  }
  
  function handleSelectStart(event) {
    if (preventDefault) {
      event.preventDefault();
    }
  }
  
  function handleContextMenu(event) {
    if (preventDefault) {
      event.preventDefault();
    }
  }
  
  onDestroy(() => {
    cancelLongPress();
  });
</script>

<div
  class="gesture-button-wrapper"
  class:long-pressing={isLongPressing && visualFeedback}
  class:disabled={disabled}
  on:touchstart={handleTouchStart}
  on:touchmove={handleTouchMove}
  on:touchend={handleTouchEnd}
  on:touchcancel={handleTouchCancel}
  on:mousedown={handleMouseDown}
  on:mousemove={handleMouseMove}
  on:mouseup={handleMouseUp}
  on:mouseleave={handleMouseLeave}
  on:click={handleClick}
  on:selectstart={handleSelectStart}
  on:contextmenu={handleContextMenu}
  role="button"
  tabindex={disabled ? -1 : 0}
  aria-disabled={disabled}
  aria-label={ariaLabel}
  on:keydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!disabled) {
        handleClick(e);
      }
    }
  }}
>
  <slot />
</div>

<style>
  .gesture-button-wrapper {
    display: inline-block;
    position: relative;
    transition: transform 0.2s ease, opacity 0.2s ease;
  }
  
  .gesture-button-wrapper.long-pressing {
    transform: scale(0.95);
    opacity: 0.85;
  }
  
  .gesture-button-wrapper.disabled {
    opacity: 0.5;
    cursor: not-allowed;
    /* Não usar pointer-events: none para evitar bloquear toda a página */
    /* Os handlers já verificam se disabled antes de processar */
  }
  
  /* Feedback visual adicional durante long press */
  .gesture-button-wrapper.long-pressing::before {
    content: '';
    position: absolute;
    inset: -4px;
    border: 2px solid var(--gold-color, #d4af37);
    border-radius: inherit;
    animation: pulse 0.5s ease-in-out infinite;
    pointer-events: none;
  }
  
  @keyframes pulse {
    0%, 100% {
      opacity: 0.5;
      transform: scale(1);
    }
    50% {
      opacity: 1;
      transform: scale(1.05);
    }
  }
</style>
