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

const LARGURA_CARACTERES = 38;

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

  const compridas = uteis.filter((b) => quebrar(b.fala, LARGURA_CARACTERES).at(-1)?.endsWith('…'));
  for (const b of compridas) {
    process.stderr.write(`  aviso: a fala de "${b.id}" nao cabe em 3 linhas e foi cortada na legenda\n`);
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
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
