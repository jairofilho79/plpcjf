import { test, describe } from 'node:test';
import assert from 'node:assert';
import { construirGrafo } from './filtergraph.mjs';

const TL = {
  id: 't',
  largura: 1640,
  altura: 2360,
  duracao: 9,
  beats: [
    { id: 'a', fala: 'Um', inicio: 0, fim: 4, zoom: null },
    { id: 'b', fala: 'Dois', inicio: 4, fim: 9, zoom: { x: 100, y: 200, w: 820, h: 1180 } }
  ]
};
const OPC = {
  dir: '/b',
  musica: '/m/leito.wav',
  saidaLargura: 820,
  saidaAltura: 1180,
  fps: 30,
  rampa: 0.4
};

describe('construirGrafo', () => {
  test('a primeira entrada e a sequencia numerada e a musica e a ultima', () => {
    const g = construirGrafo(TL, OPC);
    assert.ok(g.entradas[0].includes('seq'));
    assert.ok(g.entradas[0].includes('%06d.jpg'));
    assert.ok(g.entradas.at(-1).includes('leito.wav'));
  });

  test('a entrada declara a taxa fixa e nao ha filtro fps', () => {
    // O demuxer `concat` mais o filtro `fps` esticavam o video em 10%: 86 s de
    // gravacao saiam como 94 s de mp4. Uma sequencia numerada a taxa fixa nao
    // tem duracao nenhuma para o ffmpeg arredondar.
    const g = construirGrafo(TL, OPC);
    assert.ok(g.entradas[0].startsWith('-framerate 30 '));
    assert.ok(!g.filtro.includes('fps=30,'), 'nao ha filtro fps na cadeia de video');
    assert.ok(!g.entradas[0].includes('concat'));
  });

  test('um PNG de legenda por beat, na ordem dos beats', () => {
    const g = construirGrafo(TL, OPC);
    const idxA = g.entradas.findIndex((e) => e.includes('legendas/a.png'));
    const idxB = g.entradas.findIndex((e) => e.includes('legendas/b.png'));
    assert.ok(idxA > 0 && idxB > idxA);
  });

  test('cada legenda e ligada a janela do seu beat', () => {
    const f = construirGrafo(TL, OPC).filtro;
    assert.ok(f.includes("enable='between(t,0,4)'"));
    assert.ok(f.includes("enable='between(t,4,9)'"));
  });

  test('sem nenhum beat com zoom, nao ha zoompan - nada de ampliar 1x a toa', () => {
    const f = construirGrafo({ ...TL, beats: [TL.beats[0]] }, OPC).filtro;
    assert.ok(!f.includes('zoompan'));
  });

  test('com zoom, ha um so zoompan e ele fixa o fps', () => {
    const f = construirGrafo(TL, OPC).filtro;
    assert.equal(f.split('zoompan').length - 1, 1);
    assert.ok(/zoompan=[^;]*fps=30/.test(f), 'o zoompan declara a taxa dele');
  });

  test('a rampa de entrada e a de saida aparecem nos instantes certos', () => {
    const f = construirGrafo(TL, OPC).filtro;
    assert.ok(f.includes('4.4'), 'inicio + rampa');
    assert.ok(f.includes('8.6'), 'fim - rampa');
  });

  test('o fator de zoom respeita a dimensao mais apertada da regiao', () => {
    // 1640/820 = 2, 2360/1180 = 2 -> ambos dao 2
    const f = construirGrafo(TL, OPC).filtro;
    assert.ok(f.includes('2.000'));
  });

  test('uma regiao estreita e alta nao amplia mais do que a altura permite', () => {
    const tl = {
      ...TL,
      beats: [{ id: 'a', fala: 'x', inicio: 0, fim: 4, zoom: { x: 0, y: 0, w: 410, h: 1180 } }]
    };
    // 1640/410 = 4 na largura, mas 2360/1180 = 2 na altura: manda o menor,
    // senao a regiao transbordava e cortava exatamente o que se ia mostrar.
    const f = construirGrafo(tl, OPC).filtro;
    assert.ok(f.includes('2.000'));
    assert.ok(!f.includes('4.000'));
  });

  test('a fala de cada beat e atrasada ate ao inicio do beat, em milissegundos', () => {
    const f = construirGrafo(TL, OPC).filtro;
    assert.ok(f.includes('adelay=0|0'));
    assert.ok(f.includes('adelay=4000|4000'));
  });

  test('a musica passa por sidechaincompress com a narracao como cadeia lateral', () => {
    const f = construirGrafo(TL, OPC).filtro;
    const i = f.indexOf('sidechaincompress');
    assert.ok(i > -1, 'tem ducking');
    assert.ok(f.indexOf('loudnorm') > i, 'normaliza depois de misturar, nao antes');
  });

  test('a narracao e duplicada, porque serve de audio e de cadeia lateral ao mesmo tempo', () => {
    const f = construirGrafo(TL, OPC).filtro;
    assert.ok(f.includes('asplit'));
  });

  test('a saida e escalada para o formato final', () => {
    const f = construirGrafo(TL, OPC).filtro;
    assert.ok(f.includes('scale=820:1180'));
  });

  test('converte de faixa cheia para faixa limitada - senao sai yuvj420p', () => {
    // Os quadros vem em JPEG, que e faixa cheia. Sem a conversao o x264 rotula
    // a saida `yuvj420p`, formato legado que faz alguns players esmagarem
    // pretos e brancos. Foi o que o portao apanhou na primeira montagem.
    const f = construirGrafo(TL, OPC).filtro;
    assert.ok(f.includes('in_range=pc:out_range=tv'));
    assert.ok(f.includes('setparams=range=tv'));
  });

  test('um beat de duracao zero nao entra no grafo', () => {
    const tl = { ...TL, beats: [{ id: 'z', fala: 'x', inicio: 3, fim: 3, zoom: null }] };
    const g = construirGrafo(tl, OPC);
    assert.ok(!g.entradas.some((e) => e.includes('legendas/z.png')));
    assert.ok(!g.filtro.includes('legendas/z'));
  });

  test('os mapas apontam para os rotulos que o filtro produz', () => {
    const g = construirGrafo(TL, OPC);
    assert.deepEqual(g.mapas, ['[vout]', '[aout]']);
    assert.ok(g.filtro.includes('[vout]'));
    assert.ok(g.filtro.includes('[aout]'));
  });
});

describe('temZoom', () => {
  test('um alvo de largura inteira nao rende zoom nenhum', async () => {
    const { temZoom } = await import('./filtergraph.mjs');
    // O painel de filtros: 1640 de largura num quadro de 1640. O fator sem
    // cortar conteudo e 1, e 1 nao e zoom - e uma reamostragem cara.
    assert.equal(temZoom({ x: 0, y: 224, w: 1640, h: 566 }, 1640, 2360), false);
  });

  test('um botao pequeno rende zoom de sobra', async () => {
    const { temZoom } = await import('./filtergraph.mjs');
    assert.equal(temZoom({ x: 100, y: 100, w: 240, h: 180 }, 1640, 2360), true);
  });

  test('um alvo largo nao gera zoompan no grafo', () => {
    const tl = {
      ...TL,
      beats: [{ id: 'a', fala: 'x', inicio: 0, fim: 4, zoom: { x: 0, y: 0, w: 1640, h: 500 } }]
    };
    assert.ok(!construirGrafo(tl, OPC).filtro.includes('zoompan'));
  });
});

describe('teto de audio', () => {
  test('um limitador fecha a cadeia depois do loudnorm', () => {
    // `loudnorm` ESTIMA o pico verdadeiro e não o garante: com `TP=-1` a saída
    // mediu -0,9 dB, acima do teto. O limitador é o que garante.
    const f = construirGrafo(TL, OPC).filtro;
    const iLoud = f.indexOf('loudnorm');
    const iLim = f.indexOf('alimiter');
    assert.ok(iLim > iLoud, 'o limitador vem depois do loudnorm');
    assert.ok(f.includes('limit=0.891'), '0.891 em amplitude é -1 dBFS');
    // Por omissão o `alimiter` normaliza a saída ATÉ ao limite, ou seja sobe o
    // sinal em vez de o segurar: com auto-nível a saída mediu -0,2 dB.
    assert.ok(f.includes('level=disabled'), 'o auto-nível do limitador está desligado');
  });
});
