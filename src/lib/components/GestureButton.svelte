<script>
  import { createEventDispatcher, onDestroy } from 'svelte';
  
  export let longPressDuration = 500;
  export let hapticFeedback = true;
  export let visualFeedback = true;
  export let disabled = false;
  export let preventClickOnLongPress = true;
  export let clickDelay = 0;
  export let preventDefault = true;
  
  const dispatch = createEventDispatcher();
  
  let longPressTimer = null;
  let isLongPressing = false;
  let touchEventOccurred = false;
  let touchStartTime = 0;
  let touchStartPosition = { x: 0, y: 0 };
  const TOUCH_MOVE_THRESHOLD = 10; // pixels
  
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
  
  function handleTouchStart(event) {
    if (disabled) return;
    
    if (preventDefault) {
      event.preventDefault();
    }
    
    touchEventOccurred = true;
    isTouchDevice = true;
    
    const touch = event.touches[0];
    touchStartTime = Date.now();
    touchStartPosition = { x: touch.clientX, y: touch.clientY };
    
    // Cancelar qualquer long press anterior
    cancelLongPress();
    
    // Iniciar timer para long press
    longPressTimer = setTimeout(() => {
      isLongPressing = true;
      longPressTimer = null;
      
      triggerHapticFeedback();
      dispatch('longpressstart', { originalEvent: event });
      dispatch('longpress', { 
        originalEvent: event, 
        duration: Date.now() - touchStartTime 
      });
    }, longPressDuration);
    
    // Resetar flag após delay para permitir mouse events em dispositivos híbridos
    setTimeout(() => {
      touchEventOccurred = false;
    }, 300);
  }
  
  function handleTouchMove(event) {
    if (disabled || !touchStartPosition) return;
    
    const touch = event.touches[0];
    const dx = Math.abs(touch.clientX - touchStartPosition.x);
    const dy = Math.abs(touch.clientY - touchStartPosition.y);
    
    // Se moveu muito, cancelar long press
    if (dx > TOUCH_MOVE_THRESHOLD || dy > TOUCH_MOVE_THRESHOLD) {
      cancelLongPress();
      touchStartPosition = null;
    }
  }
  
  function handleTouchEnd(event) {
    if (disabled) return;
    
    const wasLongPressing = isLongPressing;
    cancelLongPress();
    touchStartPosition = null;
    
    // Se estava em long press, não emitir click (a menos que configurado)
    if (wasLongPressing && preventClickOnLongPress) {
      event.preventDefault();
      return;
    }
    
    // Emitir click após delay se configurado
    if (clickDelay > 0) {
      setTimeout(() => {
        dispatch('click', event);
      }, clickDelay);
    } else {
      dispatch('click', event);
    }
  }
  
  function handleTouchCancel(event) {
    if (disabled) return;
    cancelLongPress();
    touchStartPosition = null;
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
    
    touchStartTime = Date.now();
    cancelLongPress();
    
    longPressTimer = setTimeout(() => {
      isLongPressing = true;
      longPressTimer = null;
      
      triggerHapticFeedback();
      dispatch('longpressstart', { originalEvent: event });
      dispatch('longpress', { 
        originalEvent: event, 
        duration: Date.now() - touchStartTime 
      });
    }, longPressDuration);
  }
  
  function handleMouseUp(event) {
    if (disabled) return;
    
    const wasLongPressing = isLongPressing;
    cancelLongPress();
    
    if (wasLongPressing && preventClickOnLongPress) {
      event.preventDefault();
      return;
    }
    
    // Emitir click após delay se configurado
    if (clickDelay > 0) {
      setTimeout(() => {
        dispatch('click', event);
      }, clickDelay);
    } else {
      dispatch('click', event);
    }
  }
  
  function handleMouseLeave(event) {
    if (disabled) return;
    cancelLongPress();
  }
  
  function handleClick(event) {
    if (disabled) return;
    
    // Ignorar click se touch event ocorreu recentemente
    if (touchEventOccurred && isTouchDevice) {
      event.preventDefault();
      return;
    }
    
    // Se estava em long press, não emitir click
    if (isLongPressing && preventClickOnLongPress) {
      event.preventDefault();
      return;
    }
    
    // Click já foi emitido no touchend/mouseup se necessário
    // Este handler é principalmente para compatibilidade
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
  on:mouseup={handleMouseUp}
  on:mouseleave={handleMouseLeave}
  on:click={handleClick}
  on:selectstart={handleSelectStart}
  on:contextmenu={handleContextMenu}
  role="button"
  tabindex={disabled ? -1 : 0}
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
    pointer-events: none;
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
