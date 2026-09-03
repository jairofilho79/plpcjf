import { spawn } from 'node:child_process';

/**
 * Corre um binário e resolve com o stdout, rejeitando com o stderr quando o
 * código de saída não é zero. Um ffmpeg que falha em silêncio produz vídeo
 * mudo, e isso só se descobre no fim — daí a rejeição explícita.
 */
function correr(bin, args, entrada = null, { comErro = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (codigo) => {
      // `comErro` porque o ffmpeg escreve os relatorios de analise (volumedetect,
      // ebur128) no stderr, nao no stdout. Ler so o stdout fazia a checagem de
      // pico de audio nunca disparar - ela existia e nunca correu.
      if (codigo === 0) resolve(comErro ? { out, err } : out);
      else reject(new Error(`${bin} saiu com ${codigo}: ${err.slice(-800)}`));
    });
    if (entrada) {
      p.stdin.on('error', () => {});   // ffmpeg pode fechar o stdin antes do fim
      p.stdin.end(entrada);
    } else {
      p.stdin.end();
    }
  });
}

/** PCM16 24 kHz mono (o formato que o gpt-audio devolve) para WAV. */
export async function escreverWav(pcm, destino) {
  if (!pcm || pcm.length === 0) throw new Error(`PCM vazio para ${destino}`);
  await correr('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0',
    destino
  ], pcm);
}

/** Converte qualquer coisa que o ffmpeg leia num WAV. */
export async function converterParaWav(origem, destino) {
  await correr('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', origem, destino]);
}

export async function duracaoSegundos(caminho) {
  const out = await correr('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', caminho
  ]);
  const d = parseFloat(out.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error(`duração inválida em ${caminho}: ${out.trim()}`);
  return d;
}

/**
 * Mede quanto do ficheiro e VOZ, ignorando o silencio do fim.
 *
 * O `silencedetect` escreve no stderr, nao no stdout — ler so o stdout devolve
 * sempre "nao ha silencio", que e como tres falas truncadas passaram
 * despercebidas. Mesmo tropecao que a medicao de pico ja tinha dado.
 */
export async function medirFala(caminho) {
  const total = await duracaoSegundos(caminho);
  const { err } = await correr(
    'ffmpeg',
    ['-hide_banner', '-nostdin', '-i', caminho, '-af', 'silencedetect=noise=-45dB:d=0.4', '-f', 'null', '-'],
    null,
    { comErro: true }
  ).catch((e) => ({ err: e.message }));

  const texto = err || '';
  const inicios = [...texto.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const fins = [...texto.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));

  // So conta o silencio que vai ate ao fim do ficheiro: pausas no meio da
  // frase sao fala, nao corte.
  let fala = total;
  if (inicios.length && (fins.length === 0 || fins.at(-1) >= total - 0.05)) {
    fala = inicios.at(-1);
  }
  return { total, fala: Math.max(0, fala) };
}

/** Corta o silencio das duas pontas, mantendo uma margem curta. */
export async function recortarSilencio(origem, destino) {
  await correr('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', origem,
    '-af',
    'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1:detection=peak,' +
      'areverse,' +
      'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.25:detection=peak,' +
      'areverse',
    destino
  ]);
}

export { correr };
