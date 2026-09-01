/**
 * Migração das chaves de PDF gravadas em NFD (#22.2).
 * Run: node --test src/lib/offline/storage/pdfCacheNfcMigration.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrarChavesPdfParaNfc } from './pdfCacheNfcMigration.js';

/**
 * Cache Storage falso: guarda pares url → corpo.
 * @param {Array<[string, any]>} entradas
 */
function cacheFalso(entradas) {
  const mapa = new Map(entradas);
  return {
    mapa,
    async keys() {
      return [...mapa.keys()].map((url) => ({ url }));
    },
    /** @param {any} req */
    async match(req) {
      const url = typeof req === 'string' ? req : req.url;
      return mapa.has(url) ? { corpo: mapa.get(url), clone: () => ({ corpo: mapa.get(url) }) } : undefined;
    },
    /** @param {any} req @param {any} res */
    async put(req, res) {
      mapa.set(typeof req === 'string' ? req : req.url, res.corpo);
    },
    /** @param {any} req */
    async delete(req) {
      return mapa.delete(typeof req === 'string' ? req : req.url);
    }
  };
}

/**
 * Canonicalizador injetado: decodifica, aplica NFC, recodifica.
 * @param {string} url
 */
function canonicalizar(url) {
  const u = new URL(url);
  const caminho = decodeURIComponent(u.pathname).normalize('NFC');
  return `${u.origin}${encodeURI(caminho)}`;
}

const NFD = 'https://plpcg.com/assets/PES/Alto%20prec%CC%A7o%20-%20CIFRA.pdf';
const NFC = 'https://plpcg.com/assets/PES/Alto%20pre%C3%A7o%20-%20CIFRA.pdf';
const JA_OK = 'https://plpcg.com/assets/ColCIAs/001.pdf';

describe('migrarChavesPdfParaNfc', () => {
  it('reescreve a chave NFD sob a forma NFC e apaga a antiga', async () => {
    const cache = cacheFalso([[NFD, 'pdf-a'], [JA_OK, 'pdf-b']]);
    const r = await migrarChavesPdfParaNfc(/** @type {any} */ (cache), canonicalizar);
    assert.deepEqual(r, { migradas: 1, mantidas: 1, erros: 0 });
    assert.equal(cache.mapa.get(NFC), 'pdf-a');
    assert.equal(cache.mapa.has(NFD), false);
    assert.equal(cache.mapa.get(JA_OK), 'pdf-b');
  });

  it('não toca em nada quando tudo já está canônico', async () => {
    const cache = cacheFalso([[NFC, 'pdf-a'], [JA_OK, 'pdf-b']]);
    const r = await migrarChavesPdfParaNfc(/** @type {any} */ (cache), canonicalizar);
    assert.deepEqual(r, { migradas: 0, mantidas: 2, erros: 0 });
  });

  it('é idempotente: rodar duas vezes dá o mesmo cache', async () => {
    const cache = cacheFalso([[NFD, 'pdf-a']]);
    await migrarChavesPdfParaNfc(/** @type {any} */ (cache), canonicalizar);
    const r = await migrarChavesPdfParaNfc(/** @type {any} */ (cache), canonicalizar);
    assert.deepEqual(r, { migradas: 0, mantidas: 1, erros: 0 });
    assert.equal(cache.mapa.size, 1);
  });

  it('grava a chave nova antes de apagar a velha', async () => {
    // Se a operação for interrompida no meio, tem de sobrar a entrada antiga,
    // nunca nenhuma. Provamos observando a ordem: falhamos o delete de
    // propósito e conferimos que a chave nova já existe.
    const cache = cacheFalso([[NFD, 'pdf-a']]);
    cache.delete = async () => {
      throw new Error('falha simulada');
    };
    const r = await migrarChavesPdfParaNfc(/** @type {any} */ (cache), canonicalizar);
    assert.equal(cache.mapa.has(NFC), true);
    assert.equal(cache.mapa.has(NFD), true);
    assert.equal(r.erros, 1);
  });
});
