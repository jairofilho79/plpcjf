/**
 * Poda de PDFs que o catálogo novo não referencia mais.
 * Run: node --test src/lib/offline/storage/prunarPdfsObsoletos.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { podarPdfsObsoletos } from './prunarPdfsObsoletos.js';

/** @param {string[]} urls */
function fakeCaches(urls) {
  const guardadas = new Map(urls.map((u) => [u, { url: u }]));
  const cache = {
    async keys() {
      return [...guardadas.values()];
    },
    async delete(/** @type {any} */ req) {
      return guardadas.delete(req.url);
    }
  };
  return {
    guardadas,
    async open() {
      return cache;
    }
  };
}

const ORIGEM = 'https://plpcjf.com';

describe('podarPdfsObsoletos', () => {
  it('remove só o que não está no conjunto de válidos', async () => {
    const cs = fakeCaches([
      `${ORIGEM}/assets/Categoria/valido.pdf`,
      `${ORIGEM}/assets/Categoria/obsoleto.pdf`
    ]);

    const r = await podarPdfsObsoletos('plpc-pdfs', ['assets/Categoria/valido.pdf'], {
      cachesImpl: cs
    });

    assert.equal(r.removidos, 1);
    assert.equal(cs.guardadas.has(`${ORIGEM}/assets/Categoria/valido.pdf`), true);
    assert.equal(cs.guardadas.has(`${ORIGEM}/assets/Categoria/obsoleto.pdf`), false);
  });

  it('ignora entradas que não são PDF (o catálogo em si, por exemplo)', async () => {
    const cs = fakeCaches([`${ORIGEM}/louvores-manifest.json`]);

    const r = await podarPdfsObsoletos('plpc-pdfs', ['assets/Categoria/valido.pdf'], {
      cachesImpl: cs
    });

    assert.equal(r.removidos, 0);
    assert.equal(cs.guardadas.size, 1);
  });

  it('nunca poda contra um conjunto de válidos vazio', async () => {
    // Um catálogo "vazio" quase certo é falha de rede/parse a montante — não é
    // aqui que se decide que o servidor não tem mais nada.
    const cs = fakeCaches([`${ORIGEM}/assets/Categoria/a.pdf`]);

    const r = await podarPdfsObsoletos('plpc-pdfs', [], { cachesImpl: cs });

    assert.equal(r.removidos, 0);
    assert.equal(cs.guardadas.size, 1);
  });

  it('nunca lança: sem Cache API devolve zero', async () => {
    const r = await podarPdfsObsoletos('plpc-pdfs', ['a.pdf'], { cachesImpl: undefined });
    assert.equal(r.removidos, 0);
  });

  it('nunca lança: open que estoura devolve zero', async () => {
    const cs = {
      async open() {
        throw new Error('boom');
      }
    };
    const r = await podarPdfsObsoletos('plpc-pdfs', ['a.pdf'], { cachesImpl: cs });
    assert.equal(r.removidos, 0);
  });

  it('uma falha isolada ao apagar não impede podar o resto', async () => {
    const cs = fakeCaches([
      `${ORIGEM}/assets/Categoria/obsoleto1.pdf`,
      `${ORIGEM}/assets/Categoria/obsoleto2.pdf`,
      `${ORIGEM}/assets/Categoria/valido.pdf`
    ]);
    let chamadas = 0;
    const cacheOriginal = await cs.open();
    const apagarOriginal = cacheOriginal.delete.bind(cacheOriginal);
    cacheOriginal.delete = async (/** @type {any} */ req) => {
      chamadas++;
      if (chamadas === 1) throw new Error('falha isolada');
      return apagarOriginal(req);
    };
    cs.open = async () => cacheOriginal;

    const r = await podarPdfsObsoletos('plpc-pdfs', ['assets/Categoria/valido.pdf'], {
      cachesImpl: cs
    });

    // A primeira tentativa de apagar lança; a segunda (outro obsoleto) segue
    // e conta. O válido nunca é sequer tentado.
    assert.equal(r.removidos, 1);
    assert.equal(cs.guardadas.has(`${ORIGEM}/assets/Categoria/valido.pdf`), true);
  });
});
