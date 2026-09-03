/**
 * Preparo do leitor para uso offline, sem abrir aba nenhuma.
 * Run: node --test src/lib/offline/utils/leitorOffline.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { imagensDaFolhaDeEstilo, prepararLeitorOffline } from './leitorOffline.js';

const CSS = `
.pdfViewer .loadingIcon { background: url(images/loading-icon.gif) no-repeat; }
.editorInk { cursor: url("images/cursor-editorInk.svg") 0 16, auto; }
.warn::before { content: url('images/messageBar_warning.svg'); }
.repetida { background: url(images/loading-icon.gif); }
.externa { background: url(https://exemplo.test/x.svg); }
.dados { background: url(data:image/svg+xml;base64,AAA); }
.mascara { mask: url(#alttext-manager-mask); }
`;

describe('imagensDaFolhaDeEstilo', () => {
  it('acha as imagens em url() com e sem aspas', () => {
    assert.deepEqual(imagensDaFolhaDeEstilo(CSS, '/pdfjs/web/'), [
      '/pdfjs/web/images/loading-icon.gif',
      '/pdfjs/web/images/cursor-editorInk.svg',
      '/pdfjs/web/images/messageBar_warning.svg'
    ]);
  });

  it('não repete a mesma imagem', () => {
    const achadas = imagensDaFolhaDeEstilo(CSS, '/pdfjs/web/');
    assert.equal(new Set(achadas).size, achadas.length);
  });

  it('ignora url externa e data:', () => {
    const achadas = imagensDaFolhaDeEstilo(CSS, '/pdfjs/web/');
    assert.equal(achadas.some((u) => u.includes('exemplo.test') || u.startsWith('data:')), false);
  });

  it('ignora referência a fragmento SVG — não é arquivo, e pedi-la rende 404', () => {
    const achadas = imagensDaFolhaDeEstilo(CSS, '/pdfjs/web/');
    assert.equal(achadas.some((u) => u.includes('alttext-manager-mask')), false);
  });

  it('devolve vazio para css vazio', () => {
    assert.deepEqual(imagensDaFolhaDeEstilo('', '/pdfjs/web/'), []);
  });
});

/** Cache falso com contabilidade. */
/** @param {string[]} [jaTem] */
function fakeCache(jaTem = []) {
  const guardadas = new Set(jaTem);
  return {
    guardadas,
    async match(/** @type {any} */ url) {
      return guardadas.has(String(url)) ? { ok: true } : undefined;
    },
    async put(/** @type {any} */ url, /** @type {any} */ _res) {
      guardadas.add(String(url));
    }
  };
}

/** @param {{ falhar?: string[] }} [o] */
function fakeFetch(o = {}) {
  /** @type {string[]} */
  const pedidas = [];
  const f = async (/** @type {any} */ url) => {
    pedidas.push(String(url));
    if (o.falhar?.includes(String(url))) throw new Error('rede caiu: ' + url);
    if (String(url).endsWith('.css')) {
      return { ok: true, status: 200, clone: () => ({}), text: async () => CSS };
    }
    return { ok: true, status: 200, clone: () => ({}), text: async () => '' };
  };
  f.pedidas = pedidas;
  return f;
}

describe('prepararLeitorOffline', () => {
  it('guarda a folha de estilo e as imagens que ela referencia', async () => {
    const cache = fakeCache();
    const fetchImpl = fakeFetch();
    const armazenamento = new Map();

    const r = await prepararLeitorOffline({
      cache,
      fetchImpl,
      setFlag: (v) => armazenamento.set('IS_LEITOR_OFFLINE', v)
    });

    assert.equal(r.pronto, true);
    assert.equal(cache.guardadas.has('/pdfjs/web/pdf_viewer.css'), true);
    assert.equal(cache.guardadas.has('/pdfjs/web/images/loading-icon.gif'), true);
    assert.equal(armazenamento.get('IS_LEITOR_OFFLINE'), 'true');
  });

  it('não rebaixa o que já está no cache', async () => {
    const cache = fakeCache(['/pdfjs/web/pdf_viewer.css']);
    const fetchImpl = fakeFetch();

    await prepararLeitorOffline({ cache, fetchImpl, setFlag: () => {} });

    assert.equal(
      fetchImpl.pedidas.filter((u) => u === '/pdfjs/web/pdf_viewer.css').length,
      0,
      'a folha já estava guardada: não pede de novo'
    );
  });

  it('uma imagem que falha não impede o resto nem derruba a preparação', async () => {
    const cache = fakeCache();
    const fetchImpl = fakeFetch({ falhar: ['/pdfjs/web/images/cursor-editorInk.svg'] });

    const r = await prepararLeitorOffline({ cache, fetchImpl, setFlag: () => {} });

    assert.equal(r.pronto, true, 'a folha de estilo é o que decide, não um cursor');
    assert.equal(r.falharam, 1);
    assert.equal(cache.guardadas.has('/pdfjs/web/images/loading-icon.gif'), true);
  });

  it('sem a folha de estilo, não promete que o leitor funciona offline', async () => {
    const cache = fakeCache();
    const fetchImpl = fakeFetch({ falhar: ['/pdfjs/web/pdf_viewer.css'] });
    let marcou = false;

    const r = await prepararLeitorOffline({
      cache,
      fetchImpl,
      setFlag: () => {
        marcou = true;
      }
    });

    assert.equal(r.pronto, false);
    assert.equal(marcou, false);
  });

  it('nunca lança: cache indisponível vira pronto:false', async () => {
    const r = await prepararLeitorOffline({
      cache: null,
      fetchImpl: fakeFetch(),
      setFlag: () => {}
    });
    assert.equal(r.pronto, false);
  });
});
