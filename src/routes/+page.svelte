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

  /** Última pesquisa aplicada em filterLouvores; mudança explícita de texto zera paginação de deep link. */
  /** @type {string | null} */
  let lastSearchAppliedInFilter = null;
  /** @type {string | null} */
  let lastFilterCriteriaKey = null;
  let shouldResetPageOnFilterResult = false;

  /** @type {any[]} */
  let paginatedResults = [];
  let filtersExpanded = false;

  /**
   * @param {any[]} results
   */
  function finalizeFilteredResults(results) {
    filteredResults = results;
    const ipp = get(bibliotecaItemsPerPage);
    const maxP = results.length === 0 ? 1 : Math.max(1, Math.ceil(results.length / ipp));
    if (shouldResetPageOnFilterResult) {
      // #region agent log
      fetch('http://127.0.0.1:7440/ingest/a9d50c94-866c-49ac-b737-468ccc2df6c6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8c7e1b'},body:JSON.stringify({sessionId:'8c7e1b',runId:'post-fix',hypothesisId:'H5',location:'src/routes/+page.svelte:finalizeFilteredResults:resetToFirstPage',message:'finalizeFilteredResults reset page because criteria changed',data:{resultsLength:results.length,itemsPerPage:ipp,maxPage:maxP,currentPageBeforeReset:currentPage,pageInitializedFromUrl,searchQuery,urlHref:browser && $page?.url ? $page.url.href : ''},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      currentPage = 1;
      pageInput = '1';
      shouldResetPageOnFilterResult = false;
      if (browser && homeUrlSyncInitialized && $page?.url?.pathname === '/' && !isUpdatingFromUrl) {
        // #region agent log
        fetch('http://127.0.0.1:7440/ingest/a9d50c94-866c-49ac-b737-468ccc2df6c6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8c7e1b'},body:JSON.stringify({sessionId:'8c7e1b',runId:'post-fix',hypothesisId:'H5',location:'src/routes/+page.svelte:finalizeFilteredResults:updateUrlPage1',message:'finalizeFilteredResults writing pagina=1 to URL',data:{searchQuery,currentPage,urlHref:browser && $page?.url ? $page.url.href : ''},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
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
    const pageHrefBeforeUpdate = browser && $page?.url ? $page.url.href : '';
    currentPage = pageNum;
    pageInput = pageNum.toString();
    if (browser && !skipUrlUpdate && !isUpdatingPageFromUrl && homeUrlSyncInitialized && $page?.url?.pathname === '/') {
      // #region agent log
      fetch('http://127.0.0.1:7440/ingest/a9d50c94-866c-49ac-b737-468ccc2df6c6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8c7e1b'},body:JSON.stringify({sessionId:'8c7e1b',runId:'initial',hypothesisId:'H1',location:'src/routes/+page.svelte:setPage:beforeUpdateUrlParams',message:'setPage requested URL update',data:{requestedPage:p,appliedPage:pageNum,currentPageBeforeUrlWrite:currentPage,pageHrefBeforeUpdate,skipUrlUpdate,isUpdatingPageFromUrl,homeUrlSyncInitialized},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      isUpdatingPageFromUrl = true;
      lastKnownHomeUrl = { ...lastKnownHomeUrl, pagina: pageNum };
      updateUrlParams({ pagina: pageNum });
      setTimeout(() => {
        isUpdatingPageFromUrl = false;
      }, 100);
      // #region agent log
      fetch('http://127.0.0.1:7440/ingest/a9d50c94-866c-49ac-b737-468ccc2df6c6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8c7e1b'},body:JSON.stringify({sessionId:'8c7e1b',runId:'initial',hypothesisId:'H1',location:'src/routes/+page.svelte:setPage:afterUpdateUrlParams',message:'setPage dispatched URL update',data:{appliedPage:pageNum,lastKnownPage:lastKnownHomeUrl.pagina,pagePathname:$page?.url?.pathname || ''},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
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

  /** Mantém `pagina` na URL ao sincronizar pesquisa (evita reset para página 1). */
  function homeSearchUrlParams(pesquisa) {
    return currentPage > 1 ? { pesquisa, pagina: currentPage } : { pesquisa };
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
    // #region agent log
    fetch('http://127.0.0.1:7440/ingest/a9d50c94-866c-49ac-b737-468ccc2df6c6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8c7e1b'},body:JSON.stringify({sessionId:'8c7e1b',runId:'initial-r2',hypothesisId:'H6',location:'src/routes/+page.svelte:handleHomePaginationPage',message:'pagination control requested page change',data:{requestedPage:e?.detail?.page ?? null,currentPageBeforeSetPage:currentPage,pageInputBeforeSetPage:pageInput,urlHref:browser && $page?.url ? $page.url.href : ''},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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
  
  /**
   * Ao sair do campo de pesquisa, sincroniza a URL imediatamente.
   * Evita que o bloco reativo URL → searchQuery aplique `pesquisa` vazio da URL
   * enquanto o debounce de 500ms ainda não gravou o texto digitado.
   */
  function flushSearchToUrlOnBlur() {
    if (!browser || !$page?.url || $page.url.pathname !== '/') return;
    if (searchUrlUpdateTimer) {
      clearTimeout(searchUrlUpdateTimer);
      searchUrlUpdateTimer = null;
    }
    const urlParams = parseUrlParams($page.url);
    const urlPesquisa = (urlParams.pesquisa || '').trim();
    const currentPesquisa = (searchQuery || '').trim();
    if (urlPesquisa === currentPesquisa) return;
    // #region agent log
    fetch('http://127.0.0.1:7440/ingest/a9d50c94-866c-49ac-b737-468ccc2df6c6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8c7e1b'},body:JSON.stringify({sessionId:'8c7e1b',runId:'initial',hypothesisId:'H2',location:'src/routes/+page.svelte:flushSearchToUrlOnBlur:beforeUpdateUrlParams',message:'blur is forcing search URL sync',data:{urlPesquisa,currentPesquisa,currentPage,pageHref:$page.url.href,lastKnownHomeUrlPage:lastKnownHomeUrl.pagina},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    isUpdatingFromUrl = true;
    updateUrlParams(homeSearchUrlParams(searchQuery));
    // #region agent log
    fetch('http://127.0.0.1:7440/ingest/a9d50c94-866c-49ac-b737-468ccc2df6c6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8c7e1b'},body:JSON.stringify({sessionId:'8c7e1b',runId:'initial',hypothesisId:'H2',location:'src/routes/+page.svelte:flushSearchToUrlOnBlur:afterUpdateUrlParams',message:'blur dispatched search URL sync',data:{currentPage,lastKnownHomeUrlPage:lastKnownHomeUrl.pagina,searchQuery},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    setTimeout(() => {
      isUpdatingFromUrl = false;
    }, 0);
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
    const qNow = (searchQuery || '').trim();
    const categoriesKey = [...$filters].sort().join('|');
    const classificationsKey = [...$classificationFilters].sort().join('|');
    const criteriaKey = `${qNow}::${categoriesKey}::${classificationsKey}`;

    if (lastFilterCriteriaKey !== null && criteriaKey !== lastFilterCriteriaKey) {
      shouldResetPageOnFilterResult = true;
      pageInitializedFromUrl = false;
      // #region agent log
      fetch('http://127.0.0.1:7440/ingest/a9d50c94-866c-49ac-b737-468ccc2df6c6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8c7e1b'},body:JSON.stringify({sessionId:'8c7e1b',runId:'post-fix',hypothesisId:'H8',location:'src/routes/+page.svelte:filterLouvores:criteriaChanged',message:'filter criteria changed; scheduling page reset',data:{criteriaKey,lastCriteriaKey:lastFilterCriteriaKey,currentPage,searchQuery},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    }
    lastFilterCriteriaKey = criteriaKey;

    if (lastSearchAppliedInFilter !== null && qNow !== lastSearchAppliedInFilter) {
      pageInitializedFromUrl = false;
    }
    lastSearchAppliedInFilter = qNow;

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
        // #region agent log
        fetch('http://127.0.0.1:7440/ingest/a9d50c94-866c-49ac-b737-468ccc2df6c6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8c7e1b'},body:JSON.stringify({sessionId:'8c7e1b',runId:'initial',hypothesisId:'H3',location:'src/routes/+page.svelte:reactiveUrlSync:applyUrlPage',message:'URL sync is overriding in-memory currentPage',data:{urlPag,currentPageBeforeSync:currentPage,urlHref:$page.url.href,lastKnownHomeUrlPage:lastKnownHomeUrl.pagina,isUpdatingFromUrl,isUpdatingItemsPerPageFromUrl,isUpdatingPageFromUrl},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
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
          // #region agent log
          fetch('http://127.0.0.1:7440/ingest/a9d50c94-866c-49ac-b737-468ccc2df6c6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8c7e1b'},body:JSON.stringify({sessionId:'8c7e1b',runId:'initial-r2',hypothesisId:'H7',location:'src/routes/+page.svelte:searchDebounce:writePesquisa',message:'search debounce writing URL params',data:{urlPesquisa,currentPesquisa,pageInitializedFromUrl,urlHref:browser && $page?.url ? $page.url.href : ''},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          isUpdatingFromUrl = true;
          updateUrlParams(homeSearchUrlParams(searchQuery));
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
    <div class="w-full max-w-4xl p-4 bg-card-color rounded-lg border-2 filter-collapse-outer">
      <span class="filter-collapse-tag">Filtros</span>
      <div class="filter-collapse-select-wrapper">
        <button
          type="button"
          class="filter-collapse-trigger"
          aria-expanded={filtersExpanded}
          aria-controls={filtersExpanded ? 'home-filters-panel' : undefined}
          on:click={() => (filtersExpanded = !filtersExpanded)}
        >
          <span class="filter-collapse-title">
            {filtersExpanded ? 'Toque para ver menos' : 'Toque para ver mais'}
          </span>
          <svg
            class="filter-collapse-chevron-svg"
            class:expanded={filtersExpanded}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              stroke="var(--gold-color)"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="m6 9 6 6 6-6"
            />
          </svg>
        </button>
      </div>

      {#if filtersExpanded}
        <div id="home-filters-panel" class="filter-expanded-panel">
          <CategoryFilters />
          <ClassificationFilters availableClassifications={$louvores.map(l => l.classificacao).filter(c => c)} />
        </div>
      {/if}
    </div>
    
    <PdfViewerSelector />
    
    <CarouselChips />
    
    <SearchBar bind:searchQuery on:clear={handleClear} on:blur={flushSearchToUrlOnBlur} />
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

  /* Mesmo padrão visual de PdfViewerSelector (tag + área interna estilo select) */
  .filter-collapse-outer {
    border-color: var(--gold-color);
    color: var(--text-dark);
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .filter-collapse-tag {
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

  .filter-collapse-select-wrapper {
    position: relative;
    width: 100%;
  }

  .filter-collapse-trigger {
    width: 100%;
    min-height: 2.5rem;
    padding: 0.5rem 0.875rem;
    border-radius: 0.75rem;
    border: 2px solid var(--gold-color);
    background-color: #ffffff;
    color: var(--title-color);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1.2;
    cursor: pointer;
    transition: box-shadow 0.2s ease, border-color 0.2s ease;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .filter-collapse-trigger:hover {
    border-color: var(--title-color);
  }

  .filter-collapse-trigger:focus-visible {
    outline: none;
    border-color: var(--gold-color);
    box-shadow: 0 0 0 3px rgba(212, 175, 55, 0.3);
  }

  .filter-collapse-title {
    text-align: left;
  }

  .filter-collapse-chevron-svg {
    flex-shrink: 0;
    width: 1rem;
    height: 1rem;
    transition: transform 0.2s ease;
  }

  .filter-collapse-chevron-svg.expanded {
    transform: rotate(180deg);
  }

  .filter-expanded-panel {
    margin-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
</style>

