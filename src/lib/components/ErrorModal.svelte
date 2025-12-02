<script>
  import { X, AlertCircle } from 'lucide-svelte';

  /**
   * @type {boolean}
   */
  export let show = false;

  /**
   * @type {string}
   */
  export let title = 'Erro';

  /**
   * @type {string}
   */
  export let message = '';

  /**
   * @type {() => void}
   */
  export let onClose = () => {};

  /**
   * Handle backdrop click
   */
  function handleBackdropClick(event) {
    if (event.target === event.currentTarget) {
      handleClose();
    }
  }

  /**
   * Handle close button click
   */
  function handleClose() {
    onClose();
  }
</script>

{#if show}
  <div 
    class="modal-backdrop" 
    role="dialog"
    aria-modal="true"
    on:click={handleBackdropClick}
  >
    <div class="modal-content">
      <!-- Header -->
      <div class="modal-header">
        <h2 class="modal-title">{title}</h2>
        <button 
          class="close-button" 
          on:click={handleClose}
          aria-label="Fechar"
        >
          <X class="w-6 h-6" />
        </button>
      </div>
      
      <!-- Body -->
      <div class="modal-body">
        <div class="error-box">
          <AlertCircle class="w-5 h-5 error-icon" />
          <p class="error-text">{message}</p>
        </div>
        
        <div class="action-buttons">
          <button 
            class="btn btn-primary"
            on:click={handleClose}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 1rem;
  }
  
  .modal-content {
    background-color: var(--card-color);
    border: 3px solid var(--gold-color);
    border-radius: 1rem;
    max-width: 600px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }
  
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.5rem;
    border-bottom: 2px solid var(--gold-color);
  }
  
  .modal-title {
    font-size: 1.5rem;
    font-weight: 700;
    font-family: 'Garamond', serif;
    color: var(--text-dark);
    margin: 0;
  }
  
  .close-button {
    background: none;
    border: none;
    color: var(--text-dark);
    cursor: pointer;
    padding: 0.5rem;
    border-radius: 0.5rem;
    transition: background-color 0.2s;
  }
  
  .close-button:hover:not(:disabled) {
    background-color: var(--placeholder-color);
  }
  
  .close-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .modal-body {
    padding: 1.5rem;
  }
  
  /* Error box */
  .error-box {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 1rem;
    background-color: #f8d7da;
    border: 2px solid #dc3545;
    border-radius: 0.5rem;
    margin-bottom: 1.5rem;
  }
  
  .error-box :global(.error-icon) {
    color: #721c24;
    flex-shrink: 0;
    margin-top: 0.125rem;
  }
  
  .error-text {
    color: #721c24;
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 500;
    line-height: 1.5;
    word-wrap: break-word;
  }
  
  /* Action buttons */
  .action-buttons {
    display: flex;
    gap: 1rem;
    justify-content: flex-end;
  }
  
  .btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    border-radius: 0.5rem;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    border: 2px solid;
  }
  
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .btn-primary {
    background-color: var(--gold-color);
    color: var(--text-dark);
    border-color: var(--gold-color);
  }
  
  .btn-primary:hover:not(:disabled) {
    background-color: #c9962e;
    border-color: #c9962e;
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(212, 175, 55, 0.3);
  }
</style>

