<script>
  import { afterUpdate, onMount, tick } from 'svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { savedPlaylists } from '$lib/stores/savedPlaylists';
  import { carousel } from '$lib/stores/carousel';
  import { louvores, loadLouvores } from '$lib/stores/louvores';
  import { goto } from '$app/navigation';
  import { Play, Trash2, Share2, Edit2, Check, X, Star, Eye, BookOpen } from 'lucide-svelte';
  import { sharePlaylistLink, generatePlaylistShareUrl } from '$lib/utils/playlistUtils';
  import { navigateLouvorToLeitor } from '$lib/utils/navigateLouvorToLeitor';
  import LouvorCard from '$lib/components/LouvorCard.svelte';

  let editingId = null;
  let editingName = '';
  let originalName = '';
  let showCopiedMessage = false;
  let copiedMessageTimeout = null;
  let isSavingOrCanceling = false;
  let showDeleteModal = false;
  let playlistToDelete = null;
  let showOnlyFavorites = false;
  let searchTerm = '';
  /**
   * @type {HTMLElement | null}
   */
  let filterButtonElement = null;
  /**
   * @type {HTMLElement | null}
   */
  let viewFavoriteButtonElement = null;
  let viewLeitorError = null;
  let openingLeitor = false;

  $: allPlaylists = $savedPlaylists;
  $: viewIdFromUrl = $page.url.searchParams.get('viewId');
  /** Id da playlist em modo ver lista: só válido se existir em allPlaylists e viewId estiver na URL */
  $: viewingPlaylistId =
    viewIdFromUrl && allPlaylists.some((p) => p.id === viewIdFromUrl) ? viewIdFromUrl : null;

  /** Remove viewId inválido da barra de endereços */
  $: if (
    browser &&
    viewIdFromUrl &&
    !allPlaylists.some((p) => p.id === viewIdFromUrl)
  ) {
    const u = new URL($page.url.href);
    u.searchParams.delete('viewId');
    goto(`${u.pathname}${u.search}`, { replaceState: true, noScroll: true });
  }
  $: filteredByFavorite = showOnlyFavorites 
    ? allPlaylists.filter((p) => p.favorita === true)
    : allPlaylists;
  $: normalizedSearchTerm = normalizeText(searchTerm);
  $: playlists = normalizedSearchTerm
    ? filteredByFavorite.filter((p) => normalizeText(p?.nome ?? '').includes(normalizedSearchTerm))
    : filteredByFavorite;
  $: hasActiveSearch = normalizedSearchTerm.length > 0;
  
  // Mapear pdfIds da playlist para objetos louvor
  $: viewingPlaylist = viewingPlaylistId 
    ? allPlaylists.find(p => p.id === viewingPlaylistId)
    : null;
  
  $: viewingPlaylistLouvores = (() => {
    if (!viewingPlaylist || !$louvores.length) return [];
    
    // Criar um Map para busca rápida
    const louvoresMap = new Map();
    $louvores.forEach(louvor => {
      if (louvor.pdfId) {
        louvoresMap.set(louvor.pdfId, louvor);
      }
    });
    
    // Construir array de louvores na ordem dos pdfIds
    return viewingPlaylist.pdfIds
      .map(pdfId => louvoresMap.get(pdfId))
      .filter(louvor => louvor !== undefined);
  })();

  /**
   * Update SVG star attributes directly
   * @param {HTMLElement} element
   * @param {boolean} isFilled
   */
  function updateStarSVG(element, isFilled) {
    if (!element) return;
    const svg = element.querySelector('svg');
    const polygon = svg?.querySelector('polygon');
    if (svg && polygon) {
      if (isFilled) {
        svg.setAttribute('stroke', '#D4AF37');
        svg.setAttribute('fill', '#D4AF37');
        svg.setAttribute('stroke-width', '0');
        polygon.setAttribute('fill', '#D4AF37');
        polygon.setAttribute('stroke', '#D4AF37');
        polygon.setAttribute('stroke-width', '0');
      } else {
        svg.setAttribute('stroke', '#D4AF37');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke-width', '2');
        polygon.setAttribute('fill', 'none');
        polygon.setAttribute('stroke', '#D4AF37');
        polygon.setAttribute('stroke-width', '2');
      }
    }
  }

  function normalizeText(text = '') {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  // Update SVG attributes directly for filter button
  $: if (filterButtonElement && browser) {
    updateStarSVG(filterButtonElement, showOnlyFavorites);
  }

  $: if (viewFavoriteButtonElement && browser && viewingPlaylist) {
    updateStarSVG(viewFavoriteButtonElement, viewingPlaylist.favorita);
  }

  // Update SVG attributes for favorite buttons in cards
  afterUpdate(() => {
    if (browser) {
      // Update filter button
      if (filterButtonElement) {
        updateStarSVG(filterButtonElement, showOnlyFavorites);
      }

      if (viewFavoriteButtonElement && viewingPlaylist) {
        updateStarSVG(viewFavoriteButtonElement, viewingPlaylist.favorita);
      }
      
      // Find all favorite buttons by data attribute and update them
      document.querySelectorAll('.favorite-button svg[data-playlist-id]').forEach((svg) => {
        const playlistId = svg.getAttribute('data-playlist-id');
        const playlist = allPlaylists.find(p => p.id === playlistId);
        const button = svg.closest('.favorite-button');
        if (playlist && button) {
          updateStarSVG(/** @type {HTMLElement} */ (button), playlist.favorita);
        }
      });
    }
  });

  function handlePlay(playlist) {
    // Clear current playlist and load the selected one
    carousel.clearCarousel();
    
    // Load playlist using pdfIds
    if (browser && $louvores.length > 0) {
      carousel.loadPlaylist(playlist.pdfIds, $louvores);
    }
    
    // Navigate to home page
    goto('/');
  }

  function firstResolvedLouvorFromPlaylist(playlist) {
    if (!$louvores.length || !playlist?.pdfIds?.length) return null;
    const map = new Map();
    $louvores.forEach((l) => {
      if (l.pdfId) map.set(l.pdfId, l);
    });
    return playlist.pdfIds.map((id) => map.get(id)).find((l) => l !== undefined) ?? null;
  }

  async function handlePlayOpenLeitor(playlist) {
    viewLeitorError = null;
    if (!browser || $louvores.length === 0) return;

    openingLeitor = true;
    try {
      carousel.clearCarousel();
      carousel.loadPlaylist(playlist.pdfIds, $louvores);
      const firstLouvor = firstResolvedLouvorFromPlaylist(playlist);
      if (!firstLouvor) {
        viewLeitorError = 'Nenhum louvor disponível para abrir no leitor.';
        return;
      }
      const result = await navigateLouvorToLeitor(firstLouvor);
      if (!result.navigated && result.error) {
        viewLeitorError = result.error;
      }
    } finally {
      openingLeitor = false;
    }
  }

  function handleRemove(playlist, event) {
    event.stopPropagation();
    playlistToDelete = playlist;
    showDeleteModal = true;
  }
  
  function confirmDelete() {
    if (playlistToDelete) {
      const deletedId = playlistToDelete.id;
      savedPlaylists.removePlaylist(deletedId);
      if (viewingPlaylistId === deletedId) {
        closeView();
      }
      playlistToDelete = null;
    }
    showDeleteModal = false;
  }
  
  function cancelDelete() {
    playlistToDelete = null;
    showDeleteModal = false;
  }

  async function handleShare(playlist, event) {
    event.stopPropagation();
    const shareUrl = generatePlaylistShareUrl(playlist.pdfIds, playlist.nome);
    
    try {
      const result = await sharePlaylistLink(shareUrl, playlist.nome);
      if (result && result.copied) {
        showCopiedMessage = true;
        if (copiedMessageTimeout) {
          clearTimeout(copiedMessageTimeout);
        }
        copiedMessageTimeout = setTimeout(() => {
          showCopiedMessage = false;
        }, 2000);
      }
    } catch (error) {
      console.error('Erro ao compartilhar playlist:', error);
    }
  }

  function startEdit(playlist, event) {
    if (event) {
      event.stopPropagation();
    }
    editingId = playlist.id;
    editingName = playlist.nome;
    originalName = playlist.nome; // Store original name for cancel
    
    // Select all text after a small delay to ensure input is focused
    setTimeout(() => {
      const input = document.querySelector('.playlist-name-input');
      if (input && input === document.activeElement) {
        input.select();
      }
    }, 10);
  }
  
  function startEditById(playlistId) {
    const playlist = allPlaylists.find(p => p.id === playlistId);
    if (playlist) {
      startEdit(playlist);
    }
  }
  
  function selectAllText(event) {
    event.target.select();
  }

  function cancelEdit(skipFlagCheck = false) {
    // Don't cancel if we're in the process of saving (only when called from blur)
    if (!skipFlagCheck && isSavingOrCanceling) return;
    
    // Restore original name if it was changed
    if (editingId && originalName) {
      savedPlaylists.updatePlaylistName(editingId, originalName);
    }
    editingId = null;
    editingName = '';
    originalName = '';
  }

  function saveEdit(playlistId, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    isSavingOrCanceling = true;
    
    if (editingName.trim()) {
      savedPlaylists.updatePlaylistName(playlistId, editingName.trim());
    }
    editingId = null;
    editingName = '';
    originalName = '';
    
    // Reset flag after a small delay to allow blur to complete
    setTimeout(() => {
      isSavingOrCanceling = false;
    }, 100);
  }
  
  function handleCancelClick(event) {
    event.preventDefault();
    event.stopPropagation();
    isSavingOrCanceling = true;
    cancelEdit(true); // Skip flag check since we're explicitly canceling
    setTimeout(() => {
      isSavingOrCanceling = false;
    }, 100);
  }

  function handleEditKeydown(event, playlistId) {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveEdit(playlistId);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  }

  function handleView(playlist, event) {
    event.stopPropagation();
    if (!browser) return;
    const u = new URL($page.url.href);
    u.searchParams.set('viewId', playlist.id);
    goto(`${u.pathname}${u.search}`, { replaceState: true, noScroll: true });
  }

  function closeView() {
    viewLeitorError = null;
    if (!browser) return;
    if (!$page.url.searchParams.has('viewId')) return;
    const u = new URL($page.url.href);
    u.searchParams.delete('viewId');
    goto(`${u.pathname}${u.search}`, { replaceState: true, noScroll: true });
  }

  onMount(async () => {
    // Carregar louvores se ainda não foram carregados
    if (browser && $louvores.length === 0) {
      await loadLouvores();
    }
    
    await tick();

    // Verificar se há editId na URL para colocar a playlist em modo de edição
    if (browser && $page.url.searchParams.has('editId')) {
      const vid = $page.url.searchParams.get('viewId');
      if (vid && $savedPlaylists.some((p) => p.id === vid)) {
        const u = new URL($page.url.href);
        u.searchParams.delete('editId');
        goto(`${u.pathname}${u.search}`, { replaceState: true, noScroll: true });
        return;
      }

      const editId = $page.url.searchParams.get('editId');
      if (editId) {
        await tick();

        const playlist = $savedPlaylists.find((p) => p.id === editId);
        if (playlist) {
          startEdit(playlist);
        }

        goto('/listas', { replaceState: true, noScroll: true });
      }
    }
  });
</script>

<svelte:head>
  <title>Listas</title>
</svelte:head>

  <div class="max-w-4xl mx-auto">
  <div class="page-body">
    {#if viewingPlaylistId && viewingPlaylist}
      <!-- Seção de Visualização -->
      <div class="view-section">
        <div class="view-header">
          <div class="view-header-main">
            {#if editingId === viewingPlaylist.id}
              <input
                type="text"
                class="playlist-name-input view-title-input"
                bind:value={editingName}
                on:keydown={(e) => handleEditKeydown(e, viewingPlaylist.id)}
                on:blur={cancelEdit}
                on:focus={selectAllText}
                autofocus
              />
              <div class="edit-actions view-title-edit-actions">
                <button
                  class="edit-button save-button"
                  on:mousedown|preventDefault={(e) => {
                    e.preventDefault();
                    saveEdit(viewingPlaylist.id, e);
                  }}
                  title="Salvar"
                >
                  <Check class="w-4 h-4" />
                </button>
                <button
                  class="edit-button cancel-button"
                  on:mousedown|preventDefault={handleCancelClick}
                  title="Cancelar"
                >
                  <X class="w-4 h-4" />
                </button>
              </div>
            {:else}
              <h2
                class="view-title playlist-name"
                on:click={(e) => startEdit(viewingPlaylist, e)}
                title="Clique para editar o nome"
              >
                {viewingPlaylist.nome}
              </h2>
            {/if}
          </div>
          <div class="view-header-toolbar">
            <button
              type="button"
              class="view-icon-danger-button"
              on:click={(e) => handleRemove(viewingPlaylist, e)}
              title="Apagar esta lista"
            >
              <Trash2 class="w-5 h-5" />
            </button>
            <button
              type="button"
              class="favorite-filter-button"
              class:active={viewingPlaylist.favorita}
              on:click={(e) => {
                e.stopPropagation();
                savedPlaylists.toggleFavorite(viewingPlaylist.id);
              }}
              title={viewingPlaylist.favorita ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
              bind:this={viewFavoriteButtonElement}
            >
              <Star class="star-icon" />
            </button>
            <button type="button" class="close-view-button" on:click={closeView} title="Fechar visualização">
              <X class="w-5 h-5" />
            </button>
          </div>
        </div>

        <div class="view-playlist-actions">
          <button
            type="button"
            class="action-button leitor-button"
            disabled={openingLeitor || viewingPlaylistLouvores.length === 0}
            on:click={() => handlePlayOpenLeitor(viewingPlaylist)}
            title="Carregar a lista, abrir o primeiro louvor no leitor"
          >
            <BookOpen class="w-4 h-4" />
            <span>{openingLeitor ? 'A abrir…' : 'Abrir no leitor'}</span>
          </button>
          <button
            type="button"
            class="action-button share-button"
            on:click={(e) => handleShare(viewingPlaylist, e)}
            title="Compartilhar playlist"
          >
            <Share2 class="w-4 h-4" />
            <span>Compartilhar</span>
          </button>
          <button
            type="button"
            class="action-button play-button"
            on:click={() => handlePlay(viewingPlaylist)}
            title="Carregar lista e ir para a página inicial"
          >
            <Play class="w-4 h-4" />
            <span>Editar</span>
          </button>
        </div>

        {#if viewLeitorError}
          <p class="view-leitor-error" role="alert">{viewLeitorError}</p>
        {/if}

        <div class="view-louvores-list">
          {#if viewingPlaylistLouvores.length === 0}
            <div class="empty-view-state">
              <p>Nenhum louvor encontrado nesta playlist.</p>
            </div>
          {:else}
            {#each viewingPlaylistLouvores as louvor, i (louvor.pdfId)}
              <div class="view-louvor-row">
                <div class="view-louvor-card-wrap">
                  <LouvorCard {louvor} titlePrefix={`${i + 1})`} />
                </div>
                <button
                  type="button"
                  class="view-remove-louvor-button"
                  title="Remover desta lista"
                  aria-label="Remover louvor desta lista"
                  on:click|stopPropagation={() =>
                    savedPlaylists.removePdfFromPlaylist(viewingPlaylist.id, louvor.pdfId)}
                >
                  <X class="w-4 h-4" />
                </button>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    {:else}
      <!-- Conteúdo Normal da Página -->
      <div class="page-header">
        <h1 class="page-title">Minhas Playlists</h1>
        <button
          class="favorite-filter-button"
          class:active={showOnlyFavorites}
          on:click={() => showOnlyFavorites = !showOnlyFavorites}
          title={showOnlyFavorites ? 'Mostrar todas as playlists' : 'Mostrar apenas favoritas'}
          bind:this={filterButtonElement}
        >
          <Star class="star-icon" />
        </button>
      </div>

      <div class="search-section">
        <label class="search-label" for="playlist-search">Pesquisar playlists</label>
        <div class="search-input-wrapper">
          <input
            id="playlist-search"
            type="text"
            placeholder="Buscar por nome..."
            bind:value={searchTerm}
            class:has-text={hasActiveSearch}
          />
          {#if hasActiveSearch}
            <button
              type="button"
              class="clear-search"
              on:click={() => (searchTerm = '')}
              title="Limpar pesquisa"
            >
              <X class="w-4 h-4" />
            </button>
          {/if}
        </div>
      </div>
      
      {#if showCopiedMessage}
        <div class="copied-notification">Link copiado!</div>
      {/if}

      {#if playlists.length === 0}
        <div class="empty-state">
          {#if filteredByFavorite.length === 0}
            {#if showOnlyFavorites}
              <p>Você ainda não tem playlists favoritas.</p>
              <p class="empty-hint">Clique na estrela de uma playlist para adicioná-la aos favoritos.</p>
            {:else}
              <p>Você ainda não tem playlists salvas.</p>
              <p class="empty-hint">Crie uma playlist na página inicial e clique em "Salvar" para começar.</p>
            {/if}
          {:else if hasActiveSearch}
            <p>Nenhuma playlist encontrada para "{searchTerm.trim()}".</p>
            <p class="empty-hint">Tente buscar por outro nome ou limpe a pesquisa.</p>
          {:else if showOnlyFavorites}
            <p>Você ainda não tem playlists favoritas.</p>
            <p class="empty-hint">Clique na estrela de uma playlist para adicioná-la aos favoritos.</p>
          {:else}
            <p>Você ainda não tem playlists salvas.</p>
            <p class="empty-hint">Crie uma playlist na página inicial e clique em "Salvar" para começar.</p>
          {/if}
        </div>
      {:else}
        <div class="playlists-grid">
          {#each playlists as playlist (playlist.id)}
            <div class="playlist-card">
              <div class="playlist-header">
                {#if editingId === playlist.id}
                  <input
                    type="text"
                    class="playlist-name-input"
                    bind:value={editingName}
                    on:keydown={(e) => handleEditKeydown(e, playlist.id)}
                    on:blur={cancelEdit}
                    on:focus={selectAllText}
                    autofocus
                  />
                  <div class="edit-actions">
                    <button
                      class="edit-button save-button"
                      on:mousedown|preventDefault={(e) => {
                        e.preventDefault();
                        saveEdit(playlist.id, e);
                      }}
                      title="Salvar"
                    >
                      <Check class="w-4 h-4" />
                    </button>
                    <button
                      class="edit-button cancel-button"
                      on:mousedown|preventDefault={handleCancelClick}
                      title="Cancelar"
                    >
                      <X class="w-4 h-4" />
                    </button>
                  </div>
                {:else}
                  <h2 class="playlist-name" on:click={(e) => startEdit(playlist, e)}>
                    {playlist.nome}
                  </h2>
                  <div class="header-actions">
                    <button
                      class="favorite-button"
                      class:favorited={playlist.favorita}
                      on:click={(e) => {
                        e.stopPropagation();
                        savedPlaylists.toggleFavorite(playlist.id);
                      }}
                      title={playlist.favorita ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                    >
                      <Star class="star-icon-small" data-playlist-id={playlist.id} />
                    </button>
                    <button
                      class="edit-icon-button"
                      on:click={(e) => startEdit(playlist, e)}
                      title="Editar nome"
                    >
                      <Edit2 class="w-4 h-4" />
                    </button>
                  </div>
                {/if}
              </div>
              
              <div class="playlist-info">
                <span class="playlist-count">{playlist.pdfIds.length} {playlist.pdfIds.length === 1 ? 'documento' : 'documentos'}</span>
              </div>
              
              <div class="playlist-actions">
                <button
                  class="action-button play-button"
                  on:click={() => handlePlay(playlist)}
                  title="Reproduzir playlist"
                >
                  <Play class="w-4 h-4" />
                  <span>Reproduzir</span>
                </button>
                <button
                  class="action-button view-button"
                  on:click={(e) => handleView(playlist, e)}
                  title="Ver louvores da playlist"
                >
                  <Eye class="w-4 h-4" />
                  <span>Ver</span>
                </button>
                <button
                  class="action-button share-button"
                  on:click={(e) => handleShare(playlist, e)}
                  title="Compartilhar playlist"
                >
                  <Share2 class="w-4 h-4" />
                  <span>Compartilhar</span>
                </button>
                <button
                  class="action-button remove-button"
                  on:click={(e) => handleRemove(playlist, e)}
                  title="Remover playlist"
                >
                  <Trash2 class="w-4 h-4" />
                  <span>Remover</span>
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</div>

<!-- Delete Confirmation Modal -->
{#if showDeleteModal}
  <div class="modal-overlay" on:click={cancelDelete} on:keydown={(e) => e.key === 'Escape' && cancelDelete()}>
    <div class="modal-content" on:click|stopPropagation>
      <h3 class="modal-title">Confirmar Remoção</h3>
      <p class="modal-message">
        Tem certeza que deseja remover a playlist <strong>{playlistToDelete?.nome}</strong>?
      </p>
      <div class="modal-actions">
        <button
          class="modal-button cancel-button"
          on:click={cancelDelete}
        >
          Cancelar
        </button>
        <button
          class="modal-button confirm-button"
          on:click={confirmDelete}
        >
          Remover
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .max-w-4xl {
    max-width: 56rem;
  }

  .mx-auto {
    margin-left: auto;
    margin-right: auto;
  }

  .page-body {
    padding: 1.5rem;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
    padding-bottom: 0.75rem;
    border-bottom: 2px solid var(--gold-color);
  }

  .page-title {
    font-size: 2rem;
    font-weight: 700;
    color: var(--text-light);
    margin: 0;
  }

  .favorite-filter-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    background: none;
    border: none;
    cursor: pointer;
    transition: all 0.2s ease;
    padding: 0;
  }

  .favorite-filter-button:hover {
    transform: translateY(-1px);
  }

  .favorite-filter-button :global(.star-icon) {
    width: 1.5rem;
    height: 1.5rem;
    transition: all 0.2s ease;
  }

  .favorite-filter-button :global(.star-icon svg),
  .favorite-filter-button :global(.star-icon svg polygon) {
    color: #D4AF37 !important;
    fill: none !important;
    stroke: #D4AF37 !important;
    stroke-width: 2 !important;
  }

  .favorite-filter-button.active :global(.star-icon svg),
  .favorite-filter-button.active :global(.star-icon svg polygon) {
    color: #D4AF37 !important;
    fill: #D4AF37 !important;
    stroke: #D4AF37 !important;
    stroke-width: 0 !important;
  }

  .search-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 2rem;
  }

  .search-label {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-light);
  }

  .search-input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    background-color: var(--card-color);
    border: 2px solid var(--gold-color);
    border-radius: 0.5rem;
    padding: 0.25rem 0.75rem;
    box-shadow: var(--shadow-md);
    transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
  }

  .search-input-wrapper:focus-within {
    border-color: var(--gold-light);
    box-shadow: var(--shadow-lg);
    transform: translateY(-1px);
  }

  .search-input-wrapper input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 1rem;
    color: var(--text-dark);
    padding: 0.5rem 0.25rem;
  }

  .search-input-wrapper input::placeholder {
    color: var(--text-dark);
    opacity: 0.65;
  }

  .search-input-wrapper input.has-text {
    padding-right: 2rem;
  }

  .clear-search {
    position: absolute;
    right: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border: none;
    background: none;
    color: var(--text-dark);
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.2s ease;
  }

  .clear-search:hover {
    opacity: 1;
  }
 
  .copied-notification {
    position: fixed;
    top: 5rem;
    right: 1rem;
    background-color: var(--title-color);
    color: var(--placeholder-color);
    font-size: 0.875rem;
    font-weight: 600;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    border: 2px solid var(--gold-color);
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.3s ease;
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  .empty-state {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--text-light);
  }

  .empty-state p {
    margin: 0.75rem 0;
    font-size: 1.125rem;
    font-weight: 500;
    line-height: 1.6;
  }

  .empty-hint {
    font-size: 1rem;
    opacity: 0.9;
  }

  .playlists-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1.5rem;
  }

  .playlist-card {
    background-color: var(--card-color);
    border: 2px solid var(--gold-color);
    border-radius: 0.5rem;
    padding: 1.25rem;
    transition: all 0.2s ease;
  }

  .playlist-card:hover {
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }

  .playlist-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
    gap: 0.5rem;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .favorite-button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.7;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .favorite-button:hover {
    opacity: 1;
  }

  .favorite-button.favorited {
    opacity: 1;
  }

  .favorite-button :global(.star-icon-small) {
    width: 1.125rem;
    height: 1.125rem;
    transition: all 0.2s ease;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4));
  }

  .favorite-button :global(.star-icon-small svg),
  .favorite-button :global(.star-icon-small svg polygon) {
    color: #D4AF37 !important;
    fill: none !important;
    stroke: #D4AF37 !important;
    stroke-width: 2 !important;
  }

  .favorite-button.favorited :global(.star-icon-small svg),
  .favorite-button.favorited :global(.star-icon-small svg polygon) {
    color: #D4AF37 !important;
    fill: #D4AF37 !important;
    stroke: #D4AF37 !important;
    stroke-width: 0 !important;
  }

  .playlist-name {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--text-dark);
    margin: 0;
    flex: 1;
    cursor: pointer;
    word-break: break-word;
  }

  .playlist-name:hover {
    color: var(--gold-color);
  }

  .edit-icon-button {
    background: none;
    border: none;
    color: var(--text-dark);
    cursor: pointer;
    padding: 0.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.6;
    transition: opacity 0.2s ease;
    flex-shrink: 0;
  }

  .edit-icon-button:hover {
    opacity: 1;
  }

  .playlist-name-input {
    flex: 1;
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--text-dark);
    background-color: var(--card-color);
    border: 2px solid var(--gold-color);
    border-radius: 0.25rem;
    padding: 0.25rem 0.5rem;
    outline: none;
  }

  .edit-actions {
    display: flex;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .edit-button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.25rem;
    transition: background-color 0.2s ease;
  }

  .save-button {
    color: #28a745;
  }

  .save-button:hover {
    background-color: rgba(40, 167, 69, 0.1);
  }

  .cancel-button {
    color: #dc3545;
  }

  .cancel-button:hover {
    background-color: rgba(220, 53, 69, 0.1);
  }

  .playlist-info {
    margin-bottom: 1rem;
  }

  .playlist-count {
    font-size: 0.875rem;
    color: var(--text-dark);
    opacity: 0.8;
  }

  .playlist-actions {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .action-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    border: 2px solid;
    width: 100%;
    justify-content: center;
  }

  .play-button {
    background-color: var(--gold-color);
    color: var(--text-dark);
    border-color: var(--gold-color);
  }

  .play-button:hover {
    background-color: #c9962e;
    border-color: #c9962e;
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(212, 175, 55, 0.3);
  }

  .share-button {
    background-color: var(--card-color);
    color: var(--text-dark);
    border-color: var(--gold-color);
  }

  .share-button:hover {
    background-color: var(--placeholder-color);
    transform: translateY(-1px);
  }

  .view-button {
    background-color: var(--card-color);
    color: var(--text-dark);
    border-color: var(--gold-color);
  }

  .view-button:hover {
    background-color: var(--placeholder-color);
    transform: translateY(-1px);
  }

  .remove-button {
    background-color: transparent;
    color: #dc3545;
    border-color: #dc3545;
  }

  .remove-button:hover {
    background-color: #dc3545;
    color: white;
    transform: translateY(-1px);
  }

  @media (max-width: 640px) {
    .page-body {
      padding: 1rem;
    }

    .search-section {
      margin-bottom: 1.5rem;
    }

    .search-input-wrapper {
      padding: 0.25rem 0.5rem;
    }

    .playlists-grid {
      grid-template-columns: 1fr;
    }

    .page-title {
      font-size: 1.5rem;
    }
  }

  /* Modal Styles */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal-content {
    background-color: var(--card-color);
    border: 2px solid var(--gold-color);
    border-radius: 0.5rem;
    padding: 1.5rem;
    max-width: 400px;
    width: 100%;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  .modal-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--title-color);
    margin: 0 0 1rem 0;
    padding-bottom: 0.75rem;
    border-bottom: 2px solid var(--gold-color);
  }

  .modal-message {
    font-size: 1rem;
    color: var(--text-dark);
    margin: 0 0 1.5rem 0;
    line-height: 1.5;
  }

  .modal-message strong {
    color: var(--title-color);
    font-weight: 700;
  }

  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
  }

  .modal-button {
    padding: 0.75rem 1.5rem;
    border-radius: 0.5rem;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    border: 2px solid;
  }

  .modal-button.cancel-button {
    background-color: var(--card-color);
    color: var(--text-dark);
    border-color: var(--gold-color);
  }

  .modal-button.cancel-button:hover {
    background-color: var(--placeholder-color);
    transform: translateY(-1px);
  }

  .modal-button.confirm-button {
    background-color: #dc3545;
    color: white;
    border-color: #dc3545;
  }

  .modal-button.confirm-button:hover {
    background-color: #c82333;
    border-color: #c82333;
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(220, 53, 69, 0.3);
  }

  @media (max-width: 640px) {
    .modal-content {
      padding: 1.25rem;
    }

    .modal-actions {
      flex-direction: column;
    }

    .modal-button {
      width: 100%;
    }
  }

  /* View Section Styles */
  .view-section {
    display: flex;
    flex-direction: column;
    height: 100%;
    animation: fadeIn 0.3s ease;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .view-header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 1rem;
    padding-bottom: 0.75rem;
    border-bottom: 2px solid var(--gold-color);
  }

  .view-header-main {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: min(100%, 12rem);
  }

  .view-title-input {
    width: 100%;
    min-width: 0;
    font-size: 1.5rem;
  }

  .view-title-edit-actions {
    flex-shrink: 0;
  }

  .view-header-toolbar {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .view-icon-danger-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    background: none;
    border: none;
    color: #dc3545;
    cursor: pointer;
    border-radius: 0.5rem;
    transition: background-color 0.2s ease, color 0.2s ease;
  }

  .view-icon-danger-button:hover {
    background-color: rgba(220, 53, 69, 0.15);
  }

  .view-title {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--text-light);
    margin: 0;
    flex: 1;
    word-break: break-word;
  }

  .view-header .playlist-name {
    color: var(--text-light);
  }

  .view-header .playlist-name:hover {
    color: var(--gold-color);
  }

  .view-playlist-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .view-playlist-actions .action-button {
    width: auto;
    min-width: 10rem;
    flex: 1 1 10rem;
  }

  .leitor-button {
    background-color: var(--card-color);
    color: var(--text-dark);
    border-color: var(--gold-color);
  }

  .leitor-button:hover:not(:disabled) {
    background-color: var(--placeholder-color);
    transform: translateY(-1px);
  }

  .leitor-button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
    transform: none;
  }

  .view-leitor-error {
    margin: 0 0 1rem 0;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    border: 2px solid #dc3545;
    color: #f8d7da;
    background-color: rgba(220, 53, 69, 0.2);
    font-size: 0.9375rem;
  }

  .view-louvores-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-height: calc(100vh - 380px);
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 0.5rem;
  }

  .view-louvor-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem;
    align-items: stretch;
  }

  .view-louvor-card-wrap {
    min-width: 0;
  }

  .view-remove-louvor-button {
    align-self: stretch;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    padding: 0;
    border: 2px solid #dc3545;
    border-radius: 0.5rem;
    background: transparent;
    color: #dc3545;
    cursor: pointer;
    transition: background-color 0.2s ease, color 0.2s ease;
    flex-shrink: 0;
  }

  .view-remove-louvor-button:hover {
    background-color: #dc3545;
    color: white;
  }

  .view-header-toolbar .close-view-button {
    margin-left: 0;
  }

  .close-view-button {
    background: none;
    border: none;
    color: var(--text-light);
    cursor: pointer;
    padding: 0.5rem;
    border-radius: 0.5rem;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-left: 1rem;
  }

  .close-view-button:hover {
    background-color: rgba(212, 175, 55, 0.2);
    transform: scale(1.1);
  }

  /* Custom scrollbar for view louvores list */
  .view-louvores-list::-webkit-scrollbar {
    width: 8px;
  }

  .view-louvores-list::-webkit-scrollbar-track {
    background: var(--card-color);
    border-radius: 4px;
  }

  .view-louvores-list::-webkit-scrollbar-thumb {
    background: var(--gold-color);
    border-radius: 4px;
  }

  .view-louvores-list::-webkit-scrollbar-thumb:hover {
    background: #c9962e;
  }

  .empty-view-state {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--text-light);
  }

  .empty-view-state p {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 500;
    opacity: 0.9;
  }

  @media (max-width: 768px) {
    .view-title {
      font-size: 1.5rem;
    }

    .view-title-input {
      font-size: 1.25rem;
    }
  }

  @media (max-width: 640px) {
    .view-title {
      font-size: 1.25rem;
    }

    .view-louvores-list {
      max-height: calc(100vh - 340px);
    }

    .view-playlist-actions .action-button {
      min-width: 100%;
    }

    .view-header {
      margin-bottom: 1rem;
    }
  }
</style>

