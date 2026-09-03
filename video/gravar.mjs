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

// `deviceScaleFactor` afeta a nitidez da pagina renderizada, mas NAO o tamanho
// dos quadros que o screencast devolve - esses vem em pixels CSS. A dimensao
// real e medida em `screencast.mjs` e so depois e que se sabe qual e o mestre.
export const ESCALA_RENDER = 2;
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
    deviceScaleFactor: ESCALA_RENDER,
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

    const captura = await colectar(page, dirQuadros, { largura: LARGURA, altura: ALTURA });
    await page.waitForTimeout(500); // deixa o primeiro quadro chegar antes do 1o beat

    for (const beat of roteiro.beats) {
      const inicio = Date.now() / 1000;
      const urlAntes = caminhoDe(page.url());
      process.stderr.write(`  beat ${beat.id}\n`);
      try {
        await beat.acao(page, ui, contexto);
      } catch (e) {
        // Um beat que falha nao pode levar consigo os 20 que ja foram gravados.
        avisos.push(`beat "${beat.id}" falhou: ${e.message.split('\n')[0]}`);
      }

      // Um beat pode declarar o que tem de ser verdade quando ele acaba.
      //
      // Sem isto, um gesto que faz a coisa ERRADA grava-se em silencio e so se
      // descobre a ver o video: no leitor, o toque longo do meio saltava para a
      // ultima pagina em vez de esconder a barra, e a gravacao nao tinha como
      // saber. E um aviso e nao uma falha, porque a app pode mudar e derrubar
      // uma gravacao de quatro minutos por causa de uma asercao seria pior.
      if (beat.verificar) {
        try {
          const veredito = await beat.verificar(page, ui);
          if (veredito !== true) {
            avisos.push(`beat "${beat.id}" nao verificou: ${veredito || 'a condicao nao se cumpriu'}`);
          }
        } catch (e) {
          avisos.push(`beat "${beat.id}" nao verificou: ${e.message.split('\n')[0]}`);
        }
      }

      const urlDepois = caminhoDe(page.url());
      if (urlAntes !== urlDepois) {
        // Um beat que navega muda o que esta no ecra a partir dali. Isto nao e
        // erro - as vezes a navegacao E o assunto do beat -, mas os beats
        // seguintes tem de fazer sentido na tela NOVA. No video das Listas o
        // "Salvar" saltava para /listas e os tres beats seguintes continuavam
        // a narrar botoes da tela inicial, que ja nao estavam a ser vistos.
        avisos.push(`beat "${beat.id}" navegou de ${urlAntes} para ${urlDepois} — confira se os beats seguintes falam da tela certa`);
      }

      beat.__zoomCru = await resolverZoomCru(page, beat, avisos);

      const restante = falas[beat.id].duracao * 1000 + FOLGA_MS - (Date.now() / 1000 - inicio) * 1000;
      if (restante > 0) await page.waitForTimeout(restante);
      beats.push({
        id: beat.id,
        fala: beat.fala,
        inicio,
        fim: Date.now() / 1000,
        tela: urlDepois,
        zoom: beat.__zoomCru
      });
    }

    const { total, fim, dimensao } = await captura.parar();
    if (total === 0) throw new Error('o screencast nao entregou quadro nenhum');
    if (!dimensao) throw new Error('nao consegui medir a dimensao dos quadros');

    // Quanto o quadro capturado difere do layout em pixels CSS. Hoje da 1,
    // mas medir e barato e supor ja custou um video sem legenda.
    const fatorQuadro = dimensao.largura / LARGURA;

    const origem = captura.quadros.length
      ? Math.min(...captura.quadros.map((q) => q.t))
      : beats[0].inicio;

    const timeline = {
      id: idRoteiro,
      titulo: roteiro.titulo,
      origem,
      duracao: Number((fim - origem).toFixed(3)),
      largura: dimensao.largura,
      altura: dimensao.altura,
      beats: beats.map((b) => ({
        id: b.id,
        fala: b.fala,
        inicio: Number((b.inicio - origem).toFixed(3)),
        fim: Number((b.fim - origem).toFixed(3)),
        tela: b.tela,
        zoom: escalarZoom(b.zoom, fatorQuadro, dimensao)
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

/** So o caminho, sem dominio nem query — e o que identifica a tela. */
function caminhoDe(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Resolve a regiao de zoom em pixels CSS, tal como o `boundingBox` a devolve.
 *
 * Fica em pixels CSS de proposito: converter para as coordenadas do quadro so
 * e possivel depois de o quadro ser medido, e isso so acontece no fim da
 * gravacao. Converter antes obrigaria a supor o fator, que foi exatamente o
 * erro que apagou a legenda do primeiro video.
 *
 * Um alvo que nao resolve nao derruba a gravacao: cai para "sem zoom" e deixa
 * aviso. Perder o zoom de um beat e um defeito pequeno; perder uma gravacao de
 * quatro minutos por causa de um seletor e um defeito grande.
 */
async function resolverZoomCru(page, beat, avisos) {
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
    const x = Math.max(0, caixa.x - m);
    const y = Math.max(0, caixa.y - m);
    return {
      x,
      y,
      w: Math.min(LARGURA - x, caixa.width + m * 2),
      h: Math.min(ALTURA - y, caixa.height + m * 2)
    };
  } catch (e) {
    avisos.push(`zoom de "${beat.id}": ${e.message.split('\n')[0]}`);
    return null;
  }
}

/** Passa a regiao de pixels CSS para as coordenadas reais do quadro. */
function escalarZoom(zoom, fator, dimensao) {
  if (!zoom) return null;
  const x = Math.round(zoom.x * fator);
  const y = Math.round(zoom.y * fator);
  const w = Math.min(dimensao.largura - x, Math.round(zoom.w * fator));
  const h = Math.min(dimensao.altura - y, Math.round(zoom.h * fator));
  if (w < 60 || h < 60) return null;   // regiao pequena demais para ampliar
  return { x, y, w, h };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
