/**
 * Versão incremental do catálogo de louvores (ponteiro leve).
 *
 * Deploy (R2): 1) publicar louvores-manifest.json  2) depois incrementar louvores-version.json
 * para reduzir a janela em que a versão aponta para manifest ainda antigo.
 */
export async function GET({ platform, url }) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };

  try {
    if (platform?.env?.LOUVORES_BUCKET) {
      const object = await platform.env.LOUVORES_BUCKET.get('louvores-version.json');
      if (object) {
        return new Response(object.body, { headers: corsHeaders });
      }
    }

    try {
      const staticUrl = new URL('/louvores-version.json', url.origin).toString();
      const staticResponse = await fetch(staticUrl);
      if (staticResponse.ok) {
        const body = await staticResponse.text();
        return new Response(body, { headers: corsHeaders });
      }
    } catch (e) {
      console.warn('louvores-version: static fallback failed:', e);
    }

    console.warn('louvores-version: no R2 or static; returning version 0');
    return new Response(JSON.stringify({ version: 0 }), {
      status: 200,
      headers: corsHeaders
    });
  } catch (error) {
    console.error('louvores-version:', error);
    return new Response(JSON.stringify({ version: 0 }), {
      status: 200,
      headers: corsHeaders
    });
  }
}
