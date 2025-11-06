<script>
  import { classificationFilters } from '$lib/stores/classificationFilters';
  
  export let availableClassifications = [];
  
  // Normalize classification by removing content in parentheses
  /**
   * @param {string} classification
   */
  function normalizeClassification(classification) {
    if (!classification) return '';
    return classification.replace(/\([^)]*\)/g, '').trim();
  }
  
  // Get unique normalized classifications
  $: normalizedClassifications = (availableClassifications || [])
    .map(c => normalizeClassification(c))
    .filter(c => c)
    .filter((c, index, arr) => arr.indexOf(c) === index)
    .sort();
  
  let allChecked = false;
  let indeterminate = false;
  
  $: {
    allChecked = $classificationFilters.length === normalizedClassifications.length && normalizedClassifications.length > 0;
    indeterminate = $classificationFilters.length > 0 && $classificationFilters.length < normalizedClassifications.length;
  }
  
  function handleTodosClick() {
    if (allChecked) {
      classificationFilters.deselectAll();
    } else {
      classificationFilters.selectAll(normalizedClassifications);
    }
  }
  
  // Long press detection
  /**
   * @type {number | null | undefined}
   */
  let longPressTimer = null;
  let wasLongPress = false;
  const LONG_PRESS_DURATION = 500; // 500ms
  
  /**
   * @param {string} classification
   * @param {MouseEvent & { currentTarget: EventTarget & HTMLButtonElement; }} event
   */
  function handleClassificationMouseDown(classification, event) {
    wasLongPress = false;
    
    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
    
    longPressTimer = setTimeout(() => {
      wasLongPress = true;
      classificationFilters.selectOnly(classification);
      longPressTimer = null;
    }, LONG_PRESS_DURATION);
  }
  
  /**
   * @param {string} classification
   * @param {MouseEvent & { currentTarget: EventTarget & HTMLButtonElement; }} event
   */
  function handleClassificationMouseUp(classification, event) {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      wasLongPress = false;
    }
  }
  
  /**
   * @param {string} classification
   * @param {MouseEvent & { currentTarget: EventTarget & HTMLButtonElement; }} event
   */
  function handleClassificationClick(classification, event) {
    if (wasLongPress) {
      event.preventDefault();
      wasLongPress = false;
      return;
    }
    classificationFilters.toggleClassification(classification);
  }
  
  /**
   * @param {string} classification
   * @param {TouchEvent & { currentTarget: EventTarget & HTMLButtonElement; }} event
   */
  function handleClassificationTouchStart(classification, event) {
    wasLongPress = false;
    
    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
    
    longPressTimer = setTimeout(() => {
      wasLongPress = true;
      classificationFilters.selectOnly(classification);
      longPressTimer = null;
    }, LONG_PRESS_DURATION);
  }
  
  /**
   * @param {string} classification
   * @param {TouchEvent & { currentTarget: EventTarget & HTMLButtonElement; }} event
   */
  function handleClassificationTouchEnd(classification, event) {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      wasLongPress = false;
    }
  }
</script>

{#if normalizedClassifications.length > 0}
  <div class="w-full max-w-4xl p-4 bg-card-color rounded-lg border-2 flex flex-wrap gap-2 items-center justify-center filter-container">
    <span class="container-tag">Arranjo</span>
    <button
      type="button"
      class="todos-button-tag"
      class:active={allChecked}
      class:indeterminate={indeterminate}
      on:click={handleTodosClick}
      title={allChecked ? "Desselecionar todos" : "Selecionar todos"}
    >
      <span>Todos</span>
    </button>
    
    {#each normalizedClassifications as classification}
      {@const isClassificationActive = $classificationFilters.includes(classification)}
      <button
        type="button"
        class="filter-chip"
        class:active={isClassificationActive}
        on:click={(e) => handleClassificationClick(classification, e)}
        on:mousedown={(e) => handleClassificationMouseDown(classification, e)}
        on:mouseup={(e) => handleClassificationMouseUp(classification, e)}
        on:mouseleave={(e) => {
          if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          }
          wasLongPress = false;
        }}
        on:touchstart={(e) => handleClassificationTouchStart(classification, e)}
        on:touchend={(e) => handleClassificationTouchEnd(classification, e)}
        on:touchcancel={(e) => {
          if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          }
          wasLongPress = false;
        }}
      >
        <span>{classification}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .filter-container {
    border-color: var(--gold-color);
    color: var(--text-dark);
    position: relative;
  }
  
  .container-tag {
    position: absolute;
    top: -0.875rem;
    left: 0.75rem;
    background-color: var(--card-color);
    color: var(--text-dark);
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    border: 2px solid var(--gold-color);
    z-index: 10;
    line-height: 1;
  }
  
  .todos-button-tag {
    position: absolute;
    top: -0.875rem;
    right: 0.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    background-color: var(--card-color);
    color: var(--text-dark);
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    border: 2px solid var(--title-color);
    cursor: pointer;
    transition: all 0.2s ease;
    line-height: 1;
    z-index: 10;
  }
  
  .todos-button-tag:hover {
    background-color: var(--placeholder-color);
    border-color: var(--gold-color);
    transform: translateY(-1px);
  }
  
  .todos-button-tag.active {
    background-color: var(--gold-color) !important;
    border-color: var(--gold-color) !important;
    color: var(--text-dark) !important;
    font-weight: 700 !important;
    box-shadow: 0 3px 8px rgba(212, 175, 55, 0.5);
    transform: translateY(-2px);
  }
  
  .todos-button-tag.indeterminate {
    background-color: var(--gold-light) !important;
    border-color: var(--gold-color) !important;
    font-weight: 600;
    opacity: 0.9;
  }
  
  .todos-button-tag span {
    color: inherit;
  }
  
  @media (max-width: 768px) {
    .todos-button-tag {
      right: 0.5rem;
    }
  }
  
  .filter-chip {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.75rem;
    border-radius: 1.25rem;
    border: 2px solid var(--title-color);
    background-color: transparent;
    color: var(--text-dark);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  
  .filter-chip:hover:not(.active) {
    background-color: var(--placeholder-color);
    border-color: var(--gold-color);
    transform: translateY(-1px);
  }
  
  .filter-chip.active {
    background-color: var(--gold-color) !important;
    border-color: var(--gold-color) !important;
    color: var(--text-dark) !important;
    font-weight: 700 !important;
    box-shadow: 0 3px 8px rgba(212, 175, 55, 0.5);
    transform: translateY(-2px);
  }
  
  .filter-chip span {
    color: inherit;
    white-space: nowrap;
  }
  
  @media (min-width: 768px) {
    .filter-container {
      justify-content: flex-start !important;
      gap: 0.5rem !important;
    }
    
    .filter-chip {
      flex-shrink: 0;
    }
  }
  
  @media (min-width: 1024px) {
    .filter-container {
      justify-content: center !important;
      gap: 0.75rem !important;
    }
  }
</style>

