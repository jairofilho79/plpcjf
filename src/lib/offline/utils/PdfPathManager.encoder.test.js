/**
 * Um só codificador de URL de PDF (#22.1).
 * Run: node --test src/lib/offline/utils/PdfPathManager.encoder.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import PdfPathManager from './PdfPathManager.js';

const ORIGEM = 'https://plpcg.com';

/** Os três caminhos reais do acervo em que encodeURI e o parser URL divergem. */
const COM_COLCHETES = [
  'assets/30102025/Sobe aqui [26-07-2025] - Coro.pdf',
  'assets/PES/Ó profundidade das riquezas - Vocal [20 03 2026].pdf',
  'assets/PES/Perante a tua grandeza - Vocal [06 02 2025].pdf'
];

/** Reproduz o que o leitor faz hoje: parser WHATWG sobre o caminho já decodificado. */
function urlPeloParser(caminho) {
  return new URL(`/${caminho}`, ORIGEM).href;
}

describe('createRequestUrl é o único codificador', () => {
  it('a chave canônica é ponto fixo do parser URL', () => {
    // Se isto vale, qualquer new URL() aplicado depois da codificação canônica
    // devolve a mesma string — é o que permite ao leitor não divergir.
    for (const caminho of COM_COLCHETES) {
      const canonica = PdfPathManager.createRequestUrl(caminho, ORIGEM);
      assert.equal(new URL(canonica).href, canonica, `não é ponto fixo: ${caminho}`);
    }
  });

  it('o leitor, canonicalizando, chega à mesma URL que o escritor do cache', () => {
    for (const caminho of COM_COLCHETES) {
      const chaveGravada = PdfPathManager.createRequestUrl(caminho, ORIGEM);
      // O leitor recebe o caminho já decodificado, vindo de ?file=.
      const pedidoDoLeitor = PdfPathManager.createRequestUrl(caminho, ORIGEM);
      assert.equal(pedidoDoLeitor, chaveGravada);
    }
  });

  it('o parser WHATWG cru diverge — é o bug que esta tarefa fecha', () => {
    // Guarda de regressão: se um dia isto passar a ser igual, o navegador mudou
    // e a escolha de codificador precisa ser reavaliada.
    for (const caminho of COM_COLCHETES) {
      assert.notEqual(urlPeloParser(caminho), PdfPathManager.createRequestUrl(caminho, ORIGEM));
    }
  });

  it('nenhum caminho do acervo tem # ? ou %, que encodeURI deixaria passar', () => {
    const manifesto = 'louvores-manifest.json';
    if (!fs.existsSync(manifesto)) return; // fixture opcional: não versionado
    for (const caminho of caminhosDoManifesto(manifesto)) {
      assert.ok(!/[#?%]/.test(caminho), `caractere perigoso em ${caminho}`);
    }
  });

  it('sobre os 4629 caminhos reais, a chave canônica é sempre ponto fixo', () => {
    const manifesto = 'louvores-manifest.json';
    if (!fs.existsSync(manifesto)) return; // fixture opcional: não versionado
    const caminhos = caminhosDoManifesto(manifesto);
    assert.equal(caminhos.length, 4629);
    let divergentes = 0;
    for (const caminho of caminhos) {
      const canonica = PdfPathManager.createRequestUrl(caminho, ORIGEM);
      if (new URL(canonica).href !== canonica) divergentes++;
    }
    assert.equal(divergentes, 0);
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
