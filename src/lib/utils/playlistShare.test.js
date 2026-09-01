import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generatePlaylistShareUrl } from './playlistUtils.js';
import {
  encodeSharePdfIds,
  parseSharePdfIds,
  resolveKnownPdfIds,
  stripShareParams
} from './playlistShare.js';

// Ids reais do acervo: base64 padrão do caminho relativo, com `=` de padding.
const ID_CIFRA = 'MDQxMTIwMjUvQ29uaGXDp2Ftb3MgZSBwcm9zc2lnYW1vcy9DaWZyYS5wZGY=';
const ID_GESTOS = 'MDQxMTIwMjUvQ29uaGXDp2Ftb3MgZSBwcm9zc2lnYW1vcy9HZXN0b3MgQ0lBcy5wZGY=';
// Id sintético com o `+` que o URLSearchParams leria como espaço.
const ID_COM_MAIS = 'YWJj+ZGVm/Z2hp=';

/** Simula a viagem completa: escrita na URL → leitura pelo receptor. */
function idaEVolta(pdfIds) {
  const url = new URL(`https://plpcg.com/?sharepdfs=${encodeSharePdfIds(pdfIds)}`);
  return parseSharePdfIds(url.searchParams.get('sharepdfs'));
}

describe('encodeSharePdfIds / parseSharePdfIds', () => {
  it('preserva ids reais do acervo, com = de padding e / no meio', () => {
    assert.deepEqual(idaEVolta([ID_CIFRA, ID_GESTOS]), [ID_CIFRA, ID_GESTOS]);
  });

  it('protege o + na escrita e devolve o id intacto na leitura', () => {
    assert.deepEqual(idaEVolta([ID_COM_MAIS]), [ID_COM_MAIS]);
  });

  it('continua aceitando o formato cru dos links já compartilhados', () => {
    // Link antigo: ids crus separados por vírgula, sem encode por item.
    const antigo = new URL(`https://plpcg.com/?sharepdfs=${ID_CIFRA},${ID_GESTOS}`);
    assert.deepEqual(parseSharePdfIds(antigo.searchParams.get('sharepdfs')), [
      ID_CIFRA,
      ID_GESTOS
    ]);
  });

  it('tolera vazio, vírgulas sobrando e espaços em volta', () => {
    assert.deepEqual(parseSharePdfIds(''), []);
    assert.deepEqual(parseSharePdfIds(null), []);
    assert.deepEqual(parseSharePdfIds(',,,'), []);
    assert.deepEqual(parseSharePdfIds(` ${ID_CIFRA} ,, ${ID_GESTOS} `), [ID_CIFRA, ID_GESTOS]);
  });
});

describe('stripShareParams', () => {
  it('remove sharepdfs e sharename', () => {
    assert.equal(stripShareParams('?sharepdfs=abc,def&sharename=Culto'), '');
  });

  it('preserva params de terceiros que chegam no link do WhatsApp', () => {
    const resto = stripShareParams('?utm_source=whatsapp&sharepdfs=abc&fbclid=IwAR1&sharename=x');
    const params = new URLSearchParams(resto);
    assert.equal(params.get('utm_source'), 'whatsapp');
    assert.equal(params.get('fbclid'), 'IwAR1');
    assert.equal(params.has('sharepdfs'), false);
    assert.equal(params.has('sharename'), false);
  });

  it('devolve string vazia quando não sobra nada', () => {
    assert.equal(stripShareParams(''), '');
    assert.equal(stripShareParams('?sharepdfs='), '');
  });
});

describe('resolveKnownPdfIds', () => {
  it('mantém a ordem pedida e descarta os ids que o catálogo não conhece', () => {
    const acervo = [{ pdfId: 'A' }, { pdfId: 'B' }, { pdfId: 'C' }];
    assert.deepEqual(resolveKnownPdfIds(['B', 'FANTASMA', 'A'], acervo), ['B', 'A']);
  });

  it('devolve [] quando nada resolve ou a entrada não é lista', () => {
    assert.deepEqual(resolveKnownPdfIds(['X'], [{ pdfId: 'A' }]), []);
    assert.deepEqual(resolveKnownPdfIds(null, [{ pdfId: 'A' }]), []);
  });
});

describe('generatePlaylistShareUrl', () => {
  it('gera link cujo id com + sobrevive à leitura do receptor', () => {
    globalThis.window = { location: { origin: 'https://plpcg.com' } };
    try {
      const url = new URL(generatePlaylistShareUrl([ID_COM_MAIS, ID_CIFRA], 'Culto de Domingo'));
      assert.deepEqual(parseSharePdfIds(url.searchParams.get('sharepdfs')), [
        ID_COM_MAIS,
        ID_CIFRA
      ]);
      assert.equal(url.searchParams.get('sharename'), 'Culto de Domingo');
    } finally {
      delete globalThis.window;
    }
  });

  it('devolve o nome com % legível após o único decode do URLSearchParams', () => {
    globalThis.window = { location: { origin: 'https://plpcg.com' } };
    try {
      const url = new URL(generatePlaylistShareUrl([ID_CIFRA], 'Louvor 100%'));
      // Um decode só (o do URLSearchParams.get). Um segundo decode em +page.svelte
      // lançava URIError com qualquer % no nome — D-6 removeu esse decode extra.
      assert.equal(url.searchParams.get('sharename'), 'Louvor 100%');
    } finally {
      delete globalThis.window;
    }
  });
});
