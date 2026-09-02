# Plano — latência de abertura de material e varredura de estatísticas

**Base:** `80943ec` (`main`, 2026-09-02)
**Origem:** `docs/superpowers/investigacoes/2026-09-02-dois-cliques-e-stats-paradas.md`

Três lanes independentes, em worktrees separadas. Os conjuntos de ficheiros são
disjuntos de propósito — nenhuma lane pode editar ficheiro de outra.

## Restrições globais (valem para as três lanes)

1. **Base obrigatória:** a worktree TEM de partir de `80943ec`. Confirmar com
   `git log -1 --format=%H` antes de escrever qualquer código. Se a base for
   outra, PARAR e reportar — worktrees deste projeto já nasceram ~60 commits
   atrasadas.
2. **Propriedade de ficheiros é exclusiva.** Não editar ficheiro fora da lista
   da tua lane, nem "só para arrumar".
3. **TDD:** teste que falha primeiro, depois o código. Testes correm com
   `node --test` e não podem depender de DOM, `window` nem Vite. Módulos novos
   importam por caminho relativo (não `$lib`) se precisarem de correr sob
   `node --test` — ver o comentário no topo de `PdfPathManager.js`.
4. **Sem regressão de comportamento offline.** A app tem de continuar a abrir
   PDFs já baixados sem rede.
5. `npm run check` não pode ganhar erros novos. Rodar antes de commitar.
6. Comentários e mensagens de commit em português, no estilo do repo: explicam
   **porquê**, não o quê.
7. Não fazer `git push`. Não fazer merge para `main`. Commitar só na própria branch.

---

## Lane A — o clique abre, não valida

**Branch:** `perf/abertura-imediata`
**Ficheiros seus (e só estes):**
- `src/lib/components/LouvorCard.svelte`
- `src/lib/utils/navigateLouvorToLeitor.js`
- `src/lib/utils/pdfValidation.js`
- `src/routes/leitor/+page.svelte`

### Problema

Medido em produção: um clique num material dispara 2 sondas de conectividade e
5 pedidos do mesmo PDF — incluindo o **download completo do ficheiro** — antes
de navegar. O cartão fica `pointer-events: none` durante tudo isso, o que produz
o relato "o primeiro clique só marca, não abre".

### A1 — `openLouvor` navega já (modo `leitor`)

Em `LouvorCard.svelte`, o ramo `mode === 'leitor'` de `openLouvor` passa a:

```
rememberOpened(item)  →  goto(url)
```

Nada mais. Remover do caminho do clique: `getCachedValidation`,
`isPdfAvailableInIndex`, `ensurePdfAvailable`, `validatePdfAvailability`,
`checkEffectiveConnectivity` e o `setTimeout` de 500 ms.

- A URL deixa de levar `&validated=true` — o leitor passa a resolver sempre a
  origem sozinho (ver A3). Não inventar um `validated` novo.
- `isCheckingAvailability`, `availabilityError` e o uso de `busyPdfId` **para o
  modo leitor** deixam de ter função: remover, incluindo as classes
  `.checking` / `.busy` que aplicam `pointer-events: none` a esse caminho, e o
  bloco `.availability-error` se ficar sem escritor.
- **Manter** intactos os estados ocupados dos modos `share` e `save`: esses
  esperam mesmo por um blob (`isSharing`/`isSaving`).
- Os modos `online` e `newtab` ficam como estão.

### A2 — o mesmo em `navigateLouvorToLeitor.js`

Aplicar o mesmo princípio ao helper. Verificar quem o chama
(`grep -rn navigateLouvorToLeitor src/`) e manter a assinatura pública, para não
partir os chamadores.

### A3 — o leitor resolve a origem, e só diagnostica quando falha

Em `routes/leitor/+page.svelte`, o caminho de carregamento (hoje à volta das
linhas 200-330 e 416) inverte a ordem:

1. Tentar resolver o PDF pela ordem normal (cache do SW → rede), como
   `pdfSourceResolver` já faz.
2. **Só se isso falhar** é que se diagnostica: `checkEffectiveConnectivity`,
   `validatePdfAvailability`, e a mensagem de erro.

Hoje `checkEffectiveConnectivity({ timeoutMs: 1500 })` corre **antes** de se
tentar sequer ler o cache. Isso é 1,5 s desperdiçado no caso comum, e é
exatamente o custo que o utilizador sente quando está offline com o PDF baixado.

Requisito de UX que substitui o aviso removido em A1: quando o PDF não existe
nem em cache nem na rede, o leitor mostra mensagem clara e acionável — sem rede
e sem download, dizer que o material não está disponível offline e apontar para
`/offline`. Se já existir uma mensagem assim, reutilizá-la.

### A4 — o sucesso passa a ser gravado no cache de validação

Em `pdfValidation.js`:

- `ensurePdfAvailable(pdfPath)` ganha um segundo parâmetro `pdfId` opcional e
  passa-o a `validatePdfAvailability`. Hoje chama sem `pdfId`, e é o `pdfId`
  que dispara `cacheValidation` — por isso **um PDF disponível nunca é
  memorizado**, e o custo repete-se em cada clique, para sempre. Confirmado em
  produção: `pdfValidationCache_v1` não existia depois de duas aberturas
  bem-sucedidas do mesmo material. Atualizar os chamadores dentro dos teus
  ficheiros.
- `validatePdfAvailability` deixa de sondar a rede antes de olhar para o cache.
  Ordem nova: `compositeValidator.validate(..., { checkNetwork: false })`
  primeiro; **só se der indisponível** é que se chama
  `checkEffectiveConnectivity` e se repete com `checkNetwork: true`. O
  resultado para PDFs em cache tem de ser idêntico ao de hoje, sem tocar na rede.
- **Não** mexer em `findMissingPdfs` — é da Lane B por acordo; deixá-la exatamente
  como está.

### A5 — `downloadPDFsViaSW` sai do caminho de abertura

O bloco de auto-download dentro de `ensurePdfAvailable` (baixar + esperar 500 ms
+ revalidar do zero) sai. Quem abre um PDF não deve baixar o ficheiro duas vezes:
o SW já o busca da rede ao renderizar. Se algum chamador **fora** dos teus
ficheiros depender desse efeito, não o remover às cegas — reportar e propor.

### Verificação da Lane A

- Testes `node --test` para o que for testável sem DOM (a reordenação de
  `validatePdfAvailability` e o encaminhamento do `pdfId` são testáveis com
  duplos).
- `npm run check` sem erros novos.
- No relatório, listar explicitamente **quantas chamadas de rede** restam no
  caminho do clique. O alvo é **zero**.

---

## Lane B — a varredura para de esperar 95 segundos

**Branch:** `perf/varredura-estatisticas`
**Ficheiros seus (e só estes):**
- `src/lib/offline/stats/StatsCalculator.js`
- `src/lib/utils/pdfCacheIndex.js`
- `src/lib/offline/stats/yieldScheduler.js` (novo)
- testes novos ao lado dos módulos

### Problema, medido

A varredura forçada faz 95 `await new Promise(r => setTimeout(r, 0))`
sequenciais (`StatsCalculator.js:159`), um por chunk de 50 louvores. Um
`setTimeout` agendado de dentro de outro chega ao nível de aninhamento 5, e o
Chrome trava-o em **1000 ms** numa aba não visível. Medido em produção:
`Gestos` (6 chunks) e `Partitura` (34 chunks) gravadas com 27,98 s de diferença
— **1,00 s por chunk, exato**. Total ~95 s de espera pura.

Custo secundário, medido em Node com o acervo real (4629 caminhos):
`buildPdfCacheIndex` custa 11,7 ms; a varredura chama-o **95 vezes** (uma por
chunk, via `findMissingPdfs`) em vez de uma. São ~1,1 s de CPU desperdiçado num
Mac, mais num telemóvel.

### B1 — `yieldScheduler.js` (módulo novo, com testes)

Exportar `criarCedente({ orcamentoMs = 16, agendar } = {})` devolvendo
`{ talvezCeder() }`:

- `talvezCeder()` devolve uma Promise. Só cede de facto quando passaram mais de
  `orcamentoMs` desde a última cedência; caso contrário resolve de imediato
  (sem `await` de macrotarefa).
- A cedência real usa `MessageChannel` quando existe — **não** sofre o clamp de
  1 s — e cai para `setTimeout(…, 0)` quando não existe (Node).
- `agendar` é injetável para os testes.

Testes: (a) N chamadas dentro do orçamento não cedem; (b) cede depois de o
orçamento estourar; (c) o número de cedências reais é muito menor que o número
de chamadas; (d) o fallback é usado quando `MessageChannel` não existe.

### B2 — o índice é construído uma vez por lista

Em `StatsCalculator`, memoizar o índice pela **identidade da lista** de PDFs em
cache, com um `WeakMap` de instância:

```js
#indicePorLista = new WeakMap();  // Array<string> -> PdfCacheIndex
```

Isto resolve de graça o caso das 3 categorias em paralelo: `+page.svelte` passa
o **mesmo array** `cachedPdfs` às três chamadas de `getCategoryStats`
(`routes/offline/+page.svelte`, dentro de `loadCategoryStatsForCategories`), logo
as três partilham um índice só. Não é preciso tocar em `+page.svelte`.

Invalidação: o `WeakMap` é por identidade de array, e `loadCachedPdfsList` cria
um array novo a cada leitura — a entrada velha morre sozinha. Não acrescentar
invalidação manual. Limpar o `WeakMap` em `invalidateAll()` (basta reatribuir).

### B3 — o laço de chunks deixa de chamar `findMissingPdfs`

`getCategoryStats` passa a:

1. obter o índice memoizado (B2);
2. percorrer `categoryLouvores` **uma vez**, contando os que faltam com
   `indice.has(getPdfRelPath(louvor))` — os louvores sem `pdfId` ou sem caminho
   são saltados, exatamente com o critério de hoje em `findMissingPdfs`;
3. chamar `talvezCeder()` a cada louvor (o cedente decide sozinho se cede).

Consequências a respeitar:

- **`findMissingPdfs` em `pdfValidation.js` NÃO é editada** — é ficheiro da
  Lane A. `StatsCalculator` simplesmente deixa de a importar e passa a importar
  `buildPdfCacheIndex` de `pdfCacheIndex.js`, `PdfPathManager` e `getPdfRelPath`
  de `pathUtils.js`. Os outros três chamadores de `findMissingPdfs`
  (`offlineStats.js`, `missingPdfsDownloader.js`, `DownloadManager.js`) ficam
  intocados.
- A contagem devolvida tem de ser **idêntica** à de hoje. Escrever um teste que
  prova isso: mesmo conjunto de louvores e de URLs em cache, comparar o número
  de faltantes do caminho novo com o de `findMissingPdfs`.
- O ramo `> 100` deixa de existir: um só caminho para categorias de qualquer
  tamanho.

### B4 — `toComparablePath` para de lançar em cada consulta

`pdfCacheIndex.js:29` chama `new URL(candidate)` em caminhos relativos como
`assets/…/Cifra.pdf`. Isso **lança sempre**, e o `catch` é o caminho normal —
uma exceção real por louvor, ~4629 por varredura. Testar se a string parece
absoluta (`url.includes('://')`) antes de construir o `URL`. Resultado tem de
ser idêntico; há testes existentes em `pdfCacheIndex.test.js` que têm de
continuar a passar.

### Verificação da Lane B

- `node --test` nos ficheiros novos e em `src/lib/utils/pdfCacheIndex.test.js`.
- Um teste de equivalência: caminho novo vs `findMissingPdfs`, mesmos números.
- `npm run check` sem erros novos.
- No relatório: quantas cedências reais ocorrem numa varredura de 4629 louvores
  (medir), contra as 95 de hoje.

---

## Lane C — go/no-go para publicar os 106 commits

**Sem branch e sem edição de código.** Corre na árvore principal, só lê e
executa. Entrega um relatório.

`origin/main` está em `b837d4a` (31/ago 17:22); `main` local está em `80943ec`,
**106 commits à frente**. plpcg.com serve `b837d4a`. Nada disto foi publicado.

O `git push origin main` dispara build e deploy de produção. Antes de eu propor
esse push ao meu parceiro humano, preciso de saber o que ele leva.

### C1 — a suite passa?

Correr e registar saída literal: `npm test`, `npm run check`,
`npm run check:offline`, `npm run build`. Não corrigir nada — só reportar.

### C2 — o que muda para quem já tem o acervo baixado (o risco real)

Há utilizadores com ~4630 PDFs em Cache Storage. A pergunta que importa:
**alguma coisa em `b837d4a..main` obriga esses utilizadores a re-baixar tudo, ou
faz a app achar que não têm nada?**

Auditar em `git diff b837d4a..main`, com números de linha e citação:

- nomes e versões de cache (`PDF_CACHE_NAME` e afins em
  `src/lib/offline/sw/swCaches.js`, `src/service-worker.js`);
- `pdfCacheVersion` e as migrações (`CacheMigration.js`,
  `pdfCacheNfcMigration.js`, e o commit `fab344c` que passou a disparar a
  migração NFC em toda a visita);
- versões e chaves de armazenamento: `INDEX_VERSION` (1 → 2, invalida o índice
  de toda a gente), `VALIDATION_CACHE_KEY`, `STATS_CACHE_KEY`, `storageKeys.js`;
- a normalização de caminhos (#22.3/#22.4/#22.5, `bdeea4b`): a correspondência
  ficou mais **estrita**; confirmar se PDFs já em cache continuam a ser
  encontrados, ou se passam a contar como faltantes.

Para cada item: **muda o que o utilizador vê? obriga a re-download? é
reversível?**

### C3 — endpoints e rotas removidos

`POST /api/upload-louvor` foi removido. Verificar se mais alguma rota, endpoint
ou chave pública desapareceu em `b837d4a..main`, e se algo externo (a app
admin em `admin.plpcg.com`, o Worker) depende disso.

### C4 — veredicto

Uma tabela de riscos ordenada por gravidade, e um **GO** ou **NO-GO** com
justificação. Se NO-GO, dizer exatamente o que tem de ser feito primeiro.
Incluir o comando de deploy correto — o `README` avisa que `npm run deploy` vai
para Preview e que produção exige `--branch=main`; aqui o caminho é o push para
o GitHub, que é o que o Pages constrói. Confirmar qual dos dois está de facto
ligado.
