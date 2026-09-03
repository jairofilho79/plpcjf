# Vídeos tutoriais da página "Como Usar" — design

**Data:** 2026-09-03
**Estado:** aprovado pelo Jairo em 2026-09-03 (com duas adições: narração e correção do roteiro offline)

## Problema

`src/routes/sobre/+page.svelte:40-99` tem cinco `.video-placeholder` que prometem
"Vídeo que será adicionado posteriormente" desde que a página existe. São cinco:
**Uso básico**, **Uso Offline**, **Uso da Biblioteca**, **Uso das Listas** e
**Problemas conhecidos**. Este documento define como esses cinco vídeos são
produzidos, e o que cada um ensina.

O público é o irmão da equipe de louvor com um tablet na mão, muitas vezes numa
igreja sem internet. O vídeo tem de ser assistível com som baixo (daí legenda) e
sem depender de leitura rápida (daí narração).

## Decisões tomadas

| Decisão | Escolha | Porquê |
|---|---|---|
| Ambiente de gravação | Produção (`plpcg.com`) | Acervo real; o que o vídeo mostra é o que o irmão encontra |
| Formato | Retrato 820×1180 (tablet em pé) | Escolha do Jairo |
| Hospedagem | R2 `pls-louvores`, prefixo `videos/` | Mesmo lugar dos PDFs; fora do git, não incha o bundle offline |
| Narração | Sim, TTS | Adição do Jairo |
| Música | Bach BWV 846, sintetizada aqui | Obra em domínio público, gravação nossa: zero risco de direitos |
| Problemas conhecidos no vídeo 5 | Só dois (ver §Vídeo 5) | Escolha do Jairo |

### Narração: o que existe de verdade

O Jairo pediu "fish free no openrouter". **Esse modelo não existe no OpenRouter.**
Verificado contra `GET https://openrouter.ai/api/v1/models` em 2026-09-03: dos 424
modelos, apenas quatro emitem áudio — `openai/gpt-audio`, `openai/gpt-audio-mini`,
`google/lyria-3-pro-preview`, `google/lyria-3-clip-preview` — e nenhum dos 18
modelos `:free` emite áudio.

Duas alternativas foram testadas de facto, com a mesma frase:

- **`openai/gpt-audio-mini` via OpenRouter.** Funciona, mas **exige `stream: true`**
  (sem streaming devolve `400 Audio output requires stream: true`) e o áudio chega
  como PCM16 24 kHz mono em base64, fatiado nos deltas do SSE. Custo medido:
  **US$ 0,0008 para 12,5 s**, ou ~US$ 0,000064/s. Os cinco vídeos, com ~12 min de
  narração no total, ficam em **~US$ 0,05**.
- **`say` do macOS**, vozes pt-BR (Luciana, Sandy, Reed, Flo, Eddy, Shelley).
  Grátis, offline, determinístico.

**Decisão do Jairo, depois de ouvir as quatro amostras (2026-09-03):**
**`openai/gpt-audio-mini` no OpenRouter, voz `alloy`.** As vozes do `say` foram
consideradas imprestáveis e ficam apenas como saída de emergência, sem rede.

**Design:** o gerador de narração é um módulo com dois provedores atrás da mesma
interface (`sintetizar(texto) -> caminho do wav`), selecionado por `VIDEO_TTS`. O
padrão — e a escolha real — é `openrouter` com `alloy`; `macos` existe só para
validar o encanamento sem gastar e sem rede.

**Custo, medido e não estimado.** A amostra de 12,5 s custou **US$ 0,000797** pelo
campo `usage` da própria chamada, o que dá **US$ 0,0000607 por segundo de fala**
mais **US$ 0,000038 fixos por beat** (o prompt). Para os cinco vídeos, com ~588 s
de narração em ~49 beats: **US$ 0,038** numa passada limpa, **~US$ 0,11** com três
rodadas de refação, **US$ 0,23** no pior caso. O cache por hash da fala é o que
mantém isto assim: corrigir uma frase não re-sintetiza nem re-cobra as outras.

### Modo offline: o que a tela faz hoje

O desenho anterior deste documento supunha seleção de categorias. **Está errado.**
`src/routes/offline/+page.svelte:82` esconde a seção de categorias
(`style="display: none;"`). A tela hoje oferece:

1. **Importar pacote offline** — sempre visível; abre o seletor de ficheiro para o
   zip-mãe.
2. **Disponibilizar offline** — só quando `offlineAvailable` é falso. Chama
   `downloadAllCategories()`: tudo, sem escolha.
3. **Baixar PDFs faltantes** — só quando `offlineAvailable` é verdadeiro.

Os dois últimos são mutuamente exclusivos. O roteiro do vídeo 2 segue essa
realidade: um botão só, tudo ou nada, e o segundo botão como o que aparece depois.

## Arquitetura

Cinco estágios, cada um um artefacto independente que pode ser re-executado
sozinho. Tudo novo, sob `video/`. Nada em `src/` é tocado exceto o passo final.

```
video/
  roteiros/
    01-uso-basico.mjs   02-offline.mjs   03-biblioteca.mjs
    04-listas.mjs       05-problemas.mjs
  narrar.mjs      fala      -> wav por beat + duração medida
  gravar.mjs      roteiro   -> webm + timeline.json
  legendar.mjs    timeline  -> PNGs transparentes + vtt
  musica.py       (nada)    -> leito musical wav
  montar.mjs      tudo      -> mp4 final + poster jpg
  publicar.mjs    mp4       -> R2
  build/          saídas intermédias e finais (git-ignored)
```

### A decisão central: o roteiro é a única fonte da verdade

Cada roteiro é uma lista de *beats*. Um beat carrega junto a ação, a fala e a
região de zoom:

```js
{
  id: 'busca-numero',
  fala: 'Digite o número ou o nome do louvor na caixa Buscar.',
  zoom: 'searchbar',            // nome de um alvo, resolvido para um retângulo na gravação
  acao: async (p, ui) => { await ui.tocar('input[aria-label*="Buscar"]'); await p.keyboard.type('218'); }
}
```

`fala` alimenta **três** coisas — o áudio da narração, a legenda queimada e o
`.vtt`. Um só texto, três saídas: é impossível a legenda discordar da narração.

Não há campo de duração. **A duração do beat é a duração da narração dele**, mais
uma folga fixa. É por isso que a narração vem primeiro no pipeline.

### Ordem do pipeline

```
narrar.mjs   →  wav por beat + durações
     ↓ (durações)
gravar.mjs   →  webm + timeline.json (tempo real de cada beat)
     ↓
legendar.mjs →  PNG por fala + .vtt
     ↓
montar.mjs   →  mp4  (zoom + legenda + narração + música)
```

Inverter isto — gravar com tempos fixos e depois encaixar a fala — produz o defeito
clássico: a narração de um passo cavalga o passo seguinte. Medir primeiro e gravar
depois elimina a classe inteira do problema.

### `narrar.mjs`

Para cada beat: sintetiza `fala`, grava `build/<video>/fala-<id>.wav`, mede a
duração com `ffprobe`, e escreve `build/<video>/falas.json`. Cacheia por hash do
texto — mudar um beat não re-sintetiza os outros vinte, nem gasta de novo.

Provedor OpenRouter: `POST /chat/completions` com `stream: true`,
`modalities: ["text","audio"]`, `audio: {voice, format: "pcm16"}`; junta os
`delta.audio.data` em base64, decodifica, e converte PCM16/24 kHz/mono para wav.
O *prompt* instrui a ler o texto exatamente, sem acrescentar nada — e a resposta é
verificada contra o `transcript` devolvido; divergência grande aborta o beat em vez
de deixar o modelo improvisar em cima do tutorial.

### `gravar.mjs`

Playwright, contexto com `viewport: {width: 820, height: 1180}`, `hasTouch: true`,
`isMobile: true`, `deviceScaleFactor: 2`, `locale: 'pt-BR'`, `recordVideo`.

**Segunda decisão de desenho: toque sintético é invisível.** O contexto injeta um
`init script` que desenha um indicador de toque — círculo que pulsa onde houve
toque, anel que preenche durante o toque longo, rastro no arrastar. Sem isso o
espectador vê a tela mudar sem causa visível, o que é fatal num tutorial que ensina
toque longo em seis lugares diferentes do leitor.

O objeto `ui` passado a cada `acao` expõe `tocar`, `toqueLongo`, `arrastar`,
`deslizar` e `pinçar` — todos desenham o indicador e todos usam
`CDP Input.dispatchTouchEvent`, porque o app distingue toque de clique.

O gravador executa os beats em ordem, segura cada um pela duração vinda de
`falas.json` mais folga, e **emite `timeline.json`** com início e fim reais de cada
beat medidos contra o instante inicial do vídeo. É a timeline que a montagem
consome; sem ela, zoom e legenda seriam adivinhação.

Alvos de zoom (`searchbar`, `toolbar-leitor`, …) são resolvidos no momento da
gravação por `boundingBox()` do seletor correspondente e gravados na timeline em
pixels. Um alvo que não resolve não quebra a gravação: cai para "sem zoom" e
regista um aviso.

### `legendar.mjs`

Este ffmpeg (8.1, Homebrew) **não tem `libass` nem `drawtext`** — confirmado por
`ffmpeg -filters`. Então a legenda é rasterizada: um PNG transparente por fala,
gerado com PIL (disponível), fonte do sistema, faixa inferior semitransparente,
quebra de linha a ~38 caracteres, no tamanho exato do quadro. A montagem sobrepõe
cada PNG com `enable='between(t,inicio,fim)'`.

Gera também um `.vtt` por vídeo, para o `<track kind="captions">` do player.

### `musica.py`

Síntese aditiva com numpy do Prelúdio nº 1 em Dó maior, BWV 846, de J. S. Bach
(morto em 1750; obra em domínio público). As notas são escritas no próprio script.
Envelope ADSR, algumas parciais harmónicas, leve reverberação por convolução com
ruído decrescente. A composição é livre e **a gravação é nossa** — não há acervo de
terceiros envolvido, que é exatamente onde mora o risco de direitos quando se
"baixa uma clássica de graça".

Saída: `video/build/leito-musical.wav`, gerado uma vez e reusado pelos cinco.

### `montar.mjs`

Constrói um `filter_complex` a partir da timeline:

- **Vídeo:** webm normalizado a 30 fps; para cada beat com região, `crop` com
  expressões em `t` (interpolação linear de ~0,4 s na entrada e na saída do zoom)
  seguido de `scale` de volta a 820×1180. `crop`+`scale` em vez de `zoompan`
  porque permite ampliar num retângulo nomeado com controlo do tempo de transição.
- **Legenda:** um `overlay` por PNG, com `enable='between(t,a,b)'`.
- **Áudio:** cada `fala-<id>.wav` posicionado com `adelay` no início do seu beat;
  o leito musical cortado ao tamanho do vídeo, com `afade` nas pontas; a música
  passa por `sidechaincompress` tendo a narração como cadeia lateral — a música
  abaixa sozinha quando alguém fala e volta quando cala. Mistura final por `amix`,
  normalizada com `loudnorm`.
- **Saída:** H.264 `yuv420p`, AAC, `+faststart`. Poster: quadro do primeiro beat.

### `publicar.mjs`

`wrangler r2 object put` dos cinco `.mp4`, dos cinco `.jpg` de poster e dos cinco
`.vtt`, sob `videos/` no bucket `pls-louvores`.

### Mudança em `src/routes/sobre/+page.svelte`

Os cinco `.video-placeholder` viram `<video controls preload="metadata" poster>`
com `<track kind="captions" srclang="pt-BR" default>`.

**Cuidado que não pode ser esquecido:** a página *Sobre* é cacheada para uso
offline, mas os vídeos no R2 não serão. Um `<video>` cuja fonte falha renderiza um
retângulo preto morto. Portanto o placeholder atual **não é apagado** — passa a ser
o conteúdo de fallback, exibido quando o `<video>` dispara `error`, com o texto
trocado para dizer que o vídeo precisa de internet.

## Os cinco vídeos

Duração-alvo entre parênteses. Cada beat listado vira um item do roteiro.

### Vídeo 1 — Uso básico (~3 a 4 min)

Carrega o leitor inteiro, porque não existe vídeo dedicado a ele.

- Cabeçalho: Como Usar, Biblioteca, PLPCG (volta à home), Offline, Listas; o
  indicador de estado de conexão
- Filtros: painel colapsável; **Material** (Partitura, Cifra, Gestos em Gravura) com
  "Todos"; **Arranjo** com "Todos"
- **Como abrir**: Leitor, Abrir PDF em nova aba, Compartilhar, Baixar, Leitor Online
- **Buscar** por número e por nome; botão limpar
- Cartão de louvor: `#número – nome`, arranjo, categoria; cartão agrupado com um
  botão por material; botão **+**
- Paginação: itens por página, primeira/anterior/próxima/última, ir para página
- Estados vazios: nenhum material marcado, e o atalho "Selecionar todos"
- **Leitor:** título; página anterior/próxima e o **toque longo** que salta para a
  primeira/última; indicador `n / total`; zoom −/+; o botão de % e o **toque longo**
  que alterna *page-fit* ↔ *page-width*; brilho em ciclo e o **toque longo** que
  volta ao padrão; modo vertical ↔ horizontal; o botão de **camadas** da barra, que
  no tablet em retrato é o que revela o resto dos controlos; **toque longo no PDF**
  para fullscreen e o FAB para sair; swipe horizontal; pinch-to-zoom; PLPCG para
  voltar à home

### Vídeo 2 — Uso Offline (~2 a 3 min)

- O indicador de conexão no cabeçalho e o que cada estado significa
- O resumo de estatísticas: percentagem disponível, botão de atualizar
- Os dois requisitos reais: baixar o acervo **e** ter aberto um PDF no leitor
- **Disponibilizar offline** — um botão, tudo ou nada, **sem escolha de categorias**
- O progresso: lote *n* de *m*, bytes, percentagem, e o botão de cancelar
- Que **Baixar PDFs faltantes** é o que aparece no lugar dele depois, para atualizar
- **Importar pacote offline**: o caminho para a igreja sem internet nenhuma
- A prova: rede desligada, e um louvor já em cache abrindo

**Honestidade de escala:** não serão baixados 846 MB para gravar. O vídeo mostra o
download real a começar e a progredir, e corta com uma fala dizendo que continua em
segundo plano. A demonstração de funcionamento offline usa PDFs de facto cacheados
durante o próprio vídeo (`context.setOffline(true)` depois de os abrir). O mecanismo
mostrado é real; apenas a escala é reduzida, e a narração diz isso em voz alta.

### Vídeo 3 — Uso da Biblioteca (~1,5 a 2 min)

**É o primeiro a ser construído**: é o mais curto, não tem armadilha de offline, e
prova a corrente inteira ponta a ponta.

- Quando usar a Biblioteca em vez da Home: navegar o acervo × procurar um louvor
- **Material**, **Arranjo**, **Arranjo Especial** (que só aparece quando o filtro
  atual tem algum), **Ordenar** (por número / por nome), **Como abrir**
- "Todos" e o toque que seleciona só aquele
- Paginação e itens por página
- Estados vazios: "Nenhum louvor encontrado" × catálogo que não carregou

### Vídeo 4 — Uso das Listas (~3 min)

- Montar na home: o botão **+** nos cartões, e como funciona no cartão agrupado
- A barra **Playlist**: Salvar, Compartilhar, **Em Abas**, **Folheto**,
  Expandir/Encolher, Limpar
- **Reordenar arrastando o chip com o dedo**; remover um louvor
- `/listas`: buscar por nome, favoritar com a estrela, filtrar só favoritas,
  renomear, **Reproduzir**, **Ver**, **Compartilhar**, **Remover** com confirmação
- Visualizar uma lista: renomear, favoritar, apagar, remover louvor, **Editar**
- No leitor: o navegador **Lista**, que passa de um louvor ao outro
- Abrir uma playlist recebida por link

### Vídeo 5 — Problemas conhecidos (~1,5 min)

Só os dois que o Jairo escolheu:

1. **Não dá para apagar downloads um a um.** Está escrito na própria tela: para
   remover, só limpando o cache do navegador inteiro.
2. **Espaço: o acervo completo pesa ~846 MB.** O que isso significa num tablet
   cheio, e o limite de armazenamento no iOS/Safari.

## Verificação

Cada vídeo, antes de ser mostrado ao Jairo:

- `ffprobe` confirma 820×1180, 30 fps, faixa de áudio AAC presente, duração dentro
  do alvo
- cada janela `[inicio, fim]` da timeline tem um PNG de legenda correspondente, e
  nenhuma janela se sobrepõe a outra
- o pico de áudio não passa de −1 dBFS e a integrada fica perto de −16 LUFS
- amostragem visual de quadros nos instantes de zoom, para confirmar que a região
  ampliada é a certa

A mudança em `sobre/+page.svelte` passa por `npm run check` e não encosta em
`src/lib/offline/**`.

## Riscos assumidos

- `playwright` entra como devDependency, e o Chromium são ~150 MB de download
- a gravação interage com produção, mas **só lê**: playlists e cache ficam no perfil
  efémero do Playwright, e nada é escrito no servidor
- se a interface mudar, o roteiro quebra e o vídeo precisa de ser re-gravado — que é
  precisamente a razão de o roteiro ser código e não uma gravação à mão
- narração por TTS: ~US$ 0,05 no total pelo OpenRouter, com `say` do macOS como
  alternativa de custo zero

## Corrigido antes de gravar

A caixa de informação de `/offline` prometia "As categorias selecionadas serão
salvas e usadas para downloads automáticos" — texto órfão da seleção de categorias
que foi removida da tela há tempos. Como essa tela aparece em vídeo, e apresentação
é onde esse tipo de defeito aparece, o texto foi corrigido em
`src/routes/offline/+page.svelte` para descrever o que a tela faz de facto: um
download do acervo inteiro, sem escolha, e o botão de completar o que ficou para
trás.

Fica registado que `src/lib/components/OfflineModal.svelte` carrega uma **segunda
cópia** do mesmo texto errado, e ainda desenha a seleção de categorias visível.
Esse componente **não é importado por ninguém** — é código morto. Não foi tocado:
apagá-lo é uma decisão separada, não um efeito colateral deste trabalho.

Também registado, e **não causado por este trabalho**: `npm run check:offline` sai
com 10 erros no `HEAD` actual (`49fcdc0`), todos em
`src/lib/offline/utils/leitorOffline.test.js`, sobre a tipagem do `fetch` de
mentira. Verificado com a alteração desta sessão guardada de lado: 10 erros com ela
e 10 sem ela. O portão já estava vermelho antes.
