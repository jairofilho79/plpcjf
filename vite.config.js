import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

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
      devOptions: {
        enabled: true,
        type: 'module',
        navigateFallback: '/',
        disable: false
      }
    })
  ]
});

