#!/usr/bin/env node
/**
 * Corre um roteiro contra producao e emite quadros carimbados + timeline.
 *
 * Le `falas.json` da narracao: a duracao de cada beat e a da sua fala mais uma
 * folga. Emite `timeline.json` com o inicio e o fim reais de cada beat medidos
 * contra o primeiro quadro - e a timeline que a legenda e o zoom consomem.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { SCRIPT_TOQUE } from './lib/toque.mjs';
import { criarGestos } from './lib/gestos.mjs';
import { colectar } from './lib/screencast.mjs';

export const LARGURA = 820;
export const ALTURA = 1180;
export const ESCALA = 2;
const FOLGA_MS = 600;

export async function gravar(idRoteiro, { headless = true } = {}) {
  const alvo = pathToFileURL(resolve(`video/roteiros/${idRoteiro}.mjs`)).href;
  const roteiro = (await import(alvo)).default;

  const dir = join('video/build', idRoteiro);
  const dirQuadros = join(dir, 'quadros');
  await mkdir(dirQuadros, { recursive: true });

  const falas = JSON.parse(await readFile(join(dir, 'falas.json'), 'utf8'));
  for (const beat of roteiro.beats) {
    if (!falas[beat.id]) throw new Error(`beat "${beat.id}" sem fala em falas.json - corra o narrar primeiro`);
  }

  const navegador = await chromium.launch({ headless });
  const contexto = await navegador.newContext({
    viewport: { width: LARGURA, height: ALTURA },
    deviceScaleFactor: ESCALA,
    hasTouch: true,
    isMobile: true,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo'
  });
  await contexto.addInitScript(SCRIPT_TOQUE);
  await contexto.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(roteiro.url).origin });

  const page = await contexto.newPage();
  const cliente = await contexto.newCDPSession(page);
  const ui = criarGestos(page, cliente);

  const avisos = [];
  /** @type {{id:string,fala:string,inicio:number,fim:number,zoom:object|null}[]} */
  const beats = [];

  try {
    await page.goto(roteiro.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {
      avisos.push('a rede nao assentou em 60 s; seguindo mesmo assim');
    });
    if (roteiro.preparar) await roteiro.preparar(page, ui, contexto);
    await page.waitForTimeout(700);

    const captura = await colectar(page, dirQuadros, {
      largura: LARGURA * ESCALA,
      altura: ALTURA * ESCALA
    });
    await page.waitForTimeout(500); // deixa o primeiro quadro chegar antes do 1o beat

    for (const beat of roteiro.beats) {
      const inicio = Date.now() / 1000;
      process.stderr.write(`  beat ${beat.id}\n`);
      try {
        await beat.acao(page, ui, contexto);
      } catch (e) {
        // Um beat que falha nao pode levar consigo os 20 que ja foram gravados.
        avisos.push(`beat "${beat.id}" falhou: ${e.message.split('\n')[0]}`);
      }

      const zoom = await resolverZoom(page, beat, avisos);

      const restante = falas[beat.id].duracao * 1000 + FOLGA_MS - (Date.now() / 1000 - inicio) * 1000;
      if (restante > 0) await page.waitForTimeout(restante);
      beats.push({ id: beat.id, fala: beat.fala, inicio, fim: Date.now() / 1000, zoom });
    }

    const { total, fim } = await captura.parar();
    if (total === 0) throw new Error('o screencast nao entregou quadro nenhum');

    const origem = captura.quadros.length
      ? Math.min(...captura.quadros.map((q) => q.t))
      : beats[0].inicio;

    const timeline = {
      id: idRoteiro,
      titulo: roteiro.titulo,
      origem,
      duracao: Number((fim - origem).toFixed(3)),
      largura: LARGURA * ESCALA,
      altura: ALTURA * ESCALA,
      beats: beats.map((b) => ({
        id: b.id,
        fala: b.fala,
        inicio: Number((b.inicio - origem).toFixed(3)),
        fim: Number((b.fim - origem).toFixed(3)),
        zoom: b.zoom
      })),
      avisos
    };
    await writeFile(join(dir, 'timeline.json'), JSON.stringify(timeline, null, 2) + '\n');

    process.stderr.write(
      `${idRoteiro}: ${total} quadros, ${timeline.duracao.toFixed(1)} s, ${beats.length} beats\n`
    );
    for (const a of avisos) process.stderr.write(`  aviso: ${a}\n`);
    return timeline;
  } finally {
    await contexto.close();
    await navegador.close();
  }
}

/**
 * Resolve a regiao de zoom em pixels do mestre.
 *
 * Um alvo que nao resolve nao derruba a gravacao: cai para "sem zoom" e deixa
 * aviso. Perder o zoom de um beat e um defeito pequeno; perder uma gravacao de
 * quatro minutos por causa de um seletor e um defeito grande.
 */
async function resolverZoom(page, beat, avisos) {
  if (!beat.zoom) return null;
  try {
    const alvo = page.locator(beat.zoom.seletor).first();
    if ((await alvo.count()) === 0) {
      avisos.push(`zoom de "${beat.id}": "${beat.zoom.seletor}" nao existe`);
      return null;
    }
    const caixa = await alvo.boundingBox();
    if (!caixa) {
      avisos.push(`zoom de "${beat.id}": "${beat.zoom.seletor}" sem area`);
      return null;
    }
    const m = beat.zoom.margem ?? 24;
    const x = Math.max(0, (caixa.x - m) * ESCALA);
    const y = Math.max(0, (caixa.y - m) * ESCALA);
    const w = Math.min(LARGURA * ESCALA - x, (caixa.width + m * 2) * ESCALA);
    const h = Math.min(ALTURA * ESCALA - y, (caixa.height + m * 2) * ESCALA);
    if (w < 80 || h < 80) {
      avisos.push(`zoom de "${beat.id}": regiao pequena demais (${Math.round(w)}x${Math.round(h)})`);
      return null;
    }
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  } catch (e) {
    avisos.push(`zoom de "${beat.id}": ${e.message.split('\n')[0]}`);
    return null;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const id = process.argv[2];
  if (!id) {
    process.stderr.write('uso: node video/gravar.mjs <id-do-roteiro>\n');
    process.exit(2);
  }
  gravar(id, { headless: process.env.VIDEO_JANELA !== '1' }).catch((e) => {
    process.stderr.write(`falhou: ${e.stack}\n`);
    process.exit(1);
  });
}
