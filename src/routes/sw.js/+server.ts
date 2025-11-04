import type { RequestHandler } from './$types';

// Service Worker Route
// O vite-plugin-pwa compila o service worker durante o build e deve colocá-lo em static/sw.js
// Se static/sw.js existir, o SvelteKit serve automaticamente e esta rota não é chamada
// Esta rota é um fallback para servir o source quando necessário

export const GET: RequestHandler = async () => {
  try {
    // Importar o service worker source
    // O vite-plugin-pwa processa durante o build e injeta o manifest
    // Em produção, deve haver um arquivo compilado em static/sw.js
    // Mas se esta rota for chamada, servimos o source
    const swModule = await import('../../service-worker/sw.js?raw');
    const swContent = swModule.default || swModule;
    
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
