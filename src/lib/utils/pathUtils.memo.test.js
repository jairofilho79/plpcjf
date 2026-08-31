/**
 * Memoização de getPdfRelPath. Run: node --test src/lib/utils/pathUtils.memo.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPdfRelPath, __resetPdfRelPathCache } from './pathUtils.js';

// btoa/atob existem no Node >= 16 globalmente.
const encode = (s) => Buffer.from(s, 'utf8').toString('base64');

describe('getPdfRelPath memoizado', () => {
  it('resolve o caminho a partir do pdfId em base64 UTF-8', () => {
    const pdfId = encode('05042026/Bênção Aarônica/Coro.pdf');
    assert.equal(getPdfRelPath({ pdfId }), 'assets/05042026/Bênção Aarônica/Coro.pdf');
  });

  it('devolve a mesma referência de string em chamadas repetidas', () => {
    __resetPdfRelPathCache();
    const pdfId = encode('assets/ColAdultos/001.pdf');
    const a = getPdfRelPath({ pdfId });
    const b = getPdfRelPath({ pdfId });
    assert.equal(a, b);
    assert.equal(a, 'assets/ColAdultos/001.pdf');
  });

  it('memoiza também o resultado nulo, sem repetir o atob', () => {
    __resetPdfRelPathCache();
    assert.equal(getPdfRelPath({ pdfId: '!!!nao-e-base64!!!' }), null);
    assert.equal(getPdfRelPath({ pdfId: '!!!nao-e-base64!!!' }), null);
  });

  it('devolve null sem pdfId', () => {
    assert.equal(getPdfRelPath(null), null);
    assert.equal(getPdfRelPath({}), null);
  });

  it('não confunde dois pdfIds diferentes', () => {
    __resetPdfRelPathCache();
    assert.equal(getPdfRelPath({ pdfId: encode('a/Coro.pdf') }), 'assets/a/Coro.pdf');
    assert.equal(getPdfRelPath({ pdfId: encode('b/Coro.pdf') }), 'assets/b/Coro.pdf');
  });
});
