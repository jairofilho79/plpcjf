<script>
  import { createEventDispatcher } from 'svelte';
  
  export let searchQuery = '';
  
  const dispatch = createEventDispatcher();
  let searchInput;
  
  function handleKeydown(event) {
    if (event.key === 'Enter') {
      event.target.blur();
    }
  }
  
  function clearSearch() {
    searchQuery = '';
    dispatch('clear');
    // Focar no input após limpar para que o usuário possa continuar digitando
    if (searchInput) {
      searchInput.focus();
    }
  }
</script>

<div class="search-bar-container">
  <span class="container-tag">Buscar</span>
  <div class="search-input-wrapper">
    {#if !searchQuery.trim()}
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"></circle>
        <path d="m21 21-4.35-4.35"></path>
      </svg>
    {/if}
    
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
      id="louvor-search-input"
      type="text"
      bind:this={searchInput}
      bind:value={searchQuery}
      on:keydown={handleKeydown}
      placeholder="Pesquisar louvor..."
      class="search-input"
      class:has-text={searchQuery.trim()}
      class:has-icon={!searchQuery.trim()}
    />
  </div>
</div>

<style>
  .search-bar-container {
    width: 100%;
    max-width: 56rem; /* max-w-4xl = 56rem */
    position: relative;
    margin: 2.5rem 0;
    padding: 0;
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
    padding: 1rem; /* p-4 - padronizado com PdfViewerSelector */
    background-color: var(--card-color);
    border: 2px solid var(--gold-color);
    border-radius: 0.5rem; /* rounded-lg - padronizado com outros containers */
    transition: border-color 0.3s ease;
    animation: goldenHeatWave 2s ease-in-out infinite;
  }
  
  .search-input-wrapper:focus-within {
    border-color: var(--gold-light) !important;
    outline: none !important;
    animation: goldenHeatWave 2s ease-in-out infinite;
  }
  
  .search-icon {
    position: absolute;
    left: 1rem;
    top: 50%;
    transform: translateY(-50%);
    width: 1.25rem;
    height: 1.25rem;
    color: var(--gold-color);
    opacity: 0.7;
    z-index: 5;
    pointer-events: none;
  }
  
  .search-input {
    width: 100%;
    height: 2.75rem;
    padding: 0 1rem;
    padding-left: 1rem;
    font-size: 1rem;
    font-family: inherit;
    color: var(--text-dark) !important;
    background-color: transparent;
    border: none;
    outline: none !important;
    border-radius: 0.5rem; /* padronizado com wrapper */
    transition: padding-left 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  
  .search-input.has-icon {
    padding-left: 2.75rem;
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
    padding-left: 2.75rem;
  }
  
  .search-input::placeholder {
    color: var(--text-dark) !important;
    opacity: 0.6;
    font-style: italic;
  }
  
  .clear-button {
    position: absolute;
    left: 1rem;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
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
  
  @keyframes goldenHeatWave {
    0%, 100% {
      box-shadow: 
        0 0 8px rgba(212, 175, 55, 0.4),
        0 0 16px rgba(212, 175, 55, 0.3),
        0 0 24px rgba(244, 208, 63, 0.2);
      transform: translateX(0);
    }
    25% {
      box-shadow: 
        0 0 12px rgba(212, 175, 55, 0.5),
        0 0 24px rgba(212, 175, 55, 0.4),
        0 0 36px rgba(244, 208, 63, 0.3);
      transform: translateX(0.5px);
    }
    50% {
      box-shadow: 
        0 0 16px rgba(212, 175, 55, 0.6),
        0 0 32px rgba(212, 175, 55, 0.5),
        0 0 48px rgba(244, 208, 63, 0.4);
      transform: translateX(0);
    }
    75% {
      box-shadow: 
        0 0 12px rgba(212, 175, 55, 0.5),
        0 0 24px rgba(212, 175, 55, 0.4),
        0 0 36px rgba(244, 208, 63, 0.3);
      transform: translateX(-0.5px);
    }
  }
  
  .clear-icon {
    width: 1.25rem;
    height: 1.25rem;
    stroke-width: 2.5;
  }
  
  @media (max-width: 640px) {
    .search-bar-container {
      margin: 2rem 0;
    }
    
    .search-input-wrapper {
      padding: 0.75rem;
    }
    
    .search-input {
      height: 2.5rem;
      font-size: 0.9375rem;
      padding: 0 0.875rem;
      padding-left: 0.875rem;
    }
    
    .search-input.has-icon {
      padding-left: 2.5rem;
    }
    
    .search-input.has-text {
      padding-left: 2.5rem;
    }
    
    .search-icon {
      width: 1.125rem;
      height: 1.125rem;
      left: 0.875rem;
    }
    
    .clear-button {
      width: 1.875rem;
      height: 1.875rem;
      left: 0.875rem;
    }
    
    .clear-icon {
      width: 1.125rem;
      height: 1.125rem;
    }
  }
</style>

