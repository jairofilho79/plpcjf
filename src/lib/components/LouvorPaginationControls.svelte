<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { browser } from '$app/environment';
  import { VALID_OPTIONS } from '$lib/stores/bibliotecaItemsPerPage';
  import GestureButton from '$lib/components/GestureButton.svelte';
  import { ChevronLeft, ChevronRight } from 'lucide-svelte';

  /** @type {'top' | 'bottom'} */
  export let variant = 'bottom';

  export let currentPage = 1;
  export let totalPages = 1;
  export let pageInput = '1';
  export let itemsPerPage = 10;

  let itemsPerPageMenuOpen = false;
  /** @type {HTMLDivElement | null} */
  let itemsPerPageButtonElement = null;

  const dispatch = createEventDispatcher();

  /** @param {MouseEvent} event */
  function handleClickOutside(event) {
    if (
      itemsPerPageButtonElement &&
      event.target instanceof Node &&
      !itemsPerPageButtonElement.contains(event.target)
    ) {
      itemsPerPageMenuOpen = false;
    }
  }

  onMount(() => {
    if (browser) document.addEventListener('click', handleClickOutside);
  });

  onDestroy(() => {
    if (browser) document.removeEventListener('click', handleClickOutside);
  });

  /**
   * @param {Event & { currentTarget: EventTarget & HTMLInputElement }} event
   */
  function handlePageInput(event) {
    pageInput = event.currentTarget.value;
  }

  /**
   * @param {KeyboardEvent & { currentTarget: EventTarget & HTMLInputElement }} event
   */
  function handlePageInputKeydown(event) {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
      const pageNum = parseInt(pageInput, 10);
      if (!isNaN(pageNum)) {
        const p = Math.max(1, Math.min(totalPages, pageNum));
        dispatch('gotoPage', { page: p, scroll: true });
        pageInput = String(p);
      } else {
        pageInput = currentPage.toString();
      }
    }
  }

  function commitPageFromInput() {
    const pageNum = parseInt(pageInput, 10);
    if (isNaN(pageNum) || pageNum < 1 || pageNum > totalPages) {
      pageInput = currentPage.toString();
      return;
    }
    dispatch('gotoPage', { page: pageNum, scroll: false });
  }
</script>

<div
  class="pagination-controls"
  class:pagination-controls-top={variant === 'top'}
>
  <div class="pagination-info">
    Página <strong>{currentPage}</strong> de <strong>{totalPages}</strong>
  </div>

  <div class="pagination-controls-right">
    <div class="items-per-page-selector">
      <span class="items-per-page-label">Itens por página:</span>
      <div class="items-per-page-wrapper" bind:this={itemsPerPageButtonElement}>
        <button
          type="button"
          class="items-per-page-button"
          on:click={(e) => {
            e.stopPropagation();
            itemsPerPageMenuOpen = !itemsPerPageMenuOpen;
          }}
          aria-label="Alterar itens por página"
        >
          {itemsPerPage}
        </button>
        {#if itemsPerPageMenuOpen}
          <div class="items-per-page-menu">
            {#each VALID_OPTIONS as option}
              <button
                type="button"
                class="items-per-page-option"
                class:active={itemsPerPage === option}
                on:click={(e) => {
                  e.stopPropagation();
                  itemsPerPageMenuOpen = false;
                  dispatch('itemsPerPage', { value: option });
                }}
              >
                {option}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="pagination-input-group">
      <GestureButton
        disabled={currentPage === 1}
        ariaLabel="Página anterior (toque longo para a primeira página)"
        on:click={() => dispatch('previous')}
        on:longpress={() => dispatch('first')}
        longPressDuration={500}
        hapticFeedback={true}
        preventDefault={true}
      >
        <div
          class="pagination-button"
          class:pagination-button-disabled={currentPage === 1}
          title="Página anterior (long press para primeira página)"
        >
          <ChevronLeft class="w-5 h-5" />
        </div>
      </GestureButton>

      <input
        type="number"
        class="pagination-input"
        bind:value={pageInput}
        on:input={handlePageInput}
        on:keydown={handlePageInputKeydown}
        on:blur={commitPageFromInput}
        min="1"
        max={totalPages}
        aria-label="Número da página"
      />

      <GestureButton
        disabled={currentPage === totalPages}
        ariaLabel="Próxima página (toque longo para a última página)"
        on:click={() => dispatch('next')}
        on:longpress={() => dispatch('last')}
        longPressDuration={500}
        hapticFeedback={true}
        preventDefault={true}
      >
        <div
          class="pagination-button"
          class:pagination-button-disabled={currentPage === totalPages}
          title="Próxima página (long press para última página)"
        >
          <ChevronRight class="w-5 h-5" />
        </div>
      </GestureButton>
    </div>
  </div>
</div>

<style>
  .pagination-controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 1rem;
    border-top: 2px solid var(--gold-color);
    gap: 1rem;
    flex-wrap: wrap;
  }

  .pagination-controls-top {
    padding-top: 0;
    border-top: none;
    padding-bottom: 1rem;
    border-bottom: 2px solid var(--gold-color);
  }

  .pagination-info {
    color: var(--text-dark);
    font-size: 0.875rem;
  }

  .pagination-info strong {
    color: var(--text-dark);
    font-weight: 700;
  }

  .pagination-controls-right {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .items-per-page-selector {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .items-per-page-label {
    color: var(--text-dark);
    font-size: 0.875rem;
    white-space: nowrap;
  }

  .items-per-page-wrapper {
    position: relative;
  }

  .items-per-page-button {
    height: 2.5rem;
    min-width: 3rem;
    padding: 0 0.75rem;
    background-color: var(--card-color);
    color: var(--text-dark);
    border: 2px solid var(--gold-color);
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: center;
  }

  .items-per-page-button:hover {
    border-color: var(--gold-light);
    background-color: rgba(244, 208, 63, 0.1);
  }

  /* :not(:focus-visible) só cobre o clique/toque — o anel de teclado vem
     do :focus-visible global em app.css, que não é sobrescrito aqui. */
  .items-per-page-button:focus:not(:focus-visible) {
    outline: none;
    border-color: var(--gold-light);
    box-shadow: 0 0 0 3px rgba(244, 208, 63, 0.25);
  }

  .items-per-page-menu {
    position: absolute;
    top: calc(100% + 0.25rem);
    left: 0;
    background-color: var(--card-color);
    border: 2px solid var(--gold-color);
    border-radius: 0.5rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 100;
    min-width: 100%;
    overflow: hidden;
  }

  .items-per-page-option {
    display: block;
    width: 100%;
    padding: 0.5rem 0.75rem;
    background-color: transparent;
    color: var(--text-dark);
    border: none;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: center;
  }

  .items-per-page-option:hover {
    background-color: rgba(244, 208, 63, 0.2);
  }

  .items-per-page-option.active {
    background-color: rgba(244, 208, 63, 0.3);
    color: var(--text-dark);
  }

  .pagination-input-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .pagination-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    background-color: var(--title-color);
    color: var(--text-light);
    border: 2px solid var(--gold-color);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.2s ease;
    padding: 0;
    user-select: none;
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
  }

  .pagination-button:hover:not(:disabled) {
    background-color: var(--gold-light);
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  .pagination-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background-color: var(--badge-gray-bg);
  }

  .pagination-button.pagination-button-disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background-color: var(--badge-gray-bg);
  }

  .pagination-input {
    width: 4rem;
    height: 2.5rem;
    text-align: center;
    background-color: var(--card-color);
    color: var(--text-dark);
    border: 2px solid var(--gold-color);
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 600;
    padding: 0 0.5rem;
    transition: all 0.2s ease;
  }

  /* :not(:focus-visible) só cobre o clique/toque — o anel de teclado vem
     do :focus-visible global em app.css, que não é sobrescrito aqui. */
  .pagination-input:focus:not(:focus-visible) {
    outline: none;
    border-color: var(--gold-light);
    box-shadow: 0 0 0 3px rgba(244, 208, 63, 0.25);
  }

  .pagination-input::-webkit-inner-spin-button,
  .pagination-input::-webkit-outer-spin-button {
    opacity: 1;
  }

  @media (max-width: 640px) {
    .pagination-controls {
      flex-direction: column;
      align-items: stretch;
    }

    .pagination-info {
      text-align: center;
    }

    .pagination-controls-right {
      flex-direction: column;
      align-items: stretch;
      gap: 0.75rem;
    }

    .items-per-page-selector {
      justify-content: center;
    }

    .pagination-input-group {
      justify-content: center;
    }
  }
</style>
