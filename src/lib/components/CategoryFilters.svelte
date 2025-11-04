<script>
  import { filters, CATEGORY_OPTIONS } from '$lib/stores/filters';
  
  let allChecked = $filters.length === CATEGORY_OPTIONS.length;
  let indeterminate = false;
  
  $: {
    allChecked = $filters.length === CATEGORY_OPTIONS.length;
    indeterminate = $filters.length > 0 && $filters.length < CATEGORY_OPTIONS.length;
  }
  
  function handleTodosClick() {
    if (allChecked) {
      filters.deselectAll();
    } else {
      filters.selectAll();
    }
  }
  
  // Long press detection
  let longPressTimer = null;
  let wasLongPress = false;
  let wasTouchEvent = false;
  const LONG_PRESS_DURATION = 500; // 500ms
  
  function handleCategoryMouseDown(category, event) {
    wasLongPress = false;
    wasTouchEvent = false;
    
    // Limpar qualquer timer existente
    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
    
    // Iniciar timer para long press
    longPressTimer = setTimeout(() => {
      // Long press detectado - selecionar apenas esta categoria
      wasLongPress = true;
      filters.selectOnly(category);
      longPressTimer = null;
    }, LONG_PRESS_DURATION);
  }
  
  function handleCategoryMouseUp(category, event) {
    // Se o timer ainda está rodando, significa que foi um click normal
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }
  
  function handleCategoryClick(category, event) {
    // Se foi touch event, ignorar (já foi tratado no touchend)
    if (wasTouchEvent) {
      event.preventDefault();
      return;
    }
    // Se foi long press, não fazer toggle (já foi tratado no mousedown)
    if (wasLongPress) {
      event.preventDefault();
      wasLongPress = false;
      return;
    }
    // Click normal - fazer toggle
    filters.toggleCategory(category);
  }
  
  function handleCategoryTouchStart(category, event) {
    wasLongPress = false;
    wasTouchEvent = true;
    
    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
    
    longPressTimer = setTimeout(() => {
      wasLongPress = true;
      filters.selectOnly(category);
      longPressTimer = null;
    }, LONG_PRESS_DURATION);
  }
  
  function handleCategoryTouchEnd(category, event) {
    // Se o timer ainda está rodando, cancelar e fazer toggle
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      // Se foi um touch rápido, fazer toggle
      if (!wasLongPress) {
        filters.toggleCategory(category);
      }
    }
    wasLongPress = false;
    // Reset wasTouchEvent após um delay para permitir que o click event seja prevenido
    setTimeout(() => {
      wasTouchEvent = false;
    }, 300);
  }
  
  function isChecked(category) {
    return $filters.includes(category);
  }
  
  function getIcon(category) {
    if (category === 'Todos') {
      return null; // Sem ícone para Todos
    }
    if (category === 'Partitura') {
      // Ícone que estava em Cifra (documento com linhas)
      return 'M7 21h10M7 21V5a2 2 0 012-2h6a2 2 0 012 2v16M7 21H5a2 2 0 01-2-2V9a2 2 0 012-2h2m10 4h2a2 2 0 012 2v10a2 2 0 01-2 2h-2m-4-4V9a2 2 0 012-2h2M9 9h2m-2 4h2m-2 4h2';
    }
    if (category === 'Cifra' || category.includes('Cifra nível')) {
      // Ícone de documento com linhas (que estava em Cifra nível I)
      return 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z';
    }
    if (category === 'Gestos em Gravura') {
      // Ícone de hand-raised (mão levantada)
      return 'M10.05 4.575a1.575 1.575 0 1 0-3.15 0v3m3.15-3v-1.5a1.575 1.575 0 0 1 3.15 0v1.5m-3.15 0 .075 5.925m3.075.75V4.575m0 0a1.575 1.575 0 0 1 3.15 0V15M6.9 7.575a1.575 1.575 0 1 0-3.15 0v8.175a6.75 6.75 0 0 0 6.75 6.75h2.018a5.25 5.25 0 0 0 3.712-1.538l1.732-1.732a5.25 5.25 0 0 0 1.538-3.712l.003-2.024a.668.668 0 0 1 .198-.471 1.575 1.575 0 1 0-2.228-2.228 3.818 3.818 0 0 0-1.12 2.687M6.9 7.575V12m6.27 4.318A4.49 4.49 0 0 1 16.35 15m.002 0h-.002';
    }
    return '';
  }
</script>

<div class="w-full max-w-4xl p-4 bg-card-color rounded-lg border-2 flex flex-wrap gap-2 items-center justify-center filter-container">
  <span class="container-tag">Filtrar</span>
  <button
    type="button"
    class="filter-chip"
    class:active={allChecked}
    class:indeterminate={indeterminate}
    on:click={handleTodosClick}
  >
    {#if getIcon('Todos')}
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={getIcon('Todos')} />
      </svg>
    {/if}
    <span class="font-semibold">Todos</span>
  </button>
  
  {#each CATEGORY_OPTIONS as category}
    {@const isCategoryActive = $filters.includes(category)}
    {@const iconPath = getIcon(category)}
    <button
      type="button"
      class="filter-chip"
      class:active={isCategoryActive}
      on:click={(e) => handleCategoryClick(category, e)}
      on:mousedown={(e) => handleCategoryMouseDown(category, e)}
      on:mouseup={(e) => handleCategoryMouseUp(category, e)}
      on:mouseleave={(e) => {
        // Cancelar long press se o mouse sair do botão
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }}
      on:touchstart={(e) => handleCategoryTouchStart(category, e)}
      on:touchend={(e) => handleCategoryTouchEnd(category, e)}
      on:touchcancel={(e) => {
        // Cancelar long press se o touch for cancelado
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
        wasLongPress = false;
        wasTouchEvent = false;
      }}
    >
      {#if iconPath}
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={iconPath} />
        </svg>
      {/if}
      <span>{category}</span>
    </button>
  {/each}
</div>

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
  
  .filter-chip.indeterminate {
    background-color: var(--gold-light) !important;
    border-color: var(--gold-color) !important;
    font-weight: 600;
    opacity: 0.9;
  }
  
  .filter-chip svg {
    color: var(--title-color);
    flex-shrink: 0;
    transition: color 0.2s ease;
  }
  
  .filter-chip.active svg {
    color: var(--text-dark) !important;
  }
  
  .filter-chip.indeterminate svg {
    color: var(--title-color);
  }
  
  .filter-chip span {
    color: inherit;
    white-space: nowrap;
  }
</style>

