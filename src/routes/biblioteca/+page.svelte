<script>
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { louvores, loadLouvores, louvoresLoaded } from '$lib/stores/louvores';
  import { classificationFilters } from '$lib/stores/classificationFilters';
  import { filters, CATEGORY_OPTIONS } from '$lib/stores/filters';
  import { bibliotecaSort } from '$lib/stores/bibliotecaSort';
  import { bibliotecaItemsPerPage } from '$lib/stores/bibliotecaItemsPerPage';
  import { pdfViewer } from '$lib/stores/pdfViewer';
  import { lerEstadoDaUrl, updateUrlParams } from '$lib/utils/urlSync';
  import ClassificationFilters from '$lib/components/ClassificationFilters.svelte';
  import SpecialArrangementFilters from '$lib/components/SpecialArrangementFilters.svelte';
  import CategoryFilters from '$lib/components/CategoryFilters.svelte';
  import SortSelector from '$lib/components/SortSelector.svelte';
  import PdfViewerSelector from '$lib/components/PdfViewerSelector.svelte';
  import LouvorCard from '$lib/components/LouvorCard.svelte';
  import LouvorPaginationControls from '$lib/components/LouvorPaginationControls.svelte';
  import { groupLouvoresByGroupId, compareLouvorNome } from '$lib/utils/groupLouvores.js';
  import LouvorListSkeleton from '$lib/components/LouvorListSkeleton.svelte';

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

  /**
   * Grava o store E a URL juntos, mesma razão do `handleSortSelect` (abaixo):
   * a cópia inline que este handler substitui (`handleItemsPerPageSelect`)
   * também gravava os dois — se só desse `.set()`, o clique mudaria a lista
   * mas a URL nunca chegaria a saber (o `page.subscribe` manual, acima, só
   * reage a navegação de verdade, não a `.set()` de outra store). Também não
   * chama `setPage(1, ...)`: a cópia inline não resetava a página ao trocar
   * o número de itens, e este handler preserva esse comportamento.
   * @param {CustomEvent<{ value: number }>} e
   */
  function handleItemsPerPage(e) {
    bibliotecaItemsPerPage.set(e.detail.value);
    updateUrlParams({ itensPorPagina: e.detail.value });
    scrollToLouvores();
  }

  /**
   * @param {CustomEvent<{ page: number; scroll?: boolean }>} e
   */
  function handleGotoPage(e) {
    setPage(e.detail.page, { scroll: e.detail.scroll !== false });
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
  /**
   * Rede de segurança contra um ponto único de falha silencioso (achado da
   * Tarefa 17): `loadLouvores()` (`src/lib/stores/louvores.js:365-422`) tem
   * uma guarda de cancelamento por geração — se uma segunda chamada
   * concorrente começar antes da primeira terminar, o `await loadLouvores()`
   * do `onMount` abaixo pode resolver sem jamais marcar
   * `$louvoresLoaded`/`$louvores` (a chamada perdedora só retorna cedo, sem
   * setá-los). Nessa janela estreita, a chamada direta de
   * `initializeFiltersIfNeeded()` logo abaixo vira no-op (a guarda dela mesma
   * checa `$louvoresLoaded`) e nada mais chamaria de novo — o filtro padrão
   * de arranjos nunca se aplicaria, e nada avisaria.
   *
   * Um `.subscribe()` de store NÃO é um bloco `$:`: só reage quando
   * `$louvoresLoaded` de fato muda de valor (a chamada vencedora terminando),
   * nunca por causa da escrita em `classificationFilters` que
   * `initializeFiltersIfNeeded` faz aqui dentro — o mesmo raciocínio que já
   * protege `sincronizarOrdenarEItensPorPaginaComUrl`, acima. Como
   * `initializeFiltersIfNeeded` é idempotente, reassinar quando já
   * inicializou é inofensivo.
   * @type {(() => void) | null}
   */
  let pararDeObservarCargaConcluida = null;
  if (browser) {
    pararDeObservarCargaConcluida = louvoresLoaded.subscribe(($carregado) => {
      if ($carregado) initializeFiltersIfNeeded();
    });
  }

  onMount(async () => {
    await loadLouvores();
    initializeFiltersIfNeeded();
  });

  // O retorno de um `onMount` async é uma Promise e o Svelte o ignora: o
  // cleanup antigo nunca rodava. Fica só este.
  onDestroy(() => {
    if (pararDeSincronizarComUrl) {
      pararDeSincronizarComUrl();
    }
    if (pararDeObservarCargaConcluida) {
      pararDeObservarCargaConcluida();
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

  // `handleItemsPerPage`, perto de `setPage` acima, substitui
  // `handleItemsPerPageSelect` — a lógica de "grava os dois juntos, não
  // força página 1" descrita ali é a mesma.
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
    {#if !$louvoresLoaded}
      <div class="louvores-container w-full max-w-4xl">
        <span class="container-tag">Louvores</span>
        <LouvorListSkeleton count={itemsPerPage} />
      </div>
    {:else if paginatedLouvores.length > 0}
      <div id="louvores" class="louvores-container w-full max-w-4xl" bind:this={louvoresContainer}>
        <span class="container-tag">Louvores</span>
        
        <LouvorPaginationControls
          variant="top"
          bind:pageInput
          currentPage={currentPage}
          totalPages={totalPages}
          itemsPerPage={itemsPerPage}
          on:itemsPerPage={handleItemsPerPage}
          on:gotoPage={handleGotoPage}
          on:previous={previousPage}
          on:next={nextPage}
          on:first={goToFirstPage}
          on:last={goToLastPage}
        />

        <div class="louvores-list">
          {#each paginatedLouvores as group (getGroupKey(group))}
            <LouvorCard louvor={group.materials[0]} materials={group.materials} />
          {/each}
        </div>

        <LouvorPaginationControls
          variant="bottom"
          bind:pageInput
          currentPage={currentPage}
          totalPages={totalPages}
          itemsPerPage={itemsPerPage}
          on:itemsPerPage={handleItemsPerPage}
          on:gotoPage={handleGotoPage}
          on:previous={previousPage}
          on:next={nextPage}
          on:first={goToFirstPage}
          on:last={goToLastPage}
        />

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

  /* #16: content-visibility avaliado e descartado em 2026-09-01. Medido
     nesta página (LouvorCard, paginação de até 50 itens), build de
     produção (`npm run build` + `npm run preview`), custo de layout de
     10→50 cards via reflow forçado (40 amostras/medição, mediana): 3
     repetições completas —
       rep 1: 50 itens = 1.9ms (min 1.5/max 7.1) · 10 itens = 2.5ms (min 1.2/
         max 3.4) · delta = -0.6ms · ruído = 5.6ms
       rep 2: 50 itens = 10.8ms (min 6.3/max 14.4) · 10 itens = 3.2ms (min
         1.2/max 3.7) · delta = 7.6ms · ruído = 8.1ms
       rep 3: 50 itens = 12.0ms (min 6.3/max 15.3) · 10 itens = 3.4ms (min
         1.3/max 4.1) · delta = 8.6ms · ruído = 9.0ms
     Nas 3 repetições, delta < ruído (nunca claramente maior) — o custo
     marginal de ir de 10 para 50 cards não se distingue com confiança do
     ruído da própria medição (que varia mais entre repetições, 1.9–12.0ms,
     do que o delta varia dentro de cada uma). As listas já paginam em no
     máximo 50 itens (bibliotecaItemsPerPage.js); não há lista longa de
     verdade para otimizar hoje. Reabrir só se o limite de paginação subir ou
     o card ficar bem mais pesado. */
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

  /* Faixa de atualização do manifesto — alinhada ao tema (borgonha, dourado, creme no botão) */
</style>

