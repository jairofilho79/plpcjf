/**
 * `normalizeForStorage` diante de percent-encoding ANINHADO (Fase 6, Task 1).
 * Run: node --test src/lib/offline/utils/PdfPathManager.percentEncoding.test.js
 *
 * ENTRADA ADVERSARIAL / SINTÉTICA. Nada aqui vem do acervo: os 4629 caminhos
 * reais não têm um único `%` (conferido em `louvores-manifest.json` e
 * `offline-manifest.json`). Este arquivo existe separado de
 * `PdfPathManager.nfc.test.js` e de `normalizacaoCaminho.contrato.test.js` de
 * propósito — os dois afirmam idempotência sobre a fixture real, o que é
 * verdade e continua sendo. Misturar os casos sintéticos ali estragaria a
 * leitura de ambos.
 *
 * O que este arquivo documenta é o comportamento ATUAL, não o desejado:
 * `normalizeForStorage` NÃO é idempotente quando o caminho traz um `%`
 * embrulhado em três ou mais camadas de `encodeURIComponent`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import PdfPathManager from './PdfPathManager.js';

const ORIGEM = 'https://plpcg.com';

/**
 * Um `%` embrulhado em `n` camadas de `encodeURIComponent`.
 * camadas(1) = '%25', camadas(2) = '%2525', camadas(3) = '%252525', ...
 * @param {number} n
 */
function camadas(n) {
  let s = '%';
  for (let i = 0; i < n; i++) s = encodeURIComponent(s);
  return s;
}

/**
 * `decodeUrlComponentUtf8` grita no console quando cai no decode manual.
 * Aqui o grito é esperado em todo caso, e enche a saída de `npm test`.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
function semRuido(fn) {
  const original = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = original;
  }
}

describe('normalizeForStorage com percent-encoding aninhado (sintético)', () => {
  it('NÃO é idempotente com 3 a 5 camadas — defeito atual, afirmado de propósito', () => {
    // ATENÇÃO, futuro leitor: no dia em que a raiz for consertada (parar de
    // decodificar `%` especulativamente em `normalizeForStorage`), ESTE TESTE
    // VAI FALHAR. Essa falha é o SINAL CORRETO de que a propriedade mudou —
    // não é regressão. A resposta certa é trocar `notEqual` por `equal` aqui,
    // não remexer no código para o teste voltar a passar.
    for (const n of [3, 4, 5]) {
      const x = `assets/a${camadas(n)}b.pdf`;
      const f1 = semRuido(() => PdfPathManager.normalizeForStorage(x));
      const f2 = semRuido(() => PdfPathManager.normalizeForStorage(f1));
      assert.notEqual(f1, f2, `esperava não-idempotência com ${n} camadas`);
    }
  });

  it('o mecanismo exato: o `.` antes de `pdf` some, colado num byte de controle', () => {
    // `decodeUrlUtf8Multiple` para em 3 iterações e devolve um `%` residual;
    // na chamada seguinte, `decodeURIComponent('assets/a%b.pdf')` lança e o
    // fallback manual lê `parseInt('b.', 16) === 11` e avança dois caracteres,
    // engolindo o `.` que nunca fez parte de escape nenhum.
    const x = `assets/a${camadas(3)}b.pdf`;
    assert.equal(x, 'assets/a%252525b.pdf');
    const f1 = semRuido(() => PdfPathManager.normalizeForStorage(x));
    const f2 = semRuido(() => PdfPathManager.normalizeForStorage(f1));
    assert.equal(f1, 'assets/a%b.pdf');
    assert.equal(f2, 'assets/a\x0Bpdf');
  });

  it('a partir da segunda aplicação estabiliza — a corrupção é ponto fixo', () => {
    // Por isso a guarda óbvia ("só apague se a chave nova for ponto fixo")
    // não protege nada: a chave corrompida passa nela. Ver a guarda real em
    // `src/lib/offline/storage/pdfCacheNfcMigration.js`.
    for (const n of [3, 4, 5]) {
      const x = `assets/a${camadas(n)}b.pdf`;
      const f1 = semRuido(() => PdfPathManager.normalizeForStorage(x));
      const f2 = semRuido(() => PdfPathManager.normalizeForStorage(f1));
      const f3 = semRuido(() => PdfPathManager.normalizeForStorage(f2));
      assert.equal(f3, f2, `esperava estabilidade a partir de F(F(x)) com ${n} camadas`);
    }
  });

  it('com 1 ou 2 camadas F já é idempotente na primeira aplicação', () => {
    // Delimita o defeito: o aninhamento é que importa. Com poucas camadas o
    // colapso acontece todo dentro da primeira chamada, e a segunda não muda
    // mais nada — documentado, não abençoado.
    for (const n of [1, 2]) {
      const x = `assets/a${camadas(n)}b.pdf`;
      const f1 = semRuido(() => PdfPathManager.normalizeForStorage(x));
      const f2 = semRuido(() => PdfPathManager.normalizeForStorage(f1));
      assert.equal(f1, f2, `esperava idempotência com ${n} camada(s)`);
    }
  });

  it('a chave de escrita é auto-consistente: reler o caminho cru dá a mesma URL', () => {
    // Sem migração, um caminho com `%` aninhado nunca teria problema: toda
    // leitura recalcula exatamente a mesma chave a partir do caminho cru.
    // Quem quebra isso é a camada de decode a mais que a migração NFC
    // introduz — ver `pdfCacheNfcMigration.test.js`.
    for (const n of [1, 2, 3, 4, 5]) {
      const cru = `assets/a${camadas(n)}b.pdf`;
      const primeira = semRuido(() => PdfPathManager.createRequestUrl(cru, ORIGEM));
      const segunda = semRuido(() => PdfPathManager.createRequestUrl(cru, ORIGEM));
      assert.equal(segunda, primeira, `createRequestUrl instável com ${n} camadas`);
    }
  });
});
