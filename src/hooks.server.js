import { error } from '@sveltejs/kit';
import { findExactKeyMatch } from '$lib/server/r2KeyMatch.js';

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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/pdf'
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
    // May contain URL-encoded characters like %20 for spaces, %5C for backslashes
    // Need to decode it before getting from R2 with key "assets/ColAdultos/001.pdf" (no leading slash)
    let r2Key = decodeURIComponent(pathname.substring(1)); // Remove leading "/" and decode URI encoding
    
    // Try to get the object
    let object = await platform.env.LOUVORES_BUCKET.get(r2Key);
    
    // If not found, try decoding multiple times (handles double/triple encoding)
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
          // Can't decode further, stop trying
          break;
        }
      }
    }
    
    // Último recurso: a chave real pode diferir só em acento/caixa.
    // Correspondência exata após normalização — nunca por prefixo (achado #09).
    if (!object) {
      const pathParts = r2Key.split('/');
      const expectedFilename = pathParts.pop();
      const prefix = pathParts.join('/');

      const list = await platform.env.LOUVORES_BUCKET.list({ prefix });
      const matched = findExactKeyMatch(
        list.objects.map((item) => item.key),
        `${prefix}/${expectedFilename}`
      );

      if (matched) {
        object = await platform.env.LOUVORES_BUCKET.get(matched);
        if (object) {
          console.log(`[R2] Chave equivalente encontrada: ${r2Key} -> ${matched}`);
          r2Key = matched;
        }
      }
    }

    if (!object) {
      return new Response('PDF not found', { 
        status: 404, 
        headers: corsHeaders 
      });
    }
    
    return new Response(object.body, {
      headers: {
        ...corsHeaders,
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/zip',
    'Cache-Control': 'public, max-age=86400'
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
