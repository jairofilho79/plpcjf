/**
 * Contrato de compatibilidade da camada de URL (prepara #21).
 *
 * Cada caso corresponde a uma linha da seção 5 de
 * docs/superpowers/investigacao/2026-08-31-url-estado.md. Isto é
 * CARACTERIZAÇÃO: grava o que o app faz hoje. Os casos marcados com ⚠︎ no
 * relatório são comportamentos discutíveis que as Tarefas 10-12 vão decidir —
 * quando decidirem, o teste correspondente muda junto, de propósito.
 *
 * Run: node --test src/lib/utils/urlParams.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeArrayParam,
  deserializeArrayParam,
  parseUrlParams,
  construirQueryAtualizada,
  podeEscreverNaUrl
} from './urlParams.js';

/** As três categorias de material (src/lib/stores/filters.js:6). */
const CATEGORIAS = ['Partitura', 'Cifra', 'Gestos em Gravura'];
/** Os cinco arranjos (relatório §1.3). */
const ARRANJOS = ['Avulsos Diversos', 'Coletânea Adultos', 'Coletânea CIAs', 'PES', 'PES CIAs'];

/** @param {string} caminhoEQuery */
const url = (caminhoEQuery) => new URL(caminhoEQuery, 'https://plpcg.com');

describe('§5.2 filtros e busca — links que já circulam', () => {
  it('F1: o arranjo=<5 valores> que o app grava sozinho na barra de endereços', () => {
    const u = url(
      '/?arranjo=Avulsos+Diversos%2CColet%C3%A2nea+Adultos%2CColet%C3%A2nea+CIAs%2CPES%2CPES+CIAs'
    );
    assert.deepEqual(parseUrlParams(u).arranjo, ARRANJOS);
  });

  it('F1 (volta): escrever os 5 arranjos reproduz exatamente esse link', () => {
    assert.equal(
      construirQueryAtualizada('', { arranjo: ARRANJOS }),
      'arranjo=Avulsos+Diversos%2CColet%C3%A2nea+Adultos%2CColet%C3%A2nea+CIAs%2CPES%2CPES+CIAs'
    );
  });

  it('F2: vírgula e espaço crus, digitados à mão', () => {
    assert.deepEqual(parseUrlParams(url('/?arranjo=PES,PES CIAs')).arranjo, ['PES', 'PES CIAs']);
    assert.deepEqual(parseUrlParams(url('/?arranjo=PES,PES+CIAs')).arranjo, ['PES', 'PES CIAs']);
    assert.deepEqual(parseUrlParams(url('/?arranjo=PES,PES%20CIAs')).arranjo, ['PES', 'PES CIAs']);
  });

  it('F3: espaço em borda e item vazio são tolerados', () => {
    // trim() por item + filter(Boolean). Comportamento a PRESERVAR na Tarefa 4.
    assert.deepEqual(parseUrlParams(url('/?arranjo=%20PES%20,,PES%20CIAs%20')).arranjo, [
      'PES',
      'PES CIAs'
    ]);
  });

  it('F4/F5: materiais aceita um ou vários, e a ordem da URL é irrelevante na leitura', () => {
    assert.deepEqual(parseUrlParams(url('/?materiais=Cifra')).materiais, ['Cifra']);
    assert.deepEqual(parseUrlParams(url('/?materiais=Cifra,Partitura')).materiais, [
      'Cifra',
      'Partitura'
    ]);
    assert.deepEqual(parseUrlParams(url('/?materiais=Partitura,Cifra')).materiais, [
      'Partitura',
      'Cifra'
    ]);
  });

  it('F6: os três materiais são aceitos na leitura e nunca produzidos na escrita', () => {
    assert.deepEqual(parseUrlParams(url('/?materiais=Partitura,Cifra,Gestos em Gravura')).materiais, CATEGORIAS);
    assert.equal(construirQueryAtualizada('', { materiais: CATEGORIAS }, { defaultMateriais: CATEGORIAS }), '');
  });

  it('F7: materiais= vazio devolve lista vazia', () => {
    // ⚠︎ na página isso vira zero resultados. Aqui só se grava o parse.
    assert.deepEqual(parseUrlParams(url('/?materiais=')).materiais, []);
  });

  it('F8: arranjo= vazio devolve lista vazia', () => {
    assert.deepEqual(parseUrlParams(url('/?arranjo=')).arranjo, []);
  });

  it('F9/F10/F11: os cinco modos de comoAbrir sobrevivem ao round-trip', () => {
    for (const modo of ['leitor', 'online', 'newtab', 'share', 'save']) {
      assert.equal(parseUrlParams(url(`/?comoAbrir=${modo}`)).comoAbrir, modo);
    }
    // O default é apagado da URL; os outros quatro são gravados.
    assert.equal(construirQueryAtualizada('', { comoAbrir: 'leitor' }, { defaultComoAbrir: 'leitor' }), '');
    assert.equal(construirQueryAtualizada('', { comoAbrir: 'newtab' }, { defaultComoAbrir: 'leitor' }), 'comoAbrir=newtab');
  });

  it('F12: comoAbrir inválido é devolvido cru e permanece na URL', () => {
    // ⚠︎ D-9 decide normalizar isto na próxima escrita; hoje o param fica pendurado.
    assert.equal(parseUrlParams(url('/?comoAbrir=lixo')).comoAbrir, 'lixo');
    assert.equal(construirQueryAtualizada('?comoAbrir=lixo', { pesquisa: 'x' }), 'comoAbrir=lixo&pesquisa=x');
  });

  it('F13/F14/F15: pesquisa textual, numérica e acentuada', () => {
    assert.equal(parseUrlParams(url('/?pesquisa=amor')).pesquisa, 'amor');
    assert.equal(parseUrlParams(url('/?pesquisa=124')).pesquisa, '124');
    assert.equal(parseUrlParams(url('/?pesquisa=Cora%C3%A7%C3%A3o')).pesquisa, 'Coração');
  });

  it('F16: pesquisa com % não lança e devolve o texto certo', () => {
    assert.equal(parseUrlParams(url('/?pesquisa=100%25')).pesquisa, '100%');
    assert.equal(construirQueryAtualizada('', { pesquisa: '100%' }), 'pesquisa=100%25');
  });

  it('F17: pesquisa= vazio devolve string vazia e a escrita apaga o param', () => {
    assert.equal(parseUrlParams(url('/?pesquisa=')).pesquisa, '');
    assert.equal(construirQueryAtualizada('?pesquisa=amor', { pesquisa: '' }), '');
    assert.equal(construirQueryAtualizada('?pesquisa=amor', { pesquisa: '   ' }), '');
  });

  it('F18: os quatro params ao mesmo tempo', () => {
    const p = parseUrlParams(url('/?pesquisa=amor&arranjo=PES&materiais=Cifra&comoAbrir=newtab'));
    assert.equal(p.pesquisa, 'amor');
    assert.deepEqual(p.arranjo, ['PES']);
    assert.deepEqual(p.materiais, ['Cifra']);
    assert.equal(p.comoAbrir, 'newtab');
  });
});

describe('§5.3 paginação e ordenação', () => {
  it('P1/P5/P6: pagina e itensPorPagina são lidos como número', () => {
    assert.equal(parseUrlParams(url('/?pesquisa=amor&pagina=3')).pagina, 3);
    assert.equal(parseUrlParams(url('/biblioteca?pagina=5')).pagina, 5);
    const p = parseUrlParams(url('/biblioteca?pagina=5&itensPorPagina=25'));
    assert.equal(p.pagina, 5);
    assert.equal(p.itensPorPagina, 25);
  });

  it('P4: pagina=0, -2 e abc — e a armadilha do NaN', () => {
    assert.equal(parseUrlParams(url('/?pagina=0')).pagina, 0);
    assert.equal(parseUrlParams(url('/?pagina=-2')).pagina, -2);
    // 'abc' é truthy, então parseInt roda e devolve NaN — NÃO null.
    // Quem consome tem de blindar com `> 0`. É armadilha de refatoração.
    assert.ok(Number.isNaN(parseUrlParams(url('/?pagina=abc')).pagina));
    assert.equal(parseUrlParams(url('/')).pagina, null);
  });

  it('P2/P3: a escrita apaga pagina quando é 1 ou menor', () => {
    assert.equal(construirQueryAtualizada('', { pagina: 3 }), 'pagina=3');
    assert.equal(construirQueryAtualizada('?pagina=3', { pagina: 1 }), '');
    assert.equal(construirQueryAtualizada('?pagina=3', { pagina: 0 }), '');
  });

  it('P7/P8/P9: ordenar aceita nome, apaga numero e devolve o inválido cru', () => {
    assert.equal(parseUrlParams(url('/biblioteca?ordenar=nome')).ordenar, 'nome');
    assert.equal(parseUrlParams(url('/biblioteca?ordenar=numero')).ordenar, 'numero');
    assert.equal(parseUrlParams(url('/biblioteca?ordenar=aleatorio')).ordenar, 'aleatorio');
    assert.equal(construirQueryAtualizada('', { ordenar: 'numero' }), '');
    assert.equal(construirQueryAtualizada('', { ordenar: 'nome' }), 'ordenar=nome');
  });

  it('P10/P11: itensPorPagina inválido vira NaN na leitura; a escrita apaga o default 10', () => {
    assert.equal(parseUrlParams(url('/biblioteca?itensPorPagina=7')).itensPorPagina, 7);
    assert.ok(Number.isNaN(parseUrlParams(url('/?itensPorPagina=xyz')).itensPorPagina));
    assert.equal(construirQueryAtualizada('?itensPorPagina=25', { itensPorPagina: 10 }), '');
    assert.equal(construirQueryAtualizada('', { itensPorPagina: 25 }), 'itensPorPagina=25');
  });

  it('P12: os sete params simultâneos, o caso de regressão mais denso do app', () => {
    const p = parseUrlParams(
      url(
        '/biblioteca?ordenar=nome&itensPorPagina=50&pagina=4&arranjo=PES&arranjoEspecial=GLTM&materiais=Cifra&comoAbrir=newtab'
      )
    );
    assert.deepEqual(p, {
      materiais: ['Cifra'],
      arranjo: ['PES'],
      arranjoEspecial: ['GLTM'],
      comoAbrir: 'newtab',
      pesquisa: '',
      ordenar: 'nome',
      itensPorPagina: 50,
      pagina: 4
    });
  });

  it('P13/P14/P15: arranjoEspecial, inclusive o valor sintético Padrão', () => {
    assert.deepEqual(parseUrlParams(url('/biblioteca?arranjoEspecial=GLTM')).arranjoEspecial, ['GLTM']);
    assert.deepEqual(parseUrlParams(url('/biblioteca?arranjoEspecial=Inexistente')).arranjoEspecial, ['Inexistente']);
    assert.deepEqual(parseUrlParams(url('/biblioteca?arranjoEspecial=Padr%C3%A3o')).arranjoEspecial, ['Padrão']);
  });
});

describe('§5.5 a fronteira do PDF — não pode quebrar', () => {
  // O /leitor NÃO usa parseUrlParams: lê com URLSearchParams direto
  // (src/routes/leitor/+page.svelte:100-104). O contrato congelado é esse.
  const lerLeitor = (/** @type {string} */ href) => {
    const sp = new URLSearchParams(new URL(href, 'https://plpcg.com').search);
    return {
      file: sp.get('file') ?? '/pdfs/exemplo.pdf',
      titulo: sp.get('titulo') ?? '',
      subtitulo: sp.get('subtitulo') ?? '',
      skipValidation: sp.get('validated') === 'true'
    };
  };

  it('R1: link completo com acento, cedilha e barra vertical', () => {
    assert.deepEqual(
      lerLeitor(
        '/leitor?file=%2F04112025%2FConhe%C3%A7amos%20e%20prossigamos%2FCifra.pdf&titulo=Conhe%C3%A7amos%20e%20prossigamos&subtitulo=Cifra%20%7C%20PES%20CIAs&validated=true'
      ),
      {
        file: '/04112025/Conheçamos e prossigamos/Cifra.pdf',
        titulo: 'Conheçamos e prossigamos',
        subtitulo: 'Cifra | PES CIAs',
        skipValidation: true
      }
    );
  });

  it('R2: sem &validated=true, a validação não é pulada', () => {
    assert.equal(lerLeitor('/leitor?file=%2Fassets%2FColCIAs%2F001.pdf').skipValidation, false);
  });

  it('R3: /leitor sem params cai no PDF de exemplo', () => {
    assert.equal(lerLeitor('/leitor').file, '/pdfs/exemplo.pdf');
  });

  it('R1/R5: escrever um filtro numa query de leitor a poluiria — hoje nada impede', () => {
    // ⚠︎ Este é o mecanismo exato do medo "pode quebrar a leitura dos PDFs".
    // A função pura NÃO sabe em que rota está; a guarda tem de vir de fora.
    // A Tarefa 4 acrescenta essa guarda em updateUrlParams, com um teste próprio.
    // Esta asserção continua valendo depois dela, porque a função pura não muda.
    const queryDoLeitor = '?file=%2Fassets%2FColCIAs%2F001.pdf&titulo=Meu+Deus&validated=true';
    assert.equal(
      construirQueryAtualizada(queryDoLeitor, { pesquisa: 'amor' }),
      'file=%2Fassets%2FColCIAs%2F001.pdf&titulo=Meu+Deus&validated=true&pesquisa=amor'
    );
  });
});

describe('§5.6 casos degenerados', () => {
  it('D1/D2: parâmetros de terceiros são preservados por toda reescrita', () => {
    // utm_source e fbclid chegam em links de WhatsApp e Facebook.
    assert.equal(
      construirQueryAtualizada('?utm_source=whatsapp', { pesquisa: 'amor' }),
      'utm_source=whatsapp&pesquisa=amor'
    );
    assert.equal(
      construirQueryAtualizada('?fbclid=abc&pagina=3', { pesquisa: '  amor  ' }),
      'fbclid=abc&pagina=3&pesquisa=amor'
    );
  });

  it('D4: chave repetida — o primeiro valor vence', () => {
    assert.equal(parseUrlParams(url('/?pesquisa=amor&pesquisa=paz')).pesquisa, 'amor');
  });

  it('D5: as chaves são sensíveis à caixa', () => {
    assert.equal(parseUrlParams(url('/?PESQUISA=amor')).pesquisa, '');
  });

  it('D6: um param de outra rota é inerte e sobrevive a todas as reescritas', () => {
    assert.equal(construirQueryAtualizada('?ordenar=nome', { pesquisa: 'x' }), 'ordenar=nome&pesquisa=x');
  });

  it('D9: recarregar restaura tudo — o round-trip fecha em todos os params', () => {
    const original = parseUrlParams(
      url('/biblioteca?arranjo=PES%2CPES+CIAs&materiais=Cifra&comoAbrir=newtab&ordenar=nome&itensPorPagina=25&pagina=4')
    );
    const query = construirQueryAtualizada(
      '',
      {
        arranjo: original.arranjo,
        materiais: original.materiais,
        comoAbrir: original.comoAbrir,
        ordenar: original.ordenar,
        itensPorPagina: original.itensPorPagina,
        pagina: original.pagina
      },
      { defaultMateriais: CATEGORIAS, defaultComoAbrir: 'leitor' }
    );
    assert.deepEqual(parseUrlParams(url(`/biblioteca?${query}`)), original);
  });
});

describe('serialização de array', () => {
  it('junta com vírgula e devolve vazio para lista vazia', () => {
    assert.equal(serializeArrayParam(['a', 'b']), 'a,b');
    assert.equal(serializeArrayParam([]), '');
    assert.equal(serializeArrayParam(null), '');
  });

  it('deserializa com trim por item e descarta vazios', () => {
    assert.deepEqual(deserializeArrayParam(' PES ,,PES CIAs '), ['PES', 'PES CIAs']);
    assert.deepEqual(deserializeArrayParam(''), []);
    assert.deepEqual(deserializeArrayParam(null), []);
  });
});

describe('R5: nenhuma escrita de URL em /leitor', () => {
  it('as rotas de navegação normal podem escrever', () => {
    for (const rota of ['/', '/biblioteca', '/listas', '/offline', '/sobre']) {
      assert.equal(podeEscreverNaUrl(rota), true, `deveria poder escrever em ${rota}`);
    }
  });

  it('/leitor não pode, em nenhuma forma', () => {
    assert.equal(podeEscreverNaUrl('/leitor'), false);
    assert.equal(podeEscreverNaUrl('/leitor/'), false);
    assert.equal(podeEscreverNaUrl('/leitor/qualquer-coisa'), false);
  });

  it('uma rota que só começa com as mesmas letras não é bloqueada', () => {
    // /leitores não existe hoje, mas a guarda não pode bloquear por prefixo solto.
    assert.equal(podeEscreverNaUrl('/leitores'), true);
  });

  it('entrada inválida é tratada como bloqueada — na dúvida, não escreve', () => {
    assert.equal(podeEscreverNaUrl(''), false);
    assert.equal(podeEscreverNaUrl(null), false);
    assert.equal(podeEscreverNaUrl(undefined), false);
  });
});

describe('§4.10 duplo decode — o valor já vem decodificado de URLSearchParams', () => {
  it('um %20 literal digitado pelo usuário sobrevive na busca', () => {
    // URLSearchParams.get() já decodifica uma vez: '?pesquisa=a%2520b' devolve
    // 'a%20b'. Decodificar de novo transformava isso em 'a b' — texto do
    // usuário corrompido em silêncio.
    assert.equal(parseUrlParams(url('/?pesquisa=a%2520b')).pesquisa, 'a%20b');
  });

  it('um %20 literal sobrevive dentro de um item de array', () => {
    assert.deepEqual(parseUrlParams(url('/?arranjo=a%2520b,c')).arranjo, ['a%20b', 'c']);
    assert.deepEqual(deserializeArrayParam('a%20b,c'), ['a%20b', 'c']);
  });

  it('o comportamento tolerante de deserializeArrayParam é preservado', () => {
    // trim() por item e filter(Boolean) continuam valendo — é o caso F3.
    assert.deepEqual(deserializeArrayParam(' PES ,,PES CIAs '), ['PES', 'PES CIAs']);
    assert.deepEqual(deserializeArrayParam('  ,  ,  '), []);
    assert.deepEqual(deserializeArrayParam('PES'), ['PES']);
  });

  it('um % solto não lança em nenhum dos params', () => {
    assert.equal(parseUrlParams(url('/?pesquisa=100%25')).pesquisa, '100%');
    assert.deepEqual(parseUrlParams(url('/?arranjo=100%25,x')).arranjo, ['100%', 'x']);
    assert.equal(parseUrlParams(url('/?comoAbrir=100%25')).comoAbrir, '100%');
    assert.equal(parseUrlParams(url('/?ordenar=100%25')).ordenar, '100%');
  });
});
