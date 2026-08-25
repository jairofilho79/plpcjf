import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  categorySortIndex,
  groupLouvoresByGroupId,
  pickPreferredMaterial,
  resolveGroupId
} from './groupLouvores.js';

describe('groupLouvoresByGroupId', () => {
  it('keeps solos as single-material groups', () => {
    const list = [
      { nome: 'A', groupId: 'g1', categoria: 'Partitura', pdfId: '1' },
      { nome: 'B', groupId: 'g2', categoria: 'Cifra', pdfId: '2' }
    ];
    const groups = groupLouvoresByGroupId(list);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].materials.length, 1);
    assert.equal(groups[1].groupId, 'g2');
  });

  it('merges same groupId and sorts categories', () => {
    const list = [
      { nome: 'X', groupId: 'avulso:x', categoria: 'Gestos em Gravura', pdfId: 'g' },
      { nome: 'X', groupId: 'avulso:x', categoria: 'Cifra', pdfId: 'c' },
      { nome: 'X', groupId: 'avulso:x', categoria: 'Partitura', pdfId: 'p' }
    ];
    const [group] = groupLouvoresByGroupId(list);
    assert.equal(group.materials.length, 3);
    assert.deepEqual(
      group.materials.map((m) => m.categoria),
      ['Partitura', 'Cifra', 'Gestos em Gravura']
    );
  });

  it('preserves first-occurrence group order', () => {
    const list = [
      { nome: 'Second', groupId: 'b', categoria: 'Partitura', pdfId: '2' },
      { nome: 'First', groupId: 'a', categoria: 'Partitura', pdfId: '1' },
      { nome: 'Second', groupId: 'b', categoria: 'Cifra', pdfId: '3' }
    ];
    const groups = groupLouvoresByGroupId(list);
    assert.deepEqual(
      groups.map((g) => g.groupId),
      ['b', 'a']
    );
  });

  it('falls back to pdfId when groupId missing', () => {
    const list = [
      { nome: 'Solo', categoria: 'Partitura', pdfId: 'only-1' },
      { nome: 'Solo', categoria: 'Cifra', pdfId: 'only-2' }
    ];
    const groups = groupLouvoresByGroupId(list);
    assert.equal(groups.length, 2);
    assert.equal(resolveGroupId(list[0]), 'only-1');
  });

  it('returns empty for empty/invalid input', () => {
    assert.deepEqual(groupLouvoresByGroupId([]), []);
    assert.deepEqual(groupLouvoresByGroupId(null), []);
  });
});

describe('categorySortIndex / pickPreferredMaterial', () => {
  it('orders known categories before unknown', () => {
    assert.ok(categorySortIndex('Partitura') < categorySortIndex('Cifra'));
    assert.ok(categorySortIndex('Cifra') < categorySortIndex('Weird'));
  });

  it('prefers lastPdfId when present in materials', () => {
    const materials = [
      { pdfId: 'a', categoria: 'Partitura' },
      { pdfId: 'b', categoria: 'Cifra' }
    ];
    assert.equal(pickPreferredMaterial(materials, 'b').pdfId, 'b');
    assert.equal(pickPreferredMaterial(materials, 'missing').pdfId, 'a');
    assert.equal(pickPreferredMaterial([], 'a'), null);
  });
});
