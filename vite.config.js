import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { copyFileSync, existsSync, readFileSync } from 'fs';
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
      buildExcludes: [/app.html/],
      useCredentials: false,
      workbox: {
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
        // Verificar também se há sw.mjs (módulo ES6) que não deve ser usado em produção
        const sveltekitSwPath = join(process.cwd(), '.svelte-kit', 'output', 'client', 'sw.js');
        const sveltekitSwMjsPath = join(process.cwd(), '.svelte-kit', 'output', 'client', 'sw.mjs');
        
        // Se existir sw.mjs mas não sw.js, significa que o vite-plugin-pwa gerou um módulo ES6
        // que não funcionará sem type: 'module'. Precisamos do .js bundlado.
        if (existsSync(sveltekitSwMjsPath) && !existsSync(sveltekitSwPath)) {
          console.warn('[Vite Plugin] WARNING: Only sw.mjs found (ES6 module). This requires type: "module" registration.');
          console.warn('[Vite Plugin] Consider checking vite-plugin-pwa configuration to generate bundled sw.js');
        }
        
        if (existsSync(sveltekitSwPath)) {
          try {
            // Verificar se o arquivo está bundlado (não deve ter imports ES6)
            const swContent = readFileSync(sveltekitSwPath, 'utf-8');
            const hasES6Imports = /^import\s+.*from\s+['"]/.test(swContent) || /^import\s+['"]/.test(swContent);
            
            if (hasES6Imports) {
              console.warn('[Vite Plugin] WARNING: sw.js still contains ES6 imports!');
              // Se sw.js tem imports ES6, tentar usar sw.mjs que é o módulo correto
              if (existsSync(sveltekitSwMjsPath)) {
                console.log('[Vite Plugin] Using sw.mjs instead (ES6 module)');
                copyFileSync(sveltekitSwMjsPath, staticSwPath);
                console.log('[Vite Plugin] Copied sw.mjs to static/sw.js - NOTE: Must register with type: "module"');
              } else {
                console.warn('[Vite Plugin] sw.js has ES6 imports but sw.mjs not found. Copying anyway (may fail in production)');
                copyFileSync(sveltekitSwPath, staticSwPath);
              }
            } else {
              console.log('[Vite Plugin] Service worker appears to be properly bundled (no ES6 imports)');
              copyFileSync(sveltekitSwPath, staticSwPath);
            }
            console.log('[Vite Plugin] Copied service worker to static/sw.js');
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

