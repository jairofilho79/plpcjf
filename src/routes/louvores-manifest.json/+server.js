import { readDevLocalManifest } from '$lib/server/readDevLocalManifest.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=3600'
};

/** @type {import('./$types').RequestHandler} */
export async function GET({ platform }) {
  try {
    if (platform?.env?.LOUVORES_BUCKET) {
      try {
        const object = await platform.env.LOUVORES_BUCKET.get('louvores-manifest.json');
        if (object?.body) {
          return new Response(object.body, { headers: corsHeaders });
        }
      } catch (r2Error) {
        console.warn('[louvores-manifest] R2 get failed:', r2Error);
      }
    }

    const local = await readDevLocalManifest('louvores-manifest.json');
    if (local) {
      return new Response(local, { headers: corsHeaders });
    }

    return new Response(
      JSON.stringify({
        error: 'Manifesto de louvores indisponível (R2 ou ficheiros locais em dev).',
        code: 'LOUVORES_MANIFEST_UNAVAILABLE'
      }),
      { status: 503, headers: corsHeaders }
    );
  } catch (error) {
    console.error('[louvores-manifest] Erro ao servir manifesto:', error);
    return new Response(
      JSON.stringify({
        error: 'Erro interno ao servir o manifesto de louvores.',
        code: 'LOUVORES_MANIFEST_ERROR'
      }),
      { status: 500, headers: corsHeaders }
    );
  }
}
