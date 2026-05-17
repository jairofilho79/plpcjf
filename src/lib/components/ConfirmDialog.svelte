<script>
  import { onMount, onDestroy } from 'svelte';

  export let show = false;
  export let title = '';
  export let message = '';
  export let confirmLabel = 'Confirmar';
  export let cancelLabel = 'Cancelar';
  /**
   * @type {() => void}
   */
  export let onConfirm = () => {};
  /**
   * @type {() => void}
   */
  export let onCancel = () => {};

  /**
   * @param {KeyboardEvent} e
   */
  function handleKeydown(e) {
    if (!show) return;
    if (e.key === 'Escape') {
      onCancel();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
  });
</script>

{#if show}
  <div
    class="modal-overlay"
    role="presentation"
    on:click={onCancel}
    on:keydown={(e) => e.key === 'Escape' && onCancel()}
  >
    <div
      class="modal-content"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      on:click|stopPropagation
    >
      <h3 class="modal-title" id="confirm-dialog-title">{title}</h3>
      <p class="modal-message">{message}</p>
      <div class="modal-actions">
        <button class="modal-button cancel-button" on:click={onCancel}>
          {cancelLabel}
        </button>
        <button class="modal-button confirm-button" on:click={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
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
    background-color: var(--title-color);
    color: var(--placeholder-color);
    border-color: var(--title-color);
  }

  .modal-button.confirm-button:hover {
    opacity: 0.85;
    transform: translateY(-1px);
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
