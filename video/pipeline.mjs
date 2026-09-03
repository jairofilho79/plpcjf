#!/usr/bin/env node
/**
 * Corre os quatro estagios em ordem, abortando no primeiro que falhar.
 *
 * A ordem nao e arbitraria: a narracao vem antes da gravacao porque e a
 * duracao da fala que dita quanto tempo cada beat fica na tela.
 */
import { pathToFileURL } from 'node:url';
import { narrar } from './narrar.mjs';
import { gravar } from './gravar.mjs';
import { legendar } from './legendar.mjs';
import { montar } from './montar.mjs';

export async function pipeline(id) {
  const t0 = Date.now();
  process.stderr.write(`\n[1/4] narrando ${id}\n`);
  await narrar(id);

  process.stderr.write(`\n[2/4] gravando ${id}\n`);
  await gravar(id, { headless: process.env.VIDEO_JANELA !== '1' });

  process.stderr.write(`\n[3/4] legendando ${id}\n`);
  await legendar(id);

  process.stderr.write(`\n[4/4] montando ${id}\n`);
  const r = await montar(id, { limpar: process.env.VIDEO_MANTER_QUADROS !== '1' });

  process.stderr.write(`\npronto em ${((Date.now() - t0) / 1000).toFixed(0)} s: ${r.mp4}\n`);
  return r;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const id = process.argv[2];
  if (!id) {
    process.stderr.write('uso: npm run video <id-do-roteiro>\n');
    process.exit(2);
  }
  pipeline(id).catch((e) => {
    process.stderr.write(`\nfalhou: ${e.message}\n`);
    process.exit(1);
  });
}
