# Pipeline dos vídeos tutoriais

Produz os cinco vídeos que `src/routes/sobre/+page.svelte` promete: uso básico,
offline, biblioteca, listas e problemas conhecidos.

O roteiro de cada vídeo é código (`roteiros/<id>.mjs`) e é a única fonte da
verdade: cada *beat* carrega junto a ação, a fala e a região de zoom. O campo
`fala` alimenta três saídas — a voz, a legenda queimada e o `.vtt` —, então é
impossível a legenda discordar da narração.

## Ordem

```
musica    →  leito musical (uma vez, serve os cinco)
narrar    →  wav por beat + a duração que cada beat vai ter
gravar    →  quadros carimbados + timeline.json
legendar  →  PNG por fala + .vtt
montar    →  mp4 final, reprovado pelo próprio portão se sair torto
publicar  →  R2 (único passo que sai da máquina; pede confirmação)
```

A narração vem **antes** da gravação de propósito: é a duração da fala que
determina quanto tempo cada passo fica na tela. O contrário produz narração
cavalgando o passo seguinte.

## Correr

```bash
npm run musica
npm run video 03-biblioteca            # narrar → gravar → legendar → montar
VIDEO_TTS=macos npm run video 03-biblioteca   # sem custo e sem rede, só valida o encanamento
```

`build/` é descartável: apagar e correr de novo reconstrói tudo. O cache de voz
(`.cache/`) é indexado pelo hash da fala, então mudar uma frase não re-sintetiza
nem re-cobra as outras.

## Detalhes que não são óbvios

- **Este ffmpeg não tem `libass` nem `drawtext`.** Legenda é sempre PNG sobreposto.
- **Os quadros vêm de `Page.startScreencast` do CDP**, não do `recordVideo` do
  Playwright: os carimbos do screencast vivem no mesmo relógio dos beats, e é isso
  que impede legenda e zoom de derivarem.
- **O toque sintético é invisível**, então a página recebe um indicador injetado.
  Sem ele o espectador vê a tela mudar sem causa visível.
- **A música é sintetizada aqui** a partir de uma obra em domínio público. A
  gravação é nossa; não há acervo de terceiros envolvido.
