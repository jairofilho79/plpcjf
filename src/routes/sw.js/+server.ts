import type { RequestHandler } from './$types';
import { dev } from '$app/environment';

// Servir o service worker compilado pelo vite-plugin-pwa
// O vite-plugin-pwa compila durante o build para .svelte-kit/output/client/sw.js
// Em produção, tentamos acessar o arquivo compilado

export const GET: RequestHandler = async ({ url, fetch }) => {
  try {
    // Em produção, o vite-plugin-pwa deve ter compilado o service worker
    // O rollupOptions deve ter gerado um bundle sem imports ES6
    // Se o ?raw ainda retornar imports ES6, o rollupOptions não está funcionando
    
    // Fallback: usar ?raw (retorna o source, mas pode funcionar se rollupOptions funcionou)
    // OU usar em desenvolvimento
    const swModule = await import('../../service-worker/sw.js?raw');
    const swContent = swModule.default || swModule;
    
    // Verificar se ainda tem imports ES6
    const hasES6Imports = /^import\s+.*from\s+['"]/.test(swContent) || /^import\s+['"]/.test(swContent);
    
    if (hasES6Imports && !dev) {
      console.error('[SW Route] Service worker has ES6 imports but rollupOptions should have bundled them!');
      console.error('[SW Route] This means the vite-plugin-pwa rollupOptions may not be working correctly.');
    }
    
    return new Response(swContent, {
      headers: {
        'Content-Type': 'application/javascript',
        'Service-Worker-Allowed': '/',
        'Cache-Control': 'public, max-age=0, must-revalidate'
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
