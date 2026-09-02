# Pendências conhecidas — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir as quatro pendências de `docs/superpowers/verificacao-manual-2026-09-01.md` §3 que foram triadas como "vale corrigir agora": o canal de diagnóstico mudo, o cancelamento de download que não corta o laço, o painel `/offline` que mostra "0 Disponíveis" depois de um download real, e a `/biblioteca` que renderiza página em branco com catálogo vazio.

**Architecture:** Quatro correções independentes, sem dependência entre si, executadas em sequência numa única branch. Três são cirúrgicas (uma linha, um bloco de template, um par de chamadas); a quarta é uma varredura mecânica de 240 sítios de chamada cuja prova de correção é o portão de tipos, não a leitura do diff. A ordem coloca as cirúrgicas primeiro para que cada diff pequeno seja revisado sobre base limpa, e a varredura por último.

**Tech Stack:** SvelteKit 2 / Svelte 4, Vite 5, `node --test`, `svelte-check` via `scripts/checkOfflineGate.mjs`.

**Spec:** `docs/superpowers/verificacao-manual-2026-09-01.md` (§3 — Pendências conhecidas). Cada tarefa cita a linha da tabela que a origina.

**Base:** `main` em `373673c`. Criar branch `fix/pendencias-conhecidas`.

## Global Constraints

- **Runner de teste:** `node --test` apenas. Sem vitest, sem jest, sem novas dependências. A suíte roda por `npm test`, que é `node --test $(find src -name '*.test.js')` — o glob do CLI do `node --test` **não** funciona no Node 20, que é o que `.node-version` fixa. Todo arquivo de teste novo precisa terminar em `.test.js` dentro de `src/` para ser descoberto.
- **`src/lib/server/r2KeyMatch.js` e `worker/` não podem ser tocados.** São um deploy separado; ver `plpcg-worker-sombra`.
- **`src/lib/offline/**` termina em zero diagnósticos:** `npm run check:offline` tem de sair 0. Este portão é a prova de correção da Task 4 — não é opcional.
- **Fora de escopo, não encostar:** `PdfPathManager.js`, `pdfCacheNfcMigration.js`, `pdfCacheIndex.js`, qualquer lógica de normalização de caminho, chave de cache ou URL. Nenhuma destas quatro correções tem motivo para chegar perto disso.
- **Idioma:** comentários de código e texto de interface em português, seguindo o que já está no arquivo editado (a interface de `/offline` usa "A atualizar…" — mantenha a voz local do arquivo em vez de padronizar).
- **Nada é publicado.** Sem `git push`, sem `npm run deploy`. A branch fica local até o Jairo decidir.
- **Verificação com dado real** exige o proxy de produção descrito em §4 do documento de verificação, e tem de ser feita contra `npm run build && npm run preview` — nunca contra o dev server. Não commitar o proxy.
- **Ao fim de cada tarefa:** `npm test` verde (315 testes na base, mais os novos) e `npm run check:offline` em zero.

---

## Estrutura de arquivos

| Arquivo | Tarefa | Responsabilidade |
|---|---|---|
| `src/lib/offline/download/partProgress.js` | 1 | Passa a **exportar** `isAborted` — hoje é privado do módulo |
| `src/lib/offline/download/partProgress.test.js` | 1 | Ganha o teste que fixa a armadilha controlador × sinal |
| `src/lib/offline/download/DownloadManager.js` | 1, 4 | Checagem de cancelamento no laço de pacotes; 22 chamadas de logger |
| `src/routes/biblioteca/+page.svelte` | 2 | Ganha o estado vazio de catálogo |
| `src/lib/utils/estadosVazios.js` | 2 | **Novo.** Decisão pura de qual estado vazio mostrar |
| `src/lib/utils/estadosVazios.test.js` | 2 | **Novo.** Tabela de decisão |
| `src/routes/offline/+page.svelte` | 3 | Recalcula estatística ao fim de download e de importação |
| `src/lib/offline/utils/OfflineLogger.js` | 4 | Aperta a assinatura do logger vinculado |
| 19 arquivos em `src/lib/offline/**` | 4 | Remoção do argumento redundante em 239 chamadas |
| `src/lib/offline/utils/OfflineLogger.test.js` | 4 | **Novo.** Comportamento do logger + teste de conformidade dos sítios de chamada |

---

## Task 1 — cancelar um download volta a cortar o laço

**Origem:** §3, linha `DownloadManager.js:457` — "Testa `.aborted` num `AbortController` em vez de `.signal.aborted`, então a checagem de cancelamento no laço nunca dispara."

**Contexto:** `AbortController` não tem propriedade `.aborted`; quem tem é `controller.signal`. A expressão `this.abortController?.aborted` é sempre `undefined`, então o `if` nunca entra. O cancelamento ainda funciona — o `signal` repassado ao `fetch` na linha 479 aborta a requisição em curso — mas o laço de pacotes não para entre um pacote e o próximo. O que se perde é o corte rápido.

`partProgress.js:222` já tem exatamente o predicado certo (`isAborted(signal)`), privado do módulo. A correção reusa esse predicado em vez de escrever `?.signal.aborted` inline: um único lugar onde essa distinção mora, e um lugar onde ela é testada.

**Files:**
- Modify: `src/lib/offline/download/partProgress.js:220-224`
- Modify: `src/lib/offline/download/DownloadManager.js:452-459`
- Test: `src/lib/offline/download/partProgress.test.js` (acrescentar)

**Interfaces:**
- Produces: `export function isAborted(signal: { aborted?: boolean } | null | undefined): boolean`

**Risco verificado:** `throw new Error('DOWNLOAD_CANCELLED')` na linha 458 **já tem tratamento** a montante — `DownloadManager.js:289`, `:294`, `:600` e `:652` reconhecem essa mensagem, e `src/lib/stores/offline.js:1662` também. Fazer a checagem disparar não cria caminho de erro novo; reativa um que já está escrito.

- [ ] **Passo 1: Escrever o teste que falha**

Acrescentar `isAborted` à lista de imports do topo de `src/lib/offline/download/partProgress.test.js` e o bloco abaixo ao fim do arquivo:

```js
describe('isAborted', () => {
  it('lê o sinal, não o controlador', () => {
    const controller = new AbortController();

    assert.equal(isAborted(controller.signal), false);
    controller.abort();
    assert.equal(isAborted(controller.signal), true);
  });

  it('devolve false para um AbortController — a armadilha que este helper existe para evitar', () => {
    // `AbortController` não tem `.aborted`. Passar o controlador no lugar do
    // sinal é silencioso: a expressão vira undefined e a checagem nunca
    // dispara. Foi o que aconteceu em DownloadManager._downloadPackages.
    const controller = new AbortController();
    controller.abort();

    assert.equal(isAborted(/** @type {any} */ (controller)), false);
  });

  it('aceita null e undefined sem lançar', () => {
    assert.equal(isAborted(null), false);
    assert.equal(isAborted(undefined), false);
  });
});
```

- [ ] **Passo 2: Rodar para ver falhar**

```bash
node --test src/lib/offline/download/partProgress.test.js
```

Esperado: FALHA com `isAborted is not a function` (ou `The requested module ... does not provide an export named 'isAborted'`).

- [ ] **Passo 3: Exportar o predicado**

Em `src/lib/offline/download/partProgress.js`, trocar a declaração:

```js
/**
 * Um `AbortController` **não** tem `.aborted` — quem tem é o `signal` dele.
 * Este predicado existe para que essa distinção more num lugar só.
 *
 * @param {{ aborted?: boolean } | null | undefined} signal
 * @returns {boolean}
 */
export function isAborted(signal) {
  return Boolean(signal && signal.aborted);
}
```

- [ ] **Passo 4: Rodar para ver passar**

```bash
node --test src/lib/offline/download/partProgress.test.js
```

Esperado: PASSA.

- [ ] **Passo 5: Corrigir a checagem no laço**

Em `src/lib/offline/download/DownloadManager.js`, acrescentar ao bloco de imports do topo:

```js
import { isAborted } from './partProgress.js';
```

E substituir o bloco das linhas 452-459 (o comentário `// ACHADO (não corrigido: ...)` inteiro, mais o `if`) por:

```js
        // O cancelamento é lido do SINAL, não do controlador: `AbortController`
        // não tem `.aborted`. Até 2026-09-01 esta linha era
        // `this.abortController?.aborted` — sempre undefined, nunca disparava,
        // e o corte só acontecia lá no fetch. É a causa do "cancelar não para
        // o download na hora".
        if (isAborted(this.abortController?.signal)) {
          throw new Error('DOWNLOAD_CANCELLED');
        }
```

- [ ] **Passo 6: Verificar a suíte e o portão**

```bash
npm test
npm run check:offline
```

Esperado: suíte verde (315 + 3 novos), `check:offline` reportando zero diagnósticos.

- [ ] **Passo 7: Commit**

```bash
git add src/lib/offline/download/partProgress.js \
        src/lib/offline/download/partProgress.test.js \
        src/lib/offline/download/DownloadManager.js
git commit -m "fix(download): cancelamento lê o sinal, não o controlador"
```

**Verificação manual (opcional, exige o proxy de §4):** iniciar um download de categoria grande e clicar em cancelar no meio. Esperado: para no fim do pacote em curso, não no fim da fila. Antes desta correção, o laço seguia adiante para o próximo pacote.

---

## Task 2 — `/biblioteca` deixa de renderizar página em branco

**Origem:** §3, linha `/biblioteca` — "Com catálogo carregado e vazio (falha de manifesto), renderiza **nada** — esqueleto que resolve em página em branco."

**Contexto:** o encadeamento em `src/routes/biblioteca/+page.svelte:628-675` é:

```
{#if !$louvoresLoaded}            → esqueleto
{:else if paginatedLouvores.length > 0} → a lista
{:else if $louvores.length > 0}   → "Nenhum louvor encontrado com os filtros selecionados."
{/if}                             → e nada mais
```

Quando o manifesto falha, `$louvoresLoaded` fica `true` e `$louvores.length` fica `0`: nenhum ramo casa, e a área de resultados fica literalmente vazia. O esqueleto some e não é substituído por nada. A home tem quatro estados vazios com botão de recuperação (`src/routes/+page.svelte:622-655`); a biblioteca não tem o quinto caso.

A decisão de qual estado mostrar sai para um módulo puro para poder ser testada — `node --test` não monta componente Svelte, então a tabela de decisão é a única parte desta correção que dá para cobrir automaticamente.

**Files:**
- Create: `src/lib/utils/estadosVazios.js`
- Create: `src/lib/utils/estadosVazios.test.js`
- Modify: `src/routes/biblioteca/+page.svelte` (imports, um `$:`, o bloco 628-675, e o CSS ao fim)

**Interfaces:**
- Produces: `estadoVazioBiblioteca({ carregado: boolean, totalCatalogo: number, totalVisivel: number }): 'carregando' | 'com-resultados' | 'filtros-sem-resultado' | 'catalogo-vazio'`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `src/lib/utils/estadosVazios.test.js`:

```js
/**
 * Tabela de decisão dos estados vazios. Run:
 * node --test src/lib/utils/estadosVazios.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estadoVazioBiblioteca } from './estadosVazios.js';

describe('estadoVazioBiblioteca', () => {
  it('mostra o esqueleto enquanto o catálogo não carregou', () => {
    assert.equal(
      estadoVazioBiblioteca({ carregado: false, totalCatalogo: 0, totalVisivel: 0 }),
      'carregando'
    );
  });

  it('mostra a lista quando há resultados na página', () => {
    assert.equal(
      estadoVazioBiblioteca({ carregado: true, totalCatalogo: 4630, totalVisivel: 50 }),
      'com-resultados'
    );
  });

  it('atribui a página vazia aos filtros quando o catálogo tem conteúdo', () => {
    assert.equal(
      estadoVazioBiblioteca({ carregado: true, totalCatalogo: 4630, totalVisivel: 0 }),
      'filtros-sem-resultado'
    );
  });

  it('distingue catálogo vazio de filtro sem resultado — o caso que renderizava nada', () => {
    assert.equal(
      estadoVazioBiblioteca({ carregado: true, totalCatalogo: 0, totalVisivel: 0 }),
      'catalogo-vazio'
    );
  });

  it('não confunde catálogo vazio com carregamento em curso', () => {
    // Antes de 2026-09-01 estes dois casos caíam no mesmo buraco do template:
    // o esqueleto sumia e nada tomava o lugar.
    assert.notEqual(
      estadoVazioBiblioteca({ carregado: false, totalCatalogo: 0, totalVisivel: 0 }),
      estadoVazioBiblioteca({ carregado: true, totalCatalogo: 0, totalVisivel: 0 })
    );
  });
});
```

- [ ] **Passo 2: Rodar para ver falhar**

```bash
node --test src/lib/utils/estadosVazios.test.js
```

Esperado: FALHA — o módulo `./estadosVazios.js` não existe.

- [ ] **Passo 3: Escrever o módulo**

Criar `src/lib/utils/estadosVazios.js`:

```js
/**
 * Decisão de qual estado a área de resultados deve mostrar.
 *
 * Existe como módulo próprio por um motivo específico: `node --test` não
 * monta componente Svelte, então a única parte desta lógica que dá para
 * cobrir automaticamente é a tabela de decisão. O template consome o
 * resultado e não decide nada por conta própria.
 */

/**
 * @typedef {'carregando' | 'com-resultados' | 'filtros-sem-resultado' | 'catalogo-vazio'} EstadoVazio
 */

/**
 * @param {Object} entrada
 * @param {boolean} entrada.carregado - O catálogo terminou de carregar (com ou sem sucesso)
 * @param {number} entrada.totalCatalogo - Quantos louvores o catálogo tem ao todo
 * @param {number} entrada.totalVisivel - Quantos itens a página atual mostraria
 * @returns {EstadoVazio}
 */
export function estadoVazioBiblioteca({ carregado, totalCatalogo, totalVisivel }) {
  if (!carregado) return 'carregando';
  if (totalVisivel > 0) return 'com-resultados';
  if (totalCatalogo > 0) return 'filtros-sem-resultado';
  return 'catalogo-vazio';
}
```

- [ ] **Passo 4: Rodar para ver passar**

```bash
node --test src/lib/utils/estadosVazios.test.js
```

Esperado: PASSA (5 testes).

- [ ] **Passo 5: Ligar no template da biblioteca**

Em `src/routes/biblioteca/+page.svelte`, acrescentar ao bloco de imports (logo abaixo de `import LouvorListSkeleton ...`):

```js
  import { estadoVazioBiblioteca } from '$lib/utils/estadosVazios.js';
```

Acrescentar a derivação junto das outras (perto da linha 334, ao lado de `$: resultadosProntos = ...`):

```js
  $: estadoResultados = estadoVazioBiblioteca({
    carregado: $louvoresLoaded,
    totalCatalogo: $louvores.length,
    totalVisivel: paginatedLouvores.length
  });
```

Trocar as condições do encadeamento (linhas 628, 633 e 673) para consumirem `estadoResultados`, e acrescentar o ramo que faltava. As linhas 628 e 633 viram `{#if estadoResultados === 'carregando'}` e `{:else if estadoResultados === 'com-resultados'}`; **todo o corpo dos dois ramos fica exatamente como está**. As linhas 673-675 viram:

```svelte
    {:else if estadoResultados === 'filtros-sem-resultado'}
      <p class="text-center mt-8 no-results-message">Nenhum louvor encontrado com os filtros selecionados.</p>
    {:else}
      <div class="empty-state-message">
        <p>Não foi possível carregar a lista de louvores.</p>
        <button type="button" class="empty-state-action" on:click={() => loadLouvores()}>
          Tentar novamente
        </button>
      </div>
    {/if}
```

`loadLouvores` já está importado no arquivo (linha 6) — não acrescentar import novo.

- [ ] **Passo 6: Copiar o CSS dos dois seletores**

Em `src/routes/biblioteca/+page.svelte`, logo abaixo do bloco `.no-results-message` (linha 739-742), acrescentar — os mesmos valores de `src/routes/+page.svelte:727-753`, para que os dois estados vazios do app tenham o mesmo aspecto:

```css
  .empty-state-message {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    text-align: center;
    margin-top: 2rem;
    color: var(--text-light);
    opacity: 0.9;
  }

  .empty-state-action {
    padding: 0.5rem 1rem;
    background-color: var(--card-color);
    color: var(--text-dark);
    border: 2px solid var(--gold-color);
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .empty-state-action:hover {
    border-color: var(--gold-light);
    background-color: rgba(244, 208, 63, 0.1);
  }
```

- [ ] **Passo 7: Verificar**

```bash
npm test
npm run build
```

Esperado: suíte verde, build limpo. `npm run check:offline` não cobre `src/routes/**`, mas rode mesmo assim para confirmar que segue em zero.

- [ ] **Passo 8: Commit**

```bash
git add src/lib/utils/estadosVazios.js src/lib/utils/estadosVazios.test.js \
        src/routes/biblioteca/+page.svelte
git commit -m "fix(biblioteca): estado vazio quando o catálogo carrega vazio"
```

**Verificação manual (obrigatória — o template não tem cobertura automatizada):** com o proxy de §4 montado, abrir `/biblioteca`, e no DevTools bloquear `louvores-manifest.json` (Network → Block request URL). Recarregar. Esperado: a mensagem "Não foi possível carregar a lista de louvores." com o botão "Tentar novamente", **não** uma área em branco. Clicar no botão com a requisição desbloqueada tem de trazer a lista.

**Extra explicitamente separado, dá para cortar sem afetar o resto:** a home tem o mesmo buraco, mas de outra forma — com catálogo vazio, `homeEmptyState` (`src/routes/+page.svelte:392-401`) cai em `'inicial'` e mostra "Digite algo na busca para encontrar um louvor", que é uma mensagem errada para uma falha de manifesto. Se for para incluir, é um ramo a mais **no topo** do encadeamento ternário (`$louvores.length === 0 ? 'catalogo-vazio' : ...`) e mais um `{:else if homeEmptyState === 'catalogo-vazio'}` no template, com o mesmo texto e o mesmo botão. Fica como passo destacado porque a linha da tabela nomeia só a `/biblioteca`, e a home hoje ao menos renderiza alguma coisa.

---

## Task 3 — `/offline` recalcula a estatística depois de um download real

**Origem:** §3, linha `/offline` — "**Verificado com download real pela interface:** 1546 PDFs em cache, painel mostrando zero; após o clique, 1544/4630 correto. É defasagem por desenho, não cálculo errado — a conclusão do download marca a estatística obsoleta e nunca recalcula."

**Contexto — a causa exata, já rastreada:**

1. Ao abrir a página, `openCachedStats()` (`src/routes/offline/+page.svelte:699-710`) preenche `categoryStats` com o que estiver em cache e marca `statsStale = true`. Num aparelho limpo o cache está vazio, então `categoryStats = {}`.
2. `totalStats` é derivado de `Object.values(categoryStats)` (linha 859). Com o objeto vazio, `available` é `0`.
3. Ao fim de um download (linha 1147) e ao fim de uma importação de pacote (linha 1022), o código faz `statsStale = true` — **e mais nada**. `categoryStats` continua `{}`.
4. Resultado: depois de baixar 1546 PDFs, o painel mostra `0 Disponíveis` sob o aviso "Dados em cache — podem estar desatualizados". Quem acabou de esperar o download conclui que ele falhou.

A correção é fazer as duas conclusões — download e importação — dispararem o mesmo recálculo que o botão de atualizar já dispara (`loadCategoryStats(true)`, ligado em `on:refresh` na linha 1321). Os outros seis sítios que marcam `statsStale = true` (linhas 361, 488, 709, 786, 828) são reações de fundo, não conclusões de operação que a pessoa acabou de acompanhar na tela — esses **ficam como estão**. Recalcular em todos seria trocar um sintoma por varreduras repetidas de Cache Storage.

Um detalhe de interface anda junto: o indicador "Carregando estatísticas..." (linha 1355) está condicionado a `!statsStale`, e `loadCategoryStats` só zera `statsStale` **no fim**. Sem ajustar a condição, o recálculo automático roda com a capa de "desatualizado" por cima e sem sinal de progresso.

**Files:**
- Modify: `src/routes/offline/+page.svelte` — linhas ~1020-1023, ~1145-1149 e ~1355

**Sem cobertura automatizada.** É lógica de componente Svelte; `node --test` não a alcança. A verificação é a manual descrita ao fim, e ela é obrigatória para esta tarefa.

- [ ] **Passo 1: Recalcular ao fim do download de PDFs**

Em `src/routes/offline/+page.svelte`, no bloco que segue `await offline.loadCachedPdfsList(true, false);` (linha ~1145), trocar:

```js
      if (statsRequested) {
        statsStale = true;
      }
```

por:

```js
      // A pessoa acabou de acompanhar o download inteiro na tela: recalcular
      // agora, e não só marcar como obsoleto. Até 2026-09-01 isto marcava
      // `statsStale` e parava aí, então num aparelho limpo (categoryStats
      // vazio) o painel mostrava "0 Disponíveis" depois de baixar 1546 PDFs —
      // parecia que o download tinha falhado.
      if (statsRequested) {
        await loadCategoryStats(true);
      }
```

- [ ] **Passo 2: Recalcular ao fim da importação de pacote**

No bloco que segue `await offline.loadCachedPdfsList(false, true);` da importação (linha ~1021), aplicar a mesma troca:

```js
      // Mesmo motivo do fim do download: a importação acabou de mudar o cache
      // com a pessoa olhando.
      if (statsRequested) {
        await loadCategoryStats(true);
      }
```

- [ ] **Passo 3: Deixar o indicador de progresso aparecer durante o recálculo**

Na linha ~1355, trocar:

```svelte
      {#if isLoadingStats && statsRequested && !statsStale}
```

por:

```svelte
      <!-- Mostra durante o recálculo em qualquer caso: o recálculo automático
           do fim do download roda com statsStale ainda true (loadCategoryStats
           só o zera no fim), e sem isto ele correria sem nenhum sinal. -->
      {#if isLoadingStats && statsRequested}
```

- [ ] **Passo 4: Verificar**

```bash
npm test
npm run build
npm run check:offline
```

Esperado: suíte verde, build limpo, portão em zero.

- [ ] **Passo 5: Commit**

```bash
git add src/routes/offline/+page.svelte
git commit -m "fix(offline): recalcular estatística ao fim do download e da importação"
```

**Verificação manual (obrigatória):** com o proxy de §4 montado e rodando contra `npm run build && npm run preview`, num perfil de navegador **limpo** (Cache Storage e localStorage zerados): abrir `/offline`, escolher uma categoria, baixar até o fim. Esperado: ao terminar, o painel "Disponibilidade Geral" mostra o número real de disponíveis **sem** clique em atualizar, e a capa "Dados em cache" desaparece sozinha. Confirmar também que durante o recálculo aparece "Carregando estatísticas...". Repetir com a importação de pacote ZIP.

---

## Task 4 — devolver o objeto de erro ao canal de diagnóstico

**Origem:** §3, linha `OfflineLogger` — "Descarta o objeto de erro em ~245 de 247 chamadas, por um argumento redundante. **Vale priorizar:** num sistema cujo modo de falha é o silêncio, o canal de diagnóstico estar mudo é sério."

**Contexto — o que de fato acontece:** `createLogger('CacheStorageAdapter')` devolve um logger **já vinculado ao módulo**, com assinatura `(message, err)`. Mas as chamadas passam o nome do módulo de novo:

```js
logger.error('CacheStorageAdapter', 'Failed to open cache', err);
```

O que chega: `message = 'CacheStorageAdapter'`, `err = 'Failed to open cache'`, e **o objeto de erro é descartado em runtime**. O console imprime `[Offline:CacheStorageAdapter] [ERROR] CacheStorageAdapter 'Failed to open cache'` — nome do módulo duas vezes, mensagem no lugar do dado, e a stack trace em lugar nenhum.

**Levantamento já feito, para dispensar refazê-lo:**

- 247 chamadas de `logger.{error,warn,info,debug}` em `src/lib/offline/**`.
- Em 19 arquivos, **239** delas começam com o literal exato do nome vinculado em `createLogger`. Estas são as defeituosas.
- **8 não seguem esse padrão** e sete delas já estão corretas — não tocar:
  - `utils/AppPagesCache.js:35` e `:45` (dois `logger.warn` com a mensagem real como primeiro argumento)
  - `import/OfflineBundleImporter.js:193`, `:369`, `:386`, `:458`, `:484` (o arquivo inteiro já usa a assinatura certa)
  - `validation/PdfValidator.js:57` — **este é o único caso especial**, tratado no Passo 4.
- `storage/CacheRepository.js` chama `createLogger('CacheRepository')` e nunca usa o logger. Vínculo morto; deixar como está (fora de escopo).
- Nenhum arquivo importa o *default export* do `OfflineLogger` — todos os 22 importam só `createLogger`. Não há nenhuma chamada legítima de três argumentos com o módulo à frente para preservar.
- A aridade máxima é 3 argumentos depois do nome do módulo (`debug(message, data, metrics)`). O que parece 4+ numa contagem ingênua de vírgulas são vírgulas dentro de literais de template.

**Files:**
- Modify: `src/lib/offline/utils/OfflineLogger.js:145-180`
- Modify (varredura mecânica): os 20 arquivos listados no Passo 3
- Modify: `src/lib/offline/validation/PdfValidator.js:56-65`
- Test: `src/lib/offline/utils/OfflineLogger.test.js` (novo)

**Interfaces:**
- Produces: `createLogger(moduleName)` com assinaturas exatas — `error(message, err?)`, `warn(message, data?)`, `info(message, data?)`, `debug(message, data?, metrics?)`. Nada de `...rest`.

**A prova de correção não é ler o diff.** São duas: o teste de conformidade do Passo 1, que varre os fontes; e `npm run check:offline`, que depois do Passo 5 transforma qualquer sítio esquecido num erro de tipo (`Expected 1-2 arguments, but got 3`). Um diff de 239 linhas não se revisa a olho — se os dois portões estiverem verdes, está correto.

- [ ] **Passo 1: Escrever os testes que falham**

Criar `src/lib/offline/utils/OfflineLogger.test.js`:

```js
/**
 * Logger do módulo offline. Run:
 * node --test src/lib/offline/utils/OfflineLogger.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from './OfflineLogger.js';

describe('createLogger', () => {
  /** @type {any[][]} */
  let capturado;
  /** @type {typeof console.error} */
  let errorOriginal;

  beforeEach(() => {
    capturado = [];
    errorOriginal = console.error;
    console.error = (/** @type {any[]} */ ...args) => { capturado.push(args); };
  });

  afterEach(() => {
    console.error = errorOriginal;
  });

  it('entrega o objeto de erro ao console — o que o argumento redundante quebrava', () => {
    const logger = createLogger('CacheStorageAdapter');
    const erro = new Error('boom');

    logger.error('Failed to open cache', erro);

    assert.equal(capturado.length, 1);
    const [formatado, segundo] = capturado[0];
    assert.match(formatado, /\[Offline:CacheStorageAdapter\] \[ERROR\] Failed to open cache/);
    assert.equal(segundo, erro, 'o objeto de erro tem de chegar ao console.error');
  });

  it('não imprime o nome do módulo no lugar da mensagem', () => {
    const logger = createLogger('OfflineManager');

    logger.error('Migração falhou', new Error('x'));

    const [formatado] = capturado[0];
    assert.doesNotMatch(
      formatado,
      /\[ERROR\] OfflineManager/,
      'a mensagem não pode ser o nome do módulo repetido'
    );
  });

  it('não passa segundo argumento quando não há erro', () => {
    createLogger('CacheSync').error('só a mensagem');
    assert.equal(capturado[0].length, 1);
  });
});

describe('conformidade dos sítios de chamada', () => {
  /**
   * @param {string} dir
   * @returns {string[]}
   */
  function arquivosJs(dir) {
    return readdirSync(dir).flatMap((entrada) => {
      const caminho = join(dir, entrada);
      if (statSync(caminho).isDirectory()) return arquivosJs(caminho);
      return caminho.endsWith('.js') && !caminho.endsWith('.test.js') ? [caminho] : [];
    });
  }

  it('nenhuma chamada repassa o nome do módulo já vinculado', () => {
    const raiz = new URL('../', import.meta.url).pathname;
    /** @type {string[]} */
    const ofensores = [];

    for (const caminho of arquivosJs(raiz)) {
      const fonte = readFileSync(caminho, 'utf8');
      const vinculo = fonte.match(/createLogger\('([^']+)'\)/);
      if (!vinculo) continue;

      const modulo = vinculo[1];
      const padrao = new RegExp(`logger\\.(error|warn|info|debug)\\(\\s*'${modulo}'\\s*,`, 'g');
      for (const achado of fonte.matchAll(padrao)) {
        const linha = fonte.slice(0, achado.index).split('\n').length;
        ofensores.push(`${caminho}:${linha}`);
      }
    }

    assert.deepEqual(
      ofensores,
      [],
      `logger já vinculado por createLogger recebendo o nome do módulo de novo:\n${ofensores.join('\n')}`
    );
  });
});
```

- [ ] **Passo 2: Rodar para ver falhar**

```bash
node --test src/lib/offline/utils/OfflineLogger.test.js
```

Esperado: FALHA. O teste de conformidade lista os **239** sítios; os três primeiros testes já passam (a assinatura correta sempre funcionou — o defeito está em quem chama).

- [ ] **Passo 3: Varredura mecânica dos 239 sítios**

Uma passada por arquivo, removendo o literal do nome do módulo e a vírgula que o segue. O script abaixo é ferramenta descartável — **rodar e não commitar**:

```bash
cd "$(git rev-parse --show-toplevel)"
for f in $(grep -rl "createLogger(" src/lib/offline --include="*.js" | grep -v "OfflineLogger.js"); do
  m=$(grep -o "createLogger('[^']*'" "$f" | head -1 | sed "s/createLogger('//;s/'//")
  perl -pi -e "s/logger\.(error|warn|info|debug)\(\s*'\Q$m\E'\s*,\s*/logger.\$1(/g" "$f"
done
git diff --stat
```

Esperado no `git diff --stat`: 19 arquivos, 239 linhas alteradas — número medido numa execução de ensaio sobre cópia descartável em 2026-09-01, que terminou com zero ofensores. Confirmar que **nenhum** dos sete sítios já corretos listados no contexto foi tocado:

```bash
git diff -- src/lib/offline/import/OfflineBundleImporter.js | head -5
```

Esperado: saída vazia — o arquivo já estava correto e não deve aparecer no diff.

- [ ] **Passo 4: O caso especial do `PdfValidator`**

`src/lib/offline/validation/PdfValidator.js:56-65` passa `this.getName()` — não um literal, e não redundante por acaso: a classe base quer identificar a **subclasse** concreta (`IndexValidator`, `CacheValidator`, `NetworkValidator`), enquanto `createLogger` está vinculado a `'PdfValidator'`. A varredura do Passo 3 não o pega. Preservar a intenção movendo o nome para dentro da mensagem:

```js
  _logValidation(pdfPath, result) {
    // `this.getName()` é a subclasse concreta, não o módulo vinculado no
    // createLogger — por isso vai na mensagem, e não como argumento extra
    // (que seria descartado silenciosamente).
    logger.debug(
      `[${this.getName()}] Validation result for ${pdfPath}:`,
      {
        available: result.available,
        source: result.source,
        needsDownload: result.needsDownload
      }
    );
  }
```

- [ ] **Passo 5: Apertar a assinatura para o portão de tipos poder provar o resto**

Em `src/lib/offline/utils/OfflineLogger.js`, substituir todo o bloco de comentário `NOTA:` e o `@typedef` (linhas 145-162) por:

```js
/**
 * Assinatura exata, sem `...rest`: é ela que faz `npm run check:offline`
 * recusar um argumento sobrando. Até 2026-09-01 o typedef aceitava rest
 * porque 239 de 247 chamadas repassavam o nome do módulo já vinculado por
 * `createLogger` — o argumento extra empurrava a mensagem para o lugar do
 * dado e o objeto de erro caía fora, sem sintoma nenhum. Num sistema cujo
 * modo de falha é o silêncio, apertar isto aqui é o que impede a regressão:
 * qualquer chamada com um argumento a mais vira erro de tipo, não log mudo.
 *
 * @typedef {Object} OfflineLoggerInstance
 * @property {(message: string, err?: unknown) => void} error
 * @property {(message: string, data?: unknown) => void} warn
 * @property {(message: string, data?: unknown) => void} info
 * @property {(message: string, data?: unknown, metrics?: Record<string, unknown> | null) => void} debug
 */
```

E ajustar as anotações internas de `createLogger` (linhas 169-180) para casarem com o typedef:

```js
export function createLogger(moduleName) {
  return {
    /** @param {string} message @param {unknown} [err] */
    error: (message, err) => error(moduleName, message, err),
    /** @param {string} message @param {unknown} [data] */
    warn: (message, data) => warn(moduleName, message, data),
    /** @param {string} message @param {unknown} [data] */
    info: (message, data) => info(moduleName, message, data),
    /** @param {string} message @param {unknown} [data] @param {Record<string, unknown> | null} [metrics] */
    debug: (message, data, metrics) => debug(moduleName, message, data, metrics)
  };
}
```

- [ ] **Passo 6: Rodar os dois portões**

```bash
node --test src/lib/offline/utils/OfflineLogger.test.js
npm run check:offline
```

Esperado: teste de conformidade com lista vazia; `check:offline` em zero diagnósticos.

**Se `check:offline` acusar `Expected 1-2 arguments, but got 3`:** é exatamente o que ele deve fazer — um sítio que a varredura não pegou (nome do módulo escrito diferente do vínculo, aspas duplas, ou quebra de linha entre o literal e a vírgula). Corrigir à mão cada um e rodar de novo. **Não afrouxar o typedef para o portão calar.**

- [ ] **Passo 7: Suíte inteira e commit**

```bash
npm test
git status --short   # conferir que o script descartável do Passo 3 não ficou
git add src/lib/offline
git commit -m "fix(offline): logger volta a receber o objeto de erro"
```

- [ ] **Passo 8: Atualizar o documento de verificação**

Em `docs/superpowers/verificacao-manual-2026-09-01.md` §3, remover as quatro linhas resolvidas (`DownloadManager.js:457`, `OfflineLogger`, `/offline`, `/biblioteca`) e acrescentar acima da tabela:

```markdown
> Quatro destas pendências foram corrigidas em 2026-09-01 pelo plano
> `docs/superpowers/plans/2026-09-01-pendencias-conhecidas.md`: a checagem de
> cancelamento do download, o logger que descartava o objeto de erro, o painel
> `/offline` que não recalculava depois do download, e a página em branco da
> `/biblioteca`. As três que restam abaixo seguem decididas, não esquecidas.
```

```bash
git add docs/superpowers/verificacao-manual-2026-09-01.md
git commit -m "docs: marcar as quatro pendências corrigidas"
```

**Verificação manual (recomendada, exige o proxy de §4):** com o console aberto em `/offline`, provocar uma falha (DevTools → Network → Offline, e tentar baixar). Esperado: as linhas `[Offline:...] [ERROR]` trazem a mensagem real **e** o objeto `Error` expansível com stack trace. Antes desta correção traziam o nome do módulo repetido e a mensagem como string solta.

---

## As três pendências que ficam

Registrado aqui para que a ausência seja escolha e não esquecimento. Seguem na tabela de §3 depois do Passo 8 da Task 4:

- **`offline.js` — 20+ acessos crus a `localStorage`.** Mecânico e de baixo risco, mas ~20 pontos de edição e sem relação com as quatro acima. Merece o próprio plano.
- **`normalizeForStorage` não idempotente com percent-encoding aninhado.** Nenhum caminho do acervo tem `%`. Fica **fora do escopo destas quatro por decisão explícita**: mexer nisso é mexer na normalização de chave de cache, que é justamente a área que as Global Constraints deste plano proíbem tocar. Se disparar algum dia, a migração NFC reescreve a chave e apaga a original — é a perda silenciosa que o plano anterior existiu para eliminar, e por isso merece um ticket próprio com investigação própria, não um remendo de carona.
- **`resultadosProntos` com semânticas diferentes na home e na biblioteca.** Cosmético hoje. A Task 2 encosta no arquivo mas não no `resultadosProntos` — não aproveitar a carona.

---

## Auto-revisão

**Cobertura da spec:** as quatro linhas de §3 marcadas como "vale corrigir agora" têm uma tarefa cada — `DownloadManager.js:457` → Task 1, `/biblioteca` → Task 2, `/offline` → Task 3, `OfflineLogger` → Task 4. As três restantes estão nomeadas acima com o motivo de ficarem.

**Marcadores de posição:** nenhum. Todo passo de código traz o código; todo passo de comando traz o comando e o resultado esperado.

**Consistência de tipos:** `isAborted(signal)` (Task 1) recebe o mesmo `{ aborted?: boolean } | null | undefined` que já estava na anotação privada. `estadoVazioBiblioteca` (Task 2) tem os quatro valores de retorno usados em exatamente quatro ramos do template. As assinaturas de `OfflineLoggerInstance` (Task 4, Passo 5) casam uma a uma com as anotações internas de `createLogger` e com as funções de módulo `error/warn/info/debug` que elas encapsulam.

**Conflito entre tarefas:** Tarefas 1 e 4 editam `DownloadManager.js` — a 1 na linha 457, a 4 nas 22 chamadas de logger, sem sobreposição. A execução é sequencial numa branch só; não há caminho para conflito de merge.
