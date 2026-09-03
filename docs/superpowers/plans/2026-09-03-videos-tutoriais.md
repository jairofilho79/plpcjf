# Vídeos tutoriais da página "Como Usar" — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produzir os cinco vídeos tutoriais que `src/routes/sobre/+page.svelte` promete desde sempre, com narração, legenda, zoom e música de domínio público, e publicá-los.

**Architecture:** Um pipeline de cinco estágios sob `video/`, onde o roteiro de cada vídeo é código e é a única fonte da verdade. A narração é sintetizada **primeiro**, porque a duração da fala é que determina quanto tempo cada passo fica na tela; a gravação é feita por Playwright dirigindo produção num tablet em retrato, capturando quadros por `Page.startScreencast` do CDP — cujos carimbos de tempo vivem no mesmo relógio dos beats, o que elimina a deriva entre imagem, legenda e voz; a montagem é um `filter_complex` do ffmpeg gerado por uma função pura.

**Tech Stack:** Node 25 + Playwright (Chromium), CDP, ffmpeg 8.1, Python 3.9 (numpy, PIL), `node --test`, SvelteKit 2 / Svelte 4.

**Spec:** `docs/superpowers/specs/2026-09-03-videos-tutoriais-design.md`

## Global Constraints

- **Runner de teste:** `node --test` apenas. Sem vitest, sem jest. `npm test` continua a ser só a app; o pipeline de vídeo ganha `npm run test:video` = `node --test $(find video -name '*.test.js')`. Nenhum teste do vídeo entra em `src/`.
- **`src/` é tocado num único sítio, na última tarefa:** `src/routes/sobre/+page.svelte`. Nada mais. Em particular, `src/lib/offline/**`, `src/lib/server/r2KeyMatch.js` e `worker/` não são tocados.
- **Idioma:** comentários de código, nomes de função, narração e legenda em português do Brasil.
- **Nada sai da máquina sem pedido explícito:** sem `git push`, sem `npm run deploy`. O upload ao R2 (Task 11) é o único passo que publica, e pára para confirmação antes de correr.
- **Gravação é só leitura.** Corre contra `https://plpcg.com` num perfil efémero. Nenhuma escrita no servidor.
- **Formato fixo:** mestre 1640×2360, saída 820×1180, 30 fps, H.264 `yuv420p`, AAC, `+faststart`.
- **`video/build/` e `video/.cache/` entram no `.gitignore`.** Nenhum binário de vídeo ou áudio é commitado.
- **Áudio:** pico ≤ −1 dBFS, integrada ≈ −16 LUFS, música a −22 dB sob a narração via `sidechaincompress`.
- **Este ffmpeg não tem `libass` nem `drawtext`.** Legenda é sempre PNG sobreposto. Nunca escrever um passo que use `subtitles=` ou `drawtext=`.
- **O portão `npm run check:offline` já sai com 10 erros no `HEAD` `49fcdc0`,** todos em `src/lib/offline/utils/leitorOffline.test.js`. Não é regressão deste trabalho e não é corrigido por ele. O critério é: **não aumentar** esse número.

---

## Estrutura de ficheiros

| Ficheiro | Tarefa | Responsabilidade |
|---|---|---|
| `video/musica.py` | 1 | Sintetiza o leito musical (Bach BWV 846) com numpy |
| `video/lib/pcm.mjs` | 2 | PCM16 → WAV; medição de duração por `ffprobe` |
| `video/lib/sseAudio.mjs` | 2 | Extrai áudio e transcrição do SSE do OpenRouter |
| `video/lib/sseAudio.test.js` | 2 | Testa o extractor com SSE de mentira |
| `video/narrar.mjs` | 2 | Orquestra a síntese por beat, com cache por hash |
| `video/lib/vozes.mjs` | 2 | Os dois provedores (`openrouter`, `macos`) atrás de uma interface |
| `video/lib/toque.mjs` | 3 | O `initScript` que desenha o indicador de toque |
| `video/lib/gestos.mjs` | 3 | `tocar`, `toqueLongo`, `arrastar`, `deslizar`, `pinçar` via CDP |
| `video/lib/screencast.mjs` | 3 | Colecta quadros carimbados e escreve o ficheiro de concatenação |
| `video/lib/screencast.test.js` | 3 | Testa a construção do ficheiro de concatenação |
| `video/gravar.mjs` | 3 | Corre um roteiro, emite `quadros/` + `timeline.json` |
| `video/lib/quebraLinha.mjs` | 4 | Quebra de linha da legenda |
| `video/lib/quebraLinha.test.js` | 4 | Testa a quebra |
| `video/legenda_png.py` | 4 | Rasteriza uma legenda em PNG transparente |
| `video/legendar.mjs` | 4 | timeline → PNGs + `.vtt` |
| `video/lib/filtergraph.mjs` | 5 | **Função pura:** timeline → `filter_complex` |
| `video/lib/filtergraph.test.js` | 5 | Testa o grafo gerado |
| `video/montar.mjs` | 5 | Corre o ffmpeg e verifica a saída |
| `video/lib/verificar.mjs` | 5 | Portão de qualidade por `ffprobe` |
| `video/roteiros/03-biblioteca.mjs` | 6 | Roteiro do vídeo 3 |
| `video/roteiros/01-uso-basico.mjs` | 7 | Roteiro do vídeo 1 |
| `video/roteiros/04-listas.mjs` | 8 | Roteiro do vídeo 4 |
| `video/roteiros/02-offline.mjs` | 9 | Roteiro do vídeo 2 |
| `video/roteiros/05-problemas.mjs` | 10 | Roteiro do vídeo 5 |
| `video/publicar.mjs` | 11 | Upload ao R2 |
| `src/routes/sobre/+page.svelte` | 11 | Os cinco `<video>` com fallback |

### O formato do roteiro (contrato que todas as tarefas 6–10 respeitam)

```js
// video/roteiros/03-biblioteca.mjs
export default {
  id: '03-biblioteca',
  titulo: 'Uso da Biblioteca',
  url: 'https://plpcg.com/biblioteca',
  beats: [
    {
      id: 'abertura',
      fala: 'A Biblioteca serve para navegar o acervo inteiro, quando você não sabe o número do louvor.',
      zoom: null,                       // ou { seletor: '...', margem: 24 }
      acao: async (p, ui) => { await ui.esperar('.louvores-container'); }
    }
  ]
};
```

`fala` alimenta três saídas — voz, legenda queimada e `.vtt`. Não existe campo de
duração: a duração do beat é a da fala mais `FOLGA_MS` (600 ms).

---

## Task 1 — leito musical de domínio público

**Files:**
- Create: `video/musica.py`
- Create: `video/README.md`
- Modify: `.gitignore`
- Modify: `package.json` (script `musica`)

**Interfaces:**
- Produces: `video/build/leito-musical.wav` — WAV 44,1 kHz estéreo, ≥ 240 s, pico ≤ −3 dBFS.

- [ ] **Step 1: `.gitignore` e o README do diretório**

Acrescentar ao `.gitignore`:

```
# Pipeline de vídeo: saídas e cache nunca entram no histórico
video/build/
video/.cache/
```

Criar `video/README.md` com um parágrafo dizendo o que o diretório é, a ordem do
pipeline (`musica → narrar → gravar → legendar → montar → publicar`) e a nota de
que `video/build/` é descartável.

- [ ] **Step 2: escrever `video/musica.py`**

Síntese aditiva do Prelúdio nº 1 em Dó maior, BWV 846, de J. S. Bach — obra em
domínio público; a gravação gerada aqui é nossa. O padrão do prelúdio é um arpejo
de cinco notas repetido duas vezes por compasso sobre um acorde. Codificar os
acordes como listas de notas MIDI e deixar o arpejador gerar as notas:

```python
#!/usr/bin/env python3
"""Leito musical dos vídeos tutoriais.

Prelúdio nº 1 em Dó maior, BWV 846, de J. S. Bach (1685-1750): a obra está em
domínio público e a gravação produzida aqui é nossa. Nenhum acervo de terceiros
está envolvido, que é exatamente onde mora o risco de direitos quando se "baixa
uma clássica de graça".
"""
import numpy as np, wave, os

TAXA = 44100
# Cada compasso é um acorde; o arpejo de Bach toca as 5 notas e repete.
# Notas em MIDI, do grave para o agudo. Os 16 primeiros compassos bastam.
COMPASSOS = [
    [48, 52, 55, 60, 64], [48, 50, 57, 62, 65], [47, 50, 55, 62, 65],
    [48, 52, 55, 60, 64], [48, 52, 57, 64, 69], [48, 50, 54, 57, 62],
    [47, 50, 55, 62, 67], [47, 48, 52, 55, 60], [45, 48, 52, 55, 60],
    [50, 57, 62, 66, 72], [43, 47, 50, 55, 59], [43, 46, 52, 55, 61],
    [41, 45, 50, 57, 62], [41, 44, 50, 53, 59], [40, 43, 48, 55, 60],
    [40, 41, 45, 48, 53],
]

def frequencia(midi):
    return 440.0 * (2 ** ((midi - 69) / 12.0))

def nota(midi, dur, taxa=TAXA):
    """Uma nota: parciais harmónicas com decaimento, envelope de corda dedilhada."""
    n = int(dur * taxa)
    t = np.arange(n) / taxa
    f = frequencia(midi)
    onda = np.zeros(n)
    for k, peso in enumerate([1.0, 0.42, 0.18, 0.09, 0.04], start=1):
        onda += peso * np.sin(2 * np.pi * f * k * t)
    ataque = int(0.006 * taxa)
    env = np.exp(-t * 2.6)
    env[:ataque] *= np.linspace(0.0, 1.0, ataque)
    return onda * env

def sintetizar():
    passo = 0.30                      # duração de cada semicolcheia do arpejo
    total = int(len(COMPASSOS) * 8 * passo * TAXA) + TAXA * 3
    mix = np.zeros(total)
    pos = 0
    for acorde in COMPASSOS:
        # o arpejo de Bach: 1 2 3 4 5 4 3 (e repete o compasso)
        padrao = [0, 1, 2, 3, 4, 3, 2, 3]
        for _ in range(2):
            for idx in padrao:
                n = nota(acorde[idx], 1.6)
                fim = min(pos + len(n), total)
                mix[pos:fim] += n[:fim - pos]
                pos += int(passo * TAXA)
    # reverberação curta por convolução com ruído decrescente
    cauda = int(0.5 * TAXA)
    ir = np.random.default_rng(7).normal(0, 1, cauda) * np.exp(-np.arange(cauda) / (0.12 * TAXA))
    molhado = np.convolve(mix, ir, mode='same')
    saida = 0.82 * mix + 0.18 * (molhado / (np.max(np.abs(molhado)) or 1.0)) * np.max(np.abs(mix))
    saida = saida / (np.max(np.abs(saida)) or 1.0) * 0.70     # pico em -3 dBFS
    return np.stack([saida, saida], axis=1)

if __name__ == '__main__':
    os.makedirs('video/build', exist_ok=True)
    est = sintetizar()
    with wave.open('video/build/leito-musical.wav', 'w') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(TAXA)
        w.writeframes((est * 32767).astype('<i2').tobytes())
    print('leito musical:', est.shape[0] / TAXA, 's')
```

**Nota sobre os acordes:** são os 16 primeiros compassos do prelúdio, cada um
como as cinco alturas do arpejo, do grave para o agudo. O padrão de Bach dentro do
compasso é `n1 n2 n3 n4 n5 n3 n4 n5`, repetido duas vezes.

- [ ] **Step 3: acrescentar o script ao `package.json`**

```json
"musica": "python3 video/musica.py"
```

- [ ] **Step 4: correr e verificar**

```bash
npm run musica
ffprobe -v error -show_entries format=duration -of csv=p=0 video/build/leito-musical.wav
ffmpeg -hide_banner -i video/build/leito-musical.wav -af volumedetect -f null - 2>&1 | grep max_volume
```

Esperado: duração ≥ 240 s e `max_volume` entre −4 e −2,5 dB.

- [ ] **Step 5: commit**

```bash
git add .gitignore video/README.md video/musica.py package.json
git commit -m "vídeo(música): leito de Bach em domínio público, sintetizado aqui"
```

---

## Task 2 — narração, e as durações que ela dita

**Files:**
- Create: `video/lib/sseAudio.mjs`, `video/lib/sseAudio.test.js`, `video/lib/pcm.mjs`, `video/lib/vozes.mjs`, `video/narrar.mjs`
- Modify: `package.json` (scripts `test:video`, `narrar`)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `extrairAudioSSE(texto: string) -> { pcmBase64: string[], transcricao: string, erro: object|null }`
  - `escreverWav(pcm: Buffer, destino: string) -> Promise<void>` (PCM16 24 kHz mono)
  - `duracaoSegundos(caminho: string) -> Promise<number>`
  - `sintetizar(texto: string, opcoes: {provedor, voz, destino}) -> Promise<{caminho: string, duracao: number}>`
  - `video/build/<roteiro>/falas.json`: `{ [beatId]: { caminho: string, duracao: number, hash: string } }`

- [ ] **Step 1: escrever o teste que falha**

O extractor é a única peça com regras suficientes para errar em silêncio: o
OpenRouter fatia o base64 pelos deltas do SSE, mistura linhas de `usage`, e
sinaliza erro dentro do fluxo em vez de no código HTTP. Criar
`video/lib/sseAudio.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { extrairAudioSSE } from './sseAudio.mjs';

describe('extrairAudioSSE', () => {
  test('junta os pedaços de base64 na ordem em que chegam', () => {
    const sse = [
      'data: {"choices":[{"delta":{"audio":{"data":"AAA="}}}]}',
      'data: {"choices":[{"delta":{"audio":{"data":"BBB="}}}]}',
      'data: [DONE]'
    ].join('\n');
    const r = extrairAudioSSE(sse);
    assert.deepEqual(r.pcmBase64, ['AAA=', 'BBB=']);
    assert.equal(r.erro, null);
  });

  test('acumula a transcrição, que é como sabemos se o modelo improvisou', () => {
    const sse = [
      'data: {"choices":[{"delta":{"audio":{"transcript":"Toque em "}}}]}',
      'data: {"choices":[{"delta":{"audio":{"transcript":"Filtros."}}}]}',
      'data: [DONE]'
    ].join('\n');
    assert.equal(extrairAudioSSE(sse).transcricao, 'Toque em Filtros.');
  });

  test('linhas que não são delta de áudio não poluem o resultado', () => {
    const sse = [
      ': comentário de keep-alive',
      'data: {"usage":{"cost":0.0008}}',
      'data: {"choices":[{"delta":{"content":"texto"}}]}',
      'data: {"choices":[{"delta":{"audio":{"data":"CCC="}}}]}',
      'data: [DONE]'
    ].join('\n');
    const r = extrairAudioSSE(sse);
    assert.deepEqual(r.pcmBase64, ['CCC=']);
    assert.equal(r.transcricao, '');
  });

  test('erro dentro do fluxo é devolvido, não engolido', () => {
    // O OpenRouter responde 200 e põe a falha no corpo. Tratar isto como
    // "sem áudio" produziria um wav de zero byte e um vídeo mudo sem aviso.
    const sse = 'data: {"error":{"message":"rate limited","code":429}}\ndata: [DONE]';
    const r = extrairAudioSSE(sse);
    assert.equal(r.erro.code, 429);
    assert.deepEqual(r.pcmBase64, []);
  });

  test('JSON partido numa linha não derruba as linhas boas', () => {
    const sse = [
      'data: {"choices":[{"delta":{"audio":{"data":"DDD="}}}',
      'data: {"choices":[{"delta":{"audio":{"data":"EEE="}}}]}',
      'data: [DONE]'
    ].join('\n');
    assert.deepEqual(extrairAudioSSE(sse).pcmBase64, ['EEE=']);
  });
});
```

- [ ] **Step 2: acrescentar `test:video` ao `package.json` e correr o teste para vê-lo falhar**

```json
"test:video": "node --test $(find video -name '*.test.js')"
```

Run: `npm run test:video`
Expected: FAIL — `Cannot find module './sseAudio.mjs'`

- [ ] **Step 3: implementar `video/lib/sseAudio.mjs`**

```js
/**
 * Extrai áudio e transcrição de uma resposta SSE do OpenRouter.
 *
 * O endpoint recusa saída de áudio sem `stream: true` (devolve
 * `400 Audio output requires stream: true`), então o áudio chega sempre
 * fatiado nos deltas — nunca num campo único. E o erro vem *dentro* do fluxo,
 * com HTTP 200 por fora: por isso `erro` é um valor de retorno e não uma
 * exceção do transporte.
 */
export function extrairAudioSSE(texto) {
  const pcmBase64 = [];
  let transcricao = '';
  let erro = null;

  for (const linha of texto.split('\n')) {
    const t = linha.trim();
    if (!t.startsWith('data:')) continue;
    const carga = t.slice(5).trim();
    if (carga === '[DONE]') break;

    let d;
    try { d = JSON.parse(carga); } catch { continue; }   // linha truncada: ignora

    if (d.error && !erro) erro = d.error;
    for (const escolha of d.choices || []) {
      const audio = (escolha.delta || {}).audio;
      if (!audio) continue;
      if (audio.data) pcmBase64.push(audio.data);
      if (audio.transcript) transcricao += audio.transcript;
    }
  }
  return { pcmBase64, transcricao, erro };
}
```

- [ ] **Step 4: correr o teste**

Run: `npm run test:video`
Expected: PASS, 5 testes.

- [ ] **Step 5: implementar `video/lib/pcm.mjs`**

`escreverWav(pcm, destino)` invoca `ffmpeg -f s16le -ar 24000 -ac 1 -i pipe:0 -y <destino>`
escrevendo o buffer no `stdin`. `duracaoSegundos(caminho)` invoca
`ffprobe -v error -show_entries format=duration -of csv=p=0 <caminho>` e devolve
`parseFloat`. Ambos por `child_process.spawn`, rejeitando com o `stderr` quando o
código de saída não é 0 — um ffmpeg que falha em silêncio produz vídeo mudo.

- [ ] **Step 6: implementar `video/lib/vozes.mjs`**

Dois provedores atrás de `async sintetizarBruto(texto, voz) -> Buffer` (WAV):

- `openrouter`: `POST https://openrouter.ai/api/v1/chat/completions` com
  `{ model: 'openai/gpt-audio-mini', stream: true, modalities: ['text','audio'],
  audio: { voice, format: 'pcm16' } }`, `Authorization: Bearer ${process.env.OPENROUTER_API_KEY}`.
  O `messages[0].content` instrui: *"Leia exatamente este texto em português do
  Brasil, com voz calma e didática, sem acrescentar, remover ou comentar nada:"*
  seguido da fala. Passa o corpo por `extrairAudioSSE`; se `erro`, lança.
  **Verifica a transcrição:** se a distância de Levenshtein normalizada entre
  `transcricao` e o texto pedido passar de 0,25, lança — o modelo improvisou, e um
  tutorial não pode narrar o que o modelo inventou. Converte por `escreverWav`.
- `macos`: `say -v <voz> -o <aiff>` e converte com ffmpeg. Vozes pt-BR válidas:
  `Luciana`, `Sandy`, `Reed`, `Flo`, `Eddy`, `Shelley`.

Selecção por `process.env.VIDEO_TTS` (`openrouter` por omissão) e
`process.env.VIDEO_VOZ` (`alloy` para openrouter, `Luciana` para macos).

- [ ] **Step 7: implementar `video/narrar.mjs`**

Recebe o id do roteiro, importa `video/roteiros/<id>.mjs`, e para cada beat:
calcula `sha256(provedor + voz + fala)`, procura `video/.cache/<hash>.wav`, e só
sintetiza se faltar. Copia para `video/build/<id>/fala-<beatId>.wav`, mede a
duração, escreve `video/build/<id>/falas.json`.

O cache por hash é o que torna refazer um beat barato: mudar uma fala não
re-sintetiza nem re-cobra as outras vinte.

Script: `"narrar": "node video/narrar.mjs"`.

- [ ] **Step 8: correr contra o roteiro real (depende da Task 6; até lá, um roteiro de dois beats escrito à mão em `video/build/teste.mjs`) e verificar**

```bash
VIDEO_TTS=macos node video/narrar.mjs teste     # sem custo, valida o encanamento
node video/narrar.mjs teste                      # OpenRouter, ~US$ 0,002
cat video/build/teste/falas.json
```

Esperado: um wav por beat, durações > 0, e a segunda corrida sem chamadas de rede.

- [ ] **Step 9: commit**

```bash
git add video/lib video/narrar.mjs package.json
git commit -m "vídeo(narração): dois provedores, cache por hash, e a fala que dita o tempo do beat"
```

---

## Task 3 — gravação com toque visível e quadros carimbados

**Files:**
- Create: `video/lib/toque.mjs`, `video/lib/gestos.mjs`, `video/lib/screencast.mjs`, `video/lib/screencast.test.js`, `video/gravar.mjs`
- Modify: `package.json` (devDependency `playwright`, script `gravar`)

**Interfaces:**
- Consumes: `video/build/<id>/falas.json` da Task 2.
- Produces:
  - `construirConcat(quadros: {ficheiro: string, t: number}[], fimSegundos: number) -> string`
  - `video/build/<id>/quadros/*.jpg` + `quadros.txt`
  - `video/build/<id>/timeline.json`: `{ origem: number, beats: [{ id, fala, inicio, fim, zoom: {x,y,w,h}|null }] }` — `inicio`/`fim` em segundos desde o primeiro quadro.

- [ ] **Step 1: instalar o Playwright**

```bash
npm install --save-dev playwright
npx playwright install chromium
```

- [ ] **Step 2: escrever o teste que falha**

O construtor do ficheiro de concatenação é onde um erro passa despercebido e
estraga o vídeo inteiro: o demuxer `concat` do ffmpeg exige que a **última** imagem
seja repetida, senão o último quadro é descartado e o vídeo acaba antes do áudio.
Criar `video/lib/screencast.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { construirConcat } from './screencast.mjs';

describe('construirConcat', () => {
  test('a duração de cada quadro é a distância até o próximo', () => {
    const txt = construirConcat([
      { ficheiro: 'a.jpg', t: 10.0 },
      { ficheiro: 'b.jpg', t: 10.5 },
      { ficheiro: 'c.jpg', t: 11.0 }
    ], 11.25);
    const duracoes = [...txt.matchAll(/^duration ([\d.]+)$/gm)].map(m => +m[1]);
    assert.deepEqual(duracoes, [0.5, 0.5, 0.25]);
  });

  test('repete o último ficheiro — sem isso o demuxer come o quadro final', () => {
    const txt = construirConcat([{ ficheiro: 'a.jpg', t: 0 }, { ficheiro: 'b.jpg', t: 1 }], 2);
    const linhas = txt.trim().split('\n').filter(l => l.startsWith('file '));
    assert.equal(linhas.at(-1), "file 'b.jpg'");
    assert.equal(linhas.filter(l => l === "file 'b.jpg'").length, 2);
  });

  test('normaliza os tempos: o primeiro quadro é a origem', () => {
    const txt = construirConcat([{ ficheiro: 'a.jpg', t: 1700.0 }, { ficheiro: 'b.jpg', t: 1700.4 }], 1700.4);
    assert.ok(!txt.includes('1700'));
  });

  test('quadros fora de ordem são ordenados pelo carimbo', () => {
    const txt = construirConcat([
      { ficheiro: 'b.jpg', t: 1.0 }, { ficheiro: 'a.jpg', t: 0.0 }
    ], 1.5);
    assert.ok(txt.indexOf("file 'a.jpg'") < txt.indexOf("file 'b.jpg'"));
  });

  test('quadro de duração zero é descartado — o ffmpeg rejeita duration 0', () => {
    const txt = construirConcat([
      { ficheiro: 'a.jpg', t: 0 }, { ficheiro: 'dup.jpg', t: 0 }, { ficheiro: 'b.jpg', t: 0.5 }
    ], 1.0);
    assert.ok(!txt.includes('dup.jpg'));
    assert.ok(!/duration 0(\.0+)?$/m.test(txt));
  });
});
```

- [ ] **Step 3: correr para ver falhar**

Run: `npm run test:video`
Expected: FAIL — módulo inexistente.

- [ ] **Step 4: implementar `construirConcat` em `video/lib/screencast.mjs`**

```js
/**
 * Constrói o ficheiro do demuxer `concat` a partir dos quadros carimbados.
 *
 * Os carimbos vêm de `Page.screencastFrame` (metadata.timestamp), que é
 * `Network.TimeSinceEpoch` — o mesmo relógio de `Date.now()/1000`. É por isso
 * que legenda e zoom não derivam: beat e quadro são medidos no mesmo relógio.
 */
export function construirConcat(quadros, fimSegundos) {
  const ord = [...quadros].sort((a, b) => a.t - b.t);
  const origem = ord.length ? ord[0].t : 0;
  const linhas = [];
  for (let i = 0; i < ord.length; i++) {
    const inicio = ord[i].t - origem;
    const seguinte = i + 1 < ord.length ? ord[i + 1].t - origem : fimSegundos - origem;
    const dur = +(seguinte - inicio).toFixed(4);
    if (dur <= 0) continue;                    // o ffmpeg rejeita `duration 0`
    linhas.push(`file '${ord[i].ficheiro}'`, `duration ${dur}`);
  }
  // O demuxer descarta o último quadro se ele não for repetido sem duração.
  const ultimo = linhas.filter(l => l.startsWith('file ')).at(-1);
  if (ultimo) linhas.push(ultimo);
  return linhas.join('\n') + '\n';
}
```

- [ ] **Step 5: correr o teste**

Run: `npm run test:video`
Expected: PASS.

- [ ] **Step 6: implementar o colector de quadros no mesmo ficheiro**

`async function colectar(page, dir)`: abre `page.context().newCDPSession(page)`,
regista `client.on('Page.screencastFrame', ...)` — escreve `data` (base64 jpeg) em
`dir/q<seq>.jpg`, guarda `{ficheiro, t: metadata.timestamp}`, e responde
`Page.screencastFrameAck({sessionId})` **sempre**, senão o Chromium pára de enviar.
Inicia com `Page.startScreencast({format:'jpeg', quality:92, maxWidth:1640, maxHeight:2360, everyNthFrame:1})`.
Devolve `{ parar(): Promise<{quadros, escreverConcat(fim)}> }`.

- [ ] **Step 7: implementar `video/lib/toque.mjs`**

Um `addInitScript` que define `window.__plpcToque(x, y, tipo)`. Desenha num
`<div>` anexado ao `documentElement`, com `position:fixed; pointer-events:none;
z-index:2147483647`. Três formas: `toque` — círculo de 44 px que pulsa e some em
400 ms; `longo` — anel que preenche em 500 ms e depois pulsa; `arrasto` — ponto que
segue e deixa rasto que desvanece em 700 ms. Tudo por `@keyframes` injetados uma
vez. **Sem isto o espectador vê a tela mudar sem causa visível**, o que é fatal num
vídeo que ensina toque longo em seis sítios do leitor.

Anexar ao `documentElement` e não ao `body` porque `/leitor` põe
`document.body.style.position = 'fixed'` (ver `src/routes/+layout.svelte:35`).

- [ ] **Step 8: implementar `video/lib/gestos.mjs`**

Todos os gestos passam por `Input.dispatchTouchEvent` do CDP, porque o app
distingue toque de clique (`GestureButton` + `src/lib/components/gestures/`).
Cada um chama `page.evaluate` do indicador antes de despachar:

- `tocar(seletor)`: centro do `boundingBox`, `touchStart` → 60 ms → `touchEnd`.
- `toqueLongo(seletor, ms = 700)`: `touchStart` → espera `ms` → `touchEnd`. O
  `longPressDuration` do app é 500 ms, então 700 dá margem.
- `arrastar(seletor, dx, dy, passos = 24)`: `touchStart`, `touchMove` interpolado
  com 16 ms entre passos, `touchEnd`.
- `deslizar(seletor, direcao)`: arrasto rápido de ~70% da largura em 12 passos.
- `pinçar(seletor, fator)`: dois pontos de toque afastando-se do centro.
- `esperar(seletor)`, `pausa(ms)`, `rolar(px)`.

- [ ] **Step 9: implementar `video/gravar.mjs`**

Importa o roteiro e `falas.json`. Abre o contexto:

```js
const contexto = await navegador.newContext({
  viewport: { width: 820, height: 1180 },
  deviceScaleFactor: 2,
  hasTouch: true, isMobile: true,
  locale: 'pt-BR', timezoneId: 'America/Sao_Paulo'
});
```

Injecta `toque.mjs`, navega para `roteiro.url`, espera a rede assentar, inicia o
screencast, e corre os beats em ordem. Para cada beat: marca `inicio = Date.now()/1000`,
corre `acao(page, ui)`, resolve `zoom` por `boundingBox()` do seletor — em pixels
do mestre, isto é multiplicados por `deviceScaleFactor` — e segura até
`falas[beat.id].duracao + 0.6`. Marca `fim`. Alvo de zoom que não resolve não
derruba a gravação: cai para `null` e escreve um aviso no `stderr`.

Ao fim: pára o screencast, escreve `quadros.txt` por `construirConcat`, e escreve
`timeline.json` com os tempos **relativos ao primeiro quadro**, não ao início do
processo.

Script: `"gravar": "node video/gravar.mjs"`.

- [ ] **Step 10: commit**

```bash
git add video/lib video/gravar.mjs package.json package-lock.json
git commit -m "vídeo(gravação): toque visível, e quadros no mesmo relógio dos beats"
```

---

## Task 4 — legenda rasterizada

**Files:**
- Create: `video/lib/quebraLinha.mjs`, `video/lib/quebraLinha.test.js`, `video/legenda_png.py`, `video/legendar.mjs`
- Modify: `package.json` (script `legendar`)

**Interfaces:**
- Consumes: `video/build/<id>/timeline.json`.
- Produces: `quebrar(texto: string, largura: number) -> string[]`; `video/build/<id>/legendas/<beatId>.png` (1640×2360, RGBA); `video/build/<id>/legendas.vtt`.

- [ ] **Step 1: escrever o teste que falha**

```js
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { quebrar } from './quebraLinha.mjs';

describe('quebrar', () => {
  test('não parte palavras', () => {
    for (const l of quebrar('Disponibilizar offline baixa o acervo inteiro', 20))
      assert.ok(l.length <= 20 || !l.includes(' '));
  });

  test('uma palavra maior que a largura fica sozinha na linha', () => {
    assert.deepEqual(quebrar('Pesquisador supercalifragilisticexpialidoce fim', 12),
      ['Pesquisador', 'supercalifragilisticexpialidoce', 'fim']);
  });

  test('devolve no máximo três linhas, para não tapar a tela', () => {
    const t = 'palavra '.repeat(60);
    assert.ok(quebrar(t, 38).length <= 3);
  });

  test('quando corta, a última linha acaba em reticências', () => {
    const t = 'palavra '.repeat(60);
    assert.ok(quebrar(t, 38).at(-1).endsWith('…'));
  });

  test('texto vazio devolve lista vazia, não uma linha em branco', () => {
    assert.deepEqual(quebrar('   ', 38), []);
  });
});
```

Run: `npm run test:video` → FAIL.

- [ ] **Step 2: implementar `quebrar` e correr o teste até passar**

Algoritmo guloso por palavras; acumula enquanto `linha.length + 1 + palavra.length <= largura`;
palavra sozinha maior que a largura vai para a sua própria linha sem ser partida;
ao exceder três linhas, trunca a terceira em `largura - 1` e acrescenta `…`.

Run: `npm run test:video` → PASS.

- [ ] **Step 3: implementar `video/legenda_png.py`**

Recebe por `stdin` um JSON `{saida, linhas, largura, altura}` e escreve um PNG
RGBA do tamanho do quadro, transparente, com uma faixa escura translúcida
(`#000000` a 62% de opacidade, cantos arredondados) atrás do texto, centrada
horizontalmente e assente a 130 px do fundo. Fonte:
`/System/Library/Fonts/Supplemental/Arial Bold.ttf`, corpo 46 px no mestre de
1640 px de largura. Texto branco com sombra de 2 px.

Faz um processo por vídeo, não por legenda: recebe uma lista de trabalhos e
escreve todos, porque arrancar o Python vinte vezes custa mais que o desenho.

- [ ] **Step 4: implementar `video/legendar.mjs`**

Lê a timeline, chama `quebrar(beat.fala, 38)`, invoca o Python uma vez com todos os
trabalhos, e escreve o `.vtt` com os mesmos tempos (`HH:MM:SS.mmm`).

- [ ] **Step 5: verificar**

```bash
node video/legendar.mjs 03-biblioteca
python3 -c "from PIL import Image; im=Image.open('video/build/03-biblioteca/legendas/abertura.png'); print(im.size, im.mode)"
head -8 video/build/03-biblioteca/legendas.vtt
```

Esperado: `(1640, 2360) RGBA` e um `.vtt` com `WEBVTT` na primeira linha.

- [ ] **Step 6: commit**

```bash
git add video/lib/quebraLinha* video/legenda_png.py video/legendar.mjs package.json
git commit -m "vídeo(legenda): PNG sobreposto, porque este ffmpeg não tem libass"
```

---

## Task 5 — montagem: zoom, legenda, voz e música num só grafo

**Files:**
- Create: `video/lib/filtergraph.mjs`, `video/lib/filtergraph.test.js`, `video/lib/verificar.mjs`, `video/montar.mjs`
- Modify: `package.json` (script `montar`)

**Interfaces:**
- Consumes: `timeline.json`, `legendas/*.png`, `fala-*.wav`, `build/leito-musical.wav`.
- Produces:
  - `construirGrafo(timeline, opcoes) -> { entradas: string[], filtro: string, mapas: string[] }`
  - `verificar(caminho, timeline) -> Promise<{ok: boolean, falhas: string[]}>`
  - `video/build/<id>/<id>.mp4` e `<id>.jpg`

- [ ] **Step 1: escrever o teste que falha**

O grafo é a peça onde um erro não dá exceção nenhuma — dá um vídeo errado. Por isso
é uma função pura, e é testada como tal. Criar `video/lib/filtergraph.test.js`:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { construirGrafo } from './filtergraph.mjs';

const TL = {
  origem: 0,
  beats: [
    { id: 'a', fala: 'Um', inicio: 0, fim: 4, zoom: null },
    { id: 'b', fala: 'Dois', inicio: 4, fim: 9, zoom: { x: 100, y: 200, w: 820, h: 1180 } }
  ]
};
const OPC = { dir: '/b', largura: 1640, altura: 2360, saidaLargura: 820, saidaAltura: 1180, fps: 30, rampa: 0.4 };

describe('construirGrafo', () => {
  test('a primeira entrada é a sequência de quadros; a música é a última', () => {
    const g = construirGrafo(TL, OPC);
    assert.ok(g.entradas[0].includes('quadros.txt'));
    assert.ok(g.entradas.at(-1).includes('leito-musical.wav'));
  });

  test('um PNG de legenda por beat, na ordem dos beats', () => {
    const g = construirGrafo(TL, OPC);
    assert.ok(g.entradas.some(e => e.includes('legendas/a.png')));
    assert.ok(g.entradas.some(e => e.includes('legendas/b.png')));
  });

  test('cada legenda é ligada à janela do seu beat', () => {
    const f = construirGrafo(TL, OPC).filtro;
    assert.ok(f.includes("enable='between(t,0,4)'"));
    assert.ok(f.includes("enable='between(t,4,9)'"));
  });

  test('beat sem zoom não gera zoompan — nada de ampliar 1x à toa', () => {
    const f = construirGrafo({ ...TL, beats: [TL.beats[0]] }, OPC).filtro;
    assert.ok(!f.includes('zoompan'));
  });

  test('beat com zoom gera a rampa de entrada e a de saída', () => {
    const f = construirGrafo(TL, OPC).filtro;
    assert.ok(f.includes('zoompan'));
    assert.ok(f.includes('4.4'));            // inicio + rampa
    assert.ok(f.includes('8.6'));            // fim - rampa
  });

  test('a fala de cada beat é atrasada até ao início do beat, em milissegundos', () => {
    const f = construirGrafo(TL, OPC).filtro;
    assert.ok(f.includes('adelay=0|0'));
    assert.ok(f.includes('adelay=4000|4000'));
  });

  test('a música passa por sidechaincompress com a narração como cadeia lateral', () => {
    const f = construirGrafo(TL, OPC).filtro;
    const i = f.indexOf('sidechaincompress');
    assert.ok(i > -1);
    assert.ok(f.indexOf('loudnorm') > i);   // normaliza depois de misturar, não antes
  });

  test('a saída é escalada para o formato final', () => {
    const f = construirGrafo(TL, OPC).filtro;
    assert.ok(f.includes('scale=820:1180'));
  });

  test('um beat de duração zero não entra no grafo', () => {
    const tl = { origem: 0, beats: [{ id: 'z', fala: 'x', inicio: 3, fim: 3, zoom: null }] };
    const f = construirGrafo(tl, OPC).filtro;
    assert.ok(!f.includes('legendas/z.png'));
  });
});
```

- [ ] **Step 2: correr para ver falhar**

Run: `npm run test:video` → FAIL, módulo inexistente.

- [ ] **Step 3: implementar `construirGrafo`**

Regras, na ordem em que o grafo é montado:

1. **Entradas:** `-f concat -safe 0 -i <dir>/quadros.txt`, depois um `-i` por PNG de
   legenda (na ordem dos beats), depois um `-i` por `fala-<id>.wav`, e por fim
   `-i video/build/leito-musical.wav`.
2. **Vídeo:** `[0:v]fps=30,format=rgba[v0]`. Para cada beat **com** zoom, um
   `zoompan` aplicado só à janela do beat. O factor é `Z = largura / zoom.w`, e o
   centro é `zoom.x + zoom.w/2`, `zoom.y + zoom.h/2`. A expressão de `z` usa
   `in_time` para produzir rampa de subida em `[inicio, inicio+rampa]`, patamar em
   `[inicio+rampa, fim-rampa]` e rampa de descida em `[fim-rampa, fim]`; fora da
   janela, `z=1`. **Beat sem zoom não recebe filtro nenhum** — aplicar `zoompan`
   com `z=1` reamostra a imagem inteira sem motivo e amolece o texto.
3. **Legendas:** um `overlay=0:0:enable='between(t,inicio,fim)'` por beat, em
   cadeia. Beats com `fim <= inicio` são saltados.
4. **Áudio:** cada fala vira `[k:a]adelay=<ms>|<ms>,apad[fk]`, onde `<ms>` é
   `round(inicio*1000)`. Todas as falas entram num `amix=inputs=N:normalize=0[voz]`.
   A música vira `[m:a]atrim=0:<duração>,afade=t=in:d=1.5,afade=t=out:st=<dur-2>:d=2,volume=-22dB[bed]`.
   Depois `[bed][voz]sidechaincompress=threshold=0.03:ratio=8:attack=25:release=350[bedduck]`,
   e `[bedduck][voz]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1:LRA=11[aout]`.
   `loudnorm` **depois** da mistura: normalizar antes deixaria a música a subir
   sempre que a voz calasse.
5. **Saída:** `scale=820:1180:flags=lanczos,format=yuv420p[vout]`.

- [ ] **Step 4: correr o teste**

Run: `npm run test:video` → PASS, 9 testes.

- [ ] **Step 5: implementar `video/lib/verificar.mjs`**

`verificar(caminho, timeline)` corre `ffprobe -show_streams -show_format -of json` e
falha se: largura ≠ 820, altura ≠ 1180, `r_frame_rate` ≠ `30/1`, não houver stream
de áudio AAC, ou a duração divergir do último `fim` da timeline em mais de 1,5 s.
Corre ainda `ffmpeg -i <caminho> -af "volumedetect,ebur128=peak=true" -f null -` e
falha se o pico passar de −1 dBFS. Devolve `{ok, falhas}` — nunca lança, para que o
chamador possa listar todas as falhas de uma vez em vez de uma por corrida.

- [ ] **Step 6: implementar `video/montar.mjs`**

Monta a linha de comando a partir de `construirGrafo`, corre o ffmpeg com
`-c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart`,
extrai o poster (`-ss <meio do primeiro beat> -frames:v 1 <id>.jpg`), e corre
`verificar`. Se `ok` for falso, imprime as falhas e sai com código 1 — um vídeo que
não passa no portão não deve chegar ao Jairo.

Script: `"montar": "node video/montar.mjs"`.

- [ ] **Step 7: commit**

```bash
git add video/lib/filtergraph* video/lib/verificar.mjs video/montar.mjs package.json
git commit -m "vídeo(montagem): grafo puro e testado, e um portão que reprova o próprio vídeo"
```

---

## Task 6 — vídeo 3 (Biblioteca), a corrida que prova a corrente

**Files:**
- Create: `video/roteiros/03-biblioteca.mjs`
- Modify: `package.json` (script `video` que corre os cinco estágios em ordem)

**Interfaces:**
- Consumes: tudo das tarefas 1–5.
- Produces: `video/build/03-biblioteca/03-biblioteca.mp4` + `.jpg` + `.vtt`.

É o primeiro por ser o mais curto e o único sem armadilha de offline: se a corrente
está partida, parte aqui, barato.

- [ ] **Step 1: escrever o roteiro**

Beats, na ordem, cada um com `fala`, `zoom` e `acao` — cobrindo o que o spec lista
para o vídeo 3:

1. `abertura` — para que serve a Biblioteca, contra a Home. Sem zoom.
2. `material` — filtro **Material**; toca em "Cifra" para mostrar que o resultado
   muda. Zoom em `[aria-label="Filtrar por categoria"]`.
3. `material-todos` — o botão "Todos" e o toque que selecciona só um. Mesmo zoom.
4. `arranjo` — filtro **Arranjo**. Zoom em `[aria-label="Filtrar por arranjo"]`.
5. `arranjo-especial` — explica que **Arranjo Especial** só aparece quando o filtro
   actual tem algum. Zoom em `[aria-label="Filtrar por arranjo especial"]`, com
   `zoom: null` se o selector não existir na corrida.
6. `ordenar` — **Ordenar** por número e por nome. Zoom no `SortSelector`.
7. `como-abrir` — **Como abrir** e as cinco opções. Zoom no `PdfViewerSelector`.
8. `paginacao` — itens por página e os quatro botões de navegação. Zoom nos
   controlos de baixo.
9. `vazio` — desmarca tudo em **Material** para mostrar
   "Nenhum louvor encontrado com os filtros selecionados", e desfaz. Sem zoom.
10. `fecho` — resumo. Sem zoom.

- [ ] **Step 2: acrescentar o script de orquestração ao `package.json`**

```json
"video": "node video/pipeline.mjs"
```

`video/pipeline.mjs` corre, para o id recebido: `narrar` → `gravar` → `legendar` →
`montar`, abortando no primeiro código de saída diferente de zero.

- [ ] **Step 3: correr o encanamento sem custo, primeiro**

```bash
VIDEO_TTS=macos npm run video 03-biblioteca
```

Serve só para provar que os quatro estágios se ligam. O áudio é descartável.

- [ ] **Step 4: correr a sério**

```bash
npm run video 03-biblioteca
```

- [ ] **Step 5: verificar à mão o que o `ffprobe` não vê**

```bash
# um quadro no meio de cada beat com zoom, para conferir a região ampliada
node -e "…extrai quadros nos instantes (inicio+fim)/2 de cada beat com zoom…"
```

Conferir: a região ampliada é a certa; a legenda está legível e não tapa o que está
a ser explicado; o indicador de toque aparece antes de cada mudança de tela; a voz
não cavalga o beat seguinte; a música baixa quando a voz entra.

**Se o `zoompan` mostrar tremor** (o defeito conhecido dele, de arredondar `x`/`y`
a inteiros a cada quadro): trocar a animação por corte estático — segmentar o vídeo
por beat com `trim`, aplicar `crop`+`scale` fixos a cada segmento, e juntar com
`xfade` de 0,3 s. Menos bonito, e imune ao problema.

- [ ] **Step 6: commit**

```bash
git add video/roteiros/03-biblioteca.mjs video/pipeline.mjs package.json
git commit -m "vídeo(biblioteca): o roteiro que prova a corrente inteira"
```

---

## Task 7 — vídeo 1 (Uso básico), com o leitor inteiro

**Files:** Create `video/roteiros/01-uso-basico.mjs`

- [ ] **Step 1: escrever o roteiro**

Beats cobrindo o que o spec lista. Os do leitor são os delicados, porque metade é
toque longo — e é aí que o indicador de toque da Task 3 justifica a sua existência:

`cabecalho`, `filtros-abrir`, `material`, `arranjo`, `como-abrir`, `busca-numero`,
`busca-nome`, `busca-limpar`, `cartao`, `cartao-agrupado`, `paginacao`,
`vazio-materiais`, `abrir-leitor`, `leitor-paginas`, `leitor-primeira-ultima`
(toque longo), `leitor-zoom`, `leitor-fit` (toque longo alterna page-fit ↔
page-width), `leitor-brilho` (ciclo, e toque longo repõe), `leitor-modo`
(vertical ↔ horizontal), `leitor-camadas` (o botão que no tablet em retrato revela
o resto dos controlos), `leitor-fullscreen` (toque longo no PDF, e o FAB para
sair), `leitor-swipe`, `leitor-pinca`, `leitor-voltar`.

Selectores a usar, confirmados no código:
`[aria-label="Buscar louvor por nome ou número"]`, `.filter-collapse-trigger`,
`[aria-label="Página anterior (long press: primeira página)"]`,
`[aria-label="Ajustar zoom (long press: alternar page-fit/page-width)"]`,
`.btn.brightness-toggle`, `.btn.nav-mode-toggle`, `.btn.layer-toggle`,
`.fab-exit-fullscreen`, `.material-open`, `.add-button`.

**Cuidado:** `.btn.layer-toggle` só existe quando a barra não cabe. Em 820 px de
largura ele deve aparecer, mas o beat tem de tolerar a ausência — se o selector não
resolver, a `acao` regista o aviso e segue, em vez de derrubar a gravação de 4 min.

- [ ] **Step 2: correr, verificar, ajustar**

```bash
VIDEO_TTS=macos npm run video 01-uso-basico   # encanamento
npm run video 01-uso-basico                    # a sério
```

Verificação como no Step 5 da Task 6, com atenção extra a: cada toque longo mostra
o anel a encher antes do efeito; o fullscreen esconde a barra e o FAB aparece; o
swipe muda de página e o pinch amplia de verdade.

- [ ] **Step 3: commit**

```bash
git add video/roteiros/01-uso-basico.mjs
git commit -m "vídeo(uso básico): a home e o leitor inteiro, com os seis toques longos"
```

---

## Task 8 — vídeo 4 (Listas)

**Files:** Create `video/roteiros/04-listas.mjs`

- [ ] **Step 1: escrever o roteiro**

`montar-playlist` (botão `+`, e como é no cartão agrupado), `barra-playlist`,
`salvar`, `compartilhar` (e o "Link copiado!"), `em-abas`, `folheto`,
`expandir`, `reordenar` (**arrastar o chip com o dedo** — `ui.arrastar` no
`[title="Arraste para reordenar"]`), `remover-item`, `limpar`, `ir-para-listas`,
`buscar-playlist`, `favoritar`, `so-favoritas`, `renomear`, `reproduzir`, `ver`,
`remover-playlist` (com a confirmação), `navegador-no-leitor` (o `CarouselNavigator`),
`abrir-por-link`.

**Cuidado com `em-abas`:** abre várias abas e rouba o foco, o que mata o screencast
da aba gravada. O beat mostra o botão e **narra** o que ele faz, sem o tocar; ou
toca e fecha as abas novas imediatamente por `contexto.pages()`. A segunda opção é
melhor se for estável; se não for, a primeira, e a narração diz o que acontece.

**Cuidado com `abrir-por-link`:** o link vem do "Compartilhar", que escreve na área
de transferência. Ler dela exige permissão `clipboard-read`, concedida no contexto
por `contexto.grantPermissions(['clipboard-read'])`.

- [ ] **Step 2: correr, verificar, ajustar** (como na Task 7)

- [ ] **Step 3: commit**

```bash
git add video/roteiros/04-listas.mjs
git commit -m "vídeo(listas): montar, salvar, reordenar com o dedo e reproduzir"
```

---

## Task 9 — vídeo 2 (Offline)

**Files:** Create `video/roteiros/02-offline.mjs`

- [ ] **Step 1: escrever o roteiro**

Segue a tela **como ela é hoje**, não como o desenho antigo supunha:
não há escolha de categorias (`src/routes/offline/+page.svelte:82` tem a secção com
`display: none`), e os dois botões primários são mutuamente exclusivos.

`indicador-conexao`, `estatisticas`, `requisitos` (baixar **e** ter aberto um PDF
no leitor), `disponibilizar` (**um botão, tudo ou nada**), `progresso` (lote *n* de
*m*, bytes, percentagem, cancelar), `faltantes` (que é o botão que toma o lugar do
outro depois), `importar-pacote` (o caminho para a igreja sem internet nenhuma),
`prova-offline`, `remocao` (a limitação, que o vídeo 5 retoma).

**A honestidade de escala é obrigatória:** não são baixados 846 MB para gravar. O
beat `progresso` deixa o download real correr enquanto a barra se mexe e corta com
a fala a dizer que continua em segundo plano. O beat `prova-offline` faz
`await contexto.setOffline(true)` depois de abrir dois ou três PDFs online no mesmo
contexto, e abre um deles outra vez, agora sem rede. **A narração diz que a escala
foi reduzida para o vídeo.** Mostrar cache pequeno é honesto; dar a entender que o
acervo inteiro desceu em 40 segundos não é.

O beat `importar-pacote` usa `plpc-offline-bundle.zip`, que já está na raiz do
repositório, por `setInputFiles` no `input.bundle-file-input`.

- [ ] **Step 2: correr, verificar, ajustar**

Verificação extra: confirmar que depois de `setOffline(true)` o PDF abre mesmo —
se abrir um erro, o vídeo estaria a ensinar uma promessa falsa e o beat tem de ser
refeito, não maquilhado.

- [ ] **Step 3: commit**

```bash
git add video/roteiros/02-offline.mjs
git commit -m "vídeo(offline): um botão, tudo ou nada, e a prova com a rede desligada"
```

---

## Task 10 — vídeo 5 (Problemas conhecidos)

**Files:** Create `video/roteiros/05-problemas.mjs`

Só os dois problemas que o Jairo escolheu. Nenhum a mais: o vídeo é um aviso, não
um inventário de defeitos.

- [ ] **Step 1: escrever o roteiro**

`abertura`, `remocao-individual` (mostra a própria caixa de aviso em `/offline`, e
explica que remover exige limpar o cache do navegador inteiro),
`espaco` (mostra a estatística e diz os ~846 MB do acervo completo, o que isso
significa num tablet cheio, e o limite de armazenamento no iOS/Safari), `fecho`.

- [ ] **Step 2: correr, verificar, ajustar**

- [ ] **Step 3: commit**

```bash
git add video/roteiros/05-problemas.mjs
git commit -m "vídeo(problemas): os dois avisos que o Jairo quis dar"
```

---

## Task 11 — publicar e ligar na página

**Files:**
- Create: `video/publicar.mjs`
- Modify: `src/routes/sobre/+page.svelte:40-99`

**Interfaces:**
- Consumes: os cinco `.mp4`, `.jpg` e `.vtt`.
- Produces: os objectos em `videos/` no bucket `pls-louvores`, e cinco `<video>` na página.

- [ ] **Step 1: implementar `video/publicar.mjs`**

Para cada id, três `wrangler r2 object put pls-louvores/videos/<id>.<ext> --file <caminho> --content-type <tipo>`.
**O script imprime tudo o que vai enviar e pára à espera de confirmação antes do
primeiro upload** — é o único passo deste plano que sai da máquina.

- [ ] **Step 2: escrever o novo bloco de vídeo na página**

Substituir cada um dos cinco `.video-container` por:

```svelte
<div class="video-container">
  <!-- svelte-ignore a11y-media-has-caption -->
  <video
    class="video-player"
    controls
    preload="metadata"
    poster="{BASE_VIDEOS}/03-biblioteca.jpg"
    on:error={() => (falhou['03-biblioteca'] = true)}
  >
    <source src="{BASE_VIDEOS}/03-biblioteca.mp4" type="video/mp4" />
    <track kind="captions" srclang="pt-BR" label="Português" default
           src="{BASE_VIDEOS}/03-biblioteca.vtt" />
  </video>
</div>
```

**O placeholder actual não é apagado.** Ele passa a ser o conteúdo de fallback,
mostrado quando `falhou[id]` é verdadeiro, com o texto trocado para
"Este vídeo precisa de internet para tocar." A página *Sobre* é cacheada para uso
offline mas os vídeos no R2 não serão: sem isto, quem abrisse a página sem rede
veria cinco rectângulos pretos mortos em vez de uma explicação.

Um `{#each}` sobre uma lista `[{ id, titulo }]` no `<script>` evita repetir o mesmo
bloco cinco vezes com um id trocado — que é onde este ficheiro erraria.

- [ ] **Step 3: verificar**

```bash
npm run check 2>&1 | tail -20
npm run check:offline 2>&1 | grep -c ERROR    # tem de continuar 10, não mais
npm test 2>&1 | tail -5                        # 605 testes, 0 falhas
npm run build
```

E à mão, com `npm run preview`: os cinco vídeos tocam; a legenda aparece ao ligar
as *captions*; com a rede desligada, o fallback aparece em vez do rectângulo preto.

- [ ] **Step 4: commit**

```bash
git add video/publicar.mjs src/routes/sobre/+page.svelte
git commit -m "sobre: os cinco vídeos prometidos, com legenda e com o que mostrar sem rede"
```

---

## Self-review

**Cobertura do spec:** narração (Task 2), música (1), gravação com toque visível
(3), legenda sem libass (4), zoom e mistura com ducking (5), os cinco roteiros
(6–10), R2 e a página com fallback offline (11), portão de verificação (5, usado
em 6–10). A correcção do texto órfão de `/offline` já foi feita fora do plano, em
2026-09-03, e está registada no spec.

**Marcadores:** nenhum "TBD"/"TODO". A única ausência deliberada de código é o
corpo dos cinco roteiros, que é conteúdo editorial e não algoritmo — cada um traz a
lista completa de beats e os selectores confirmados no código.

**Consistência de tipos:** `construirConcat(quadros, fimSegundos)`,
`extrairAudioSSE(texto)`, `quebrar(texto, largura)`, `construirGrafo(timeline, opcoes)`,
`verificar(caminho, timeline)` — os nomes usados nas tarefas 6–11 são estes, sem
variantes. O formato de `timeline.json` é declarado na Task 3 e consumido tal e
qual nas 4, 5 e 6.
