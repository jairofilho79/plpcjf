/**
 * Uma abertura do leitor, um pedido de rede.
 *
 * Run: node --test src/lib/pdf-reader/cargaUnicaDoLeitor.test.js
 *
 * A corrida que isto cobre: `onMount` atribui `viewer` depois de dois `await`
 * do carregamento do PDF.js; essa atribuição agenda o flush do Svelte, que roda
 * `$: if (viewer && file && file !== lastLoadedFile)` — ainda com
 * `lastLoadedFile === null` — e chama `loadDirectly(file)`. Logo a seguir o
 * próprio `onMount` chama `loadDirectly(file)` para o mesmo ficheiro. A guarda
 * de duplicados olha para `lastLoadedFile`, que só é escrito depois de o
 * `getDocument` resolver: as duas entradas passam, e o mesmo PDF é descarregado
 * duas vezes.
 *
 * `+page.svelte` não pode ser importado sob `node --test` — é um componente
 * Svelte em TypeScript, com `$app/stores` e `$lib` por todo o lado. Segue-se o
 * caminho já usado em `pdfCacheIndex.equivalencia.test.js`: lê-se o código-fonte
 * das funções e injetam-se as dependências que elas usam. O que corre aqui são
 * os bytes do componente, não uma transcrição — se alguém mexer nas guardas, ou
 * na assinatura, ou nas dependências, este teste quebra.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '../../..');
const PAGINA = path.join(RAIZ, 'src/routes/leitor/+page.svelte');
const FONTE = fs.readFileSync(PAGINA, 'utf8');

const URL_A = '/assets/05042026/Louvor A/Coro.pdf';
const URL_B = '/assets/05042026/Louvor B/Coro.pdf';

/* ------------------------------------------------------------------ */
/* Recorte e destipagem                                                */
/* ------------------------------------------------------------------ */

/**
 * Corpo de uma função declarada no `<script>` do componente, recortado por
 * contagem de chaves.
 * @param {string} assinatura
 */
function recortarFuncao(assinatura) {
  const inicio = FONTE.indexOf(assinatura);
  assert.notEqual(inicio, -1, `${assinatura} sumiu de leitor/+page.svelte`);

  const abertura = FONTE.indexOf('{', FONTE.indexOf(')', inicio));
  let profundidade = 0;
  for (let i = abertura; i < FONTE.length; i++) {
    if (FONTE[i] === '{') profundidade++;
    else if (FONTE[i] === '}') {
      profundidade--;
      if (profundidade === 0) return FONTE.slice(inicio, i + 1);
    }
  }
  assert.fail(`não consegui fechar o corpo de ${assinatura}`);
}

/**
 * As anotações de TypeScript que aparecem nas três funções recortadas. São
 * listadas uma a uma de propósito: uma regra genérica para `nome: Tipo` também
 * casaria com `{ url: sourceUrl }` e estragaria o código. Se aparecer uma
 * anotação nova, o `new Function` abaixo levanta SyntaxError e o teste falha —
 * que é o aviso certo para vir cá acrescentá-la.
 * @param {string} codigo
 */
function semTipos(codigo) {
  return codigo
    .replace(/\(window as any\)/g, '(window)')
    .replace(/ as PDFJSGetDocument \| undefined/g, '')
    .replace(/\bfunction loadDirectly\(fileUrl: string\)/g, 'function loadDirectly(fileUrl)')
    // O segundo parâmetro é opcional na expressão de propósito: assim uma
    // reversão para a assinatura antiga falha por asserção, com a mensagem que
    // diz o que se perdeu, e não por SyntaxError.
    .replace(/\bfunction load\(fileUrl: string(, recargaAutorizada = false)?\)/g,
      (_, segundo) => `function load(fileUrl${segundo ?? ''})`)
    .replace(/\bfunction setPdfUi\(state: PdfUiState, message: string \| null = null\)/g,
      'function setPdfUi(state, message = null)')
    .replace(/\((downloadErr|error|err) as any\)/g, '($1)')
    .replace(/\bcatch \(err: any\)/g, 'catch (err)');
}

/**
 * Reconstrói a função lida do componente num escopo onde todo identificador
 * livre resolve em `estado`. O corpo do `new Function` roda em modo não estrito,
 * que é o que permite o `with` — e o `with` é o que faz as atribuições a
 * `lastLoadedFile`, `cargaEmVoo` etc. caírem no objeto de estado do teste.
 *
 * @param {string} assinatura
 * @param {Record<string, any>} estado
 */
function fabricar(assinatura, estado) {
  const fonte = semTipos(recortarFuncao(assinatura));
  // eslint-disable-next-line no-new-func
  const fabrica = new Function('estado', `with (estado) { return (${fonte}); }`);
  return fabrica(estado);
}

/* ------------------------------------------------------------------ */
/* O ambiente injetado                                                 */
/* ------------------------------------------------------------------ */

/**
 * LIMITAÇÃO CONHECIDA: `catalogo` fica `false` em toda a suite. O
 * `isCatalogAsset === false` é, na produção, só o `pdfs/exemplo.pdf` e o
 * `offline-setup.pdf`; o ramo que **todo louvor real** percorre — o
 * `await import('$lib/utils/pdfValidation')` dentro do `load` — não é
 * exercitado aqui, porque um import dinâmico de `$lib` não resolve sob
 * `node --test`. O que estes testes cobrem são as guardas de entrada e saída de
 * `loadDirectly`/`load`, que são as mesmas nos dois ramos; o miolo da validação
 * fica por cobrir e está declarado no relatório da lane.
 *
 * @param {{ getDocument?: (opcoes: any) => any, online?: boolean, catalogo?: boolean, fetch?: any }} [opcoes]
 */
function montarLeitor(opcoes = {}) {
  const { online = true, catalogo = false } = opcoes;

  const registo = {
    /** @type {string[]} URLs entregues ao PDF.js — uma por descarga do PDF. */
    pedidos: /** @type {string[]} */ ([]),
    /** @type {any[]} documentos entregues ao visualizador */
    documentos: /** @type {any[]} */ ([]),
    /** @type {Array<{estado: string, mensagem: string | null}>} */
    transicoes: /** @type {Array<{estado: string, mensagem: string | null}>} */ ([]),
    /** @type {string[]} chamadas ao caminho de validação */
    validacoes: /** @type {string[]} */ ([])
  };

  const getDocumentPadrao = (/** @type {{url: string}} */ o) => ({
    promise: Promise.resolve({ numPages: 7, __url: o.url })
  });

  const getDocument = (/** @type {{url: string}} */ o) => {
    registo.pedidos.push(o.url);
    return (opcoes.getDocument ?? getDocumentPadrao)(o);
  };

  /** @type {Record<string, any>} */
  const estado = {
    // — o estado que o componente declara —
    lastLoadedFile: null,
    cargaEmVoo: null,
    geracaoDaCarga: 0,
    pdfUiState: 'idle',
    pdfUiMessage: null,
    pdfLoading: false,
    pdfError: null,
    lastPdfPathForRecovery: null,
    lastOriginalFullUrlForRecovery: null,
    lastFileUrlForRecovery: null,
    activeForcedObjectUrl: null,
    totalPages: 0,
    currentPage: 0,
    retryCount: 0,
    MAX_RETRIES: 2,
    MSG_INDISPONIVEL_OFFLINE: 'PDF não está disponível offline.',

    // — o ambiente —
    window: { __pdfjsGetDocument: getDocument, location: { origin: 'https://plpcg.com' } },
    navigator: { onLine: online },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    perfMark: () => {},
    perfMeasure: () => {},
    linkService: { setDocument: () => {} },
    viewer: { setDocument: (/** @type {any} */ d) => registo.documentos.push(d) },
    checkEffectiveConnectivity: async () => online,
    clearPdfFromSwCache: async () => {},

    // O "Buscar online" precisa destes; nenhum temporizador real, para a suite
    // não ficar presa aos 8 s do AbortController.
    fetch: opcoes.fetch,
    AbortController: class {
      constructor() {
        this.signal = {};
      }
      abort() {}
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    URL: { createObjectURL: () => 'blob:objeto-falso', revokeObjectURL: () => {} },

    resolveCanonicalPdfUrl: (/** @type {string} */ fileUrl) => ({
      pdfPath: fileUrl.replace(/^\//, ''),
      isCatalogAsset: catalogo,
      originalFullUrl: `https://plpcg.com${fileUrl}`
    }),
    resolvePdfSourceUrl: async (/** @type {string} */ url) => url
  };

  // `setPdfUi` também vem do componente: é ele que decide quando `pdfError` é
  // limpo, e é essa limpeza que produz tanto a corrida do D1 quanto o beco do D3.
  const setPdfUiReal = fabricar('function setPdfUi(', estado);
  estado.setPdfUi = (/** @type {string} */ s, /** @type {any} */ m = null) => {
    registo.transicoes.push({ estado: s, mensagem: m ?? null });
    return setPdfUiReal(s, m);
  };

  estado.load = fabricar('async function load(', estado);
  const loadDirectly = fabricar('async function loadDirectly(', estado);
  const handleForceOnlineFetch = fabricar('async function handleForceOnlineFetch(', estado);

  return { estado, registo, loadDirectly, load: estado.load, handleForceOnlineFetch };
}

/**
 * Uma promessa é considerada pendurada se não resolver dentro de `ms`. Serve
 * para as asserções de "esta chamada tem de sair sem trabalho": sem isto, a
 * regressão pendura a suite inteira em vez de a pintar de vermelho.
 *
 * @param {Promise<any>} promessa
 * @param {number} [ms]
 */
async function saiuOuPendurou(promessa, ms = 250) {
  /** @type {any} */
  let temporizador;
  const relogio = new Promise((resolve) => {
    temporizador = setTimeout(() => resolve('pendurou'), ms);
  });
  const resultado = await Promise.race([promessa.then(() => 'saiu'), relogio]);
  clearTimeout(temporizador);
  return resultado;
}

/* ------------------------------------------------------------------ */
/* D1 — um pedido de rede por abertura                                 */
/* ------------------------------------------------------------------ */

describe('D1 — a abertura pede o PDF uma vez só', () => {
  it('as duas entradas da mesma volta (onMount e bloco reativo) dão um só pedido', async () => {
    const { registo, loadDirectly, estado } = montarLeitor();

    // A ordem real: a atribuição de `viewer` agenda o flush do Svelte, que roda
    // o bloco reativo; o `onMount` chama logo a seguir. Ambas antes de qualquer
    // uma resolver.
    const doBlocoReativo = loadDirectly(URL_A);
    const doOnMount = loadDirectly(URL_A);
    await Promise.all([doBlocoReativo, doOnMount]);

    assert.deepEqual(registo.pedidos, [`https://plpcg.com${URL_A}`]);
    assert.equal(registo.documentos.length, 1, 'dois setDocument reiniciariam a página em 1');
    assert.equal(estado.lastLoadedFile, URL_A);
    assert.equal(estado.cargaEmVoo, null, 'a marca de carga em voo tem de ser levantada');
  });

  it('a ordem inversa das duas entradas dá o mesmo resultado', async () => {
    const { registo, loadDirectly } = montarLeitor();
    const primeira = loadDirectly(URL_A);
    await Promise.resolve();
    const segunda = loadDirectly(URL_A);
    await Promise.all([primeira, segunda]);
    assert.equal(registo.pedidos.length, 1);
  });

  it('a segunda entrada não mexe no estado da primeira', async () => {
    // Sem a guarda, o `setPdfUi('loading')` da segunda apagava — por um instante
    // e por cima da primeira — o `fatalError` que ela tinha acabado de pôr.
    // Offline e sem cache, era um piscar de "sem PDF, sem mensagem".
    let resolverPrimeira = (/** @type {any} */ _v) => {};
    const { registo, loadDirectly } = montarLeitor({
      getDocument: () => ({
        promise: new Promise((resolve) => {
          resolverPrimeira = resolve;
        })
      })
    });

    const primeira = loadDirectly(URL_A);
    await Promise.resolve();
    const transicoesAntes = registo.transicoes.length;

    // A segunda entrada, com a primeira ainda em voo. Sem a guarda ela fica à
    // espera do mesmo `getDocument` que nunca resolve — e um `await` cru aqui
    // penduraria `npm test` inteiro em vez de falhar.
    assert.equal(
      await saiuOuPendurou(loadDirectly(URL_A)),
      'saiu',
      'a segunda entrada tem de sair sem trabalho, não esperar pela primeira'
    );

    assert.equal(
      registo.transicoes.length,
      transicoesAntes,
      'a segunda entrada não pode produzir transição de UI nenhuma'
    );
    assert.equal(registo.pedidos.length, 1);

    resolverPrimeira({ numPages: 3 });
    await primeira;
  });

  it('um `file` novo continua a carregar — a guarda é por URL, não global', async () => {
    const { registo, loadDirectly, estado } = montarLeitor();
    await loadDirectly(URL_A);
    await loadDirectly(URL_B);

    assert.deepEqual(registo.pedidos, [
      `https://plpcg.com${URL_A}`,
      `https://plpcg.com${URL_B}`
    ]);
    assert.equal(estado.lastLoadedFile, URL_B);
  });

  it('um `file` novo em cima de uma carga ainda em voo não é engolido, e a carga velha não lhe rouba a marca', async () => {
    /** @type {Array<(v: any) => void>} */
    const resolvedores = [];
    const { registo, loadDirectly, estado } = montarLeitor({
      getDocument: () => ({ promise: new Promise((resolve) => resolvedores.push(resolve)) })
    });

    const deA = loadDirectly(URL_A);
    await Promise.resolve();
    const deB = loadDirectly(URL_B);
    await Promise.resolve();

    assert.equal(registo.pedidos.length, 2);
    assert.equal(estado.cargaEmVoo, URL_B);

    // A carga velha (A) termina depois: não pode levantar a marca de B.
    resolvedores[0]({ numPages: 1 });
    await deA;
    assert.equal(estado.cargaEmVoo, URL_B, 'quem termina não é quem pôs a marca corrente');

    resolvedores[1]({ numPages: 2 });
    await deB;
    assert.equal(estado.cargaEmVoo, null);
  });

  it('A → B → voltar a A: a carga de A que ficou para trás não liberta a marca da nova', async () => {
    // A marca é a URL, e a URL não identifica a chamada. Sem o número de série,
    // o `finally` de A#1 vê `cargaEmVoo === A` — mas essa marca é de A#2, que
    // ainda está a descarregar — e liberta-a. A janela de deduplicação reabre e
    // a abertura seguinte volta a pedir o PDF duas vezes.
    /** @type {Array<(v: any) => void>} */
    const resolvedores = [];
    const { registo, loadDirectly, estado } = montarLeitor({
      getDocument: () => ({ promise: new Promise((resolve) => resolvedores.push(resolve)) })
    });

    const a1 = loadDirectly(URL_A);
    await Promise.resolve();
    const b1 = loadDirectly(URL_B); // o utilizador navega para B
    await Promise.resolve();
    const a2 = loadDirectly(URL_A); // e volta a A, com A#1 ainda em voo
    await Promise.resolve();

    assert.equal(registo.pedidos.length, 3);
    assert.equal(estado.cargaEmVoo, URL_A, 'a marca corrente é a de A#2');

    resolvedores[0]({ numPages: 1 }); // A#1, a que ficou para trás, resolve
    await a1;
    assert.equal(
      estado.cargaEmVoo,
      URL_A,
      'A#1 não pode libertar a marca de A#2, que ainda está a descarregar'
    );

    // E a prova de que a janela continua fechada: uma quarta entrada para A —
    // o bloco reativo a disparar outra vez — não gera pedido nenhum.
    assert.equal(await saiuOuPendurou(loadDirectly(URL_A)), 'saiu');
    assert.equal(registo.pedidos.length, 3, 'a janela de deduplicação reabriu');

    resolvedores[1]({ numPages: 2 });
    resolvedores[2]({ numPages: 3 });
    await Promise.all([b1, a2]);
    assert.equal(estado.cargaEmVoo, null, 'no fim, a marca do dono corrente cai');
  });

  it('uma carga paralela que falha depois de outra ter tido êxito não refaz a validação', async () => {
    // A#1 resolve e põe o PDF no ecrã; A#2 falha e cai no `catch`. Se a
    // autorização de recarga viesse de `cargaEmVoo === fileUrl`, o `load` de A#2
    // saltava a deduplicação e recomeçava tudo por cima de um PDF já visível.
    /** @type {Array<{resolve: (v: any) => void, reject: (e: any) => void}>} */
    const controlos = [];
    const { registo, loadDirectly, estado } = montarLeitor({
      online: false,
      getDocument: () => ({
        promise: new Promise((resolve, reject) => controlos.push({ resolve, reject }))
      })
    });

    const a1 = loadDirectly(URL_A);
    await Promise.resolve();
    loadDirectly(URL_B);
    await Promise.resolve();
    const a2 = loadDirectly(URL_A);
    await Promise.resolve();

    assert.equal(registo.pedidos.length, 3);

    controlos[0].resolve({ numPages: 5 }); // A#1 tem êxito
    await a1;
    assert.equal(estado.lastLoadedFile, URL_A);
    assert.equal(estado.pdfError, null);

    controlos[2].reject(new Error('A#2 falhou')); // A#2 falha e cai no `load`
    await a2;

    assert.equal(
      registo.pedidos.length,
      3,
      'o `load` de A#2 não pode pedir o PDF outra vez por cima do que já está no ecrã'
    );
    assert.equal(estado.pdfUiState, 'idle', 'e não pode estragar o estado bom da A#1');
    assert.equal(estado.lastLoadedFile, URL_A);
  });

  it('a marca de carga em voo, sozinha, não autoriza um `load` a repetir o trabalho', async () => {
    // O caso isolado do anterior. Enquanto a autorização vinha de
    // `cargaEmVoo === fileUrl`, QUALQUER `load` desta URL saltava a deduplicação
    // durante toda a janela em que a marca estivesse posta — inclusive um cujo
    // `loadDirectly` de origem nunca teve motivo nenhum para recarregar.
    const { registo, load, estado } = montarLeitor();

    estado.lastLoadedFile = URL_A; // já carregado
    estado.cargaEmVoo = URL_A; // e com uma carga desta mesma URL em voo
    estado.pdfError = null; // sem nada errado no ecrã

    await load(URL_A); // sem autorização explícita

    assert.equal(registo.pedidos.length, 0, 'não há motivo para pedir o PDF outra vez');
    assert.equal(registo.transicoes.length, 0, 'nem para mexer no estado da UI');

    // E o contraponto: com a autorização, o mesmo `load` trabalha.
    await load(URL_A, true);
    assert.equal(registo.pedidos.length, 1);
  });

  it('um `?file=` que a resolução de URL recusa termina com mensagem, não com rejeição solta', async () => {
    // `resolveCanonicalPdfUrl` estava fora do `try` do `load`: a exceção escapava
    // pelo `catch` do `loadDirectly`, o `finally` punha `idle` e sobrava um ecrã
    // mudo mais uma rejeição não tratada na consola.
    const { loadDirectly, estado } = montarLeitor({ online: false });
    estado.resolveCanonicalPdfUrl = () => {
      throw new TypeError('Invalid URL');
    };

    await assert.doesNotReject(() => loadDirectly('/assets/%%%/Coro.pdf'));

    assert.notEqual(estado.pdfUiState, 'idle', 'terminar em `idle` é o ecrã mudo');
    assert.ok(estado.pdfError, 'sem PDF na tela, tem de haver mensagem');
    assert.equal(estado.cargaEmVoo, null);
  });

  it('uma carga que falha não tranca a URL para sempre', async () => {
    let tentativa = 0;
    const { registo, loadDirectly, estado } = montarLeitor({
      online: false,
      getDocument: () => {
        tentativa++;
        return tentativa === 1
          ? { promise: Promise.reject(new Error('rede caiu')) }
          : { promise: Promise.resolve({ numPages: 4 }) };
      }
    });

    await loadDirectly(URL_A);
    assert.equal(estado.cargaEmVoo, null, 'a marca tem de cair mesmo pelo caminho de erro');

    await loadDirectly(URL_A);
    assert.equal(estado.lastLoadedFile, URL_A, 'a segunda tentativa tem de conseguir carregar');
    assert.ok(registo.pedidos.length >= 2);
  });
});

/* ------------------------------------------------------------------ */
/* D3 — o beco sem saída                                               */
/* ------------------------------------------------------------------ */

describe('D3 — a queda para a validação não termina em ecrã mudo', () => {
  it('com `lastLoadedFile` já na URL e um erro pendente, o utilizador continua a ver uma mensagem', async () => {
    // Sem a ressalva de continuação: `loadDirectly` passa a guarda (há
    // `pdfError`), `setPdfUi('loading')` limpa o `pdfError`, o `getDocument`
    // falha, e o `load` do catch encontra `lastLoadedFile === fileUrl` com
    // `pdfError` já nulo — sai logo. O `finally` põe `idle`: visualizador
    // escondido, sem PDF e sem mensagem.
    const { registo, loadDirectly, estado } = montarLeitor({
      online: false,
      getDocument: () => ({ promise: Promise.reject(new Error('PDF corrompido')) })
    });

    estado.lastLoadedFile = URL_A;
    estado.setPdfUi('retryableError', 'erro anterior');
    registo.transicoes.length = 0;

    await loadDirectly(URL_A);

    assert.notEqual(estado.pdfUiState, 'idle', 'terminar em `idle` é exatamente o beco sem saída');
    assert.ok(estado.pdfError, 'sem PDF na tela, tem de haver mensagem');
    assert.equal(estado.pdfUiState, 'retryableError');
    assert.equal(estado.cargaEmVoo, null);
  });

  it('a guarda de duplicados continua a valer para quem não é continuação', async () => {
    // O caminho normal: já carregado, sem erro, nada a fazer.
    const { registo, loadDirectly, load } = montarLeitor();
    await loadDirectly(URL_A);
    assert.equal(registo.pedidos.length, 1);

    await loadDirectly(URL_A);
    await load(URL_A);
    assert.equal(registo.pedidos.length, 1, 'nem `loadDirectly` nem `load` podem repedir');
  });
});

/* ------------------------------------------------------------------ */
/* O "Buscar online" tem de ficar de pé                                */
/* ------------------------------------------------------------------ */

describe('o "Buscar online" não se desfaz a si próprio', () => {
  it('depois de uma busca manual bem-sucedida, o bloco reativo não manda recarregar', async () => {
    // `lastLoadedFile` ficava com a URL **completa**, que nunca é igual ao
    // `?file=` cru. O bloco reativo `$: if (viewer && file && file !== lastLoadedFile)`
    // reavaliava, via diferença onde não havia nenhuma, e mandava o `loadDirectly`
    // refazer o pedido que tinha acabado de falhar — desfazendo, segundos depois,
    // a busca que o utilizador pediu.
    const { estado, registo, loadDirectly, handleForceOnlineFetch } = montarLeitor({
      online: true,
      // A abertura normal falha; só o blob trazido pela busca manual abre.
      getDocument: (/** @type {{url: string}} */ o) =>
        o.url.startsWith('blob:')
          ? { promise: Promise.resolve({ numPages: 7 }) }
          : { promise: Promise.reject(new Error('nem cache nem rede')) },
      fetch: async () => ({
        ok: true,
        status: 200,
        blob: async () => ({ size: 1234 })
      })
    });

    // Primeiro a abertura falha — é o que faz aparecer o botão.
    await loadDirectly(URL_A);
    assert.ok(estado.pdfError, 'sem erro não haveria botão "Buscar online"');

    // O utilizador carrega no botão, e desta vez o PDF vem.
    await handleForceOnlineFetch();
    assert.equal(estado.pdfUiState, 'idle');
    assert.equal(estado.totalPages, 7);

    const pedidosDepoisDaBusca = registo.pedidos.length;

    // A condição do bloco reativo, tal como está no ficheiro. Se ela for
    // verdadeira aqui, o leitor recarrega sozinho e deita fora a busca manual.
    assert.equal(
      estado.lastLoadedFile,
      URL_A,
      '`lastLoadedFile` tem de ficar com o `?file=` cru, que é o que o bloco reativo compara'
    );

    // E a confirmação por execução: a entrada que o bloco reativo faria sai sem
    // trabalho.
    assert.equal(await saiuOuPendurou(loadDirectly(URL_A)), 'saiu');
    assert.equal(
      registo.pedidos.length,
      pedidosDepoisDaBusca,
      'o leitor voltou a pedir o PDF e desfez a busca manual'
    );
  });
});

/* ------------------------------------------------------------------ */
/* Invariantes estruturais do componente                               */
/* ------------------------------------------------------------------ */

/** @param {string} texto */
function semComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((linha) => !linha.trim().startsWith('//'))
    .join('\n');
}

describe('a fiação do componente — as duas entradas continuam a ser as mesmas', () => {
  const codigo = semComentarios(FONTE);

  it('`cargaEmVoo` nasce `null` no corpo do componente, não como `$:`', () => {
    assert.match(codigo, /let\s+cargaEmVoo(\s*:\s*string\s*\|\s*null)?\s*=\s*null\s*;/);
    assert.doesNotMatch(
      codigo,
      /\$:\s*cargaEmVoo\s*=/,
      'um `$:` só é atribuído em `$$.update()`, depois de `instance()` retornar — ' +
        'a guarda valeria `undefined` para quem a lesse durante o `onMount`'
    );
  });

  it('a marca é posta antes de qualquer `await` de `loadDirectly`', () => {
    const corpo = semComentarios(recortarFuncao('async function loadDirectly('));
    const iMarca = corpo.indexOf('cargaEmVoo = fileUrl');
    const iAwait = corpo.indexOf('await');
    assert.notEqual(iMarca, -1, 'não achei a marca de carga em voo');
    assert.notEqual(iAwait, -1);
    assert.ok(
      iMarca < iAwait,
      'entre a leitura da guarda e a escrita da marca não pode haver await — ' +
        'é essa janela que deixava as duas entradas passarem'
    );
  });

  it('as duas entradas do leitor continuam a passar por `loadDirectly`', () => {
    assert.match(codigo, /await loadDirectly\(file\);/, 'a entrada do onMount');
    assert.match(
      codigo,
      /\$:\s*if\s*\(viewer\s*&&\s*file\s*&&\s*file\s*!==\s*lastLoadedFile\)/,
      'a entrada do bloco reativo'
    );
  });

  it('o ficheiro tem exatamente três `getDocument` — nenhum pedido novo entrou no caminho de abertura', () => {
    // Dois no caminho de abertura (`loadDirectly` e o `load` de recurso) e um no
    // "Buscar online" manual. Um quarto é pedido novo, e tem de acender luz.
    const chamadas = [...codigo.matchAll(/getDocument\(\{/g)];
    assert.equal(chamadas.length, 3, 'loadDirectly, load e o "buscar online" manual');
  });

  it('a marca é libertada por número de série, nunca por comparação de URL', () => {
    const corpo = semComentarios(recortarFuncao('async function loadDirectly('));
    assert.match(
      corpo,
      /if \(geracaoDaCarga === geracao\) cargaEmVoo = null;/,
      'a URL não identifica a chamada: duas cargas do mesmo ficheiro coexistem'
    );
    assert.doesNotMatch(corpo, /if \(cargaEmVoo === fileUrl\) cargaEmVoo = null;/);
  });

  it('`load` não decide a recarga olhando para `cargaEmVoo`', () => {
    // Enquanto a marca estivesse posta, QUALQUER `load` da mesma URL saltava a
    // deduplicação — inclusive o de uma carga paralela que já não interessa.
    const corpo = semComentarios(recortarFuncao('async function load('));
    assert.doesNotMatch(corpo, /cargaEmVoo/);
    assert.match(corpo, /if \(!recargaAutorizada && lastLoadedFile === fileUrl && !pdfError\) return;/);
  });

  it('`resolveCanonicalPdfUrl` do `load` está dentro do `try`', () => {
    const corpo = semComentarios(recortarFuncao('async function load('));
    const iTry = corpo.indexOf('try {');
    const iResolve = corpo.indexOf('resolveCanonicalPdfUrl(fileUrl)');
    assert.notEqual(iResolve, -1);
    assert.ok(
      iTry !== -1 && iTry < iResolve,
      'fora do `try`, um `?file=` inválido escapa e deixa o ecrã mudo'
    );
  });
});
