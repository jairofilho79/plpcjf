/**
 * Contrato do link de compartilhamento de lista (§5.1 do relatório de URL).
 *
 * O link é AUTOCONTIDO: carrega os pdfId inteiros na query. Não há servidor, não
 * há id curto. Se a leitura mudar, todo link já enviado no WhatsApp morre em
 * silêncio. Isto é caracterização — grava o que acontece hoje.
 *
 * A Tarefa 10 corrigiu quatro bugs vivos aqui (ver playlistShare.js): o `+` que
 * corrompia um pdfId em silêncio, o duplo decode que lançava URIError num nome
 * com `%`, a URL suja que sobrevivia a `sharepdfs` vazio, e a limpeza que
 * derrubava `utm_source`/`pesquisa` junto com os params do compartilhamento.
 * Os casos abaixo marcados com "Tarefa 10" documentam a expectativa NOVA; os
 * demais continuam de rede — nenhum outro comportamento deveria ter mudado.
 *
 * Run: node --test src/lib/utils/playlistShare.contrato.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generatePlaylistShareUrl } from './playlistUtils.js';
import { parseSharePdfIds, resolveKnownPdfIds, stripShareParams } from './playlistShare.js';

/** Dois pdfId reais do acervo (Base64 padrão do caminho em UTF-8). */
const ID_A = 'MDQxMTIwMjUvQ29uaGXDp2Ftb3MgZSBwcm9zc2lnYW1vcy9DaWZyYS5wZGY=';
const ID_B = 'MDQxMTIwMjUvQ29uaGXDp2Ftb3MgZSBwcm9zc2lnYW1vcy9HZXN0b3MgQ0lBcy5wZGY=';

/**
 * Reproduz a leitura de src/routes/+page.svelte.
 *
 * Tarefa 10: antes duplicava aqui a lógica de `split(',')` e um segundo
 * `decodeURIComponent(sharename)` — o próprio bug do URIError vivia nessa
 * duplicação. Agora chama a função de produção extraída (`parseSharePdfIds`)
 * e não decodifica `sharename` de novo, então este helper exercita o mesmo
 * código que roda no navegador, não uma cópia dele.
 */
function lerLinkDeLista(href) {
  const u = new URL(href, 'https://plpcg.com');
  const params = new URLSearchParams(u.search);
  const pdfIds = parseSharePdfIds(params.get('sharepdfs'));
  // URLSearchParams.get() já decodificou uma vez — sem decode extra (D-6).
  const nome = params.get('sharename') || undefined;
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
    // 2198 dos 4629 pdfId terminam em '='. Continua cru: só o '+' precisa de
    // proteção (D-5) — encodar tudo mudaria a aparência de todo link à toa.
    const { pdfIds } = lerLinkDeLista(generatePlaylistShareUrl([ID_A, ID_B], 'x'));
    assert.deepEqual(pdfIds, [ID_A, ID_B]);
  });

  it('C6: a barra dentro de um pdfId sobrevive', () => {
    const comBarra = 'YWJj/ZGVm';
    assert.deepEqual(lerLinkDeLista(`/?sharepdfs=${comBarra}`).pdfIds, [comBarra]);
  });

  it('C7 [Tarefa 10]: um + num pdfId sobrevive à escrita e à leitura', () => {
    // Era: nada protegia o '+' na escrita, então um pdfId com '+' virava uma
    // URL com '+' cru; URLSearchParams lê '+' cru como espaço e o id
    // corrompido era descartado sem aviso do carrossel (D-5, defeito §2.4b).
    // Um '+' cru já digitado numa URL sempre foi (e continua sendo) lido como
    // espaço — isso é semântica de query string, não um bug consertável na
    // leitura. Mas hoje nenhum link já circulou com pdfId contendo '+' ("zero
    // ids do acervo têm +" — só um arquivo futuro armaria essa bomba), então
    // não há link antigo para preservar aqui: a correção é só na escrita.
    // Passa a ser: encodeSharePdfIds escapa o '+' (%2B) antes de ir para a
    // URL, e a leitura devolve o id intacto.
    const comMais = 'YWJj+ZGVm';
    assert.deepEqual(lerLinkDeLista(generatePlaylistShareUrl([comMais], 'x')).pdfIds, [comMais]);
  });
});

describe('§5.1 leitura do link', () => {
  it('C1: os ids voltam na ordem dada', () => {
    assert.deepEqual(lerLinkDeLista(`/?sharepdfs=${ID_A},${ID_B}`).pdfIds, [ID_A, ID_B]);
  });

  it('C4 [Tarefa 10]: um id fantasma some da lista resolvida, não só do carrossel', () => {
    // Era: o id desconhecido sobrevivia até a lista salva (só o carrossel
    // filtrava), o que divergia savedPlaylists do carrossel para sempre
    // (§2.4c). Passa a ser: resolveKnownPdfIds aplica o mesmo critério do
    // carrossel (`carousel.js:118-130`) antes de salvar — as duas listas nunca
    // mais divergem.
    const { pdfIds } = lerLinkDeLista(`/?sharepdfs=${ID_A},naoexiste,${ID_B}`);
    assert.deepEqual(pdfIds, [ID_A, 'naoexiste', ID_B]);
    const catalogo = [{ pdfId: ID_A }, { pdfId: ID_B }];
    assert.deepEqual(resolveKnownPdfIds(pdfIds, catalogo), [ID_A, ID_B]);
  });

  it('C8 [Tarefa 10]: um nome de lista com % não lança mais URIError', () => {
    // Era: +page.svelte:277 decodificava DE NOVO um valor que .get() já havia
    // decodificado — qualquer '%' no nome lançava URIError DEPOIS de o
    // carrossel já ter carregado e ANTES de savedPlaylists.savePlaylist: a
    // lista abria mas não era salva, e a URL ficava suja (D-6). Passa a ser:
    // sem o segundo decode, o nome chega legível e a lista é salva.
    assert.equal(lerLinkDeLista(generatePlaylistShareUrl([ID_A], 'Louvor 100%')).nome, 'Louvor 100%');
    assert.equal(
      lerLinkDeLista(generatePlaylistShareUrl([ID_A], 'Culto 50%off')).nome,
      'Culto 50%off'
    );
  });

  it('C8: nomes sem % passam ilesos', () => {
    assert.equal(lerLinkDeLista(generatePlaylistShareUrl([ID_A], 'Ação de Graças')).nome, 'Ação de Graças');
    assert.equal(
      lerLinkDeLista(generatePlaylistShareUrl([ID_A], 'lista 04/11/2025 10:20:30')).nome,
      'lista 04/11/2025 10:20:30'
    );
  });

  it('C8 [Tarefa 10]: um %20 literal no nome sobrevive ao único decode', () => {
    // Era: o decode duplo transformava o '%20' literal (dentro do nome) numa
    // segunda decodificação, corrompendo-o num espaço. Passa a ser: só o
    // decode do URLSearchParams.get() roda, e o '%20' literal volta intacto.
    assert.equal(
      lerLinkDeLista(generatePlaylistShareUrl([ID_A], 'Ensaio %20 teste')).nome,
      'Ensaio %20 teste'
    );
  });

  it('C9/C10 [Tarefa 10]: sharepdfs vazio ou só vírgulas não produz id nenhum, e a URL é limpa mesmo assim', () => {
    assert.deepEqual(lerLinkDeLista('/?sharepdfs=&sharename=x').pdfIds, []);
    assert.deepEqual(lerLinkDeLista('/?sharepdfs=,,,').pdfIds, []);
    // Era: o bloco reativo só chamava a limpeza quando pelo menos um id
    // sobrevivia ao split — sharepdfs vazio ficava para sempre na URL e o
    // bloco reativo reavaliava a cada render (D-6/D-7, §2.4e). Passa a ser: a
    // guarda de handleSharedPlaylistLink é `has('sharepdfs')`, então a limpeza
    // roda mesmo sem nenhum id sobrevivendo.
    assert.equal(stripShareParams('?sharepdfs=&sharename=x'), '');
    assert.equal(stripShareParams('?sharepdfs=,,,'), '');
  });

  it('C12: uma lista de 50 louvores cabe num link de ~3450 caracteres', () => {
    const ids = Array.from({ length: 50 }, () => ID_A);
    const link = generatePlaylistShareUrl(ids, 'Ensaio');
    assert.ok(link.length > 3000 && link.length < 4000, `tamanho inesperado: ${link.length}`);
    assert.equal(lerLinkDeLista(link).pdfIds.length, 50);
  });

  it('C13/D2 [Tarefa 10]: um param de terceiros sobrevive à leitura E à limpeza da URL', () => {
    const { pdfIds } = lerLinkDeLista(`/?utm_source=whatsapp&sharepdfs=${ID_A}&pesquisa=amor`);
    assert.deepEqual(pdfIds, [ID_A]);
    // Era: a limpeza fazia goto(pathname) sem query nenhuma, descartando
    // utm_source e pesquisa junto com sharepdfs/sharename (D-7, §2.4f/g).
    // Passa a ser: stripShareParams remove só os dois params do
    // compartilhamento; todo o resto sobrevive.
    const resto = stripShareParams(`?utm_source=whatsapp&sharepdfs=${ID_A}&pesquisa=amor`);
    const restoParams = new URLSearchParams(resto);
    assert.equal(restoParams.get('utm_source'), 'whatsapp');
    assert.equal(restoParams.get('pesquisa'), 'amor');
    assert.equal(restoParams.has('sharepdfs'), false);
  });
});
