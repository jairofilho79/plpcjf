# Dívida técnica do plpcjf — plano em fases

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar, uma fase de cada vez, os cinco itens de dívida que sobraram depois do trabalho de 2026-09-01 — armazenamento que quebra em navegador com dados bloqueados, a varredura de estatísticas de 2min30, o contrato desonesto do `loadCategoryStats`, a migração NFC que pode apagar a chave boa, e o `resultadosProntos` com duas semânticas.

**Architecture:** Oito fases independentes. Cada uma é mergeável sozinha, entrega valor sozinha, e não depende da seguinte — só a Fase 1 é pré-requisito (das Fases 2, 3 e 8). A ordem proposta é por dano ativo, não por tamanho: primeiro o que impede o app de abrir, depois o que o deixa lento, depois o que é seguro por acidente.

**Tech Stack:** SvelteKit 2 / Svelte 4, Vite 5, `node --test`, `svelte-check` via `scripts/checkOfflineGate.mjs`.

**Spec / origem:** `docs/superpowers/verificacao-manual-2026-09-01.md` §3 (as três pendências que sobraram) mais dois achados novos da execução de 2026-09-01, registrados no relatório final daquela branch.

**Investigações que sustentam este plano** — leia a que corresponde à sua fase; elas têm os `file:line` e as contagens que os passos abaixo resumem:

- `docs/superpowers/investigacoes/2026-09-02-varredura-de-estatisticas.md` (Fases 4 e 5)
- `docs/superpowers/investigacoes/2026-09-02-inventario-localstorage.md` (Fases 1, 2, 3 e 8)
- `docs/superpowers/investigacoes/2026-09-02-normalizeforstorage-e-resultadosprontos.md` (Fases 6 e 7)

**Base:** `main` em `6ebee01`. Uma branch por fase, a partir da `main` daquele momento.

## Global Constraints

Valem em **todas** as fases.

- **Runner de teste:** `node --test` apenas. Sem vitest, sem jest, **sem dependência nova**. A suíte roda por `npm test` = `node --test $(find src -name '*.test.js')` — o glob do CLI não funciona no Node 20, que é o que `.node-version` fixa. Todo teste novo termina em `.test.js` dentro de `src/`.
- **`src/lib/server/r2KeyMatch.js` e `worker/` não podem ser tocados.** São deploy separado; `v2.plpcg.com` e `120826.plpcg.com` servem PDFs só através do Worker.
- **`npm run check:offline` tem de sair 0.** Nunca afrouxar `TARGET_PREFIXES` em `scripts/checkOfflineGate.mjs` para fazer um portão passar.
- **`PdfPathManager.js` é território proibido** em todas as fases deste plano. A Fase 6 existe justamente para fechar um risco **sem** tocá-lo. Se alguma fase parecer precisar mudá-lo, pare e reporte — isso é plano à parte.
- **Idioma:** comentários e texto de interface em português, na voz do arquivo editado. `src/routes/offline/+page.svelte` usa português europeu em algumas strings ("A atualizar…") — não padronizar o que já existe.
- **Nada é publicado.** Sem `git push`, sem `npm run deploy`. Mesclar não publica: produção é comando separado.
- **Ao fim de cada tarefa:** `npm test` verde, `npm run check:offline` em zero, `npm run build` limpo.
- **Verificação em navegador** exige o proxy de produção do §4 de `verificacao-manual-2026-09-01.md`, contra `npm run build && npm run preview` — nunca contra o dev server. Não commitar o proxy. Truque necessário: **remover o proxy do manifesto não produz falha**, porque o app tem rota servidora própria que busca upstream; para simular falha, aponte `/louvores-manifest.json` para `http://127.0.0.1:9`.

---

## Por que esta ordem

| Fase | O quê | Dano hoje |
|---|---|---|
| 1 | Fundação: wrapper de storage + fake de teste | Nenhum — nada passa a usá-lo ainda |
| 2 | `clearAllCache()` aborta pela metade | Nenhum hoje — o caminho não tem chamador vivo (ver correção na Fase 2) |
| 3 | Quatro guardas que não guardam | **App não abre** em Firefox estrito / aba privada |
| 4 | Varredura de estatísticas | 2min30 e renderer travado, para todo mundo |
| 5 | `loadCategoryStats` mente sobre frescor | Capa some sobre números não recalculados |
| 6 | Migração NFC apaga a chave boa | Nenhum hoje — nenhum caminho do acervo tem `%` |
| 7 | `resultadosProntos` | `?pagina=999` preso na URL |
| 8 | Faxina mecânica do resto do storage | Nenhum imediato; reduz superfície |

Fase 3 vem antes da 4 porque "o app não abre" é pior que "o app é lento", mesmo atingindo menos gente. Fase 6 vem tarde apesar de soar a mais assustadora porque **não pode disparar hoje**: os 4629 caminhos do acervo não têm um único `%`. As fases são independentes — se você preferir outra ordem, só a Fase 1 precisa vir antes das 2, 3 e 8.

---

# FASE 1 — Fundação de armazenamento seguro

**Uma tarefa. Risco zero: nada passa a importar o módulo novo nesta fase.**

**O problema que ela prepara:** em Firefox com "bloquear cookies e dados de sites" no modo estrito, `window.localStorage` é um **getter que lança `SecurityError` ao ser lido** — não só `setItem`. O repo já sabe disso: `src/lib/stores/offline.js:531-538` documenta exatamente esse mecanismo ao justificar por que `safeStorage()` usa `try/catch` em vez de `typeof`. Mas esse wrapper é privado do arquivo e usado em 6 dos 26 acessos dele.

## Task 1: o módulo `safeStorage` e o fake de teste

**Files:**
- Create: `src/lib/utils/safeStorage.js`
- Create: `src/lib/utils/safeStorage.test.js`
- Create: `src/lib/testing/fakeStorage.js`

**Interfaces — Produces:**

```js
getStorage(): Storage | null          // storage utilizável, ou null. Nunca lança.
safeGet(key): string | null           // valor, ou null (chave ausente OU storage indisponível). Nunca lança.
safeSet(key, value): boolean          // true se gravou. Nunca lança.
safeRemove(key): boolean              // false só se o acesso lançou. Nunca lança.
safeKeys(): string[]                  // todas as chaves, ou []. Nunca lança.
safeRemoveMany(keys): { removed: string[], failed: string[] }  // continua após falha. Nunca lança.
```

**Decisão de design, já tomada — implemente assim:** `safeGet` devolve `null` tanto para "chave não existe" quanto para "storage indisponível". Isso é o que torna as Fases 2, 3 e 8 mecânicas: quem hoje faz `localStorage.getItem(k)` e já trata `null` como "não tenho esse dado" troca por `safeGet(k)` **sem mudar lógica nenhuma**. Não invente um canal de erro novo; nenhum dos pontos crus de hoje surfaceia esse erro para a interface, e o padrão estabelecido no repo é logar e seguir com o default.

**Injeção:** as funções operam sobre `globalThis.localStorage` (exigir que todo chamador passe o storage seria mudança de assinatura grande demais para as fases seguintes). Os testes injetam por `globalThis`, que **já é o padrão do repo** — veja `src/lib/pdf-reader/readerPreferences.test.js`.

- [ ] **Passo 1: escrever o fake de teste**

Criar `src/lib/testing/fakeStorage.js`, exportando duas fábricas. Hoje existe uma `criarStorage()` em `readerPreferences.test.js` e uma `createStorage()` quase idêntica em `validationCacheStore.test.js`; **não** as unifique nesta fase (mexer em teste que passa é risco sem ganho) — só crie o helper novo para o uso novo.

```js
/**
 * Fakes de `Storage` para teste. `node --test` não tem localStorage, e o
 * cenário que importa aqui — Firefox com dados bloqueados — não é "storage
 * ausente", é "storage que lança ao ser tocado".
 */

/**
 * @param {Record<string, string>} [inicial]
 * @returns {Storage}
 */
export function criarFakeStorage(inicial = {}) {
  const dados = new Map(Object.entries(inicial));
  return /** @type {any} */ ({
    get length() { return dados.size; },
    key: (/** @type {number} */ i) => [...dados.keys()][i] ?? null,
    getItem: (/** @type {string} */ k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { dados.set(k, String(v)); },
    removeItem: (/** @type {string} */ k) => { dados.delete(k); },
    clear: () => { dados.clear(); }
  });
}

/**
 * Storage em que TODA operação lança — o cenário do Firefox estrito.
 * @param {string} [nomeDoErro]
 * @returns {Storage}
 */
export function criarStorageQueLanca(nomeDoErro = 'SecurityError') {
  const lancar = () => {
    const e = new Error('storage bloqueado');
    e.name = nomeDoErro;
    throw e;
  };
  return /** @type {any} */ ({
    get length() { return lancar(); },
    key: lancar, getItem: lancar, setItem: lancar, removeItem: lancar, clear: lancar
  });
}

/**
 * Storage que lê bem mas lança ao gravar — cota estourada, Safari privado antigo.
 * @param {Record<string, string>} [inicial]
 * @returns {Storage}
 */
export function criarStorageSomenteLeitura(inicial = {}) {
  const base = criarFakeStorage(inicial);
  const lancarQuota = () => {
    const e = new Error('cota excedida');
    e.name = 'QuotaExceededError';
    throw e;
  };
  return /** @type {any} */ ({ ...base, setItem: lancarQuota, removeItem: lancarQuota,
    get length() { return base.length; }, key: (/** @type {number} */ i) => base.key(i),
    getItem: (/** @type {string} */ k) => base.getItem(k) });
}
```

- [ ] **Passo 2: escrever os testes que falham**

Criar `src/lib/utils/safeStorage.test.js`. Cobrir, no mínimo:

1. `safeGet` devolve o valor quando existe; `null` quando a chave não existe; `null` — **sem lançar** — com `criarStorageQueLanca()`.
2. `safeSet` devolve `true` no caminho feliz; `false` — sem lançar — com `criarStorageSomenteLeitura()` e com `criarStorageQueLanca()`.
3. `safeRemove` devolve `true` quando remove e quando a chave não existia; `false` com storage que lança.
4. `safeKeys` devolve as chaves; `[]` com storage que lança.
5. **`safeRemoveMany` é o teste central desta fase:** com um storage que lança **só** na segunda de quatro chaves, o resultado tem de trazer as outras três em `removed` e a segunda em `failed` — provando que ela não aborta na primeira falha. Este é o comportamento que a Fase 2 vai consumir.
6. `getStorage()` devolve `null` e não lança quando `globalThis.localStorage` é um getter que lança. Monte esse caso com `Object.defineProperty(globalThis, 'localStorage', { get() { throw ... }, configurable: true })` — é a única forma de reproduzir o cenário real, e é diferente de só atribuir um fake.
7. Sem `globalThis.localStorage` definido (SSR): tudo devolve o default, nada lança.

Use `beforeEach`/`afterEach` para instalar e remover `globalThis.localStorage` e `globalThis.window`, como `readerPreferences.test.js` já faz.

- [ ] **Passo 3: rodar para ver falhar**

```bash
node --test src/lib/utils/safeStorage.test.js
```

Esperado: FALHA — `src/lib/utils/safeStorage.js` não existe.

- [ ] **Passo 4: escrever o módulo**

Criar `src/lib/utils/safeStorage.js`. Requisitos que os testes fixam: **nenhuma função lança, nunca**; toda leitura de `globalThis.localStorage` acontece dentro de `try`; `safeRemoveMany` tenta todas as chaves mesmo depois de uma falhar.

Ponha no topo do arquivo um comentário explicando por que ele existe — que `typeof localStorage === 'undefined'` **não** protege, porque `typeof` só suprime exceção para referência não resolvível (ECMA-262 §13.5.3), e `localStorage` é resolvível: o `[[Get]]` dela é que lança. Esse comentário é o que impede alguém de "simplificar" o módulo de volta para o padrão quebrado.

- [ ] **Passo 5: rodar para ver passar, e os portões**

```bash
node --test src/lib/utils/safeStorage.test.js
npm test
npm run check:offline
```

- [ ] **Passo 6: commit**

```bash
git add src/lib/utils/safeStorage.js src/lib/utils/safeStorage.test.js src/lib/testing/fakeStorage.js
git commit -m "feat(storage): wrapper que nunca lança para localStorage"
```

---

# FASE 2 — A limpeza que abortava pela metade

**Uma tarefa.** É a linha de §3 literalmente nomeada no defeito original.

## Task 1: `clearAllCache()` usa `safeRemoveMany`

**Origem:** §3 — "`offline.js` — 20+ acessos crus a `localStorage`. Num navegador com armazenamento bloqueado, a limpeza de dados pode lançar no meio e abortar em silêncio."

**O sítio exato:** `src/lib/stores/offline.js:1904-1909` — seis `removeItem` crus em sequência. Se o terceiro lançar, os dois primeiros já foram removidos e os três últimos não: `ALLOW_OFFLINE_KEY` limpo mas as chaves de categorias baixadas intactas, ou seja, o app acha que não tem permissão de offline mas continua listando categorias como baixadas.

**Files:**
- Modify: `src/lib/stores/offline.js:1904-1909`

- [ ] **Passo 1: trocar a sequência crua por uma chamada**

Importar `safeRemoveMany` de `$lib/utils/safeStorage.js` e substituir os seis `removeItem` por uma chamada única. Manter o `try/catch` externo e a mensagem de erro que já existem — mas agora **informados** por `{ removed, failed }` em vez de um `throw` genérico que não diz o que sobreviveu.

Quando `failed` não estiver vazio, a mensagem de erro que a interface já mostra ("Erro ao limpar cache") deve passar a dizer quantas chaves de quantas foram removidas. Não invente um canal de erro novo — enriqueça o que já existe.

- [ ] **Passo 2: verificar e commitar**

```bash
npm test && npm run check:offline && npm run build
git add src/lib/stores/offline.js
git commit -m "fix(offline): limpeza de dados não aborta na primeira chave que falha"
```

> **Correção de 2026-09-02, depois da execução:** esta fase corrige um caminho
> que **hoje nada alcança**. Nem `offline.js:clearAllCache` nem `disableOffline`
> (que a chama) têm chamador vivo no repo; a rota `/offline` tem uma
> `clearAllCache` **própria** (`src/routes/offline/+page.svelte:1226`) que
> também não tem chamador, e o texto da tela (`:1368`) manda o utilizador limpar
> o cache do navegador à mão. Ou seja: a tabela "Por que esta ordem" classifica
> o dano desta fase como "limpeza deixa estado inconsistente", e isso é **dano
> latente, não ativo**. A correção continua certa e barata — fica pronta para o
> dia em que alguém ligar o botão — mas quem reordenar as fases deve saber que
> esta não tem urgência. O código morto é assunto à parte.

**Verificação manual:** no DevTools, `Object.defineProperty(window, 'localStorage', { get() { throw new Error('x') } })` **não** funciona depois da página carregar (os módulos já capturaram referências). Verifique em vez disso pelo caminho feliz: limpar o cache pela interface e confirmar que todas as chaves somem e a mensagem de sucesso aparece — a prova do caminho de falha é o teste unitário da Fase 1.

---

# FASE 3 — As guardas que não guardam

**Cinco tarefas, uma por arquivo. É a fase de maior risco real do plano** — não pela mudança em si, que é mecânica, mas porque `loadLouvores()` roda no mount de quatro rotas e qualquer regressão de comportamento aqui aparece em todo lugar.

**O achado:** `if (typeof localStorage === 'undefined') return` **não protege** contra storage bloqueado. `typeof` só suprime exceção para referência não resolvível; `localStorage` existe, e o getter dela é que lança. Então a guarda lança exatamente no cenário que deveria evitar. Não é falta de robustez — é uma guarda que **parece** proteger, e faria qualquer revisor concluir errado que o caminho está seguro.

**Regra que vale para as cinco tarefas:** trocar `typeof localStorage === 'undefined'` + acesso cru por `safeGet`/`safeSet`/`safeRemove`. O revisor tem de confirmar, função a função, que **nenhuma lógica que dependia do `typeof` mudou de comportamento** — em particular o early-return em SSR (sem `window`), que `safeGet`/`safeSet` preservam devolvendo `null`/`false`.

- [ ] **Task 1: `src/lib/utils/cacheSync.js`** — linhas 164, 202, 220. Roda em `setupCacheSync()`, chamado na `+layout.svelte` e em `/offline`.
- [ ] **Task 2: `src/lib/utils/louvoresManifestChecksum.js`** — linhas 44, 53, 59, 68, 79, 96. **Zero guardas hoje.** Está no caminho de `loadLouvores()`, ou seja, no mount de `/`, `/listas`, `/biblioteca` e `/offline`.
- [ ] **Task 3: `src/lib/utils/pdfValidation.js`** — linhas 61, 75, 86, 96, 104. Caminho de `ensureLegacyMigration`/`getCachedValidation`: qualquer renderização de PDF.
- [ ] **Task 4: `src/lib/utils/swRegistration.js`** — linhas 340, 389, 410 (as três que usam o padrão quebrado; os outros 15 acessos do arquivo ficam para a Fase 8).
- [ ] **Task 5: `OfflineIndicator.svelte` e `OfflineRequirementsAlert.svelte`** — `OfflineIndicator.svelte:21` faz leitura direta, sem `try/catch`, dentro de uma expressão `$:` que roda a cada montagem do componente **na layout raiz**. É o maior blast radius do levantamento inteiro: uma falha aqui não fica confinada à tela de offline, quebra toda página do site. Separada das outras quatro porque é Svelte, não JS puro — não dá para testar sob `node --test`, e a verificação é outra.

Cada tarefa: trocar, rodar `npm test` + `npm run check:offline` + `npm run build`, commitar sozinha. Cinco commits, cinco revisões.

**Verificação manual ao fim da fase (obrigatória):** abrir o app em janela privada do Firefox com "bloquear cookies e dados de sites" no estrito, e confirmar que `/`, `/biblioteca`, `/listas`, `/offline` e `/leitor` **abrem** — hoje a expectativa é que não abram. Se você não tiver Firefox, o segundo melhor é o Chrome com "Bloquear todos os cookies" nas configurações do site.

---

# FASE 4 — A varredura de 2min30

**Três tarefas.** Medido em navegador em 2026-09-02: recalcular as estatísticas em Cache Storage frio, com 4629 louvores, passa de **2 minutos e 30 segundos** e trava o renderer o bastante para o CDP dar timeout de 45 s duas vezes.

**A causa não é I/O.** Cache Storage é tocado **uma vez** por execução. O custo é JS síncrono: `buildPdfCacheIndex` é reconstruído **95 vezes** — uma por bloco de 50 louvores, em 3 categorias — sobre a **mesma** lista de PDFs em cache, que nunca muda durante a execução. Cada reconstrução re-normaliza toda a lista (regex + NFC + parse de URL por entrada).

## Task 1: construir o índice uma vez, não 95

**Files:**
- Modify: `src/lib/utils/pdfValidation.js:269-296`
- Modify: `src/lib/offline/stats/StatsCalculator.js` (~linhas 124-165)
- Test: `src/lib/utils/pdfCacheIndex.test.js` (acrescentar)

`findMissingPdfs(louvores, cachedPdfs)` reconstrói o índice a cada chamada. `cachedPdfsList` é o **mesmo objeto de array** nas 95 chamadas.

Fazer `findMissingPdfs` aceitar um índice já pronto além de um array cru — detectando pela presença de `.has`/`.size` — e construir o índice **uma vez** em `StatsCalculator.getCategoryStats`, logo depois de `cachedPdfsList` ser resolvido, passando-o para todas as chamadas de bloco.

Os outros três chamadores de `findMissingPdfs` (`offlineStats.js:16`, `missingPdfsDownloader.js:87`, `DownloadManager.js:172`) continuam passando array cru e continuam funcionando — é por isso que a detecção existe em vez de uma troca de assinatura.

**Não muda número nenhum na tela:** `buildPdfCacheIndex` é função pura da lista, então construí-la 1 vez ou 95 dá o mesmo índice. Documente a segunda forma aceita no typedef `StatsOptions` (`StatsCalculator.js:24-29`).

**Teste:** acrescentar a `pdfCacheIndex.test.js` um teste que passa um índice pré-construído a `findMissingPdfs` e afirma que o resultado é idêntico ao de passar o array cru — a prova de que a detecção não muda a resposta.

## Task 2: parar de usar exceção como fluxo de controle no caminho quente

**Files:**
- Modify: `src/lib/utils/pdfCacheIndex.js:25-42`
- Test: `src/lib/utils/pdfCacheIndex.test.js` (acrescentar)

`toComparablePath` chama `new URL(candidate)` em valores que são **rotineiramente caminhos relativos** (`assets/…/Cifra.pdf`, vindos de `getPdfRelPath`). Para um relativo sem base, `new URL` **sempre** lança; o código conta com o `catch` para cair no fallback de regex. Resultado: **~4629 `TypeError` lançados e capturados por execução**, no caminho mais quente que existe.

Testar antes se a string parece absoluta (`url.includes('://')`) e só então construir a `URL`. Para o lado do `has()` — onde o candidato é sempre relativo — isso pula a construção inteira.

**Não muda resultado nenhum:** hoje, quando o construtor lança e a regex também não casa, o código usa a string original — que é exatamente o que o caminho novo devolve direto.

**Teste:** um caso absoluto e um relativo, afirmando que `toComparablePath` devolve o mesmo de hoje para os dois. Se der para asserir que nenhuma exceção é lançada no caminho relativo, melhor ainda.

## Task 3: medir, e registrar o número

**Sem esta tarefa as duas anteriores são fé.** Com o proxy de produção montado e `npm run build && npm run preview`, num perfil limpo:

1. Abrir `/offline`, deixar o acervo carregar.
2. No console, cronometrar o recálculo: `const t = performance.now()` antes de clicar em "Clique aqui para atualizar", e ler `performance.now() - t` quando a capa "Dados em cache" sumir.
3. Anotar também `cachedPdfsList.length` — o `console.log` guardado por `if (force)` em `+page.svelte:604` já imprime isso.

Fazer a medição **antes** das Tasks 1 e 2 (na `main`) e **depois**. Registrar os dois números num comentário no topo de `StatsCalculator.getCategoryStats` — quem vier depois precisa saber quanto custava e quanto passou a custar, senão a otimização vira folclore.

**Se a melhora for menor que o ruído da medição, diga isso e não invente ganho.** Uma tarefa que termina em "não melhorou o suficiente para justificar" é um resultado legítimo; nesse caso, reverta as Tasks 1 e 2 ou mantenha só a que se pagou, e registre por quê.

---

# FASE 5 — Honestidade do `statsStale`

**Uma tarefa.** Achado registrado na execução de 2026-09-01, deixado de fora de propósito por ser mudança de contrato de função compartilhada tarde demais naquela branch.

**O problema:** `loadCategoryStats` (`src/routes/offline/+page.svelte:713`) termina com

```js
    await loadCategoryStatsForCategories(CATEGORY_OPTIONS, force);
    lastStatsLoadTime = now;
    statsStale = false;
```

**incondicionalmente** — inclusive quando a chamada interna retornou na hora pela guarda `isLoadingStats` (`:572`) sem ter feito trabalho nenhum. Ou seja: a função declara "os números estão frescos" sem ter recalculado nada. Além disso, `lastStatsLoadTime` é gravado só no fim, então durante uma varredura ele guarda o valor anterior; e com `force = true` os caches são limpos **antes** da checagem de reentrância, o que significa que uma chamada que vai ser descartada já raspou o cache no caminho.

Hoje isso está contido por uma guarda `!isLoadingStats` no sítio de chamada do timer (`:~803`), acrescentada em 2026-09-01. **Esta fase remove a necessidade dessa contenção**, arrumando a causa.

**Files:**
- Modify: `src/routes/offline/+page.svelte` — `loadCategoryStats` (~713) e `loadCategoryStatsForCategories` (~568)

**A forma:** `loadCategoryStatsForCategories` passa a dizer se realmente fez o trabalho (devolver um booleano, ou lançar/retornar um sentinela — escolha a menor mudança que os chamadores suportem), e `loadCategoryStats` só grava `lastStatsLoadTime` e limpa `statsStale` quando fez. Mover a limpeza de cache do `force` para **depois** da checagem de reentrância.

**Cuidado obrigatório:** existem outros chamadores de `loadCategoryStats`, incluindo o botão de atualizar manual (`on:refresh`) e os sítios de conclusão de download e de importação. Uma chamada que não fez trabalho **não pode** deixar a capa presa em `true` para sempre — quem estava correndo em paralelo é que vai limpá-la. Percorra, e escreva no relatório, as mesmas quatro ordenações que a branch anterior usou: download simples de categoria; import cuja varredura explícita ainda corre quando o timer dispara; import cuja varredura já terminou; download de PDFs faltantes que terminou com erros. Em todas, ao assentar, `statsStale` tem de ser `false` com números reais.

**Depois que esta fase estiver no ar,** a guarda `!isLoadingStats` do sítio do timer vira redundante. **Não a remova nesta fase** — deixe as duas por uma versão, e registre a remoção como item para depois. Redundância barata vale mais que uma janela em que nenhuma das duas protege.

---

# FASE 6 — A migração NFC não pode apagar a chave boa

**Duas tarefas.** Item de §3, e o único do plano cujo modo de falha é **perda de dado do usuário**.

**O que foi provado, com strings reais:** `normalizeForStorage("assets/a%252525b.pdf")` dá `"assets/a%b.pdf"`, mas aplicada de novo dá `"assets/a\x0Bpdf"` — a função não é idempotente para `%` aninhado em três ou mais camadas. A migração NFC, recebendo uma chave dessas, **grava a chave nova errada e apaga a original correta**.

**Não pode disparar hoje:** os 4629 caminhos do acervo (conferidos em `louvores-manifest.json` e `offline-manifest.json`) não têm um único `%`. Mas quatro sítios de produção já aplicam `normalizeForStorage`/`createRequestUrl` duas vezes no mesmo valor — hoje um no-op inofensivo, e é o gatilho pronto esperando um nome de arquivo com `%`.

**A opção escolhida, e por quê.** Três famílias foram avaliadas:

- **Consertar `normalizeForStorage` na raiz** é o conserto *correto* — e é exatamente a função declarada proibida. Mudar ali exige provar, sobre os 4629 caminhos reais e sobre casos adversariais, que nenhuma chave já gravada muda de forma; senão o próprio conserto apaga PDFs por descompasso. **É plano próprio, não cabe aqui.**
- **Detectar "já normalizado"** foi descartada: não há como distinguir, só olhando a string, `%` literal de `%` de escape. Resolveria o sintoma, não a causa.
- **Tornar a migração não-destrutiva** é o que esta fase faz. Local, testável sem navegador, **sem tocar em `PdfPathManager.js`**.

**A guarda óbvia não funciona, e isso foi testado:** "só apague se `canonicalizar(chaveNova)` for ponto fixo" dá `true` mesmo para a chave corrompida — a corrupção é estável sob `canonicalizar`. A guarda que funciona é mais estreita e mais fiel ao nome da migração: **uma migração NFC só deveria mudar a forma Unicode, nada mais.** Antes de apagar a chave antiga, decodificar as duas pathnames com `decodeURIComponent` e comparar depois de `.normalize('NFC')` nas duas. Se sobrar qualquer diferença além da forma Unicode — sinal de que o tratamento de `%` mexeu em conteúdo — **não apagar**: manter as duas chaves e contar à parte. O próprio código já documenta que duas chaves apontando para o mesmo PDF é inofensivo.

## Task 1: o teste que documenta o defeito

**Files:**
- Create: `src/lib/offline/utils/PdfPathManager.percentEncoding.test.js`

Arquivo **separado**, rotulado como entrada adversarial/sintética. **Não toque** em `PdfPathManager.nfc.test.js:53-58` nem em `normalizacaoCaminho.contrato.test.js:40-47` — eles afirmam idempotência sobre a fixture real do acervo, o que é verdade e continua sendo; misturar casos sintéticos ali estraga a leitura.

O teste principal **afirma o defeito atual**, não o esconde: gera `%` aninhado com 3 a 5 camadas de `encodeURIComponent` e afirma `assert.notEqual(F(x), F(F(x)))`. Ponha um comentário dizendo que, no dia em que a raiz for consertada, este teste vai falhar — e que essa falha é o **sinal correto** de que a propriedade mudou, não uma regressão.

## Task 2: a migração para de apagar quando a mudança não é só Unicode

**Files:**
- Modify: `src/lib/offline/storage/pdfCacheNfcMigration.js`
- Test: `src/lib/offline/storage/pdfCacheNfcMigration.test.js` (acrescentar)

Implementar a guarda descrita acima no ponto de deleção. Manter a mecânica de "grava a nova antes de apagar a velha" que já existe e já é testada.

**O teste que fecha o buraco real:** hoje `pdfCacheNfcMigration.test.js` usa um `canonicalizar` de brinquedo (linhas 41-45) que decodifica uma vez e recodifica — sempre seguro, e por isso nunca expõe o problema. O teste novo tem de usar o `canonicalizar` **real** de `OfflineManager.js` contra uma chave construída com `%` aninhado, e afirmar que a migração **mantém as duas chaves** em vez de apagar a original.

---

# FASE 7 — `resultadosProntos` com uma semântica só

**Uma tarefa, mais verificação em navegador que é a parte cara.** Item de §3. **A camada de URL deste projeto já quebrou leitura de PDF e compartilhamento de playlist** — trate com o cuidado correspondente.

**A alegação registrada se confirma integralmente.** Home (`src/routes/+page.svelte:67`): `let resultadosProntos = false`, setado para `true` uma única vez dentro de `finalizeFilteredResults()` e **nunca** revertido — uma trava. Biblioteca (`src/routes/biblioteca/+page.svelte:335`): `$: resultadosProntos = ...` — derivação viva, que vai e volta a cada mexida em filtro.

**A consequência:** desmarcar todos os Arranjos — ação real e alcançável pela interface — zera `$classificationFilters.length`, vira a flag da biblioteca para `false`, desliga o bloco que corrige `?pagina=`, e deixa `?pagina=999` preso na URL até alguém remarcar um Arranjo.

**Recomendação: unificar**, dando à biblioteca a mesma trava da home — não só documentar a divergência, que deixaria o bug de pé com uma explicação melhor ao lado.

**O que pode quebrar, e é o risco real:** se a trava for setada **cedo demais** — antes de `classificationFilters.aplicarPadrao(...)` rodar pela primeira vez — a biblioteca volta a apagar `?pagina=3` de um deep link em aba fria, reintroduzindo exatamente o bug que `resultadosProntos` existe para evitar. É a mesma corrida que os comentários das linhas 78-97 da home documentam ter existido e sido corrigida.

**Verificação em navegador, obrigatória, com o proxy de produção e contra `build && preview`:**

1. `/biblioteca?pagina=3` em **aba fria** (sem cache, sem stores populadas), num link sem `?arranjo=` — a página 3 tem de sobreviver ao carregamento e ao `aplicarPadrao`.
2. `/biblioteca?arranjo=&pagina=999` montado à mão — tem de corrigir para uma página válida assim que os dados carregam, **sem** re-zerar para `pagina=1` por engano via o bloco de "critério mudou" (linhas 360-369), que é mecanismo separado.
3. Repetir 1 e 2 na home — unificar o estilo da trava não pode mudar nada lá, que já é trava.
4. A sequência completa: com `pagina=5`, desmarcar todos os Arranjos, conferir a URL, remarcar um, conferir a correção — nas duas páginas, lado a lado.
5. **Abrir um PDF e compartilhar uma playlist** a partir de `/biblioteca`. `resultadosProntos` não aparece em nenhum caminho de `playlistShare.js` nem de abertura de PDF, então não deveria haver relação — mas o histórico desta base mostra que o grafo `$:` reage em conjunto, e esta verificação é barata.

---

# FASE 8 (opcional) — A faxina mecânica do resto

**Sem pressa, arquivo por arquivo, sem prazo.** Depois que o wrapper provou valor nas Fases 2 e 3, sobram os pontos crus de baixo risco individual, mas grande volume:

- `src/lib/stores/offline.js` — os ~20 acessos crus fora de `clearAllCache`. O arquivo já tem `safeStorage()`/`safeSetItem()` privados usados em 6 dos 26 pontos; esta faxina troca os dois wrappers privados pelo módulo compartilhado e cobre o resto.
- `src/lib/pdf-reader/readerPreferences.js` — 7 acessos, zero guardados. Roda no mount de `/leitor`.
- `src/lib/offline/storage/CacheMigration.js` — 5 acessos.
- Os 15 acessos restantes de `swRegistration.js`.
- Enumeração (`localStorage.length`/`.key(i)`) em `statsCache.js` vira `safeKeys().filter(...)`.
- De passagem, se quiser: a chave `IS_LEITOR_OFFLINE` está duplicada como literal em quatro lugares sem constante exportada.

Cada arquivo é um commit. Nenhum bloqueia nada.

---

## Auto-revisão

**Cobertura:** os três itens que sobraram em §3 têm fase — `localStorage` → Fases 1, 2, 3 e 8; `normalizeForStorage` → Fase 6; `resultadosProntos` → Fase 7. Os dois achados novos de 2026-09-01 também — varredura lenta → Fase 4; contrato do `loadCategoryStats` → Fase 5.

**Marcadores de posição:** a Fase 1 traz o código do fake de teste inteiro, porque é a fundação e a forma dele decide a testabilidade de todo o resto. As Fases 3 e 8 descrevem trocas mecânicas por `file:line` em vez de repetir 111 blocos de código — a lista completa está na investigação citada, que é dado, não design pendente. As Fases 4, 5, 6 e 7 nomeiam a mudança, o sítio e o trade; nenhuma diz "otimize" ou "melhore".

**Dependências entre fases:** só uma — Fases 2, 3 e 8 importam o módulo da Fase 1. As Fases 4, 5, 6 e 7 são independentes de tudo, inclusive entre si. Fase 5 encosta no mesmo arquivo da Fase 4 (`+page.svelte` da rota `/offline`), em funções vizinhas mas não nas mesmas linhas; se forem executadas fora de ordem, não conflitam.

**Onde este plano pode estar errado:** a Fase 4 assume que as 95 reconstruções são o custo dominante. Isso é certo pela leitura do código, mas a magnitude do ganho depende de quantos PDFs estão de fato em Cache Storage — número que só a medição da Task 3 responde. É por isso que a medição é tarefa, e não observação.
