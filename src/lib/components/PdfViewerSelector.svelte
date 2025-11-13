<script lang="ts">
  import { pdfViewer } from '$lib/stores/pdfViewer';
  
  const PDF_VIEWER_OPTIONS = [
    { value: 'leitor', label: 'Leitor' },
    { value: 'newtab', label: 'Abrir PDF em nova aba' },
    { value: 'share', label: 'Compartilhar' },
    { value: 'save', label: 'Baixar' },
    { value: 'online', label: 'Leitor Online' }
  ];
  
  function getIcon(value: any) {
    if (value === 'leitor') {
      // Ícone de livro (fornecido)
      return 'M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25';
    }
    if (value === 'online') {
      // Ícone de olho/visualização
      return 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z';
    }
    if (value === 'newtab') {
      // Ícone de nova aba
      return 'M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25';
    }
    if (value === 'share') {
      // Ícone de compartilhar
      return 'M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z';
    }
    if (value === 'save') {
      // Ícone de download/baixar
      return 'M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3';
    }
    return '';
  }
  
  function handleOptionClick(value: any) {
    pdfViewer.set(value);
  }
</script>

<div class="w-full max-w-4xl p-4 bg-card-color rounded-lg border-2 flex flex-wrap gap-2 items-center justify-center pdf-viewer-container">
  <span class="container-tag">Como abrir</span>
  {#each PDF_VIEWER_OPTIONS as option}
    {@const isActive = $pdfViewer === option.value}
    {@const iconPath = getIcon(option.value)}
    <button
      type="button"
      class="pdf-viewer-chip"
      class:active={isActive}
      on:click={() => handleOptionClick(option.value)}
    >
      {#if iconPath}
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={iconPath} />
        </svg>
      {/if}
      <span>{option.label}</span>
    </button>
  {/each}
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
  
  .pdf-viewer-chip {
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
    user-select: none;
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
  }
  
  .pdf-viewer-chip:hover:not(.active) {
    background-color: var(--placeholder-color);
    border-color: var(--gold-color);
    transform: translateY(-1px);
  }
  
  .pdf-viewer-chip.active {
    background-color: var(--gold-color) !important;
    border-color: var(--gold-color) !important;
    color: var(--text-dark) !important;
    font-weight: 700 !important;
    box-shadow: 0 3px 8px rgba(212, 175, 55, 0.5);
    transform: translateY(-2px);
  }
  
  .pdf-viewer-chip svg {
    color: var(--title-color);
    flex-shrink: 0;
    transition: color 0.2s ease;
  }
  
  .pdf-viewer-chip.active svg {
    color: var(--text-dark) !important;
  }
  
  .pdf-viewer-chip span {
    color: inherit;
    white-space: nowrap;
    user-select: none;
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
  }
  
  /* Em tablets e telas maiores: evitar quebra de linha e usar espaçamento dinâmico */
  @media (min-width: 768px) {
    .pdf-viewer-container {
      flex-wrap: nowrap !important;
      justify-content: flex-start !important;
      gap: 0.5rem !important;
    }
    
    .pdf-viewer-chip {
      flex-shrink: 0;
    }
  }
  
  @media (min-width: 1024px) {
    .pdf-viewer-container {
      justify-content: center !important;
      gap: 0.75rem !important;
    }
  }
</style>

