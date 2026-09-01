<script>
  import { onDestroy, onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { louvores, loadLouvores, louvoresLoaded } from '$lib/stores/louvores';
  import { filters, CATEGORY_OPTIONS } from '$lib/stores/filters';
  import { classificationFilters } from '$lib/stores/classificationFilters';
  import { pdfViewer } from '$lib/stores/pdfViewer';
  import { carousel } from '$lib/stores/carousel';
  import { savedPlaylists } from '$lib/stores/savedPlaylists';
  import { bibliotecaItemsPerPage } from '$lib/stores/bibliotecaItemsPerPage';
  import { lerEstadoDaUrl, updateUrlParams } from '$lib/utils/urlSync';
  import {
    parseSharePdfIds,
    resolveKnownPdfIds,
    stripShareParams
  } from '$lib/utils/playlistShare';
  import { prepareSearchQuery, louvorRowMatchesPreparedSearch } from '$lib/utils/louvorSearch';
  import SearchBar from '$lib/components/SearchBar.svelte';
  import CategoryFilters from '$lib/components/CategoryFilters.svelte';
  import ClassificationFilters from '$lib/components/ClassificationFilters.svelte';
  import PdfViewerSelector from '$lib/components/PdfViewerSelector.svelte';
  import LouvorCard from '$lib/components/LouvorCard.svelte';
  import CarouselChips from '$lib/components/CarouselChips.svelte';
  import LouvorPaginationControls from '$lib/components/LouvorPaginationControls.svelte';
  import { groupLouvoresByGroupId } from '$lib/utils/groupLouvores.js';

  /** Em conjunto com `id` em SearchBar.svelte — só esse input bloqueia sync URL → pesquisa */
  const LOUVOR_SEARCH_INPUT_ID = 'louvor-search-input';

  // #21: a URL é a fonte de verdade. Todo o estado de busca, filtro e
  // paginação deriva dela por `$:`; a escrita só nasce de evento de usuário ou
  // de normalização idempotente — depois dela, a condição que a disparou fica
  // falsa, e o bloco reativo roda de novo sem fazer nada. Por isso não existe
  // mais nenhuma flag "estou atualizando" nem religamento por `setTimeout`.
  $: estadoUrl = lerEstadoDaUrl(browser && $page && $page.url ? $page.url : { search: '' });
  $: naHome = browser && $page?.url?.pathname === '/';

  /** Texto do input. Só é reescrito quando o valor DA URL muda de verdade. */
  let searchQuery = browser && $page && $page.url ? lerEstadoDaUrl($page.url).pesquisa : '';
  let ultimaPesquisaDaUrl = searchQuery;
  $: if (browser && estadoUrl.pesquisa !== ultimaPesquisaDaUrl) {
    ultimaPesquisaDaUrl = estadoUrl.pesquisa;
    const el = document.activeElement;
    const searchInputFocused = el instanceof HTMLInputElement && el.id === LOUVOR_SEARCH_INPUT_ID;
    if (!searchInputFocused && estadoUrl.pesquisa !== (searchQuery || '').trim()) {
      searchQuery = estadoUrl.pesquisa;
    }
  }

  /** @type {any[]} */
  let filteredResults = [];
  /** @type {any} */
  let debounceTimer = null;
  /** @type {any} */
  let searchUrlUpdateTimer = null;
  let sharedLinkProcessed = false;
  let pageInput = '1';
  /** @type {any[]} */
  let paginatedResults = [];
  let filtersExpanded = false;

  /** Vira true quando filterLouvores já rodou com catálogo e arranjos prontos. */
  let resultadosProntos = false;
  /** Critério de filtro da última execução real; mudar de verdade zera a paginação. */
  /** @type {string | null} */
  let criterioAnterior = null;
  let filtersInitialized = false;

  /**
   * @param {any[]} results
   */
  function finalizeFilteredResults(results) {
    filteredResults = results;
    // Marca que já houve uma filtragem real com os dados prontos. Antes disso,
    // ajustar a paginação seria apagar o `?pagina=3` de um deep link em aba fria
    // — a corrida que fazia a mesma URL abrir na página 3 ou na 1 dependendo de
    // quem chegava primeiro, o auto-select-all dos arranjos ou o debounce (D-3).
    if ($louvoresLoaded && $louvores.length > 0 && $classificationFilters.length > 0) {
      resultadosProntos = true;

      // Calculado AQUI, dentro da função, e não numa `$: criterioAtual = ...`
      // separada — achado da verificação em navegador do Step 12 (#21).
      // `classificationFilters.aplicarPadrao(...)` é chamado de dentro de OUTRO
      // bloco reativo (o de inicialização), que o Svelte processa numa posição
      // diferente do gráfico de dependências desta mesma passada; uma `$:`
      // derivada que lê `$classificationFilters` podia ficar UMA passada
      // atrás do valor que várias linhas abaixo, na mesma função, já a
      // classifica corretamente. O efeito: o "primeiro valor" registrado como
      // linha de base vinha com `arranjo=[]` (o estado transitório de antes do
      // aplicarPadrao rodar), e a passada seguinte — só o Svelte
      // "alcançando" o valor real — parecia uma mudança de filtro de verdade,
      // resetando a página 1 sem nenhuma ação do usuário. Ler `$filters` e
      // `$classificationFilters` diretamente aqui, na mesma chamada síncrona
      // que classificou `results`, elimina esse atraso: são os MESMOS valores
      // que já produziram `results`.
      const criterioAtual = JSON.stringify([
        estadoUrl.pesquisa,
        [...$filters].sort(),
        [...$classificationFilters].sort()
      ]);
      // Trocar de filtro de verdade volta para a página 1. A PRIMEIRA chave (a
      // chegada dos arranjos no load inicial) só é registrada, nunca tratada
      // como mudança — é o que preserva a página de um deep link (D-3).
      if (browser && naHome) {
        if (criterioAnterior === null) {
          criterioAnterior = criterioAtual;
        } else if (criterioAtual !== criterioAnterior) {
          criterioAnterior = criterioAtual;
          if (estadoUrl.pagina !== 1) {
            updateUrlParams({ pagina: 1 });
          }
        }
      }
    }
  }

  /**
   * Única porta de escrita da paginação. Não mexe em estado local: a página
   * vem da URL, e a URL vem daqui — `currentPage` (abaixo) se recalcula
   * sozinho quando `estadoUrl.pagina` mudar.
   * @param {number} p
   * @param {{ scroll?: boolean }} [opts]
   */
  function setPage(p, { scroll = true } = {}) {
    const alvo = Math.max(1, Math.min(totalPagesHome, p));
    updateUrlParams({ pagina: alvo });
    if (scroll && browser) {
      scrollHomeResultsTop();
    }
  }

  function scrollHomeResultsTop() {
    if (browser) {
      document.getElementById('home-louvores-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // Função para inicializar os filtros
  function initializeFiltersIfNeeded() {
    if (filtersInitialized || !browser || !$louvoresLoaded || !$louvores.length) return;

    // Calcular classificações únicas
    const classifications = $louvores
      .map(louvor => normalizeClassification(louvor.classificacao))
      .filter(c => c)
      .filter((c, index, arr) => arr.indexOf(c) === index)
      .sort();

    if (classifications.length === 0) return; // Ainda não há classificações disponíveis

    filtersInitialized = true;
    // #21/D-2: o padrão "todos os arranjos" deixa de ser GRAVADO na barra de
    // endereços sozinho ~200ms depois de abrir — o link mais copiado do app
    // não pode se auto-reescrever. `aplicarPadrao` só popula o store; os links
    // já compartilhados no formato `?arranjo=<5 valores>` continuam sendo
    // lidos normalmente pelo `page.subscribe` de classificationFilters.js.
    if (!estadoUrl.temArranjo && $classificationFilters.length === 0) {
      classificationFilters.aplicarPadrao(classifications);
    }
  }

  /**
   * @param {CustomEvent<{ value: number }>} e
   */
  function handleHomeItemsPerPage(e) {
    bibliotecaItemsPerPage.set(e.detail.value);
    // As duas escritas entram na mesma query pendente do urlSync e viram um
    // só goto (§4.9) — nenhuma das duas é descartada pela outra.
    updateUrlParams({ itensPorPagina: e.detail.value, pagina: 1 });
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
  });

  // #21: o retorno de um onMount `async` é uma Promise, e o Svelte a ignora —
  // o cleanup de timers escrito ali dentro nunca rodava. Fica aqui, de verdade.
  onDestroy(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (searchUrlUpdateTimer) clearTimeout(searchUrlUpdateTimer);
  });

  /**
   * Importa a lista compartilhada que veio na query (`?sharepdfs=...&sharename=...`).
   * A URL é limpa sempre que o param existe, mesmo quando nada é importado.
   */
  function handleSharedPlaylistLink() {
    if (sharedLinkProcessed) return;

    const urlParams = new URLSearchParams($page.url.search);
    if (!urlParams.has('sharepdfs')) return;
    // Sem catálogo não dá para resolver os ids: espera o manifesto (caso C2).
    if ($louvores.length === 0) return;

    sharedLinkProcessed = true;

    const pdfIds = parseSharePdfIds(urlParams.get('sharepdfs'));
    // A lista salva guarda os mesmos ids que o carrossel mostra: ids fantasmas
    // envenenariam findPlaylistByPdfIds para sempre.
    const idsResolvidos = resolveKnownPdfIds(pdfIds, $louvores);

    if (idsResolvidos.length > 0) {
      carousel.clearCarousel();
      carousel.loadPlaylist(idsResolvidos, $louvores);

      // URLSearchParams.get já decodificou uma vez; decodificar de novo lançava
      // URIError em qualquer nome com `%` e abortava o save.
      const sharename = urlParams.get('sharename');
      const playlistName = sharename || undefined;

      // Abrir o mesmo link várias vezes não cria listas duplicadas.
      if (!savedPlaylists.findPlaylistByPdfIds(idsResolvidos)) {
        savedPlaylists.savePlaylist(idsResolvidos, playlistName);
      }
    }

    // Limpa só os params do compartilhamento; utm_source/fbclid seguem vivos.
    // replaceState: voltar não pode reimportar a lista.
    const destino = $page.url.pathname + stripShareParams($page.url.search);
    goto(destino, { replaceState: true, noScroll: true });
  }

  // Importa assim que o catálogo existir; o link nunca se perde por chegar cedo.
  $: if (browser && $louvores.length > 0 && !sharedLinkProcessed && $page && $page.url) {
    handleSharedPlaylistLink();
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
  
  /**
   * Ao sair do campo de pesquisa, sincroniza a URL imediatamente.
   * Evita que o bloco reativo URL → searchQuery aplique `pesquisa` vazio da URL
   * enquanto o debounce de 500ms ainda não gravou o texto digitado.
   */
  function flushSearchToUrlOnBlur() {
    if (!browser || !naHome) return;
    if (searchUrlUpdateTimer) {
      clearTimeout(searchUrlUpdateTimer);
      searchUrlUpdateTimer = null;
    }
    if (estadoUrl.pesquisa === (searchQuery || '').trim()) return;
    updateUrlParams({ pesquisa: searchQuery });
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
    updateUrlParams({ pesquisa: '', pagina: 1 });
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

  $: groupedResults = groupLouvoresByGroupId(filteredResults);
  $: itemsPerPageHome = $bibliotecaItemsPerPage;
  $: totalPagesHome =
    groupedResults.length === 0 ? 1 : Math.max(1, Math.ceil(groupedResults.length / itemsPerPageHome));

  /** Página efetiva: a que está na URL, limitada ao que existe de verdade. */
  $: currentPage = Math.min(Math.max(1, estadoUrl.pagina), totalPagesHome);
  $: paginatedResults = groupedResults.slice(
    (currentPage - 1) * itemsPerPageHome,
    currentPage * itemsPerPageHome
  );

  /** Espelha a página efetiva no input, sem atropelar quem está digitando nele. */
  let ultimaPaginaPublicada = null;
  $: if (currentPage !== ultimaPaginaPublicada) {
    ultimaPaginaPublicada = currentPage;
    pageInput = String(currentPage);
  }

  // Corrige a URL quando a página pedida não existe mais (deep link com
  // `pagina` grande demais, ou lista que encolheu). Idempotente: depois da
  // escrita, `estadoUrl.pagina === currentPage` e a condição fica falsa.
  // `resultadosProntos` é o que evita apagar um `?pagina=3` antes de a lista
  // real existir — sem ele, essa era a corrida de aba fria x aba quente (D-3).
  $: if (browser && naHome && resultadosProntos && estadoUrl.pagina !== currentPage) {
    updateUrlParams({ pagina: currentPage });
  }

  // itensPorPagina: o param manda quando presente; ausente, publica a
  // preferência do store (compartilhado com /biblioteca, D-10). Também
  // idempotente — depois de uma passada as duas pontas coincidem.
  $: if (browser && naHome && $page?.url) {
    const temParamItensPorPagina = $page.url.searchParams.has('itensPorPagina');
    if (temParamItensPorPagina && estadoUrl.itensPorPagina !== $bibliotecaItemsPerPage) {
      bibliotecaItemsPerPage.set(estadoUrl.itensPorPagina);
    } else if (!temParamItensPorPagina && $bibliotecaItemsPerPage !== 10) {
      updateUrlParams({ itensPorPagina: $bibliotecaItemsPerPage });
    }
  }

  // D-9: um param conhecido que sobrou inválido é normalizado numa escrita
  // sem novos params — resolve tanto a assimetria home×biblioteca de
  // `?itensPorPagina=7` (P10/P11) quanto o `?comoAbrir=lixo` que antes ficava
  // pendurado para sempre (F12).
  $: if (browser && naHome && estadoUrl.paramsInvalidos.length > 0) {
    updateUrlParams({});
  }

  // O reset de página por troca de filtro mora em `finalizeFilteredResults`,
  // não numa `$: criterioAtual = ...` separada — ver o comentário lá para o
  // porquê (achado da verificação em navegador do Step 12, #21).

  // Debounce: Aguarda 300ms após o usuário parar de digitar antes de pesquisar
  // Isso evita que a pesquisa bloqueie a digitação
  $: if (browser && searchQuery !== undefined) {
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
      // Digitar é evento de usuário: a escrita nasce daqui, nunca da URL. A
      // guarda de rota real (o usuário pode ter clicado num louvor e ido para
      // /leitor dentro dos 500ms) é conferida de novo no flush de urlSync.js,
      // não aqui — checar só na chamada não bastava (R4).
      if (!naHome) return;
      if (estadoUrl.pesquisa === (searchQuery || '').trim()) return;
      updateUrlParams({ pesquisa: searchQuery });
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
   * @param {{ groupId?: string, materials?: { pdfId?: string }[] }} group
   */
  function getGroupKey(group) {
    return group.groupId || group.materials?.[0]?.pdfId || '';
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
    {#if groupedResults.length > 0}
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
          {#each paginatedResults as group (getGroupKey(group))}
            <LouvorCard louvor={group.materials[0]} materials={group.materials} />
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

