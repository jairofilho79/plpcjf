/**
 * Contrato do link de compartilhamento de lista (§5.1 do relatório de URL).
 *
 * O link é AUTOCONTIDO: carrega os pdfId inteiros na query. Não há servidor, não
 * há id curto. Se a leitura mudar, todo link já enviado no WhatsApp morre em
 * silêncio. Isto é caracterização — grava o que acontece hoje, bugs incluídos.
 *
 * Run: node --test src/lib/utils/playlistShare.contrato.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generatePlaylistShareUrl } from './playlistUtils.js';

/** Dois pdfId reais do acervo (Base64 padrão do caminho em UTF-8). */
const ID_A = 'MDQxMTIwMjUvQ29uaGXDp2Ftb3MgZSBwcm9zc2lnYW1vcy9DaWZyYS5wZGY=';
const ID_B = 'MDQxMTIwMjUvQ29uaGXDp2Ftb3MgZSBwcm9zc2lnYW1vcy9HZXN0b3MgQ0lBcy5wZGY=';

/** Reproduz a leitura de src/routes/+page.svelte:259-267, tal como está hoje. */
function lerLinkDeLista(href) {
  const u = new URL(href, 'https://plpcg.com');
  const params = new URLSearchParams(u.search);
  const sharepdfs = params.get('sharepdfs');
  const sharename = params.get('sharename');
  const pdfIds = sharepdfs ? sharepdfs.split(',').filter((id) => id.trim()) : [];
  // +page.svelte:277 decodifica DE NOVO um valor que .get() já decodificou.
  const nome = sharename ? decodeURIComponent(sharename) : undefined;
  return { pdfIds, nome };
}

describe('§5.1 escrita do link', () => {
  it('C1: o formato é ?sharepdfs=<ids por vírgula>&sharename=<encodeURIComponent>', () => {
    assert.equal(
      generatePlaylistShareUrl([ID_A, ID_B], 'Culto de Domingo'),
      `/?sharepdfs=${ID_A},${ID_B}&sharename=Culto%20de%20Domingo`
    );
  });

  it('C3: o nome default gerado pelo app sobrevive ao encode', () => {
    assert.equal(
      generatePlaylistShareUrl(['a'], 'lista 04/11/2025 10:20:30'),
      '/?sharepdfs=a&sharename=lista%2004%2F11%2F2025%2010%3A20%3A30'
    );
  });

  it('C5: o = de padding do Base64 vai cru na URL e volta inteiro', () => {
    // 2198 dos 4629 pdfId terminam em '='. O = só é significativo na primeira
    // ocorrência de cada par, então isto funciona — por sorte, não por design.
    const { pdfIds } = lerLinkDeLista(generatePlaylistShareUrl([ID_A, ID_B], 'x'));
    assert.deepEqual(pdfIds, [ID_A, ID_B]);
  });

  it('C6: a barra dentro de um pdfId sobrevive', () => {
    const comBarra = 'YWJj/ZGVm';
    assert.deepEqual(lerLinkDeLista(`/?sharepdfs=${comBarra}`).pdfIds, [comBarra]);
  });

  it('C7: um + num pdfId quebraria a lista em silêncio', () => {
    // ⚠︎ Hoje zero ids do acervo têm '+', mas o pdfId é Base64 de um caminho
    // arbitrário: um arquivo novo arma a bomba. URLSearchParams lê '+' como
    // espaço, o id corrompido não casa no Map do carrossel e é DESCARTADO SEM
    // AVISO. D-5 manda corrigir na escrita e continuar aceitando o formato cru
    // na leitura — quando isso acontecer, este teste inverte.
    assert.deepEqual(lerLinkDeLista('/?sharepdfs=YWJj+ZGVm').pdfIds, ['YWJj ZGVm']);
  });
});

describe('§5.1 leitura do link', () => {
  it('C1: os ids voltam na ordem dada', () => {
    assert.deepEqual(lerLinkDeLista(`/?sharepdfs=${ID_A},${ID_B}`).pdfIds, [ID_A, ID_B]);
  });

  it('C4: um id inexistente não atrapalha a leitura da lista', () => {
    // O descarte do id desconhecido acontece em carousel.loadPlaylist, não aqui.
    // Ver M-C4 na lista de verificação manual.
    assert.deepEqual(lerLinkDeLista(`/?sharepdfs=${ID_A},naoexiste,${ID_B}`).pdfIds, [
      ID_A,
      'naoexiste',
      ID_B
    ]);
  });

  it('C8: um nome de lista com % lança URIError (bug real)', () => {
    // ⚠︎ O erro sobe de dentro de um bloco reativo, DEPOIS de o carrossel já ter
    // sido carregado e ANTES de a lista ser salva: o usuário vê a lista aberta,
    // ela não é salva, e a URL fica suja. D-6 manda corrigir na Fase 3.
    const link = generatePlaylistShareUrl([ID_A], 'Louvor 100%');
    assert.throws(() => lerLinkDeLista(link), URIError);
    assert.throws(() => lerLinkDeLista(generatePlaylistShareUrl([ID_A], 'Culto 50%off')), URIError);
  });

  it('C8: nomes sem % passam ilesos', () => {
    assert.equal(lerLinkDeLista(generatePlaylistShareUrl([ID_A], 'Ação de Graças')).nome, 'Ação de Graças');
    assert.equal(
      lerLinkDeLista(generatePlaylistShareUrl([ID_A], 'lista 04/11/2025 10:20:30')).nome,
      'lista 04/11/2025 10:20:30'
    );
  });

  it('C8: um %20 literal no nome é corrompido pelo decode duplo', () => {
    assert.equal(lerLinkDeLista(generatePlaylistShareUrl([ID_A], 'Ensaio %20 teste')).nome, 'Ensaio   teste');
  });

  it('C9/C10: sharepdfs vazio ou só vírgulas não produz id nenhum', () => {
    assert.deepEqual(lerLinkDeLista('/?sharepdfs=&sharename=x').pdfIds, []);
    assert.deepEqual(lerLinkDeLista('/?sharepdfs=,,,').pdfIds, []);
  });

  it('C12: uma lista de 50 louvores cabe num link de ~3450 caracteres', () => {
    const ids = Array.from({ length: 50 }, () => ID_A);
    const link = generatePlaylistShareUrl(ids, 'Ensaio');
    assert.ok(link.length > 3000 && link.length < 4000, `tamanho inesperado: ${link.length}`);
    assert.equal(lerLinkDeLista(link).pdfIds.length, 50);
  });

  it('C13/D2: um param de terceiros convive com o link de lista na leitura', () => {
    const { pdfIds } = lerLinkDeLista(`/?utm_source=whatsapp&sharepdfs=${ID_A}&pesquisa=amor`);
    assert.deepEqual(pdfIds, [ID_A]);
    // ⚠︎ A LIMPEZA da URL é que descarta utm_source e pesquisa junto
    // (+page.svelte:281). Ver M-C13 na lista manual; D-7 manda corrigir.
  });
});
