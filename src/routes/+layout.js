// Global route configuration for the entire app
// Disable SSR globally to ensure consistent SPA behavior
// This ensures all routes (/, /leitor, etc.) work properly offline with the service worker
export const ssr = false;
export const prerender = false;
export const csr = true;

