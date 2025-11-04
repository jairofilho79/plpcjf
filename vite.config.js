import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { copyFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
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
        maximumFileSizeToCacheInBytes: 5000000,
        // Configurar Rollup para fazer bundle completo (sem imports ES6)
        rollupOptions: {
          output: {
            format: 'iife',
            name: 'sw'
          }
        }
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
    // Plugin para copiar o service worker compilado para static/ e .svelte-kit/cloudflare/
    // IMPORTANTE: Este plugin deve executar DEPOIS do vite-plugin-pwa
    // O vite-plugin-pwa executa no writeBundle, então copiamos no closeBundle
    {
      name: 'copy-sw-to-static',
      closeBundle() {
        const staticSwPath = join(process.cwd(), 'static', 'sw.js');
        const cloudflareSwPath = join(process.cwd(), '.svelte-kit', 'cloudflare', 'sw.js');
        
        // O vite-plugin-pwa com injectManifest coloca o SW compilado em dist/sw.js
        const distSwPath = join(process.cwd(), 'dist', 'sw.js');
        
        let swSourcePath = null;
        let swContent = null;
        
        // Tentar copiar de dist/ primeiro (onde o Vite normalmente coloca)
        if (existsSync(distSwPath)) {
          swSourcePath = distSwPath;
        } else {
          // Fallback: tentar em .svelte-kit/output/client/sw.js (SvelteKit build output)
          const sveltekitSwPath = join(process.cwd(), '.svelte-kit', 'output', 'client', 'sw.js');
          const sveltekitSwMjsPath = join(process.cwd(), '.svelte-kit', 'output', 'client', 'sw.mjs');
          
          // Se existir sw.mjs mas não sw.js, significa que o vite-plugin-pwa gerou um módulo ES6
          if (existsSync(sveltekitSwMjsPath) && !existsSync(sveltekitSwPath)) {
            console.warn('[Vite Plugin] WARNING: Only sw.mjs found (ES6 module). This requires type: "module" registration.');
          }
          
          if (existsSync(sveltekitSwPath)) {
            swSourcePath = sveltekitSwPath;
          }
        }
        
        if (!swSourcePath) {
          console.warn('[Vite Plugin] Service worker not found in dist/ or .svelte-kit/output/client/');
          return;
        }
        
        try {
          // Ler e verificar se está bundlado
          let swContent = readFileSync(swSourcePath, 'utf-8');
          const hasES6Imports = /^import\s+.*from\s+['"]/.test(swContent) || /^import\s+['"]/.test(swContent);
          
          if (hasES6Imports) {
            console.warn('[Vite Plugin] WARNING: sw.js still contains ES6 imports!');
            // Tentar usar sw.mjs se disponível
            const sveltekitSwMjsPath = join(process.cwd(), '.svelte-kit', 'output', 'client', 'sw.mjs');
            if (existsSync(sveltekitSwMjsPath)) {
              console.log('[Vite Plugin] Using sw.mjs instead (ES6 module)');
              swContent = readFileSync(sveltekitSwMjsPath, 'utf-8');
              swSourcePath = sveltekitSwMjsPath;
            }
          } else {
            console.log('[Vite Plugin] Service worker appears to be properly bundled (no ES6 imports)');
          }
          
          // Copiar para static/ (para desenvolvimento e outros adapters)
          copyFileSync(swSourcePath, staticSwPath);
          console.log('[Vite Plugin] Copied service worker to static/sw.js');
          
          // Copiar também para .svelte-kit/cloudflare/ (para Cloudflare Pages)
          // Garantir que o diretório existe
          const cloudflareDir = join(process.cwd(), '.svelte-kit', 'cloudflare');
          if (!existsSync(cloudflareDir)) {
            mkdirSync(cloudflareDir, { recursive: true });
          }
          copyFileSync(swSourcePath, cloudflareSwPath);
          console.log('[Vite Plugin] Copied service worker to .svelte-kit/cloudflare/sw.js');
        } catch (error) {
          console.warn('[Vite Plugin] Failed to copy service worker:', error);
        }
      }
    }
  ]
});

