/**
 * `generatePdfIndex` cede por relógio, e o índice continua exatamente o mesmo.
 *
 * Run: node --test src/lib/utils/pdfIndexCedencia.test.js
 *
 * `pdfIndex.js` não pode ser importado sob `node --test`: arrasta
 * `$lib/utils/swRegistration`, que por sua vez arrasta `$app/environment`.
 * Segue-se aqui o mesmo caminho de `pdfCacheIndex.equivalencia.test.js` — lê-se
 * o código-fonte da função e injetam-se as dependências que ela usa. Se a
 * assinatura ou as dependências de `generatePdfIndex` mudarem, este teste
 * quebra, e é o que se quer: a equivalência tem de ser reconferida.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PdfPathManager from '../offline/utils/PdfPathManager.js';
import { getPdfRelPath } from './pathUtils.js';
import { buildPdfCacheIndex } from './pdfCacheIndex.js';
import { criarCedente } from '../offline/stats/yieldScheduler.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '../../..');
const ARQUIVO = path.join(AQUI, 'pdfIndex.js');
const FONTE = fs.readFileSync(ARQUIVO, 'utf8');
const ORIGEM = 'https://plpcg.com';

/**
 * Corpo de uma função de nível superior, recortado do arquivo por contagem de
 * chaves — ignorando chaves dentro de strings e comentários teria custado um
 * parser; nenhuma das funções aqui tem chave desbalanceada em literal.
 * @param {string} fonte
 * @param {string} assinatura
 */
function recortarFuncao(fonte, assinatura) {
  const inicio = fonte.indexOf(assinatura);
  assert.notEqual(inicio, -1, `${assinatura} sumiu de pdfIndex.js`);

  const abertura = fonte.indexOf('{', inicio);
  let profundidade = 0;
  for (let i = abertura; i < fonte.length; i++) {
    if (fonte[i] === '{') profundidade++;
    else if (fonte[i] === '}') {
      profundidade--;
      if (profundidade === 0) return fonte.slice(inicio, i + 1);
    }
  }
  assert.fail(`não consegui fechar o corpo de ${assinatura}`);
}

const FONTE_GENERATE = recortarFuncao(FONTE, 'export async function generatePdfIndex').replace(
  /^export\s+/,
  ''
);

/**
 * Remove comentários, para que uma busca por trecho de código não case com um
 * comentário que fala sobre esse trecho.
 * @param {string} texto
 */
function semComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((linha) => !linha.trim().startsWith('//'))
    .join('\n');
}

/**
 * Reconstrói a função lida do arquivo dentro de um escopo onde os identificadores
 * livres são exatamente `deps`. O corpo do `new Function` roda em modo não
 * estrito, que é o que permite o `with`.
 *
 * @param {Record<string, any>} deps
 * @returns {(louvores: any[]) => Promise<Map<string, boolean>>}
 */
function fabricarGenerate(deps) {
  // eslint-disable-next-line no-new-func
  const fabrica = new Function('deps', `with (deps) { return (${FONTE_GENERATE}); }`);
  return fabrica(deps);
}

/**
 * O laço de hoje, transcrito antes da troca: 93 chunks de 50 e uma espera
 * temporizada entre eles. Serve de oráculo — é o "índice de hoje" que a versão
 * nova tem de reproduzir chave a chave, valor a valor e na mesma ordem.
 *
 * @param {any[]} louvores
 * @param {{has: (p: string) => boolean}} cacheIndex
 */
async function indiceDoLacoAntigo(louvores, cacheIndex) {
  const index = new Map();
  const CHUNK_SIZE = 50;
  const total = louvores.length;

  const processChunk = (/** @type {any[]} */ chunk) => {
    for (const louvor of chunk) {
      if (!louvor.pdfId) continue;
      const pdfPath = getPdfRelPath(louvor);
      if (!pdfPath) {
        index.set(louvor.pdfId, false);
        continue;
      }
      index.set(louvor.pdfId, cacheIndex.has(pdfPath));
    }
  };

  for (let i = 0; i < total; i += CHUNK_SIZE) {
    processChunk(louvores.slice(i, i + CHUNK_SIZE));
    if (i + CHUNK_SIZE < total) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return index;
}

/** @param {string} caminho */
const louvorDe = (caminho) => ({
  pdfId: Buffer.from(caminho, 'utf8').toString('base64'),
  categoria: 'Cifra'
});

/** A chave que os escritores do cache gravam. */
const chave = (/** @type {string} */ p) => PdfPathManager.createRequestUrl(p, ORIGEM);

/** Caminhos versionados do acervo real, cobrindo as classes perigosas. */
function caminhosDaFixture() {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(AQUI, 'fixtures/caminhos-acervo.json'), 'utf8')
  );
  return /** @type {string[]} */ (Object.values(fixture.grupos).flat());
}

const CAMINHO_MANIFESTO = path.join(RAIZ, 'louvores-manifest.json');

/** Os 4629 caminhos reais, quando o manifesto (não versionado) está presente. */
function caminhosDoManifesto() {
  if (!fs.existsSync(CAMINHO_MANIFESTO)) return null;
  const dados = JSON.parse(fs.readFileSync(CAMINHO_MANIFESTO, 'utf8'));
  return /** @type {string[]} */ (dados.map((/** @type {{pdfId: string}} */ l) => {
    let p = Buffer.from(l.pdfId, 'base64').toString('utf8').replace(/^\/+/, '').trim();
    if (!p.toLowerCase().startsWith('assets/')) p = `assets/${p}`;
    return p;
  }));
}

/** Lixo que a lista real carrega e que os dois laços têm de saltar igual. */
const SUJEIRA = [
  {},
  { pdfId: null },
  { pdfId: '' },
  { pdfId: 42 },
  { pdfId: '!!! isto não é base64 !!!' },
  { categoria: 'Cifra' }
];

/**
 * Monta o `deps` do sandbox. `cedenteFalso` permite contar cedências sem esperar
 * por nenhuma delas.
 *
 * @param {{cachedPdfs: any[], criarCedente?: any, swPronto?: boolean}} opcoes
 */
function depsCom({ cachedPdfs, criarCedente: cedente, swPronto = true }) {
  const registo = { cedencias: 0, cedentesCriados: 0 };
  return {
    registo,
    deps: {
      waitForServiceWorker: async () => swPronto,
      getCachedPDFsFast: async () => cachedPdfs,
      debugLog: () => {},
      buildPdfCacheIndex,
      PdfPathManager,
      getPdfRelPath,
      criarCedente:
        cedente ??
        ((/** @type {any} */ opcoes) => {
          registo.cedentesCriados++;
          const real = criarCedente(opcoes);
          return {
            talvezCeder: () => {
              registo.cedencias++;
              return real.talvezCeder();
            }
          };
        })
    }
  };
}

describe('D2 — o índice não muda quando a cedência muda', () => {
  const caminhos = caminhosDaFixture();
  const louvores = [...caminhos.map(louvorDe), ...SUJEIRA];

  /**
   * @param {string[]} cachedPdfs
   */
  async function compararComOAntigo(cachedPdfs) {
    const { deps } = depsCom({ cachedPdfs });
    const novo = await fabricarGenerate(deps)(louvores);

    const cacheIndex = buildPdfCacheIndex(cachedPdfs, {
      normalize: (/** @type {string} */ p) => PdfPathManager.normalizeForStorage(p)
    });
    const antigo = await indiceDoLacoAntigo(louvores, cacheIndex);

    assert.deepEqual([...novo.entries()], [...antigo.entries()]);
    return novo;
  }

  it('cache vazio: mesmas chaves, mesmos valores, mesma ordem', async () => {
    const indice = await compararComOAntigo([]);
    assert.ok(indice.size > 0);
    assert.equal([...indice.values()].every((v) => v === false), true);
  });

  it('cache completo: mesmas chaves, mesmos valores, mesma ordem', async () => {
    const indice = await compararComOAntigo(caminhos.map(chave));
    assert.equal([...indice.values()].filter((v) => v === true).length, caminhos.length);
  });

  it('cache parcial (um em cada três): mesmas chaves, mesmos valores, mesma ordem', async () => {
    await compararComOAntigo(caminhos.filter((_, i) => i % 3 === 0).map(chave));
  });

  it('o acervo inteiro, quando o manifesto está presente', async (t) => {
    const reais = caminhosDoManifesto();
    if (!reais) {
      // O manifesto não é versionado. Saltar é honesto; a fixture acima já
      // cobre as classes perigosas de caminho.
      t.skip('louvores-manifest.json ausente');
      return;
    }

    const cachedPdfs = reais.filter((_, i) => i % 2 === 0).map(chave);
    const todos = reais.map(louvorDe);
    const { deps } = depsCom({ cachedPdfs });
    const novo = await fabricarGenerate(deps)(todos);

    const cacheIndex = buildPdfCacheIndex(cachedPdfs, {
      normalize: (/** @type {string} */ p) => PdfPathManager.normalizeForStorage(p)
    });
    const antigo = await indiceDoLacoAntigo(todos, cacheIndex);
    assert.deepEqual([...novo.entries()], [...antigo.entries()]);
  });
});

describe('D2 — a cedência é por relógio, não por chunk temporizado', () => {
  const caminhos = caminhosDaFixture();
  const louvores = caminhos.map(louvorDe);

  it('a função não agenda mais nada por temporizador', () => {
    // Sem os comentários: o comentário que explica a troca cita, de propósito,
    // os dois nomes que o código não pode mais conter.
    assert.doesNotMatch(
      semComentarios(FONTE_GENERATE),
      /requestIdleCallback|setTimeout/,
      'um `setTimeout` aninhado é travado em 1000 ms por chunk em aba não visível — ' +
        'era a patologia das 93 cedências'
    );
  });

  it('usa o cedente partilhado, importado por caminho relativo', () => {
    assert.match(
      FONTE,
      /import\s*\{\s*criarCedente\s*\}\s*from\s*'\.\.\/offline\/stats\/yieldScheduler\.js'/,
      'o cedente tem de vir do módulo já revisto, e por caminho relativo'
    );
  });

  it('cria um cedente por varredura e consulta-o uma vez por louvor', async () => {
    const { deps, registo } = depsCom({ cachedPdfs: [] });
    await fabricarGenerate(deps)(louvores);

    assert.equal(registo.cedentesCriados, 1, 'um cedente por varredura, não um por chunk');
    assert.equal(
      registo.cedencias,
      louvores.length,
      'a consulta é por louvor — é ela que dá granularidade sem custo'
    );
  });

  it('sem orçamento estourado, nenhuma cedência chega a agendar coisa nenhuma', async () => {
    let agendamentos = 0;
    // Relógio parado: `talvezCeder` nunca ultrapassa o orçamento e devolve
    // sempre a promessa já resolvida. É o caso comum — milhares de microtasks,
    // zero macrotarefas.
    const cedenteImovel = () =>
      criarCedente({
        agora: () => 0,
        agendar: (/** @type {() => void} */ cb) => {
          agendamentos++;
          cb();
        }
      });

    const { deps } = depsCom({ cachedPdfs: [], criarCedente: cedenteImovel });
    await fabricarGenerate(deps)(louvores);
    assert.equal(agendamentos, 0);
  });

  it('com o relógio a correr, cede de verdade e o índice sai igual', async () => {
    let agendamentos = 0;
    let tique = 0;
    // Cada leitura do relógio avança 100 ms: o orçamento de 16 ms estoura em
    // todas as consultas, e toda cedência vira agendamento real.
    const cedenteApressado = () =>
      criarCedente({
        agora: () => (tique += 100),
        agendar: (/** @type {() => void} */ cb) => {
          agendamentos++;
          setImmediate(cb);
        }
      });

    const cachedPdfs = caminhos.map(chave);
    const { deps } = depsCom({ cachedPdfs, criarCedente: cedenteApressado });
    const novo = await fabricarGenerate(deps)(louvores);

    assert.ok(agendamentos > 0, 'nenhuma cedência real aconteceu — o teste não provou nada');

    const cacheIndex = buildPdfCacheIndex(cachedPdfs, {
      normalize: (/** @type {string} */ p) => PdfPathManager.normalizeForStorage(p)
    });
    assert.deepEqual(
      [...novo.entries()],
      [...(await indiceDoLacoAntigo(louvores, cacheIndex)).entries()]
    );
  });
});

describe('D2 — o resto do contrato de generatePdfIndex fica de pé', () => {
  it('lista vazia devolve mapa vazio sem tocar no Service Worker', async () => {
    const { deps } = depsCom({ cachedPdfs: [] });
    let tocou = false;
    deps.waitForServiceWorker = async () => {
      tocou = true;
      return true;
    };
    const indice = await fabricarGenerate(deps)([]);
    assert.equal(indice.size, 0);
    assert.equal(tocou, false);
  });

  it('Service Worker que não fica pronto devolve mapa vazio', async () => {
    const { deps } = depsCom({ cachedPdfs: [], swPronto: false });
    const indice = await fabricarGenerate(deps)([louvorDe('assets/x/Coro.pdf')]);
    assert.equal(indice.size, 0);
  });

  it('falha ao ler o cache devolve o que já tiver, sem lançar', async () => {
    const { deps } = depsCom({ cachedPdfs: [] });
    deps.getCachedPDFsFast = async () => {
      throw new Error('cache inacessível');
    };
    const indice = await fabricarGenerate(deps)([louvorDe('assets/x/Coro.pdf')]);
    assert.equal(indice.size, 0);
  });
});
