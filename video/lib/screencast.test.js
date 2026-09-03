import { test, describe } from 'node:test';
import assert from 'node:assert';
import { construirConcat } from './screencast.mjs';

describe('construirConcat', () => {
  test('a duracao de cada quadro e a distancia ate o proximo', () => {
    const txt = construirConcat(
      [
        { ficheiro: 'a.jpg', t: 10.0 },
        { ficheiro: 'b.jpg', t: 10.5 },
        { ficheiro: 'c.jpg', t: 11.0 }
      ],
      11.25
    );
    const duracoes = [...txt.matchAll(/^duration ([\d.]+)$/gm)].map((m) => +m[1]);
    assert.deepEqual(duracoes, [0.5, 0.5, 0.25]);
  });

  test('repete o ultimo ficheiro - sem isso o demuxer come o quadro final', () => {
    const txt = construirConcat([{ ficheiro: 'a.jpg', t: 0 }, { ficheiro: 'b.jpg', t: 1 }], 2);
    const linhas = txt.trim().split('\n').filter((l) => l.startsWith('file '));
    assert.equal(linhas.at(-1), "file 'b.jpg'");
    assert.equal(linhas.filter((l) => l === "file 'b.jpg'").length, 2);
  });

  test('normaliza os tempos: o primeiro quadro e a origem', () => {
    const txt = construirConcat(
      [{ ficheiro: 'a.jpg', t: 1700.0 }, { ficheiro: 'b.jpg', t: 1700.4 }],
      1700.4
    );
    assert.ok(!txt.includes('1700'));
  });

  test('quadros fora de ordem sao ordenados pelo carimbo', () => {
    const txt = construirConcat(
      [{ ficheiro: 'b.jpg', t: 1.0 }, { ficheiro: 'a.jpg', t: 0.0 }],
      1.5
    );
    assert.ok(txt.indexOf("file 'a.jpg'") < txt.indexOf("file 'b.jpg'"));
  });

  test('carimbos iguais nao geram duration 0 - o ffmpeg rejeita isso', () => {
    const txt = construirConcat(
      [
        { ficheiro: 'velho.jpg', t: 0 },
        { ficheiro: 'novo.jpg', t: 0 },
        { ficheiro: 'b.jpg', t: 0.5 }
      ],
      1.0
    );
    assert.ok(!/duration 0(\.0+)?$/m.test(txt));
  });

  test('entre dois quadros com o mesmo carimbo, sobrevive o ultimo', () => {
    // O ultimo a chegar e a pintura mais recente do mesmo instante; ficar com o
    // primeiro mostraria um quadro que ja tinha sido substituido. A escolha e
    // deliberada, e este teste existe para que ela nao se perca.
    const txt = construirConcat(
      [
        { ficheiro: 'velho.jpg', t: 0 },
        { ficheiro: 'novo.jpg', t: 0 },
        { ficheiro: 'b.jpg', t: 0.5 }
      ],
      1.0
    );
    assert.ok(!txt.includes('velho.jpg'));
    assert.ok(txt.includes('novo.jpg'));
  });

  test('lista vazia devolve texto vazio em vez de rebentar', () => {
    assert.equal(construirConcat([], 5).trim(), '');
  });

  test('um quadro so ainda produz um segmento com duracao', () => {
    const txt = construirConcat([{ ficheiro: 'a.jpg', t: 2.0 }], 3.5);
    assert.match(txt, /duration 1\.5/);
    assert.equal(txt.split('\n').filter((l) => l.startsWith('file ')).length, 2);
  });
});
