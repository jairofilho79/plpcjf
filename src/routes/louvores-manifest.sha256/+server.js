const HEX64 = /^[a-f0-9]{64}$/i;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store'
};

/** @param {string | undefined | null} value */
function normalizeChecksum(value) {
  if (value == null || typeof value !== 'string') return null;
  const t = value.trim().toLowerCase();
  return HEX64.test(t) ? t : null;
}

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders });
}

export async function GET({ platform }) {
  const raw = /** @type {{ LOUVORES_MANIFEST_CHECKSUM?: string }} */ (platform?.env)?.LOUVORES_MANIFEST_CHECKSUM;
  const checksum = normalizeChecksum(raw);

  if (!checksum) {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  return new Response(checksum, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/plain; charset=utf-8'
    }
  });
}
