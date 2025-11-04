<script>
  import { createEventDispatcher } from 'svelte';
  
  const dispatch = createEventDispatcher();
  
  const TAPS_REQUIRED = 7;
  const TIME_WINDOW = 5000; // 5 seconds in milliseconds
  
  let tapCount = 0;
  let tapTimestamps = [];
  let timeoutId = null;
  
  /**
   * Handle tap/click on the element
   */
  function handleTap() {
    const now = Date.now();
    
    // Add current tap timestamp
    tapTimestamps.push(now);
    tapCount++;
    
    // Remove taps older than TIME_WINDOW
    tapTimestamps = tapTimestamps.filter(timestamp => 
      now - timestamp <= TIME_WINDOW
    );
    
    // Update tap count based on filtered timestamps
    tapCount = tapTimestamps.length;
    
    // Check if we reached the required number of taps
    if (tapCount >= TAPS_REQUIRED) {
      console.log('[Gesture Detector] Secret gesture detected!');
      dispatch('gesture-detected');
      reset();
      return;
    }
    
    // Clear existing timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    // Set timeout to reset after TIME_WINDOW
    timeoutId = setTimeout(() => {
      reset();
    }, TIME_WINDOW);
  }
  
  /**
   * Reset tap counter
   */
  function reset() {
    tapCount = 0;
    tapTimestamps = [];
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }
  
  /**
   * Cleanup on component destroy
   */
  function cleanup() {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
</script>

<svelte:window on:beforeunload={cleanup} />

<span 
  on:click={handleTap}
  on:touchend|preventDefault={handleTap}
  class="gesture-target"
  role="button"
  tabindex="0"
  on:keydown={(e) => e.key === 'Enter' && handleTap()}
>
  <slot />
</span>

<style>
  .gesture-target {
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    display: inline-block;
    -webkit-tap-highlight-color: transparent;
  }
</style>

