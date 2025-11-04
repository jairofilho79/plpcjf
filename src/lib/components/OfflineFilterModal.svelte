<script lang="ts">
  import { browser } from '$app/environment';
  import { CATEGORY_OPTIONS } from '$lib/stores/filters';
  
  export let show = false;
  export let onConfirm = (filters: string[]) => {};
  export let onCancel = () => {};
  
  let selectedFilters: string[] = []; // Inicialmente nenhuma selecionada
  
  function handleCategoryChange(category: string, event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.checked) {
      if (!selectedFilters.includes(category)) {
        selectedFilters = [...selectedFilters, category];
      }
    } else {
      selectedFilters = selectedFilters.filter(c => c !== category);
    }
  }
  
  function handleConfirm() {
    if (selectedFilters.length === 0) {
      return; // Não deve acontecer pois o botão estará desabilitado
    }
    onConfirm(selectedFilters);
  }
  
  function handleCancel() {
    // Reset para estado inicial
    selectedFilters = [];
    onCancel();
  }
  
  // Reset quando o modal é aberto
  $: if (show) {
    selectedFilters = [];
  }
  
  $: hasSelection = selectedFilters.length > 0;
</script>

{#if show && browser}
  <div class="fixed inset-0 bg-black/80 flex items-center justify-center z-[10000] p-4">
    <div class="bg-card-color rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl">
      <div class="p-6">
        <h2 class="text-2xl font-garamond font-bold text-title-color mb-6 text-center">
          Download para Uso Offline
        </h2>
        
        <!-- Warning Message -->
        <div class="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-4 mb-6 shadow-md">
          <div class="flex items-start gap-3">
            <div class="text-2xl flex-shrink-0">⚠️</div>
            <div class="flex-1">
              <div class="font-bold text-yellow-800 text-lg mb-2">ATENÇÃO</div>
              <div class="text-sm text-yellow-900 leading-relaxed">
                Há uma limitação global de 100.000 downloads de PDFs por dia. Se todas as pessoas baixassem todos os PDFs, somente cerca de 20 pessoas poderiam usufruir dessa funcionalidade por dia. Por favor, baixe apenas as categorias que você realmente precisa para uso offline.
              </div>
            </div>
          </div>
        </div>

        <div class="mb-6">
          <div class="flex flex-col gap-3">
            {#each CATEGORY_OPTIONS as category}
              {@const isChecked = selectedFilters.includes(category)}
              <label class="flex items-center gap-3 cursor-pointer hover:bg-gold-light/30 p-2 rounded transition-colors">
                <input
                  type="checkbox"
                  checked={isChecked}
                  on:change={(e) => handleCategoryChange(category, e)}
                  class="w-5 h-5 text-gold-color border-2 border-title-color rounded focus:ring-2 focus:ring-gold-color cursor-pointer"
                />
                <span class="text-text-dark">{category}</span>
              </label>
            {/each}
          </div>
        </div>

        <div class="flex gap-3 justify-end pt-4 border-t border-title-color/20">
          <button
            on:click={handleCancel}
            class="px-6 py-2.5 bg-gray-400 text-white rounded-lg font-semibold hover:bg-gray-500 transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            on:click={handleConfirm}
            disabled={!hasSelection}
            class="px-6 py-2.5 bg-gold-color text-text-dark rounded-lg font-bold hover:bg-gold-light transition-colors cursor-pointer shadow-md disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed disabled:hover:bg-gray-300"
          >
            Confirmar Download
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
