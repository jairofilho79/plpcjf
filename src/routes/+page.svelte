<script>
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { get } from 'svelte/store';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { louvores, loadLouvores, louvoresLoaded } from '$lib/stores/louvores';
  import { filters, CATEGORY_OPTIONS } from '$lib/stores/filters';
  import { classificationFilters } from '$lib/stores/classificationFilters';
  import { pdfViewer } from '$lib/stores/pdfViewer';
  import { carousel } from '$lib/stores/carousel';
  import { savedPlaylists } from '$lib/stores/savedPlaylists';
  import { bibliotecaItemsPerPage, VALID_OPTIONS } from '$lib/stores/bibliotecaItemsPerPage';
  import { parseUrlParams, updateUrlParams } from '$lib/utils/urlSync';
  import { prepareSearchQuery, louvorRowMatchesPreparedSearch } from '$lib/utils/louvorSearch';
  import SearchBar from '$lib/components/SearchBar.svelte';
  import CategoryFilters from '$lib/components/CategoryFilters.svelte';
  import ClassificationFilters from '$lib/components/ClassificationFilters.svelte';
  import PdfViewerSelector from '$lib/components/PdfViewerSelector.svelte';
  import LouvorCard from '$lib/components/LouvorCard.svelte';
  import CarouselChips from '$lib/components/CarouselChips.svelte';
  import LouvorPaginationControls from '$lib/components/LouvorPaginationControls.svelte';

  /** Em conjunto com `id` em SearchBar.svelte — só esse input bloqueia sync URL → pesquisa */
  const LOUVOR_SEARCH_INPUT_ID = 'louvor-search-input';
  
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

  let currentPage = 1;
  let pageInput = '1';
  let isUpdatingPageFromUrl = false;
  let isUpdatingItemsPerPageFromUrl = false;
  let homeUrlSyncInitialized = false;
  /** @type {{ itensPorPagina: number; pagina: number }} */
  let lastKnownHomeUrl = { itensPorPagina: 10, pagina: 1 };
  let pageInitializedFromUrl = false;

  /** @type {any[]} */
  let paginatedResults = [];

  /**
   * @param {any[]} results
   */
  function finalizeFilteredResults(results) {
    filteredResults = results;
    const ipp = get(bibliotecaItemsPerPage);
    const maxP = results.length === 0 ? 1 : Math.max(1, Math.ceil(results.length / ipp));
    if (!pageInitializedFromUrl) {
      currentPage = 1;
      pageInput = '1';
      if (browser && homeUrlSyncInitialized && $page?.url?.pathname === '/' && !isUpdatingFromUrl) {
        updateUrlParams({ pagina: 1 });
        lastKnownHomeUrl = { ...lastKnownHomeUrl, pagina: 1 };
      }
    } else if (currentPage > maxP) {
      currentPage = maxP;
      pageInput = String(maxP);
      if (browser && homeUrlSyncInitialized && $page?.url?.pathname === '/' && !isUpdatingFromUrl) {
        updateUrlParams({ pagina: maxP });
        lastKnownHomeUrl = { ...lastKnownHomeUrl, pagina: maxP };
      }
    }
  }

  /**
   * @param {number} p
   * @param {{ scroll?: boolean; skipUrlUpdate?: boolean }} [opts]
   */
  function setPage(p, { scroll = true, skipUrlUpdate = false } = {}) {
    const ipp = get(bibliotecaItemsPerPage);
    const tp = filteredResults.length === 0 ? 1 : Math.max(1, Math.ceil(filteredResults.length / ipp));
    const maxPage = tp > 0 ? tp : 1;
    const pageNum = Math.max(1, Math.min(maxPage, p));
    currentPage = pageNum;
    pageInput = pageNum.toString();
    if (browser && !skipUrlUpdate && !isUpdatingPageFromUrl && homeUrlSyncInitialized && $page?.url?.pathname === '/') {
      updateUrlParams({ pagina: pageNum });
      lastKnownHomeUrl = { ...lastKnownHomeUrl, pagina: pageNum };
    }
    if (scroll && tp > 0 && browser) {
      document.getElementById('home-louvores-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function scrollHomeResultsTop() {
    if (browser) {
      document.getElementById('home-louvores-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  
  // Reagir a mudanças na URL para atualizar searchQuery
  // Só atualiza se o valor da URL for diferente do valor atual (normalizado)
  // E não atualiza se o campo de pesquisa estiver focado (usuário está digitando)
  $: if (browser && !isUpdatingFromUrl && $page && $page.url) {
    const urlParams = parseUrlParams($page.url);
    const urlPesquisa = (urlParams.pesquisa || '').trim();
    const currentPesquisa = (searchQuery || '').trim();
    
    const el = document.activeElement;
    const searchInputFocused =
      el instanceof HTMLInputElement && el.id === LOUVOR_SEARCH_INPUT_ID;
    
    if (urlPesquisa !== currentPesquisa && !searchInputFocused) {
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
  
  /**
   * @param {CustomEvent<{ value: number }>} e
   */
  function handleHomeItemsPerPage(e) {
    bibliotecaItemsPerPage.set(e.detail.value);
    setPage(1, { scroll: false });
    scrollHomeResultsTop();
  }

  /**
   * @param {CustomEvent<{ page: number; scroll?: boolean }>} e
   */
  function handleHomePaginationPage(e) {
    setPage(e.detail.page, { scroll: e.detail.scroll !== false });
  }

  onMount(async () => {
    await loadLouvores();
    
    if (browser) {
      if ($page.url.pathname === '/') {
        const hp = parseUrlParams($page.url);
        const urlIpp =
          hp.itensPorPagina !== null && VALID_OPTIONS.includes(hp.itensPorPagina)
            ? hp.itensPorPagina
            : 10;
        const urlPag = hp.pagina !== null && hp.pagina > 0 ? hp.pagina : 1;
        lastKnownHomeUrl = { itensPorPagina: urlIpp, pagina: urlPag };
        if (hp.itensPorPagina !== null && VALID_OPTIONS.includes(hp.itensPorPagina)) {
          isUpdatingItemsPerPageFromUrl = true;
          bibliotecaItemsPerPage.set(hp.itensPorPagina);
          setTimeout(() => {
            isUpdatingItemsPerPageFromUrl = false;
          }, 0);
        }
        if (urlPag > 1) {
          pageInitializedFromUrl = true;
        }
        currentPage = urlPag;
        pageInput = String(urlPag);
        setTimeout(() => {
          pageInitializedFromUrl = false;
        }, 600);
      }
      homeUrlSyncInitialized = true;

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
    currentPage = 1;
    pageInput = '1';
    pageInitializedFromUrl = false;
    // Atualizar URL imediatamente ao limpar
    if (browser && !isUpdatingFromUrl) {
      updateUrlParams({ pesquisa: '', pagina: 1 });
      lastKnownHomeUrl = { ...lastKnownHomeUrl, pagina: 1 };
    }
  }
  
  function filterLouvores() {
    if (!$louvores || $louvores.length === 0) {
      finalizeFilteredResults([]);
      return;
    }
    
    // First, apply category filter (with inclusive logic for Cifra)
    const activeCategories = $filters;
    const allCategoriesSelected = activeCategories.length === CATEGORY_OPTIONS.length;
    
    // If no categories selected, show nothing (not all)
    if (activeCategories.length === 0) {
      finalizeFilteredResults([]);
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
      finalizeFilteredResults([]);
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
      finalizeFilteredResults([]);
      return;
    }
    
    if (!isNaN(Number(searchQuery))) {
      finalizeFilteredResults(
        classificationFiltered.filter(louvor => Number(louvor.numero) === Number(searchQuery))
      );
      return;
    }
    
    const prepared = prepareSearchQuery(searchQuery);
    finalizeFilteredResults(
      classificationFiltered.filter((louvor) => louvorRowMatchesPreparedSearch(louvor, prepared))
    );
  }

  $: itemsPerPageHome = $bibliotecaItemsPerPage;
  $: totalPagesHome =
    filteredResults.length === 0 ? 1 : Math.max(1, Math.ceil(filteredResults.length / itemsPerPageHome));
  $: paginatedResults = filteredResults.slice(
    (currentPage - 1) * itemsPerPageHome,
    currentPage * itemsPerPageHome
  );

  $: if (
    browser &&
    homeUrlSyncInitialized &&
    !isUpdatingFromUrl &&
    !isUpdatingItemsPerPageFromUrl &&
    !isUpdatingPageFromUrl &&
    $page?.url?.pathname === '/' &&
    $page?.url
  ) {
    const urlParams = parseUrlParams($page.url);
    const urlIpp =
      urlParams.itensPorPagina !== null && VALID_OPTIONS.includes(urlParams.itensPorPagina)
        ? urlParams.itensPorPagina
        : 10;
    const urlPag = urlParams.pagina !== null && urlParams.pagina > 0 ? urlParams.pagina : 1;
    if (lastKnownHomeUrl.itensPorPagina !== urlIpp || lastKnownHomeUrl.pagina !== urlPag) {
      lastKnownHomeUrl = { itensPorPagina: urlIpp, pagina: urlPag };
      if (
        urlParams.itensPorPagina !== null &&
        VALID_OPTIONS.includes(urlParams.itensPorPagina) &&
        urlIpp !== get(bibliotecaItemsPerPage)
      ) {
        isUpdatingItemsPerPageFromUrl = true;
        bibliotecaItemsPerPage.set(urlIpp);
        setTimeout(() => {
          isUpdatingItemsPerPageFromUrl = false;
        }, 100);
      }
      if (urlPag !== currentPage) {
        isUpdatingPageFromUrl = true;
        currentPage = urlPag;
        pageInput = String(urlPag);
        setTimeout(() => {
          isUpdatingPageFromUrl = false;
        }, 100);
      }
    }
  }

  $: if (
    browser &&
    homeUrlSyncInitialized &&
    !isUpdatingItemsPerPageFromUrl &&
    $page?.url?.pathname === '/' &&
    $page?.url
  ) {
    const urlParams = parseUrlParams($page.url);
    const urlIpp =
      urlParams.itensPorPagina !== null && VALID_OPTIONS.includes(urlParams.itensPorPagina)
        ? urlParams.itensPorPagina
        : 10;
    if (urlIpp !== $bibliotecaItemsPerPage) {
      updateUrlParams({ itensPorPagina: $bibliotecaItemsPerPage });
      lastKnownHomeUrl = { ...lastKnownHomeUrl, itensPorPagina: $bibliotecaItemsPerPage };
    }
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
  
  <div id="home-louvores-results" class="mt-8 flex justify-center">
    {#if filteredResults.length > 0}
      <div class="louvores-container w-full max-w-4xl">
        <span class="container-tag">Louvores</span>

        <LouvorPaginationControls
          variant="top"
          bind:pageInput
          currentPage={currentPage}
          totalPages={totalPagesHome}
          itemsPerPage={itemsPerPageHome}
          on:itemsPerPage={handleHomeItemsPerPage}
          on:gotoPage={handleHomePaginationPage}
          on:previous={() => currentPage > 1 && setPage(currentPage - 1)}
          on:next={() => currentPage < totalPagesHome && setPage(currentPage + 1)}
          on:first={() => setPage(1)}
          on:last={() => setPage(totalPagesHome)}
        />

        <div class="louvores-list">
          {#each paginatedResults as louvor (getLouvorKey(louvor))}
            <LouvorCard {louvor} />
          {/each}
        </div>

        <LouvorPaginationControls
          variant="bottom"
          bind:pageInput
          currentPage={currentPage}
          totalPages={totalPagesHome}
          itemsPerPage={itemsPerPageHome}
          on:itemsPerPage={handleHomeItemsPerPage}
          on:gotoPage={handleHomePaginationPage}
          on:previous={() => currentPage > 1 && setPage(currentPage - 1)}
          on:next={() => currentPage < totalPagesHome && setPage(currentPage + 1)}
          on:first={() => setPage(1)}
          on:last={() => setPage(totalPagesHome)}
        />
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
    margin-top: 1.5rem;
    margin-bottom: 1.5rem;
  }
  
  .no-results-message {
    color: var(--text-light);
    opacity: 0.9;
  }
</style>

