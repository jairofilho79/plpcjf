#!/usr/bin/env node
/**
 * Junta tudo num mp4: quadros, zoom, legendas, narracao e musica.
 *
 * O grafo em si vive em `lib/filtergraph.mjs`, que e funcao pura e testada.
 * Aqui so se corre o ffmpeg, se verifica o resultado e se limpa o rasto.
 */
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { construirGrafo } from './lib/filtergraph.mjs';
import { verificar } from './lib/verificar.mjs';
import { correr } from './lib/pcm.mjs';

const SAIDA_LARGURA = 820;
const SAIDA_ALTURA = 1180;
const FPS = 30;
const MUSICA = 'video/build/leito-musical.wav';

/**
 * Recusa montar se a legenda nao tiver o tamanho do quadro.
 *
 * O `overlay` do ffmpeg nao reclama de uma imagem maior que o video: compoe o
 * que couber a partir do canto superior esquerdo e descarta o resto em
 * silencio. Como a legenda mora no rodape, "descartar o resto" significa
 * exatamente descartar a legenda - e o video sai limpo, sem erro nenhum, e sem
 * legenda nenhuma. Foi assim que um video inteiro chegou ao Jairo mudo de
 * texto. Esta conferencia e o que impede que volte a acontecer.
 */
async function conferirDimensoes(dir, timeline) {
  const primeiro = timeline.beats.find((b) => b.fim > b.inicio && b.fala && b.fala.trim());
  if (!primeiro) return;

  const png = join(dir, 'legendas', `${primeiro.id}.png`);
  const saida = await correr('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', png
  ]);
  const [largura, altura] = saida.trim().split(',').map(Number);

  if (largura !== timeline.largura || altura !== timeline.altura) {
    throw new Error(
      `a legenda mede ${largura}x${altura} e o quadro mede ${timeline.largura}x${timeline.altura}. ` +
      'O overlay descartaria a legenda em silêncio. Corra "node video/legendar.mjs" outra vez.'
    );
  }
}

export async function montar(idRoteiro, { limpar = true } = {}) {
  const dir = join('video/build', idRoteiro);
  const timeline = JSON.parse(await readFile(join(dir, 'timeline.json'), 'utf8'));

  try {
    await stat(MUSICA);
  } catch {
    throw new Error(`${MUSICA} nao existe - corra "npm run musica" primeiro`);
  }

  await conferirDimensoes(dir, timeline);

  const { entradas, filtro, mapas } = construirGrafo(timeline, {
    dir,
    musica: MUSICA,
    saidaLargura: SAIDA_LARGURA,
    saidaAltura: SAIDA_ALTURA,
    fps: FPS
  });

  const mp4 = join(dir, `${idRoteiro}.mp4`);
  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    ...entradas.flatMap((e) => e.split(' ')),
    '-filter_complex', filtro,
    '-map', mapas[0], '-map', mapas[1],
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    mp4
  ];

  process.stderr.write(`  montando ${idRoteiro} (${entradas.length} entradas)\n`);
  await correr('ffmpeg', args);

  // Poster: um quadro do meio do primeiro beat, ja com a legenda queimada.
  const jpg = join(dir, `${idRoteiro}.jpg`);
  const instante = timeline.beats.length
    ? (timeline.beats[0].inicio + timeline.beats[0].fim) / 2
    : 1;
  await correr('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-ss', instante.toFixed(2), '-i', mp4, '-frames:v', '1', '-q:v', '3', jpg
  ]);

  const r = await verificar(mp4, timeline, {
    largura: SAIDA_LARGURA,
    altura: SAIDA_ALTURA,
    fps: FPS
  });

  if (!r.ok) {
    process.stderr.write(`${idRoteiro}: REPROVADO\n`);
    for (const f of r.falhas) process.stderr.write(`  - ${f}\n`);
    const e = new Error(`${idRoteiro} nao passou no portao`);
    e.falhas = r.falhas;
    throw e;
  }

  // Os quadros custam ~6 MB por segundo de video. So se apagam depois de o
  // mp4 passar: se o portao reprovar, eles ficam para a montagem seguinte nao
  // ter de re-gravar tudo.
  if (limpar) await rm(join(dir, 'quadros'), { recursive: true, force: true });

  const tamanho = (await stat(mp4)).size;
  process.stderr.write(
    `${idRoteiro}: ${mp4} — ${r.duracao.toFixed(1)} s, ${(tamanho / 1e6).toFixed(1)} MB\n`
  );
  return { mp4, jpg, duracao: r.duracao, tamanho };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const id = process.argv[2];
  if (!id) {
    process.stderr.write('uso: node video/montar.mjs <id-do-roteiro>\n');
    process.exit(2);
  }
  montar(id, { limpar: process.env.VIDEO_MANTER_QUADROS !== '1' }).catch((e) => {
    process.stderr.write(`falhou: ${e.message}\n`);
    process.exit(1);
  });
}
