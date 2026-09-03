import { correr } from './pcm.mjs';

/** Teto de pico. Acima disto ha ceifa audivel em altifalante de tablet. */
const TETO_PICO_DB = -1;

/**
 * Portao de qualidade do mp4 acabado.
 *
 * Nunca lanca: devolve todas as falhas de uma vez. Descobrir um defeito por
 * corrida, quando cada corrida e uma montagem de minutos, e o caminho mais
 * lento possivel para um video bom.
 */
export async function verificar(caminho, timeline, esperado) {
  const falhas = [];
  const { largura, altura, fps = 30 } = esperado;

  const sonda = JSON.parse(
    await correr('ffprobe', [
      '-v', 'error', '-show_streams', '-show_format', '-of', 'json', caminho
    ])
  );

  const v = (sonda.streams || []).find((s) => s.codec_type === 'video');
  const a = (sonda.streams || []).find((s) => s.codec_type === 'audio');

  if (!v) {
    falhas.push('nao ha stream de video');
  } else {
    if (v.width !== largura || v.height !== altura) {
      falhas.push(`dimensao ${v.width}x${v.height}, esperava ${largura}x${altura}`);
    }
    if (v.r_frame_rate !== `${fps}/1`) {
      falhas.push(`taxa ${v.r_frame_rate}, esperava ${fps}/1`);
    }
    if (v.pix_fmt !== 'yuv420p') {
      falhas.push(`pix_fmt ${v.pix_fmt}, esperava yuv420p (senao nao toca em todo o lado)`);
    }
  }

  if (!a) {
    falhas.push('nao ha stream de audio - o video sairia mudo');
  } else if (a.codec_name !== 'aac') {
    falhas.push(`audio em ${a.codec_name}, esperava aac`);
  }

  const dur = parseFloat((sonda.format || {}).duration || '0');
  const alvo = timeline.beats.length ? timeline.beats.at(-1).fim : timeline.duracao;
  if (Math.abs(dur - alvo) > 1.5) {
    falhas.push(`duracao ${dur.toFixed(2)} s, a timeline acaba em ${alvo.toFixed(2)} s`);
  }

  // Pico: `-1 dBFS` e o teto; passar disso e distorcao audivel nos altifalantes
  // pequenos de tablet, que e onde isto vai ser visto.
  //
  // O relatorio do `volumedetect` sai no STDERR, nao no stdout. Enquanto isto
  // lia so o stdout, a expressao nunca casava, `pico` era sempre null, e a
  // checagem passava sempre - um portao que parecia existir e nao existia.
  const vol = await correr(
    'ffmpeg',
    ['-hide_banner', '-nostdin', '-i', caminho, '-af', 'volumedetect', '-f', 'null', '-'],
    null,
    { comErro: true }
  ).catch((e) => ({ out: '', err: e.message }));

  const texto = `${vol.out || ''}\n${vol.err || ''}`;
  const pico = /max_volume:\s*(-?[\d.]+) dB/.exec(texto);
  if (!pico) {
    falhas.push('nao consegui medir o pico de audio');
  } else if (parseFloat(pico[1]) > TETO_PICO_DB) {
    falhas.push(`pico de audio em ${pico[1]} dB, o teto e ${TETO_PICO_DB} dB`);
  }

  return { ok: falhas.length === 0, falhas, duracao: dur, pico: pico ? parseFloat(pico[1]) : null };
}
