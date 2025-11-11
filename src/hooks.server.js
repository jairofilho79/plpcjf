import { error } from '@sveltejs/kit';

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
  const url = event.url;
  
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
    'Content-Type': 'application/pdf',
    'Cache-Control': 'public, max-age=31536000' // Cache for 1 year
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
    
    // If still not found, try to find a similar filename in the R2 bucket
    // This handles cases where the filename has encoding issues
    if (!object) {
      const pathParts = r2Key.split('/');
      const prefix = pathParts.slice(0, -1).join('/'); // Get directory part
      const expectedFilename = pathParts.pop(); // Get filename part
      
      // Normalize function: remove all non-alphanumeric characters for comparison
      const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normalizedExpected = normalize(expectedFilename);
      
      // List objects in the same directory
      const list = await platform.env.LOUVORES_BUCKET.list({ prefix });
      
      // Find a matching file by comparing normalized filenames
      for (const item of list.objects) {
        const itemFilename = item.key.split('/').pop();
        const normalizedItem = normalize(itemFilename);
        
        // Match if normalized names are identical or contain each other
        if (normalizedExpected === normalizedItem || 
            (normalizedExpected.length > 8 && normalizedExpected.includes(normalizedItem.substring(0, 10))) ||
            (normalizedItem.length > 8 && normalizedItem.includes(normalizedExpected.substring(0, 10)))) {
          object = await platform.env.LOUVORES_BUCKET.get(item.key);
          if (object) {
            console.log(`Matched file with encoding difference: ${expectedFilename} -> ${itemFilename}`);
            break;
          }
        }
      }
    }
    
    if (!object) {
      return new Response('PDF not found', { 
        status: 404, 
        headers: corsHeaders 
      });
    }
    
    return new Response(object.body, { headers: corsHeaders });
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
