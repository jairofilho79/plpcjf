#!/usr/bin/env node
/**
 * Sintetiza a narração de um roteiro e mede quanto tempo cada beat vai durar.
 *
 * Corre ANTES da gravação de propósito: é a duração da fala que determina
 * quanto tempo cada passo fica na tela. O contrário — gravar com tempos fixos e
 * encaixar a fala depois — produz narração a cavalgar o passo seguinte.
 *
 * O cache é indexado pelo hash de (provedor, voz, fala): corrigir uma frase não
 * re-sintetiza nem re-cobra as outras.
 */
import { createHash } from 'node:crypto';
import { mkdir, copyFile, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sintetizar, configuracaoPadrao } from './lib/vozes.mjs';
import { duracaoSegundos } from './lib/pcm.mjs';

const CACHE = 'video/.cache';

async function existe(caminho) {
  try {
    await access(caminho);
    return true;
  } catch {
    return false;
  }
}

export async function narrar(idRoteiro) {
  const { provedor, voz } = configuracaoPadrao();
  const alvo = pathToFileURL(resolve(`video/roteiros/${idRoteiro}.mjs`)).href;
  const roteiro = (await import(alvo)).default;

  const dir = join('video/build', idRoteiro);
  await mkdir(dir, { recursive: true });
  await mkdir(CACHE, { recursive: true });

  const falas = {};
  let sintetizadas = 0;

  for (const beat of roteiro.beats) {
    if (!beat.fala || !beat.fala.trim()) {
      throw new Error(`beat "${beat.id}" nao tem fala - a fala e que dita a duracao do beat`);
    }
    const hash = createHash('sha256')
      .update(`${provedor} ${voz} ${beat.fala}`)
      .digest('hex')
      .slice(0, 32);
    const noCache = join(CACHE, `${hash}.wav`);

    if (!(await existe(noCache))) {
      process.stderr.write(`  sintetizando ${beat.id}\n`);
      await sintetizar(beat.fala, { provedor, voz, destino: noCache });
      sintetizadas++;
    }

    const destino = join(dir, `fala-${beat.id}.wav`);
    await copyFile(noCache, destino);
    falas[beat.id] = {
      caminho: destino,
      duracao: await duracaoSegundos(destino),
      hash
    };
  }

  await writeFile(join(dir, 'falas.json'), JSON.stringify(falas, null, 2) + '\n');

  const total = Object.values(falas).reduce((s, f) => s + f.duracao, 0);
  const doCache = roteiro.beats.length - sintetizadas;
  process.stderr.write(
    `${idRoteiro}: ${roteiro.beats.length} beats, ${total.toFixed(1)} s de fala ` +
      `(${sintetizadas} sintetizadas, ${doCache} do cache) via ${provedor}/${voz}\n`
  );
  return falas;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const id = process.argv[2];
  if (!id) {
    process.stderr.write('uso: node video/narrar.mjs <id-do-roteiro>\n');
    process.exit(2);
  }
  narrar(id).catch((e) => {
    process.stderr.write(`falhou: ${e.message}\n`);
    process.exit(1);
  });
}
