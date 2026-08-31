/**
 * Worker do domínio plpcg.com (`louvores-worker-production`).
 *
 * Recuperado da Cloudflare em 2026-08-31: até então o código só existia no
 * deploy. Ligado à rota `*plpcg.com/*`, roda antes do Pages e atende três
 * caminhos; todo o resto é repassado.
 *
 * Ver worker/wrangler.toml para o porquê de a regra de correspondência de
 * chave ser importada de src/lib/server/ em vez de copiada.
 */

import { findExactKeyMatch } from '../src/lib/server/r2KeyMatch.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === '/louvores-manifest.json' && request.method === 'GET') {
      return serveManifest(env);
    }

    if (url.pathname.startsWith('/assets/') && url.pathname.endsWith('.pdf')) {
      return servePdf(url.pathname, env);
    }

    if (url.pathname === '/api/upload-louvor' && request.method === 'POST') {
      return handleUpload(request, env);
    }

    return fetch(request);
  }
};

async function serveManifest(env) {
  try {
    const object = await env.LOUVORES_BUCKET.get('louvores-manifest.json');
    if (!object) {
      return new Response('Manifest not found', { status: 404, headers: CORS_HEADERS });
    }
    return new Response(object.body, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
        ...(object.httpEtag ? { ETag: object.httpEtag } : {})
      }
    });
  } catch (error) {
    console.error('Erro ao servir o manifest:', error);
    return new Response('Internal server error', { status: 500, headers: CORS_HEADERS });
  }
}

async function servePdf(pathname, env) {
  try {
    let r2Key = decodeURIComponent(pathname.substring(1));
    let object = await env.LOUVORES_BUCKET.get(r2Key);

    // Codificação dupla/tripla: desencapar até achar.
    if (!object) {
      let decodedKey = r2Key;
      for (let i = 0; i < 5; i++) {
        try {
          decodedKey = decodeURIComponent(decodedKey);
          object = await env.LOUVORES_BUCKET.get(decodedKey);
          if (object) {
            r2Key = decodedKey;
            break;
          }
        } catch (e) {
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

      const list = await env.LOUVORES_BUCKET.list({ prefix });
      const matched = findExactKeyMatch(
        list.objects.map((item) => item.key),
        `${prefix}/${expectedFilename}`
      );

      if (matched) {
        object = await env.LOUVORES_BUCKET.get(matched);
        if (object) {
          console.log(`[R2] Chave equivalente encontrada: ${r2Key} -> ${matched}`);
          r2Key = matched;
        }
      }
    }

    if (!object) {
      return new Response('PDF not found', { status: 404, headers: CORS_HEADERS });
    }

    return new Response(object.body, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/pdf',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        ...(object.httpEtag ? { ETag: object.httpEtag } : {}),
        ...(object.uploaded ? { 'Last-Modified': new Date(object.uploaded).toUTCString() } : {})
      }
    });
  } catch (error) {
    console.error('Erro ao servir PDF:', error);
    return new Response('Internal server error', { status: 500, headers: CORS_HEADERS });
  }
}

async function handleUpload(request, env) {
  try {
    // Falha fechada: sem segredo configurado, `verifyJWT(token, undefined)`
    // validaria contra a string "undefined" e qualquer um poderia escrever no
    // bucket. O binding não existe hoje, então o endpoint fica indisponível.
    if (!env.JWT_SECRET) {
      console.error('JWT_SECRET ausente — upload indisponível.');
      return new Response('Upload indisponível: JWT_SECRET não configurado', {
        status: 503,
        headers: CORS_HEADERS
      });
    }

    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response('Unauthorized', { status: 401, headers: CORS_HEADERS });
    }

    const token = authHeader.substring(7);
    if (!(await verifyJWT(token, env.JWT_SECRET))) {
      return new Response('Invalid token', { status: 401, headers: CORS_HEADERS });
    }

    const body = await request.json();
    const { file, metadata } = body;
    if (!file || !metadata) {
      return new Response('Missing file or metadata', { status: 400, headers: CORS_HEADERS });
    }

    const { nome, classificacao, numero, categoria } = metadata;
    if (!nome || !classificacao || !categoria) {
      return new Response('Missing required metadata fields', { status: 400, headers: CORS_HEADERS });
    }

    const fileData = base64ToBuffer(file);
    if (fileData.length > 10 * 1024 * 1024) {
      return new Response('File too large (max 10MB)', { status: 400, headers: CORS_HEADERS });
    }

    const timestamp = Date.now();
    const sanitizedName = nome.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${timestamp}-${sanitizedName}.pdf`;

    await env.LOUVORES_BUCKET.put(filename, fileData, {
      httpMetadata: { contentType: 'application/pdf' }
    });

    const manifest = await env.LOUVORES_BUCKET.get('louvores-manifest.json');
    const louvores = manifest ? await manifest.json() : [];

    const newLouvor = {
      nome,
      classificacao,
      numero: numero || '',
      categoria,
      pdf: filename,
      pdfId: btoa(`${classificacao}/${filename}`).replace(
        /[+/=]/g,
        (c) => ({ '+': '-', '/': '_', '=': '' })[c]
      )
    };
    louvores.push(newLouvor);

    await env.LOUVORES_BUCKET.put('louvores-manifest.json', JSON.stringify(louvores, null, 2), {
      httpMetadata: { contentType: 'application/json' }
    });

    return new Response(
      JSON.stringify({ success: true, message: 'Louvor adicionado com sucesso', louvor: newLouvor }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Erro no upload:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
}

async function verifyJWT(token, secret) {
  try {
    const [headerB64, payloadB64, signatureB64] = token.split('.');
    const payload = JSON.parse(atob(payloadB64));
    if (payload.exp && payload.exp < Date.now() / 1e3) return false;

    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signature = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify('HMAC', key, signature, data);
  } catch (error) {
    return false;
  }
}

function base64ToBuffer(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
