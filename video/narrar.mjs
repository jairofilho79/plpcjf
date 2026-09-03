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
import { sintetizar, configuracaoPadrao, escolherModelo, MODELOS } from './lib/vozes.mjs';
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

function hashDaFala(provedor, modelo, voz, fala) {
  return createHash('sha256')
    .update(`${provedor} ${modelo} ${voz} ${fala}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Devolve o primeiro modelo cujo áudio já está inteiro em cache, ou null.
 *
 * Existe para que refazer um vídeo sem mudar uma vírgula da narração não toque
 * na rede. Sem isto, uma indisponibilidade do OpenRouter impede de re-montar um
 * vídeo cuja voz já está toda gravada em disco — que foi exatamente o que
 * aconteceu.
 */
async function modeloJaEmCache(roteiro, provedor, voz) {
  if (process.env.VIDEO_MODELO) {
    const m = process.env.VIDEO_MODELO;
    const todos = await Promise.all(
      roteiro.beats.map((b) => existe(join(CACHE, `${hashDaFala(provedor, m, voz, b.fala)}.wav`)))
    );
    return todos.every(Boolean) ? m : null;
  }

  for (const modelo of MODELOS) {
    const todos = await Promise.all(
      roteiro.beats.map((b) => existe(join(CACHE, `${hashDaFala(provedor, modelo, voz, b.fala)}.wav`)))
    );
    if (todos.every(Boolean)) {
      process.stderr.write(`  modelo: ${modelo} (tudo em cache, sem rede)\n`);
      return modelo;
    }
  }
  return null;
}

export async function narrar(idRoteiro) {
  const { provedor, voz } = configuracaoPadrao();
  const alvo = pathToFileURL(resolve(`video/roteiros/${idRoteiro}.mjs`)).href;
  const roteiro = (await import(alvo)).default;

  const dir = join('video/build', idRoteiro);
  await mkdir(dir, { recursive: true });
  await mkdir(CACHE, { recursive: true });

  // O modelo é escolhido uma vez e vale para o vídeo inteiro, para o timbre não
  // mudar entre um beat e o seguinte. Entra no hash do cache pela mesma razão:
  // misturar áudio de dois modelos no mesmo vídeo soa partido.
  //
  // A escolha começa pelo disco e só depois vai à rede. Sondar primeiro fazia
  // uma narração inteiramente em cache falhar quando o OpenRouter estava fora
  // — pedir rede para não usar rede nenhuma.
  const modelo = provedor === 'macos'
    ? 'say'
    : (await modeloJaEmCache(roteiro, provedor, voz)) || (await escolherModelo(voz));

  const falas = {};
  let sintetizadas = 0;

  for (const beat of roteiro.beats) {
    if (!beat.fala || !beat.fala.trim()) {
      throw new Error(`beat "${beat.id}" nao tem fala - a fala e que dita a duracao do beat`);
    }
    const hash = hashDaFala(provedor, modelo, voz, beat.fala);
    const noCache = join(CACHE, `${hash}.wav`);

    if (!(await existe(noCache))) {
      process.stderr.write(`  sintetizando ${beat.id}\n`);
      await sintetizar(beat.fala, { provedor, voz, modelo, destino: noCache });
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
      `(${sintetizadas} sintetizadas, ${doCache} do cache) via ${modelo}/${voz}\n`
  );
  return falas;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
