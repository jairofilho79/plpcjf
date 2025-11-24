import { readable } from 'svelte/store';

/**
 * Hook para gerenciar gestos (click e long press) em componentes Svelte
 * @param {Object} options - Opções de configuração
 * @returns {Object} Handlers e estado
 */
export function useGestureHandler(options = {}) {
  const {
    onClick,
    onLongPress,
    onLongPressStart,
    onLongPressEnd,
    onGestureCancel,
    longPressDuration = 500,
    hapticFeedback = true,
    visualFeedback = true,
    preventClickOnLongPress = true,
    clickDelay = 0,
    preventDefault = true
  } = options;
  
  let longPressTimer = null;
  let isLongPressing = false;
  let touchEventOccurred = false;
  let touchStartTime = 0;
  let touchStartPosition = { x: 0, y: 0 };
  const TOUCH_MOVE_THRESHOLD = 10;
  
  // Store reativo para estado de long press
  let setLongPressing = null;
  const isLongPressingStore = readable(false, (set) => {
    setLongPressing = set;
    return () => {
      setLongPressing = null;
    };
  });
  
  // Detectar dispositivo touch
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
      if (setLongPressing) setLongPressing(false);
      onLongPressEnd?.();
    }
  }
  
  function handleTouchStart(event) {
    if (preventDefault) {
      event.preventDefault();
    }
    
    touchEventOccurred = true;
    isTouchDevice = true;
    
    const touch = event.touches[0];
    touchStartTime = Date.now();
    touchStartPosition = { x: touch.clientX, y: touch.clientY };
    
    cancelLongPress();
    
    longPressTimer = setTimeout(() => {
      isLongPressing = true;
      if (setLongPressing) setLongPressing(true);
      longPressTimer = null;
      
      triggerHapticFeedback();
      onLongPressStart?.(event);
      onLongPress?.(event, Date.now() - touchStartTime);
    }, longPressDuration);
    
    setTimeout(() => {
      touchEventOccurred = false;
    }, 300);
  }
  
  function handleTouchMove(event) {
    if (!touchStartPosition) return;
    
    const touch = event.touches[0];
    const dx = Math.abs(touch.clientX - touchStartPosition.x);
    const dy = Math.abs(touch.clientY - touchStartPosition.y);
    
    if (dx > TOUCH_MOVE_THRESHOLD || dy > TOUCH_MOVE_THRESHOLD) {
      cancelLongPress();
      touchStartPosition = null;
    }
  }
  
  function handleTouchEnd(event) {
    const wasLongPressing = isLongPressing;
    cancelLongPress();
    touchStartPosition = null;
    
    if (wasLongPressing && preventClickOnLongPress) {
      event.preventDefault();
      return;
    }
    
    if (onClick) {
      if (clickDelay > 0) {
        setTimeout(() => onClick(event), clickDelay);
      } else {
        onClick(event);
      }
    }
  }
  
  function handleTouchCancel(event) {
    cancelLongPress();
    touchStartPosition = null;
    onGestureCancel?.(event);
  }
  
  function handleMouseDown(event) {
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
      if (setLongPressing) setLongPressing(true);
      longPressTimer = null;
      
      triggerHapticFeedback();
      onLongPressStart?.(event);
      onLongPress?.(event, Date.now() - touchStartTime);
    }, longPressDuration);
  }
  
  function handleMouseUp(event) {
    const wasLongPressing = isLongPressing;
    cancelLongPress();
    
    if (wasLongPressing && preventClickOnLongPress) {
      event.preventDefault();
      return;
    }
    
    if (onClick) {
      if (clickDelay > 0) {
        setTimeout(() => onClick(event), clickDelay);
      } else {
        onClick(event);
      }
    }
  }
  
  function handleMouseLeave(event) {
    cancelLongPress();
  }
  
  function handleClick(event) {
    if (touchEventOccurred && isTouchDevice) {
      event.preventDefault();
      return;
    }
    
    if (isLongPressing && preventClickOnLongPress) {
      event.preventDefault();
      return;
    }
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
  
  function cleanup() {
    cancelLongPress();
  }
  
  return {
    handlers: {
      ontouchstart: handleTouchStart,
      ontouchmove: handleTouchMove,
      ontouchend: handleTouchEnd,
      ontouchcancel: handleTouchCancel,
      onmousedown: handleMouseDown,
      onmouseup: handleMouseUp,
      onmouseleave: handleMouseLeave,
      onclick: handleClick,
      onselectstart: handleSelectStart,
      oncontextmenu: handleContextMenu
    },
    isLongPressing: isLongPressingStore,
    cleanup
  };
}





