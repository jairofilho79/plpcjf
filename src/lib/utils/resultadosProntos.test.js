/**
 * Os predicados da paginação, e as invariantes estruturais da trava que os
 * consome. Run:
 * node --test src/lib/utils/resultadosProntos.test.js
 *
 * A segunda metade deste arquivo compila `src/routes/biblioteca/+page.svelte`
 * com o compilador do próprio repositório e inspeciona o código gerado. Não é
 * teste de componente — nada é montado, nada renderiza. É a única forma de
 * cobrir, fora do navegador, as três maneiras de esta correção partir: a trava
 * fechar antes de a paginação ser recalculada, a trava deixar de ser monotônica,
 * e a trava virar um `$:` (que valeria `undefined` para quem a lesse dentro de
 * `instance()` — a página em branco de 2026-09-01).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';
import { houveFiltragemReal, podeCorrigirPaginacao } from './resultadosProntos.js';

/* ------------------------------------------------------------------ */
/* houveFiltragemReal — a condição VIVA                                */
/* ------------------------------------------------------------------ */

describe('houveFiltragemReal', () => {
  it('é falso enquanto o catálogo não carregou', () => {
    // Uma conjunção falsa de cada vez: as outras duas ficam verdadeiras, senão
    // o caso passaria mesmo com a conjunção removida e não cobriria nada.
    assert.equal(
      houveFiltragemReal({ carregado: false, totalCatalogo: 4630, totalArranjos: 5 }),
      false
    );
  });

  it('é falso quando o catálogo carregou vazio', () => {
    assert.equal(
      houveFiltragemReal({ carregado: true, totalCatalogo: 0, totalArranjos: 5 }),
      false
    );
  });

  it('é falso na janela em que o catálogo já chegou mas o padrão de Arranjos ainda não foi aplicado', () => {
    // Esta é a corrida D-3: corrigir a URL aqui apagaria o `?pagina=3` do link.
    assert.equal(
      houveFiltragemReal({ carregado: true, totalCatalogo: 4630, totalArranjos: 0 }),
      false
    );
  });

  it('é verdadeiro com catálogo carregado e ao menos um Arranjo selecionado', () => {
    assert.equal(
      houveFiltragemReal({ carregado: true, totalCatalogo: 4630, totalArranjos: 1 }),
      true
    );
  });

  it('devolve booleano, nunca o valor cru recebido', () => {
    const resultado = houveFiltragemReal({
      carregado: /** @type {any} */ (undefined),
      totalCatalogo: 4630,
      totalArranjos: 5
    });
    assert.equal(resultado, false);
    assert.equal(typeof resultado, 'boolean');
  });

  it('desmarcar todos os Arranjos volta a ser falso — é por isso que a página precisa de trava, e não desta condição direto', () => {
    const carregado = true;
    const totalCatalogo = 4630;
    assert.equal(houveFiltragemReal({ carregado, totalCatalogo, totalArranjos: 5 }), true);
    assert.equal(houveFiltragemReal({ carregado, totalCatalogo, totalArranjos: 0 }), false);
  });
});

/* ------------------------------------------------------------------ */
/* podeCorrigirPaginacao — o predicado da TRAVA                        */
/* ------------------------------------------------------------------ */

describe('podeCorrigirPaginacao', () => {
  it('é falso enquanto o catálogo não carregou, mesmo com a seleção declarada na URL', () => {
    assert.equal(
      podeCorrigirPaginacao({
        carregado: false,
        totalCatalogo: 4630,
        totalArranjos: 5,
        selecaoDeArranjoDefinida: true
      }),
      false
    );
  });

  it('é falso com catálogo vazio, mesmo com a seleção declarada na URL', () => {
    assert.equal(
      podeCorrigirPaginacao({
        carregado: true,
        totalCatalogo: 0,
        totalArranjos: 5,
        selecaoDeArranjoDefinida: true
      }),
      false
    );
  });

  it('D-3: catálogo pronto, nenhum Arranjo e a URL sem `arranjo` — ainda é transiente, a trava tem de esperar', () => {
    // `?pagina=3` em aba fria, sem `?arranjo=`: `aplicarPadrao` ainda vai
    // rodar. Fechar a trava aqui apagaria a página 3 do deep link.
    assert.equal(
      podeCorrigirPaginacao({
        carregado: true,
        totalCatalogo: 4630,
        totalArranjos: 0,
        selecaoDeArranjoDefinida: false
      }),
      false
    );
  });

  it('cenário 2: catálogo pronto, nenhum Arranjo, mas a URL traz `arranjo=` — é escolha, não transiente', () => {
    // `/biblioteca?arranjo=&pagina=999`: `aplicarPadrao` é pulado de propósito,
    // a seleção vazia é definitiva, e a página 1 é a contagem final. Corrigir
    // a URL aqui é o comportamento certo.
    assert.equal(
      podeCorrigirPaginacao({
        carregado: true,
        totalCatalogo: 4630,
        totalArranjos: 0,
        selecaoDeArranjoDefinida: true
      }),
      true
    );
  });

  it('com Arranjo selecionado é verdadeiro, com ou sem o param na URL', () => {
    const base = { carregado: true, totalCatalogo: 4630, totalArranjos: 5 };
    assert.equal(podeCorrigirPaginacao({ ...base, selecaoDeArranjoDefinida: false }), true);
    assert.equal(podeCorrigirPaginacao({ ...base, selecaoDeArranjoDefinida: true }), true);
  });

  it('é mais permissivo que houveFiltragemReal apenas no caso do `?arranjo=` vazio', () => {
    // O refinamento não pode destrancar nenhuma outra situação, sob pena de
    // reabrir a D-3.
    const valores = [false, true];
    for (const carregado of valores) {
      for (const totalCatalogo of [0, 4630]) {
        for (const totalArranjos of [0, 5]) {
          for (const selecaoDeArranjoDefinida of valores) {
            const entrada = { carregado, totalCatalogo, totalArranjos, selecaoDeArranjoDefinida };
            const viva = houveFiltragemReal(entrada);
            const trava = podeCorrigirPaginacao(entrada);
            if (trava !== viva) {
              assert.deepEqual(
                { carregado, totalCatalogo: totalCatalogo > 0, totalArranjos, selecaoDeArranjoDefinida },
                { carregado: true, totalCatalogo: true, totalArranjos: 0, selecaoDeArranjoDefinida: true },
                `divergência inesperada em ${JSON.stringify(entrada)}`
              );
            }
          }
        }
      }
    }
  });

  it('devolve booleano', () => {
    const resultado = podeCorrigirPaginacao({
      carregado: true,
      totalCatalogo: 4630,
      totalArranjos: 0,
      selecaoDeArranjoDefinida: /** @type {any} */ ('sim')
    });
    assert.equal(resultado, true);
    assert.equal(typeof resultado, 'boolean');
  });
});

/* ------------------------------------------------------------------ */
/* Mutação: cada conjunção tem de ser morta por algum caso             */
/* ------------------------------------------------------------------ */

/**
 * Toda combinação relevante das quatro entradas. As asserções acima usam um
 * subconjunto disto; aqui a tabela inteira serve para provar que nenhuma
 * conjunção do predicado é decorativa.
 */
/** @type {{ carregado: boolean, totalCatalogo: number, totalArranjos: number, selecaoDeArranjoDefinida: boolean }[]} */
const CASOS = [];
for (const carregado of [false, true]) {
  for (const totalCatalogo of [0, 4630]) {
    for (const totalArranjos of [0, 5]) {
      for (const selecaoDeArranjoDefinida of [false, true]) {
        CASOS.push({ carregado, totalCatalogo, totalArranjos, selecaoDeArranjoDefinida });
      }
    }
  }
}

/**
 * @param {string} nome
 * @param {(e: any) => boolean} original
 * @param {(e: any) => boolean} mutante
 */
function assertMutanteMorre(nome, original, mutante) {
  const sobreviventes = CASOS.filter((c) => Boolean(mutante(c)) === original(c));
  assert.notEqual(
    sobreviventes.length,
    CASOS.length,
    `o mutante "${nome}" sobrevive a TODOS os casos — essa conjunção não está coberta`
  );
}

describe('mutação — nenhuma conjunção do predicado é decorativa', () => {
  it('houveFiltragemReal: remover `carregado` é detectado', () => {
    assertMutanteMorre(
      'sem carregado',
      houveFiltragemReal,
      ({ totalCatalogo, totalArranjos }) => totalCatalogo > 0 && totalArranjos > 0
    );
  });

  it('houveFiltragemReal: remover `totalCatalogo > 0` é detectado', () => {
    assertMutanteMorre(
      'sem totalCatalogo',
      houveFiltragemReal,
      ({ carregado, totalArranjos }) => Boolean(carregado) && totalArranjos > 0
    );
  });

  it('houveFiltragemReal: remover `totalArranjos > 0` (a guarda D-3) é detectado', () => {
    assertMutanteMorre(
      'sem totalArranjos',
      houveFiltragemReal,
      ({ carregado, totalCatalogo }) => Boolean(carregado) && totalCatalogo > 0
    );
  });

  it('houveFiltragemReal: trocar `>` por `>=` é detectado nas duas contagens', () => {
    assertMutanteMorre(
      'totalCatalogo >= 0',
      houveFiltragemReal,
      ({ carregado, totalCatalogo, totalArranjos }) =>
        Boolean(carregado) && totalCatalogo >= 0 && totalArranjos > 0
    );
    assertMutanteMorre(
      'totalArranjos >= 0',
      houveFiltragemReal,
      ({ carregado, totalCatalogo, totalArranjos }) =>
        Boolean(carregado) && totalCatalogo > 0 && totalArranjos >= 0
    );
  });

  it('podeCorrigirPaginacao: remover `carregado` é detectado', () => {
    assertMutanteMorre(
      'sem carregado',
      podeCorrigirPaginacao,
      ({ totalCatalogo, totalArranjos, selecaoDeArranjoDefinida }) =>
        totalCatalogo > 0 && (totalArranjos > 0 || Boolean(selecaoDeArranjoDefinida))
    );
  });

  it('podeCorrigirPaginacao: remover `totalCatalogo > 0` é detectado', () => {
    assertMutanteMorre(
      'sem totalCatalogo',
      podeCorrigirPaginacao,
      ({ carregado, totalArranjos, selecaoDeArranjoDefinida }) =>
        Boolean(carregado) && (totalArranjos > 0 || Boolean(selecaoDeArranjoDefinida))
    );
  });

  it('podeCorrigirPaginacao: derrubar a disjunção para só `totalArranjos > 0` é detectado (voltaria a deixar `?arranjo=&pagina=999` preso)', () => {
    assertMutanteMorre(
      'sem selecaoDeArranjoDefinida',
      podeCorrigirPaginacao,
      ({ carregado, totalCatalogo, totalArranjos }) =>
        Boolean(carregado) && totalCatalogo > 0 && totalArranjos > 0
    );
  });

  it('podeCorrigirPaginacao: derrubar a disjunção para só `selecaoDeArranjoDefinida` é detectado', () => {
    assertMutanteMorre(
      'sem totalArranjos',
      podeCorrigirPaginacao,
      ({ carregado, totalCatalogo, selecaoDeArranjoDefinida }) =>
        Boolean(carregado) && totalCatalogo > 0 && Boolean(selecaoDeArranjoDefinida)
    );
  });

  it('podeCorrigirPaginacao: trocar a disjunção por conjunção (o afrouxamento proibido ao contrário) é detectado', () => {
    assertMutanteMorre(
      'E no lugar de OU',
      podeCorrigirPaginacao,
      ({ carregado, totalCatalogo, totalArranjos, selecaoDeArranjoDefinida }) =>
        Boolean(carregado) && totalCatalogo > 0 && totalArranjos > 0 && Boolean(selecaoDeArranjoDefinida)
    );
  });

  it('podeCorrigirPaginacao: ignorar a seleção e destrancar só com o catálogo (o "cedo demais" proibido) é detectado', () => {
    // Este é o mutante que representa exatamente o afrouxamento que a fase
    // proíbe: sem a disjunção, a trava fecharia na janela D-3.
    assertMutanteMorre(
      'só o catálogo',
      podeCorrigirPaginacao,
      ({ carregado, totalCatalogo }) => Boolean(carregado) && totalCatalogo > 0
    );
  });
});

/* ------------------------------------------------------------------ */
/* Invariantes estruturais das páginas que consomem a trava            */
/* ------------------------------------------------------------------ */

const PAGINAS = {
  home: fileURLToPath(new URL('../../routes/+page.svelte', import.meta.url)),
  biblioteca: fileURLToPath(new URL('../../routes/biblioteca/+page.svelte', import.meta.url))
};

/** @type {Record<string, string>} */
const FONTE = {};
for (const [nome, caminho] of Object.entries(PAGINAS)) {
  FONTE[nome] = readFileSync(caminho, 'utf8');
}

/**
 * Remove comentários de bloco e de linha, para que uma busca por trecho de
 * código não case com um comentário que fala sobre esse trecho.
 * @param {string} texto
 */
function semComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((linha) => !linha.trim().startsWith('//'))
    .join('\n');
}

describe('a trava é monotônica e não é um `$:` — nas duas páginas', () => {
  for (const nome of Object.keys(PAGINAS)) {
    it(`${nome}: \`resultadosProntos\` é declarada com \`let ... = false\`, nunca com \`$:\``, () => {
      const codigo = semComentarios(FONTE[nome]);
      assert.match(
        codigo,
        /let\s+resultadosProntos\s*=\s*false\s*;/,
        'a trava tem de nascer `false` no corpo de `instance()`'
      );
      assert.doesNotMatch(
        codigo,
        /\$:\s*resultadosProntos\s*=/,
        'um `$:` só é atribuído dentro de `$$.update()`, depois de `instance()` retornar — ' +
          'quem lesse a trava sincronamente veria `undefined` (a página em branco de 2026-09-01)'
      );
    });

    it(`${nome}: a trava só sobe — a declaração nasce \`false\` e toda outra escrita é \`= true\``, () => {
      // Cuidado ao mexer aqui: a versão anterior deste teste dispensava
      // QUALQUER `= false` como "a inicialização", e por isso sobrevivia a um
      // `else { resultadosProntos = false; }` — o mutante que mata a
      // monotonicidade. Agora só a escrita precedida de `let` pode ser `false`.
      const codigo = semComentarios(FONTE[nome]);
      const atribuicoes = [
        ...codigo.matchAll(/(let\s+)?\bresultadosProntos\s*=\s*(?!=)([^;\n]*)/g)
      ];

      const declaracoes = atribuicoes.filter((m) => m[1]);
      const escritas = atribuicoes.filter((m) => !m[1]);

      assert.equal(declaracoes.length, 1, 'esperava exatamente uma declaração da trava');
      assert.equal(declaracoes[0][2].trim(), 'false', 'a trava tem de nascer fechada');
      assert.ok(escritas.length > 0, 'a trava nunca é fechada — não haveria correção de `?pagina=`');

      for (const escrita of escritas) {
        assert.equal(
          escrita[2].trim(),
          'true',
          'a trava só sobe: qualquer outra atribuição a torna reversível e reabre o defeito ' +
            '(`?arranjo=&pagina=999` volta a ficar preso ao desmarcar todos os Arranjos)'
        );
      }
    });
  }
});

describe('os call sites passam exatamente as entradas que os predicados leem', () => {
  // O buraco que isto fecha: um erro de digitação numa chave
  // (`totalArranjos` → `totalArranjo`) faz `undefined > 0` valer `false`, a
  // trava nunca fecha, a correção de `?pagina=` morre em silêncio — e nenhum
  // dos três portões da fase apanha, porque `npm run build` não faz
  // type-check. Aqui as chaves do chamador são conferidas contra os nomes
  // realmente desestruturados no módulo.
  const fonteModulo = readFileSync(
    fileURLToPath(new URL('./resultadosProntos.js', import.meta.url)),
    'utf8'
  );

  /**
   * Nomes desestruturados na assinatura de uma função exportada do módulo.
   * @param {string} funcao
   */
  function parametrosDe(funcao) {
    const m = fonteModulo.match(
      new RegExp(`export function ${funcao}\\(\\s*\\{([\\s\\S]*?)\\}`)
    );
    assert.ok(m, `não achei a assinatura de ${funcao} em resultadosProntos.js`);
    return m[1]
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
  }

  /**
   * Argumentos-objeto de cada chamada da função numa página.
   * @param {string} codigo
   * @param {string} funcao
   */
  function chamadasEm(codigo, funcao) {
    const chamadas = [];
    let i = codigo.indexOf(`${funcao}({`);
    while (i !== -1) {
      const fim = codigo.indexOf('})', i);
      chamadas.push(codigo.slice(i, fim));
      i = codigo.indexOf(`${funcao}({`, i + 1);
    }
    return chamadas;
  }

  const esperado = {
    houveFiltragemReal: parametrosDe('houveFiltragemReal'),
    podeCorrigirPaginacao: parametrosDe('podeCorrigirPaginacao')
  };

  it('o módulo declara as entradas que a fase assume', () => {
    assert.deepEqual(esperado.houveFiltragemReal, [
      'carregado',
      'totalCatalogo',
      'totalArranjos'
    ]);
    assert.deepEqual(esperado.podeCorrigirPaginacao, [
      'carregado',
      'totalCatalogo',
      'totalArranjos',
      'selecaoDeArranjoDefinida'
    ]);
  });

  for (const nome of Object.keys(PAGINAS)) {
    it(`${nome}: toda chamada nomeia todas as entradas`, () => {
      const codigo = semComentarios(FONTE[nome]);
      let total = 0;
      for (const [funcao, parametros] of Object.entries(esperado)) {
        for (const chamada of chamadasEm(codigo, funcao)) {
          total += 1;
          for (const parametro of parametros) {
            assert.ok(
              new RegExp(`\\b${parametro}\\s*:`).test(chamada),
              `${funcao} em ${nome}: falta a chave \`${parametro}\` — ` +
                `uma entrada ausente vira \`undefined\` e falha em silêncio.\n${chamada}`
            );
          }
        }
      }
      assert.ok(total > 0, `${nome} não chama nenhum dos predicados`);
    });
  }

  it('a biblioteca alimenta a trava com o `temArranjo` da URL', () => {
    // É este argumento — e só ele — que distingue "vazio por transiente"
    // (janela D-3, tem de esperar) de "vazio por escolha registrada na URL"
    // (`?arranjo=`, não há o que esperar). Trocá-lo por outra coisa reabre um
    // dos dois defeitos.
    const chamadas = chamadasEm(semComentarios(FONTE.biblioteca), 'podeCorrigirPaginacao');
    assert.equal(chamadas.length, 1);
    assert.match(chamadas[0], /selecaoDeArranjoDefinida\s*:\s*estadoUrl\.temArranjo/);
  });
});

describe('ordem dos blocos reativos de /biblioteca (lida do código compilado)', () => {
  const compilado = compile(FONTE.biblioteca, {
    generate: 'dom',
    filename: PAGINAS.biblioteca
  });

  const corpoUpdate = compilado.js.code.split('$$self.$$.update = () => {')[1];
  const corpoLimpo = semComentarios(corpoUpdate || '');

  it('o componente compila sem aviso novo', () => {
    assert.ok(corpoUpdate, 'não encontrei o corpo de `$$self.$$.update`');
    const relevantes = compilado.warnings.filter(
      (w) => !String(w.code).startsWith('a11y') && w.code !== 'css-unused-selector'
    );
    assert.deepEqual(relevantes.map((w) => w.code), []);
  });

  it('a paginação é recalculada ANTES de a trava fechar, e a correção da URL vem depois das duas', () => {
    // Esta é a invariante que o navegador testaria no cenário 1: se a trava
    // fechar antes de `currentPage`, o bloco de correção compara a página nova
    // da URL contra um `currentPage` ainda preso ao `[]` transitório e apaga o
    // `?pagina=3` do deep link. A ordem aqui vem da ordem de declaração no
    // arquivo, que só desempata blocos sem aresta entre si — se alguém criar
    // uma aresta (fazer a paginação depender da trava, por exemplo), o grafo
    // reordena sem ninguém mover uma linha, e este teste falha.
    const iPaginacao = corpoLimpo.indexOf('currentPage = Math.min(');
    const iTrava = corpoLimpo.indexOf('resultadosProntos = true');
    const iCorrecao = corpoLimpo.indexOf('updateUrlParams({ pagina: currentPage })');

    assert.notEqual(iPaginacao, -1, 'não encontrei o cálculo de `currentPage` no código gerado');
    assert.notEqual(iTrava, -1, 'não encontrei o fechamento da trava no código gerado');
    assert.notEqual(iCorrecao, -1, 'não encontrei a correção de `?pagina=` no código gerado');

    assert.ok(
      iPaginacao < iTrava,
      '`currentPage` tem de ser recalculado antes de a trava fechar'
    );
    assert.ok(
      iTrava < iCorrecao,
      'a trava tem de fechar antes de o bloco que corrige `?pagina=` ser avaliado'
    );
  });

  it('o bloco que corrige `?pagina=` reage ao fechamento da trava na mesma passada', () => {
    // `$$.dirty` só é zerado depois de `$$.update()` retornar inteiro, então
    // basta que `resultadosProntos` esteja na máscara deste bloco para ele
    // rodar de novo na mesma passada em que a trava fechou.
    const blocos = corpoUpdate.split('if ($$self.$$.dirty');
    const bloco = blocos.find((b) => b.includes('updateUrlParams({ pagina: currentPage })'));
    assert.ok(bloco, 'não encontrei o bloco de correção de `?pagina=`');

    const mascara = bloco.slice(0, bloco.indexOf('{', bloco.indexOf(')')));
    for (const nome of ['resultadosProntos', 'currentPage', 'estadoUrl']) {
      assert.ok(
        mascara.includes(nome),
        `\`${nome}\` tem de estar na máscara de sujeira do bloco de correção; máscara: ${mascara.trim()}`
      );
    }
  });

  it('a trava não lê `resultadosProntos` — não há ciclo que a reative', () => {
    const blocos = corpoUpdate.split('if ($$self.$$.dirty');
    const bloco = blocos.find((b) => semComentarios(b).includes('resultadosProntos = true'));
    assert.ok(bloco, 'não encontrei o bloco da trava');
    const mascara = bloco.slice(0, bloco.indexOf('{', bloco.indexOf(')')));
    assert.ok(
      !mascara.includes('resultadosProntos'),
      'a trava não pode depender de si mesma; máscara: ' + mascara.trim()
    );
  });
});
