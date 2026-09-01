/**
 * Contrato executável da normalização de caminho de PDF do cliente (#24, #22.5).
 *
 * Até a Tarefa 9 (#22.5) este arquivo congelava DUAS normalizações lado a
 * lado — a normalização minúscula e sem acento que o cliente usava para
 * comparação difusa, e `PdfPathManager.normalizeForStorage` (NFC, preserva
 * caixa e acento) — porque era o contrato que impedia a fase de trocar de
 * direção sem perceber. A normalização minúscula saiu do cliente na Tarefa 9:
 * sobrou uma normalização, e é ela que este arquivo congela agora.
 *
 * `normalizeR2Key` (`src/lib/server/r2KeyMatch.js`) é uma normalização de
 * **servidor**, deliberadamente diferente desta, coberta por
 * `src/lib/server/r2KeyMatch.test.js` — fora do escopo deste plano.
 *
 * Run: node --test src/lib/utils/normalizacaoCaminho.contrato.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import PdfPathManager from '../offline/utils/PdfPathManager.js';

const fixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/caminhos-acervo.json', import.meta.url), 'utf8')
);

const G = fixture.grupos;
/** Os 42 caminhos da fixture, em ordem estável. */
const TODOS = Object.values(G).flat();

const paraArmazenamento = (p) => PdfPathManager.normalizeForStorage(p);

describe('normalizeForStorage — propriedades que valem para o acervo inteiro', () => {
  it('a fixture tem 42 caminhos em 9 grupos', () => {
    assert.equal(TODOS.length, 42);
    assert.equal(Object.keys(G).length, 9);
    assert.equal(fixture.totalNoAcervo, 4629);
  });

  it('#22.5: sobrou uma normalização — ela é idempotente e sempre devolve NFC', () => {
    // Até a Tarefa 9 este caso congelava a divergência entre as duas funções.
    // Agora só uma existe: o que resta a congelar é que ela é estável
    // (idempotente) e converge sempre para NFC.
    for (const p of TODOS) {
      const canonico = paraArmazenamento(p);
      assert.equal(paraArmazenamento(canonico), canonico);
      assert.equal(canonico, canonico.normalize('NFC'));
    }
  });

  it('não perde informação a ponto de colidir', () => {
    assert.equal(new Set(TODOS.map(paraArmazenamento)).size, TODOS.length);
  });
});

describe('normalizeForStorage — a normalização canônica', () => {
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

describe('varredura do acervo inteiro (só quando o manifesto está na raiz)', () => {
  const MANIFESTO = 'louvores-manifest.json';

  it('4629 caminhos, 0 colisões', () => {
    if (!fs.existsSync(MANIFESTO)) return; // manifesto não é versionado
    const caminhos = caminhosDoManifesto(MANIFESTO);
    assert.equal(caminhos.length, 4629);
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
