<script>
  /** Quantas linhas fantasma desenhar — acompanha o `itensPorPagina` atual da página que chama. */
  export let count = 10;
</script>

<div class="louvor-skeleton-list" aria-hidden="true">
  {#each Array(count) as _, i (i)}
    <div class="louvor-skeleton-card"></div>
  {/each}
</div>

<style>
  /* Mesmo padrão de shimmer definido (e nunca usado) em
     src/routes/offline/+page.svelte:2589-2603 — reaproveitado aqui em vez
     de inventar uma segunda linguagem visual de carregamento. */
  .louvor-skeleton-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 1.5rem;
    margin-bottom: 1.5rem;
    width: 100%;
  }

  .louvor-skeleton-card {
    height: 4.5rem;
    border-radius: 0.5rem;
    background: linear-gradient(90deg, var(--placeholder-color) 25%, rgba(255, 255, 255, 0.1) 50%, var(--placeholder-color) 75%);
    background-size: 200% 100%;
    animation: louvor-skeleton-loading 1.5s infinite;
  }

  @keyframes louvor-skeleton-loading {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .louvor-skeleton-card {
      animation: none;
      background: var(--placeholder-color);
    }
  }
</style>
