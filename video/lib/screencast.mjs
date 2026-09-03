import { writeFile, mkdir, rm, symlink } from 'node:fs/promises';
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
 * Escolhe que quadro mostrar em cada fatia da grelha de saida.
 *
 * Os carimbos vem de `Page.screencastFrame` (metadata.timestamp), que e
 * `Network.TimeSinceEpoch` - o mesmo relogio de `Date.now()/1000`. E por isso
 * que legenda e zoom nao derivam: beat e quadro sao medidos no mesmo relogio.
 * O `recordVideo` do Playwright grava num relogio proprio, e foi por isso que
 * nao foi usado.
 *
 * A saida e uma FATIA POR QUADRO DE VIDEO, e nao uma lista de duracoes. O
 * demuxer `concat`, que era o caminho anterior, quantiza cada `duration` na
 * base de tempo dele e eleva o que ficar abaixo do minimo: 86 s de gravacao
 * saiam como 94 s de mp4, com a narracao a descolar da imagem - exatamente o
 * defeito que este pipeline existe para nao ter. Uma sequencia numerada a taxa
 * fixa nao tem duracao nenhuma para o ffmpeg arredondar.
 *
 * @param {{ficheiro: string, t: number}[]} quadros
 * @param {number} fimSegundos carimbo do fim da gravacao, no mesmo relogio
 * @param {number} fps
 * @returns {string[]} um nome de ficheiro por fatia, em ordem
 */
export function escolherQuadros(quadros, fimSegundos, fps) {
  const ord = [...quadros].sort((a, b) => a.t - b.t);
  if (ord.length === 0) return [];

  const origem = ord[0].t;
  const fatias = Math.round((fimSegundos - origem) * fps);
  if (fatias <= 0) return [];

  const escolhidos = [];
  let cursor = 0;
  for (let k = 0; k < fatias; k++) {
    const tempo = origem + k / fps;
    // Avanca ate ao ultimo quadro que ja tinha sido pintado neste instante.
    while (cursor + 1 < ord.length && ord[cursor + 1].t <= tempo) cursor++;
    escolhidos.push(ord[cursor].ficheiro);
  }
  return escolhidos;
}

/**
 * Materializa a sequencia como ligacoes simbolicas numeradas.
 *
 * Ligacoes e nao copias: um video de quatro minutos sao 7200 fatias, e copiar
 * o mesmo JPEG centenas de vezes durante um trecho parado encheria o disco sem
 * necessidade nenhuma.
 */
async function escreverSequencia(escolhidos, dir) {
  const seq = join(dir, 'seq');
  await rm(seq, { recursive: true, force: true });
  await mkdir(seq, { recursive: true });
  for (let k = 0; k < escolhidos.length; k++) {
    await symlink(join('..', escolhidos[k]), join(seq, `${String(k).padStart(6, '0')}.jpg`));
  }
  return seq;
}

/**
 * Liga o screencast do CDP e coleciona os quadros em disco.
 *
 * Responder `screencastFrameAck` a todos os quadros nao e opcional: o Chromium
 * para de enviar se um ack se perder, e a gravacao continua a correr sem
 * imagem nenhuma.
 */
export async function colectar(page, dir, { largura = 820, altura = 1180, fps = 30 } = {}) {
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
      const escolhidos = escolherQuadros(quadros, fim, fps);
      await escreverSequencia(escolhidos, dir);
      // Os carimbos crus, para a sequencia poder ser reconstruida sem
      // re-gravar. Sem isto, mudar a regra de reamostragem obriga a repetir a
      // gravacao inteira - que foi o que custou quando o demuxer esticou o
      // video e a correcao chegou depois dos quadros ja estarem em disco.
      await writeFile(join(dir, 'quadros.json'), JSON.stringify({ fps, fim, quadros }));
      return {
        total: quadros.length,
        fatias: escolhidos.length,
        fim,
        dimensao: await medirQuadro(quadros, dir)
      };
    }
  };
}
