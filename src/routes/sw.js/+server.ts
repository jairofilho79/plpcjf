import type { RequestHandler } from './$types';

// O vite-plugin-pwa com injectManifest processa o service worker durante o build
// e injeta o __WB_MANIFEST. Em produção, o Vite serve o arquivo processado.

export const GET: RequestHandler = async () => {
  try {
    // Importar o service worker source - o vite-plugin-pwa processa durante o build
    // Em desenvolvimento, o Vite processa dinamicamente
    // Em produção, o arquivo já foi processado pelo vite-plugin-pwa
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
