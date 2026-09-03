import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extrairAudioSSE } from './sseAudio.mjs';
import { divergencia } from './divergencia.mjs';
import { escreverWav, converterParaWav, correr } from './pcm.mjs';

const MODELO = 'openai/gpt-audio-mini';

// Quanto o modelo pode desviar-se do texto pedido antes de abortarmos.
// Razão de 35%, mas nunca menos que 2 palavras: numa fala de quatro palavras
// uma troca já dá 25%, e reprovar uma fala boa por ser curta seria pior que o
// problema que isto resolve. Ver `divergencia.test.js`.
const RAZAO_MAXIMA = 0.35;
const PALAVRAS_TOLERADAS = 2;

// A instrução vive no `system` e o texto vai cru no `user`.
//
// Com tudo junto numa mensagem de utilizador, o modelo trata o pedido como uma
// conversa e responde antes de ler: a primeira tentativa saiu com "Claro. Vou
// ler o texto com calma e de forma didática." colado à frente da fala — que
// teria ido parar dentro do tutorial. Separar os papéis é o que faz o modelo
// entender-se como motor de voz e não como interlocutor.
const SISTEMA =
  'Você é um motor de texto-para-fala. Sua única saída é o áudio da mensagem do ' +
  'usuário, lida literalmente, em português do Brasil, com voz calma e didática, ' +
  'como quem ensina alguém a usar um aplicativo. NUNCA diga nada além do texto ' +
  'recebido: nada de saudação, confirmação, comentário, introdução ou despedida. ' +
  'Não leia aspas nem anuncie o que vai fazer. Comece direto na primeira palavra ' +
  'do texto e pare na última.';

function excedeu(pedido, dito) {
  const n = pedido.trim().split(/\s+/).filter(Boolean).length;
  if (n === 0) return false;
  const toleradoEmRazao = Math.max(RAZAO_MAXIMA, PALAVRAS_TOLERADAS / n);
  return divergencia(pedido, dito) > toleradoEmRazao;
}

async function viaOpenRouter(texto, voz) {
  const chave = process.env.OPENROUTER_API_KEY;
  if (!chave) throw new Error('OPENROUTER_API_KEY não está definida');

  const resposta = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELO,
      // Sem `stream: true` o endpoint recusa saída de áudio com
      // `400 Audio output requires stream: true`. Não é opcional.
      stream: true,
      modalities: ['text', 'audio'],
      audio: { voice: voz, format: 'pcm16' },
      messages: [
        { role: 'system', content: SISTEMA },
        { role: 'user', content: texto }
      ]
    })
  });
  if (!resposta.ok) throw new Error(`OpenRouter ${resposta.status}: ${(await resposta.text()).slice(0, 400)}`);

  const { pcmBase64, transcricao, erro } = extrairAudioSSE(await resposta.text());
  if (erro) throw new Error(`OpenRouter devolveu erro no fluxo: ${JSON.stringify(erro)}`);
  if (pcmBase64.length === 0) throw new Error('OpenRouter não devolveu áudio nenhum');

  if (transcricao && excedeu(texto, transcricao)) {
    throw new Error(
      `o modelo não leu o que foi pedido (divergência ${divergencia(texto, transcricao).toFixed(2)}).\n` +
      `  pedido: ${texto}\n  dito:   ${transcricao}`
    );
  }

  return Buffer.concat(pcmBase64.map((b) => Buffer.from(b, 'base64')));
}

async function viaMacos(texto, voz, destino) {
  const dir = await mkdtemp(join(tmpdir(), 'plpc-voz-'));
  const aiff = join(dir, 'v.aiff');
  try {
    await correr('say', ['-v', voz, '-o', aiff, texto]);
    await converterParaWav(aiff, destino);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Sintetiza uma fala e escreve o WAV em `destino`.
 *
 * `openrouter` é a escolha real (gpt-audio-mini, voz alloy). `macos` existe só
 * para validar o encanamento sem gastar e sem rede — as vozes do `say` foram
 * ouvidas e reprovadas.
 */
export async function sintetizar(texto, { provedor, voz, destino, tentativas = 3 }) {
  if (provedor === 'macos') {
    await viaMacos(texto, voz, destino);
    return;
  }
  // Numa corrida de 49 beats, um improviso isolado do modelo abortaria tudo o
  // que já tinha sido sintetizado. Tentar de novo é mais barato que recomeçar,
  // e o guarda de divergência continua a ter a última palavra.
  let ultima;
  for (let i = 1; i <= tentativas; i++) {
    try {
      const pcm = await viaOpenRouter(texto, voz);
      await escreverWav(pcm, destino);
      return;
    } catch (e) {
      ultima = e;
      if (i < tentativas) process.stderr.write(`    tentativa ${i} falhou (${e.message.split('\n')[0]}), repetindo\n`);
    }
  }
  throw ultima;
}

export function configuracaoPadrao() {
  const provedor = process.env.VIDEO_TTS || 'openrouter';
  const voz = process.env.VIDEO_VOZ || (provedor === 'macos' ? 'Luciana' : 'alloy');
  return { provedor, voz };
}
