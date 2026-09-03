import { spawn } from 'node:child_process';

/**
 * Corre um binário e resolve com o stdout, rejeitando com o stderr quando o
 * código de saída não é zero. Um ffmpeg que falha em silêncio produz vídeo
 * mudo, e isso só se descobre no fim — daí a rejeição explícita.
 */
function correr(bin, args, entrada = null) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (codigo) => {
      if (codigo === 0) resolve(out);
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

export { correr };
