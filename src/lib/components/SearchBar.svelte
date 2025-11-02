<script>
  import { createEventDispatcher } from 'svelte';
  
  export let searchQuery = '';
  
  const dispatch = createEventDispatcher();
  
  function handleKeydown(event) {
    if (event.key === 'Enter') {
      event.target.blur();
    }
  }
  
  function clearSearch() {
    searchQuery = '';
    dispatch('clear');
  }
</script>

<div class="search-bar-container">
  <span class="container-tag">Buscar</span>
  <div class="search-input-wrapper">
    {#if searchQuery.trim()}
      <button
        on:click={clearSearch}
        type="button"
        class="clear-button"
        title="Limpar pesquisa"
      >
        <svg class="clear-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    {/if}
    
    <input
      type="text"
      bind:value={searchQuery}
      on:keydown={handleKeydown}
      placeholder="Pesquisar louvor..."
      class="search-input"
      class:has-text={searchQuery.trim()}
    />
  </div>
</div>

<style>
  .search-bar-container {
    width: 100%;
    max-width: 56rem; /* max-w-4xl = 56rem */
    position: relative;
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
  
  .search-input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    background-color: var(--card-color);
    border: 2px solid var(--gold-color);
    border-radius: 0.5rem; /* rounded-lg - padronizado com outros containers */
    box-shadow: var(--shadow-md);
    transition: all 0.3s ease;
  }
  
  .search-input-wrapper:focus-within {
    border-color: var(--gold-light) !important;
    box-shadow: var(--shadow-lg), 0 0 0 3px rgba(244, 208, 63, 0.25) !important;
    transform: translateY(-2px);
    outline: none !important;
  }
  
  .search-input {
    width: 100%;
    height: 4.5rem;
    padding: 0 1.5rem;
    padding-left: 1.5rem;
    font-size: 1.125rem;
    font-family: inherit;
    color: var(--text-dark) !important;
    background-color: transparent;
    border: none;
    outline: none !important;
    border-radius: 0.5rem; /* padronizado com wrapper */
    transition: padding-left 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  
  .search-input::-webkit-input-placeholder {
    color: var(--text-dark) !important;
    opacity: 0.6;
  }
  
  .search-input::-moz-placeholder {
    color: var(--text-dark) !important;
    opacity: 0.6;
  }
  
  .search-input:-ms-input-placeholder {
    color: var(--text-dark) !important;
    opacity: 0.6;
  }
  
  .search-input:focus {
    outline: none !important;
    box-shadow: none !important;
  }
  
  .search-input:focus-visible {
    outline: none !important;
    box-shadow: none !important;
  }
  
  .search-input.has-text {
    padding-left: 3.5rem;
  }
  
  .search-input::placeholder {
    color: var(--text-dark) !important;
    opacity: 0.6;
    font-style: italic;
  }
  
  .clear-button {
    position: absolute;
    left: 0.75rem;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    background-color: var(--btn-background-color);
    color: var(--text-light);
    border: none;
    border-radius: 0.5rem; /* padronizado - rounded-lg */
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
    z-index: 10;
    animation: fadeInScale 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  
  .clear-button:hover {
    background-color: var(--title-color);
    transform: translateY(-50%) scale(1.05);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
  }
  
  .clear-button:active {
    transform: translateY(-50%) scale(0.95);
  }
  
  @keyframes fadeInScale {
    from {
      opacity: 0;
      transform: translateY(-50%) scale(0.8);
    }
    to {
      opacity: 1;
      transform: translateY(-50%) scale(1);
    }
  }
  
  .clear-icon {
    width: 1.25rem;
    height: 1.25rem;
    stroke-width: 2.5;
  }
  
  @media (max-width: 640px) {
    .search-input {
      height: 3.75rem;
      font-size: 1rem;
      padding: 0 1.25rem;
      padding-left: 1.25rem;
    }
    
    .search-input.has-text {
      padding-left: 3rem;
    }
    
    .clear-button {
      width: 2.25rem;
      height: 2.25rem;
      left: 0.625rem;
    }
    
    .clear-icon {
      width: 1.125rem;
      height: 1.125rem;
    }
  }
</style>

