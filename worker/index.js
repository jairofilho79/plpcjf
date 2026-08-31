/**
 * Worker do domínio plpcg.com (`louvores-worker-production`).
 *
 * Recuperado da Cloudflare em 2026-08-31: até então o código só existia no
 * deploy. Ligado à rota `*.plpcg.com/*`, roda antes do Pages e atende dois
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
