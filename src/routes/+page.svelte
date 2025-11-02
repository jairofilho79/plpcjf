<script>
  import { onMount } from 'svelte';
  import { derived } from 'svelte/store';
  import { louvores, loadLouvores } from '$lib/stores/louvores';
  import { filters } from '$lib/stores/filters';
  import { pdfViewer } from '$lib/stores/pdfViewer';
  import SearchBar from '$lib/components/SearchBar.svelte';
  import CategoryFilters from '$lib/components/CategoryFilters.svelte';
  import LouvorCard from '$lib/components/LouvorCard.svelte';
  import CarouselChips from '$lib/components/CarouselChips.svelte';
  
  let searchQuery = '';
  let filteredResults = [];
  
  onMount(() => {
    loadLouvores();
  });
  
  function normalizeSearchString(str) {
    return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9\s]/g, '');
  }
  
  function handleSearch() {
    filterLouvores();
  }
  
  function handleClear() {
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
  
  $: if (searchQuery !== undefined) {
    // React to store changes
    $filters;
    filterLouvores();
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
    <SearchBar bind:searchQuery on:search={handleSearch} on:clear={handleClear} />
    
    <CategoryFilters />
    
    <select
      bind:value={$pdfViewer}
      class="w-full max-w-4xl p-3 text-base border-2 border-gray-300 rounded-lg bg-white mt-4 cursor-pointer focus:outline-none focus:border-gold-color"
    >
      <option value="online">Leitor Online</option>
      <option value="newtab">Abrir PDF em nova aba</option>
      <option value="share">Compartilhar (menu do sistema)</option>
      <option value="save">Salvar/baixar para o dispositivo</option>
    </select>
    
    <CarouselChips />
  </div>
  
  <div class="mt-8">
    {#if filteredResults.length > 0}
      <div class="flex flex-col items-center gap-4">
        {#each filteredResults as louvor (getLouvorKey(louvor))}
          <LouvorCard {louvor} />
        {/each}
      </div>
    {:else if searchQuery}
      <p class="text-center text-gray-600 mt-8">Nenhum resultado encontrado.</p>
    {/if}
  </div>
</div>

