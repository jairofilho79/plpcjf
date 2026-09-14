import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generatePlaylistShareUrl } from './playlistUtils.js';
import {
  encodeSharePdfIds,
  encodeShortShareIds,
  isShortId,
  parseSharePdfIds,
  parseShortShareIds,
  resolveKnownPdfIds,
  resolveShortIds,
  shortIdsForPdfIds,
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

const CATALOGO = [
  { pdfId: ID_CIFRA, shortId: '0000', nome: 'A' },
  { pdfId: ID_GESTOS, shortId: '1a2f', nome: 'B' },
  { pdfId: 'sem-short', nome: 'C' }
];

describe('isShortId', () => {
  it('aceita 4 a 8 hex minúsculos, inclusive "0000"', () => {
    assert.equal(isShortId('0000'), true);
    assert.equal(isShortId('1a2f'), true);
    assert.equal(isShortId('10000'), true);
  });
  it('recusa número, maiúscula, curto, longo, vazio', () => {
    assert.equal(isShortId(0), false);
    assert.equal(isShortId('1A2F'), false);
    assert.equal(isShortId('abc'), false);
    assert.equal(isShortId('123456789'), false);
    assert.equal(isShortId(''), false);
  });
});

describe('encodeShortShareIds / parseShortShareIds', () => {
  it('ida e volta preserva ordem, repetição e zeros à esquerda', () => {
    const s = encodeShortShareIds(['0000', '1a2f', '0000']);
    assert.equal(s, '0000-1a2f-0000');
    const url = new URL(`https://plpcg.com/?s=${s}&n=x`);
    assert.deepEqual(parseShortShareIds(url.searchParams.get('s')), ['0000', '1a2f', '0000']);
  });
  it('emite minúsculo e descarta inválidos', () => {
    assert.equal(encodeShortShareIds(['00AB', 'zz', '', 7]), '00ab');
  });
  it('leitura normaliza maiúsculas e ignora tokens fora do padrão', () => {
    assert.deepEqual(parseShortShareIds('00AB-zz--1a2f-123456789'), ['00ab', '1a2f']);
  });
  it('param ausente ou vazio → []', () => {
    assert.deepEqual(parseShortShareIds(null), []);
    assert.deepEqual(parseShortShareIds(''), []);
  });
});

describe('resolveShortIds', () => {
  it('resolve para pdfIds na ordem pedida, ignorando desconhecidos', () => {
    assert.deepEqual(resolveShortIds(['1a2f', 'ffff', '0000'], CATALOGO), [ID_GESTOS, ID_CIFRA]);
  });
  it('deduplica como resolveKnownPdfIds (a lista salva não repete)', () => {
    assert.deepEqual(resolveShortIds(['0000', '0000'], CATALOGO), [ID_CIFRA]);
  });
  it('compara como string: "0000" não casa com 0', () => {
    assert.deepEqual(resolveShortIds(['0000'], [{ pdfId: 'x', shortId: 0 }]), []);
  });
});

describe('shortIdsForPdfIds', () => {
  it('devolve os shortIds na ordem quando todos existem', () => {
    assert.deepEqual(shortIdsForPdfIds([ID_GESTOS, ID_CIFRA], CATALOGO), ['1a2f', '0000']);
  });
  it('null se algum pdfId não tem shortId ou não está no catálogo', () => {
    assert.equal(shortIdsForPdfIds([ID_CIFRA, 'sem-short'], CATALOGO), null);
    assert.equal(shortIdsForPdfIds([ID_CIFRA, 'nunca-vi'], CATALOGO), null);
  });
  it('lista vazia → null (não há o que encurtar)', () => {
    assert.equal(shortIdsForPdfIds([], CATALOGO), null);
  });
});

describe('stripShareParams com o formato curto', () => {
  it('remove s e n e preserva o resto', () => {
    assert.equal(stripShareParams('?s=0000-1a2f&n=Culto&utm_source=wa'), '?utm_source=wa');
    assert.equal(stripShareParams('?s=0000&n=x'), '');
  });
});
