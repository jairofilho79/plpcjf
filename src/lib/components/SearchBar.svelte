<script>
  import { createEventDispatcher } from 'svelte';
  
  export let searchQuery = '';
  
  const dispatch = createEventDispatcher();
  
  function handleSearch() {
    if (searchQuery.trim()) {
      dispatch('search', searchQuery.trim());
    }
  }
  
  function handleKeydown(event) {
    if (event.key === 'Enter' && searchQuery.trim()) {
      handleSearch();
      event.target.blur();
    }
  }
  
  function clearSearch() {
    searchQuery = '';
    dispatch('clear');
  }
</script>

<div class="relative w-full max-w-4xl">
  <button
    on:click={clearSearch}
    class="absolute left-3 top-1/2 transform -translate-y-1/2 px-4 py-2 bg-transparent text-text-dark border-2 border-text-dark rounded-lg hover:bg-gray-100 transition-colors z-10"
  >
    Limpar
  </button>
  
  <input
    type="text"
    bind:value={searchQuery}
    on:keydown={handleKeydown}
    placeholder="Pesquisar louvor..."
    class="w-full h-20 pl-32 pr-36 text-lg border-2 border-gold-color rounded-lg bg-card-color focus:outline-none focus:border-title-color"
  />
  
  <button
    on:click={handleSearch}
    class="absolute right-3 top-1/2 transform -translate-y-1/2 px-4 py-2 bg-transparent text-text-dark border-2 border-text-dark rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    disabled={!searchQuery.trim()}
  >
    Pesquisar
  </button>
  
  {#if !searchQuery.trim()}
    <button
      disabled
      class="absolute right-3 top-1/2 transform -translate-y-1/2 px-4 py-2 bg-transparent text-gray-600 border-2 border-gray-400 rounded-lg cursor-not-allowed"
    >
      Digite...
    </button>
  {/if}
</div>

