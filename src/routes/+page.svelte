<script>
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { derived } from 'svelte/store';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { louvores, loadLouvores, louvoresLoaded } from '$lib/stores/louvores';
  import { filters, CATEGORY_OPTIONS } from '$lib/stores/filters';
  import { classificationFilters } from '$lib/stores/classificationFilters';
  import { pdfViewer } from '$lib/stores/pdfViewer';
  import { carousel } from '$lib/stores/carousel';
  import { savedPlaylists } from '$lib/stores/savedPlaylists';
  import { parseUrlParams, updateUrlParams } from '$lib/utils/urlSync';
  import SearchBar from '$lib/components/SearchBar.svelte';
  import CategoryFilters from '$lib/components/CategoryFilters.svelte';
  import ClassificationFilters from '$lib/components/ClassificationFilters.svelte';
  import PdfViewerSelector from '$lib/components/PdfViewerSelector.svelte';
  import LouvorCard from '$lib/components/LouvorCard.svelte';
  import CarouselChips from '$lib/components/CarouselChips.svelte';
  
  // Inicializar searchQuery da URL
  let searchQuery = browser && $page && $page.url ? (parseUrlParams($page.url).pesquisa || '') : '';
  /**
     * @type {string | any[]}
     */
  let filteredResults = [];
  /**
     * @type {number | null | undefined}
     */
  let debounceTimer = null;
  let searchUrlUpdateTimer = null;
  let isUpdatingFromUrl = false;
  let sharedLinkProcessed = false;
  
  // Reagir a mudanças na URL para atualizar searchQuery
  // Só atualiza se o valor da URL for diferente do valor atual (normalizado)
  // E não atualiza se um input estiver focado (usuário está digitando)
  $: if (browser && !isUpdatingFromUrl && $page && $page.url) {
    const urlParams = parseUrlParams($page.url);
    const urlPesquisa = (urlParams.pesquisa || '').trim();
    const currentPesquisa = (searchQuery || '').trim();
    
    // Não atualizar se um input estiver focado (usuário está digitando)
    const inputFocused = browser && document.activeElement && document.activeElement.tagName === 'INPUT';
    
    // Só atualiza se o valor realmente for diferente E nenhum input estiver focado
    if (urlPesquisa !== currentPesquisa && !inputFocused) {
      isUpdatingFromUrl = true;
      searchQuery = urlParams.pesquisa || '';
      // Usar setTimeout para garantir que a flag seja resetada após a atualização
      setTimeout(() => {
        isUpdatingFromUrl = false;
      }, 0);
    }
  }
  
  let filtersInitialized = false;
  let initTimeout = null;
  
  // Função para inicializar os filtros
  function initializeFiltersIfNeeded() {
    if (filtersInitialized || !browser || !$page || !$page.url) return;
    if (!$louvores.length || !$louvoresLoaded) return;
    
    const urlParams = parseUrlParams($page.url);
    const urlHasArranjo = $page.url.search && $page.url.search.includes('arranjo=');
    
    // Calcular classificações únicas
    const classifications = $louvores
      .map(louvor => normalizeClassification(louvor.classificacao))
      .filter(c => c)
      .filter((c, index, arr) => arr.indexOf(c) === index)
      .sort();
    
    if (classifications.length === 0) return; // Ainda não há classificações disponíveis
    
    // Se URL não tem arranjo e não há filtros selecionados, selecionar todos
    if (!urlHasArranjo && $classificationFilters.length === 0) {
      filtersInitialized = true;
      classificationFilters.selectAll(classifications);
    } else if (urlHasArranjo || $classificationFilters.length > 0) {
      // Já tem parâmetro na URL ou já há filtros selecionados
      filtersInitialized = true;
    }
  }
  
  onMount(async () => {
    await loadLouvores();
    
    if (browser) {
      // Aguardar até que os louvores estejam carregados
      const checkAndInit = () => {
        if ($louvoresLoaded && $louvores.length > 0 && !filtersInitialized) {
          // Aguardar um pouco para garantir que os dados reativos estejam processados
          if (initTimeout) clearTimeout(initTimeout);
          initTimeout = setTimeout(() => {
            initializeFiltersIfNeeded();
          }, 200);
        }
      };
      
      // Verificar imediatamente se já está pronto
      checkAndInit();
      
      // Também escutar mudanças
      const unsubscribeLouvores = louvoresLoaded.subscribe(() => {
        checkAndInit();
      });
      
      // Limpar timers ao destruir componente
      return () => {
        unsubscribeLouvores();
        if (initTimeout) clearTimeout(initTimeout);
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        if (searchUrlUpdateTimer) {
          clearTimeout(searchUrlUpdateTimer);
        }
      };
    }
  });

  /**
   * Handle shared playlist link from query parameters
   */
  function handleSharedPlaylistLink() {
    if (sharedLinkProcessed) return;
    
    const urlParams = new URLSearchParams($page.url.search);
    const sharepdfs = urlParams.get('sharepdfs');
    const sharename = urlParams.get('sharename');

    if (sharepdfs && $louvores.length > 0) {
      sharedLinkProcessed = true;
      
      // Parse PDF IDs from comma-separated string
      const pdfIds = sharepdfs.split(',').filter(id => id.trim());
      
      if (pdfIds.length > 0) {
        // Clear current playlist
        carousel.clearCarousel();
        
        // Load playlist with the shared PDF IDs
        carousel.loadPlaylist(pdfIds, $louvores);
        
        // Save playlist automatically with the shared name or default name
        const playlistName = sharename ? decodeURIComponent(sharename) : undefined;
        savedPlaylists.savePlaylist(pdfIds, playlistName);
        
        // Clean URL by removing query parameters
        goto($page.url.pathname, { replaceState: true, noScroll: true });
      }
    }
  }

  // Watch for louvores to be loaded and handle shared link
  $: {
    if (browser && $louvores.length > 0 && $page.url.search && !sharedLinkProcessed) {
      const urlParams = new URLSearchParams($page.url.search);
      if (urlParams.has('sharepdfs')) {
        handleSharedPlaylistLink();
      }
    }
  }
  
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
    if (searchUrlUpdateTimer) {
      clearTimeout(searchUrlUpdateTimer);
      searchUrlUpdateTimer = null;
    }
    searchQuery = '';
    filteredResults = [];
    // Atualizar URL imediatamente ao limpar
    if (browser && !isUpdatingFromUrl) {
      updateUrlParams({ pesquisa: '' });
    }
  }
  
  function filterLouvores() {
    if (!$louvores || $louvores.length === 0) {
      filteredResults = [];
      return;
    }
    
    // First, apply category filter (with inclusive logic for Cifra)
    const activeCategories = $filters;
    const allCategoriesSelected = activeCategories.length === CATEGORY_OPTIONS.length;
    
    // If no categories selected, show nothing (not all)
    if (activeCategories.length === 0) {
      filteredResults = [];
      return;
    }
    
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
    
    // If no classification filters selected, show nothing (not all)
    if (selectedFilters.length === 0) {
      filteredResults = [];
      return;
    }
    
    let classificationFiltered = categoryFiltered;
    
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
  $: if (searchQuery !== undefined && !isUpdatingFromUrl && browser) {
    $filters;
    $classificationFilters;
    
    // Limpar timer anterior se existir
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    
    // Criar novo timer para executar a pesquisa após 300ms
    debounceTimer = setTimeout(() => {
      filterLouvores();
    }, 300);
    
    // Atualizar URL com debounce também (500ms para evitar muitas atualizações)
    // Só atualiza se o valor for diferente do que está na URL
    if (searchUrlUpdateTimer) {
      clearTimeout(searchUrlUpdateTimer);
    }
    searchUrlUpdateTimer = setTimeout(() => {
      if (!isUpdatingFromUrl) {
        const urlParams = parseUrlParams($page.url);
        const urlPesquisa = (urlParams.pesquisa || '').trim();
        const currentPesquisa = (searchQuery || '').trim();
        
        // Só atualiza a URL se o valor realmente mudou
        if (urlPesquisa !== currentPesquisa) {
          isUpdatingFromUrl = true;
          updateUrlParams({ pesquisa: searchQuery });
          // Resetar flag após um pequeno delay para permitir que a URL seja atualizada
          setTimeout(() => {
            isUpdatingFromUrl = false;
          }, 100);
        }
      }
    }, 500);
  } else if (!browser) {
    // No servidor, executar diretamente
    filterLouvores();
  }
  
  // Initialize filters with all classifications on first load if URL doesn't have arranjo param
  // Esta lógica funciona como backup caso o onMount não execute ou os dados estejam prontos antes
  // Usa flag para garantir que só inicialize uma vez, permitindo que usuário desselecione depois
  $: if ($louvores.length > 0 && $louvoresLoaded && !filtersInitialized && browser && $page && $page.url) {
    // Usar a mesma função de inicialização para garantir consistência
    initializeFiltersIfNeeded();
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
    <CategoryFilters />
    
    <ClassificationFilters availableClassifications={$louvores.map(l => l.classificacao).filter(c => c)} />
    
    <PdfViewerSelector />
    
    <CarouselChips />
    
    <SearchBar bind:searchQuery on:clear={handleClear} />
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
      <p class="text-center mt-8 no-results-message">Nenhum resultado encontrado.</p>
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
  
  .no-results-message {
    color: var(--text-light);
    opacity: 0.9;
  }
</style>

