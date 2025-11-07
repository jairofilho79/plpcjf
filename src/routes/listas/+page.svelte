<script>
  import { onMount, afterUpdate } from 'svelte';
  import { browser } from '$app/environment';
  import { savedPlaylists } from '$lib/stores/savedPlaylists';
  import { carousel } from '$lib/stores/carousel';
  import { louvores } from '$lib/stores/louvores';
  import { goto } from '$app/navigation';
  import { Play, Trash2, Share2, Edit2, Check, X, Star } from 'lucide-svelte';
  import { sharePlaylistLink, generatePlaylistShareUrl } from '$lib/utils/playlistUtils';

  let editingId = null;
  let editingName = '';
  let originalName = '';
  let showCopiedMessage = false;
  let copiedMessageTimeout = null;
  let isSavingOrCanceling = false;
  let showDeleteModal = false;
  let playlistToDelete = null;
  let showOnlyFavorites = false;
  /**
   * @type {HTMLElement | null}
   */
  let filterButtonElement = null;

  $: allPlaylists = $savedPlaylists;
  $: playlists = showOnlyFavorites 
    ? allPlaylists.filter(p => p.favorita === true)
    : allPlaylists;

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

  // Update SVG attributes directly for filter button
  $: if (filterButtonElement && browser) {
    updateStarSVG(filterButtonElement, showOnlyFavorites);
  }

  // Update SVG attributes for favorite buttons in cards
  afterUpdate(() => {
    if (browser) {
      // Update filter button
      if (filterButtonElement) {
        updateStarSVG(filterButtonElement, showOnlyFavorites);
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

  function handleRemove(playlist, event) {
    event.stopPropagation();
    playlistToDelete = playlist;
    showDeleteModal = true;
  }
  
  function confirmDelete() {
    if (playlistToDelete) {
      savedPlaylists.removePlaylist(playlistToDelete.id);
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
    event.stopPropagation();
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
</script>

<svelte:head>
  <title>Listas - PLPC</title>
</svelte:head>

  <div class="max-w-4xl mx-auto">
  <div class="page-body">
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
    
    {#if showCopiedMessage}
      <div class="copied-notification">Link copiado!</div>
    {/if}

    {#if playlists.length === 0}
      <div class="empty-state">
        {#if showOnlyFavorites}
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
</style>

