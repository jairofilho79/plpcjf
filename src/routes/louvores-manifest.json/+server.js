export async function GET({ platform, url }) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600'
  };

  try {
    // First, try to get from R2 bucket if available
    if (platform?.env?.LOUVORES_BUCKET) {
      const object = await platform.env.LOUVORES_BUCKET.get('louvores-manifest.json');
      if (object) {
        return new Response(object.body, { headers: corsHeaders });
      }
    }

    // Fallback: In development, try to fetch from static file
    // The file should be in static/louvores-manifest.json
    try {
      const staticUrl = new URL('/louvores-manifest.json', url.origin).toString();
      const staticResponse = await fetch(staticUrl);
      
      if (staticResponse.ok) {
        const manifestData = await staticResponse.text();
        return new Response(manifestData, { headers: corsHeaders });
      }
    } catch (e) {
      console.warn('Could not fetch from static file:', e);
    }

    // Last resort: return empty array
    console.warn('No manifest available from R2 or static');
    return new Response(JSON.stringify([]), { 
      status: 200, 
      headers: corsHeaders 
    });
  } catch (error) {
    console.error('Error serving manifest:', error);
    return new Response(JSON.stringify([]), { 
      status: 200, 
      headers: corsHeaders 
    });
  }
}

