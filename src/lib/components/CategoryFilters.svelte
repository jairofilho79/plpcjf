<script>
  import { filters, CATEGORY_OPTIONS } from '$lib/stores/filters';
  
  let allChecked = $filters.length === CATEGORY_OPTIONS.length;
  let indeterminate = false;
  
  $: {
    allChecked = $filters.length === CATEGORY_OPTIONS.length;
    indeterminate = $filters.length > 0 && $filters.length < CATEGORY_OPTIONS.length;
  }
  
  function handleTodosChange(event) {
    if (event.target.checked) {
      filters.selectAll();
    } else {
      filters.deselectAll();
    }
  }
  
  function handleCategoryChange(category) {
    filters.toggleCategory(category);
  }
  
  function isChecked(category) {
    return $filters.includes(category);
  }
</script>

<div class="w-full max-w-4xl p-4 bg-card-color rounded-lg border border-gray-200 flex flex-wrap gap-3 items-center justify-center">
  <label class="flex items-center gap-2 cursor-pointer text-sm font-semibold">
    <input
      type="checkbox"
      checked={allChecked}
      indeterminate={indeterminate}
      on:change={handleTodosChange}
      class="w-5 h-5 accent-gold-color cursor-pointer"
    />
    <span>Todos</span>
  </label>
  
  {#each CATEGORY_OPTIONS as category}
    <label class="flex items-center gap-2 cursor-pointer text-sm">
      <input
        type="checkbox"
        checked={isChecked(category)}
        on:change={() => handleCategoryChange(category)}
        class="w-5 h-5 accent-gold-color cursor-pointer"
      />
      <span>{category}</span>
    </label>
  {/each}
</div>

