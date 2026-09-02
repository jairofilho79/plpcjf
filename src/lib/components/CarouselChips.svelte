<script>
  import { tick, onDestroy } from 'svelte';
  import { X, Trash2, GripVertical, Share2, Save, Check, ExternalLink, ChevronDown, ChevronUp, FileText } from 'lucide-svelte';
  import { goto } from '$app/navigation';
  import { carousel } from '$lib/stores/carousel';
  import { pdfViewer } from '$lib/stores/pdfViewer';
  import { savedPlaylists } from '$lib/stores/savedPlaylists';
  import { getPdfRelPath } from '$lib/utils/pathUtils';
  import GestureButton from '$lib/components/GestureButton.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { 
    fetchPdfAsBlob, 
    sharePdf, 
    savePdf, 
    buildOnlineReaderUrl, 
    openPdfNewTabOfflineFirst 
  } from '$lib/utils/pdfUtils';
  import { sharePlaylistLink, generatePlaylistShareUrl } from '$lib/utils/playlistUtils';
  import { generateFolhetoHtml, generateFolhetoImage, shareFolheto } from '$lib/utils/folhetoUtils';
  import {
    navigateLouvorToLeitor,
    ERRO_IDENTIFICADOR_INVALIDO
  } from '$lib/utils/navigateLouvorToLeitor';
  import {
    resolveTargetIndex,
    computeKeyboardTarget,
    computeAutoScrollVelocity,
    hasPassedDragThreshold,
    isReorderKey
  } from '$lib/utils/chipPointerReorder.js';

  /**
   * @type {number | null}
   */
  let draggedIndex = null;
  /** @type {string | null} */
  let checkingPdfId = null;
  /** @type {string | null} */
  let pdfError = null;
  /** @type {string | null} */
  let processingPdfId = null;
  /**
   * @type {number | null}
   */
  let dragOverIndex = null;

  // ── Arrasto por ponteiro ───────────────────────────────────────────────────
  // O drag-and-drop nativo do HTML5 saiu daqui: no iOS Safari não existe por
  // toque e no Android depende de um hold que o browser decide — daí as
  // queixas de "tem que apertar e segurar por muito tempo" e de o menu de
  // contexto roubar o gesto. Pointer Events unificam rato, dedo e caneta e
  // arrancam no primeiro movimento, sem espera nenhuma.

  /** Ponteiro que conduz o arrasto atual; null quando não há arrasto. @type {number | null} */
  let activePointerId = null;
  /** Alça que capturou o ponteiro, para o largar mesmo que o dedo acabe longe dela. @type {HTMLElement | null} */
  let capturingEl = null;
  let pointerStartX = 0;
  let pointerStartY = 0;
  /** Já passou o limiar de movimento? Antes disso o gesto ainda pode ser só um toque. */
  let dragMoved = false;
  /** Referências aos chips, para medir a geometria no momento do gesto. @type {Array<HTMLElement | null>} */
  let chipEls = [];
  /** Referências às alças, para devolver o foco ao chip que se moveu por teclado. @type {Array<HTMLElement | null>} */
  let dragHandleEls = [];
  /** A própria lista: dá as fronteiras do gesto e é ela que rola sozinha. @type {HTMLElement | null} */
  let listEl = null;
  /** Última posição do ponteiro, para reavaliar o alvo enquanto a lista rola sob um dedo parado. */
  let lastPointerX = 0;
  let lastPointerY = 0;
  /** @type {number | null} */
  let autoScrollRaf = null;
  /** Texto lido por leitores de ecrã depois de uma reordenação por teclado. */
  let reorderAnnouncement = '';

  let showClearDialog = false;
  let isExpanded = false;
  let isOpeningTabs = false;
  let isGeneratingFolheto = false;

  function triggerDragHaptic() {
    // Mesma convenção do GestureButton: só vibra onde existe, e curto.
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(30);
    }
  }

  /** Retângulo da lista: fronteira do gesto e referência do auto-scroll. */
  function getListBounds() {
    return listEl ? listEl.getBoundingClientRect() : null;
  }

  function stopAutoScroll() {
    if (autoScrollRaf !== null) {
      cancelAnimationFrame(autoScrollRaf);
      autoScrollRaf = null;
    }
  }

  /**
   * Recalcula o alvo a partir da última posição conhecida do ponteiro. É
   * preciso um cálculo separado do `pointermove` porque durante o auto-scroll
   * a lista mexe-se debaixo de um dedo que está parado: sem isto o alvo ficava
   * congelado no chip que ali estava quando o dedo chegou.
   */
  function refreshDragTarget() {
    if (draggedIndex === null) return;
    const rects = chipEls
      .slice(0, $carousel.length)
      .map((el) => (el ? el.getBoundingClientRect() : null));
    const target = resolveTargetIndex(
      rects,
      { x: lastPointerX, y: lastPointerY },
      isExpanded ? 'y' : 'x',
      getListBounds()
    );
    dragOverIndex = target !== null && target !== draggedIndex ? target : null;
  }

  /**
   * Enquanto o ponteiro estiver junto a uma borda, a lista rola sozinha. Sem
   * isto o arrasto só alcança os chips visíveis, e numa playlist longa o
   * utilizador teria de largar, rolar e voltar a pegar — que é exatamente a
   * dificuldade que este trabalho veio resolver.
   */
  function tickAutoScroll() {
    autoScrollRaf = null;
    if (draggedIndex === null || !dragMoved || !listEl) return;

    const velocity = computeAutoScrollVelocity(
      { x: lastPointerX, y: lastPointerY },
      getListBounds(),
      isExpanded ? 'y' : 'x'
    );

    if (velocity !== 0) {
      const antes = isExpanded ? listEl.scrollTop : listEl.scrollLeft;
      if (isExpanded) {
        listEl.scrollTop = antes + velocity;
      } else {
        listEl.scrollLeft = antes + velocity;
      }
      const depois = isExpanded ? listEl.scrollTop : listEl.scrollLeft;
      // A lista no fim não rola: os retângulos são os mesmos de há um frame e
      // reavaliar o alvo daria o mesmo resultado. Poupa-se o cálculo, não o
      // frame.
      if (depois !== antes) refreshDragTarget();
    }

    // O reagendamento é incondicional de propósito. Um dedo parado junto à
    // borda não emite `pointermove`, por isso este ciclo é a única coisa que
    // pode acordar sozinho quando o que estava a travar a rolagem deixa de
    // travar — o fim da lista afasta-se assim que uma reordenação muda a
    // extensão do scroll. Parar aqui deixaria a rolagem morta até o utilizador
    // mexer o dedo. Quem termina o ciclo é o fim do gesto: `pointerup`,
    // `pointercancel`, `Escape` e `onDestroy` chamam todos `stopAutoScroll`.
    autoScrollRaf = requestAnimationFrame(tickAutoScroll);
  }

  function startAutoScrollIfNeeded() {
    if (autoScrollRaf === null && draggedIndex !== null && dragMoved) {
      autoScrollRaf = requestAnimationFrame(tickAutoScroll);
    }
  }

  // Esvaziar a playlist a meio de um arrasto desmonta o componente com um
  // frame ainda agendado; sem isto ele acordaria sobre um listEl já morto.
  onDestroy(stopAutoScroll);

  /**
   * Larga a captura e apaga o estado do gesto. Chamada tanto no fim normal
   * como quando o browser cancela o arrasto — nunca reordena por si.
   */
  function finishPointerDrag() {
    stopAutoScroll();
    if (capturingEl && activePointerId !== null) {
      try {
        if (typeof capturingEl.hasPointerCapture === 'function' && capturingEl.hasPointerCapture(activePointerId)) {
          capturingEl.releasePointerCapture(activePointerId);
        }
      } catch (_) {
        /* a alça já pode ter saído do DOM; não há nada a libertar */
      }
    }
    activePointerId = null;
    capturingEl = null;
    draggedIndex = null;
    dragOverIndex = null;
    dragMoved = false;
  }

  /**
   * @param {PointerEvent & { currentTarget: EventTarget & HTMLElement }} event
   * @param {number} index
   */
  function handleHandlePointerDown(event, index) {
    // Só o toque/botão principal arrasta: o segundo dedo de um pinch ou o
    // botão direito do rato não devem sequestrar a lista.
    if (event.isPrimary === false) return;
    if (typeof event.button === 'number' && event.button > 0) return;
    if (activePointerId !== null) return;

    activePointerId = event.pointerId;
    draggedIndex = index;
    dragOverIndex = null;
    dragMoved = false;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;

    capturingEl = event.currentTarget;
    try {
      // Sem captura o gesto morria assim que o dedo saísse da alça de 44px.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch (_) {
      // Se o browser recusar, os handlers na window ainda apanham o gesto.
      capturingEl = null;
    }

    // Corta a seleção de texto do rato e o arrasto fantasma; com
    // touch-action: none na alça, o toque também chega aqui cancelável.
    if (event.cancelable) event.preventDefault();

    // O preventDefault acima leva à frente os eventos de compatibilidade, e
    // com eles o foco. Sem isto, quem clica na alça com o rato e conta usar as
    // setas a seguir teria de lá voltar por Tab.
    event.currentTarget.focus({ preventScroll: true });
  }

  /**
   * @param {PointerEvent} event
   */
  function handleWindowPointerMove(event) {
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    if (draggedIndex === null) return;

    if (!dragMoved) {
      if (!hasPassedDragThreshold(event.clientX - pointerStartX, event.clientY - pointerStartY)) return;
      dragMoved = true;
      triggerDragHaptic();
    }

    lastPointerX = event.clientX;
    lastPointerY = event.clientY;

    // A geometria é medida a cada movimento e não no início: a lista pode ter
    // rolado entretanto, e um retângulo velho apontaria para o chip errado.
    refreshDragTarget();
    startAutoScrollIfNeeded();
  }

  /**
   * @param {PointerEvent} event
   */
  function handleWindowPointerUp(event) {
    if (activePointerId === null || event.pointerId !== activePointerId) return;

    const from = draggedIndex;
    const to = dragOverIndex;
    const moved = dragMoved;
    finishPointerDrag();

    // `to` é null quando se largou fora da lista: é a desistência, e o gesto
    // acaba sem tocar na ordem — como acontecia com o drag-and-drop nativo.
    if (moved && from !== null && to !== null && from !== to) {
      carousel.reorderCarousel(from, to);
    }
  }

  /**
   * @param {PointerEvent} event
   */
  function handleWindowPointerCancel(event) {
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    // O browser tirou-nos o gesto a meio: desiste sem mexer na ordem.
    finishPointerDrag();
  }

  /**
   * @param {Event} event
   */
  function handleWindowContextMenu(event) {
    // Só enquanto um arrasto está em curso. É este menu que, hoje, aparece a
    // meio do gesto e o interrompe; fora do arrasto não há razão para o tirar.
    if (draggedIndex !== null) event.preventDefault();
  }

  /**
   * Escape desiste do arrasto. Com o rato, largar fora da lista obriga a
   * arrastar até lá; a tecla é a saída imediata, e é o que qualquer um tenta
   * primeiro quando se arrependeu a meio.
   * @param {KeyboardEvent} event
   */
  function handleWindowKeydown(event) {
    if (draggedIndex === null || event.key !== 'Escape') return;
    event.preventDefault();
    // finishPointerDrag limpa activePointerId, por isso o pointerup que vier a
    // seguir sai logo à entrada e não reordena nada.
    finishPointerDrag();
  }

  /**
   * Reordenação por teclado: a alça é um botão focável e as setas movem o chip.
   * Sem isto, tirar o `draggable` deixaria a lista sem qualquer forma de
   * reordenar sem rato nem dedo — e o `draggable` também nunca respondeu ao
   * teclado, portanto isto é mais do que havia.
   * @param {KeyboardEvent} event
   * @param {number} index
   */
  async function handleHandleKeydown(event, index) {
    // Prevenir antes de saber se há movimento possível: uma seta no primeiro
    // chip não move nada, mas se não for consumida rola a página, e o
    // utilizador perde de vista a lista que estava a arrumar.
    if (!isReorderKey(event.key)) return;
    event.preventDefault();

    const total = $carousel.length;
    const target = computeKeyboardTarget(index, event.key, total);
    if (target === null) return;

    const nome = $carousel[index]?.nome || 'Louvor';
    carousel.reorderCarousel(index, target);

    // O {#each} não é chaveado: os nós ficam onde estão e só o conteúdo troca,
    // por isso o foco tem de seguir o chip até à nova posição.
    await tick();
    dragHandleEls[target]?.focus();

    // O anúncio vem depois do foco de propósito. Escrito antes, vários
    // leitores de ecrã descartam-no quando o foco muda logo a seguir, e o
    // aria-label da nova alça passa-lhe por cima.
    await tick();
    reorderAnnouncement = `${nome} movido para a posição ${target + 1} de ${total}.`;
  }

  /**
   * @param {{ pdfId: string; nome: any; categoria: any; classificacao: any; pdf: string | undefined; }} louvor
   */
  async function openPdfFromChip(louvor) {
    // A tranca contra o duplo toque é de estado, e não o `pointer-events:
    // none` que as classes .checking/.processing traziam — foi esse padrão que
    // produziu o bug dos dois cliques noutro sítio da app. Aqui vale para
    // todos os modos, e não só para o `leitor`.
    //
    // A tranca é da lista inteira, e não só do chip tocado como era com o
    // `pointer-events: none`. É deliberado, por duas razões. A primeira é que
    // `checkingPdfId` e `processingPdfId` guardam um pdfId cada, e não um
    // conjunto: com dois chips ocupados ao mesmo tempo, o primeiro a terminar
    // limpa o estado do segundo, e o segundo perde o indicador de
    // "Compartilhando…/Baixando…" com o trabalho ainda a correr. Estreitar a
    // guarda a `=== louvor.pdfId` obriga, para ser coerente, a trocar também
    // estes dois campos por conjuntos — não se faz uma coisa sem a outra. A
    // segunda é que evita dois downloads do mesmo tamanho em paralelo numa
    // ligação móvel.
    //
    // Não é o estado de espera que bloqueou a interface no bug anterior: ali o
    // `pointer-events: none` matava o elemento e exigia um segundo clique para
    // o acordar; aqui cada ramo liberta o estado num `finally`, e o
    // `fetchPdfAsBlob` traz timeout de rede, portanto a espera tem fim
    // garantido.
    if (checkingPdfId !== null || processingPdfId !== null) return;

    const pdfPath = getPdfRelPath(louvor);
    const mode = $pdfViewer;
    pdfError = null;

    // Um pdfId corrompido dava, conforme o modo, uma aba com "/undefined" ou
    // um download de um ficheiro que não existe. O banner de erro já cá
    // estava; só lhe faltava quem o escrevesse fora do ramo do leitor.
    //
    // A mensagem vem do `navigateLouvorToLeitor` e não de uma constante daqui:
    // é a mesma condição que o `LouvorCard` já reporta com ela, e o utilizador
    // não deve ler diagnósticos diferentes conforme tenha tocado num chip da
    // playlist ou num cartão da lista.
    if (!pdfPath) {
      pdfError = ERRO_IDENTIFICADOR_INVALIDO;
      return;
    }

    if (mode === 'leitor') {
      checkingPdfId = louvor.pdfId;
      try {
        const result = await navigateLouvorToLeitor(louvor);
        if (!result.navigated && result.error) {
          pdfError = result.error;
        }
      } finally {
        checkingPdfId = null;
      }
      return;
    }
    
    if (mode === 'newtab') {
      await openPdfNewTabOfflineFirst(`/${pdfPath}`, louvor.pdf);
      return;
    }
    if (mode === 'online') {
      const readerUrl = buildOnlineReaderUrl(pdfPath);
      window.open(readerUrl, '_blank', 'noopener');
      return;
    }
    if (mode === 'share') {
      processingPdfId = louvor.pdfId;
      try {
        const blob = await fetchPdfAsBlob(pdfPath);
        await sharePdf(blob, louvor.pdf, louvor.nome);
      } catch (_) {
        // @ts-ignore
        window.open(pdfPath, '_blank');
      } finally {
        processingPdfId = null;
      }
      return;
    }
    if (mode === 'save') {
      processingPdfId = louvor.pdfId;
      try {
        const blob = await fetchPdfAsBlob(pdfPath);
        await savePdf(blob, louvor.pdf);
      } catch (_) {
        const a = document.createElement('a');
        // @ts-ignore
        a.href = pdfPath;
        // @ts-ignore
        a.download = louvor.pdf;
        a.click();
      } finally {
        processingPdfId = null;
      }
      return;
    }
    
    // @ts-ignore
    window.location.href = pdfPath;
  }
  
  // @ts-ignore
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

  // --- Saved state detection (reactive against both $carousel and $savedPlaylists) ---

  let showCopiedMessage = false;
  let isSaving = false;

  $: currentPdfIds = $carousel
    .map(/** @type {{ pdfId: any; }} */ l => l.pdfId)
    .filter(/** @type {any} */ id => id != null && id !== '');

  $: currentHash = currentPdfIds.join(',');

  // Reacts to changes in $carousel (via currentHash) AND $savedPlaylists store
  $: savedPlaylistMatch = currentHash !== ''
    ? ($savedPlaylists.find(/** @type {{ pdfIds: string[]; }} */ p => p.pdfIds.join(',') === currentHash) || null)
    : null;

  $: isPlaylistSaved = savedPlaylistMatch !== null;
  $: canSave = $carousel.length > 0 && !isPlaylistSaved && !isSaving;
  $: canShare = $carousel.length > 0;

  // --- Playlist name truncation ---

  /**
   * @param {string | null | undefined} name
   */
  function truncateDesktop(name) {
    if (!name) return '';
    if (name.length > 25) return name.slice(0, 22) + '...';
    return name;
  }

  /**
   * @param {string | null | undefined} name
   */
  function truncateMobile(name) {
    if (!name) return '';
    if (name.length > 10) return name.slice(0, 7) + '...';
    return name;
  }

  // --- Save ---

  function generateDefaultPlaylistName() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `lista ${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  }

  function handleSave() {
    if (isSaving || !$carousel.length || isPlaylistSaved) return;
    isSaving = true;
    
    const pdfIds = $carousel
      .map(/** @type {{ pdfId: any; }} */ l => l.pdfId)
      .filter(/** @type {any} */ id => id != null && id !== '');
    
    if (pdfIds.length === 0) {
      isSaving = false;
      return;
    }
    
    const playlistId = savedPlaylists.savePlaylist(pdfIds);
    goto(`/listas?editId=${playlistId}`);
    
    setTimeout(() => {
      isSaving = false;
    }, 0);
  }
  
  function handleSaveClick() {
    handleSave();
  }

  // --- Share ---

  async function handleShare() {
    if (!$carousel.length) return;
    
    const pdfIds = $carousel.map(/** @type {{ pdfId: any; }} */ l => l.pdfId);
    const playlistName = savedPlaylistMatch?.nome || generateDefaultPlaylistName();
    const shareUrl = generatePlaylistShareUrl(pdfIds, playlistName);
    
    try {
      // @ts-ignore – sharePlaylistLink can return { copied: boolean } despite void typing
      const result = await sharePlaylistLink(shareUrl, playlistName);
      // @ts-ignore
      if (result && result.copied) {
        showCopiedMessage = true;
        setTimeout(() => {
          showCopiedMessage = false;
        }, 2000);
      }
    } catch (error) {
      console.error('Erro ao compartilhar playlist:', error);
    }
  }

  // --- Clear (with confirmation dialog) ---

  function handleClearRequest() {
    showClearDialog = true;
  }

  function handleClearConfirm() {
    showClearDialog = false;
    carousel.clearCarousel();
  }

  function handleClearCancel() {
    showClearDialog = false;
  }

  // --- Open all in tabs ---

  function handleOpenInTabs() {
    if (!$carousel.length || isOpeningTabs) return;

    const mode = $pdfViewer;
    // share/save don't map to "open in tab" — fall back to leitor
    const effectiveMode = (mode === 'share' || mode === 'save') ? 'leitor' : mode;

    isOpeningTabs = true;

    for (const louvor of $carousel) {
      const pdfPath = getPdfRelPath(louvor);
      if (!pdfPath) continue;

      if (effectiveMode === 'leitor') {
        const fileParam = encodeURIComponent(`/${pdfPath}`);
        const tituloParam = encodeURIComponent(louvor.nome || '');
        const subtituloText = `${louvor.categoria || ''} | ${louvor.classificacao || ''}`.trim();
        const subtituloParam = encodeURIComponent(subtituloText);
        window.open(
          `/leitor?file=${fileParam}&titulo=${tituloParam}&subtitulo=${subtituloParam}`,
          '_blank',
          'noopener'
        );
      } else if (effectiveMode === 'newtab') {
        window.open(
          new URL(`/${pdfPath}`, window.location.origin).href,
          '_blank',
          'noopener'
        );
      } else if (effectiveMode === 'online') {
        window.open(buildOnlineReaderUrl(pdfPath), '_blank', 'noopener');
      }
    }

    setTimeout(() => { isOpeningTabs = false; }, 500);
  }

  // --- Expand / collapse ---

  function handleExpandToggle() {
    isExpanded = !isExpanded;
    // O eixo da lista muda debaixo dos pés do gesto; mais vale desistir dele.
    finishPointerDrag();
  }

  async function handleFolheto() {
    if (!$carousel.length || isGeneratingFolheto) return;
    isGeneratingFolheto = true;

    try {
      const louvores = $carousel.map(l => ({ nome: l.nome, numero: l.numero }));
      const playlistName = savedPlaylistMatch?.nome || generateDefaultPlaylistName();
      const html = generateFolhetoHtml(louvores);
      const imageBlob = await generateFolhetoImage(html);
      const pdfIds = $carousel.map(l => l.pdfId);
      const shareUrl = generatePlaylistShareUrl(pdfIds, playlistName);
      await shareFolheto(imageBlob, shareUrl, playlistName);
    } catch (error) {
      console.error('Erro ao gerar folheto:', error);
    } finally {
      isGeneratingFolheto = false;
    }
  }
</script>

<!--
  Os handlers de movimento vivem na window e não na alça: a captura de ponteiro
  já reencaminha os eventos para a alça, mas se o browser recusar a captura o
  gesto continua a chegar aqui. Todos saem logo à entrada quando não há arrasto.
-->
<svelte:window
  on:pointermove={handleWindowPointerMove}
  on:pointerup={handleWindowPointerUp}
  on:pointercancel={handleWindowPointerCancel}
  on:contextmenu={handleWindowContextMenu}
  on:keydown={handleWindowKeydown}
/>

{#if $carousel.length > 0}
  <div class="w-full max-w-4xl mx-auto p-4 bg-card-color rounded-lg border-2 relative carousel-container">

    <!-- Left label group: "Playlist" + saved name box -->
    <div class="left-tags-group">
      <span class="container-tag">Playlist</span>
      {#if savedPlaylistMatch}
        <span class="container-tag playlist-name-tag" title={savedPlaylistMatch.nome}>
          <span class="name-desktop">{truncateDesktop(savedPlaylistMatch.nome)}</span>
          <span class="name-mobile">{truncateMobile(savedPlaylistMatch.nome)}</span>
        </span>
      {/if}
    </div>

    <!-- Action buttons group -->
    <div class="action-buttons-group">
      <button
        on:click={handleShare}
        class="action-button-tag light-button"
        title="Compartilhar playlist"
        disabled={!canShare}
      >
        <Share2 class="w-3 h-3" />
        <span>Compartilhar</span>
      </button>

      <GestureButton
        on:click={handleSaveClick}
        visualFeedback={true}
        hapticFeedback={true}
        disabled={!canSave}
        preventDefault={true}
      >
        <div
          class="action-button-tag light-button"
          class:saved={isPlaylistSaved}
          class:disabled={!canSave}
          title={isPlaylistSaved ? 'Playlist já salva' : isSaving ? 'Salvando...' : 'Toque para salvar'}
        >
          {#if isPlaylistSaved}
            <Check class="w-3 h-3" />
            <span>Salvo</span>
          {:else if isSaving}
            <Save class="w-3 h-3" />
            <span>Salvando...</span>
          {:else}
            <Save class="w-3 h-3" />
            <span>Salvar</span>
          {/if}
        </div>
      </GestureButton>

      <button
        on:click={handleOpenInTabs}
        class="action-button-tag light-button"
        title="Abrir todos em novas abas"
        disabled={isOpeningTabs}
      >
        <ExternalLink class="w-3 h-3" />
        <span>Em Abas</span>
      </button>

      <button
        on:click={handleFolheto}
        class="action-button-tag light-button"
        title="Gerar folheto"
        disabled={!canShare || isGeneratingFolheto}
      >
        <FileText class="w-3 h-3" />
        <span>Folheto</span>
      </button>

      <button
        on:click={handleExpandToggle}
        class="action-button-tag light-button"
        title={isExpanded ? 'Encolher lista' : 'Expandir lista'}
      >
        {#if isExpanded}
          <ChevronUp class="w-3 h-3" />
          <span>Encolher</span>
        {:else}
          <ChevronDown class="w-3 h-3" />
          <span>Expandir</span>
        {/if}
      </button>

      <button
        on:click={handleClearRequest}
        class="action-button-tag clear-button-tag clear-button-spacer"
        title="Limpar todos"
      >
        <Trash2 class="w-3 h-3" />
        <span>Limpar</span>
      </button>
    </div>

    {#if showCopiedMessage}
      <div class="copied-message">Link copiado!</div>
    {/if}
    
    {#if pdfError}
      <div class="pdf-error-banner" role="alert">
        {pdfError}
      </div>
    {/if}

    <div
      bind:this={listEl}
      class="carousel-chips-list"
      class:expanded={isExpanded}
      role="list"
      aria-label="Louvores na lista atual"
    >
      {#each $carousel as louvor, index}
        {@const categoryIcon = getCategoryIcon(louvor.categoria)}
        <div
          bind:this={chipEls[index]}
          class="carousel-chip"
          class:dragging={draggedIndex === index && dragMoved}
          class:drag-over={dragOverIndex === index}
          class:checking={checkingPdfId === louvor.pdfId}
          class:processing={processingPdfId === louvor.pdfId}
          role="listitem"
        >
          <button
            type="button"
            bind:this={dragHandleEls[index]}
            class="drag-handle"
            on:pointerdown={(e) => handleHandlePointerDown(e, index)}
            on:keydown={(e) => handleHandleKeydown(e, index)}
            on:contextmenu|preventDefault
            title="Arraste para reordenar"
            aria-label={`Mover ${louvor.nome || 'louvor'}: posição ${index + 1} de ${$carousel.length}. Use as setas para reordenar.`}
          >
            <GripVertical class="w-4 h-4" />
          </button>
          <button
            type="button"
            class="chip-content"
            on:click={() => openPdfFromChip(louvor)}
          >
            <div class="chip-title">
              <strong>#{louvor.numero || 'N/A'}</strong> - {louvor.nome || 'Sem título'}
              {#if processingPdfId === louvor.pdfId}
                <span class="processing-indicator">
                  {#if $pdfViewer === 'share'}Compartilhando...{:else if $pdfViewer === 'save'}Baixando...{/if}
                </span>
              {/if}
            </div>
            <div class="chip-subtitles">
              <div class="chip-classification">
                {louvor.classificacao || 'Sem classificação'}
              </div>
              <div class="chip-category">
                {#if categoryIcon}
                  <svg class="category-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={categoryIcon} />
                  </svg>
                {/if}
                <span>{louvor.categoria || 'Sem categoria'}</span>
              </div>
            </div>
          </button>
          <button
            on:click|stopPropagation={() => carousel.removeLouvor(louvor.pdfId)}
            class="chip-remove-button"
            title="Remover"
            aria-label={`Remover ${louvor.nome || 'louvor'} da lista`}
          >
            <X class="w-3 h-3" />
          </button>
        </div>
      {/each}
    </div>

    <!--
      Quem reordena por teclado não vê os chips saltarem; sem este anúncio a
      única confirmação de que a tecla fez alguma coisa seria o silêncio.
    -->
    <div class="visually-hidden" role="status" aria-live="polite">{reorderAnnouncement}</div>

    <ConfirmDialog
      show={showClearDialog}
      title="Limpar Playlist"
      message="Tem certeza que deseja remover todos os louvores da playlist?"
      confirmLabel="Limpar"
      cancelLabel="Cancelar"
      onConfirm={handleClearConfirm}
      onCancel={handleClearCancel}
    />
  </div>
{/if}

<style>
  .carousel-container {
    position: relative;
    border-color: var(--gold-color);
  }

  /* Visível só para leitores de ecrã (anúncio da reordenação por teclado). */
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  /* ---- Left label group ---- */

  .left-tags-group {
    position: absolute;
    top: -0.875rem;
    left: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    z-index: 10;
  }
  
  .container-tag {
    background-color: var(--card-color);
    color: var(--text-dark);
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    border: 2px solid var(--gold-color);
    line-height: 1;
    white-space: nowrap;
  }

  .playlist-name-tag {
    color: var(--gold-color);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .name-desktop {
    display: inline;
  }

  .name-mobile {
    display: none;
  }

  @media (max-width: 640px) {
    .name-desktop {
      display: none;
    }
    .name-mobile {
      display: inline;
    }
  }

  /* ---- Action buttons group ---- */
  
  .action-buttons-group {
    position: absolute;
    top: -0.875rem;
    right: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    z-index: 10;
  }

  .action-button-tag {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    border: 2px solid rgba(0,0,0,0.2);
    cursor: pointer;
    transition: all 0.2s ease;
    line-height: 1;
  }

  /* Extra left margin to make accidental clicks harder */
  .clear-button-spacer {
    margin-left: 0.75rem;
  }

  .light-button {
    background-color: var(--card-color);
    color: var(--text-dark);
  }

  .light-button:disabled,
  .light-button.disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  @media (hover: hover) and (pointer: fine) {
    .light-button:hover:not(:disabled) {
      background-color: var(--placeholder-color);
      transform: translateY(-1px);
    }
    
    .light-button.saved:hover:not(:disabled) {
      background-color: rgba(212, 175, 55, 0.3);
    }
  }

  @media (hover: none) and (pointer: coarse) {
    .light-button:active:not(:disabled) {
      background-color: var(--placeholder-color);
      transform: translateY(-1px);
    }
    
    .light-button.saved:active:not(:disabled) {
      background-color: rgba(212, 175, 55, 0.3);
    }
  }

  .light-button.saved {
    background-color: var(--card-color) !important;
    border-color: var(--gold-color);
    color: var(--gold-color);
  }
  
  .light-button.saved:disabled,
  .light-button.saved.disabled,
  .action-button-tag.light-button.saved {
    background-color: var(--card-color) !important;
    opacity: 0.8;
  }

  .clear-button-tag {
    background-color: var(--title-color);
    color: var(--placeholder-color);
  }
  
  .clear-button-tag:hover {
    background-color: var(--title-color);
    opacity: 0.9;
    transform: translateY(-1px);
  }

  /* ---- Responsive: smaller gap + icon-only on very small screens ---- */

  @media (max-width: 640px) {
    .action-buttons-group {
      gap: 0.25rem;
    }
    .action-button-tag {
      padding: 0.2rem 0.375rem;
    }
    .clear-button-spacer {
      margin-left: 0.375rem;
    }
  }

  @media (max-width: 480px) {
    .action-button-tag span {
      display: none;
    }
  }

  /* ---- Copied message ---- */

  .copied-message {
    position: absolute;
    top: -2.5rem;
    right: 0.75rem;
    background-color: var(--title-color);
    color: var(--placeholder-color);
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    border: 2px solid var(--gold-color);
    z-index: 20;
    animation: fadeInOut 2s ease;
  }

  @keyframes fadeInOut {
    0%, 100% { opacity: 0; transform: translateY(-5px); }
    10%, 90% { opacity: 1; transform: translateY(0); }
  }
  
  /* ---- Chips list (horizontal default, vertical when expanded) ---- */

  .carousel-chips-list {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 5px 0;
    flex-wrap: nowrap;
    scrollbar-width: thin;
    scrollbar-color: var(--gold-color) transparent;
  }

  .carousel-chips-list.expanded {
    flex-direction: column;
    overflow-x: hidden;
    overflow-y: auto;
    flex-wrap: nowrap;
    max-height: 70vh;
  }
  
  .carousel-chips-list::-webkit-scrollbar {
    height: 6px;
  }
  
  .carousel-chips-list::-webkit-scrollbar-track {
    background: transparent;
  }
  
  .carousel-chips-list::-webkit-scrollbar-thumb {
    background: var(--gold-color);
    border-radius: 3px;
  }

  /* ---- Chip base ---- */
  
  .carousel-chip {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: fit-content;
    max-width: 200px;
    padding: 0.5rem 0.75rem;
    background-color: var(--title-color);
    border: 2px solid var(--gold-color);
    border-radius: 1.25rem;
    box-shadow: var(--shadow-md);
    transition: all 0.2s ease;
    cursor: pointer;
    flex-shrink: 0;
    position: relative;
    /* Segurar o dedo sobre um chip não pode oferecer "copiar"/"partilhar":
       esse menu aparecia a meio do arrasto e levava o gesto com ele. Note-se
       que aqui NÃO há touch-action — o corpo do chip tem de continuar a rolar
       a lista na horizontal. */
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }

  .carousel-chip:hover {
    box-shadow: var(--shadow-lg);
    transform: translateY(-1px);
  }
  
  .carousel-chip.dragging {
    opacity: 0.5;
    cursor: grabbing;
  }
  
  .carousel-chip.drag-over {
    border-color: var(--gold-light);
    box-shadow: 0 0 0 2px var(--gold-light);
    transform: scale(1.05);
  }

  /* ---- Expanded mode: chips grow 25% and fill full width ---- */

  .carousel-chips-list.expanded .carousel-chip {
    min-width: unset;
    max-width: 100%;
    padding: 0.625rem 0.9375rem;
  }

  /* Vertical drag-over indicator */
  .carousel-chips-list.expanded .carousel-chip.drag-over {
    transform: translateY(-2px);
    border-top-color: var(--gold-light);
    box-shadow: 0 -2px 0 var(--gold-light), 0 0 0 2px var(--gold-light);
  }

  /* ---- Drag handle ---- */

  .drag-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-light);
    opacity: 0.6;
    cursor: grab;
    flex-shrink: 0;
    padding: 0.125rem;
    transition: opacity 0.2s ease;
    /* Passou a <button> para ser focável e responder ao teclado; o reset
       devolve-lhe o aspeto do <div> que era. */
    background: none;
    border: none;
    font: inherit;
    /* A alça fica com o gesto todo. Só aqui — o corpo do chip mantém o
       touch-action por omissão para o dedo continuar a rolar a lista. */
    touch-action: none;
    /* Sem isto, segurar sobre a alça chama o menu nativo de seleção/partilha,
       que é exatamente o que rouba o arrasto hoje. */
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
    /* Ancora o alvo de toque ampliado abaixo. */
    position: relative;
    min-width: 1.75rem;
    /* Sem isto a alça teria só a altura do ícone (20px) e o alvo de toque
       ficaria curto; esticada, acompanha a altura do conteúdo do chip. */
    align-self: stretch;
  }

  /* Alvo de toque de 44x44 sem aumentar o ícone: na largura, os 28px da alça
     mais 12px para dentro do padding esquerdo do chip e 4px à direita; na
     altura, os ~32px do conteúdo do chip mais 10px de cada lado, que cabem no
     padding vertical. */
  .drag-handle::before {
    content: '';
    position: absolute;
    top: -0.625rem;
    bottom: -0.625rem;
    left: -0.75rem;
    right: -0.25rem;
  }

  .drag-handle:active {
    cursor: grabbing;
  }

  .carousel-chip.dragging .drag-handle {
    cursor: grabbing;
  }

  .drag-handle:focus-visible {
    outline: 2px solid var(--gold-light);
    outline-offset: 2px;
    opacity: 1;
  }

  .carousel-chip:hover .drag-handle {
    opacity: 1;
  }

  /* ---- Chip content ---- */

  .chip-content {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 0.125rem;
    flex: 1;
    /* Passou a <button> para abrir o louvor com Enter/Espaço — antes o clique
       vivia num <div> e o teclado não tinha por onde entrar. O reset mantém a
       herança de tipo de letra e cor que o <div> dava aos filhos. */
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    text-align: left;
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    color: inherit;
    cursor: pointer;
  }

  .chip-content:focus-visible {
    outline: 2px solid var(--gold-light);
    outline-offset: 2px;
    border-radius: 0.25rem;
  }

  .chip-title {
    font-size: 0.875rem;
    font-family: 'Garamond', serif;
    font-weight: 700;
    color: var(--text-light);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .carousel-chips-list.expanded .chip-title {
    font-size: 1.09375rem;
    white-space: normal;
  }
  
  .chip-subtitles {
    display: flex;
    flex-direction: row;
    gap: 0.375rem;
    align-items: center;
  }
  
  .chip-subtitles::after {
    content: '';
    width: 1px;
    height: 0.75rem;
    background-color: var(--text-light);
    opacity: 0.3;
  }
  
  .chip-classification {
    font-size: 0.7rem;
    color: var(--text-light);
    opacity: 0.85;
    line-height: 1.2;
    white-space: nowrap;
  }

  .carousel-chips-list.expanded .chip-classification {
    font-size: 0.875rem;
  }
  
  .chip-category {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.7rem;
    color: var(--text-light);
    opacity: 0.85;
    line-height: 1.2;
    white-space: nowrap;
  }

  .carousel-chips-list.expanded .chip-category {
    font-size: 0.875rem;
  }
  
  .category-icon {
    width: 0.75rem;
    height: 0.75rem;
    color: var(--text-light);
    flex-shrink: 0;
  }

  .carousel-chips-list.expanded .category-icon {
    width: 0.9375rem;
    height: 0.9375rem;
  }
  
  /* ---- Remove button ---- */

  .chip-remove-button {
    background-color: var(--card-color);
    color: var(--text-dark);
    border: none;
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    width: 1.25rem;
    height: 1.25rem;
    flex-shrink: 0;
  }
  
  .chip-remove-button:hover {
    background-color: var(--gold-light);
    transform: scale(1.1);
  }

  /* ---- Loading states ---- */

  /* O que saiu daqui foi só o `pointer-events: none` — o padrão que produziu o
     bug dos dois cliques noutro sítio da app. O feedback fica: abrir no leitor
     pode ir à rede, e um chip que não muda nada durante a espera parece um
     toque que se perdeu. A proteção contra o duplo toque passou a ser um
     guarda de estado em openPdfFromChip, que tranca sem ser armadilha. */
  .carousel-chip.checking,
  .carousel-chip.processing {
    opacity: 0.6;
    cursor: wait;
  }

  .processing-indicator {
    display: inline-block;
    margin-left: 0.5rem;
    font-size: 0.7rem;
    opacity: 0.8;
    font-weight: 400;
    color: var(--gold-color);
  }

  /* ---- PDF error ---- */

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
</style>
