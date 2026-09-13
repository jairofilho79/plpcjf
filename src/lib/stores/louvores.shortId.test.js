import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { prepareLouvoresManifestPayload } from '../utils/manifestPayload.js';

describe('prepareLouvoresManifestPayload preserva shortId', () => {
  it('mantém shortId como string, inclusive "0000"', () => {
    const out = prepareLouvoresManifestPayload([
      { pdfId: 'a', nome: 'A', shortId: '0000' },
      { pdfId: 'b', nome: 'B' }
    ]);
    assert.equal(out[0].shortId, '0000');
    assert.equal(typeof out[0].shortId, 'string');
    assert.equal('shortId' in out[1], false);
  });
});
