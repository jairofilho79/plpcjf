<script>
  import { AlertTriangle } from 'lucide-svelte';
  import { offline } from '$lib/stores/offline';
  import { browser } from '$app/environment';

  const IS_LEITOR_OFFLINE_KEY = 'IS_LEITOR_OFFLINE';

  $: savedCategories = offline.getSavedCategories();
  $: hasCategoryDownloaded = savedCategories && savedCategories.length > 0;
  
  $: isLeitorOffline = browser ? localStorage.getItem(IS_LEITOR_OFFLINE_KEY) === 'true' : false;
  
  $: requirementsMet = hasCategoryDownloaded && isLeitorOffline;
  $: showAlert = !requirementsMet;
</script>

{#if showAlert}
  <div class="requirements-alert">
    <AlertTriangle class="alert-icon" />
    <div class="alert-content">
      <p class="alert-title">Requisitos para modo offline não cumpridos</p>
      <ul class="alert-list">
        {#if !hasCategoryDownloaded}
          <li>Baixe pelo menos 1 categoria (ver abaixo)</li>
        {/if}
        {#if !isLeitorOffline}
          <li>Abra qualquer PDF online no leitor.</li>
        {/if}
      </ul>
    </div>
  </div>
{/if}

<style>
  .requirements-alert {
    display: flex;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    background-color: #fff8e1;
    border: 2px solid #d4af37;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
    align-items: flex-start;
  }

  .alert-icon {
    width: 1.25rem;
    height: 1.25rem;
    color: #8b4513;
    flex-shrink: 0;
    margin-top: 0.125rem;
  }

  .alert-content {
    flex: 1;
  }

  .alert-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: #8b4513;
    margin: 0 0 0.5rem 0;
  }

  .alert-list {
    margin: 0;
    padding-left: 1.25rem;
    font-size: 0.8125rem;
    color: #8b4513;
    line-height: 1.6;
  }

  .alert-list li {
    margin-bottom: 0.25rem;
  }

  .alert-list li:last-child {
    margin-bottom: 0;
  }
</style>

