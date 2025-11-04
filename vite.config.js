import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { copyFileSync, existsSync } from 'fs';
import { join } from 'path';

export default defineConfig({
  plugins: [
    sveltekit(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/service-worker',
      filename: 'sw.js',
      registerType: 'manual',
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,json}'],
        maximumFileSizeToCacheInBytes: 5000000
      },
      workbox: {
        // Garantir que o service worker seja gerado corretamente
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: false
      },
      devOptions: {
        enabled: true,
        type: 'module',
        navigateFallback: '/',
        disable: false
      }
    }),
    // Plugin para copiar o service worker compilado para static/ após o build
    {
      name: 'copy-sw-to-static',
      // Usar closeBundle que é chamado após todos os bundles serem gerados
      closeBundle() {
        const staticSwPath = join(process.cwd(), 'static', 'sw.js');
        
        // O vite-plugin-pwa com injectManifest coloca o SW compilado em dist/sw.js
        const distSwPath = join(process.cwd(), 'dist', 'sw.js');
        
        // Tentar copiar de dist/ primeiro (onde o Vite normalmente coloca)
        if (existsSync(distSwPath)) {
          try {
            copyFileSync(distSwPath, staticSwPath);
            console.log('[Vite Plugin] Copied compiled service worker from dist/sw.js to static/sw.js');
            return;
          } catch (error) {
            console.warn('[Vite Plugin] Failed to copy from dist:', error);
          }
        }
        
        // Fallback: tentar em .svelte-kit/output/client/sw.js (SvelteKit build output)
        const sveltekitSwPath = join(process.cwd(), '.svelte-kit', 'output', 'client', 'sw.js');
        if (existsSync(sveltekitSwPath)) {
          try {
            copyFileSync(sveltekitSwPath, staticSwPath);
            console.log('[Vite Plugin] Copied compiled service worker from SvelteKit output to static/sw.js');
          } catch (error) {
            console.warn('[Vite Plugin] Failed to copy from SvelteKit output:', error);
          }
        } else {
          console.warn('[Vite Plugin] Service worker not found in dist/ or .svelte-kit/output/client/');
        }
      }
    }
  ]
});

