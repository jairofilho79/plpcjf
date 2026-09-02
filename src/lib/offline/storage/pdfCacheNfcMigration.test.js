/**
 * Migração das chaves de PDF gravadas em NFD (#22.2).
 * Run: node --test src/lib/offline/storage/pdfCacheNfcMigration.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import PdfPathManager from '../utils/PdfPathManager.js';
import { migrarChavesPdfParaNfc } from './pdfCacheNfcMigration.js';

/**
 * Cache Storage falso: guarda pares url → corpo.
 * @param {Array<[string, any]>} entradas
 */
function cacheFalso(entradas) {
  const mapa = new Map(entradas);
  return {
    mapa,
    async keys() {
      return [...mapa.keys()].map((url) => ({ url }));
    },
    /** @param {any} req */
    async match(req) {
      const url = typeof req === 'string' ? req : req.url;
      return mapa.has(url) ? { corpo: mapa.get(url), clone: () => ({ corpo: mapa.get(url) }) } : undefined;
    },
    /** @param {any} req @param {any} res */
    async put(req, res) {
      mapa.set(typeof req === 'string' ? req : req.url, res.corpo);
    },
    /** @param {any} req */
    async delete(req) {
      return mapa.delete(typeof req === 'string' ? req : req.url);
    }
  };
}

/**
 * Canonicalizador de brinquedo: decodifica UMA vez e recodifica. Serve para os
 * casos de acentuação, mas é seguro demais para expor o caminho destrutivo —
 * para isso existe `canonicalizarReal` abaixo.
 * @param {string} url
 */
function canonicalizar(url) {
  const u = new URL(url);
  const caminho = decodeURIComponent(u.pathname).normalize('NFC');
  return `${u.origin}${encodeURI(caminho)}`;
}

/**
 * O canonicalizador REAL, cópia literal do que
 * `OfflineManager.ensureNfcMigration` injeta em produção. Não dá para importar
 * `OfflineManager.js` aqui: ele puxa `$app/environment` e `$lib`, aliases que
 * só existem dentro do Vite. A cópia é conferida contra o original pelo teste
 * "o canonicalizador copiado ainda é o de produção".
 *
 * A diferença que importa em relação ao de brinquedo: `createRequestUrl`
 * decodifica DE NOVO por dentro, então este aqui decodifica duas vezes.
 * @param {string} url
 */
function canonicalizarReal(url) {
  const u = new URL(url);
  return PdfPathManager.createRequestUrl(decodeURIComponent(u.pathname), u.origin);
}

/** Um `%` embrulhado em `n` camadas de `encodeURIComponent`. @param {number} n */
function camadas(n) {
  let s = '%';
  for (let i = 0; i < n; i++) s = encodeURIComponent(s);
  return s;
}

/**
 * `decodeUrlComponentUtf8` grita no console ao cair no decode manual, o que é
 * esperado nos casos adversariais e só enche a saída de `npm test`.
 * @template T @param {() => Promise<T>} fn @returns {Promise<T>}
 */
async function semRuido(fn) {
  const original = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = original;
  }
}

const NFD = 'https://plpcg.com/assets/PES/Alto%20prec%CC%A7o%20-%20CIFRA.pdf';
const NFC = 'https://plpcg.com/assets/PES/Alto%20pre%C3%A7o%20-%20CIFRA.pdf';
const JA_OK = 'https://plpcg.com/assets/ColCIAs/001.pdf';

describe('migrarChavesPdfParaNfc', () => {
  it('reescreve a chave NFD sob a forma NFC e apaga a antiga', async () => {
    const cache = cacheFalso([[NFD, 'pdf-a'], [JA_OK, 'pdf-b']]);
    const r = await migrarChavesPdfParaNfc(/** @type {any} */ (cache), canonicalizar);
    assert.deepEqual(r, { migradas: 1, mantidas: 1, preservadas: 0, erros: 0 });
    assert.equal(cache.mapa.get(NFC), 'pdf-a');
    assert.equal(cache.mapa.has(NFD), false);
    assert.equal(cache.mapa.get(JA_OK), 'pdf-b');
  });

  it('não toca em nada quando tudo já está canônico', async () => {
    const cache = cacheFalso([[NFC, 'pdf-a'], [JA_OK, 'pdf-b']]);
    const r = await migrarChavesPdfParaNfc(/** @type {any} */ (cache), canonicalizar);
    assert.deepEqual(r, { migradas: 0, mantidas: 2, preservadas: 0, erros: 0 });
  });

  it('é idempotente: rodar duas vezes dá o mesmo cache', async () => {
    const cache = cacheFalso([[NFD, 'pdf-a']]);
    await migrarChavesPdfParaNfc(/** @type {any} */ (cache), canonicalizar);
    const r = await migrarChavesPdfParaNfc(/** @type {any} */ (cache), canonicalizar);
    assert.deepEqual(r, { migradas: 0, mantidas: 1, preservadas: 0, erros: 0 });
    assert.equal(cache.mapa.size, 1);
  });

  it('grava a chave nova antes de apagar a velha', async () => {
    // Se a operação for interrompida no meio, tem de sobrar a entrada antiga,
    // nunca nenhuma. Provamos observando a ordem: falhamos o delete de
    // propósito e conferimos que a chave nova já existe.
    const cache = cacheFalso([[NFD, 'pdf-a']]);
    cache.delete = async () => {
      throw new Error('falha simulada');
    };
    const r = await migrarChavesPdfParaNfc(/** @type {any} */ (cache), canonicalizar);
    assert.equal(cache.mapa.has(NFC), true);
    assert.equal(cache.mapa.has(NFD), true);
    assert.equal(r.erros, 1);
  });
});

describe('a migração não apaga quando a mudança não é só de forma Unicode', () => {
  // ENTRADA ADVERSARIAL / SINTÉTICA: nenhum dos 4629 caminhos do acervo tem
  // um `%`. Estes casos usam o canonicalizador REAL (o de brinquedo acima
  // decodifica uma vez só e por isso nunca expõe o problema).

  const ORIGEM = 'https://plpcg.com';

  it('o canonicalizador copiado ainda é o de produção', () => {
    // Se `OfflineManager.ensureNfcMigration` mudar a expressão, a cópia aqui
    // deixa de provar o que diz provar. Este teste quebra antes disso passar
    // despercebido.
    const fonte = fs.readFileSync(new URL('../core/OfflineManager.js', import.meta.url), 'utf8');
    assert.ok(
      fonte.includes('PdfPathManager.createRequestUrl(decodeURIComponent(u.pathname), u.origin)'),
      'o canonicalizador de OfflineManager.js mudou — atualize canonicalizarReal'
    );
  });

  it('mantém as duas chaves quando o `%` aninhado corrompe o caminho', async () => {
    // A chave que o app grava e recalcula a cada leitura, a partir do caminho
    // cru — a única que qualquer leitura futura volta a construir.
    const cru = `assets/a${camadas(3)}b.pdf`;
    const K_ORIG = await semRuido(async () => PdfPathManager.createRequestUrl(cru, ORIGEM));
    assert.equal(K_ORIG, 'https://plpcg.com/assets/a%25b.pdf');

    const cache = cacheFalso([[K_ORIG, 'pdf-a'], [JA_OK, 'pdf-b']]);
    const r = await semRuido(() =>
      migrarChavesPdfParaNfc(/** @type {any} */ (cache), canonicalizarReal)
    );

    // O ponto inteiro da fase: a original CONTINUA lá.
    assert.equal(cache.mapa.get(K_ORIG), 'pdf-a', 'a chave boa foi apagada');
    assert.deepEqual(r, { migradas: 0, mantidas: 1, preservadas: 1, erros: 0 });

    // E a chave nova, que ninguém volta a pedir, ficou junto — inofensiva.
    const K_NOVA = await semRuido(async () => canonicalizarReal(K_ORIG));
    assert.notEqual(K_NOVA, K_ORIG);
    assert.equal(cache.mapa.get(K_NOVA), 'pdf-a');
    assert.equal(cache.mapa.get(JA_OK), 'pdf-b');
  });

  it('depois da migração, a chave que uma leitura fresca reconstrói ainda está no cache', async () => {
    // A propriedade que interessa ao usuário, afirmada contra a migração de
    // verdade: seja qual for a chave que a migração escolher gravar, a chave
    // que `createRequestUrl` recalcula do caminho cru tem de continuar servindo
    // o PDF. (Versão anterior deste teste só comparava strings de
    // `PdfPathManager` e passava com a guarda neutralizada — não testava nada.)
    const cru = `assets/a${camadas(3)}b.pdf`;
    const K_ORIG = await semRuido(async () => PdfPathManager.createRequestUrl(cru, ORIGEM));
    const cache = cacheFalso([[K_ORIG, 'pdf-a']]);

    await semRuido(() => migrarChavesPdfParaNfc(/** @type {any} */ (cache), canonicalizarReal));

    const K_LEITURA = await semRuido(async () => PdfPathManager.createRequestUrl(cru, ORIGEM));
    assert.equal(cache.mapa.get(K_LEITURA), 'pdf-a', 'a chave que o app pede sumiu do cache');
    // E o dano que a guarda evita é real: a chave que a migração gravou não é
    // a que qualquer leitura futura constrói.
    const K_NOVA = await semRuido(async () => canonicalizarReal(K_ORIG));
    assert.notEqual(K_LEITURA, K_NOVA);
  });

  it('a guarda óbvia do ponto fixo não pegaria este caso', async () => {
    // DOCUMENTAL, de propósito: não exercita a migração nem a guarda. Só
    // registra a medição que descartou "só apague se a chave nova for ponto
    // fixo de canonicalizar" — ela dá `true` para a chave corrompida.
    const cru = `assets/a${camadas(3)}b.pdf`;
    const K_ORIG = await semRuido(async () => PdfPathManager.createRequestUrl(cru, ORIGEM));
    const K_NOVA = await semRuido(async () => canonicalizarReal(K_ORIG));
    assert.equal(await semRuido(async () => canonicalizarReal(K_NOVA)), K_NOVA);
  });

  it('a guarda não estorva a migração NFD que a fase existe para preservar', async () => {
    // Com o canonicalizador REAL, o caso de acentuação continua migrando e
    // apagando a chave antiga: é só a forma Unicode que muda.
    const cache = cacheFalso([[NFD, 'pdf-a'], [JA_OK, 'pdf-b']]);
    const r = await migrarChavesPdfParaNfc(/** @type {any} */ (cache), canonicalizarReal);
    assert.deepEqual(r, { migradas: 1, mantidas: 1, preservadas: 0, erros: 0 });
    assert.equal(cache.mapa.get(NFC), 'pdf-a');
    assert.equal(cache.mapa.has(NFD), false);
  });

  it('4 e 5 camadas de `%` também são preservadas', async () => {
    for (const n of [4, 5]) {
      const cru = `assets/a${camadas(n)}b.pdf`;
      const K_ORIG = await semRuido(async () => PdfPathManager.createRequestUrl(cru, ORIGEM));
      const cache = cacheFalso([[K_ORIG, 'pdf-a']]);
      const r = await semRuido(() =>
        migrarChavesPdfParaNfc(/** @type {any} */ (cache), canonicalizarReal)
      );
      assert.equal(cache.mapa.get(K_ORIG), 'pdf-a', `chave boa apagada com ${n} camadas`);
      assert.equal(r.preservadas, 1);
      assert.equal(r.migradas, 0);
    }
  });

  it('uma chave terminada em `?` mantém as duas — o delimitador vazio não engana a guarda', async () => {
    // O falso negativo que a revisão da fase apanhou: `URL.search` devolve `''`
    // tanto para "não tem query" quanto para um `?` final vazio. Comparar
    // `search` dos dois lados dava `'' === ''`, as `pathname` batiam, e a
    // guarda autorizava apagar a chave que a leitura reconstrói.
    const cru = 'assets/x.pdf%3F';
    const K_ORIG = await semRuido(async () => PdfPathManager.createRequestUrl(cru, ORIGEM));
    assert.equal(K_ORIG, 'https://plpcg.com/assets/x.pdf?');
    assert.equal(new URL(K_ORIG).search, '', 'a premissa do defeito: search vem vazio');

    const cache = cacheFalso([[K_ORIG, 'pdf-a']]);
    const r = await semRuido(() =>
      migrarChavesPdfParaNfc(/** @type {any} */ (cache), canonicalizarReal)
    );

    assert.equal(cache.mapa.get(K_ORIG), 'pdf-a', 'a chave boa foi apagada');
    assert.equal(r.preservadas, 1);
    assert.equal(r.migradas, 0);
    // As duas ficam: a antiga é a que a leitura reconstrói, a nova perdeu o `?`.
    assert.equal(cache.mapa.get('https://plpcg.com/assets/x.pdf'), 'pdf-a');
    assert.equal(cache.mapa.size, 2);
  });

  it('o mesmo para `#` final e para `?`/`#` no meio do nome', async () => {
    for (const cru of ['assets/x.pdf%23', 'assets/a%3Fb.pdf', 'assets/a%23b.pdf']) {
      const K_ORIG = await semRuido(async () => PdfPathManager.createRequestUrl(cru, ORIGEM));
      const cache = cacheFalso([[K_ORIG, 'pdf-a']]);
      const r = await semRuido(() =>
        migrarChavesPdfParaNfc(/** @type {any} */ (cache), canonicalizarReal)
      );
      assert.equal(cache.mapa.get(K_ORIG), 'pdf-a', `a chave boa foi apagada para ${cru}`);
      assert.equal(r.preservadas, 1, `esperava preservação para ${cru}`);
      assert.equal(r.migradas, 0);
    }
  });

  it('rodar de novo não apaga a chave boa numa segunda passada', async () => {
    // A migração roda uma vez por aparelho, mas a flag só é gravada quando
    // não há erro — e `preservadas` não é erro. Uma segunda passada tem de
    // continuar preservando, nunca apagando.
    const cru = `assets/a${camadas(3)}b.pdf`;
    const K_ORIG = await semRuido(async () => PdfPathManager.createRequestUrl(cru, ORIGEM));
    const cache = cacheFalso([[K_ORIG, 'pdf-a']]);
    await semRuido(() => migrarChavesPdfParaNfc(/** @type {any} */ (cache), canonicalizarReal));
    const r = await semRuido(() =>
      migrarChavesPdfParaNfc(/** @type {any} */ (cache), canonicalizarReal)
    );
    assert.equal(cache.mapa.get(K_ORIG), 'pdf-a');
    assert.equal(r.preservadas, 1);
    assert.equal(cache.mapa.size, 2);
  });
});
