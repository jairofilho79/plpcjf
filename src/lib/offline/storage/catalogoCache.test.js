/**
 * Guarda do catálogo no cache protegido, a partir do texto já baixado.
 * Run: node --test src/lib/offline/storage/catalogoCache.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { guardarManifestNoCatalogo } from './catalogoCache.js';

/** @param {string[]} [jaTem] */
function fakeCaches(jaTem = []) {
  const guardadas = new Map(jaTem.map((k) => [k, 'antigo']));
  const cache = {
    async match(/** @type {any} */ k) {
      return guardadas.has(String(k)) ? { ok: true } : undefined;
    },
    async put(/** @type {any} */ k, /** @type {any} */ v) {
      guardadas.set(String(k), v);
    }
  };
  return {
    guardadas,
    abertos: /** @type {string[]} */ ([]),
    async open(/** @type {string} */ nome) {
      this.abertos.push(nome);
      return cache;
    }
  };
}

describe('guardarManifestNoCatalogo', () => {
  it('guarda o manifesto quando o cache está vazio', async () => {
    const cs = fakeCaches();
    const r = await guardarManifestNoCatalogo('/louvores-manifest.json', '[{"nome":"a"}]', {
      cachesImpl: cs
    });

    assert.equal(r, 'guardado');
    assert.equal(cs.guardadas.has('/louvores-manifest.json'), true);
    assert.equal(cs.abertos[0], 'plpc-catalog', 'vai para o cache protegido, não o do app');
  });

  it('não sobrescreve o que já está guardado', async () => {
    // Reescrever 1,4 MB a cada carregamento de página é desperdício, e um
    // catálogo importado do pacote offline não pode ser trocado pelo da rede
    // sem passar pela sincronização por checksum.
    const cs = fakeCaches(['/louvores-manifest.json']);
    const r = await guardarManifestNoCatalogo('/louvores-manifest.json', '[]', { cachesImpl: cs });

    assert.equal(r, 'ja-tinha');
    assert.equal(cs.guardadas.get('/louvores-manifest.json'), 'antigo');
  });

  it('grava uma resposta JSON legível de volta', async () => {
    const cs = fakeCaches();
    await guardarManifestNoCatalogo('/louvores-manifest.json', '[{"nome":"a"}]', {
      cachesImpl: cs
    });

    const gravado = cs.guardadas.get('/louvores-manifest.json');
    assert.equal(gravado.headers.get('Content-Type'), 'application/json');
    assert.equal(await gravado.text(), '[{"nome":"a"}]');
  });

  it('recusa caminho que não faz parte do catálogo', async () => {
    const cs = fakeCaches();
    const r = await guardarManifestNoCatalogo('/qualquer-coisa.json', '{}', { cachesImpl: cs });

    assert.equal(r, 'ignorado');
    assert.equal(cs.guardadas.size, 0);
  });

  it('texto vazio não vira catálogo vazio no cache', async () => {
    const cs = fakeCaches();
    assert.equal(
      await guardarManifestNoCatalogo('/louvores-manifest.json', '', { cachesImpl: cs }),
      'ignorado'
    );
    assert.equal(cs.guardadas.size, 0);
  });

  it('nunca lança: sem Cache API devolve indisponível', async () => {
    const r = await guardarManifestNoCatalogo('/louvores-manifest.json', '[]', {
      cachesImpl: undefined
    });
    assert.equal(r, 'indisponivel');
  });

  it('nunca lança: cache que estoura vira falhou', async () => {
    const cs = {
      async open() {
        throw new Error('quota');
      }
    };
    const r = await guardarManifestNoCatalogo('/louvores-manifest.json', '[]', { cachesImpl: cs });
    assert.equal(r, 'falhou');
  });
});
