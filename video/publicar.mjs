#!/usr/bin/env node
/**
 * Envia os vídeos, cartazes e legendas para o R2.
 *
 * Este é o ÚNICO passo do pipeline que sai da máquina, então ele imprime tudo
 * o que vai enviar e pára à espera de confirmação. Publicar sem querer é o tipo
 * de erro que não se desfaz com um `git revert`.
 *
 * Uso: node video/publicar.mjs [<id>...]     (sem ids, publica os cinco)
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { correr } from './lib/pcm.mjs';

const BUCKET = 'pls-louvores';
const PREFIXO = 'videos';

export const TODOS = [
  '01-uso-basico',
  '02-offline',
  '03-biblioteca',
  '04-listas',
  '05-problemas'
];

const TIPOS = {
  mp4: 'video/mp4',
  jpg: 'image/jpeg',
  vtt: 'text/vtt; charset=utf-8'
};

/** Junta os ficheiros a enviar, e falha cedo se faltar algum. */
export async function reunir(ids) {
  const itens = [];
  const faltam = [];

  for (const id of ids) {
    const dir = join('video/build', id);
    for (const ext of ['mp4', 'jpg']) {
      const caminho = join(dir, `${id}.${ext}`);
      try {
        const { size } = await stat(caminho);
        itens.push({ id, ext, caminho, chave: `${PREFIXO}/${id}.${ext}`, tamanho: size });
      } catch {
        faltam.push(caminho);
      }
    }
    // O .vtt tem o nome do estágio de legendas, não do vídeo.
    const vtt = join(dir, 'legendas.vtt');
    try {
      const { size } = await stat(vtt);
      itens.push({ id, ext: 'vtt', caminho: vtt, chave: `${PREFIXO}/${id}.vtt`, tamanho: size });
    } catch {
      faltam.push(vtt);
    }
  }

  return { itens, faltam };
}

function mb(bytes) {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

export async function publicar(ids, { confirmar = true } = {}) {
  const { itens, faltam } = await reunir(ids);

  if (faltam.length) {
    throw new Error(
      `faltam ficheiros — corra "npm run video <id>" primeiro:\n  ${faltam.join('\n  ')}`
    );
  }

  const total = itens.reduce((s, i) => s + i.tamanho, 0);
  process.stdout.write(`\nVai enviar ${itens.length} ficheiros (${mb(total)}) para r2://${BUCKET}/${PREFIXO}/\n\n`);
  for (const i of itens) {
    process.stdout.write(`  ${i.chave.padEnd(34)} ${mb(i.tamanho).padStart(9)}   ${i.caminho}\n`);
  }
  process.stdout.write('\nIsto publica na internet e sobrescreve o que já lá estiver.\n');

  if (confirmar) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const resposta = (await rl.question('Escreva "publicar" para confirmar: ')).trim();
    rl.close();
    if (resposta !== 'publicar') {
      process.stdout.write('cancelado, nada foi enviado\n');
      return { enviados: [], cancelado: true };
    }
  }

  const enviados = [];
  for (const i of itens) {
    process.stderr.write(`  enviando ${i.chave}…\n`);
    await correr('npx', [
      'wrangler', 'r2', 'object', 'put', `${BUCKET}/${i.chave}`,
      '--file', i.caminho,
      '--content-type', TIPOS[i.ext],
      '--remote'
    ]);
    enviados.push(i.chave);
  }

  process.stdout.write(`\n${enviados.length} ficheiros publicados. Confira em https://plpcg.com/sobre\n`);
  return { enviados, cancelado: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ids = process.argv.slice(2);
  publicar(ids.length ? ids : TODOS).catch((e) => {
    process.stderr.write(`falhou: ${e.message}\n`);
    process.exit(1);
  });
}
