<script>
  // Apresenta o estado de um download em andamento ou recém-concluído.
  // Responsabilidade única: mostrar os números que /offline já calculou
  // (progress, contadores, partes) e emitir "cancel" — não decide nada,
  // não inicia nem acompanha download por conta própria.
  // Extraído de src/routes/offline/+page.svelte (#23).
  import { createEventDispatcher } from 'svelte';
  import { CheckCircle } from 'lucide-svelte';
  import { formatSize } from '$lib/utils/formatSize.js';

  const dispatch = createEventDispatcher();

  export let downloading = false;
  export let isImportingBundle = false;
  export let importJustFinished = false;
  export let totalParts = 0;
  export let currentPart = 0;
  export let partPhase = /** @type {'baixando' | 'extraindo' | 'gravando' | null} */ (null);
  export let currentPartName = '';
  export let completed = 0;
  export let total = 0;
  export let failed = 0;
  export let bytesDownloaded = 0;
  export let bytesTotal = /** @type {number | null} */ (null);
  export let progress = 0;
  /** @type {Array<{ id: string, label: string, status: 'pending' | 'active' | 'done', counts?: { ok: number, fail: number, total: number } }>} */
  export let importChecklist = [];

  const IMPORT_STATUS_LABEL = {
    pending: 'A fazer',
    active: 'Em progresso',
    done: 'Concluído'
  };

  function cancel() {
    dispatch('cancel');
  }
</script>

{#if downloading}
<!-- Download / import progress -->
<div class="progress-section">
  <div class="progress-info">
    <p class="progress-title">{isImportingBundle ? 'A importar pacote offline…' : 'Baixando PDFs...'}</p>
    {#if !isImportingBundle}
      {#if totalParts > 0}
        <!-- Só a linha de parte/fase é aria-live: o contador de PDFs abaixo
             muda várias vezes por segundo e anunciaria demais. -->
        <p class="progress-part" role="status" aria-live="polite">
          <span class="download-part">Parte {currentPart} de {totalParts}</span>
          {#if partPhase}
            <span class="download-phase">
              {#if partPhase === 'baixando'}Baixando{:else if partPhase === 'extraindo'}Extraindo{:else if partPhase === 'gravando'}Gravando{/if}
              {currentPartName}
            </span>
          {/if}
        </p>
      {/if}
      <p class="progress-stats">
        {completed} de {total} PDFs baixados
        {#if failed > 0}
          <span class="failed-count">({failed} falharam)</span>
        {/if}
      </p>
      {#if bytesDownloaded > 0 || bytesTotal}
        <p class="progress-bytes">
          {formatSize(bytesDownloaded)}{#if bytesTotal} de {formatSize(bytesTotal)}{/if} baixados
        </p>
      {/if}
    {/if}
  </div>
  <div class="progress-bar-container">
    <div class="progress-bar" style="width: {progress}%"></div>
  </div>
  <p class="progress-percentage">{progress}%</p>
  {#if !isImportingBundle && totalParts > 0}
    <p class="download-warning">
      Mantenha o app aberto até terminar. Se a conexão cair, o download retoma da parte em que parou na próxima tentativa.
    </p>
  {/if}
  {#if isImportingBundle && importChecklist.length}
    <ul class="import-checklist">
      {#each importChecklist as item (item.id)}
        <li class="import-checklist-item" data-status={item.status}>
          <span class="import-checklist-label">{item.label}</span>
          <span class="import-checklist-meta">
            {#if item.counts}
              <span class="import-counts" aria-label="válidos, inválidos, total">
                <span class="import-count-ok">{item.counts.ok}</span>
                <span class="import-count-sep">;</span>
                <span class="import-count-fail">{item.counts.fail}</span>
                <span class="import-count-sep">,</span>
                <span class="import-count-total">{item.counts.total}</span>
              </span>
            {/if}
            <span class="import-status-tag" data-status={item.status}
              >{IMPORT_STATUS_LABEL[item.status]}</span
            >
          </span>
        </li>
      {/each}
    </ul>
  {/if}
  <div class="action-buttons">
    <button class="btn btn-danger" on:click={cancel}>
      {isImportingBundle ? 'Cancelar importação' : 'Cancelar Download'}
    </button>
  </div>
</div>
{:else if progress >= 100}
<div class="complete-section">
  <CheckCircle class="w-16 h-16 complete-icon" />
  <p class="complete-title">{importJustFinished ? 'Importação concluída!' : 'Download concluído!'}</p>
  <p class="complete-stats">
    {completed} PDFs {importJustFinished ? 'importados' : 'baixados'} com sucesso
    {#if failed > 0}
      <br />
      <span class="failed-count">{failed} PDFs falharam</span>
    {/if}
  </p>
  <div class="action-buttons"></div>
</div>
{/if}

<style>
  .progress-section {
    text-align: center;
  }

  .progress-info {
    margin-bottom: 1.5rem;
  }

  .progress-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-light);
    margin: 0 0 0.5rem 0;
  }

  .progress-stats {
    font-size: 0.9375rem;
    color: var(--text-light);
    margin: 0;
  }

  .failed-count {
    color: #dc3545;
    font-weight: 600;
  }

  .progress-bar-container {
    width: 100%;
    height: 2rem;
    background-color: var(--background-color);
    border: 2px solid var(--placeholder-color);
    border-radius: 1rem;
    overflow: hidden;
    margin-bottom: 0.75rem;
  }

  .progress-bar {
    height: 100%;
    background: linear-gradient(90deg, var(--gold-color), #ffd700);
    transition: width 0.3s ease;
    border-radius: 0.875rem;
  }

  .progress-percentage {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-light);
    margin: 0 0 1rem 0;
  }

  .progress-part {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: baseline;
    gap: 0.5rem;
    margin: 0 0 0.375rem 0;
    font-size: 0.9375rem;
  }

  .download-part {
    font-weight: 600;
    color: var(--text-light);
    font-variant-numeric: tabular-nums;
  }

  .download-phase {
    color: var(--placeholder-color);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .progress-bytes {
    font-size: 0.8125rem;
    color: var(--placeholder-color);
    margin: 0.25rem 0 0 0;
    font-variant-numeric: tabular-nums;
  }

  .download-warning {
    margin: 0.75rem 0 0 0;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--placeholder-color);
  }

  .import-checklist {
    list-style: none;
    margin: 0 0 1.25rem;
    padding: 0;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .import-checklist-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.5rem 0.65rem;
    border: 1px solid rgba(212, 175, 55, 0.25);
    border-radius: 0.35rem;
    background: rgba(0, 0, 0, 0.15);
  }

  .import-checklist-label {
    font-size: 0.875rem;
    color: var(--text-light);
    min-width: 0;
  }

  .import-checklist-meta {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-shrink: 0;
  }

  .import-counts {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.8125rem;
    font-weight: 600;
    display: inline-flex;
    align-items: baseline;
    gap: 0.15rem;
  }

  .import-count-ok {
    color: #4ade80;
  }

  .import-count-fail {
    color: #f87171;
  }

  .import-count-total {
    color: #f5f5f5;
  }

  .import-count-sep {
    color: rgba(245, 245, 245, 0.45);
    font-weight: 400;
  }

  .import-status-tag {
    flex-shrink: 0;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 0.2rem 0.45rem;
    border-radius: 0.25rem;
    border: 1px solid transparent;
  }

  .import-status-tag[data-status='pending'] {
    color: #c8c2b4;
    border-color: rgba(200, 194, 180, 0.35);
    background: rgba(200, 194, 180, 0.08);
  }

  .import-status-tag[data-status='active'] {
    color: #1a1a1a;
    border-color: var(--gold-color);
    background: var(--gold-color);
  }

  .import-status-tag[data-status='done'] {
    color: #d4edda;
    border-color: rgba(40, 167, 69, 0.55);
    background: rgba(40, 167, 69, 0.2);
  }

  .progress-note {
    font-size: 0.875rem;
    color: var(--text-light);
    opacity: 0.8;
    margin: 1rem 0 0 0;
    font-style: italic;
  }

  /* Complete section */
  .complete-section {
    text-align: center;
    padding: 1rem 0;
  }

  .complete-section :global(.complete-icon) {
    color: #28a745;
    margin: 0 auto 1rem;
  }

  .complete-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-light);
    margin: 0 0 0.75rem 0;
  }

  .complete-stats {
    font-size: 1rem;
    color: var(--text-light);
    margin: 0 0 1.5rem 0;
  }

  /* Action buttons */
  .action-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    justify-content: flex-end;
    margin-top: 1.5rem;
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

  .btn-danger {
    background-color: #dc3545;
    color: white;
    border-color: #dc3545;
  }

  .btn-danger:hover:not(:disabled) {
    background-color: #c82333;
    border-color: #c82333;
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(220, 53, 69, 0.3);
  }

  /* Responsive */
  @media (max-width: 640px) {
    .action-buttons {
      flex-direction: column;
    }

    .btn {
      width: 100%;
      justify-content: center;
    }
  }
</style>
