<script>
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { louvores, loadLouvores } from '$lib/stores/louvores';
  import { classificationFilters } from '$lib/stores/classificationFilters';
  import { filters, CATEGORY_OPTIONS } from '$lib/stores/filters';
  import { bibliotecaSort } from '$lib/stores/bibliotecaSort';
  import { bibliotecaItemsPerPage, VALID_OPTIONS } from '$lib/stores/bibliotecaItemsPerPage';
  import { pdfViewer } from '$lib/stores/pdfViewer';
  import ClassificationFilters from '$lib/components/ClassificationFilters.svelte';
  import CategoryFilters from '$lib/components/CategoryFilters.svelte';
  import SortSelector from '$lib/components/SortSelector.svelte';
  import PdfViewerSelector from '$lib/components/PdfViewerSelector.svelte';
  import LouvorCard from '$lib/components/LouvorCard.svelte';
  import { ChevronLeft, ChevronRight } from 'lucide-svelte';
  
  // Normalize classification by removing content in parentheses
  /**
   * @param {string} classification
   */
  function normalizeClassification(classification) {
    if (!classification) return '';
    return classification.replace(/\([^)]*\)/g, '').trim();
  }
  
  // Expand category filter: if "Cifra" is selected, include "Cifra nível I" and "Cifra nível II"
  /**
   * @param {string[]} selectedCategories
   */
  function expandCategoryFilter(selectedCategories) {
    const expanded = [...selectedCategories];
    if (selectedCategories.includes('Cifra')) {
      if (!expanded.includes('Cifra nível I')) expanded.push('Cifra nível I');
      if (!expanded.includes('Cifra nível II')) expanded.push('Cifra nível II');
    }
    return expanded;
  }
  
  // Get unique normalized classifications from louvores
  $: uniqueNormalizedClassifications = $louvores
    .map(louvor => normalizeClassification(louvor.classificacao))
    .filter(c => c)
    .filter((c, index, arr) => arr.indexOf(c) === index)
    .sort();
  
  // Filter louvores based on selected categories and classifications (inclusive filter)
  // If no filters selected OR all filters selected, show all louvores
  $: filteredLouvores = (() => {
    if (!$louvores || $louvores.length === 0) return [];
    
    // First, apply category filter (with inclusive logic for Cifra)
    const activeCategories = $filters;
    const allCategoriesSelected = activeCategories.length === CATEGORY_OPTIONS.length;
    
    let categoryFiltered = $louvores;
    if (!allCategoriesSelected && activeCategories.length > 0) {
      // Expand "Cifra" to include "Cifra nível I" and "Cifra nível II"
      const expandedCategories = expandCategoryFilter(activeCategories);
      categoryFiltered = $louvores.filter(louvor => {
        if (!louvor.categoria) return false;
        return expandedCategories.includes(louvor.categoria);
      });
    }
    
    // Then, apply classification filter
    const selectedFilters = $classificationFilters;
    
    // If no classification filters selected, return category-filtered results
    if (selectedFilters.length === 0) {
      return categoryFiltered;
    }
    
    // If all unique normalized classifications are selected, return category-filtered results
    const allSelected = uniqueNormalizedClassifications.length > 0 &&
                       selectedFilters.length === uniqueNormalizedClassifications.length &&
                       uniqueNormalizedClassifications.every(c => selectedFilters.includes(c));
    
    if (allSelected) {
      return categoryFiltered;
    }
    
    // Otherwise, filter by selected classifications
    return categoryFiltered.filter(louvor => {
      if (!louvor.classificacao) return false;
      const normalized = normalizeClassification(louvor.classificacao);
      return selectedFilters.includes(normalized);
    });
  })();
  
  // Sort louvores
  $: sortedLouvores = (() => {
    const sorted = [...filteredLouvores];
    if ($bibliotecaSort === 'numero') {
      return sorted.sort((a, b) => Number(a.numero || 0) - Number(b.numero || 0));
    } else {
      return sorted.sort((a, b) => {
        const nomeA = (a.nome || '').toLowerCase();
        const nomeB = (b.nome || '').toLowerCase();
        return nomeA.localeCompare(nomeB, 'pt-BR');
      });
    }
  })();
  
  // Pagination
  let currentPage = 1;
  let pageInput = '1';
  let itemsPerPageMenuOpen = false;
  /**
   * @type {HTMLElement | null}
   */
  let louvoresContainer = null;

  function scrollToLouvores() {
    if (!browser) return;

    const target = louvoresContainer || document.getElementById('louvores');
    if (!target) return;

    const mediaQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    const prefersReducedMotion = mediaQuery?.matches;
    target.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start'
    });
  }

  /**
   * @param {number} page
   * @param {{ scroll?: boolean }} [options]
   */
  function setPage(page, { scroll = true } = {}) {
    const maxPage = totalPages > 0 ? totalPages : 1;
    const pageNum = Math.max(1, Math.min(maxPage, page));
    currentPage = pageNum;
    pageInput = pageNum.toString();

    if (scroll && totalPages > 0) {
      scrollToLouvores();
    }
  }

  $: itemsPerPage = $bibliotecaItemsPerPage;
  $: totalPages = Math.ceil(sortedLouvores.length / itemsPerPage);
  $: paginatedLouvores = sortedLouvores.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );
  
  // Reset to page 1 when items per page changes
  $: {
    if (itemsPerPage) {
      const newTotalPages = Math.ceil(sortedLouvores.length / itemsPerPage);
      if (currentPage > newTotalPages && newTotalPages > 0) {
        setPage(1, { scroll: false });
      }
    }
  }
  
  // Reset to page 1 when filters change or when current page exceeds total pages
  let previousFilteredCount = 0;
  $: {
    const currentFilteredCount = filteredLouvores.length;
    // Reset to page 1 if filtered results count changed significantly or current page is invalid
    if (previousFilteredCount !== currentFilteredCount || (currentPage > totalPages && totalPages > 0)) {
      setPage(1, { scroll: false });
    }
    previousFilteredCount = currentFilteredCount;
  }
  
  /**
     * @param {number} page
     */
  function goToPage(page) {
    setPage(page);
  }
  
  /**
     * @param {Event & { currentTarget: EventTarget & HTMLInputElement }} event
     */
  function handlePageInput(event) {
    const value = event.currentTarget.value;
    pageInput = value;
    const pageNum = parseInt(value, 10);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
      setPage(pageNum, { scroll: false });
    }
  }
  
  /**
     * @param {KeyboardEvent & { currentTarget: EventTarget & HTMLInputElement }} event
     */
  function handlePageInputKeydown(event) {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
      const pageNum = parseInt(pageInput, 10);
      if (!isNaN(pageNum)) {
        setPage(pageNum);
      } else {
        pageInput = currentPage.toString();
      }
    }
  }
  
  function nextPage() {
    if (currentPage < totalPages) {
      setPage(currentPage + 1);
    }
  }
  
  function previousPage() {
    if (currentPage > 1) {
      setPage(currentPage - 1);
    }
  }
  
  let filtersInitialized = false;
  /**
   * @type {HTMLElement | null}
   */
  let itemsPerPageButtonElement = null;
  
  // Close menu when clicking outside
  /**
   * @param {MouseEvent} event
   */
  function handleClickOutside(event) {
    if (itemsPerPageButtonElement && event.target instanceof Node && !itemsPerPageButtonElement.contains(event.target)) {
      itemsPerPageMenuOpen = false;
    }
  }
  
  onMount(() => {
    loadLouvores();
    if (browser) {
      document.addEventListener('click', handleClickOutside);
    }
  });
  
  onDestroy(() => {
    if (browser) {
      document.removeEventListener('click', handleClickOutside);
    }
  });
  
  // Initialize filters with all classifications on first load if localStorage is empty
  $: {
    if ($louvores.length && !filtersInitialized) {
      // Check if filters are empty (not initialized) and we have classifications
      if ($classificationFilters.length === 0 && uniqueNormalizedClassifications.length > 0) {
        filtersInitialized = true;
        classificationFilters.selectAll(uniqueNormalizedClassifications);
      } else if ($classificationFilters.length > 0) {
        // Filters already initialized from localStorage
        filtersInitialized = true;
      }
    }
  }
  
  /**
   * @param {{ pdfId: any; }} louvor
   */
  function getLouvorKey(louvor) {
    return louvor.pdfId || '';
  }
</script>

<svelte:head>
  <title>Biblioteca - PLPC</title>
</svelte:head>

<div class="max-w-6xl mx-auto">
  <div class="flex flex-col items-center mt-8 space-y-4">
    <CategoryFilters />
    
    <ClassificationFilters availableClassifications={$louvores.map(l => l.classificacao).filter(c => c)} />
    
    <SortSelector />
    
    <PdfViewerSelector />
  </div>
  
  <div class="mt-8 flex justify-center">
    {#if paginatedLouvores.length > 0}
      <div id="louvores" class="louvores-container w-full max-w-4xl" bind:this={louvoresContainer}>
        <span class="container-tag">Louvores</span>
        
        <div class="louvores-list">
          {#each paginatedLouvores as louvor (getLouvorKey(louvor))}
            <LouvorCard {louvor} />
          {/each}
        </div>
        
        <!-- Pagination Controls -->
        <div class="pagination-controls">
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
                  {$bibliotecaItemsPerPage}
                </button>
                {#if itemsPerPageMenuOpen}
                  <div class="items-per-page-menu">
                    {#each VALID_OPTIONS as option}
                      <button
                        type="button"
                        class="items-per-page-option"
                        class:active={$bibliotecaItemsPerPage === option}
                        on:click={(e) => {
                          e.stopPropagation();
                          bibliotecaItemsPerPage.set(option);
                          itemsPerPageMenuOpen = false;
                          scrollToLouvores();
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
              <button
                type="button"
                class="pagination-button"
                on:click={previousPage}
                disabled={currentPage === 1}
                title="Página anterior"
              >
                <ChevronLeft class="w-5 h-5" />
              </button>
              
              <input
                type="number"
                class="pagination-input"
                bind:value={pageInput}
                on:input={handlePageInput}
                on:keydown={handlePageInputKeydown}
                on:blur={() => {
                  const pageNum = parseInt(pageInput, 10);
                  if (isNaN(pageNum) || pageNum < 1 || pageNum > totalPages) {
                    pageInput = currentPage.toString();
                  }
                }}
                min="1"
                max={totalPages}
                aria-label="Número da página"
              />
              
              <button
                type="button"
                class="pagination-button"
                on:click={nextPage}
                disabled={currentPage === totalPages}
                title="Próxima página"
              >
                <ChevronRight class="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    {:else if $louvores.length > 0}
      <p class="text-center text-gray-600 mt-8">Nenhum louvor encontrado com os filtros selecionados.</p>
    {/if}
  </div>
</div>

<style>
  .louvores-container {
    position: relative;
    padding: 1rem;
    background-color: var(--card-color);
    border: 2px solid var(--gold-color);
    border-radius: 0.5rem;
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
  
  .louvores-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }
  
  .pagination-controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 1rem;
    border-top: 2px solid var(--gold-color);
    gap: 1rem;
    flex-wrap: wrap;
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
  
  .items-per-page-button:focus {
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
  
  .pagination-input:focus {
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

