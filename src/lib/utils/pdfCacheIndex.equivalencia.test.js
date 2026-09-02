/**
 * O caminho novo da varredura conta exatamente o que `findMissingPdfs` conta.
 *
 * Este é o teste que autoriza `StatsCalculator` a parar de chamar
 * `findMissingPdfs`: se os dois lados divergirem em um único louvor, o painel
 * de estatísticas passa a mentir.
 *
 * Run: node --test src/lib/utils/pdfCacheIndex.equivalencia.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PdfPathManager from '../offline/utils/PdfPathManager.js';
import { getPdfRelPath } from './pathUtils.js';
import { buildPdfCacheIndex, toComparablePath, louvorFaltaNoIndice } from './pdfCacheIndex.js';
import { decodeUrlUtf8Multiple } from './urlEncoding.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '../../..');
const ORIGEM = 'https://plpcg.com';

/**
 * `findMissingPdfs` real, tirada do arquivo, sem importar o arquivo.
 *
 * `pdfValidation.js` é da Lane A e não pode ser editado; importá-lo sob
 * `node --test` também é impossível (arrasta `$lib/utils/swRegistration`,
 * `CompositeValidator`, `CacheStorageAdapter`). Transcrever a função à mão
 * daria um teste tautológico — provaria que a minha cópia bate com a minha
 * cópia. Então lê-se o código-fonte e injetam-se as três dependências que ele
 * usa. Se a Lane A mudar a assinatura ou as dependências desta função, este
 * teste quebra — e é exatamente o que se quer que aconteça: a equivalência
 * tem de ser reconferida.
 *
 * @returns {(louvores: any[], cachedPdfs: any) => any[]}
 */
function findMissingPdfsDoFonte() {
  const arquivo = path.join(RAIZ, 'src/lib/utils/pdfValidation.js');
  const fonte = fs.readFileSync(arquivo, 'utf8');

  const inicio = fonte.indexOf('export function findMissingPdfs');
  assert.notEqual(inicio, -1, 'findMissingPdfs sumiu de pdfValidation.js');

  const abertura = fonte.indexOf('{', inicio);
  let profundidade = 0;
  let fim = -1;
  for (let i = abertura; i < fonte.length; i++) {
    if (fonte[i] === '{') profundidade++;
    else if (fonte[i] === '}') {
      profundidade--;
      if (profundidade === 0) {
        fim = i + 1;
        break;
      }
    }
  }
  assert.notEqual(fim, -1, 'não achei o fecho de findMissingPdfs');

  const corpo = fonte.slice(inicio, fim).replace('export function', 'function');
  assert.equal(corpo.includes('return missing;'), true, 'o corpo extraído não parece o certo');

  const fabricar = new Function(
    'getPdfRelPath',
    'PdfPathManager',
    'buildPdfCacheIndex',
    'console',
    `${corpo}\nreturn findMissingPdfs;`
  );

  // console silenciado: a função loga um warn por chamada com faltantes.
  return fabricar(getPdfRelPath, PdfPathManager, buildPdfCacheIndex, { warn() {} });
}

const findMissingPdfs = findMissingPdfsDoFonte();

/** O caminho novo, como `StatsCalculator` o executa: índice uma vez, predicado por louvor. */
function contarFaltantesPeloIndice(/** @type {any[]} */ louvores, /** @type {string[]} */ cachedPdfs) {
  const indice = buildPdfCacheIndex(cachedPdfs, { normalize: PdfPathManager.normalizeForStorage });
  let faltantes = 0;
  for (const louvor of louvores) {
    if (louvorFaltaNoIndice(louvor, indice)) faltantes++;
  }
  return faltantes;
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
  return Object.values(fixture.grupos).flat();
}

const CAMINHO_MANIFESTO = path.join(RAIZ, 'louvores-manifest.json');

/** Os 4629 caminhos reais, quando o manifesto (não versionado) está presente. */
function caminhosDoManifesto() {
  if (!fs.existsSync(CAMINHO_MANIFESTO)) return null;
  const dados = JSON.parse(fs.readFileSync(CAMINHO_MANIFESTO, 'utf8'));
  return dados.map((/** @type {{pdfId: string}} */ l) => {
    let p = Buffer.from(l.pdfId, 'base64').toString('utf8').replace(/^\/+/, '').trim();
    if (!p.toLowerCase().startsWith('assets/')) p = `assets/${p}`;
    return p;
  });
}

describe('B3 — o caminho novo conta o mesmo que findMissingPdfs', () => {
  const caminhos = caminhosDaFixture();
  const louvores = caminhos.map(louvorDe);

  /** Lixo que a lista real carrega e que os dois lados têm de saltar igual. */
  const sujeira = [
    {},
    { pdfId: null },
    { pdfId: '' },
    { pdfId: 42 },
    { pdfId: '!!! isto não é base64 !!!' },
    { categoria: 'Cifra' }
  ];

  it('cache vazio: todos faltam, dos dois lados', () => {
    assert.equal(contarFaltantesPeloIndice(louvores, []), findMissingPdfs(louvores, []).length);
  });

  it('cache completo: nenhum falta, dos dois lados', () => {
    const cache = caminhos.map(chave);
    assert.equal(contarFaltantesPeloIndice(louvores, cache), findMissingPdfs(louvores, cache).length);
    assert.equal(contarFaltantesPeloIndice(louvores, cache), 0);
  });

  it('cache parcial: o mesmo número dos dois lados, em cada fatia', () => {
    for (let corte = 0; corte <= caminhos.length; corte++) {
      const cache = caminhos.slice(0, corte).map(chave);
      assert.equal(
        contarFaltantesPeloIndice(louvores, cache),
        findMissingPdfs(louvores, cache).length,
        `divergiu com ${corte} PDFs em cache`
      );
    }
  });

  it('os 8 caminhos NFD do acervo continuam a casar dos dois lados', () => {
    // #22.2: a chave gravada está em NFC; getPdfRelPath devolve o cru, NFD.
    // Sem a mesma normalização nos dois lados, estes 8 ficariam "faltando" para
    // sempre — e a divergência apareceria só aqui.
    const nfd = caminhos.filter((/** @type {string} */ p) => p !== p.normalize('NFC'));
    assert.equal(nfd.length > 0, true, 'a fixture perdeu os caminhos NFD');
    const nfdLouvores = nfd.map(louvorDe);
    const cache = nfd.map((/** @type {string} */ p) => chave(p.normalize('NFC')));
    assert.equal(
      contarFaltantesPeloIndice(nfdLouvores, cache),
      findMissingPdfs(nfdLouvores, cache).length
    );
    assert.equal(contarFaltantesPeloIndice(nfdLouvores, cache), 0);
  });

  it('louvores sem pdfId ou com pdfId quebrado são saltados igual pelos dois', () => {
    const mistura = [...louvores.slice(0, 5), ...sujeira];
    const cache = caminhos.slice(0, 2).map(chave);
    assert.equal(
      contarFaltantesPeloIndice(mistura, cache),
      findMissingPdfs(mistura, cache).length
    );
  });

  it('lista de louvores vazia: zero dos dois lados', () => {
    assert.equal(contarFaltantesPeloIndice([], ['x']), findMissingPdfs([], ['x']).length);
  });

  it('homônimos em pastas diferentes: nenhum dos dois aceita o falso positivo', () => {
    // 1036 louvores do acervo se chamam `Cifra I.pdf`.
    const a = 'assets/Louvores Coletânea CIAs/001 - Meu Deus, meu pai/Cifra I.pdf';
    const b = 'assets/Louvores Coletânea CIAs/002 - Pai, estou a te clamar/Cifra I.pdf';
    const dois = [louvorDe(a), louvorDe(b)];
    const cache = [chave(a)];
    assert.equal(contarFaltantesPeloIndice(dois, cache), findMissingPdfs(dois, cache).length);
    assert.equal(contarFaltantesPeloIndice(dois, cache), 1);
  });

  it('sobre os 4629 caminhos reais do acervo, os dois contam igual', (t) => {
    const reais = caminhosDoManifesto();
    if (!reais) {
      // Salto explícito, não `return`. Este é o teste que o brief chamou o mais
      // importante do lote, e o manifesto não é versionado: se a ausência
      // passasse por verde, uma corrida noutra worktree daria a equivalência
      // por provada sem ter afirmado nada.
      t.skip(`${CAMINHO_MANIFESTO} não existe (não é versionado). Copie-o para a raiz do repo para correr este teste.`);
      return;
    }
    const todos = reais.map(louvorDe);
    for (const fatia of [0, 1, 500, 2314, reais.length - 1, reais.length]) {
      const cache = reais.slice(0, fatia).map(chave);
      assert.equal(
        contarFaltantesPeloIndice(todos, cache),
        findMissingPdfs(todos, cache).length,
        `divergiu com ${fatia} de ${reais.length} em cache`
      );
    }
  });

  it('a única divergência conhecida é o ramo cachedPdfs == null, inalcançável daqui', () => {
    // `findMissingPdfs(louvores, null)` devolve todo louvor com pdfId, inclusive
    // os de pdfId quebrado (sem caminho). O caminho novo trata null como cache
    // vazio e salta os sem caminho. StatsCalculator nunca passa null — a lista
    // já é lida com `.length` antes e depois — mas fica registado.
    const mistura = [...louvores.slice(0, 3), { pdfId: '!!! quebrado !!!' }];
    assert.equal(findMissingPdfs(mistura, null).length, 4);
    assert.equal(contarFaltantesPeloIndice(mistura, /** @type {any} */ (null)), 3);
  });
});

describe('B4 — toComparablePath deixa de lançar em caminho relativo', () => {
  /**
   * Conta construções de URL enquanto roda `corpo`.
   * @param {() => void} corpo
   */
  function contarURLs(corpo) {
    const Original = globalThis.URL;
    let construcoes = 0;
    class URLContada extends Original {
      /** @param {...any} args */
      constructor(...args) {
        construcoes++;
        // @ts-ignore - repasse cru
        super(...args);
      }
    }
    globalThis.URL = /** @type {any} */ (URLContada);
    try {
      corpo();
    } finally {
      globalThis.URL = Original;
    }
    return construcoes;
  }

  const relativos = [
    'assets/ColAdultos/001.pdf',
    '/assets/ColAdultos/001.pdf',
    'assets/PES/Alto preço - CIFRA.pdf',
    'assets/30102025/Sobe aqui [26-07-2025] - Coro.pdf'
  ];

  it('não constrói nenhuma URL para caminho relativo', () => {
    const construcoes = contarURLs(() => {
      for (const p of relativos) toComparablePath(p);
    });
    assert.equal(construcoes, 0);
  });

  it('continua a construir a URL quando a string tem esquema', () => {
    const construcoes = contarURLs(() => {
      toComparablePath('https://plpcg.com/assets/ColAdultos/001.pdf');
    });
    assert.equal(construcoes, 1);
  });

  it('o resultado é idêntico ao do caminho antigo, sobre a fixture inteira', () => {
    // Transcrição verbatim de toComparablePath anterior a B4 — o try sem guarda
    // de esquema —, para comparar saída a saída.
    const antigo = (/** @type {string} */ url) => {
      if (!url || typeof url !== 'string') return '';
      let pathname = url;
      try {
        pathname = new URL(url).pathname;
      } catch {
        const match = url.match(/https?:\/\/[^/]+(\/.*)/);
        if (match) pathname = match[1];
      }
      pathname = pathname.replace(/^\/+/, '');
      if (!pathname) return '';
      try {
        return decodeUrlUtf8Multiple(pathname, 3);
      } catch {
        return pathname;
      }
    };

    const entradas = [
      ...caminhosDaFixture(),
      ...caminhosDaFixture().map((/** @type {string} */ p) => `/${p}`),
      ...caminhosDaFixture().map(chave),
      'https://plpcg.com/assets/Cole%C3%A2nea/Cifra.pdf',
      '/assets/Cole%25C3%25A2nea/Cifra.pdf',
      'blob:https://plpcg.com/abc-123',
      'file:///tmp/x.pdf',
      '//plpcg.com/assets/x.pdf',
      '',
      '/'
    ];

    for (const entrada of entradas) {
      assert.equal(toComparablePath(entrada), antigo(entrada), `divergiu em: ${entrada}`);
    }
  });

  it('o índice construído sobre os 4629 caminhos reais tem o mesmo tamanho', (t) => {
    const reais = caminhosDoManifesto();
    if (!reais) {
      t.skip(`${CAMINHO_MANIFESTO} não existe (não é versionado). Copie-o para a raiz do repo para correr este teste.`);
      return;
    }
    const indice = buildPdfCacheIndex(reais.map(chave), {
      normalize: PdfPathManager.normalizeForStorage
    });
    assert.equal(indice.size, new Set(reais.map(PdfPathManager.normalizeForStorage)).size);
  });
});
