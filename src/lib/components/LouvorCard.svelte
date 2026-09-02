<script>
  import { Plus, Check } from 'lucide-svelte';
  import { getPdfRelPath } from '$lib/utils/pathUtils';
  import {
    fetchPdfAsBlob,
    sharePdf,
    savePdf,
    buildOnlineReaderUrl,
    openPdfNewTabOfflineFirst
  } from '$lib/utils/pdfUtils';
  import { navigateLouvorToLeitor } from '$lib/utils/navigateLouvorToLeitor';
  import { carousel } from '$lib/stores/carousel';
  import { pdfViewer } from '$lib/stores/pdfViewer';
  import {
    groupMaterialsByClassificacao,
    pickPreferredMaterial,
    readLastMaterialPdfId,
    resolveGroupId,
    writeLastMaterialPdfId
  } from '$lib/utils/groupLouvores.js';

  export let louvor;
  /** @type {any[] | null} Materiais do mesmo groupId (após filtro). */
  export let materials = null;
  /** Ex.: posição na lista guardada: "1)" */
  export let titlePrefix = '';

  /** @type {string | null} */
  let openedPdfIdOverride = null;
  /** @type {string | null} */
  let openedPdfIdGroup = null;

  $: materialList =
    Array.isArray(materials) && materials.length > 0 ? materials : louvor ? [louvor] : [];
  $: isGrouped = materialList.length > 1;
  $: materialsByClassificacao = groupMaterialsByClassificacao(materialList);
  $: groupId = resolveGroupId(louvor || materialList[0] || {});
  $: preferredPdfId =
    openedPdfIdGroup === groupId && openedPdfIdOverride
      ? openedPdfIdOverride
      : readLastMaterialPdfId(groupId);
  $: preferredMaterial = pickPreferredMaterial(materialList, preferredPdfId) || louvor;
  $: pdfPath = getPdfRelPath(preferredMaterial || louvor);
  $: isInCarousel = $carousel.some((item) => item.pdfId === preferredMaterial?.pdfId);
  // ponytail: Set so {#each} {@const} sees $carousel changes (fn call hid the dep)
  $: carouselPdfIds = new Set(($carousel || []).map((c) => c.pdfId).filter(Boolean));

  let cardElement;
  let isSharing = false;
  let isSaving = false;
  // Só `share` e `save` continuam a ter estado ocupado: esses esperam mesmo por
  // um blob antes de poderem fazer o que quer que seja. Abrir no leitor não
  // espera por nada.
  /** @type {string | null} */
  let busyPdfId = null;
  // Não volta a ser o aviso de "PDF indisponível" que saiu daqui: só aparece
  // quando o clique é recusado antes de sair do cartão, o que hoje acontece
  // num único caso — o pdfId não decodifica. Sem isto o clique seria silencioso.
  /** @type {string | null} */
  let pdfError = null;

  function getCategoryIcon(category) {
    if (!category) return null;
    if (category === 'Partitura') {
      return 'M7 21h10M7 21V5a2 2 0 012-2h6a2 2 0 012 2v16M7 21H5a2 2 0 01-2-2V9a2 2 0 012-2h2m10 4h2a2 2 0 012 2v10a2 2 0 01-2 2h-2m-4-4V9a2 2 0 012-2h2M9 9h2m-2 4h2m-2 4h2';
    }
    if (category === 'Cifra' || category.includes('Cifra nível')) {
      return 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z';
    }
    if (category === 'Gestos em Gravura') {
      return 'M10.05 4.575a1.575 1.575 0 1 0-3.15 0v3m3.15-3v-1.5a1.575 1.575 0 0 1 3.15 0v1.5m-3.15 0 .075 5.925m3.075.75V4.575m0 0a1.575 1.575 0 0 1 3.15 0V15M6.9 7.575a1.575 1.575 0 1 0-3.15 0v8.175a6.75 6.75 0 0 0 6.75 6.75h2.018a5.25 5.25 0 0 0 3.712-1.538l1.732-1.732a5.25 5.25 0 0 0 1.538-3.712l.003-2.024a.668.668 0 0 1 .198-.471 1.575 1.575 0 1 0-2.228-2.228 3.818 3.818 0 0 0-1.12 2.687M6.9 7.575V12m6.27 4.318A4.49 4.49 0 0 1 16.35 15m.002 0h-.002';
    }
    return null;
  }

  function rememberOpened(item) {
    if (!item?.pdfId) return;
    writeLastMaterialPdfId(groupId, item.pdfId);
    openedPdfIdOverride = item.pdfId;
    openedPdfIdGroup = groupId;
  }

  /**
   * @param {any} item
   */
  async function openLouvor(item) {
    if (!item) return;
    // Limpo aqui, e não no ramo do leitor, para que trocar de modo de abertura
    // depois de uma recusa não deixe o aviso pendurado no cartão.
    pdfError = null;
    const path = getPdfRelPath(item);
    const mode = $pdfViewer;

    if (mode === 'share' || mode === 'save') {
      if (mode === 'share') {
        isSharing = true;
      } else {
        isSaving = true;
      }
      busyPdfId = item.pdfId;

      try {
        const blob = await fetchPdfAsBlob(path);
        if (mode === 'share') {
          await sharePdf(blob, item.pdf, item.nome);
        } else {
          await savePdf(blob, item.pdf);
        }
        rememberOpened(item);
      } catch (err) {
        console.error('Erro ao processar PDF:', err);
        window.open(path, '_blank');
      } finally {
        isSharing = false;
        isSaving = false;
        busyPdfId = null;
      }
      return;
    }

    if (mode === 'leitor') {
      // O clique navega, e mais nada. Validar aqui custava duas sondas de
      // conectividade e cinco pedidos do mesmo PDF — incluindo baixá-lo
      // inteiro — com o cartão em `pointer-events: none` durante tudo isso: é
      // daí que vinha o "o primeiro clique só marca, não abre". O leitor
      // resolve a origem sozinho e é ele quem sabe diagnosticar a falha, que é
      // o caso raro.
      //
      // A construção da URL passou a ser a de `navigateLouvorToLeitor`, a
      // mesma que /listas e os chips do carrossel usam. Era aqui que os dois
      // caminhos de clique divergiam: este não tinha guarda nenhuma e, com um
      // pdfId que não decodifica, navegava para `/leitor?file=%2Fnull` — e o
      // leitor culpava o PDF ("não está disponível offline") por um problema
      // que é do identificador, mandando o utilizador baixar um ficheiro que
      // nunca ia resolver nada. Com uma só função, não podem voltar a divergir.
      // Só se regista como "último material aberto" o que se conseguiu abrir.
      if (path) rememberOpened(item);
      const result = await navigateLouvorToLeitor(item);
      if (!result.navigated) pdfError = result.error;
      return;
    }

    if (mode === 'online') {
      rememberOpened(item);
      const readerUrl = buildOnlineReaderUrl(path);
      window.open(readerUrl, '_blank', 'noopener');
      return;
    }

    if (mode === 'newtab') {
      rememberOpened(item);
      await openPdfNewTabOfflineFirst(`/${path}`, item.pdf);
      return;
    }
  }

  async function handleCardClick() {
    await openLouvor(preferredMaterial || louvor);
  }

  /** @param {any} [item] */
  function handleAddToCarousel(item) {
    const target = item || preferredMaterial || louvor;
    if (target) carousel.addLouvor(target);
  }

  $: categoryIcon = getCategoryIcon(louvor?.categoria);

  /**
   * @param {any} item
   * @returns {string}
   */
  function materialButtonLabel(item) {
    const cat = item?.categoria || 'Sem categoria';
    const sameCat = materialList.filter((m) => m.categoria === item?.categoria).length;
    if (sameCat <= 1) return cat;
    const pdfName = String(item?.pdf || '')
      .replace(/\.pdf$/i, '')
      .trim();
    return pdfName ? `${cat} · ${pdfName}` : cat;
  }
</script>

<div class="louvor-card" class:grouped={isGrouped} bind:this={cardElement}>
  <!-- O aviso de indisponibilidade saiu daqui: o cartão já não sabe se o PDF
       existe, e passar a saber era exatamente o que atrasava o clique. Quem
       mostra a mensagem — e o caminho para /offline — é o leitor.
       O que sobra é a recusa local: quando nem sequer há caminho para pedir,
       o clique não navega, e tem de dizer porquê em vez de não fazer nada. -->
  {#if pdfError}
    <div class="pdf-error-banner" role="alert">
      {pdfError}
    </div>
  {/if}
  {#if isGrouped}
    <div class="louvor-info header-only">
      <div class="louvor-title">
        {#if titlePrefix}<span class="louvor-title-prefix">{titlePrefix} </span>{/if}
        <strong>#{louvor.numero || 'N/A'}</strong> - {louvor.nome || 'Sem título'}
        {#if isSharing}
          <span class="processing-indicator">Compartilhando...</span>
        {:else if isSaving}
          <span class="processing-indicator">Baixando...</span>
        {/if}
      </div>
    </div>

    {#each materialsByClassificacao as section (section.classificacao)}
      <div class="arranjo-head">
        <div class="arranjo-kicker">Arranjo</div>
        <div class="arranjo-name">{section.classificacao}</div>
      </div>
      <div class="materials" role="group" aria-label={`Materiais · ${section.classificacao}`}>
        {#each section.materials as item (item.pdfId || item.categoria)}
          {@const icon = getCategoryIcon(item.categoria)}
          {@const inCarousel = !!item?.pdfId && carouselPdfIds.has(item.pdfId)}
          {@const itemPath = getPdfRelPath(item)}
          <div class="material-row">
            <a
              href={itemPath}
              class="material-open"
              class:busy={busyPdfId === item.pdfId}
              title={`Abrir ${materialButtonLabel(item)}`}
              on:click|preventDefault={() => openLouvor(item)}
            >
              <span class="icon-wrap" aria-hidden="true">
                {#if icon}
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={icon} />
                  </svg>
                {/if}
              </span>
              <span class="label-main">{materialButtonLabel(item)}</span>
            </a>
            <button
              type="button"
              class="add-button material-add"
              title="Adicionar à playlist de louvores"
              disabled={inCarousel}
              on:click={() => handleAddToCarousel(item)}
            >
              {#if inCarousel}
                <Check class="w-5 h-5" />
              {:else}
                <Plus class="w-5 h-5" />
              {/if}
            </button>
          </div>
        {/each}
      </div>
    {/each}
  {:else}
    <a
      href={pdfPath}
      on:click|preventDefault={handleCardClick}
      class="louvor-info"
      class:processing={isSharing || isSaving}
    >
      <div class="louvor-title">
        {#if titlePrefix}<span class="louvor-title-prefix">{titlePrefix} </span>{/if}
        <strong>#{louvor.numero || 'N/A'}</strong> - {louvor.nome || 'Sem título'}
        {#if isSharing}
          <span class="processing-indicator">Compartilhando...</span>
        {:else if isSaving}
          <span class="processing-indicator">Baixando...</span>
        {/if}
      </div>
      <div class="louvor-subtitles">
        <div class="louvor-classification">
          {louvor.classificacao || 'Sem classificação'}
        </div>
        <div class="louvor-category">
          {#if categoryIcon}
            <svg class="category-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={categoryIcon} />
            </svg>
          {/if}
          <span>{louvor.categoria || 'Sem categoria'}</span>
        </div>
      </div>
    </a>

    <button
      type="button"
      on:click={() => handleAddToCarousel()}
      disabled={isInCarousel}
      class="add-button"
      title="Adicionar à playlist de louvores"
    >
      {#if isInCarousel}
        <Check class="w-5 h-5" />
      {:else}
        <Plus class="w-5 h-5" />
      {/if}
    </button>
  {/if}
</div>

<style>
  /* Mesmo desenho do banner de `CarouselChips.svelte`: é o mesmo erro, vindo
     da mesma função, e ver duas caixas diferentes para a mesma recusa era
     confuso. `grid-column: 1 / -1` porque o cartão é uma grelha de duas
     colunas e o aviso tem de atravessar as duas. */
  .pdf-error-banner {
    grid-column: 1 / -1;
    padding: 0.5rem;
    margin-bottom: 0.5rem;
    background-color: rgba(220, 38, 38, 0.1);
    border: 1px solid rgba(220, 38, 38, 0.3);
    border-radius: 0.25rem;
    color: var(--text-light);
    font-size: 0.875rem;
    text-align: center;
  }

  .louvor-card {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.75rem;
    width: 100%;
    padding: 0.75rem 1rem;
    background-color: var(--title-color);
    border: 2px solid var(--gold-color);
    border-radius: 0.5rem;
    box-shadow: var(--shadow-md);
    transition: all 0.2s ease;
  }

  .louvor-card.grouped {
    grid-template-columns: 1fr;
  }

  .louvor-card:hover {
    box-shadow: var(--shadow-lg);
    transform: translateY(-1px);
  }

  .louvor-info {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    text-decoration: none;
    color: var(--text-light);
    min-width: 0;
  }

  .louvor-info.header-only {
    grid-column: 1;
  }

  .louvor-title-prefix {
    font-weight: 600;
    opacity: 0.95;
    margin-right: 0.125rem;
  }

  .louvor-title {
    font-size: 1rem;
    font-family: 'Garamond', serif;
    font-weight: 700;
    color: var(--text-light);
    margin-bottom: 0.5rem;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .louvor-subtitles {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .louvor-classification {
    font-size: 0.8125rem;
    color: var(--text-light);
    opacity: 0.9;
    line-height: 1.4;
  }

  .louvor-category {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.8125rem;
    color: var(--text-light);
    opacity: 0.9;
    line-height: 1.4;
  }

  .category-icon {
    width: 1rem;
    height: 1rem;
    color: var(--text-light);
    flex-shrink: 0;
  }

  .add-button {
    background-color: var(--card-color);
    color: var(--text-dark);
    border: 2px solid var(--gold-color);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
    min-width: 2.5rem;
    height: 2.5rem;
    align-self: center;
    flex-shrink: 0;
  }

  .add-button:hover:not(:disabled) {
    background-color: var(--gold-light);
    transform: scale(1.05);
  }

  .add-button:disabled {
    background-color: var(--badge-gray-bg);
    cursor: not-allowed;
    opacity: 0.6;
  }

  .louvor-info.header-only .louvor-title {
    margin-bottom: 0;
  }

  .arranjo-head {
    margin: 0.55rem 0 0.4rem;
  }

  .arranjo-kicker {
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-light);
    opacity: 0.8;
    margin-bottom: 0.1rem;
    line-height: 1.2;
  }

  .arranjo-name {
    font-size: 0.95rem;
    font-weight: 800;
    line-height: 1.25;
    color: var(--text-light);
  }

  .materials {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0;
    padding-top: 0;
    border-top: none;
  }

  .arranjo-head + .materials {
    margin-bottom: 0.15rem;
  }

  .material-row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: stretch;
    min-height: 2.75rem;
    background: rgba(255, 248, 225, 0.1);
    border: 2px solid var(--gold-color);
    border-radius: 0.5rem;
    overflow: hidden;
  }

  .material-open {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    min-width: 0;
    padding: 0.55rem 0.7rem;
    color: var(--text-light);
    text-decoration: none;
    font-size: 0.8125rem;
    font-weight: 700;
    line-height: 1.2;
    transition: background 0.15s ease;
  }

  .material-open:hover,
  .material-open:focus-visible {
    background: rgba(212, 175, 55, 0.28);
  }

  /* `pointer-events: none` só enquanto se espera por um blob (share/save). No
     modo leitor não há espera nenhuma, e era esta regra que engolia o clique. */
  .material-open.busy {
    opacity: 0.6;
    cursor: wait;
    pointer-events: none;
  }

  .material-open .icon-wrap {
    flex-shrink: 0;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.35rem;
    background: rgba(255, 248, 225, 0.18);
    border: 1px solid rgba(212, 175, 55, 0.45);
    display: grid;
    place-items: center;
  }

  .material-open .icon-wrap svg {
    width: 1.05rem;
    height: 1.05rem;
  }

  .material-open .label-main {
    min-width: 0;
  }

  .material-add {
    border: none;
    border-left: 2px solid var(--gold-color);
    border-radius: 0;
    height: auto;
    min-height: 100%;
    min-width: 2.75rem;
    align-self: stretch;
  }

  .material-add:hover:not(:disabled) {
    transform: none;
  }

  .louvor-info.processing {
    opacity: 0.6;
    cursor: wait;
    pointer-events: none;
  }

  .processing-indicator {
    display: inline-block;
    margin-left: 0.5rem;
    font-size: 0.75rem;
    opacity: 0.8;
    font-weight: 400;
    color: var(--gold-color);
  }
</style>
