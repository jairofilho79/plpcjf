/**
 * Tradução de falhas de download para a tela.
 * Run: node --test src/lib/offline/download/downloadErrors.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mensagemDeErroDeDownload } from './downloadErrors.js';

describe('mensagemDeErroDeDownload', () => {
  it('cancelamento é fato, não erro', () => {
    const m = mensagemDeErroDeDownload(new Error('DOWNLOAD_CANCELLED'));
    assert.match(m, /cancelad/i);
    assert.doesNotMatch(m, /erro/i);
  });

  it('reconhece AbortError pelo nome', () => {
    const e = new Error('abortado');
    e.name = 'AbortError';
    assert.match(mensagemDeErroDeDownload(e), /cancelad/i);
  });

  it('erro do servidor vira frase com o que fazer a seguir', () => {
    const m = mensagemDeErroDeDownload(new Error('HTTP 500 ao baixar /packages/Cifra-1.zip'));
    assert.match(m, /servidor/i);
    assert.match(m, /tente de novo/i, 'diz o que fazer');
    assert.match(m, /já foi baixado/i, 'tranquiliza sobre o progresso');
  });

  it('mantém o detalhe técnico para quem for pedir ajuda', () => {
    const m = mensagemDeErroDeDownload(new Error('HTTP 500 ao baixar /packages/Cifra-1.zip'));
    assert.match(m, /Cifra-1\.zip/);
  });

  it('404 diz que o lote sumiu, não manda tentar de novo para sempre', () => {
    const m = mensagemDeErroDeDownload(new Error('HTTP 404 ao baixar /packages/Cifra-9.zip'));
    assert.match(m, /não está mais dispon/i);
  });

  it('sem rede fala de conexão, não de servidor', () => {
    const m = mensagemDeErroDeDownload(new TypeError('Failed to fetch'));
    assert.match(m, /conex(ão|ao)|internet/i);
    assert.doesNotMatch(m, /servidor não respondeu/i);
  });

  it('tempo esgotado vira lentidão de rede', () => {
    const m = mensagemDeErroDeDownload(new Error('Tempo esgotado (30000 ms) ao baixar /packages/a.zip'));
    assert.match(m, /demorou|lenta|tempo/i);
  });

  it('mensagem já escrita para gente passa intacta', () => {
    const jaBoa =
      'A rede devolveu uma página de login em vez do pacote Cifra-1.zip. Confirme o acesso ao wi-fi e tente novamente.';
    assert.equal(mensagemDeErroDeDownload(new Error(jaBoa)), jaBoa);
  });

  it('falta de espaço passa intacta', () => {
    const jaBoa = 'Não há espaço suficiente no aparelho para guardar os PDFs. Libere espaço e tente de novo.';
    assert.equal(mensagemDeErroDeDownload(new Error(jaBoa)), jaBoa);
  });

  it('erro sem mensagem ainda diz o que fazer a seguir', () => {
    const m = mensagemDeErroDeDownload(new Error(''));
    assert.ok(m.length > 20);
    assert.match(m, /tente de novo/i);
  });

  it('TypeError de programação não vira "sem internet"', () => {
    // Culpar a conexão da pessoa por um bug nosso manda ela procurar o
    // problema no lugar errado.
    const m = mensagemDeErroDeDownload(new TypeError('cache.put is not a function'));
    assert.doesNotMatch(m, /sem conexão/i);
  });

  it('tolera null', () => {
    assert.ok(mensagemDeErroDeDownload(null).length > 20);
  });

  it('não manda tocar num botão que pode não estar na tela', () => {
    // Depois de uma falha total o botão ainda é "Disponibilizar offline";
    // citar "Baixar PDFs faltantes" mandaria procurar o que não existe.
    for (const erro of [new Error('HTTP 500 ao baixar /packages/a.zip'), new TypeError('Failed to fetch')]) {
      assert.doesNotMatch(mensagemDeErroDeDownload(erro), /Baixar PDFs faltantes/);
    }
  });
});
