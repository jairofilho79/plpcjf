import { error, isHttpError } from '@sveltejs/kit';
import { readDevLocalManifest } from '$lib/server/readDevLocalManifest.js';

const corsHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=3600',
  'Access-Control-Allow-Origin': '*'
};

/** @type {import('./$types').RequestHandler} */
export async function GET({ platform }) {
  try {
    if (platform?.env?.LOUVORES_BUCKET) {
      try {
        const object = await platform.env.LOUVORES_BUCKET.get('offline-manifest.json');
        if (object?.body) {
          return new Response(object.body, { headers: corsHeaders });
        }
      } catch (r2Error) {
        console.warn('[offline-manifest] R2 get failed:', r2Error);
      }
    }

    const local = await readDevLocalManifest('offline-manifest.json');
    if (local) {
      return new Response(local, { headers: corsHeaders });
    }

    throw error(503, 'Manifesto offline indisponível (R2 ou ficheiros locais em dev).');
  } catch (err) {
    if (isHttpError(err)) {
      throw err;
    }
    console.error('[offline-manifest] Erro ao servir manifesto:', err);
    throw error(500, 'Erro interno ao servir o manifesto offline.');
  }
}

