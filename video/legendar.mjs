#!/usr/bin/env node
/**
 * Da timeline para os PNGs de legenda e o .vtt.
 *
 * O texto vem do campo `fala` do beat - o mesmo que gerou a narracao. Uma so
 * fonte para voz e legenda: e impossivel uma discordar da outra.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { quebrar } from './lib/quebraLinha.mjs';
import { correr } from './lib/pcm.mjs';

// 40 caracteres em ate 4 linhas.
//
// Com 38 em 3 linhas, tres falas da Biblioteca nao cabiam e sairam cortadas com
// reticencias - a legenda dizia menos do que a voz. Como a app deixa a metade
// de baixo do ecra vazia na maioria das telas, a quarta linha nao tapa nada.
const LARGURA_CARACTERES = 40;

function carimbo(s) {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const seg = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const mil = String(ms % 1000).padStart(3, '0');
  return `${h}:${m}:${seg}.${mil}`;
}

export async function legendar(idRoteiro) {
  const dir = join('video/build', idRoteiro);
  const dirLegendas = join(dir, 'legendas');
  await mkdir(dirLegendas, { recursive: true });

  const timeline = JSON.parse(await readFile(join(dir, 'timeline.json'), 'utf8'));
  const uteis = timeline.beats.filter((b) => b.fim > b.inicio && b.fala && b.fala.trim());

  const trabalhos = uteis.map((b) => ({
    saida: join(dirLegendas, `${b.id}.png`),
    linhas: quebrar(b.fala, LARGURA_CARACTERES)
  }));

  // Cortar a legenda faz ela dizer MENOS do que a voz, e o espectador que
  // depende dela perde informacao sem saber. Isto ja passou por aviso duas
  // vezes e chegou a dois videos montados - por isso agora e falha, e a
  // montagem nem corre.
  const compridas = uteis.filter((b) => quebrar(b.fala, LARGURA_CARACTERES).at(-1)?.endsWith('…'));
  if (compridas.length) {
    const detalhe = compridas
      .map((b) => `  "${b.id}" (${b.fala.length} caracteres): ${b.fala}`)
      .join('\n');
    throw new Error(
      `${compridas.length} fala(s) não caibem na legenda e seriam cortadas.\n` +
      `Encurte-as ou divida o beat em dois:\n${detalhe}`
    );
  }

  await correr('python3', ['video/legenda_png.py'], JSON.stringify({
    largura: timeline.largura,
    altura: timeline.altura,
    trabalhos
  }));

  const vtt = ['WEBVTT', ''];
  for (const b of uteis) {
    vtt.push(`${carimbo(b.inicio)} --> ${carimbo(b.fim)}`, ...quebrar(b.fala, LARGURA_CARACTERES), '');
  }
  await writeFile(join(dir, 'legendas.vtt'), vtt.join('\n'));

  process.stderr.write(`${idRoteiro}: ${trabalhos.length} legendas + legendas.vtt\n`);
  return { total: trabalhos.length, cortadas: compridas.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const id = process.argv[2];
  if (!id) {
    process.stderr.write('uso: node video/legendar.mjs <id-do-roteiro>\n');
    process.exit(2);
  }
  legendar(id).catch((e) => {
    process.stderr.write(`falhou: ${e.message}\n`);
    process.exit(1);
  });
}
