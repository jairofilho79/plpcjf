import { error } from '@sveltejs/kit';
import { resolvePdfKey } from '$lib/server/pdfKeyResolution.js';

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
  const url = event.url;

  // Preflight CORS de origem cruzada. O Worker `louvores-worker-production`
  // respondia a isto para a zona plpcg.com inteira; ao tirá-lo da frente do
  // apex, a resposta passa a sair daqui. Clientes cross-origin que mandam
  // Authorization (o app Flutter, por exemplo) dependem dela.
  if (event.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }

  // Serve PDFs from R2 if they match /assets/**/*.pdf pattern
  if (url.pathname.startsWith('/assets/') && url.pathname.endsWith('.pdf')) {
    return await servePdf(url.pathname, event.platform);
  }

  if (url.pathname.startsWith('/packages/') && url.pathname.endsWith('.zip')) {
    return await serveZipPackage(url.pathname, event.platform);
  }

  // Pass other requests to SvelteKit
  return resolve(event);
}

async function servePdf(pathname, platform) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  try {
    if (!platform?.env?.LOUVORES_BUCKET) {
      console.error('LOUVORES_BUCKET not configured');
      return new Response('Backend not configured', { 
        status: 503, 
        headers: corsHeaders 
      });
    }

    // pathname will be like "/assets/ColAdultos/001.pdf"
    // A resolução (decodificação, formas Unicode NFD/NFC e o fallback por
    // prefixo/normalização) vive em pdfKeyResolution.js — extraída de propósito
    // para ser testável sob `node --test` sem o alias `$lib` (ver achado C2).
    const resolved = await resolvePdfKey(pathname, platform.env.LOUVORES_BUCKET);

    if (!resolved) {
      return new Response('PDF not found', {
        status: 404,
        headers: corsHeaders
      });
    }

    const { object } = resolved;

    return new Response(object.body, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        ...(object.httpEtag ? { ETag: object.httpEtag } : {}),
        ...(object.uploaded ? { 'Last-Modified': new Date(object.uploaded).toUTCString() } : {})
      }
    });
  } catch (err) {
    console.error('Error serving PDF:', err);
    return new Response('Internal server error', { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}



async function serveZipPackage(pathname, platform) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  try {
    if (!platform?.env?.LOUVORES_BUCKET) {
      console.error('LOUVORES_BUCKET not configured');
      return new Response('Backend not configured', {
        status: 503,
        headers: corsHeaders
      });
    }

    let r2Key = decodeURIComponent(pathname.substring(1));
    let object = await platform.env.LOUVORES_BUCKET.get(r2Key);

    if (!object) {
      let decodedKey = r2Key;
      for (let i = 0; i < 5; i++) {
        try {
          decodedKey = decodeURIComponent(decodedKey);
          object = await platform.env.LOUVORES_BUCKET.get(decodedKey);
          if (object) {
            r2Key = decodedKey;
            break;
          }
        } catch (e) {
          break;
        }
      }
    }

    if (!object) {
      return new Response('Pacote nao encontrado', {
        status: 404,
        headers: corsHeaders
      });
    }

    return new Response(object.body, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/zip',
        'Cache-Control': 'public, max-age=86400',
        'Content-Disposition': `attachment; filename="${r2Key.split('/').pop() || 'pacote.zip'}"`
      }
    });
  } catch (err) {
    console.error('Error serving ZIP package:', err);
    return new Response('Internal server error', {
      status: 500,
      headers: corsHeaders
    });
  }
}
