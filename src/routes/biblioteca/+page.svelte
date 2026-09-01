<script>
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { louvores, loadLouvores, louvoresLoaded } from '$lib/stores/louvores';
  import { classificationFilters } from '$lib/stores/classificationFilters';
  import { filters, CATEGORY_OPTIONS } from '$lib/stores/filters';
  import { bibliotecaSort } from '$lib/stores/bibliotecaSort';
  import { bibliotecaItemsPerPage, VALID_OPTIONS } from '$lib/stores/bibliotecaItemsPerPage';
  import { pdfViewer } from '$lib/stores/pdfViewer';
  import { lerEstadoDaUrl, updateUrlParams } from '$lib/utils/urlSync';
  import ClassificationFilters from '$lib/components/ClassificationFilters.svelte';
  import SpecialArrangementFilters from '$lib/components/SpecialArrangementFilters.svelte';
  import CategoryFilters from '$lib/components/CategoryFilters.svelte';
  import SortSelector from '$lib/components/SortSelector.svelte';
  import PdfViewerSelector from '$lib/components/PdfViewerSelector.svelte';
  import LouvorCard from '$lib/components/LouvorCard.svelte';
  import GestureButton from '$lib/components/GestureButton.svelte';
  import { ChevronLeft, ChevronRight } from 'lucide-svelte';
  import { groupLouvoresByGroupId, compareLouvorNome } from '$lib/utils/groupLouvores.js';

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

  // A URL é a fonte de verdade. Nada aqui é sincronizado nos dois sentidos.
  $: estadoUrl = lerEstadoDaUrl(browser && $page && $page.url ? $page.url : { search: '' });
  $: naBiblioteca = browser && $page?.url?.pathname === '/biblioteca';

  /**
   * Arranjo especial, inteiramente derivado — não é mais estado escrito.
   *
   * Antes eram cinco blocos reativos num anel: um deles gravava a URL, a URL
   * reescrevia a seleção, a seleção recalculava a lista filtrada, a lista
   * recalculava os arranjos disponíveis, e o primeiro bloco disparava de novo.
   * A flag que deveria conter isso era ligada e desligada no mesmo tick
   * síncrono, então nunca protegeu nada contra o `$page`, que é assíncrono.
   *
   * Aqui não há escrita nenhuma: quando a URL traz o param, ele manda (filtrado
   * pelo que existe); quando não traz, o padrão "todos" é **calculado**, e não
   * gravado na barra de endereços (mesma decisão D-2 da home).
   *
   * A detecção antiga de "a URL já tem arranjoEspecial?" era um
   * `$page.url.search.includes('arranjoEspecial=')` — frágil por natureza,
   * porque compara substring de uma query string crua em vez de perguntar ao
   * parser. Aqui vira `estadoUrl.temArranjoEspecial`, que é
   * `URLSearchParams.has('arranjoEspecial')` (via `lerEstadoDaUrl`): a mesma
   * pergunta, respondida pelo parser, não por busca de texto.
   * @type {string[]}
   */
  $: selectedSpecialArrangements =
    availableSpecialArrangements.length === 0
      ? []
      : estadoUrl.temArranjoEspecial
        ? estadoUrl.arranjoEspecial.filter((sa) => availableSpecialArrangements.includes(sa))
        : availableSpecialArrangements;

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
    }
    return sorted.sort(compareLouvorNome);
  })();
  
  // Paginação
  let pageInput = '1';
  let itemsPerPageMenuOpen = false;
  /** @type {HTMLElement | null} */
  let louvoresContainer = null;
  /** Critério de filtro da última execução; mudar de verdade zera a paginação. */
  /** @type {string | null} */
  let criterioAnterior = null;

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

  $: itemsPerPage = $bibliotecaItemsPerPage;
  $: groupedLouvores = groupLouvoresByGroupId(sortedLouvores);
  $: totalPages =
    groupedLouvores.length === 0 ? 1 : Math.max(1, Math.ceil(groupedLouvores.length / itemsPerPage));

  /** Página efetiva: a que está na URL, limitada ao que existe de verdade. */
  $: currentPage = Math.min(Math.max(1, estadoUrl.pagina), totalPages);
  $: paginatedLouvores = groupedLouvores.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );
  /** Espelha a página efetiva no input, sem atropelar quem está digitando nele. */
  let ultimaPaginaPublicada = null;
  $: if (currentPage !== ultimaPaginaPublicada) {
    ultimaPaginaPublicada = currentPage;
    pageInput = String(currentPage);
  }

  /**
   * Única porta de escrita da paginação.
   * @param {number} numeroPagina
   * @param {{ scroll?: boolean }} [options]
   */
  function setPage(numeroPagina, { scroll = true } = {}) {
    const alvo = Math.max(1, Math.min(totalPages, numeroPagina));
    updateUrlParams({ pagina: alvo });
    if (scroll) {
      scrollToLouvores();
    }
  }

  /** Só depois disso faz sentido corrigir a paginação (preserva `?pagina=N`). */
  $: resultadosProntos = $louvoresLoaded && $louvores.length > 0 && $classificationFilters.length > 0;

  // Corrige a URL quando a página pedida não existe mais. Idempotente: depois
  // da escrita a condição é falsa, então não há laço e não há flag.
  $: if (browser && naBiblioteca && resultadosProntos && estadoUrl.pagina !== currentPage) {
    updateUrlParams({ pagina: currentPage });
  }

  // Chave de identidade do filtro. Separadores fora do alfabeto dos valores.
  // `[...]` antes de `.sort()`: o código antigo ordenava o array no lugar.
  $: criterioAtual = [
    [...$filters].sort().join('\u0001'),
    [...$classificationFilters].sort().join('\u0001'),
    [...selectedSpecialArrangements].sort().join('\u0001')
  ].join('\u0000');

  // Trocar de filtro volta para a página 1. A **primeira** chave é só
  // registrada: é o que preserva `/biblioteca?pagina=5` de um deep link.
  $: if (browser && naBiblioteca && resultadosProntos) {
    if (criterioAnterior === null) {
      criterioAnterior = criterioAtual;
    } else if (criterioAtual !== criterioAnterior) {
      criterioAnterior = criterioAtual;
      if (estadoUrl.pagina !== 1) {
        updateUrlParams({ pagina: 1 });
      }
    }
  }

  /**
   * ordenar/itensPorPagina: sincronização com a URL feita por um
   * `page.subscribe` MANUAL — de propósito, não um `$:`.
   *
   * Uma primeira versão usava `$: if (browser && naBiblioteca && $page?.url) {
   * ...lendo $bibliotecaSort/$bibliotecaItemsPerPage... }`, o mesmo desenho
   * que a home já usa para `itensPorPagina`. Provou em navegador (achado
   * desta tarefa, não pego pela revisão de código) que esse desenho quebra:
   * um `$:` que LÊ `$bibliotecaSort` dentro do corpo também o tem como
   * dependência, então um `bibliotecaSort.set(...)` de um clique (evento de
   * usuário, não navegação) já dispara esse bloco de novo, com `$page.url`
   * ainda desatualizado (o `goto` do clique nem começou). O bloco lê a URL
   * velha como se fosse a verdade e desfaz o clique. Quando o valor clicado É
   * o default — `construirQueryAtualizada` apaga o param —, não sobra
   * nenhuma passada seguinte para corrigir: o valor errado fica preso para
   * sempre ("Por número" nunca pegava depois de já existir `?ordenar=nome`).
   *
   * Um `page.subscribe` puro só reage quando `$page` de fato muda (uma
   * navegação real terminando) — nunca por causa do `.set()` de outra store,
   * porque essa store não é dependência dele. Sem `$:` na frente do valor
   * lido por `get()`, o laço não existe. Mesmo princípio de
   * `filters.js`/`classificationFilters.js` (Tarefa 11); aqui fica na página,
   * e não dentro de `bibliotecaItemsPerPage.js`, porque esse store é
   * compartilhado com a home (D-10) e sua sincronização própria não é desta
   * tarefa para reabrir.
   * @param {import('@sveltejs/kit').Page | null} $p
   */
  function sincronizarOrdenarEItensPorPaginaComUrl($p) {
    if (!$p || !$p.url || $p.url.pathname !== '/biblioteca') return;

    const params = $p.url.searchParams;
    const estado = lerEstadoDaUrl($p.url);

    if (params.has('ordenar')) {
      if (estado.ordenar !== get(bibliotecaSort)) {
        bibliotecaSort.set(estado.ordenar);
      }
    } else if (get(bibliotecaSort) !== 'numero') {
      updateUrlParams({ ordenar: get(bibliotecaSort) });
    }

    if (params.has('itensPorPagina')) {
      if (estado.itensPorPagina !== get(bibliotecaItemsPerPage)) {
        bibliotecaItemsPerPage.set(estado.itensPorPagina);
      }
    } else if (get(bibliotecaItemsPerPage) !== 10) {
      updateUrlParams({ itensPorPagina: get(bibliotecaItemsPerPage) });
    }

    // D-9: param conhecido com valor inválido é normalizado uma vez.
    if (estado.paramsInvalidos.length > 0) {
      updateUrlParams({});
    }
  }

  /** @type {(() => void) | null} */
  let pararDeSincronizarComUrl = null;
  if (browser) {
    pararDeSincronizarComUrl = page.subscribe(sincronizarOrdenarEItensPorPaginaComUrl);
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

  /**
   * Não é chamada de dentro de um `$:` — de propósito.
   *
   * Uma primeira versão disparava isto de um bloco reativo (`$: if (browser
   * && $louvoresLoaded && $louvores.length > 0 && !filtersInitialized) {...}`),
   * o mesmo padrão que a home usa para o próprio backup de filtros. Provou em
   * navegador (achado desta tarefa) que trava a biblioteca inteira: o
   * `classificationFilters.aplicarPadrao(...)` daqui muda `$classificationFilters`
   * NO MEIO da mesma passada reativa que `classificationFilteredLouvores` (e
   * tudo que vem depois dela — `filteredLouvores`, `sortedLouvores`,
   * `groupedLouvores`, `paginatedLouvores`) também pertence. Sem nenhum
   * gatilho externo depois, essa cadeia nunca mais recalcula e fica lendo o
   * `[]` de antes do padrão ser aplicado — para sempre: a biblioteca abre com
   * "Nenhum louvor encontrado" mesmo com os cinco chips de Arranjo marcados.
   * A home nunca bateu nisso porque a lista dela é montada por
   * `filterLouvores()`, chamada de um `setTimeout` (o debounce de busca) —
   * sempre uma passada nova. Aqui a chamada direta depois do `await
   * loadLouvores()` cumpre o mesmo papel: por essa altura o fetch (ou o
   * cache em memória) já resolveu há vários microtasks, o flush reativo do
   * catálogo já sedimentou, e chamar isto fora de qualquer `$:` garante uma
   * passada só dela quando de fato aplica o padrão.
   */
  onMount(async () => {
    await loadLouvores();
    initializeFiltersIfNeeded();
    if (browser) {
      document.addEventListener('click', handleClickOutside);
    }
  });

  // O retorno de um `onMount` async é uma Promise e o Svelte o ignora: o
  // cleanup antigo nunca rodava. Fica só este.
  onDestroy(() => {
    if (browser) {
      document.removeEventListener('click', handleClickOutside);
    }
    if (pararDeSincronizarComUrl) {
      pararDeSincronizarComUrl();
    }
  });

  function initializeFiltersIfNeeded() {
    if (filtersInitialized || !browser || !$louvoresLoaded || !$louvores.length) return;

    const classifications = uniqueNormalizedClassifications;
    if (classifications.length === 0) return;

    filtersInitialized = true;
    // D-2: o padrão "todos os arranjos" é calculado, não gravado na URL. Links
    // no formato `?arranjo=<5 valores>` continuam sendo lidos normalmente.
    if (!estadoUrl.temArranjo && $classificationFilters.length === 0) {
      classificationFilters.aplicarPadrao(classifications);
    }
  }

  /**
   * @param {{ groupId?: string, materials?: { pdfId?: string }[] }} group
   */
  function getGroupKey(group) {
    return group.groupId || group.materials?.[0]?.pdfId || '';
  }

  // Handlers do filtro de arranjo especial: a única coisa que fazem é gravar a
  // URL. A seleção exibida volta pela derivação, no mesmo ciclo.
  /**
   * @param {CustomEvent<{ item: string }>} event
   */
  function handleSpecialArrangementToggle(event) {
    const item = event.detail.item;
    const novo = selectedSpecialArrangements.includes(item)
      ? selectedSpecialArrangements.filter((sa) => sa !== item)
      : [...selectedSpecialArrangements, item];
    updateUrlParams({ arranjoEspecial: novo });
  }

  /**
   * @param {CustomEvent<{ item: string }>} event
   */
  function handleSpecialArrangementSelectOnly(event) {
    updateUrlParams({ arranjoEspecial: [event.detail.item] });
  }

  /**
   * @param {CustomEvent<{ items: string[] }>} event
   */
  function handleSpecialArrangementSelectAll(event) {
    updateUrlParams({ arranjoEspecial: [...event.detail.items] });
  }

  function handleSpecialArrangementDeselectAll() {
    // Vazio é gravado como `arranjoEspecial=` para sobreviver a um F5.
    updateUrlParams({ arranjoEspecial: [] });
  }

  /**
   * Ordenar: grava o store E a URL juntos. O `page.subscribe` manual (acima)
   * só reage a navegação de verdade, então nada mais vai publicar essa
   * escolha na URL — se este handler só desse `.set()`, o clique mudaria o
   * chip ativo mas a URL nunca chegaria a saber.
   * @param {CustomEvent<{ value: string }>} event
   */
  function handleSortSelect(event) {
    const valor = event.detail.value;
    bibliotecaSort.set(valor);
    updateUrlParams({ ordenar: valor });
  }

  /**
   * Mesma razão do `handleSortSelect`: grava os dois juntos. Não força
   * `pagina: 1` aqui — comportamento de sempre na biblioteca é só corrigir a
   * página se ela ficar inválida com o novo total, e isso já é coberto pelo
   * bloco genérico de correção de página, acima, que deriva `currentPage` de
   * `estadoUrl.pagina` limitado a `totalPages`.
   * @param {number} option
   */
  function handleItemsPerPageSelect(option) {
    bibliotecaItemsPerPage.set(option);
    updateUrlParams({ itensPorPagina: option });
    itemsPerPageMenuOpen = false;
    scrollToLouvores();
  }
</script>

<svelte:head>
  <title>Biblioteca</title>
</svelte:head>

<div class="max-w-6xl mx-auto px-4">
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
    
    <SortSelector on:select={handleSortSelect} />
    
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
                          handleItemsPerPageSelect(option);
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
                          handleItemsPerPageSelect(option);
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
  
  .no-results-message {
    color: var(--text-light);
    opacity: 0.9;
  }

  /* Faixa de atualização do manifesto — alinhada ao tema (borgonha, dourado, creme no botão) */
</style>

