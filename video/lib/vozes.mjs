import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extrairAudioSSE } from './sseAudio.mjs';
import { divergencia } from './divergencia.mjs';
import { escreverWav, converterParaWav, correr, medirFala } from './pcm.mjs';

// Em ordem de preferência: o `mini` é ~4x mais barato e chega para locução.
// O irmão maior existe como degrau, porque o `mini` já ficou indisponível a
// meio de uma gravação — pendurado, sem devolver nada e sem fechar a ligação,
// enquanto o `gpt-audio` respondia em 1,2 s.
export const MODELOS = ['openai/gpt-audio-mini', 'openai/gpt-audio'];

// Quanto o modelo pode desviar-se do texto pedido antes de abortarmos.
// Razão de 35%, mas nunca menos que 2 palavras: numa fala de quatro palavras
// uma troca já dá 25%, e reprovar uma fala boa por ser curta seria pior que o
// problema que isto resolve. Ver `divergencia.test.js`.
const RAZAO_MAXIMA = 0.35;
const PALAVRAS_TOLERADAS = 2;

/**
 * Ritmo acima do qual a fala so pode estar cortada.
 *
 * Medido no corpo real das 56 falas destes videos: a mediana e 12,8 caracteres
 * por segundo e a mais rapida das boas fica em 16. Tres falas gravadas durante
 * a instabilidade do OpenRouter saiam a 22, 28 e 35 car/s — o modelo parava a
 * meio da frase e o resto do ficheiro vinha em silencio. A legenda mostrava a
 * frase inteira e a voz dizia so o comeco.
 */
const RITMO_MAXIMO_CAR_POR_SEG = 20;

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

// Texto da sonda de disponibilidade: comprimento típico de uma fala real.
const SONDA = 'Toque no botão para escolher o material que você quer ver na lista.';

async function viaOpenRouter(texto, voz, sistema = SISTEMA, modelo = MODELOS[0]) {
  const chave = process.env.OPENROUTER_API_KEY;
  if (!chave) throw new Error('OPENROUTER_API_KEY não está definida');

  const resposta = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelo,
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

  // Transcricao vazia nao pode ser passe livre.
  //
  // O guarda de divergencia so corria `if (transcricao && ...)`: quando o
  // modelo devolvia audio sem transcricao nenhuma, a verificacao era saltada
  // por completo — que e exatamente o caso em que ela era mais precisa.
  if (!transcricao) {
    const e = new Error('o modelo devolveu audio sem transcricao; nao da para conferir o que foi dito');
    e.deConteudo = true;
    throw e;
  }

  if (excedeu(texto, transcricao)) {
    const e = new Error(
      `o modelo não leu o que foi pedido (divergência ${divergencia(texto, transcricao).toFixed(2)}).\n` +
      `  pedido: ${texto}\n  dito:   ${transcricao}`
    );
    e.deConteudo = true;   // é isto que faz a repetição escalar o prompt
    throw e;
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
/**
 * Reprova uma fala cortada a meio.
 *
 * Um fluxo interrompido devolve audio parcial sem erro nenhum: o ficheiro fica
 * com o comeco da frase e silencio ate ao fim. Comparar os caracteres do texto
 * com os segundos de VOZ (sem o silencio final) apanha isso — ninguem fala a
 * 35 caracteres por segundo.
 */
async function conferirRitmo(texto, caminho) {
  const { fala } = await medirFala(caminho);
  if (fala <= 0.2) {
    const e = new Error('a fala saiu em silencio');
    e.deConteudo = true;
    throw e;
  }
  const ritmo = texto.length / fala;
  if (ritmo > RITMO_MAXIMO_CAR_POR_SEG) {
    const e = new Error(
      `a fala saiu cortada: ${texto.length} caracteres em ${fala.toFixed(2)} s de voz ` +
      `(${ritmo.toFixed(1)} car/s; o maximo plausivel e ${RITMO_MAXIMO_CAR_POR_SEG})`
    );
    e.deConteudo = true;
    throw e;
  }
}

export async function sintetizar(texto, { provedor, voz, destino, modelo = MODELOS[0], tentativas = 3 }) {
  if (provedor === 'macos') {
    await viaMacos(texto, voz, destino);
    return;
  }
  // Duas falhas diferentes, dois remédios diferentes.
  //
  // Falha de CONTEÚDO (o modelo não leu o que foi pedido): com
  // `temperature: 0` a chamada é determinística, então repetir igual daria
  // igual — só escalando o prompt é que muda alguma coisa.
  //
  // Falha de REDE (o pedido pendurou até ao teto, ou o servidor recusou): o
  // prompt não tem culpa nenhuma. Escalá-lo seria tratar a doença errada;
  // o que serve é esperar um pouco e pedir o mesmo outra vez.
  let sistema = SISTEMA;
  let ultima;

  for (let i = 0; i < tentativas; i++) {
    try {
      const pcm = await viaOpenRouter(texto, voz, sistema, modelo);
      await escreverWav(pcm, destino);
      await conferirRitmo(texto, destino);
      return;
    } catch (e) {
      ultima = e;
      if (i >= tentativas - 1) break;

      if (e.deConteudo) {
        sistema = SISTEMA_INSISTENTE;
        process.stderr.write(`    tentativa ${i + 1}: o modelo improvisou, repetindo com prompt reforçado\n`);
      } else {
        const espera = 2000 * (i + 1);
        process.stderr.write(
          `    tentativa ${i + 1} falhou na rede (${e.message.split('\n')[0]}), ` +
          `repetindo em ${espera / 1000} s\n`
        );
        await new Promise((r) => setTimeout(r, espera));
      }
    }
  }
  throw ultima;
}

/**
 * Escolhe UM modelo para o vídeo inteiro, sondando qual está de pé.
 *
 * Um por vídeo, e não um por beat: alternar de modelo a meio faz o timbre mudar
 * entre uma frase e a seguinte, e um tutorial que troca de voz no meio soa
 * partido. Melhor gastar dois centésimos de centavo a sondar do que entregar
 * isso.
 */
export async function escolherModelo(voz) {
  if (process.env.VIDEO_MODELO) return process.env.VIDEO_MODELO;

  for (const modelo of MODELOS) {
    try {
      // A sonda usa uma frase do tamanho de uma fala de verdade, e não uma
      // palavra: com "Teste." o `mini` respondeu e depois pendurou em todas as
      // chamadas reais. Uma sonda que não parece com o trabalho não prova nada.
      await viaOpenRouter(SONDA, voz, SISTEMA, modelo);
      process.stderr.write(`  modelo: ${modelo}\n`);
      return modelo;
    } catch (e) {
      process.stderr.write(`  ${modelo} indisponível (${e.message.split('\n')[0]})\n`);
    }
  }
  throw new Error(`nenhum modelo de áudio respondeu: ${MODELOS.join(', ')}`);
}

export function configuracaoPadrao() {
  const provedor = process.env.VIDEO_TTS || 'openrouter';
  const voz = process.env.VIDEO_VOZ || (provedor === 'macos' ? 'Luciana' : 'alloy');
  return { provedor, voz };
}
