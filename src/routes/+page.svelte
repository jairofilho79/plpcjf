<script>
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { derived } from 'svelte/store';
  import { louvores, loadLouvores } from '$lib/stores/louvores';
  import { filters } from '$lib/stores/filters';
  import { pdfViewer } from '$lib/stores/pdfViewer';
  import SearchBar from '$lib/components/SearchBar.svelte';
  import CategoryFilters from '$lib/components/CategoryFilters.svelte';
  import PdfViewerSelector from '$lib/components/PdfViewerSelector.svelte';
  import LouvorCard from '$lib/components/LouvorCard.svelte';
  import CarouselChips from '$lib/components/CarouselChips.svelte';
  
  let searchQuery = '';
  let filteredResults = [];
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
  
  function normalizeSearchString(str) {
    return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9\s]/g, '');
  }
  
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
    
    // Get currently selected categories
    const activeCategories = $filters;
    const allCategoriesSelected = activeCategories.length === 5;
    
    // Apply category filter with OR logic
    let filtered = $louvores;
    if (!allCategoriesSelected && activeCategories.length > 0) {
      filtered = $louvores.filter(louvor => {
        if (!louvor.categoria) return false;
        return activeCategories.includes(louvor.categoria);
      });
    }
    
    // Apply search filter
    if (!searchQuery.trim()) {
      filteredResults = [];
      return;
    }
    
    if (!isNaN(Number(searchQuery))) {
      filteredResults = filtered.filter(louvor => Number(louvor.numero) === Number(searchQuery));
      return;
    }
    
    const searchNormalized = normalizeSearchString(searchQuery);
    filteredResults = filtered.filter(louvor => {
      const titulo = normalizeSearchString(louvor.nome);
      return titulo.includes(searchNormalized);
    });
  }
  
  // Debounce: Aguarda 300ms após o usuário parar de digitar antes de pesquisar
  // Isso evita que a pesquisa bloqueie a digitação
  $: if (searchQuery !== undefined) {
    $filters;
    
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
  
  function getLouvorKey(louvor) {
    // Create a unique key combining all identifying fields
    // Use pipe separator to avoid conflicts
    return `${louvor.numero || ''}|${louvor.nome || ''}|${louvor.classificacao || ''}|${louvor.categoria || ''}|${louvor.pdfId || ''}|${louvor.pdf || ''}`;
  }
</script>

<svelte:head>
  <title>Pesquisador de Louvores</title>
</svelte:head>

<div class="max-w-6xl mx-auto">
  <div class="flex flex-col items-center mt-8 space-y-4">
    <SearchBar bind:searchQuery on:clear={handleClear} />
    
    <CategoryFilters />
    
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

