import type { RequestHandler } from './$types';

// Servir o service worker compilado pelo vite-plugin-pwa
// O vite-plugin-pwa processa e injeta o manifest durante o build
// O Vite resolve o import ?raw corretamente em produção

export const GET: RequestHandler = async () => {
  try {
    // Importar o service worker
    // O vite-plugin-pwa compila durante o build e injeta o manifest
    // Em produção, o Vite resolve para o arquivo compilado corretamente
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
