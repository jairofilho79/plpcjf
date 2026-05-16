import { error } from '@sveltejs/kit';

/** @type {import('./$types').RequestHandler} */
export async function GET({ url, platform }) {
  try {
    // Try to get from R2 bucket first
    if (platform?.env?.LOUVORES_BUCKET) {
      try {
        const object = await platform.env.LOUVORES_BUCKET.get('offline-manifest.json');
        if (object) {
          return new Response(object.body, {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=3600',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
      } catch (r2Error) {
        console.warn('Failed to get offline-manifest.json from R2:', r2Error);
      }
    }

    // If not found in R2, return 404
    throw error(404, 'Offline manifest not found');
  } catch (err) {
    console.error('Error serving offline-manifest.json:', err);
    throw error(500, 'Internal server error');
  }
}

