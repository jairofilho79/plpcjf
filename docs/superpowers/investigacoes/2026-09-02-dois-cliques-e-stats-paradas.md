# Dois cliques para abrir, e as estatísticas que não mudam

**Data:** 2026-09-02 · Chrome/macOS contra **plpcg.com** (produção real, não localhost)
**Estado:** investigação fechada. Nenhuma alteração de código feita.

Dois sintomas relatados pelo utilizador: (1) as estatísticas de `/offline` não
atualizam; (2) abrir um material exige dois cliques — o primeiro "dá uma marcação
diferente" e demora muito ou não abre.

São **três causas independentes**. Nenhuma delas se resolve com as outras.

---

## Achado 0 — produção está 106 commits atrás, e nada disso foi enviado

```
origin/main = b837d4a  2026-08-31 17:22
main        = 80943ec  2026-09-02 12:50   (ahead 106)
```

O Cloudflare Pages constrói a partir do GitHub. `origin/main` não se move desde
31/ago 17:22, logo **plpcg.com serve b837d4a**. Os 106 commits dos últimos dois
dias existem só neste disco.

**Como foi confirmado, sem depender do git:** produção grava
`pdfAvailabilityIndex` com `version: 1`; a `main` tem `INDEX_VERSION = 2` desde
`a6b5577` (31/ago 22:49). O índice foi observado a ser reescrito ao vivo com
`version: 1`. E `wrangler pages deployment list` dá `Source: b837d4a` no
deployment de produção mais recente.

### O que isto explica — e o que não explica

Dois commits que corrigem **exatamente** o sintoma das estatísticas estão prontos
e nunca chegaram ao ar:

- `cf4cb56` — *recalcular estatística ao fim do download e da importação*
- `c24d662` — *eliminar disputa de `statsStale` entre download e timer de categorias*

Se a queixa "não atualiza" é **baixei PDFs e os números não mudaram**, é isto.

**Mas publicar não resolve os outros dois achados:**

| Ficheiro | `b837d4a..HEAD` |
|---|---|
| `src/lib/components/LouvorCard.svelte` | **diff vazio** — o caminho de abrir material é idêntico |
| `src/lib/offline/stats/StatsCalculator.js` | só tipos e strings de log; **o laço de chunks é o mesmo** |

Publicar é necessário e não é suficiente.

---

## Achado 1 — o botão "atualizar" espera 95 segundos a não fazer nada

### Medição em produção

Clique em "Clique aqui para atualizar", com 2 PDFs em cache:

| t (s) | evento |
|---|---|
| ~0,6 | clique |
| 3,8 | botão passa a `disabled`, "A atualizar…" |
| 20,0 | `Gestos em Gravura` (254 louvores, 6 chunks) gravado |
| 48,0 | `Partitura` (1654, 34 chunks) gravado |
| **52,8** | varredura termina, capa cai |

Gestos e Partitura diferem em **28 chunks** e em **27,98 segundos**.
**1,00 segundo por chunk, exato.**

### Porquê

`StatsCalculator.js:159-161`, dentro do laço de chunks:

```js
await new Promise(resolve => setTimeout(resolve, 0));
```

São 95 destes por varredura completa (6 + 34 + 55 chunks de 50 louvores).
Um `setTimeout` agendado de dentro de outro `setTimeout` chega ao nível de
aninhamento 5 e o Chrome **trava-o em 1000 ms numa aba não visível** (em aba
visível o clamp é 4 ms). Confirmado na própria página: 30 `setTimeout(…, 0)`
aninhados excederam 45 s.

**95 chunks × 1 s = ~95 s de espera pura.** O trabalho real são milissegundos.

### O segundo custo, muito menor do que parecia

`findMissingPdfs` reconstrói o índice do cache inteiro a cada chunk — 95 vezes
em vez de 1 (`pdfValidation.js:286`, chamado de `StatsCalculator.js:155`).
Medido fora do browser com o acervo real:

```
1x buildPdfCacheIndex(C=4629): 11,7 ms
95x                          : 1,1 s de CPU
4629x idx.has()              : 26 ms
```

Num telemóvel de gama média isso é talvez 5–10 s. **Real, mas não é o dominante.**
A investigação de `2026-09-02-varredura-de-estatisticas.md` classificou este como
o hot spot #1; a medição diz que o hot spot #1 são os *yields*, não o CPU.

### O que isto faz à investigação do "botão preso"

`2026-09-02-fase-9-o-botao-preso.md` registou o botão a nunca soltar em 5
corridas (64 s a 319 s). Nesta corrida ele **soltou, aos 52,8 s**. A diferença
mais provável é tempo de espera: 95 s é o piso quando a aba não está visível, e
sobe com o CPU quando o cache está cheio. A hipótese de lá — que o
`pdfAvailabilityIndex` por gravar segurava o `finally` — não se sustenta: aqui o
índice foi gravado e o botão soltou-se pelo caminho normal.

---

## Achado 2 — cada clique num material paga rede que não devia pagar

Este é o crítico, e é o que produz "dois cliques".

### Medição em produção (modo Leitor, PDF não cacheado)

Primeiro clique em `#300 · Partitura`:

```
/louvores-manifest.sha256           299 ms   ← sonda de conectividade
assets/ColAdultos/300.pdf            38 ms   ← HEAD do NetworkValidator
assets/ColAdultos/300.pdf           159 ms   ← DOWNLOAD COMPLETO via SW
assets/ColAdultos/300.pdf             1 ms
/louvores-manifest.sha256           213 ms   ← segunda sonda
assets/ColAdultos/300.pdf            31 ms
assets/ColAdultos/300.pdf             1 ms
```

**Duas sondas de rede + cinco pedidos do mesmo PDF, incluindo o download inteiro
do ficheiro, antes de navegar.** Em Wi-Fi rápido com um PDF pequeno isso custou
~1 s. Em rede móvel, com as sondas a esgotarem os seus `timeoutMs: 1500` e o HEAD
o seu `AbortSignal.timeout(5000)`, o mesmo caminho custa dezenas de segundos.

Segundo clique, com o PDF **já em cache**: repetiu as duas sondas e vários
pedidos. **Não há caminho rápido.**

### A cadeia, em `LouvorCard.svelte:126-200`

```js
const cached = getCachedValidation(item.pdfId);
if (cached && cached.available) { goto(...); return; }   // ← caminho rápido

const indexCheck = isPdfAvailableInIndex(item.pdfId);
if (indexCheck === true) { ... }                          // ← caminho barato
else {
  const isAvailable = await ensurePdfAvailable(path);     // ← caminho caro
  ...
}
```

**a) O caminho barato quase nunca é escolhido.** `indexCheck === true` exige que
o índice diga "tem". O índice é construído com a lista de PDFs em cache do
momento e vale 24 h. Para quem não baixou o acervo, é `false` em ~4628 das 4630
entradas — medido: `idxTrue: 2`. E `false` cai no **mesmo ramo** que `null`. O
código trata "o índice diz que não tem" como se fosse "não sei", e vai pela rede.

**b) `ensurePdfAvailable` baixa o PDF inteiro dentro do clique.**
`pdfValidation.js:253-280`: valida (espera do SW 500 ms + sonda 1500 ms + HEAD),
faz **outra** sonda, chama `downloadPDFsViaSW`, espera 500 ms fixos, e **revalida
do zero**. Tudo antes de `goto`.

**c) O cache de validação nunca é escrito no caminho de sucesso.**
`ensurePdfAvailable` chama `validatePdfAvailability(pdfPath)` **sem `pdfId`** —
e é `pdfId` que dispara `cacheValidation`. Só o ramo de *falha* passa o `pdfId`.
Resultado: quando o PDF **está** disponível, nada é gravado, e o clique seguinte
repete tudo. Confirmado: após dois cliques bem-sucedidos no mesmo material,
`pdfValidationCache_v1` **não existe** em `localStorage`.

**d) A UI marca e tranca o cartão durante toda a espera.**
`LouvorCard.svelte:510-515`:

```css
.material-open.busy, .material-open.checking {
  opacity: 0.6; cursor: wait; pointer-events: none;
}
```

O primeiro toque escurece a linha e **desliga-a**. O utilizador vê "uma marcação
diferente", nada abre, toca outra vez sem efeito, e só depois — já com o PDF em
cache e o caminho mais curto — é que abre. É a descrição exata do relato.

**e) E o leitor valida de novo.** `routes/leitor/+page.svelte:284-318` repete
`validatePdfAvailability` + `checkEffectiveConnectivity(1500)` sempre que a URL
não traz `validated=true` — o que acontece justamente nos ramos incertos.

---

## Soluções propostas

Por retorno sobre esforço. Nada disto foi implementado.

### P0 — publicar `main`

`git push origin main`. Leva `cf4cb56` e `c24d662` (stats recalculam ao fim do
download) e 104 outros commits. **Risco:** 106 commits nunca estiveram em
produção; o salto é grande. Vale rever `TESTING_CHECKLIST.md` antes.

### P1 — o clique navega primeiro e valida depois

Trocar "validar, depois navegar" por "navegar, e o leitor resolve". O `/leitor`
já sabe procurar no cache, cair para a rede e mostrar erro. O clique passa a ser
`goto()` imediato: **latência percebida vai a zero, online e offline**.

- Elimina (b), (d) e (e) de uma vez.
- **Custo:** com o PDF ausente e sem rede, o erro aparece dentro do leitor em vez
  de no cartão. Se isso não for aceitável, manter a validação mas **só** com o
  que é local (cache) — nunca rede — e navegar na dúvida.

### P2 — nunca baixar o PDF inteiro dentro do clique

Tirar `downloadPDFsViaSW` + `setTimeout(500)` + revalidação de
`ensurePdfAvailable`. O SW já busca da rede ao renderizar. Independente de P1 e
mais pequeno.

### P3 — gravar o cache de validação no sucesso

Passar `pdfId` em `ensurePdfAvailable`/`validatePdfAvailability` no ramo feliz.
Uma linha, e faz o caminho rápido (`getCachedValidation`) passar a existir.
Mesmo mantendo tudo o resto, o **segundo** clique deixa de pagar rede.

### P4 — `indexCheck === false` é "não sei", não é "não tem"

Enquanto o índice for construído a partir de uma lista de cache que pode estar
vazia e valer 24 h, `false` é falso-negativo frequente. Ou tratar `false` como
`null`, ou parar de gravar índices construídos com a lista vazia.

### P5 — parar de ceder 95 vezes na varredura

Duas mudanças no laço de `StatsCalculator.js:149-161`:

1. **Ceder por tempo, não por chunk** — `if (performance.now() - ultimo > 16)` —
   e usar `MessageChannel` (ou `scheduler.yield()`) em vez de `setTimeout(0)`:
   nenhum dos dois sofre o clamp de 1 s.
2. **Construir o índice uma vez por varredura** e passá-lo a `findMissingPdfs`,
   em vez de o reconstruir 95 vezes. Poupa ~1,1 s de CPU no desktop, mais no
   telemóvel. (Plano detalhado já escrito em
   `2026-09-02-varredura-de-estatisticas.md`, secção C.)

Juntas, levam a varredura de ~95 s para ~1 s.

---

## Limites desta investigação

- **Todas as medições de browser correram com `document.visibilityState ===
  "hidden"`** (a janela de automação não estava em foco). O clamp de 1 s é
  exatamente o comportamento de aba escondida. **Numa aba visível a varredura
  deve custar ~2 s + CPU, não 95 s.** Os 95 s são o piso do caso "utilizador
  saiu da aba / ecrã bloqueou" — provável no telemóvel, mas não provado como
  sendo o caso do utilizador.
- Não reproduzi com o acervo completo (4630 PDFs) em cache, em produção. O termo
  de CPU (95 × 4629 normalizações) foi medido fora do browser, em Node, num Mac.
- Não testei em telemóvel.
- **"O primeiro clique não abre" não foi reproduzido literalmente:** nas minhas
  corridas o primeiro clique sempre navegou, só que devagar. A explicação por
  `pointer-events: none` + latência de vários segundos é consistente com o código
  e com o escurecimento observado, mas é hipótese, não observação.
