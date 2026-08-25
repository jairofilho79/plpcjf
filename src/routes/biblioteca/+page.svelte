<script>
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { louvores, loadLouvores, louvoresLoaded, forceRefreshLouvoresFromNetwork } from '$lib/stores/louvores';
  import { classificationFilters } from '$lib/stores/classificationFilters';
  import { filters, CATEGORY_OPTIONS } from '$lib/stores/filters';
  import { bibliotecaSort } from '$lib/stores/bibliotecaSort';
  import { bibliotecaItemsPerPage, VALID_OPTIONS } from '$lib/stores/bibliotecaItemsPerPage';
  import { pdfViewer } from '$lib/stores/pdfViewer';
  import { parseUrlParams, updateUrlParams } from '$lib/utils/urlSync';
  import ClassificationFilters from '$lib/components/ClassificationFilters.svelte';
  import SpecialArrangementFilters from '$lib/components/SpecialArrangementFilters.svelte';
  import CategoryFilters from '$lib/components/CategoryFilters.svelte';
  import SortSelector from '$lib/components/SortSelector.svelte';
  import PdfViewerSelector from '$lib/components/PdfViewerSelector.svelte';
  import LouvorCard from '$lib/components/LouvorCard.svelte';
  import GestureButton from '$lib/components/GestureButton.svelte';
  import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-svelte';
  import { groupLouvoresByGroupId } from '$lib/utils/groupLouvores.js';

  /** @type {boolean} */
  let isOnline = browser ? navigator.onLine : true;
  let catalogRefreshing = false;

  function updateOnlineStatus() {
    if (browser) {
      isOnline = navigator.onLine;
    }
  }

  async function handleRefreshBancoLouvores() {
    if (catalogRefreshing) return;
    catalogRefreshing = true;
    try {
      await forceRefreshLouvoresFromNetwork();
    } finally {
      catalogRefreshing = false;
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

  // Extract special arrangement text from parentheses, or return "Padrão"
  /**
   * @param {string} classification
   * @param {string[]} baseNormalizedList
   */
  function extractSpecialArrangement(classification, baseNormalizedList) {
    if (!classification) return null;
    
    // Check if this classification matches any of the base normalized classifications
    const normalized = normalizeClassification(classification);
    if (!baseNormalizedList.includes(normalized)) return null;
    
    // Extract text from parentheses
    const match = classification.match(/\(([^)]+)\)/);
    if (match && match[1]) {
      return match[1].trim();
    }
    
    // No parentheses found, return "Padrão"
    return 'Padrão';
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

  // Selected classifications (Arranjo)
  $: selectedClassifications = $classificationFilters;

  // Calculate available special arrangements based on selected classifications
  $: availableSpecialArrangements = (() => {
    if (selectedClassifications.length === 0 || !classificationFilteredLouvores || classificationFilteredLouvores.length === 0) {
      return [];
    }

    const specialArrangements = new Set();
    
    for (const louvor of classificationFilteredLouvores) {
      if (!louvor.classificacao) continue;
      
      const special = extractSpecialArrangement(louvor.classificacao, selectedClassifications);
      if (special !== null) {
        specialArrangements.add(special);
      }
    }
    
    // Sort and ensure "Padrão" is always first
    const sorted = Array.from(specialArrangements).sort();
    const padraoIndex = sorted.indexOf('Padrão');
    if (padraoIndex > 0) {
      // Remove "Padrão" from its current position and add it at the beginning
      sorted.splice(padraoIndex, 1);
      sorted.unshift('Padrão');
    }
    // If padraoIndex === 0, it's already first, no action needed
    // If padraoIndex === -1, "Padrão" is not in the list (all items have parentheses), no action needed
    
    return sorted;
  })();

  // Filter louvores based on selected categories (inclusive filter for Cifra)
  // If no categories selected, show nothing. If all categories selected, keep all louvores
  $: categoryFilteredLouvores = (() => {
    if (!$louvores || $louvores.length === 0) return [];

    const activeCategories = $filters;
    const allCategoriesSelected = activeCategories.length === CATEGORY_OPTIONS.length;

    // If no categories selected, show nothing (not all)
    if (activeCategories.length === 0) {
      return [];
    }

    if (allCategoriesSelected) {
      return $louvores;
    }

    // Expand "Cifra" to include "Cifra nível I" and "Cifra nível II"
    const expandedCategories = expandCategoryFilter(activeCategories);
    return $louvores.filter(louvor => {
      if (!louvor.categoria) return false;
      return expandedCategories.includes(louvor.categoria);
    });
  })();

  // Filter louvores based on Arranjo (classificação normalizada)
  // If no filters selected, show nothing. If all filters selected, show all category-filtered louvores
  $: classificationFilteredLouvores = (() => {
    if (!categoryFilteredLouvores || categoryFilteredLouvores.length === 0) return [];

    const selectedFilters = $classificationFilters;

    // If no classification filters selected, show nothing (not all)
    if (selectedFilters.length === 0) {
      return [];
    }

    // If all unique normalized classifications are selected, return category-filtered results
    const allSelected =
      uniqueNormalizedClassifications.length > 0 &&
      selectedFilters.length === uniqueNormalizedClassifications.length &&
      uniqueNormalizedClassifications.every(c => selectedFilters.includes(c));

    if (allSelected) {
      return categoryFilteredLouvores;
    }

    // Otherwise, filter by selected classifications
    return categoryFilteredLouvores.filter(louvor => {
      if (!louvor.classificacao) return false;
      const normalized = normalizeClassification(louvor.classificacao);
      return selectedFilters.includes(normalized);
    });
  })();

  // State for selected special arrangements - inicializar da URL
  /**
   * @type {string[]}
   */
  let selectedSpecialArrangements = browser && $page && $page.url ? (parseUrlParams($page.url).arranjoEspecial || []) : [];
  let isUpdatingArranjoEspecialFromUrl = false;

  // Reset special arrangements when selected classifications change significantly
  let previousSelectedClassifications = [];
  $: {
    // Reset if classifications changed significantly (different set of items)
    const currentSet = new Set(selectedClassifications);
    const previousSet = new Set(previousSelectedClassifications);
    
    // Check if sets are different (not just reordered)
    if (currentSet.size !== previousSet.size || 
        !Array.from(currentSet).every(c => previousSet.has(c))) {
      // Keep only valid selections
      selectedSpecialArrangements = selectedSpecialArrangements.filter(sa => 
        availableSpecialArrangements.includes(sa)
      );
      previousSelectedClassifications = [...selectedClassifications];
    }
  }

  // Track previous available arrangements length to detect appearance/disappearance
  let previousAvailableLength = 0;
  let specialArrangementsInitialized = false;

  // Reagir a mudanças na URL para atualizar selectedSpecialArrangements
  $: if (browser && !isUpdatingArranjoEspecialFromUrl && $page && $page.url) {
    const urlParams = parseUrlParams($page.url);
    const urlArranjoEspecial = urlParams.arranjoEspecial || [];
    // Só atualizar se for diferente e se os valores da URL são válidos (existem em availableSpecialArrangements)
    if (urlArranjoEspecial.length > 0 && availableSpecialArrangements.length > 0) {
      const validFromUrl = urlArranjoEspecial.filter(sa => availableSpecialArrangements.includes(sa));
      if (JSON.stringify(validFromUrl.sort()) !== JSON.stringify(selectedSpecialArrangements.sort())) {
        isUpdatingArranjoEspecialFromUrl = true;
        selectedSpecialArrangements = validFromUrl;
        specialArrangementsInitialized = true; // Se veio da URL, marcar como inicializado
        isUpdatingArranjoEspecialFromUrl = false;
      }
    } else if (urlArranjoEspecial.length === 0 && selectedSpecialArrangements.length > 0 && $page.pathname === '/biblioteca') {
      // Se URL não tem arranjoEspecial, manter seleção atual (não limpar automaticamente)
      // A lógica abaixo vai lidar com auto-seleção quando disponível
    }
  }

  // Clear special arrangements when they become unavailable
  // Auto-select all when they become available (só se não vier da URL e não foi inicializado ainda)
  $: {
    const currentLength = availableSpecialArrangements.length;
    
    if (currentLength === 0) {
      // Clear selections when component disappears
      if (!isUpdatingArranjoEspecialFromUrl && selectedSpecialArrangements.length > 0) {
        isUpdatingArranjoEspecialFromUrl = true;
        selectedSpecialArrangements = [];
        specialArrangementsInitialized = false; // Reset flag quando desaparece
        isUpdatingArranjoEspecialFromUrl = false;
        if (browser) {
          updateUrlParams({ arranjoEspecial: [] });
        }
      }
    } else if (currentLength > 0 && previousAvailableLength === 0) {
      // Auto-select all when arrangements appear for the first time (só se não vier da URL e não foi inicializado)
      if (browser && !isUpdatingArranjoEspecialFromUrl && !specialArrangementsInitialized && $page && $page.url) {
        const urlParams = parseUrlParams($page.url);
        const urlHasArranjoEspecial = $page.url.search && $page.url.search.includes('arranjoEspecial=');
        
        // Se URL não tem arranjoEspecial e não há seleção, selecionar todos (só na primeira vez)
        if (!urlHasArranjoEspecial && selectedSpecialArrangements.length === 0 && availableSpecialArrangements.length > 0) {
          isUpdatingArranjoEspecialFromUrl = true;
          selectedSpecialArrangements = [...availableSpecialArrangements];
          specialArrangementsInitialized = true;
          isUpdatingArranjoEspecialFromUrl = false;
          updateUrlParams({ arranjoEspecial: selectedSpecialArrangements });
        } else if (urlHasArranjoEspecial) {
          // Se URL tem parâmetro, marcar como inicializado
          specialArrangementsInitialized = true;
        }
      }
    }
    
    previousAvailableLength = currentLength;
  }

  // Final filtered list (refined by Arranjo Especial if applicable)
  $: filteredLouvores = (() => {
    if (!classificationFilteredLouvores || classificationFilteredLouvores.length === 0) {
      return [];
    }

    // If no special arrangements selected, return all classification-filtered louvores
    if (selectedSpecialArrangements.length === 0) {
      return classificationFilteredLouvores;
    }

    // Filter by selected special arrangements
    return classificationFilteredLouvores.filter(louvor => {
      if (!louvor.classificacao || selectedClassifications.length === 0) return false;
      
      const special = extractSpecialArrangement(louvor.classificacao, selectedClassifications);
      if (special === null) return false;
      
      return selectedSpecialArrangements.includes(special);
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
  
  // Flags para evitar loops infinitos na sincronização URL
  let urlSyncInitialized = false;
  let isUpdatingSortFromUrl = false;
  let isUpdatingItemsPerPageFromUrl = false;
  let isUpdatingPageFromUrl = false;
  
  // Rastrear último estado conhecido da URL para evitar loops
  let lastKnownUrlState = {
    ordenar: null,
    itensPorPagina: null,
    pagina: null
  };

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
   * @param {{ scroll?: boolean, skipUrlUpdate?: boolean }} [options]
   */
  function setPage(page, { scroll = true, skipUrlUpdate = false } = {}) {
    const maxPage = totalPages > 0 ? totalPages : 1;
    const pageNum = Math.max(1, Math.min(maxPage, page));
    currentPage = pageNum;
    pageInput = pageNum.toString();

    // Atualizar URL quando a página mudar (se não estiver vindo da URL e sincronização inicializada)
    if (browser && !skipUrlUpdate && !isUpdatingPageFromUrl && urlSyncInitialized) {
      updateUrlParams({ pagina: pageNum });
    }

    if (scroll && totalPages > 0) {
      scrollToLouvores();
    }
  }

  $: itemsPerPage = $bibliotecaItemsPerPage;
  $: groupedLouvores = groupLouvoresByGroupId(sortedLouvores);
  $: totalPages = Math.ceil(groupedLouvores.length / itemsPerPage);
  $: paginatedLouvores = groupedLouvores.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );
  
  // Reset to page 1 when items per page changes
  $: {
    if (itemsPerPage && urlSyncInitialized && !pageInitializedFromUrl) {
      const newTotalPages = Math.ceil(groupedLouvores.length / itemsPerPage);
      if (currentPage > newTotalPages && newTotalPages > 0) {
        setPage(1, { scroll: false });
      }
    }
  }
  
  // Reset to page 1 when filters change or when current page exceeds total pages
  let previousFilteredCount = 0;
  let pageInitializedFromUrl = false;
  $: {
    if (urlSyncInitialized && totalPages > 0) {
      const currentFilteredCount = filteredLouvores.length;
      // Se ainda não inicializamos previousFilteredCount, fazer isso agora (primeira execução)
      if (previousFilteredCount === 0 && currentFilteredCount > 0) {
        previousFilteredCount = currentFilteredCount;
        // Se a página foi inicializada da URL, verificar se é válida antes de resetar
        if (pageInitializedFromUrl) {
          // Se a página da URL é válida, manter; caso contrário, ajustar
          if (currentPage > totalPages) {
            setPage(totalPages, { scroll: false });
          }
        } else {
          // Se não foi inicializado da URL, pode resetar normalmente
          if (currentPage > totalPages) {
            setPage(totalPages, { scroll: false });
          }
        }
      } else {
        // Reset to page 1 if filtered results count changed significantly or current page is invalid
        // Mas não resetar se a página foi inicializada da URL e ainda é válida
        if (currentPage > totalPages) {
          setPage(totalPages, { scroll: false });
        } else if (previousFilteredCount !== 0 && previousFilteredCount !== currentFilteredCount && !pageInitializedFromUrl) {
          // Só resetar se não foi inicializado da URL e a contagem mudou significativamente
          setPage(1, { scroll: false });
        }
        previousFilteredCount = currentFilteredCount;
      }
    }
  }
  
  // Sincronizar URL -> Stores (apenas quando URL mudar externamente, não quando atualizamos nós mesmos)
  $: if (browser && urlSyncInitialized && !isUpdatingSortFromUrl && !isUpdatingItemsPerPageFromUrl && !isUpdatingPageFromUrl && $page && $page.url) {
    const urlParams = parseUrlParams($page.url);
    const urlOrdenar = urlParams.ordenar || 'numero';
    const urlItensPorPagina = urlParams.itensPorPagina || 10;
    const urlPagina = urlParams.pagina;
    const urlPageNum = urlPagina !== null && urlPagina > 0 ? urlPagina : 1;
    
    // Verificar se a URL realmente mudou (navegação back/forward ou mudança externa)
    // Comparar com o último estado conhecido para evitar loops
    const urlChanged = 
      lastKnownUrlState.ordenar !== urlOrdenar ||
      lastKnownUrlState.itensPorPagina !== urlItensPorPagina ||
      lastKnownUrlState.pagina !== urlPageNum;
    
    if (urlChanged) {
      // Verificar se os stores já estão com os valores corretos (evita sincronização desnecessária)
      const currentSort = $bibliotecaSort;
      const currentItemsPerPage = $bibliotecaItemsPerPage;
      const storesMatchUrl = 
        (urlOrdenar === currentSort || (!urlOrdenar && currentSort === 'numero')) &&
        (urlItensPorPagina === currentItemsPerPage || (!urlItensPorPagina && currentItemsPerPage === 10)) &&
        (urlPageNum === currentPage);
      
      // Se os stores já estão corretos, apenas atualizar último estado conhecido
      if (storesMatchUrl) {
        lastKnownUrlState = {
          ordenar: urlOrdenar,
          itensPorPagina: urlItensPorPagina,
          pagina: urlPageNum
        };
      } else {
        // Atualizar último estado conhecido ANTES de fazer qualquer mudança
        lastKnownUrlState = {
          ordenar: urlOrdenar,
          itensPorPagina: urlItensPorPagina,
          pagina: urlPageNum
        };
        
        // Sincronizar ordenar
        if (urlOrdenar !== currentSort && (urlOrdenar === 'numero' || urlOrdenar === 'nome')) {
          isUpdatingSortFromUrl = true;
          bibliotecaSort.set(urlOrdenar);
          setTimeout(() => {
            isUpdatingSortFromUrl = false;
          }, 100);
        }
        
        // Sincronizar itensPorPagina
        if (urlItensPorPagina !== currentItemsPerPage && VALID_OPTIONS.includes(urlItensPorPagina)) {
          isUpdatingItemsPerPageFromUrl = true;
          bibliotecaItemsPerPage.set(urlItensPorPagina);
          setTimeout(() => {
            isUpdatingItemsPerPageFromUrl = false;
          }, 100);
        }
        
        // Sincronizar pagina
        if (urlPageNum !== currentPage) {
          isUpdatingPageFromUrl = true;
          // Atualizar diretamente sem usar setPage para evitar limitação por totalPages
          // O setPage limita ao maxPage, mas quando sincronizando da URL, queremos o valor exato
          currentPage = urlPageNum;
          pageInput = urlPageNum.toString();
          setTimeout(() => {
            isUpdatingPageFromUrl = false;
          }, 100);
        }
      }
    }
  }
  
  // Atualizar URL quando bibliotecaSort mudar (apenas se não estiver vindo da URL)
  $: if (browser && urlSyncInitialized && !isUpdatingSortFromUrl && $bibliotecaSort && $page && $page.url) {
    const urlParams = parseUrlParams($page.url);
    const urlOrdenar = urlParams.ordenar || 'numero';
    if (urlOrdenar !== $bibliotecaSort) {
      updateUrlParams({ ordenar: $bibliotecaSort });
    }
  }
  
  // Atualizar URL quando bibliotecaItemsPerPage mudar (apenas se não estiver vindo da URL)
  $: if (browser && urlSyncInitialized && !isUpdatingItemsPerPageFromUrl && $bibliotecaItemsPerPage && $page && $page.url) {
    const urlParams = parseUrlParams($page.url);
    const urlItensPorPagina = urlParams.itensPorPagina || 10;
    if (urlItensPorPagina !== $bibliotecaItemsPerPage) {
      updateUrlParams({ itensPorPagina: $bibliotecaItemsPerPage });
    }
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
  
  function goToFirstPage() {
    if (totalPages > 0) {
      setPage(1);
    }
  }
  
  function goToLastPage() {
    if (totalPages > 0) {
      setPage(totalPages);
    }
  }
  
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
      // Usar setTimeout para garantir que não haja conflito com outras atualizações
      setTimeout(() => {
        if ($classificationFilters.length === 0 && classifications.length > 0) {
          classificationFilters.selectAll(classifications);
        }
      }, 0);
    } else if (urlHasArranjo || $classificationFilters.length > 0) {
      // Já tem parâmetro na URL ou já há filtros selecionados
      filtersInitialized = true;
    }
  }
  
  onMount(async () => {
    await loadLouvores();
    
    if (browser) {
      document.addEventListener('click', handleClickOutside);
      updateOnlineStatus();
      window.addEventListener('online', updateOnlineStatus);
      window.addEventListener('offline', updateOnlineStatus);

      // Inicializar valores da URL uma única vez
      if ($page && $page.url) {
        const urlParams = parseUrlParams($page.url);
        
        // Inicializar ordenar da URL
        const urlOrdenar = urlParams.ordenar;
        if (urlOrdenar && (urlOrdenar === 'numero' || urlOrdenar === 'nome')) {
          isUpdatingSortFromUrl = true;
          bibliotecaSort.set(urlOrdenar);
        }
        
        // Inicializar itensPorPagina da URL
        const urlItensPorPagina = urlParams.itensPorPagina;
        if (urlItensPorPagina !== null && VALID_OPTIONS.includes(urlItensPorPagina)) {
          isUpdatingItemsPerPageFromUrl = true;
          bibliotecaItemsPerPage.set(urlItensPorPagina);
        }
        
        // Inicializar pagina da URL
        const urlPagina = urlParams.pagina;
        const urlPageNum = urlPagina !== null && urlPagina > 0 ? urlPagina : 1;
        // Sempre inicializar da URL, mesmo se for página 1, para garantir consistência
        isUpdatingPageFromUrl = true;
        if (urlPageNum !== 1) {
          pageInitializedFromUrl = true;
        }
        // Atualizar diretamente sem usar setPage para evitar limitação por totalPages ainda não calculado
        currentPage = urlPageNum;
        pageInput = urlPageNum.toString();
        
        // Inicializar último estado conhecido
        lastKnownUrlState = {
          ordenar: urlOrdenar || 'numero',
          itensPorPagina: urlItensPorPagina !== null ? urlItensPorPagina : 10,
          pagina: urlPageNum
        };
        
        // Aguardar um pouco antes de habilitar sincronização bidirecional
        setTimeout(() => {
          isUpdatingSortFromUrl = false;
          isUpdatingItemsPerPageFromUrl = false;
          isUpdatingPageFromUrl = false;
          urlSyncInitialized = true;
          // Após um tempo, permitir que a lógica de reset funcione normalmente
          setTimeout(() => {
            pageInitializedFromUrl = false;
          }, 500);
        }, 100);
      } else {
        urlSyncInitialized = true;
      }
      
      // Aguardar até que os louvores estejam realmente carregados e processados
      const initFilters = () => {
        if (filtersInitialized) return;
        
        const urlParams = parseUrlParams($page.url);
        const urlHasArranjo = $page.url.search && $page.url.search.includes('arranjo=');
        
        // Calcular classificações únicas
        const classifications = $louvores
          .map(louvor => normalizeClassification(louvor.classificacao))
          .filter(c => c)
          .filter((c, index, arr) => arr.indexOf(c) === index)
          .sort();
        
        if (classifications.length === 0) return; // Ainda não há classificações
        
        // Se URL não tem arranjo e não há filtros selecionados, selecionar todos
        if (!urlHasArranjo && $classificationFilters.length === 0) {
          filtersInitialized = true;
          classificationFilters.selectAll(classifications);
        } else {
          filtersInitialized = true;
        }
      };
      
      // Aguardar até que os louvores estejam carregados
      const checkAndInit = () => {
        if ($louvoresLoaded && $louvores.length > 0 && !filtersInitialized) {
          // Aguardar um pouco para garantir que os dados reativos estejam processados
          initTimeout = setTimeout(() => {
            initFilters();
          }, 200);
        }
      };
      
      // Verificar imediatamente se já está pronto
      checkAndInit();
      
      // Também escutar mudanças
      const unsubscribeLouvores = louvoresLoaded.subscribe(() => {
        checkAndInit();
      });
      
      // Cleanup
      return () => {
        unsubscribeLouvores();
        if (initTimeout) clearTimeout(initTimeout);
        document.removeEventListener('click', handleClickOutside);
      };
    }
  });
  
  onDestroy(() => {
    if (browser) {
      if (initTimeout) clearTimeout(initTimeout);
      document.removeEventListener('click', handleClickOutside);
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    }
  });
  
  // Initialize filters with all classifications on first load if URL doesn't have arranjo param
  // Esta lógica funciona como backup caso o onMount não execute ou os dados estejam prontos antes
  // Usa flag para garantir que só inicialize uma vez, permitindo que usuário desselecione depois
  $: if ($louvores.length > 0 && $louvoresLoaded && !filtersInitialized && browser && $page && $page.url) {
    // Usar a mesma função de inicialização para garantir consistência
    initializeFiltersIfNeeded();
  }
  
  /**
   * @param {{ groupId?: string, materials?: { pdfId?: string }[] }} group
   */
  function getGroupKey(group) {
    return group.groupId || group.materials?.[0]?.pdfId || '';
  }

  // Handlers for Special Arrangement Filters
  /**
   * @param {CustomEvent<{ item: string }>} event
   */
  function handleSpecialArrangementToggle(event) {
    if (isUpdatingArranjoEspecialFromUrl) return;
    const item = event.detail.item;
    selectedSpecialArrangements = selectedSpecialArrangements.includes(item)
      ? selectedSpecialArrangements.filter(sa => sa !== item)
      : [...selectedSpecialArrangements, item];
    // Atualizar URL após mudança
    if (browser) {
      updateUrlParams({ arranjoEspecial: selectedSpecialArrangements });
    }
  }

  /**
   * @param {CustomEvent<{ item: string }>} event
   */
  function handleSpecialArrangementSelectOnly(event) {
    if (isUpdatingArranjoEspecialFromUrl) return;
    selectedSpecialArrangements = [event.detail.item];
    if (browser) {
      updateUrlParams({ arranjoEspecial: selectedSpecialArrangements });
    }
  }

  /**
   * @param {CustomEvent<{ items: string[] }>} event
   */
  function handleSpecialArrangementSelectAll(event) {
    if (isUpdatingArranjoEspecialFromUrl) return;
    selectedSpecialArrangements = [...event.detail.items];
    if (browser) {
      updateUrlParams({ arranjoEspecial: selectedSpecialArrangements });
    }
  }

  function handleSpecialArrangementDeselectAll() {
    if (isUpdatingArranjoEspecialFromUrl) return;
    selectedSpecialArrangements = [];
    if (browser) {
      updateUrlParams({ arranjoEspecial: [] });
    }
  }
</script>

<svelte:head>
  <title>Biblioteca</title>
</svelte:head>

<div class="max-w-6xl mx-auto px-4">
  <section
    class="louvores-catalog-banner"
    role="region"
    aria-label="Atualização da lista de louvores a partir do servidor"
  >
    <div class="louvores-catalog-banner__inner">
      <div class="louvores-catalog-banner__copy">
        <h2 class="louvores-catalog-banner__title font-garamond">Atualizar a lista de louvores</h2>
        <p class="louvores-catalog-banner__text">
          Obtém do servidor a versão mais recente do catálogo (louvores, categorias e referências aos PDFs). As
          alterações passam a valer aqui na biblioteca e na busca da página inicial. Use quando houver louvores
          novos ou correções publicadas. É necessário estar online; em conexões lentas o processo pode levar
          alguns segundos ou corromper, necessitando tentar novamente.
        </p>
      </div>
      <button
        type="button"
        class="louvores-catalog-banner__action"
        disabled={!isOnline || catalogRefreshing}
        aria-busy={catalogRefreshing}
        on:click={handleRefreshBancoLouvores}
      >
        {#if catalogRefreshing}
          <RefreshCw class="louvores-catalog-banner__action-icon" aria-hidden="true" />
          <span>Atualizando…</span>
        {:else}
          <span>Atualizar agora</span>
        {/if}
      </button>
    </div>
  </section>

  <div class="flex flex-col items-center mt-8 space-y-4">
    <CategoryFilters />
    
    <ClassificationFilters availableClassifications={$louvores.map(l => l.classificacao).filter(c => c)} />
    
    {#if availableSpecialArrangements.length > 0}
      <SpecialArrangementFilters
        available={availableSpecialArrangements}
        selected={selectedSpecialArrangements}
        on:toggle={handleSpecialArrangementToggle}
        on:selectOnly={handleSpecialArrangementSelectOnly}
        on:selectAll={handleSpecialArrangementSelectAll}
        on:deselectAll={handleSpecialArrangementDeselectAll}
      />
    {/if}
    
    <SortSelector />
    
    <PdfViewerSelector />
  </div>
  
  <div class="mt-8 flex justify-center">
    {#if paginatedLouvores.length > 0}
      <div id="louvores" class="louvores-container w-full max-w-4xl" bind:this={louvoresContainer}>
        <span class="container-tag">Louvores</span>
        
        <!-- Pagination Controls (Top) -->
        <div class="pagination-controls pagination-controls-top">
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
              <GestureButton
                on:click={previousPage}
                on:longpress={goToFirstPage}
                longPressDuration={500}
                hapticFeedback={true}
                preventDefault={true}
              >
                <button
                  type="button"
                  class="pagination-button"
                  disabled={currentPage === 1}
                  title="Página anterior (long press para primeira página)"
                >
                  <ChevronLeft class="w-5 h-5" />
                </button>
              </GestureButton>
              
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
              
              <GestureButton
                on:click={nextPage}
                on:longpress={goToLastPage}
                longPressDuration={500}
                hapticFeedback={true}
                preventDefault={true}
              >
                <button
                  type="button"
                  class="pagination-button"
                  disabled={currentPage === totalPages}
                  title="Próxima página (long press para última página)"
                >
                  <ChevronRight class="w-5 h-5" />
                </button>
              </GestureButton>
            </div>
          </div>
        </div>
        
        <div class="louvores-list">
          {#each paginatedLouvores as group (getGroupKey(group))}
            <LouvorCard louvor={group.materials[0]} materials={group.materials} />
          {/each}
        </div>
        
        <!-- Pagination Controls (Bottom) -->
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
              <GestureButton
                on:click={previousPage}
                on:longpress={goToFirstPage}
                longPressDuration={500}
                hapticFeedback={true}
                preventDefault={true}
              >
                <button
                  type="button"
                  class="pagination-button"
                  disabled={currentPage === 1}
                  title="Página anterior (long press para primeira página)"
                >
                  <ChevronLeft class="w-5 h-5" />
                </button>
              </GestureButton>
              
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
              
              <GestureButton
                on:click={nextPage}
                on:longpress={goToLastPage}
                longPressDuration={500}
                hapticFeedback={true}
                preventDefault={true}
              >
                <button
                  type="button"
                  class="pagination-button"
                  disabled={currentPage === totalPages}
                  title="Próxima página (long press para última página)"
                >
                  <ChevronRight class="w-5 h-5" />
                </button>
              </GestureButton>
            </div>
          </div>
        </div>

        <!-- End louvores container -->
      </div>
    {:else if $louvores.length > 0}
      <p class="text-center mt-8 no-results-message">Nenhum louvor encontrado com os filtros selecionados.</p>
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
  
  .no-results-message {
    color: var(--text-light);
    opacity: 0.9;
  }

  /* Faixa de atualização do manifesto — alinhada ao tema (borgonha, dourado, creme no botão) */
  .louvores-catalog-banner {
    margin: 1.5rem auto 0;
    width: 100%;
    max-width: 56rem;
    border-radius: 0.625rem;
    border: 2px solid var(--gold-color);
    background: #632a2a;
    box-shadow: var(--shadow-md);
    padding: 1rem 1.15rem;
  }

  @media (min-width: 640px) {
    .louvores-catalog-banner {
      padding: 1.1rem 1.35rem;
    }
  }

  .louvores-catalog-banner__inner {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }

  @media (min-width: 640px) {
    .louvores-catalog-banner__inner {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      gap: 1.25rem;
    }
  }

  .louvores-catalog-banner__copy {
    min-width: 0;
  }

  .louvores-catalog-banner__title {
    margin: 0 0 0.4rem;
    font-weight: 700;
    font-size: 1.125rem;
    letter-spacing: 0.02em;
    line-height: 1.25;
    color: #ffffff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  }

  @media (min-width: 640px) {
    .louvores-catalog-banner__title {
      font-size: 1.2rem;
    }
  }

  .louvores-catalog-banner__text {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.94);
  }

  .louvores-catalog-banner__action {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    min-height: 2.75rem;
    padding: 0.5rem 1.1rem;
    border-radius: 0.5rem;
    border: 2px solid var(--gold-color);
    background: var(--card-color);
    color: var(--text-dark);
    font-weight: 600;
    font-size: 0.875rem;
    cursor: pointer;
    transition: background 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }

  .louvores-catalog-banner__action:hover:not(:disabled) {
    background: #fffef6;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  }

  .louvores-catalog-banner__action:active:not(:disabled) {
    transform: scale(0.98);
  }

  .louvores-catalog-banner__action:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .louvores-catalog-banner__action-icon {
    width: 1rem;
    height: 1rem;
    animation: louvores-banner-spin 0.85s linear infinite;
  }

  @keyframes louvores-banner-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>

