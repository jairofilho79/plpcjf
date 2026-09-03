import { test, describe } from 'node:test';
import assert from 'node:assert';
import { escolherQuadros } from './screencast.mjs';

describe('escolherQuadros', () => {
  test('produz um quadro por fatia da grelha de saida', () => {
    const escolhidos = escolherQuadros(
      [{ ficheiro: 'a.jpg', t: 10 }, { ficheiro: 'b.jpg', t: 11 }],
      12,
      30
    );
    assert.equal(escolhidos.length, 60); // 2 s a 30 fps
  });

  test('cada fatia mostra o ultimo quadro ja pintado naquele instante', () => {
    const escolhidos = escolherQuadros(
      [{ ficheiro: 'a.jpg', t: 0 }, { ficheiro: 'b.jpg', t: 0.5 }],
      1,
      10
    );
    assert.deepEqual(escolhidos, [
      'a.jpg', 'a.jpg', 'a.jpg', 'a.jpg', 'a.jpg',
      'b.jpg', 'b.jpg', 'b.jpg', 'b.jpg', 'b.jpg'
    ]);
  });

  test('quadros fora de ordem sao ordenados pelo carimbo', () => {
    const escolhidos = escolherQuadros(
      [{ ficheiro: 'b.jpg', t: 1 }, { ficheiro: 'a.jpg', t: 0 }],
      2,
      2
    );
    assert.deepEqual(escolhidos, ['a.jpg', 'a.jpg', 'b.jpg', 'b.jpg']);
  });

  test('entre dois quadros no mesmo instante, sobrevive o ultimo', () => {
    // O ultimo a chegar e a pintura mais recente daquele instante; ficar com o
    // primeiro mostraria um quadro que ja tinha sido substituido.
    const escolhidos = escolherQuadros(
      [
        { ficheiro: 'velho.jpg', t: 0 },
        { ficheiro: 'novo.jpg', t: 0 },
        { ficheiro: 'b.jpg', t: 1 }
      ],
      2,
      1
    );
    assert.deepEqual(escolhidos, ['novo.jpg', 'b.jpg']);
  });

  test('um trecho parado repete o mesmo quadro em vez de acelerar', () => {
    const escolhidos = escolherQuadros([{ ficheiro: 'a.jpg', t: 0 }], 3, 10);
    assert.equal(escolhidos.length, 30);
    assert.ok(escolhidos.every((f) => f === 'a.jpg'));
  });

  test('quadros que chegam depois do fim nao entram', () => {
    const escolhidos = escolherQuadros(
      [{ ficheiro: 'a.jpg', t: 0 }, { ficheiro: 'tarde.jpg', t: 9 }],
      1,
      10
    );
    assert.ok(!escolhidos.includes('tarde.jpg'));
  });

  test('lista vazia devolve lista vazia em vez de rebentar', () => {
    assert.deepEqual(escolherQuadros([], 5, 30), []);
  });

  test('gravacao de duracao nula nao produz fatias', () => {
    assert.deepEqual(escolherQuadros([{ ficheiro: 'a.jpg', t: 5 }], 5, 30), []);
  });

  test('a contagem de fatias e a duracao vezes a taxa - e nada mais', () => {
    // Esta e a garantia que substituiu o demuxer `concat`. Ele quantizava as
    // duracoes na base de tempo dele e esticava o video em 10%: 86 s de
    // gravacao viravam 94 s de mp4, com a narracao a descolar da imagem. Uma
    // sequencia numerada a taxa fixa nao tem duracao nenhuma para arredondar.
    const escolhidos = escolherQuadros([{ ficheiro: 'a.jpg', t: 100 }], 185.8, 30);
    assert.equal(escolhidos.length, Math.round(85.8 * 30));
  });
});
