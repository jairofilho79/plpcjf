/**
 * SHA-256 do corpo UTF-8 do louvores-manifest.json publicado no R2.
 *
 * O valor vem de um objeto no MESMO bucket do manifest, gravado pela app admin
 * (admin.plpcg.com) na mesma operação de publicação.
 *
 * Antes vinha de `platform.env.LOUVORES_MANIFEST_CHECKSUM`, e nunca funcionou:
 * o wrangler.toml deste repositório é a fonte da verdade para env vars do Pages
 * ("your Wrangler file is the source of truth" — docs da Cloudflare), então o
 * PATCH que a admin fazia via API do Pages era desfeito no deploy seguinte daqui.
 * Guardando o checksum ao lado do manifest, ele deixa de depender do ciclo de
 * deploy deste projeto.
 */

const HEX64 = /^[a-f0-9]{64}$/i;

/** Chave irmã de `louvores-manifest.json`. Espelha MANIFEST_CHECKSUM_R2_KEY na app admin. */
const CHECKSUM_R2_KEY = 'louvores-manifest.sha256';

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
  const bucket = platform?.env?.LOUVORES_BUCKET;
  if (!bucket) {
    // Dev local sem binding do R2: sem checksum, o cliente simplesmente não sincroniza.
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let raw;
  try {
    const object = await bucket.get(CHECKSUM_R2_KEY);
    if (!object) {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    raw = await object.text();
  } catch (err) {
    console.error('Erro ao ler checksum do R2:', err);
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Valida mesmo vindo do R2: objeto truncado ou corrompido não vira checksum válido,
  // e um valor errado aqui faz o cliente rebaixar o manifest inteiro em loop.
  const checksum = normalizeChecksum(raw);
  if (!checksum) {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return new Response(checksum, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/plain; charset=utf-8'
    }
  });
}
