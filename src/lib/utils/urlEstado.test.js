/**
 * Testes de `urlEstado.js` — a camada de ESTADO da Tarefa 11 (#21 parte 2),
 * construída sobre `urlParams.js` (Tarefa 3). Ver o cabeçalho de urlEstado.js
 * para a divisão de responsabilidades entre os dois módulos.
 *
 * Run: node --test src/lib/utils/urlEstado.test.js
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aplicarParamsNaQuery, lerEstadoDaUrl } from './urlEstado.js';

const u = (query) => new URL(`https://plpcg.com/${query}`);

describe('lerEstadoDaUrl', () => {
  it('lê o formato que o app grava sozinho hoje na barra de endereços (F1)', () => {
    const estado = lerEstadoDaUrl(
      u('?arranjo=Avulsos+Diversos%2CColet%C3%A2nea+Adultos%2CColet%C3%A2nea+CIAs%2CPES%2CPES+CIAs')
    );
    assert.deepEqual(estado.arranjo, [
      'Avulsos Diversos',
      'Coletânea Adultos',
      'Coletânea CIAs',
      'PES',
      'PES CIAs'
    ]);
    assert.equal(estado.temArranjo, true);
  });

  it('aceita CSV digitado à mão, com espaço, + e vírgulas sobrando (F2/F3)', () => {
    assert.deepEqual(lerEstadoDaUrl(u('?arranjo=PES,PES CIAs')).arranjo, ['PES', 'PES CIAs']);
    assert.deepEqual(lerEstadoDaUrl(u('?arranjo=PES+CIAs')).arranjo, ['PES CIAs']);
    assert.deepEqual(lerEstadoDaUrl(u('?arranjo=%20PES%20,,PES%20CIAs%20')).arranjo, [
      'PES',
      'PES CIAs'
    ]);
  });

  it('aceita materiais completos, que a escrita nunca produz (F6)', () => {
    const estado = lerEstadoDaUrl(u('?materiais=Partitura,Cifra,Gestos em Gravura'));
    assert.deepEqual(estado.materiais, ['Partitura', 'Cifra', 'Gestos em Gravura']);
    assert.equal(estado.temMateriais, true);
  });

  it('distingue param ausente de param vazio (F7/F8)', () => {
    assert.equal(lerEstadoDaUrl(u('')).temMateriais, false);
    assert.equal(lerEstadoDaUrl(u('?materiais=')).temMateriais, true);
    assert.deepEqual(lerEstadoDaUrl(u('?materiais=')).materiais, []);
  });

  it('devolve o texto de busca com % intacto (F16)', () => {
    assert.equal(lerEstadoDaUrl(u('?pesquisa=100%25')).pesquisa, '100%');
    assert.equal(lerEstadoDaUrl(u('?pesquisa=Cora%C3%A7%C3%A3o')).pesquisa, 'Coração');
    assert.equal(lerEstadoDaUrl(u('')).pesquisa, '');
  });

  it('normaliza comoAbrir inválido para leitor e aceita os cinco modos (F9/F10/F12)', () => {
    for (const modo of ['leitor', 'online', 'newtab', 'share', 'save']) {
      assert.equal(lerEstadoDaUrl(u(`?comoAbrir=${modo}`)).comoAbrir, modo);
    }
    assert.equal(lerEstadoDaUrl(u('?comoAbrir=lixo')).comoAbrir, 'leitor');
    assert.equal(lerEstadoDaUrl(u('')).comoAbrir, 'leitor');
  });

  it('nunca devolve NaN nem null para pagina (P4)', () => {
    assert.equal(lerEstadoDaUrl(u('?pagina=3')).pagina, 3);
    assert.equal(lerEstadoDaUrl(u('?pagina=0')).pagina, 1);
    assert.equal(lerEstadoDaUrl(u('?pagina=-2')).pagina, 1);
    assert.equal(lerEstadoDaUrl(u('?pagina=abc')).pagina, 1);
    assert.equal(lerEstadoDaUrl(u('')).pagina, 1);
  });

  it('normaliza ordenar (P7/P8/P9)', () => {
    assert.equal(lerEstadoDaUrl(u('?ordenar=nome')).ordenar, 'nome');
    assert.equal(lerEstadoDaUrl(u('?ordenar=numero')).ordenar, 'numero');
    assert.equal(lerEstadoDaUrl(u('?ordenar=aleatorio')).ordenar, 'numero');
  });

  it('normaliza itensPorPagina igual nas duas rotas (P10/P11)', () => {
    assert.equal(lerEstadoDaUrl(u('?itensPorPagina=25')).itensPorPagina, 25);
    assert.equal(lerEstadoDaUrl(u('?itensPorPagina=7')).itensPorPagina, 10);
    assert.equal(lerEstadoDaUrl(u('')).itensPorPagina, 10);
  });

  it('não confunde um valor que contém "arranjo=" com o param arranjo (D3)', () => {
    assert.equal(lerEstadoDaUrl(u('?pesquisa=arranjo=x')).temArranjo, false);
    assert.equal(lerEstadoDaUrl(u('?pesquisa=arranjo%3Dx')).temArranjo, false);
    assert.equal(lerEstadoDaUrl(u('?pesquisa=arranjo=x')).pesquisa, 'arranjo=x');
  });

  it('mantém as regras do URLSearchParams para chave repetida e caixa (D4/D5)', () => {
    assert.equal(lerEstadoDaUrl(u('?pesquisa=amor&pesquisa=paz')).pesquisa, 'amor');
    assert.equal(lerEstadoDaUrl(u('?PESQUISA=amor')).pesquisa, '');
  });

  it('lista os params conhecidos com valor inválido (D-9)', () => {
    assert.deepEqual(lerEstadoDaUrl(u('?comoAbrir=lixo&ordenar=aleatorio')).paramsInvalidos, [
      'comoAbrir',
      'ordenar'
    ]);
    assert.deepEqual(lerEstadoDaUrl(u('?itensPorPagina=7&pagina=abc')).paramsInvalidos, [
      'itensPorPagina',
      'pagina'
    ]);
    assert.deepEqual(lerEstadoDaUrl(u('?ordenar=nome&pagina=3')).paramsInvalidos, []);
  });
});

describe('aplicarParamsNaQuery', () => {
  it('nunca apaga params de terceiros (D1/D2/D6)', () => {
    const query = aplicarParamsNaQuery('?utm_source=whatsapp&fbclid=IwAR1&ordenar=nome', {
      pesquisa: 'amor'
    });
    const params = new URLSearchParams(query);
    assert.equal(params.get('utm_source'), 'whatsapp');
    assert.equal(params.get('fbclid'), 'IwAR1');
    assert.equal(params.get('ordenar'), 'nome');
    assert.equal(params.get('pesquisa'), 'amor');
  });

  it('apaga os valores padrão e mantém os não-padrão', () => {
    assert.equal(aplicarParamsNaQuery('?pagina=5', { pagina: 1 }), '');
    assert.equal(aplicarParamsNaQuery('', { pagina: 4 }), 'pagina=4');
    assert.equal(aplicarParamsNaQuery('?itensPorPagina=25', { itensPorPagina: 10 }), '');
    assert.equal(aplicarParamsNaQuery('', { itensPorPagina: 50 }), 'itensPorPagina=50');
    assert.equal(aplicarParamsNaQuery('?ordenar=nome', { ordenar: 'numero' }), '');
    assert.equal(aplicarParamsNaQuery('?comoAbrir=newtab', { comoAbrir: 'leitor' }), '');
    assert.equal(aplicarParamsNaQuery('?pesquisa=amor', { pesquisa: '   ' }), '');
  });

  it('some com materiais quando todos estão selecionados', () => {
    const query = aplicarParamsNaQuery('', {
      materiais: ['Cifra', 'Gestos em Gravura', 'Partitura']
    });
    assert.equal(query, '');
  });

  it('grava materiais= vazio quando nada está selecionado (D-8)', () => {
    const query = aplicarParamsNaQuery('', { materiais: [] });
    assert.equal(query, 'materiais=');
    assert.equal(lerEstadoDaUrl({ search: `?${query}` }).temMateriais, true);
    assert.deepEqual(lerEstadoDaUrl({ search: `?${query}` }).materiais, []);
  });

  it('grava arranjo= e arranjoEspecial= vazios, pelo mesmo motivo', () => {
    assert.equal(aplicarParamsNaQuery('?arranjo=PES', { arranjo: [] }), 'arranjo=');
    assert.equal(
      aplicarParamsNaQuery('?arranjoEspecial=GLTM', { arranjoEspecial: [] }),
      'arranjoEspecial='
    );
  });

  it('normaliza params conhecidos inválidos mesmo sem falar deles (D-9)', () => {
    const query = aplicarParamsNaQuery('?comoAbrir=lixo&ordenar=aleatorio&itensPorPagina=7', {});
    assert.equal(query, '');
    assert.equal(aplicarParamsNaQuery('?utm_source=x&pagina=abc', {}), 'utm_source=x');
  });

  it('acumula escritas sucessivas em vez de descartar a anterior (§4.9)', () => {
    // É o que `homeSearchUrlParams` remendava à mão: gravar `pesquisa` não pode
    // derrubar um `pagina` gravado no mesmo flush.
    const primeira = aplicarParamsNaQuery('', { pagina: 3 });
    const segunda = aplicarParamsNaQuery(primeira, { pesquisa: 'amor' });
    const params = new URLSearchParams(segunda);
    assert.equal(params.get('pagina'), '3');
    assert.equal(params.get('pesquisa'), 'amor');
  });
});
