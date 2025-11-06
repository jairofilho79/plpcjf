<script>
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { derived } from 'svelte/store';
  import { louvores, loadLouvores } from '$lib/stores/louvores';
  import { filters, CATEGORY_OPTIONS } from '$lib/stores/filters';
  import { classificationFilters } from '$lib/stores/classificationFilters';
  import { pdfViewer } from '$lib/stores/pdfViewer';
  import SearchBar from '$lib/components/SearchBar.svelte';
  import CategoryFilters from '$lib/components/CategoryFilters.svelte';
  import ClassificationFilters from '$lib/components/ClassificationFilters.svelte';
  import PdfViewerSelector from '$lib/components/PdfViewerSelector.svelte';
  import LouvorCard from '$lib/components/LouvorCard.svelte';
  import CarouselChips from '$lib/components/CarouselChips.svelte';
  
  let searchQuery = '';
  /**
     * @type {string | any[]}
     */
  let filteredResults = [];
  /**
     * @type {number | null | undefined}
     */
  let debounceTimer = null;
  
  onMount(() => {
    loadLouvores();
    
    // Limpar timer ao destruir componente
    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  });
  
  /**
   * @param {string} str
   */
  function normalizeSearchString(str) {
    return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9\s]/g, '');
  }
  
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
  
  function handleSearch() {
    filterLouvores();
  }
  
  function handleClear() {
    // Limpar o debounce timer se existir
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    filteredResults = [];
  }
  
  function filterLouvores() {
    if (!$louvores || $louvores.length === 0) {
      filteredResults = [];
      return;
    }
    
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
    let classificationFiltered = categoryFiltered;
    
    if (selectedFilters.length > 0) {
      // If all unique normalized classifications are selected, show all
      const allSelected = uniqueNormalizedClassifications.length > 0 &&
                         selectedFilters.length === uniqueNormalizedClassifications.length &&
                         uniqueNormalizedClassifications.every(c => selectedFilters.includes(c));
      
      if (!allSelected) {
        // Otherwise, filter by selected classifications
        classificationFiltered = categoryFiltered.filter(louvor => {
          if (!louvor.classificacao) return false;
          const normalized = normalizeClassification(louvor.classificacao);
          return selectedFilters.includes(normalized);
        });
      }
    }
    
    // Apply search filter
    if (!searchQuery.trim()) {
      filteredResults = [];
      return;
    }
    
    if (!isNaN(Number(searchQuery))) {
      filteredResults = classificationFiltered.filter(louvor => Number(louvor.numero) === Number(searchQuery));
      return;
    }
    
    const searchNormalized = normalizeSearchString(searchQuery);
    filteredResults = classificationFiltered.filter(louvor => {
      const titulo = normalizeSearchString(louvor.nome);
      return titulo.includes(searchNormalized);
    });
  }
  
  // Debounce: Aguarda 300ms após o usuário parar de digitar antes de pesquisar
  // Isso evita que a pesquisa bloqueie a digitação
  $: if (searchQuery !== undefined) {
    $filters;
    $classificationFilters;
    
    // Limpar timer anterior se existir
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    
    // Criar novo timer para executar a pesquisa após 300ms
    if (browser) {
      debounceTimer = setTimeout(() => {
        filterLouvores();
      }, 300);
    } else {
      // No servidor, executar diretamente
      filterLouvores();
    }
  }
  
  // Initialize filters with all classifications on first load if localStorage is empty
  let filtersInitialized = false;
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
    // Use pdfId as the unique identifier
    return louvor.pdfId || '';
  }
</script>

<svelte:head>
  <title>Pesquisador de Louvores</title>
</svelte:head>

<div class="max-w-6xl mx-auto">
  <div class="flex flex-col items-center mt-8 space-y-4">
    <SearchBar bind:searchQuery on:clear={handleClear} />
    
    <CategoryFilters />
    
    <ClassificationFilters availableClassifications={$louvores.map(l => l.classificacao).filter(c => c)} />
    
    <PdfViewerSelector />
    
    <CarouselChips />
  </div>
  
  <div class="mt-8 flex justify-center">
    {#if filteredResults.length > 0}
      <div class="louvores-container w-full max-w-4xl">
        <span class="container-tag">Louvores</span>
        <div class="louvores-list">
          {#each filteredResults as louvor (getLouvorKey(louvor))}
            <LouvorCard {louvor} />
          {/each}
        </div>
      </div>
    {:else if searchQuery}
      <p class="text-center text-gray-600 mt-8">Nenhum resultado encontrado.</p>
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
  }
</style>

