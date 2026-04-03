<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { pdfViewer } from '$lib/stores/pdfViewer';
  
  const PDF_VIEWER_OPTIONS = [
    { value: 'leitor', label: 'Leitor' },
    { value: 'newtab', label: 'Abrir PDF em nova aba' },
    { value: 'share', label: 'Compartilhar' },
    { value: 'save', label: 'Baixar' },
    { value: 'online', label: 'Leitor Online' }
  ];
  
  // Check if offline - store the value in a variable that we update
  let isOnline = browser ? navigator.onLine : true;
  
  // Reactive statement that depends on isOnline
  $: isOffline = !isOnline;
  
  function updateOfflineStatus() {
    if (browser) {
      isOnline = navigator.onLine;
    }
  }
  
  // If offline and "online" is selected, switch to "leitor"
  $: if (isOffline && $pdfViewer === 'online') {
    pdfViewer.set('leitor');
  }

  function handleSelectChange(event: Event) {
    const select = event.currentTarget as HTMLSelectElement | null;
    if (select) {
      pdfViewer.set(select.value);
    }
  }
  
  onMount(() => {
    if (browser) {
      updateOfflineStatus();
      
      window.addEventListener('online', updateOfflineStatus);
      window.addEventListener('offline', updateOfflineStatus);
    }
  });
  
  onDestroy(() => {
    if (browser) {
      window.removeEventListener('online', updateOfflineStatus);
      window.removeEventListener('offline', updateOfflineStatus);
    }
  });
  
</script>

<div class="w-full max-w-4xl p-4 bg-card-color rounded-lg border-2 flex items-center pdf-viewer-container">
  <label class="container-tag" for="pdf-viewer-mode">Como abrir</label>
  <div class="pdf-viewer-select-wrapper">
    <select
      id="pdf-viewer-mode"
      class="pdf-viewer-select"
      value={$pdfViewer}
      on:change={handleSelectChange}
      aria-label="Como abrir PDF"
    >
      {#each PDF_VIEWER_OPTIONS as option}
        <option value={option.value} disabled={option.value === 'online' && isOffline}>
          {option.label}
        </option>
      {/each}
    </select>
  </div>
</div>

<style>
  .pdf-viewer-container {
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

  .pdf-viewer-select-wrapper {
    position: relative;
    width: 100%;
  }

  .pdf-viewer-select-wrapper::after {
    content: '';
    position: absolute;
    right: 0.875rem;
    top: 50%;
    width: 0.5rem;
    height: 0.5rem;
    border-right: 2px solid var(--gold-color);
    border-bottom: 2px solid var(--gold-color);
    transform: translateY(-65%) rotate(45deg);
    pointer-events: none;
  }

  .pdf-viewer-select {
    width: 100%;
    min-height: 2.5rem;
    padding: 0.5rem 2.25rem 0.5rem 0.875rem;
    border-radius: 0.75rem;
    border: 2px solid var(--gold-color);
    background-color: #ffffff;
    color: var(--title-color);
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1.2;
    transition: box-shadow 0.2s ease, border-color 0.2s ease;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
  }

  .pdf-viewer-select:hover {
    border-color: var(--title-color);
  }

  .pdf-viewer-select:focus-visible {
    outline: none;
    border-color: var(--gold-color);
    box-shadow: 0 0 0 3px rgba(212, 175, 55, 0.3);
  }

  .pdf-viewer-select option:disabled {
    color: #6c757d;
  }
</style>

