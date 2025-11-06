<script>
  import { bibliotecaSort } from '$lib/stores/bibliotecaSort';
  
  const SORT_OPTIONS = [
    { value: 'numero', label: 'Por número' },
    { value: 'nome', label: 'Por nome' }
  ];
  
  function handleOptionClick(value) {
    bibliotecaSort.set(value);
  }
</script>

<div class="w-full max-w-4xl p-4 bg-card-color rounded-lg border-2 flex flex-wrap gap-2 items-center justify-center sort-container">
  <span class="container-tag">Ordenar</span>
  {#each SORT_OPTIONS as option}
    {@const isActive = $bibliotecaSort === option.value}
    <button
      type="button"
      class="sort-chip"
      class:active={isActive}
      on:click={() => handleOptionClick(option.value)}
    >
      <span>{option.label}</span>
    </button>
  {/each}
</div>

<style>
  .sort-container {
    border-color: var(--gold-color);
    color: var(--text-dark);
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
  
  .sort-chip {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.75rem;
    border-radius: 1.25rem;
    border: 2px solid var(--title-color);
    background-color: transparent;
    color: var(--text-dark);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  
  .sort-chip:hover:not(.active) {
    background-color: var(--placeholder-color);
    border-color: var(--gold-color);
    transform: translateY(-1px);
  }
  
  .sort-chip.active {
    background-color: var(--gold-color) !important;
    border-color: var(--gold-color) !important;
    color: var(--text-dark) !important;
    font-weight: 700 !important;
    box-shadow: 0 3px 8px rgba(212, 175, 55, 0.5);
    transform: translateY(-2px);
  }
  
  .sort-chip span {
    color: inherit;
    white-space: nowrap;
  }
  
  @media (min-width: 768px) {
    .sort-container {
      flex-wrap: nowrap !important;
      justify-content: flex-start !important;
      gap: 0.5rem !important;
    }
    
    .sort-chip {
      flex-shrink: 0;
    }
  }
  
  @media (min-width: 1024px) {
    .sort-container {
      justify-content: center !important;
      gap: 0.75rem !important;
    }
  }
</style>

