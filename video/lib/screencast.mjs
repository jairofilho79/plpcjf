import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { correr } from './pcm.mjs';

/**
 * Mede um quadro de verdade, em vez de supor a dimensao.
 *
 * `maxWidth`/`maxHeight` do screencast sao em pixels CSS e o filtro IGNORA o
 * `deviceScaleFactor`: pedir 1640x2360 com viewport de 820x1180 devolve
 * 820x1180. Supor em vez de medir custou um video inteiro sem legenda - os
 * PNGs sairam ao dobro do tamanho, e o rodape, onde a legenda mora, caia fora
 * do quadro. Quem manda e o ficheiro.
 */
async function medirQuadro(quadros, dir) {
  if (quadros.length === 0) return null;
  const saida = await correr('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0',
    join(dir, quadros[0].ficheiro)
  ]);
  const [largura, altura] = saida.trim().split(',').map(Number);
  if (!largura || !altura) throw new Error(`nao consegui medir ${quadros[0].ficheiro}`);
  return { largura, altura };
}

/**
 * Constroi o ficheiro do demuxer `concat` a partir dos quadros carimbados.
 *
 * Os carimbos vem de `Page.screencastFrame` (metadata.timestamp), que e
 * `Network.TimeSinceEpoch` - o mesmo relogio de `Date.now()/1000`. E por isso
 * que legenda e zoom nao derivam: beat e quadro sao medidos no mesmo relogio.
 * O `recordVideo` do Playwright grava num relogio proprio, e foi por isso que
 * nao foi usado.
 *
 * @param {{ficheiro: string, t: number}[]} quadros
 * @param {number} fimSegundos carimbo do fim da gravacao, no mesmo relogio
 * @returns {string} conteudo do ficheiro de concatenacao
 */
export function construirConcat(quadros, fimSegundos) {
  const ord = [...quadros].sort((a, b) => a.t - b.t);
  if (ord.length === 0) return '';

  const origem = ord[0].t;
  const linhas = [];

  for (let i = 0; i < ord.length; i++) {
    const inicio = ord[i].t - origem;
    const seguinte = i + 1 < ord.length ? ord[i + 1].t - origem : fimSegundos - origem;
    const dur = Number((seguinte - inicio).toFixed(4));
    if (dur <= 0) continue; // o ffmpeg rejeita `duration 0`; quadro repetido cai aqui
    linhas.push(`file '${ord[i].ficheiro}'`, `duration ${dur}`);
  }

  // O demuxer descarta o ultimo quadro se ele nao for repetido sem duracao.
  // Sem esta linha o video acaba antes do audio, e o corte e visivel.
  const ultimo = linhas.filter((l) => l.startsWith('file ')).at(-1);
  if (ultimo) linhas.push(ultimo);

  return linhas.length ? linhas.join('\n') + '\n' : '';
}

/**
 * Liga o screencast do CDP e coleciona os quadros em disco.
 *
 * Responder `screencastFrameAck` a todos os quadros nao e opcional: o Chromium
 * para de enviar se um ack se perder, e a gravacao continua a correr sem
 * imagem nenhuma.
 */
export async function colectar(page, dir, { largura = 1640, altura = 2360 } = {}) {
  await mkdir(dir, { recursive: true });
  const cliente = await page.context().newCDPSession(page);
  const quadros = [];
  let seq = 0;

  cliente.on('Page.screencastFrame', async (evento) => {
    const nome = `q${String(seq++).padStart(5, '0')}.jpg`;
    quadros.push({ ficheiro: nome, t: evento.metadata.timestamp });
    try {
      await writeFile(join(dir, nome), Buffer.from(evento.data, 'base64'));
    } catch (e) {
      process.stderr.write(`  aviso: quadro ${nome} nao gravou (${e.message})\n`);
    }
    try {
      await cliente.send('Page.screencastFrameAck', { sessionId: evento.sessionId });
    } catch {
      // a sessao pode ja ter fechado; nao ha o que fazer nem o que dizer
    }
  });

  await cliente.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    maxWidth: largura,
    maxHeight: altura,
    everyNthFrame: 1
  });

  return {
    quadros,
    async parar() {
      try {
        await cliente.send('Page.stopScreencast');
      } catch {
        // idem
      }
      // Os ultimos acks podem ainda estar em voo quando paramos.
      await new Promise((r) => setTimeout(r, 300));
      const fim = Date.now() / 1000;
      const texto = construirConcat(quadros, fim);
      await writeFile(join(dir, 'quadros.txt'), texto);
      return { total: quadros.length, fim, dimensao: await medirQuadro(quadros, dir) };
    }
  };
}
