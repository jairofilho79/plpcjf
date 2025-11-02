import { writable, derived } from 'svelte/store';

// Load louvores data from manifest
let louvores = writable([]);
let louvoresLoaded = writable(false);

export async function loadLouvores() {
  try {
    const response = await fetch('/louvores-manifest.json');
    if (response.ok) {
      const data = await response.json();
      louvores.set(data);
      louvoresLoaded.set(true);
      console.log(`Loaded ${data.length} louvores from manifest`);
    } else {
      console.error('Failed to load louvores manifest:', response.status);
      louvoresLoaded.set(true);
    }
  } catch (error) {
    console.error('Error loading louvores:', error);
    louvoresLoaded.set(true);
  }
}

export { louvores, louvoresLoaded };

