/**
 * resolvePdfKey — resolução de chave de PDF no R2. Run:
 *   node --test src/lib/server/pdfKeyResolution.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePdfKey } from './pdfKeyResolution.js';
import PdfPathManager from '../offline/utils/PdfPathManager.js';
import { getPdfRelPath } from '../utils/pathUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Raiz do repo: src/lib/server/ -> três níveis acima.
const MANIFEST_PATH = path.resolve(__dirname, '../../../louvores-manifest.json');
const ORIGEM = 'https://plpcg.com';

/**
 * Bucket R2 simulado: mesmo contrato get/list do binding real, guardado em
 * memória. `list` reproduz o comportamento real — prefixo é byte a byte,
 * sem normalização nenhuma.
 * @param {string[]} keys
 */
function criarBucketSimulado(keys) {
  const set = new Set(keys);
  return {
    /** @param {string} key */
    async get(key) {
      return set.has(key) ? { body: 'conteudo', httpEtag: '"etag"' } : null;
    },
    /** @param {{ prefix: string }} opts */
    async list({ prefix }) {
      return { objects: keys.filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
    }
  };
}

describe('resolvePdfKey — casos unitários', () => {
  it('acerta de primeira quando a chave pedida já é a chave real', async () => {
    const bucket = criarBucketSimulado(['assets/ColAdultos/001.pdf']);
    const resolved = await resolvePdfKey('/assets/ColAdultos/001.pdf', bucket);
    assert.equal(resolved?.key, 'assets/ColAdultos/001.pdf');
  });

  it('decodifica percent-encoding antes do GET', async () => {
    const bucket = criarBucketSimulado(['assets/Col Adultos/001.pdf']);
    const resolved = await resolvePdfKey('/assets/Col%20Adultos/001.pdf', bucket);
    assert.equal(resolved?.key, 'assets/Col Adultos/001.pdf');
  });

  it('resolve pedido em NFC quando a chave real está em NFD (achado C2)', async () => {
    const nfc = 'assets/05042026/Tabernáculo/Coro.pdf'.normalize('NFC');
    const nfd = nfc.normalize('NFD');
    assert.notEqual(nfc, nfd);

    const bucket = criarBucketSimulado([nfd]); // chave real, como gravada antes da migração
    const resolved = await resolvePdfKey(`/${encodeURI(nfc)}`, bucket); // cliente pede em NFC
    assert.equal(resolved?.key, nfd);
  });

  it('resolve pedido em NFD quando a chave real está em NFC', async () => {
    const nfc = 'assets/05042026/Tabernáculo/Coro.pdf'.normalize('NFC');
    const nfd = nfc.normalize('NFD');

    const bucket = criarBucketSimulado([nfc]);
    const resolved = await resolvePdfKey(`/${encodeURI(nfd)}`, bucket);
    assert.equal(resolved?.key, nfc);
  });

  it('cobre o caso do achado C2: acento no nome do diretório, não do arquivo', async () => {
    // Prefixo de diretório em NFC não bate com o `list` de um diretório
    // gravado em NFD — só o GET direto por NFD resolve.
    const real = 'assets/05042026/Bênção Aarônica (Bênção Apostólica)/Coro.pdf'.normalize('NFD');
    const pedido = real.normalize('NFC');
    assert.notEqual(real, pedido);

    const bucket = criarBucketSimulado([real]);
    const resolved = await resolvePdfKey(`/${encodeURI(pedido)}`, bucket);
    assert.equal(resolved?.key, real);
  });

  it('cai no fallback por prefixo quando só a caixa do arquivo difere (diretório idêntico)', async () => {
    // O diretório precisa ser byte-idêntico dos dois lados: `list({ prefix })`
    // é um prefixo cru (achado C2) — só o nome do arquivo pode divergir aqui.
    const bucket = criarBucketSimulado(['assets/ColAdultos/CIFRA.pdf']);
    const resolved = await resolvePdfKey('/assets/ColAdultos/cifra.pdf', bucket);
    assert.equal(resolved?.key, 'assets/ColAdultos/CIFRA.pdf');
  });

  it('devolve null quando não há chave equivalente', async () => {
    const bucket = criarBucketSimulado(['assets/ColAdultos/001.pdf']);
    const resolved = await resolvePdfKey('/assets/ColAdultos/999.pdf', bucket);
    assert.equal(resolved, null);
  });
});

describe('resolvePdfKey — corpus dos caminhos reais do acervo (achado C2)', () => {
  const manifestoExiste = fs.existsSync(MANIFEST_PATH);

  it('fixture opcional: roda só quando louvores-manifest.json está presente na raiz', () => {
    if (!manifestoExiste) {
      console.log('[pdfKeyResolution] louvores-manifest.json ausente — teste de corpus pulado.');
    }
  });

  if (!manifestoExiste) return;

  const manifesto = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

  it(`resolve a URL canônica do cliente para os ${manifesto.length} caminhos reais do acervo`, async () => {
    // Trava o tamanho do corpus: se isto mudar, é sinal de que o fixture
    // local não é mais o que a revisão mediu — vale conferir antes de seguir.
    assert.equal(manifesto.length, 4629);

    /** @type {string[]} */
    const chavesReais = [];
    /** @type {{ nome: string, pdf: string, motivo: string }[]} */
    const semRelPath = [];

    for (const louvor of manifesto) {
      const relPath = getPdfRelPath(louvor);
      if (!relPath) {
        semRelPath.push({ nome: louvor.nome, pdf: louvor.pdf, motivo: 'pdfId inválido' });
        continue;
      }
      // A chave real no R2 é o byte exato do caminho original — é
      // precisamente essa invariante que este teste protege.
      chavesReais.push(relPath);
    }

    assert.deepEqual(semRelPath, []);

    // Um bucket só, com todas as chaves reais do acervo — como o R2 de verdade.
    const bucket = criarBucketSimulado(chavesReais);

    /** @type {{ nome: string, pdf: string, r2Key: string }[]} */
    const falhas = [];

    for (const louvor of manifesto) {
      const relPath = getPdfRelPath(louvor);
      // Já validado no laço acima (`semRelPath` ficou vazio); repete a
      // guarda aqui só para o TypeScript estreitar `string | null`.
      if (!relPath) continue;

      const clientUrl = PdfPathManager.createRequestUrl(relPath, ORIGEM);
      const pathname = new URL(clientUrl).pathname;

      const resolved = await resolvePdfKey(pathname, bucket);
      if (!resolved) {
        falhas.push({ nome: louvor.nome, pdf: louvor.pdf, r2Key: relPath });
      }
    }

    assert.deepEqual(
      falhas,
      [],
      `${falhas.length} de ${manifesto.length} caminho(s) do acervo não resolveram a partir da URL canônica do cliente: ${JSON.stringify(falhas.slice(0, 10))}`
    );
  });
});
