import type { RequestHandler } from './$types';
import { dev } from '$app/environment';

// Servir o service worker compilado pelo vite-plugin-pwa
// 
// IMPORTANTE: Em desenvolvimento, o vite-plugin-pwa com devOptions.enabled serve
// o service worker automaticamente. Não devemos interceptar com esta rota.
// Esta rota é apenas para produção (Cloudflare Pages).
//
// O vite-plugin-pwa compila durante o build e o plugin copy-sw-to-static copia para static/sw.js
// Em produção no Cloudflare, tentamos acessar via fetch do próprio servidor ou usar o arquivo estático

export const GET: RequestHandler = async ({ url, fetch }) => {
  try {
    let swContent: string | null = null;
    let source = 'unknown';
    
    if (dev) {
      // PROBLEMA: Em dev com injectManifest, o vite-plugin-pwa não bundla o service worker.
      // O rollupOptions só é aplicado durante o build. O ?raw retorna o source com imports ES6.
      // 
      // O browser não consegue resolver imports como 'workbox-precaching' porque esses
      // não são módulos ES disponíveis. Eles precisam ser bundlados.
      //
      // SOLUÇÃO TEMPORÁRIA: Em dev, o service worker pode não funcionar corretamente
      // porque os módulos workbox não estão disponíveis. Isso é uma limitação do
      // vite-plugin-pwa com injectManifest em desenvolvimento.
      //
      // OPÇÕES:
      // 1. Usar generateSW em vez de injectManifest (menos controle, mas funciona em dev)
      // 2. Processar o service worker manualmente em dev (complexo)
      // 3. Aceitar que em dev o service worker não funciona completamente
      //
      // Por enquanto, vamos servir o source e deixar o erro aparecer.
      // Em produção, o rollupOptions bundla tudo corretamente.
      
      const swModule = await import('../../service-worker/sw.js?raw');
      swContent = swModule.default || swModule;
      source = 'dev-raw-source-unbundled';
      console.warn('[SW Route] Dev: Serving unbundled source (may not work - workbox imports need bundling)');
      console.warn('[SW Route] Dev: Service worker functionality may be limited in development');
    } else {
      // Em produção, tentar múltiplas estratégias compatíveis com Cloudflare Workers
      // IMPORTANTE: Precisamos do arquivo COMPILADO (bundlado), não o source
      
      // Estratégia 1: Tentar usar ?url para importar o arquivo compilado como asset
      // O vite-plugin-pwa compila para .svelte-kit/output/client/sw.js
      // O plugin copy-sw-to-static copia para static/sw.js
      // Em produção, o Vite pode servir via ?url o arquivo processado
      try {
        // Tentar importar como URL primeiro (para pegar o caminho do asset compilado)
        const swUrlModule = await import('../../service-worker/sw.js?url');
        const swUrl = typeof swUrlModule === 'string' 
          ? swUrlModule 
          : (swUrlModule.default || swUrlModule.url || swUrlModule);
        
        if (swUrl && typeof swUrl === 'string') {
          // Construir URL absoluta
          const swFullUrl = swUrl.startsWith('http') 
            ? swUrl 
            : new URL(swUrl.startsWith('/') ? swUrl : `/${swUrl}`, url.origin).href;
          
          console.log('[SW Route] Attempting to fetch compiled SW from:', swFullUrl);
          const response = await fetch(swFullUrl, {
            // Evitar cache para garantir que pegamos a versão mais recente
            cache: 'no-store'
          });
          if (response.ok) {
            swContent = await response.text();
            source = 'prod-?url-compiled';
            console.log('[SW Route] Successfully fetched compiled SW via ?url, length:', swContent.length);
          } else {
            console.warn('[SW Route] Failed to fetch via ?url, status:', response.status);
          }
        }
      } catch (urlError) {
        console.warn('[SW Route] Error fetching via ?url:', urlError);
      }
      
      // Estratégia 2: Tentar buscar diretamente do static (se disponível no Cloudflare)
      // No Cloudflare Pages, arquivos em static/ são servidos automaticamente
      // Mas como temos uma rota /sw.js, ela pode interceptar
      // Tentar buscar com um timestamp para evitar cache
      if (!swContent) {
        try {
          const staticSwUrl = `${url.origin}/sw.js?t=${Date.now()}`;
          console.log('[SW Route] Attempting to fetch static SW from:', staticSwUrl);
          const response = await fetch(staticSwUrl, {
            cache: 'no-store'
          });
          if (response.ok) {
            const text = await response.text();
            // Verificar se não é uma resposta de erro (ex: 500)
            if (!text.includes('Service Worker Error')) {
              swContent = text;
              source = 'prod-static-asset';
              console.log('[SW Route] Successfully fetched from static asset, length:', swContent.length);
            }
          }
        } catch (staticError) {
          console.warn('[SW Route] Failed to fetch static asset:', staticError);
        }
      }
      
      // Estratégia 3: Usar ?raw como último recurso
      // AVISO: Isso pode retornar o source não compilado com imports ES6!
      if (!swContent) {
        console.warn('[SW Route] Using ?raw fallback (WARNING: may return unbundled source with ES6 imports)');
        const swModule = await import('../../service-worker/sw.js?raw');
        swContent = swModule.default || swModule;
        source = 'prod-?raw-fallback';
      }
    }
    
    if (!swContent) {
      throw new Error('Service worker content is null');
    }
    
    // Verificar se ainda tem imports ES6 (não deveria se rollupOptions funcionou)
    const hasES6Imports = /^import\s+.*from\s+['"]/.test(swContent) || /^import\s+['"]/.test(swContent);
    
    console.log(`[SW Route] Service worker loaded from: ${source}, length: ${swContent.length}, has ES6 imports: ${hasES6Imports}`);
    
    if (hasES6Imports && !dev) {
      console.error('[SW Route] ❌ CRITICAL: Service worker still contains ES6 imports!');
      console.error('[SW Route] This means the rollupOptions did NOT bundle the dependencies.');
      console.error('[SW Route] The service worker will FAIL to register in production.');
      console.error('[SW Route] Source:', source);
      console.error('[SW Route] First 300 chars:', swContent.substring(0, 300));
      console.error('[SW Route] This is likely because ?raw or ?url returned the unbundled source.');
      console.error('[SW Route] SOLUTION: The vite-plugin-pwa rollupOptions needs to be checked.');
    } else if (!dev && !hasES6Imports) {
      console.log('[SW Route] ✅ Service worker is properly bundled (no ES6 imports)');
      console.log('[SW Route] Source:', source);
    }
    
    return new Response(swContent, {
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Service-Worker-Allowed': '/',
        'Cache-Control': 'public, max-age=0, must-revalidate',
        // Headers adicionais para garantir compatibilidade com Cloudflare
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('[SW Route] Error loading service worker:', error);
    return new Response(`Service Worker Error: ${error}`, { 
      status: 500,
      headers: {
        'Content-Type': 'text/plain'
      }
    });
  }
};
