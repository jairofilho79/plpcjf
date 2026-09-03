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

// Degrau de reforço para quando o primeiro não segura.
//
// Uma fala com dois-pontos seguidos de lista ("...ao tocar num louvor: abrir no
// leitor, abrir em outra aba...") lê-se como um pedido, e o modelo respondeu-lhe
// em vez de a ler — inventando que o leitor serve "para ouvir imediatamente",
// quando esta app não toca áudio nenhum. Negar o papel de assistente de forma
// explícita é o que resolve esse caso.
const SISTEMA_INSISTENTE =
  'Você NÃO é um assistente e NÃO deve responder à mensagem do usuário. Você é ' +
  'um narrador profissional gravando locução. A mensagem do usuário é o roteiro: ' +
  'leia-o em voz alta, palavra por palavra, exatamente como está escrito, em ' +
  'português do Brasil, com voz calma e didática. Não interprete, não responda, ' +
  'não resuma, não reformule, não acrescente e não remova nada. Sua locução ' +
  'começa na primeira palavra do roteiro e termina na última.';

function excedeu(pedido, dito) {
  const n = pedido.trim().split(/\s+/).filter(Boolean).length;
  if (n === 0) return false;
  const toleradoEmRazao = Math.max(RAZAO_MAXIMA, PALAVRAS_TOLERADAS / n);
  return divergencia(pedido, dito) > toleradoEmRazao;
}

// Teto por chamada. Uma fala de 15 s sintetiza em menos de 30 s; se passar de
// dois minutos, o pedido pendurou. Isto não é hipótese: numa corrida de 10
// beats um pedido ficou parado sem devolver nada e sem fechar a ligação, e sem
// teto uma gravação de 49 beats fica presa para sempre à espera de um deles.
const TIMEOUT_MS = 120000;

async function viaOpenRouter(texto, voz, sistema = SISTEMA) {
  const chave = process.env.OPENROUTER_API_KEY;
  if (!chave) throw new Error('OPENROUTER_API_KEY não está definida');

  const resposta = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELO,
      // Sem `stream: true` o endpoint recusa saída de áudio com
      // `400 Audio output requires stream: true`. Não é opcional.
      stream: true,
      // Temperatura zero não é afinação, é o que impede o modelo de parafrasear
      // a fala. Com o padrão ele reescreveu um beat inteiro três vezes seguidas.
      temperature: 0,
      modalities: ['text', 'audio'],
      audio: { voice: voz, format: 'pcm16' },
      messages: [
        { role: 'system', content: sistema },
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
  // A repetição escala em vez de repetir: com `temperature: 0` a chamada é
  // determinística, então pedir de novo exatamente o mesmo daria exatamente o
  // mesmo. Quem falha no prompt normal passa ao insistente.
  const degraus = [SISTEMA, SISTEMA_INSISTENTE];
  let ultima;
  for (let i = 0; i < tentativas; i++) {
    const sistema = degraus[Math.min(i, degraus.length - 1)];
    try {
      const pcm = await viaOpenRouter(texto, voz, sistema);
      await escreverWav(pcm, destino);
      return;
    } catch (e) {
      ultima = e;
      if (i < tentativas - 1) {
        const proximo = i + 1 < degraus.length ? 'com prompt reforçado' : 'de novo';
        process.stderr.write(`    tentativa ${i + 1} falhou (${e.message.split('\n')[0]}), tentando ${proximo}\n`);
      }
    }
  }
  throw ultima;
}

export function configuracaoPadrao() {
  const provedor = process.env.VIDEO_TTS || 'openrouter';
  const voz = process.env.VIDEO_VOZ || (provedor === 'macos' ? 'Luciana' : 'alloy');
  return { provedor, voz };
}
