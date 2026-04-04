<script>
  import { page } from '$app/stores';
  import AppSnackbarToast from '$lib/components/AppSnackbarToast.svelte';
  import { appSnackbars, dismissSnackbar } from '$lib/utils/appSnackbar.js';
</script>

<div
  class="app-snackbar-host"
  class:app-snackbar-host--leitor={$page.url.pathname.startsWith('/leitor')}
  role="status"
  aria-live="polite"
  aria-atomic="false"
>
  {#each $appSnackbars as snackbar (snackbar.id)}
    <AppSnackbarToast
      toastId={snackbar.id}
      variant={snackbar.variant}
      message={snackbar.message}
      durationMs={snackbar.durationMs}
      on:dismiss={() => dismissSnackbar(snackbar.id)}
    />
  {/each}
</div>

<style>
  .app-snackbar-host {
    position: fixed;
    left: 50%;
    bottom: calc(12px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    width: min(100%, 32rem);
    padding: 0 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    z-index: 3000;
    pointer-events: none;
  }

  .app-snackbar-host :global(.app-snackbar) {
    pointer-events: auto;
  }

  @media (max-width: 768px) {
    .app-snackbar-host {
      width: 100%;
      bottom: calc(16px + env(safe-area-inset-bottom));
      padding: 0 0.625rem;
    }

    .app-snackbar-host.app-snackbar-host--leitor {
      bottom: calc(88px + env(safe-area-inset-bottom));
    }
  }
</style>
