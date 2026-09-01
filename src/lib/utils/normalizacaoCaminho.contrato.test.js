/**
 * Contrato executável das DUAS normalizações de caminho de PDF (#24, prepara #22).
 *
 * Isto é um teste de CARACTERIZAÇÃO: ele grava o que o código faz hoje, não o
 * que deveria fazer. Vários casos abaixo são bugs conhecidos e estão marcados
 * como tal. Quando as Tarefas 5-9 mexerem nessas funções, o diff deste arquivo
 * é a lista exata do que mudou.
 *
 * Run: node --test src/lib/utils/normalizacaoCaminho.contrato.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizePdfUrl } from './pathUtils.js';
import PdfPathManager from '../offline/utils/PdfPathManager.js';

const fixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/caminhos-acervo.json', import.meta.url), 'utf8')
);

const G = fixture.grupos;
/** Os 42 caminhos da fixture, em ordem estável. */
const TODOS = Object.values(G).flat();

const paraArmazenamento = (p) => PdfPathManager.normalizeForStorage(p);

describe('as duas normalizações são espaços de nomes disjuntos', () => {
  it('a fixture tem 42 caminhos em 9 grupos', () => {
    assert.equal(TODOS.length, 42);
    assert.equal(Object.keys(G).length, 9);
    assert.equal(fixture.totalNoAcervo, 4629);
  });

  it('todos os 42 caminhos divergem entre as duas funções', () => {
    // É o achado #22 em miniatura: no acervo inteiro são 4629 de 4629.
    const divergentes = TODOS.filter((p) => normalizePdfUrl(p) !== paraArmazenamento(p));
    assert.equal(divergentes.length, TODOS.length);
  });

  it('nenhuma das duas perde informação a ponto de colidir', () => {
    assert.equal(new Set(TODOS.map(normalizePdfUrl)).size, TODOS.length);
    assert.equal(new Set(TODOS.map(paraArmazenamento)).size, TODOS.length);
  });

  it('as duas são idempotentes', () => {
    for (const p of TODOS) {
      assert.equal(normalizePdfUrl(normalizePdfUrl(p)), normalizePdfUrl(p));
      assert.equal(paraArmazenamento(paraArmazenamento(p)), paraArmazenamento(p));
    }
  });
});

describe('normalizeForStorage — a normalização vencedora', () => {
  it('devolve o caminho do acervo inalterado, exceto os 8 em NFD que saem em NFC', () => {
    // Todo caminho do manifesto já está na forma canônica desta função. É por
    // isso que unificar nesta direção não invalida nenhuma chave já gravada.
    // Tarefa 6 mudou isto para o grupo `nfd`: com .normalize('NFC'), os oito
    // caminhos decompostos saem recompostos — diferentes da entrada em bytes,
    // idênticos ao usuário e agora também iguais à forma NFC do mesmo caminho.
    for (const p of TODOS) {
      if (G.nfd.includes(p)) {
        assert.equal(paraArmazenamento(p), p.normalize('NFC'), `não convergiu para NFC: ${p}`);
      } else {
        assert.equal(paraArmazenamento(p), p, `mudou: ${p}`);
      }
    }
  });

  it('preserva o nome de arquivo em Base64 byte a byte', () => {
    const p = G.base64NoNome[0];
    assert.equal(
      paraArmazenamento(p),
      'assets/Adicionados/QWRpY2lvbmFkb3MvQ29tIG11aXRvIGxvdXZvci9DaWZyYS5wZGY=.pdf'
    );
  });

  it('agora unifica as duas formas Unicode do mesmo acento (#22.2)', () => {
    // Antes da Tarefa 6, as duas formas divergiam (era o bug documentado
    // aqui). Depois de .normalize('NFC'), convergem para a mesma chave.
    for (const nfd of G.nfd) {
      assert.equal(paraArmazenamento(nfd), paraArmazenamento(nfd.normalize('NFC')));
    }
  });

  it('caminhos com o mesmo nome de arquivo continuam sendo chaves distintas', () => {
    assert.equal(G.basenameRepetido.length, 4);
    assert.equal(new Set(G.basenameRepetido.map(paraArmazenamento)).size, 4);
  });
});

describe('normalizePdfUrl — a normalização perdedora', () => {
  it('baixa a caixa e tira o acento pré-composto', () => {
    assert.equal(
      normalizePdfUrl('assets/06112025/Há Esperança/Cifra.pdf'),
      'assets/06112025/ha esperanca/cifra.pdf'
    );
  });

  it('destrói um nome de arquivo que é Base64 (bug real, entrada real)', () => {
    // Base64 é sensível à caixa; a saída não decodifica de volta.
    assert.equal(
      normalizePdfUrl(G.base64NoNome[0]),
      'assets/adicionados/qwrpy2lvbmfkb3mvq29tig11axrvigxvdxzvci9dawzyys5wzgy=.pdf'
    );
  });

  it('não trata acento em forma decomposta (bug real, 8 caminhos do acervo)', () => {
    // normalizeAccents (pathUtils.js:121-142) é um mapa de caracteres
    // pré-compostos e não chama normalize(). O acento decomposto sobrevive.
    // Nota: o valor esperado abaixo precisa estar ele próprio em NFD — a
    // função não recompõe o acento, então "senhor é" sai com 'e' + acento
    // combinante (U+0301), não com o 'é' pré-composto (U+00E9). Um literal
    // digitado direto no editor normaliza para NFC e o teste falharia por
    // um motivo que não é o bug que ele documenta; por isso .normalize('NFD')
    // explícito também no lado esperado.
    const nfd = 'assets/05042026/A Obra do Senhor é Perfeita/Coro.pdf'.normalize('NFD');
    assert.equal(
      normalizePdfUrl(nfd),
      'assets/05042026/a obra do senhor é perfeita/coro.pdf'.normalize('NFD')
    );
    assert.equal(
      normalizePdfUrl(nfd.normalize('NFC')),
      'assets/05042026/a obra do senhor e perfeita/coro.pdf'
    );
    assert.notEqual(normalizePdfUrl(nfd), normalizePdfUrl(nfd.normalize('NFC')));
  });

  it('caminhos com o mesmo nome de arquivo continuam sendo chaves distintas', () => {
    assert.equal(new Set(G.basenameRepetido.map(normalizePdfUrl)).size, 4);
  });
});

describe('varredura do acervo inteiro (só quando o manifesto está na raiz)', () => {
  const MANIFESTO = 'louvores-manifest.json';

  it('4629 caminhos, 4629 divergências, 0 colisões em cada função', () => {
    if (!fs.existsSync(MANIFESTO)) return; // manifesto não é versionado
    const caminhos = caminhosDoManifesto(MANIFESTO);
    assert.equal(caminhos.length, 4629);
    const divergentes = caminhos.filter((p) => normalizePdfUrl(p) !== paraArmazenamento(p));
    assert.equal(divergentes.length, 4629);
    assert.equal(new Set(caminhos.map(normalizePdfUrl)).size, 4629);
    assert.equal(new Set(caminhos.map(paraArmazenamento)).size, 4629);
  });

  it('a fixture só contém caminhos que existem mesmo no acervo', () => {
    if (!fs.existsSync(MANIFESTO)) return;
    const doAcervo = new Set(caminhosDoManifesto(MANIFESTO));
    for (const p of TODOS) assert.ok(doAcervo.has(p), `fora do acervo: ${p}`);
  });
});

/** @param {string} arquivo */
function caminhosDoManifesto(arquivo) {
  const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  return dados.map((/** @type {{pdfId: string}} */ l) => {
    let p = Buffer.from(l.pdfId, 'base64').toString('utf8').replace(/^\/+/, '').trim();
    if (!p.toLowerCase().startsWith('assets/')) p = `assets/${p}`;
    return p;
  });
}
