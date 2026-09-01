/**
 * NFC na normalização de armazenamento (#22.2).
 * Run: node --test src/lib/offline/utils/PdfPathManager.nfc.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import PdfPathManager from './PdfPathManager.js';

const ORIGEM = 'https://plpcg.com';

/** Os oito caminhos reais do acervo que chegam em NFD. */
const EM_NFD = [
  'assets/05042026/A Obra do Senhor é Perfeita/Coro.pdf',
  'assets/05042026/Bênção Aarônica (Bênção Apostólica)/Coro.pdf',
  'assets/05042026/Tabernáculo/Coro.pdf',
  'assets/30102025/A ORAÇÃO DA TUA IGREJA - Coro.pdf',
  'assets/30102025/Preciosa graça de Jesus (T&F V) - Vocal -16 10 2025-.pdf',
  'assets/Avulsos Diversos/Ao Único.pdf',
  'assets/PES/Alto preço - CIFRA.pdf',
  'assets/PES/Ó profundidade das riquezas - Vocal [20 03 2026].pdf'
].map((p) => p.normalize('NFD'));

describe('normalizeForStorage unifica a forma Unicode', () => {
  it('NFD e NFC do mesmo caminho dão a mesma chave', () => {
    for (const nfd of EM_NFD) {
      const nfc = nfd.normalize('NFC');
      assert.notEqual(nfd, nfc, 'a fixture tem de estar mesmo em NFD');
      assert.equal(
        PdfPathManager.normalizeForStorage(nfd),
        PdfPathManager.normalizeForStorage(nfc)
      );
    }
  });

  it('a saída é sempre NFC', () => {
    for (const nfd of EM_NFD) {
      const saida = PdfPathManager.normalizeForStorage(nfd);
      assert.equal(saida, saida.normalize('NFC'));
    }
  });

  it('a URL canônica também converge', () => {
    for (const nfd of EM_NFD) {
      assert.equal(
        PdfPathManager.createRequestUrl(nfd, ORIGEM),
        PdfPathManager.createRequestUrl(nfd.normalize('NFC'), ORIGEM)
      );
    }
  });

  it('normalizeForStorage é idempotente', () => {
    for (const nfd of EM_NFD) {
      const uma = PdfPathManager.normalizeForStorage(nfd);
      assert.equal(PdfPathManager.normalizeForStorage(uma), uma);
    }
  });

  it('o NFC não colapsa dois caminhos do acervo numa chave só', () => {
    const manifesto = 'louvores-manifest.json';
    if (!fs.existsSync(manifesto)) return; // fixture opcional: não versionado
    const dados = JSON.parse(fs.readFileSync(manifesto, 'utf8'));
    const chaves = new Set(
      dados.map((/** @type {{pdfId: string}} */ l) =>
        PdfPathManager.normalizeForStorage(Buffer.from(l.pdfId, 'base64').toString('utf8'))
      )
    );
    assert.equal(chaves.size, dados.length);
  });
});
