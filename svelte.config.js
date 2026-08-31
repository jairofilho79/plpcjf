import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess({
    postcss: true
  }),
  kit: {
    adapter: adapter({
      routes: {
        include: ['/*'],
        exclude: ['<build>', '<prerendered>']
      }
    }),
    serviceWorker: {
      // O registro é feito por src/lib/utils/swRegistration.js, que também cuida
      // do polling de atualização e da limpeza dos listeners. Deixar o registro
      // embutido do SvelteKit ligado registraria o mesmo worker duas vezes.
      register: false
    }
  }
};

export default config;

