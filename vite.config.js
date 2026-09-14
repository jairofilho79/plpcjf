import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit()
  ],
  resolve: {
    // Default do Vite 5 para o cliente. O vite-plugin-svelte 3.x, quando não
    // há mainFields configurado, monta a lista a partir de uma constante sem
    // 'browser' — e o Vite só honra o campo `browser` em forma de objeto do
    // package.json (ex.: `qrcode` → lib/browser.js) quando 'browser' está aqui.
    // O plugin ainda prefixa 'svelte' a esta lista.
    mainFields: ['browser', 'module', 'jsnext:main', 'jsnext']
  }
});
