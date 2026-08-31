import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  categorySortIndex,
  compareLouvorNome,
  groupLouvoresByGroupId,
  groupMaterialsByClassificacao,
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

describe('groupMaterialsByClassificacao', () => {
  it('splits mixed classifications in first-seen order', () => {
    const materials = [
      { classificacao: 'PES', categoria: 'Cifra nível II', pdfId: '1' },
      { classificacao: 'Coletânea Adultos', categoria: 'Cifra nível I', pdfId: '2' },
      { classificacao: 'PES', categoria: 'Partitura', pdfId: '3' }
    ];
    const sections = groupMaterialsByClassificacao(materials);
    assert.deepEqual(
      sections.map((s) => s.classificacao),
      ['PES', 'Coletânea Adultos']
    );
    assert.deepEqual(
      sections[0].materials.map((m) => m.categoria),
      ['Partitura', 'Cifra nível II']
    );
    assert.equal(sections[1].materials.length, 1);
  });

  it('keeps a single section when classification matches', () => {
    const materials = [
      { classificacao: 'PES (Encontro de Louvor Abril 2025)', categoria: 'Cifra', pdfId: 'a' },
      { classificacao: 'PES (Encontro de Louvor Abril 2025)', categoria: 'Partitura', pdfId: 'b' }
    ];
    const sections = groupMaterialsByClassificacao(materials);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].classificacao, 'PES (Encontro de Louvor Abril 2025)');
    assert.deepEqual(
      sections[0].materials.map((m) => m.categoria),
      ['Partitura', 'Cifra']
    );
  });

  it('uses Sem classificação for empty labels', () => {
    const sections = groupMaterialsByClassificacao([
      { categoria: 'Partitura', pdfId: '1' },
      { classificacao: '  ', categoria: 'Cifra', pdfId: '2' }
    ]);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].classificacao, 'Sem classificação');
  });

  it('returns empty for empty/invalid input', () => {
    assert.deepEqual(groupMaterialsByClassificacao([]), []);
    assert.deepEqual(groupMaterialsByClassificacao(null), []);
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

describe('memoização de groupLouvoresByGroupId', () => {
  it('devolve a mesma referência para a mesma lista', () => {
    const list = [{ pdfId: 'a', nome: 'A', categoria: 'Partitura' }];
    assert.equal(groupLouvoresByGroupId(list), groupLouvoresByGroupId(list));
  });

  it('recalcula para uma lista diferente', () => {
    const a = [{ pdfId: 'a', nome: 'A', categoria: 'Partitura' }];
    const b = [{ pdfId: 'b', nome: 'B', categoria: 'Partitura' }];
    assert.notEqual(groupLouvoresByGroupId(a), groupLouvoresByGroupId(b));
    assert.equal(groupLouvoresByGroupId(b)[0].groupId, 'b');
  });
});

describe('compareLouvorNome', () => {
  it('ordena em pt-BR ignorando acentos na ordenação primária', () => {
    const nomes = [{ nome: 'Órgão' }, { nome: 'Obra' }, { nome: 'Amor' }];
    const ordenado = [...nomes].sort(compareLouvorNome).map((x) => x.nome);
    assert.deepEqual(ordenado, ['Amor', 'Obra', 'Órgão']);
  });

  it('tolera nome ausente', () => {
    const nomes = [{ nome: 'Zelo' }, {}, { nome: 'Amor' }];
    const ordenado = [...nomes].sort(compareLouvorNome).map((x) => x.nome ?? '');
    assert.deepEqual(ordenado, ['', 'Amor', 'Zelo']);
  });
});
