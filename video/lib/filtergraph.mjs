import { join } from 'node:path';

/**
 * Timeline -> filter_complex do ffmpeg. Funcao pura, e testada como tal.
 *
 * E aqui que um erro nao da excecao nenhuma: da um video errado, que so se
 * descobre a ver. Por isso o grafo e construido separado de quem o corre.
 */

/** Vira `if(lt(t,limite), entao, senao)` encadeado sobre uma lista de janelas. */
function encadear(janelas, valorPadrao) {
  let expr = String(valorPadrao);
  for (let i = janelas.length - 1; i >= 0; i--) {
    const { inicio, fim, valor } = janelas[i];
    expr = `if(between(it,${inicio},${fim}),${valor},${expr})`;
  }
  return expr;
}

/** Abaixo disto o zoom nao se ve e so custa uma reamostragem. */
export const ZOOM_MINIMO = 1.08;

/**
 * Acima disto o zoom deixa de mostrar e passa a esconder.
 *
 * Sem tecto, um botao pequeno da barra do leitor pedia 10,5x: o quadro ficava
 * com o botao gigante e a pagina em branco em volta, e o espectador perdia a
 * nocao de onde aquele botao fica. O objetivo do zoom e apontar, nao isolar -
 * a vizinhanca do alvo faz parte da explicacao.
 */
export const ZOOM_MAXIMO = 2.2;

/**
 * Fator de zoom de uma regiao: o menor entre o que a largura e a altura
 * permitem.
 *
 * O menor, e nao o maior, porque cortar conteudo esta fora de questao. Nesta
 * app quase tudo sao cartoes de largura inteira, e para esses o fator honesto
 * e 1: ampliar exigiria comer as bordas, que e onde moram os botoes "Todos".
 * O zoom ganha o seu lugar nos alvos pequenos - um botao da barra do leitor, um
 * chip da playlist, os controlos de paginacao. Para os outros, `temZoom`
 * devolve falso e o beat mostra a pagina inteira, que tambem e informacao.
 */
export function fator(zoom, largura, altura) {
  return Math.min(largura / zoom.w, altura / zoom.h, ZOOM_MAXIMO);
}

export function temZoom(zoom, largura, altura) {
  return Boolean(zoom) && fator(zoom, largura, altura) >= ZOOM_MINIMO;
}

export function construirGrafo(timeline, opcoes) {
  const {
    dir,
    musica,
    saidaLargura,
    saidaAltura,
    fps = 30,
    rampa = 0.4,
    volumeMusica = '-22dB'
  } = opcoes;

  const beats = timeline.beats.filter((b) => b.fim > b.inicio && b.fala && b.fala.trim());
  const L = timeline.largura;
  const A = timeline.altura;
  const dur = timeline.duracao;

  // --- entradas -----------------------------------------------------------
  // Sequencia numerada a taxa fixa, e nao o demuxer `concat`: ele quantizava
  // as duracoes na base de tempo dele e esticava o video em 10%, com a
  // narracao a descolar da imagem. Ver `escolherQuadros` em `screencast.mjs`.
  const entradas = [`-framerate ${fps} -i ${join(dir, 'quadros', 'seq', '%06d.jpg')}`];
  const idxLegenda = {};
  beats.forEach((b) => {
    idxLegenda[b.id] = entradas.length;
    entradas.push(`-i ${join(dir, 'legendas', `${b.id}.png`)}`);
  });
  const idxFala = {};
  beats.forEach((b) => {
    idxFala[b.id] = entradas.length;
    entradas.push(`-i ${join(dir, `fala-${b.id}.wav`)}`);
  });
  const idxMusica = entradas.length;
  entradas.push(`-i ${musica}`);

  // --- video --------------------------------------------------------------
  // Sem filtro `fps`: a entrada ja vem em taxa constante, e o `fps` aplicado
  // por cima de carimbos vindos do `concat` era o que esticava o video.
  const partes = ['[0:v]format=rgba[base]'];
  let rotulo = 'base';

  const comZoom = beats.filter((b) => temZoom(b.zoom, L, A));
  if (comZoom.length > 0) {
    // Um so zoompan para todos os beats: as expressoes escolhem o fator e o
    // centro conforme o instante. Encadear um zoompan por beat reescalaria a
    // imagem tantas vezes quantos beats houvesse.
    const janelasZ = [];
    const janelasCX = [];
    const janelasCY = [];

    for (const b of comZoom) {
      const Z = fator(b.zoom, L, A);
      const z = Z.toFixed(3);
      const cx = (b.zoom.x + b.zoom.w / 2).toFixed(1);
      const cy = (b.zoom.y + b.zoom.h / 2).toFixed(1);
      const a = b.inicio;
      const f = b.fim;
      const subida = Number((a + rampa).toFixed(3));
      const descida = Number((f - rampa).toFixed(3));

      if (descida > subida) {
        janelasZ.push(
          { inicio: a, fim: subida, valor: `1+(${z}-1)*(it-${a})/${rampa}` },
          { inicio: subida, fim: descida, valor: z },
          { inicio: descida, fim: f, valor: `${z}-(${z}-1)*(it-${descida})/${rampa}` }
        );
      } else {
        // Beat curto demais para ramp-up e ramp-down: entra e sai sem patamar.
        const meio = Number(((a + f) / 2).toFixed(3));
        janelasZ.push(
          { inicio: a, fim: meio, valor: `1+(${z}-1)*(it-${a})/${(meio - a).toFixed(3)}` },
          { inicio: meio, fim: f, valor: `${z}-(${z}-1)*(it-${meio})/${(f - meio).toFixed(3)}` }
        );
      }
      janelasCX.push({ inicio: a, fim: f, valor: cx });
      janelasCY.push({ inicio: a, fim: f, valor: cy });
    }

    const exprZ = encadear(janelasZ, 1);
    const exprCX = encadear(janelasCX, `${L / 2}`);
    const exprCY = encadear(janelasCY, `${A / 2}`);

    // `zoom` esta disponivel dentro de x/y: a janela visivel mede iw/zoom por
    // ih/zoom, e o canto sai do centro pedido, preso as bordas do quadro.
    const exprX = `max(0,min(iw-iw/zoom,(${exprCX})-(iw/zoom)/2))`;
    const exprY = `max(0,min(ih-ih/zoom,(${exprCY})-(ih/zoom)/2))`;

    partes.push(
      `[${rotulo}]zoompan=z='${exprZ}':x='${exprX}':y='${exprY}':d=1:s=${L}x${A}:fps=${fps}[zoomed]`
    );
    rotulo = 'zoomed';
  }

  beats.forEach((b, i) => {
    const saida = i === beats.length - 1 ? 'legendado' : `leg${i}`;
    partes.push(
      `[${rotulo}][${idxLegenda[b.id]}:v]overlay=0:0:enable='between(t,${b.inicio},${b.fim})'[${saida}]`
    );
    rotulo = saida;
  });

  // `in_range=pc:out_range=tv` nao e detalhe: os quadros vem em JPEG, que e
  // faixa cheia, e sem esta conversao o x264 rotula a saida `yuvj420p` - o
  // formato legado que faz alguns players esmagarem pretos e brancos. O portao
  // de `verificar.mjs` reprova exatamente isso.
  partes.push(
    `[${rotulo}]scale=${saidaLargura}:${saidaAltura}:flags=lanczos:in_range=pc:out_range=tv,` +
      'format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709[vout]'
  );

  // --- audio --------------------------------------------------------------
  beats.forEach((b) => {
    const ms = Math.round(b.inicio * 1000);
    partes.push(`[${idxFala[b.id]}:a]aresample=48000,adelay=${ms}|${ms}[f_${b.id}]`);
  });

  const entradasVoz = beats.map((b) => `[f_${b.id}]`).join('');
  if (beats.length === 1) {
    partes.push(`${entradasVoz}aresample=48000[voz]`);
  } else {
    partes.push(`${entradasVoz}amix=inputs=${beats.length}:normalize=0:duration=longest[voz]`);
  }

  // A narracao serve duas vezes: como audio e como cadeia lateral do
  // compressor que faz a musica abaixar. Sem `asplit`, o ffmpeg recusa - um
  // rotulo so pode ser consumido uma vez.
  partes.push('[voz]asplit=2[voz_mix][voz_lado]');

  const fimFade = Math.max(0, dur - 2);
  partes.push(
    `[${idxMusica}:a]aresample=48000,atrim=0:${dur.toFixed(3)},asetpts=PTS-STARTPTS,` +
      `afade=t=in:st=0:d=1.5,afade=t=out:st=${fimFade.toFixed(3)}:d=2,volume=${volumeMusica}[bed]`
  );
  partes.push(
    '[bed][voz_lado]sidechaincompress=threshold=0.03:ratio=8:attack=25:release=350[bed_duck]'
  );
  // `loudnorm` depois da mistura, nunca antes: normalizar a musica sozinha
  // fa-la-ia subir sempre que a voz calasse, que e o oposto do ducking.
  // `loudnorm` ESTIMA o pico verdadeiro; nao o garante. Numa passagem so, com
  // `TP=-1`, a saida mediu -0,9 dB - acima do teto que o portao exige. E ha um
  // segundo efeito: o AAC descodificado ultrapassa o pico do sinal que entrou
  // no codificador, entao medir a saida final da sempre mais que a entrada.
  //
  // `level=disabled` NAO e detalhe. Por omissao o `alimiter` normaliza a saida
  // ate ao limite - ou seja, SOBE o sinal em vez de o segurar. Com o auto-nivel
  // ligado a saida media -0,2 dB; com ele desligado, -1,3 dB. 0.891 e -1 dBFS
  // em amplitude.
  partes.push(
    '[bed_duck][voz_mix]amix=inputs=2:normalize=0:duration=first,' +
      'loudnorm=I=-16:TP=-1.5:LRA=11,' +
      'alimiter=limit=0.891:level=disabled:attack=5:release=50[aout]'
  );

  return { entradas, filtro: partes.join(';'), mapas: ['[vout]', '[aout]'] };
}
