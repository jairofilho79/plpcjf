# Fase 8 — A faxina de armazenamento, e a investigação dos 47 s

> **Para trabalhadores agênticos:** SUB-SKILL OBRIGATÓRIA: use
> superpowers:subagent-driven-development para implementar tarefa a tarefa.
> Os passos usam caixas (`- [ ]`) para acompanhamento.

**Goal:** eliminar os 16 acessos a armazenamento que ainda podem lançar e derrubar
um componente inteiro — sendo que 8 deles deixam a `/leitor` em branco — e fechar
os quatro resíduos de correção que a execução das Fases 1–7 acumulou.

**Architecture:** os acessos crus passam a usar `src/lib/utils/safeStorage.js`,
o módulo criado na Fase 1 e já em produção nas Fases 2 e 3. Nada de mecanismo
novo: esta fase é aplicação de um wrapper que já provou valor, arquivo por
arquivo, um commit por arquivo. A única peça nova é uma constante compartilhada
para a chave `IS_LEITOR_OFFLINE`, hoje literal em quatro sítios.

**Tech Stack:** SvelteKit 2 / Svelte 4, Vite 5. Testes com `node --test` **apenas**.

**Spec / origem:** `docs/superpowers/plans/2026-09-02-divida-tecnica-em-fases.md`
(§ "FASE 8"), corrigida pelo levantamento de 2026-09-02 registado abaixo, mais os
itens 1, 2, 3, 4 e 6 da lista de acumulados em
`.superpowers/sdd/2026-09-02-divida-tecnica-em-fases/progress.md`.

---

## Global Constraints

- **Runner:** `node --test` apenas. `npm test` é
  `node --test $(find src -name '*.test.js')`. **Nenhuma dependência nova.**
  O glob do CLI do `node --test` não funciona no Node 20, que é o que
  `.node-version` fixa — por isso o `find`.
- **Portão:** `npm run check:offline` tem de sair **0**. Tolerância zero em
  `src/lib/offline/**`. **Nunca afrouxar `TARGET_PREFIXES`** em
  `scripts/checkOfflineGate.mjs` para fazer um portão passar.
- **Território proibido:** `src/lib/server/r2KeyMatch.js`, `worker/` e
  `src/lib/offline/utils/PdfPathManager.js`. Nenhuma tarefa aqui os toca.
- **Nada é publicado.** Sem `git push`, sem `npm run deploy`.
- Para resolver `$lib/` e `$app/environment` sob `node --test`, use
  `module.register()` de `node:module` — padrão já estabelecido em
  `src/lib/utils/cacheSync.test.js` e `src/lib/offline/utils/OfflineLogger.test.js`.
  Custo: zero pacotes.
- Fakes de armazenamento vêm de `src/lib/testing/fakeStorage.js`:
  `criarFakeStorage`, `criarStorageQueLanca`, `criarStorageSomenteLeitura`.
- API disponível em `src/lib/utils/safeStorage.js`: `getStorage()`, `safeGet(key)`,
  `safeSet(key, value) → boolean`, `safeRemove(key) → boolean`,
  `safeKeys() → string[]`, `safeRemoveMany(keys) → { removed, failed }`.

---

## O levantamento que corrige a Fase 8 original

Contagem feita em 2026-09-02 sobre `main` `42b7d67`, classificando cada acesso
por estar **dentro** ou **fora** de um bloco `try`. Um acesso dentro de `try` não
derruba nada; um acesso fora propaga o `SecurityError` para quem chamou.

| Arquivo | Acessos | **Fora de `try`** | Consequência de lançar |
|---|---|---|---|
| `pdf-reader/readerPreferences.js` | 6 | **6** | **`/leitor` em branco** |
| `routes/leitor/+page.svelte` | 2 | **2** | **`/leitor` em branco** |
| `stores/offline.js` | 10 | **4** | `checkForNewPDFs` e `enableOffline` abortam |
| `offline/storage/CacheMigration.js` | 5 | **3** | migração aborta; loga falha falsa |
| `utils/staleChunkRecovery.js` | 3 | **1** | o resgate de deploy velho não corre |
| `utils/statsCache.js` | 19 | 0 | — (mas enumera cru) |
| `stores/carousel.js` | 7 | 0 | — |
| `stores/savedPlaylists.js` | 6 | 0 | — |
| `stores/offlineDownloadedCategories.js` | 7 | 0 | — |
| `offline/manifest/ManifestCache.js` | 7 | 0 | — |
| `offline/import/OfflineBundleImporter.js` | 5 | 0 | — |
| `utils/pdfIndex.js` | 10 | 0 | — |
| `utils/swRegistration.js` | 2 | 0 | — |
| `utils/groupLouvores.js` | 2 | 0 | — |
| `offline/core/OfflineManager.js` | 2 | 0 | — |
| `routes/offline/+page.svelte` | 3 | 0 | — |
| **Total** | **96** | **16** | |

**Três correções ao texto da Fase 8 original**, que trabalhava com números
tirados da investigação e não do código de hoje:

1. Dizia "os ~20 acessos crus de `offline.js`". São **4**. As Fases 2 e 3 já
   converteram seis, e os outros seis sempre estiveram em `try`.
2. Dizia "os 15 acessos restantes de `swRegistration.js`". São **2**, ambos em
   `try`, ambos no mesmo `debugLog`. O item 6 dos acumulados — a incoerência
   entre o silêncio do `swRegistration` e o log do `cacheSync` — resolve-se numa
   linha, não numa faxina.
3. O item 1 dos acumulados dizia que o `sessionStorage` "tem o defeito idêntico".
   **Tem a guarda idêntica e inútil, mas não o defeito:** dos 6 acessos a
   `sessionStorage`, 5 estão em `try`. Só `staleChunkRecovery.js:60` está cru.
   Prioridade muito menor do que a lista sugeria.

### Escopo: os 16, não os 96

Os 80 acessos que já vivem em `try/catch` **ficam de fora**. Trocá-los por
`safeGet`/`safeSet` não muda comportamento nenhum: são 80 edições, 80 hipóteses
de erro de transcrição e zero defeitos corrigidos. A Fase 3 estabeleceu a regra
que vale aqui — converte-se onde o comportamento está errado, não onde o padrão
está feio. As duas exceções, incluídas por corrigirem comportamento e não estilo,
são a enumeração do `statsCache.js` (Task 6) e o log falso do `CacheMigration.js`
(Task 4).

---

## Estrutura de arquivos

- **Criar** `src/lib/utils/storageKeys.js` — a constante `IS_LEITOR_OFFLINE_KEY`,
  hoje literal em quatro sítios.
- **Criar** `src/lib/pdf-reader/readerPreferences.test.js` — o arquivo não tem teste.
- **Criar** `src/lib/utils/staleChunkRecovery.test.js` — idem.
- **Modificar** `src/lib/pdf-reader/readerPreferences.js`, `src/routes/leitor/+page.svelte`,
  `src/lib/stores/offline.js`, `src/lib/offline/storage/CacheMigration.js`,
  `src/lib/utils/staleChunkRecovery.js`, `src/lib/utils/statsCache.js`,
  `src/lib/utils/swRegistration.js`, `src/lib/offline/storage/pdfCacheNfcMigration.js`,
  `src/lib/offline/storage/CacheStorageAdapter.js`,
  `src/lib/components/OfflineRequirementsAlert.svelte`,
  `src/lib/components/OfflineIndicator.svelte`.

Um commit por tarefa. Nenhuma tarefa bloqueia outra: **as Tasks 1 a 7 são
independentes entre si** e podem correr em paralelo, exceto que a Task 2 consome
a constante criada na Task 1.

---

### Task 1: `readerPreferences.js` + a constante `IS_LEITOR_OFFLINE_KEY`

Esta é a tarefa que existe para consertar a `/leitor` em branco. O arquivo tem
seis acessos, **nenhum** protegido, e a guarda que ele usa não guarda:
`typeof window === 'undefined'` é falso num navegador, então a execução segue
direto para o `localStorage.getItem` que lança.

O que torna isto fatal e não apenas chato: as três funções são chamadas em
**inicializadores de instância** da rota do leitor —
`src/routes/leitor/+page.svelte:113` (`preferredFitMode = getFitMode()`),
`:116` (`navigationMode = getNavigationMode()`) e `:132`
(`readerBrightness = getBrightness()`). Inicializador de instância corre dentro
de `instance()`, antes de o componente existir. Um throw ali não é um valor
errado: é a construção do componente abortada, e a página fica **em branco**.

**Files:**
- Create: `src/lib/utils/storageKeys.js`
- Create: `src/lib/pdf-reader/readerPreferences.test.js`
- Modify: `src/lib/pdf-reader/readerPreferences.js` (linhas 14-64)

**Interfaces:**
- Consome: `safeGet`, `safeSet` de `$lib/utils/safeStorage.js`;
  `criarFakeStorage`, `criarStorageQueLanca`, `criarStorageSomenteLeitura` de
  `$lib/testing/fakeStorage.js`.
- Produz: `IS_LEITOR_OFFLINE_KEY` exportado de `$lib/utils/storageKeys.js`,
  consumido pela Task 2. A assinatura pública de `readerPreferences.js` **não
  muda** — `getFitMode()`, `setFitMode(mode)`, `getNavigationMode()`,
  `setNavigationMode(mode)`, `getBrightness()`, `setBrightness(value)`,
  `BRIGHTNESS_PRESETS`, `DEFAULT_BRIGHTNESS`.

- [ ] **Passo 1: escrever o teste que falha**

Crie `src/lib/pdf-reader/readerPreferences.test.js`. Não precisa do hook de
aliases: `readerPreferences.js` não importa `$lib` nem `$app` hoje, e depois da
mudança importa `../utils/safeStorage.js` por caminho relativo.

```js
/**
 * As preferências do leitor com armazenamento hostil. Este arquivo existe
 * porque as três leituras entram por inicializador de instância da rota
 * `/leitor` — um throw aqui não devolve valor errado, aborta a construção do
 * componente e deixa a página em branco.
 * Run: node --test src/lib/pdf-reader/readerPreferences.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { criarFakeStorage, criarStorageQueLanca, criarStorageSomenteLeitura } from '../testing/fakeStorage.js';
import {
  getFitMode, setFitMode,
  getNavigationMode, setNavigationMode,
  getBrightness, setBrightness,
  DEFAULT_BRIGHTNESS
} from './readerPreferences.js';

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function instalar(storage) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage, configurable: true, writable: true
  });
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else delete globalThis.localStorage;
});

describe('readerPreferences — storage que lança em tudo', () => {
  beforeEach(() => instalar(criarStorageQueLanca('SecurityError')));

  it('getFitMode devolve o padrão em vez de lançar', () => {
    assert.doesNotThrow(() => getFitMode());
    assert.equal(getFitMode(), 'page-fit');
  });

  it('getNavigationMode devolve o padrão em vez de lançar', () => {
    assert.doesNotThrow(() => getNavigationMode());
    assert.equal(getNavigationMode(), 'horizontal');
  });

  it('getBrightness devolve o padrão em vez de lançar', () => {
    assert.doesNotThrow(() => getBrightness());
    assert.equal(getBrightness(), DEFAULT_BRIGHTNESS);
  });

  it('os setters não lançam', () => {
    assert.doesNotThrow(() => setFitMode('page-width'));
    assert.doesNotThrow(() => setNavigationMode('vertical'));
    assert.doesNotThrow(() => setBrightness(60));
  });
});

describe('readerPreferences — storage ausente (SSR / node puro)', () => {
  beforeEach(() => { delete globalThis.localStorage; });

  it('devolve os três padrões', () => {
    assert.equal(getFitMode(), 'page-fit');
    assert.equal(getNavigationMode(), 'horizontal');
    assert.equal(getBrightness(), DEFAULT_BRIGHTNESS);
  });
});

describe('readerPreferences — storage que lê mas recusa gravar', () => {
  beforeEach(() => instalar(criarStorageSomenteLeitura({ pdfPreferredFitMode: 'page-width' })));

  it('a leitura continua a valer', () => {
    assert.equal(getFitMode(), 'page-width');
  });

  it('a gravação recusada não lança nem corrompe a leitura', () => {
    assert.doesNotThrow(() => setFitMode('page-fit'));
    assert.equal(getFitMode(), 'page-width');
  });
});

describe('readerPreferences — storage normal', () => {
  beforeEach(() => instalar(criarFakeStorage()));

  it('faz ida e volta dos três valores', () => {
    setFitMode('page-width');
    assert.equal(getFitMode(), 'page-width');
    setNavigationMode('vertical');
    assert.equal(getNavigationMode(), 'vertical');
    setBrightness(130);
    assert.equal(getBrightness(), 130);
  });

  it('valor inválido gravado à mão cai no padrão', () => {
    instalar(criarFakeStorage({
      pdfPreferredFitMode: 'lixo',
      pdfNavigationMode: 'diagonal',
      pdfReaderBrightness: '999'
    }));
    assert.equal(getFitMode(), 'page-fit');
    assert.equal(getNavigationMode(), 'horizontal');
    assert.equal(getBrightness(), DEFAULT_BRIGHTNESS);
  });

  it('getBrightness não aceita o "" que vira 0 no Number()', () => {
    instalar(criarFakeStorage({ pdfReaderBrightness: '' }));
    assert.equal(getBrightness(), DEFAULT_BRIGHTNESS);
  });
});
```

- [ ] **Passo 2: correr e ver falhar**

Run: `node --test src/lib/pdf-reader/readerPreferences.test.js`
Esperado: **FALHA** com `SecurityError` nos blocos de storage hostil — é
exatamente o throw que hoje deixa a `/leitor` em branco.

- [ ] **Passo 3: criar a constante compartilhada**

Crie `src/lib/utils/storageKeys.js`:

```js
/**
 * Chaves de armazenamento usadas em mais de um módulo.
 *
 * Só entram aqui as chaves com mais de um dono. As que vivem inteiras dentro de
 * um módulo (`pdfPreferredFitMode`, `STATS_CACHE_KEY`, `PDF_INDEX_KEY`) ficam
 * onde estão — mover tudo para cá seria centralizar sem ganho.
 */

/**
 * Marca que o utilizador entrou na rota `/leitor`. Escrita em
 * `routes/leitor/+page.svelte`, lida em `stores/offline.js`,
 * `OfflineIndicator.svelte` e `OfflineRequirementsAlert.svelte` — quatro sítios
 * que até 2026-09-02 repetiam a string à mão.
 */
export const IS_LEITOR_OFFLINE_KEY = 'IS_LEITOR_OFFLINE';
```

- [ ] **Passo 4: converter `readerPreferences.js`**

Substitua o corpo das seis funções. A guarda `typeof window === 'undefined'`
**sai**: era ela que dava a falsa sensação de proteção, e `safeGet` já devolve
`null` quando não há armazenamento nenhum — o mesmo resultado que a guarda
produzia, agora também quando o armazenamento existe e lança.

```js
/**
 * Preferências persistidas do leitor de PDF em localStorage.
 *
 * Todos os acessos passam por `safeStorage`. A guarda antiga
 * (`typeof window === 'undefined'`) foi removida de propósito: num navegador com
 * dados de site bloqueados ela é falsa e deixava passar o `getItem` que lança.
 * Como as três leituras correm em inicializador de instância de
 * `routes/leitor/+page.svelte`, esse throw abortava a construção do componente e
 * a página ficava em branco. `safeGet` devolve `null` nos dois casos — sem
 * armazenamento e com armazenamento hostil.
 */

import { safeGet, safeSet } from '../utils/safeStorage.js';

const KEYS = {
  FIT_MODE: 'pdfPreferredFitMode',
  NAV_MODE: 'pdfNavigationMode',
  BRIGHTNESS: 'pdfReaderBrightness',
};

/**
 * @returns {'page-fit' | 'page-width'}
 */
export function getFitMode() {
  const saved = safeGet(KEYS.FIT_MODE);
  return saved === 'page-width' || saved === 'page-fit' ? saved : 'page-fit';
}

/**
 * @param {'page-fit' | 'page-width'} mode
 */
export function setFitMode(mode) {
  safeSet(KEYS.FIT_MODE, mode);
}

/**
 * @returns {'horizontal' | 'vertical'}
 */
export function getNavigationMode() {
  const saved = safeGet(KEYS.NAV_MODE);
  return saved === 'vertical' ? 'vertical' : 'horizontal';
}

/**
 * @param {'horizontal' | 'vertical'} mode
 */
export function setNavigationMode(mode) {
  safeSet(KEYS.NAV_MODE, mode);
}

/** Predefinições de brilho, em % — 100 é o padrão (sem filtro). */
export const BRIGHTNESS_PRESETS = [100, 60, 130];
export const DEFAULT_BRIGHTNESS = 100;

/**
 * @returns {number}
 */
export function getBrightness() {
  const saved = safeGet(KEYS.BRIGHTNESS);
  // `Number('')` e `Number(null)` dão 0, que não está nos presets — o
  // `includes` abaixo já rejeita, mas o `saved === null` deixa a intenção clara.
  if (saved === null) return DEFAULT_BRIGHTNESS;
  const valor = Number(saved);
  return BRIGHTNESS_PRESETS.includes(valor) ? valor : DEFAULT_BRIGHTNESS;
}

/**
 * @param {number} value
 */
export function setBrightness(value) {
  safeSet(KEYS.BRIGHTNESS, String(value));
}
```

- [ ] **Passo 5: correr e ver passar**

Run: `node --test src/lib/pdf-reader/readerPreferences.test.js`
Esperado: **PASSA**, todos.

- [ ] **Passo 6: suíte inteira e portão**

Run: `npm test && npm run check:offline && npm run build`
Esperado: tudo verde, `check:offline` sem diagnósticos, build limpo.

- [ ] **Passo 7: commit**

```bash
git add src/lib/pdf-reader/readerPreferences.js src/lib/pdf-reader/readerPreferences.test.js src/lib/utils/storageKeys.js
git commit -m "fix(leitor): preferências do leitor não derrubam mais a página com storage bloqueado"
```

---

### Task 2: os dois acessos crus de `routes/leitor/+page.svelte`

**Files:**
- Modify: `src/routes/leitor/+page.svelte` (linhas 21-23 e 550-554)
- Modify: `src/lib/components/OfflineIndicator.svelte` (linha 27)
- Modify: `src/lib/components/OfflineRequirementsAlert.svelte` (linhas 7 e 15)
- Modify: `src/lib/stores/offline.js` (linhas 1655 e 1800)

**Interfaces:**
- Consome: `IS_LEITOR_OFFLINE_KEY` de `$lib/utils/storageKeys.js` (Task 1);
  `safeGet`, `safeSet` de `$lib/utils/safeStorage.js`.
- Produz: nada que outra tarefa consuma.

Os dois acessos crus da rota:
`:23` dentro de `_perfEnabled`, que é chamado por `perfMark`/`perfMeasure` — que
correm no caminho de carregamento do PDF; e `:553` dentro do `onMount`, onde um
throw aborta **todo o resto do `onMount`**, incluindo a montagem do viewer.

- [ ] **Passo 1: converter `_perfEnabled`**

```ts
  const _perfEnabled = () => safeGet('plpcjf_perf_debug') === '1'
```

Acrescente ao bloco de imports do `<script>`:

```ts
  import { safeGet, safeSet } from '$lib/utils/safeStorage.js';
  import { IS_LEITOR_OFFLINE_KEY } from '$lib/utils/storageKeys.js';
```

- [ ] **Passo 2: converter a escrita do `onMount`**

```ts
  onMount(async () => {
    // Marca que o utilizador entrou no leitor. `safeSet` em vez de
    // `localStorage.setItem`: com dados bloqueados o throw abortava o resto
    // deste onMount — inclusive a montagem do viewer.
    safeSet(IS_LEITOR_OFFLINE_KEY, 'true');
```

A guarda `if (typeof window !== 'undefined')` sai junto: `safeSet` já cobre.

- [ ] **Passo 3: passar os outros três consumidores à constante**

Em `src/lib/components/OfflineIndicator.svelte:27`, trocar a literal:

```svelte
  $: isLeitorOffline = browser ? safeGet(IS_LEITOR_OFFLINE_KEY) === 'true' : false;
```

Em `src/lib/components/OfflineRequirementsAlert.svelte`, apagar a linha 7
(`const IS_LEITOR_OFFLINE_KEY = 'IS_LEITOR_OFFLINE';`) e importar a constante.

Em `src/lib/stores/offline.js:1655` e `:1800`, trocar
`safeStorage()?.getItem('IS_LEITOR_OFFLINE')` por
`safeGet(IS_LEITOR_OFFLINE_KEY)`. **Não** alterar mais nada nessas linhas — a
Task 3 é que mexe no resto do arquivo.

Ambos os componentes precisam do import novo:

```svelte
  import { IS_LEITOR_OFFLINE_KEY } from '$lib/utils/storageKeys.js';
```

- [ ] **Passo 4: verificar**

Run: `npm test && npm run check:offline && npm run build`
Esperado: tudo verde. Depois, confirmar que a string literal sumiu do código:

Run: `grep -rn "'IS_LEITOR_OFFLINE'" src | grep -v storageKeys.js`
Esperado: **nenhuma linha**.

- [ ] **Passo 5: commit**

```bash
git add src/routes/leitor/+page.svelte src/lib/components/OfflineIndicator.svelte src/lib/components/OfflineRequirementsAlert.svelte src/lib/stores/offline.js
git commit -m "fix(leitor): IS_LEITOR_OFFLINE vira constante e passa por safeStorage"
```

---

### Task 3: os quatro acessos crus de `stores/offline.js`

**Files:**
- Modify: `src/lib/stores/offline.js` (linhas 1074, 1091, 1140, 1958)

**Interfaces:**
- Consome: `safeGet`, `safeSet` — já importados no arquivo desde a Fase 2.
- Produz: nada.

Três dos quatro estão em `checkForNewPDFs()` (a partir da linha 1071), fora de
qualquer `try`. O quarto está em `enableOffline()` (linha 1956). Com armazenamento
bloqueado, `checkForNewPDFs` aborta na primeira linha e a deteção de PDFs novos
nunca corre; `enableOffline` aborta antes de fazer o que promete.

- [ ] **Passo 1: converter as três de `checkForNewPDFs`**

Linha 1074:
```js
  const allowOffline = safeGet(ALLOW_OFFLINE_KEY) === 'true';
```
Linha 1091:
```js
  const lastHash = safeGet(LAST_MANIFEST_HASH_KEY);
```
Linha 1140:
```js
  safeSet(LAST_MANIFEST_HASH_KEY, currentHash);
```

- [ ] **Passo 2: converter a de `enableOffline`**

Linha 1958:
```js
    safeSet(ALLOW_OFFLINE_KEY, 'true');
```

- [ ] **Passo 3: verificar que não sobrou acesso cru fora de `try` no arquivo**

Run: `grep -n "localStorage\." src/lib/stores/offline.js`
Esperado: sobram exatamente **6** linhas — 255, 265, 301, 355, 1248, 1256 — todas
dentro de `try`. Se aparecer alguma das quatro convertidas, a edição falhou.

- [ ] **Passo 4: suíte e portão**

Run: `npm test && npm run check:offline && npm run build`

- [ ] **Passo 5: commit**

```bash
git add src/lib/stores/offline.js
git commit -m "fix(offline): checkForNewPDFs e enableOffline não abortam com storage bloqueado"
```

---

### Task 4: `CacheMigration.js` — três acessos crus e um log que mente

**Files:**
- Modify: `src/lib/offline/storage/CacheMigration.js` (linhas 30, 60, 149)

**Interfaces:**
- Consome: `safeGet`, `safeSet`, `safeRemove` de `$lib/utils/safeStorage.js`.
- Produz: nada.

**Atenção: este arquivo está sob `src/lib/offline/**`, onde o
`check:offline` tem tolerância zero.** Rode o portão antes do commit.

Além do throw, este arquivo produz o defeito de diagnóstico do item 3 dos
acumulados: quando o armazenamento está bloqueado, o `catch` de fora reporta
`Cache migration V1 failed` — uma falha de migração que nunca aconteceu. Quem
depurar isso vai à procura de um problema de Cache Storage que não existe.

- [ ] **Passo 1: converter os três**

Linha 30:
```js
    const migrationComplete = safeGet(MIGRATION_COMPLETE_KEY);
```
Linha 60:
```js
    if (safeGet(MIGRATION_COMPLETE_KEY) === 'true') {
```
Linha 149:
```js
      safeRemove(MIGRATION_COMPLETE_KEY);
```

- [ ] **Passo 2: converter também os dois que já estão em `try`**

As linhas 73 e 132 (`localStorage.setItem(MIGRATION_COMPLETE_KEY, 'true')`)
passam a `safeSet`. **Esta é uma das duas exceções à regra de escopo**, e por um
motivo concreto: se a marca de "migração concluída" não gravar, a migração
inteira volta a correr em cada arranque. Com `safeSet` devolvendo `boolean`, dá
para dizer isso em vez de o adivinhar:

```js
        const gravou = safeSet(MIGRATION_COMPLETE_KEY, 'true');
        if (!gravou) {
          logger.warn(
            'Migração concluída, mas a marca não gravou — vai repetir no próximo arranque'
          );
        }
```

Aplique nos dois sítios (73 e 132).

- [ ] **Passo 3: acrescentar o import**

```js
import { safeGet, safeSet, safeRemove } from '$lib/utils/safeStorage.js';
```

- [ ] **Passo 4: portão primeiro**

Run: `npm run check:offline`
Esperado: **0 diagnósticos.** Se aparecer qualquer coisa em
`src/lib/offline/**`, corrija a tipagem — **nunca** afrouxe `TARGET_PREFIXES`.

- [ ] **Passo 5: suíte e build**

Run: `npm test && npm run build`

- [ ] **Passo 6: commit**

```bash
git add src/lib/offline/storage/CacheMigration.js
git commit -m "fix(offline): CacheMigration deixa de abortar e de reportar falha falsa"
```

---

### Task 5: `staleChunkRecovery.js:60` — o único `sessionStorage` cru

**Files:**
- Create: `src/lib/utils/staleChunkRecovery.test.js`
- Modify: `src/lib/utils/staleChunkRecovery.js` (linha 60)

**Interfaces:**
- Consome: `criarFakeStorage`, `criarStorageQueLanca` de `$lib/testing/fakeStorage.js`.
- Produz: nada.

Este é o caminho de resgate: quando um deploy novo deixa o navegador a pedir
chunks velhos, é ele que desregista o service worker e recarrega. Se lançar na
linha 60, o resgate não corre e o utilizador fica preso num app partido. Justamente
o cenário onde falhar dói mais.

**Nota importante sobre a API:** `safeStorage.js` cobre `localStorage`, não
`sessionStorage`. **Não crie um módulo gémeo.** Como este é o único acesso cru a
`sessionStorage` em todo o repo, um `try/catch` local resolve, sem inventar
superfície de API para um só chamador. Se um dia aparecer um terceiro chamador,
aí sim vale parametrizar `getStorage(kind)`.

- [ ] **Passo 1: escrever o teste que falha**

```js
/**
 * O resgate de deploy velho com sessionStorage hostil. Este é o caminho que
 * conserta um app partido — falhar aqui deixa o utilizador preso.
 * Run: node --test src/lib/utils/staleChunkRecovery.test.js
 */

import { register } from 'node:module';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { criarFakeStorage, criarStorageQueLanca } from '../testing/fakeStorage.js';

// Mesmo hook de aliases de `cacheSync.test.js`: este módulo importa
// `$app/environment` e `$lib/offline/sw/swCaches.js`.
const raizLib = fileURLToPath(new URL('../', import.meta.url));
const hookAliasesSvelteKit = `
const raizLib = ${JSON.stringify(raizLib)};
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '$app/environment') {
    return {
      url: 'data:text/javascript,export const version = "test";export const browser = true;export const dev = true;export const building = false;',
      shortCircuit: true
    };
  }
  if (specifier.startsWith('$lib/')) {
    return nextResolve(new URL(specifier.slice('$lib/'.length), 'file://' + raizLib).href, context);
  }
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(hookAliasesSvelteKit)}`, import.meta.url);

const { tryRecoverFromStaleDeployment } = await import('./staleChunkRecovery.js');

const originalSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function instalarSession(storage) {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: storage, configurable: true, writable: true
  });
}

let recarregou = 0;

beforeEach(() => {
  recarregou = 0;
  Object.defineProperty(globalThis, 'window', {
    value: { location: { reload: () => { recarregou++; } } },
    configurable: true, writable: true
  });
  // Sem service worker nem caches: `hardResetSwAndAppCaches` já tem try/catch
  // próprio, então basta que os globais não existam.
  Object.defineProperty(globalThis, 'navigator', {
    value: {}, configurable: true, writable: true
  });
});

afterEach(() => {
  if (originalSession) Object.defineProperty(globalThis, 'sessionStorage', originalSession);
  else delete globalThis.sessionStorage;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete globalThis.window;
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete globalThis.navigator;
});

describe('tryRecoverFromStaleDeployment — sessionStorage que lança', () => {
  beforeEach(() => instalarSession(criarStorageQueLanca('SecurityError')));

  it('não lança', async () => {
    await assert.doesNotReject(() => tryRecoverFromStaleDeployment('teste'));
  });

  it('recarrega mesmo assim — o resgate é mais importante que a contagem', async () => {
    const disparou = await tryRecoverFromStaleDeployment('teste');
    assert.equal(disparou, true);
    assert.equal(recarregou, 1);
  });
});

describe('tryRecoverFromStaleDeployment — sessionStorage normal', () => {
  beforeEach(() => instalarSession(criarFakeStorage()));

  it('conta as tentativas e desiste na terceira', async () => {
    assert.equal(await tryRecoverFromStaleDeployment('1'), true);
    assert.equal(await tryRecoverFromStaleDeployment('2'), true);
    assert.equal(await tryRecoverFromStaleDeployment('3'), false);
    assert.equal(recarregou, 2);
  });
});
```

- [ ] **Passo 2: correr e ver falhar**

Run: `node --test src/lib/utils/staleChunkRecovery.test.js`
Esperado: **FALHA** com `SecurityError` no primeiro bloco.

- [ ] **Passo 3: proteger a gravação**

Substitua a linha 60:

```js
  // A contagem é um limitador de segurança, não o objetivo. Com sessionStorage
  // bloqueado o `readState` já devolve `{ n: 0 }` e esta gravação lançaria —
  // abortando o resgate justamente no navegador onde o app está partido.
  // Perder a contagem custa, no pior caso, reloads a mais; perder o resgate
  // custa o app.
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ n: s.n + 1, at: Date.now() }));
  } catch { /* armazenamento bloqueado: seguir sem contar */ }
```

**Trade registado:** com armazenamento bloqueado, o limite de 2 tentativas
deixa de valer, porque `readState` devolve sempre `{ n: 0 }`. Isso já era verdade
antes desta mudança — o `readState` sempre teve `try/catch`. A alternativa
(abortar o resgate) é pior: é o comportamento de hoje, e deixa o app partido.

- [ ] **Passo 4: correr e ver passar**

Run: `node --test src/lib/utils/staleChunkRecovery.test.js` → **PASSA**

- [ ] **Passo 5: suíte, portão, build**

Run: `npm test && npm run check:offline && npm run build`

- [ ] **Passo 6: commit**

```bash
git add src/lib/utils/staleChunkRecovery.js src/lib/utils/staleChunkRecovery.test.js
git commit -m "fix(recovery): resgate de chunk velho sobrevive a sessionStorage bloqueado"
```

---

### Task 6: a enumeração de `statsCache.js` e o silêncio de `swRegistration.js`

**Files:**
- Modify: `src/lib/utils/statsCache.js` (linhas 54-60 e 402-410)
- Modify: `src/lib/utils/swRegistration.js` (linha 423)

**Interfaces:**
- Consome: `safeKeys` de `$lib/utils/safeStorage.js`.
- Produz: nada.

**Esta é a segunda exceção à regra de escopo.** Os 19 acessos do `statsCache.js`
estão todos em `try`, mas dois deles **enumeram** (`localStorage.length` +
`.key(i)`), e enumeração é o caso em que o `try` de fora é pior que o wrapper: um
throw a meio do laço descarta a lista inteira, enquanto `safeKeys()` devolve a
parte que conseguiu ler. Foi exatamente para isto que `safeKeys` foi escrita na
Fase 1, e hoje não tem chamador.

- [ ] **Passo 1: converter a primeira enumeração (linhas ~54-60)**

Substitua o laço por:

```js
    // `safeKeys()` em vez de `localStorage.length` + `.key(i)`: se o
    // armazenamento lançar a meio, o laço cru perdia a lista toda para o
    // `catch` de fora. `safeKeys` devolve o que conseguiu ler.
    for (const key of safeKeys()) {
```

Ajuste o corpo: onde havia `const key = localStorage.key(i);` a variável já vem
do `for...of`, e a linha some. O resto do corpo do laço fica igual.

- [ ] **Passo 2: converter a segunda enumeração (linhas ~402-410)**

Mesma troca. O `keysToRemove.forEach(key => localStorage.removeItem(key))` da
linha 410 passa a:

```js
    safeRemoveMany(keysToRemove);
```

Acrescente `safeRemoveMany` ao import.

- [ ] **Passo 3: resolver a incoerência do `swRegistration.js:423`**

Item 6 dos acumulados. Onde o `cacheSync.js` passou a registar em consola o
armazenamento que recusa gravar, o `swRegistration.js:423` continua mudo.
Acrescente o log equivalente, com a mesma forma que a Fase 3 estabeleceu em
`cacheSync.js` — leia o `console.error` de lá e replique a forma, não invente
outra. Se a linha 423 não tiver mais gravação nenhuma depois das Fases 3 e 8
(confirme antes de editar), registe no relatório que o item já estava resolvido
e **não invente uma mudança para justificar a tarefa**.

- [ ] **Passo 4: suíte, portão, build**

Run: `npm test && npm run check:offline && npm run build`

- [ ] **Passo 5: commit**

```bash
git add src/lib/utils/statsCache.js src/lib/utils/swRegistration.js
git commit -m "refactor(stats): enumeração parcial em vez de tudo-ou-nada, e o log que faltava"
```

---

### Task 7: os três resíduos de correção do item 4 dos acumulados

**Files:**
- Modify: `src/lib/offline/storage/pdfCacheNfcMigration.js`
- Modify: `src/lib/offline/storage/CacheStorageAdapter.js` (linha ~505)
- Modify: `docs/superpowers/plans/2026-09-02-divida-tecnica-em-fases.md` (texto da Fase 6)

**Interfaces:** nenhuma. Três correções independentes, um commit.

**Atenção: `pdfCacheNfcMigration.js` e `CacheStorageAdapter.js` estão sob
`src/lib/offline/**` — tolerância zero no `check:offline`.**

- [ ] **Passo 1: inverter a ordem em `pdfCacheNfcMigration.js`**

A Fase 6 acrescentou a guarda que impede apagar a chave boa, mas colocou-a
**depois** do `put`. Se a guarda recusar, a chave nova já foi escrita e fica
órfã. Mova a guarda para **antes** do `put`: decidir primeiro, escrever depois.
Leia a função inteira antes de mover — a guarda compara os dois `pathname`
descodificados em NFC e recusa chave com `?` ou `#`, e esses dois testes têm de
continuar a correr sobre os mesmos valores.

- [ ] **Passo 2: corrigir as asserções `size === 2`**

Os testes da Fase 6 afirmam `size === 2` descrevendo isso como "mantém as duas
chaves". Depois da inversão do Passo 1, o comportamento correto passa a ser
**uma** chave quando a guarda recusa (porque o `put` nem chega a correr). Ajuste
cada asserção ao comportamento real e corrija o comentário que a acompanha.
Corrija também a frase "mantém as duas chaves" no texto da Fase 6 do plano
original — é a descrição que induziu a asserção errada.

- [ ] **Passo 3: deduplicar `listPdfs()`**

Em `CacheStorageAdapter.js:505`, `listPdfs()` pode devolver o mesmo PDF duas
vezes quando as duas formas de normalização da mesma chave estão em cache.
Passe o resultado por um `Set` antes de devolver.

- [ ] **Passo 4: portão primeiro, depois suíte e build**

Run: `npm run check:offline && npm test && npm run build`
Esperado: `check:offline` **0**; suíte verde.

- [ ] **Passo 5: commit**

```bash
git add src/lib/offline/storage/pdfCacheNfcMigration.js src/lib/offline/storage/CacheStorageAdapter.js docs/superpowers/plans/2026-09-02-divida-tecnica-em-fases.md
git commit -m "fix(offline): guarda NFC decide antes de escrever, e listPdfs deixa de duplicar"
```

---

### Task 8: verificação em navegador — a prova que faltou na Fase 3

**Files:** nenhum. Esta tarefa produz um documento, não código.

A Fase 3 ficou com uma lacuna registada: **o cenário de dados bloqueados nunca
foi verificado em navegador**, porque as ferramentas da sessão eram Chrome e o
caso conhecido era Firefox estrito. Esta é a tarefa que fecha essa lacuna, e é a
única prova real de que a `/leitor` deixou de ficar em branco.

**Este passo precisa do Jairo:** alterar uma definição de privacidade do
navegador não é coisa que a automação deva fazer sozinha.

- [ ] **Passo 1: subir o build de produção**

```bash
npm run build && nohup npx vite preview --port 4188 > /tmp/preview.log 2>&1 & disown
```

Use o proxy de leitura do §4 de `docs/superpowers/verificacao-manual-2026-09-01.md`.
**Porta 4188, não 4173** — a 4173 tem um service worker de outra aplicação
registado. Confirme com `navigator.serviceWorker.getRegistrations()` antes de
confiar em qualquer coisa.

- [ ] **Passo 2: bloquear os dados do site**

**Chrome:** Definições → Privacidade e segurança → Cookies e outros dados →
"Bloquear todos os cookies", ou acrescente `localhost:4188` à lista de sites
bloqueados. Com isto, `localStorage.getItem` lança `SecurityError` — o mesmo erro
do Firefox estrito.

**Firefox (alternativa, o caso original):** Definições → Privacidade →
"Rigorosa", e recarregar.

Confirme que o bloqueio está mesmo ativo antes de tirar conclusões:

```js
// Na consola. Tem de devolver 'lançou'.
(() => { try { localStorage.getItem('x'); return 'passou'; } catch (e) { return 'lançou: ' + e.name; } })()
```

Se devolver `passou`, o bloqueio não pegou e **todo o resto desta tarefa é
inválido** — foi este erro de protocolo que invalidou duas medições da Fase 4.

- [ ] **Passo 3: percorrer as rotas**

| Rota | Esperado |
|---|---|
| `/` | abre, lista de louvores visível |
| `/biblioteca` | abre, resultados visíveis |
| `/listas` | abre (vazia — não há como guardar) |
| `/offline` | abre, sem capa presa |
| **`/leitor?file=<um pdf>`** | **abre e mostra o PDF** — hoje fica em branco |

Em cada uma, a consola pode ter avisos; **não pode ter exceção não capturada**.

- [ ] **Passo 4: exercitar o leitor**

Com o leitor aberto e os dados bloqueados: mudar o modo de ajuste, mudar o modo
de navegação, ciclar o brilho. Os três têm de funcionar na sessão corrente e
**não persistir** ao recarregar — que é o degradar correto, não a falha.

- [ ] **Passo 5: desbloquear e confirmar que não se partiu nada**

Reponha a definição do navegador, recarregue, e confirme que as preferências
voltam a persistir entre recarregamentos.

- [ ] **Passo 6: registar**

Escreva `docs/superpowers/verificacao-fase-8-<data>.md` com o que foi observado,
**incluindo o que não foi**. Uma linha que não correu escreve-se como não corrida.

---

## FASE 9 (separada) — para onde vão os ~47 s da varredura

**Isto não é uma tarefa da Fase 8, e está aqui como fase própria de propósito.**

A Fase 8 é determinística: 16 sítios conhecidos, correção conhecida, prova por
`node --test`. A Fase 9 é uma investigação com duração desconhecida e **sem
correção conhecida** — pode terminar sem uma linha de código alterada. Metê-las
na mesma fase faria a correção da `/leitor` — que é um defeito visível hoje —
ficar refém de uma pesquisa que pode não concluir. Executam-se em qualquer ordem,
ou em paralelo.

**O que se sabe**, de
`docs/superpowers/investigacoes/2026-09-02-medicao-da-varredura.md`:

- A varredura completa leva **50,0 s** com 4630 PDFs em Cache Storage.
- `cache.keys()` sobre 4630 entradas: **230 ms**.
- Extrair `.url` de 4630 requests: **3 ms**.
- Normalizar 4630 caminhos (`decodeURIComponent` + `new URL` + NFC): **26 ms**.
- Buscar o manifesto de 4630 louvores: **26 ms**.
- As 95 reconstruções de índice que a Fase 4 eliminava: **~2,5 s no total**, e a
  medição ponta a ponta nem isso mostrou.

**Somando tudo o que já foi medido, dá menos de 3 s. Faltam ~47 s.**

**O que já falhou:** ler o código e inferir onde está o custo. Foi assim que
nasceu a Fase 4 — uma otimização correta, revista três vezes, que não move um
único número. **Contar ocorrências não é medir custo.** Esta fase não repete isso.

### Protocolo

- [ ] **Passo 1: reproduzir os 50 s** exatamente com o protocolo do §Protocolo da
  investigação — porta 4188, origem limpa confirmada por
  `navigator.serviceWorker.getRegistrations()`, Cache Storage semeado por script
  com os 4630 caminhos reais, e as quatro chaves de estado derivado
  (`pdfAvailabilityIndex`, `cachedPdfsList`, `cachedPdfsListLocal`,
  `offlineStatsCache_v2`) apagadas antes da corrida. **Sem confirmar os ~50 s,
  não avance** — sem linha de base não há medição.

- [ ] **Passo 2: gravar um profile de performance** do DevTools cobrindo a
  varredura inteira, do clique em "Clique aqui para atualizar" até a capa descer.
  50 s de profile é grande; grave com amostragem, não com instrumentação.

- [ ] **Passo 3: ler o profile pela árvore *bottom-up*, não pela *call tree*.**
  A pergunta é "qual função acumula tempo próprio", não "qual função é chamada
  muitas vezes" — a segunda pergunta é a que produziu a Fase 4.

- [ ] **Passo 4: classificar os 47 s** em pelo menos estas caixas, com número
  para cada: JS próprio da aplicação; `await` a esperar por I/O (Cache Storage,
  rede); layout/paint forçado por leitura de DOM dentro do laço; tempo em
  `pdf.js` ou noutra biblioteca; tempo ocioso à espera do service worker. **A
  hipótese mais provável, ainda por confirmar, é a quinta**: 4630 idas ao Cache
  Storage uma a uma, serializadas por `await` dentro de um laço, valem 47 s
  facilmente a 10 ms cada — e nenhuma delas aparece nos custos já medidos, que
  foram todos medidos em lote.

- [ ] **Passo 5: escrever o achado** em
  `docs/superpowers/investigacoes/<data>-onde-estao-os-47s.md` **antes** de propor
  qualquer correção, com os números do profile. Se o profile não der resposta,
  o documento diz isso e nomeia o que tentar a seguir. **Um achado honesto sem
  correção vale mais do que uma correção sem achado** — a Fase 4 é a prova.

- [ ] **Passo 6: só então** decidir se há correção a fazer, e planeá-la à parte,
  com medição antes e depois pelo mesmo protocolo.

---

## Auto-revisão

**Cobertura contra os acumulados:** item 1 (`sessionStorage`) → Task 5, com a
correção de que o problema era 1 acesso e não 5. Item 2 (`/leitor` em branco) →
Tasks 1, 2 e 8. Item 3 (`CacheMigration`) → Task 4. Item 4 (NFC, asserções,
`listPdfs`) → Task 7. Item 5 (os 47 s) → Fase 9. Item 6 (`swRegistration:423`) →
Task 6, Passo 3. Item 7 (constante partilhada de normalização) **não tem tarefa**:
é uma condição para uma refatoração futura que ninguém está a fazer, não trabalho
pendente. Fica registado, sem tarefa.

**Marcadores de posição:** nenhum passo diz "melhore" ou "trate os erros". Os
dois passos que não trazem código pronto são o Passo 3 da Task 6 e o Passo 1 da
Task 7, e ambos dizem porquê: precisam de ler o estado atual do arquivo antes de
decidir a forma, e ambos autorizam explicitamente concluir que não há nada a fazer.

**Consistência de tipos:** `safeGet` devolve `string | null`; `safeSet` e
`safeRemove` devolvem `boolean`; `safeKeys` devolve `string[]`; `safeRemoveMany`
devolve `{ removed, failed }`. As Tasks 1, 3 e 4 tratam `null` explicitamente. A
Task 4 é a única que usa o `boolean` de retorno, e para dizer algo real.

**Onde este plano pode estar errado:** a Task 8 assume que a definição do Chrome
"bloquear todos os cookies" faz `localStorage` lançar `SecurityError`, como o
Firefox estrito. Se o Chrome apenas devolver um armazenamento vazio em vez de
lançar, a verificação prova menos do que promete — e nesse caso a tarefa tem de
passar para Firefox. O Passo 2 tem a sonda de consola que deteta isso **antes**
de qualquer conclusão, justamente porque a alternativa é uma verificação que se
acredita ter feito e não fez.
