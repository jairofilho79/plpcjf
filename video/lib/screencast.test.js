import { test, describe } from 'node:test';
import assert from 'node:assert';
import { construirConcat } from './screencast.mjs';

/** Soma as duracoes declaradas no ficheiro de concatenacao. */
function somaDuracoes(txt) {
  return [...txt.matchAll(/^duration ([\d.]+)$/gm)].reduce((s, m) => s + Number(m[1]), 0);
}

/** Sequencia de ficheiros, um por entrada `file`. */
function ficheiros(txt) {
  return txt.trim().split('\n').filter((l) => l.startsWith('file ')).map((l) => l.slice(6, -1));
}

describe('construirConcat', () => {
  test('a duracao total e o intervalo gravado', () => {
    const txt = construirConcat(
      [
        { ficheiro: 'a.jpg', t: 10.0 },
        { ficheiro: 'b.jpg', t: 10.5 },
        { ficheiro: 'c.jpg', t: 11.0 }
      ],
      11.5,
      30
    );
    assert.ok(Math.abs(somaDuracoes(txt) - 1.5) < 0.05, `somou ${somaDuracoes(txt)}`);
  });

  test('nenhuma duracao fica abaixo de um quadro', () => {
    // O demuxer `concat` trata cada imagem como um video de um quadro com
    // framerate proprio, e eleva qualquer `duration` menor que esse minimo ate
    // ele. Como o screencast entrega a 80 ou 130 fps, deixar as duracoes cruas
    // esticava o video em 10% - foi assim que 86 s viraram 95 s. Reamostrar
    // para 30 fps na origem e o que impede isso.
    const quadros = Array.from({ length: 200 }, (_, i) => ({
      ficheiro: `q${i}.jpg`,
      t: 100 + i * 0.008 // 125 fps
    }));
    const txt = construirConcat(quadros, 100 + 200 * 0.008, 30);
    const minima = Math.min(...[...txt.matchAll(/^duration ([\d.]+)$/gm)].map((m) => Number(m[1])));
    assert.ok(minima >= 1 / 30 - 1e-6, `duracao minima ${minima}`);
  });

  test('repete o ultimo ficheiro - sem isso o demuxer come o quadro final', () => {
    const txt = construirConcat([{ ficheiro: 'a.jpg', t: 0 }, { ficheiro: 'b.jpg', t: 1 }], 2, 30);
    const fs = ficheiros(txt);
    assert.equal(fs.at(-1), 'b.jpg');
    assert.equal(fs.at(-1), fs.at(-2), 'o ultimo aparece duas vezes seguidas');
  });

  test('quadros fora de ordem sao ordenados pelo carimbo', () => {
    const txt = construirConcat(
      [{ ficheiro: 'b.jpg', t: 1.0 }, { ficheiro: 'a.jpg', t: 0.0 }],
      1.5,
      30
    );
    assert.ok(txt.indexOf("file 'a.jpg'") < txt.indexOf("file 'b.jpg'"));
  });

  test('entre dois quadros no mesmo instante, sobrevive o ultimo', () => {
    // O ultimo a chegar e a pintura mais recente daquele instante; ficar com o
    // primeiro mostraria um quadro que ja tinha sido substituido.
    const txt = construirConcat(
      [
        { ficheiro: 'velho.jpg', t: 0 },
        { ficheiro: 'novo.jpg', t: 0 },
        { ficheiro: 'b.jpg', t: 0.5 }
      ],
      1.0,
      30
    );
    assert.ok(!txt.includes('velho.jpg'));
    assert.ok(txt.includes('novo.jpg'));
  });

  test('um periodo parado vira uma entrada longa, e nao trinta iguais por segundo', () => {
    const txt = construirConcat(
      [{ ficheiro: 'a.jpg', t: 0 }, { ficheiro: 'b.jpg', t: 3 }],
      4,
      30
    );
    // 3 s de 'a' + 1 s de 'b' + a repeticao final = 3 entradas, nao 120.
    assert.equal(ficheiros(txt).length, 3);
  });

  test('lista vazia devolve texto vazio em vez de rebentar', () => {
    assert.equal(construirConcat([], 5, 30).trim(), '');
  });

  test('um quadro so ainda produz um segmento com duracao', () => {
    const txt = construirConcat([{ ficheiro: 'a.jpg', t: 2.0 }], 3.5, 30);
    assert.ok(somaDuracoes(txt) > 1.4);
    assert.equal(ficheiros(txt).length, 2);
  });

  test('gravacao de duracao nula nao produz entradas', () => {
    assert.equal(construirConcat([{ ficheiro: 'a.jpg', t: 5 }], 5, 30).trim(), '');
  });
});
