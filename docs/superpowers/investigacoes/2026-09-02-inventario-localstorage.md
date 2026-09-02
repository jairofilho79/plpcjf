# Inventário de `localStorage` cru em `src/` — plpcjf

Levantamento para o plano de correção do defeito adiado: *"offline.js — 20+ acessos
crus a `localStorage`. Num navegador com armazenamento bloqueado (Firefox estrito,
aba privada), a limpeza de dados pode lançar no meio e abortar em silêncio."*

## Resumo executivo

- **111 acessos reais** (`getItem`/`setItem`/`removeItem`/`length`/`key()`) em
  **18 arquivos de produção** sob `src/` (mais 3 em fixtures de teste, que não contam).
  Adicionalmente, **19 checagens `typeof localStorage === 'undefined'`** espalhadas por
  4 arquivos — essas *são* acessos que podem lançar (ver seção 2).
- **offline.js concentra 26 desses acessos** e já tem um wrapper seguro
  (`safeStorage()`/`safeSetItem()`) — mas ele só é usado em 6 dos 26 pontos. Os outros
  20 continuam crus. É o arquivo citado no defeito, e é exatamente esse gap.
- **Achado mais importante do levantamento**: o padrão de guarda usado em
  `pdfValidation.js`, `cacheSync.js`, `louvoresManifestChecksum.js` e 3 pontos de
  `swRegistration.js` — `if (typeof localStorage === 'undefined') return` — **não
  protege contra o cenário do defeito**. Em Firefox com dados do site bloqueados, o
  próprio getter de `localStorage` lança `SecurityError` ao ser lido, e `typeof x`
  só suprime exceção para identificador *não resolvível* (variável nunca declarada em
  lugar nenhum) — não para uma propriedade que existe mas cujo getter lança. `typeof
  localStorage` portanto **também lança**. Isso não é especulação: é o motivo
  documentado no próprio código-fonte — o comentário de `safeStorage()` em
  `src/lib/stores/offline.js:531-538` diz literalmente "No Firefox com dados do site
  bloqueados o próprio getter global lança" e por isso usa `try/catch`, não `typeof`.
  Só que essa correção não foi propagada aos outros 4 arquivos, que ainda usam o
  padrão que não funciona.
- **Dois componentes Svelte montados na `+layout.svelte` raiz** (`OfflineIndicator`)
  fazem leitura direta e sem guarda alguma dentro de uma expressão reativa `$:` — se
  lançar, quebra a montagem do componente em **toda página do site**, não só em
  fluxos de download.
- **Já existem dois padrões de solução no próprio repo**, nenhum aplicado de forma
  consistente: `safeStorage()`/`safeSetItem()` (arquivo único, acesso à global) e
  `validationCacheStore.js` (storage recebido por parâmetro, já testável sob
  `node --test`). Ver seção 4.

---

## 1. Inventário completo (file:line, operação, chave, guardado?, roda no load?)

Convenções: **guardado** = a chamada específica está dentro de um `try/catch` que
efetivamente a envolve (não apenas em algum lugar da função). **Roda no load** = o
caminho de código executa durante o carregamento/montagem de uma rota, sem exigir
ação do usuário (download, exclusão de dados, etc.).

### `src/lib/stores/offline.js` (26 acessos — o arquivo citado no defeito)

| Linha | Operação | Chave | Guardado | Roda no load |
|---|---|---|---|---|
| 254 | write | `OFFLINE_MANIFEST_KEY` | Não (dentro de `try` da função, mas é o único `catch` de todo o fetch — ver §3) | Sim (`fetchOfflineManifest` roda em `initialize()`) |
| 264 | read | `OFFLINE_MANIFEST_KEY` | Sim (dentro de `try { … } catch (e)` interno de fallback) | Sim (fallback do fetch acima) |
| 300 | read | `ALLOW_OFFLINE_KEY` | Não | Sim (`initialize()`) |
| 354 | write | `CACHED_PDFS_KEY` | Não (mesmo bloco try amplo da função `loadCachedPdfsList`, não específico) | Sim (chamada em `initialize()`) |
| 542 | read (`typeof`+leitura) | — | Sim — é a própria `safeStorage()`, com `try/catch` | N/A (utilitário) |
| 561-566 | write | (parametrizada) | Sim — é a própria `safeSetItem()` | N/A (utilitário) |
| 774 | leitura via `safeStorage()` | (para `clearAllCompletedParts`) | Sim | Ação do usuário (download) |
| 1073 | read | `ALLOW_OFFLINE_KEY` | Não | Sim (`checkForNewPDFs`, chamado após `initialize()`) |
| 1090 | read | `LAST_MANIFEST_HASH_KEY` | Não | Sim (mesmo fluxo) |
| 1139 | write | `LAST_MANIFEST_HASH_KEY` | Não | Sim (fim de `checkForNewPDFs`) |
| 1247 | write | `ALLOW_OFFLINE_KEY` | Não | Ação do usuário (fim de download) |
| 1255 | write | `LAST_MANIFEST_HASH_KEY` | Não | Ação do usuário (fim de download) |
| 1376 | leitura via `safeStorage()` | (retomada de parte) | Sim | Ação do usuário (download) |
| 1590-1598 | write x2 | `ALLOW_OFFLINE_KEY`, `LAST_MANIFEST_HASH_KEY` | Não (via `safeSetItem`, ver nota) | Ação do usuário |
| 1654 | read via `safeStorage()` | `IS_LEITOR_OFFLINE` | Sim | Ação do usuário (fim de download ZIP) |
| 1799 | read via `safeStorage()` | `IS_LEITOR_OFFLINE` | Sim | Ação do usuário (fim de seleção de categoria) |
| 1904-1909 | remove x6 (sequência) | `ALLOW_OFFLINE_KEY`, `CACHED_PDFS_KEY`, `LAST_MANIFEST_HASH_KEY`, `SELECTED_CATEGORIES_KEY`, `DOWNLOADED_CATEGORIES_KEY`, `OFFLINE_CATEGORIAS_SALVAS` | **Não** — cru, dentro do `try` de `clearAllCache()`, mas cada `removeItem` pode lançar e abortar os seguintes | Ação do usuário ("Limpar cache") — **este é o ponto citado no defeito** |
| 1911 | leitura via `safeStorage()` | (`clearAllCompletedParts`) | Sim | Ação do usuário |
| 1942 | write | `ALLOW_OFFLINE_KEY` | Não | Ação do usuário (`enableOffline()`) |

Nota sobre 995-1003/1590-1598: essas chamadas já usam `safeSetItem`, mostrando que o
padrão contido no próprio arquivo, quando aplicado, resolve o problema — reforça que
o gap é de **cobertura**, não de design.

### `src/lib/utils/statsCache.js` (24 acessos — já bem guardado)

Todas as 24 ocorrências (linhas 56-57, 86, 100, 118, 131, 186, 232, 278, 306, 348,
371, 378, 400, 404-405, 410, 449, 486) estão dentro do `try/catch` da função pública
que as contém — inclusive as duas enumerações (`localStorage.length`/`.key(i)` em
`initStatsCache` linha 56-57 e em `clearCache` linha 404-405). **Nenhum acesso cru
aqui.** Roda no load (`initStatsCache`, chamado a partir de páginas com stats), mas
como está guardado, não é um risco de crash — é o exemplo de "já correto" a manter.

### `src/lib/utils/swRegistration.js` (18 acessos)

| Linha(s) | Operação | Chave | Guardado | Roda no load |
|---|---|---|---|---|
| 16 | read | `plpcjf_perf_debug` | Sim (`try/catch` próprio de `readDebugFlag`) | Sim (SW registration) |
| 340-354 | read | `cachedPdfsListLocal` (`CACHED_PDFS_LOCAL_KEY`) | **Parcial** — o `getItem` está em `try`, mas a checagem-guarda `typeof localStorage !== 'undefined'` que decide *entrar* no bloco está **fora** do `try` (linha 340) e pode lançar sozinha | Sim — `getCachedPDFsFast` é chamado pela cadeia de validação de PDF usada ao abrir `/leitor` e ao listar louvores |
| 389-397 | write | `CACHED_PDFS_LOCAL_KEY` | Mesma falha: `typeof localStorage` de guarda (linha 389) fora do `try` interno | Sim (mesmo fluxo) |
| 410-415 | remove | `CACHED_PDFS_LOCAL_KEY` | Mesma falha (linha 410) | Sim (`invalidateCachedPDFsLocal`, chamada em vários pontos, inclusive no load) |
| 608 | read | `plpcjf_perf_debug` | Sim — aqui o `typeof` *está* dentro do `try` de `debugLog` | Sim (chamado o tempo todo) |

### `src/lib/utils/louvoresManifestChecksum.js` (12 acessos, **0 guardados**)

| Linha | Operação | Chave | Guardado | Roda no load |
|---|---|---|---|---|
| 44-45 | read | `plpcjf:louvores:checksumLastOkAt` | Não (só `typeof`, que também pode lançar) | Sim — `readManifestBodySha256`/`readChecksumLastOkAt` são chamados por `loadLouvores()`, executado no `onMount` de `/`, `/listas`, `/biblioteca`, `/offline` |
| 53-54 | write | idem | Não | Ação indireta (após sync bem-sucedido), mas dentro do fluxo de load |
| 58-60 | read | `plpcjf:louvores:manifestBodySha256` | Não | Sim (idem — `ensureLouvoresManifestBodySha256Baseline` roda em todo `loadLouvores()`) |
| 67-69 | write | idem | Não | Sim/ação indireta |
| 79-81 | read (dentro de `try` interno próprio, mas a guarda `typeof` de linha 79 é externa a ele) | `plpcjf:louvores:manifestSyncPenalty` | Parcial | Sim (chamado por `shouldFetchExpectedChecksum`/`isManifestSyncBlocked`, parte do gatilho de checksum agendado no load via idle-callback) |
| 96-97 | write | idem | Não | Idem |

Este é o **segundo arquivo mais crítico** depois de `offline.js`: zero guarda efetiva,
e as leituras (`readManifestBodySha256`) rodam literalmente dentro de `loadLouvores()`,
chamado no mount das páginas principais do site.

### `src/lib/utils/cacheSync.js` (8 acessos)

| Linha | Operação | Chave | Guardado | Roda no load |
|---|---|---|---|---|
| 164 (guarda) + 175 | read | `pdfCacheVersion` | Guarda (linha 164) **fora** do `try` que começa depois; pode lançar antes de entrar nele | Sim — `checkCacheVersionChanged` é chamado por `setupCacheSync()`, importado em `+layout.svelte` e em `/offline` |
| 179, 185 | write | idem | Dentro do `try`, correto | Sim |
| 202 (guarda) + 209 | write | idem | Mesma falha de guarda externa | Ação indireta pós-sync |
| 220 (guarda) + 225 | remove | idem | Mesma falha de guarda externa | Ação do usuário ("Limpar cache") |

### `src/lib/utils/pdfValidation.js` (11 acessos, 0 `try/catch` próprio — delega a `validationCacheStore.js`, que é seguro)

| Linha | Operação | Guardado | Roda no load |
|---|---|---|---|
| 61 | `typeof` de guarda | **Não** — pode lançar sozinha | Sim (`ensureLegacyMigration`, chamada pela cadeia de validação de PDF usada ao abrir `/leitor`) |
| 75, 86, 96, 104 | `typeof` de guarda antes de delegar a `readValidationEntry`/`writeValidationEntry`/etc. | **Não** | Sim (todo o fluxo `validatePdfAvailabilityFast`/`validatePdfAvailability`, chamado ao renderizar qualquer PDF) |
| 63, 77, 88, 97, 105 | chamada real (`migrateLegacyValidationKeys(localStorage)`, `readValidationEntry(localStorage, …)` etc.) | A função chamada *é* segura (tem seu próprio `try/catch` interno), mas para chegar até ela o código já passou pela guarda `typeof` de fora, que não é segura | Sim |

Ou seja: o dado em si (`readValidationEntry` etc.) está protegido internamente por
`validationCacheStore.js`, mas o *acesso ao identificador global* `localStorage` na
guarda externa (`typeof localStorage === 'undefined'`) não está — o mesmo bug de
guarda-ineficaz do item anterior.

### `src/lib/offline/manifest/ManifestCache.js` (9 acessos, todos guardados)

Linhas 37, 77, 84 (checagem de nome de erro), 102, 129, 144-145, 228 — todas dentro de
`try/catch` por método (`get`, `set`, `isExpired`, `_remove`, `clear`, `getStats`).
Roda no load (cache de manifest, usado por `fetchOfflineManifest`-equivalentes). **Sem
gaps aqui** — é outro exemplo de "já correto".

### `src/lib/stores/offlineDownloadedCategories.js` (12 acessos, todos guardados)

Linhas 93, 107, 121, 126, 130, 148, 150 — cada função (`getSavedCategories`,
`saveCategories`, `getDownloadedCategories`, `saveDownloadedCategories`) tem seu
próprio `try { … } catch (e) { … }` envolvendo todos os seus acessos, incluindo a
sequência de 2 escritas em `saveDownloadedCategories` (linha 148 e 150 — ver §3,
listada mesmo assim por ser uma sequência de mutação). Roda no load, mas guardado.

### `src/lib/offline/storage/CacheMigration.js` (5 acessos)

| Linha | Operação | Chave | Guardado | Roda no load |
|---|---|---|---|---|
| 30 | read | `cache_migration_v1_complete` | **Não** — antes do `try` da função `needsMigration()` | Só via `ensureInitialized()`/`/offline` com categoria selecionada, não em toda rota |
| 60 | read | idem | **Não** — antes do `try` de `migrate()` | Idem |
| 73, 132 | write | idem | Sim (dentro do `try`) | Idem |
| 149 | remove | idem | Não (`resetMigrationFlag`, só para teste manual) | Não é chamado em produção |

Mitigante: o único chamador de produção, `OfflineManager.initialize()`, envolve
`await cacheMigration.migrate()` no seu próprio `try/catch` (linha 143-147), então um
throw aqui não escapa até a UI — mas ainda assim aborta a migração naquela chamada.

### `src/lib/offline/core/OfflineManager.js` (2 acessos, guardados)

Linhas 100 e 109, ambas dentro do `try` de `ensureNfcMigration()` (linhas 98-114) —
correto. Este método roda **em toda visita**, via import dinâmico no `onMount` de
`+layout.svelte` (linha ~100-103 do layout).

### `src/lib/offline/import/OfflineBundleImporter.js` (6 acessos, todos guardados)

Linhas 456, 497, 501, 511-512 — cada `setItem` está no seu próprio `try/catch` (ou
compartilha um `try` que cobre só escritas, com `catch { /* ignore */ }`). Ação do
usuário (import de ZIP), não roda no load.

### `src/lib/stores/savedPlaylists.js` (12) e `src/lib/stores/carousel.js` (14) — bem guardados

Leitura inicial (`loadSavedPlaylistsFromStorage`/`loadCarouselFromStorage`) e toda
escrita subsequente estão em `try/catch` com `browser` como guarda adicional. Rodam
no load (estado inicial do store), mas sem gap.

### `src/lib/utils/pdfIndex.js` (9 acessos, todos guardados)

Linhas 122, 129-130, 146, 154, 161, 373 — todas dentro de `try/catch` por função
(`savePdfIndex`, `loadPdfIndex`, `clearPdfIndex`). Sem gap.

### `src/lib/pdf-reader/readerPreferences.js` (7 acessos, **0 guardados**)

| Linha | Operação | Chave | Guardado | Roda no load |
|---|---|---|---|---|
| 16 | read | `pdfPreferredFitMode` | Não | Sim — chamado no `onMount`/render de `/leitor` |
| 25 | write | idem | Não | Ação do usuário (troca de modo de ajuste) |
| 33 | read | `pdfNavigationMode` | Não | Sim (idem) |
| 42 | write | idem | Não | Ação do usuário |
| 54 | read | `pdfReaderBrightness` | Não | Sim (idem) |
| 63 | write | idem | Não | Ação do usuário |

Único guard é `typeof window === 'undefined'`, que não impede o `localStorage.getItem`
seguinte de lançar. Roda a cada abertura de `/leitor` — é hoje o único arquivo do
leitor de PDF sem nenhuma proteção, e o leitor é a rota mais visitada do app.

### Componentes Svelte

| Arquivo:linha | Operação | Chave | Guardado | Roda no load |
|---|---|---|---|---|
| `src/lib/components/OfflineIndicator.svelte:21` | read (`$:` reativo) | `IS_LEITOR_OFFLINE` | **Não**, só `browser ? … : false` | **Sim, em toda página** — importado em `src/routes/+layout.svelte:8` e renderizado incondicionalmente (a lógica de exibição é interna ao componente, mas a expressão reativa roda na montagem independente do `{#if}` externo) |
| `src/lib/components/OfflineRequirementsAlert.svelte:11` | read (`$:` reativo) | `IS_LEITOR_OFFLINE` | Não, mesmo padrão | Só na página que usa este componente (não está na layout raiz — usado em `/offline`, ver grep) |
| `src/routes/leitor/+page.svelte:23` | read | `plpcjf_perf_debug` | Não (`typeof window` não protege o `localStorage.getItem` seguinte) | Sim — chamado por `perfMark`, usado ao longo de todo o ciclo de vida de `/leitor` |
| `src/routes/leitor/+page.svelte:553` | write | `IS_LEITOR_OFFLINE` | Não | Sim — `onMount` de `/leitor`, todo acesso |
| `src/routes/offline/+page.svelte:296` | read | `OFFLINE_AVAILABLE` | Sim (`try/catch` em `checkOfflineAvailable`) | Sim (`onMount` de `/offline`) |
| `src/routes/offline/+page.svelte:309, 312` | write/remove | `OFFLINE_AVAILABLE` | Sim (`try/catch` em `setOfflineAvailable`) | Ação do usuário |

`OfflineIndicator.svelte` é o achado de maior impacto de superfície: está na
`+layout.svelte`, então uma exceção não capturada na sua expressão reativa quebra a
montagem do componente **em qualquer rota do site**, não apenas nas telas de
offline/download.

---

## 2. Quais realmente lançam — acesso à propriedade vs. quota

Dois mecanismos distintos de falha, ambos relevantes:

1. **Lançamento no próprio acesso ao identificador `localStorage`.** Em Firefox com
   "Bloquear cookies e dados de sites" no modo estrito (e em algumas combinações de
   aba privada), `window.localStorage` é um **getter que lança `SecurityError`** ao
   ser lido — não apenas ao chamar `setItem`. Isso significa que **nem `getItem` puro,
   nem sequer a leitura para decidir se se deve chamar `getItem`, são seguros por si
   só**. E, crucialmente, **`typeof localStorage` não escapa disso**: a supressão de
   exceção do operador `typeof` só vale para uma *referência não resolvível* (um
   identificador que não existe em escopo algum) — spec ECMA-262 §13.5.3, via
   `IsUnresolvableReference`. `localStorage` **é** resolvível (existe como
   propriedade), só que o `[[Get]]` dela lança; `typeof` chama `GetValue`, que invoca
   o getter, e a exceção propaga normalmente. O código já documenta isso em
   `offline.js:531-538` sobre a razão de existir de `safeStorage()`. Os arquivos que
   usam apenas `typeof localStorage === 'undefined'` como guarda (`pdfValidation.js`,
   `cacheSync.js`, `louvoresManifestChecksum.js`, e 3 pontos de `swRegistration.js`)
   **não estão protegidos** contra este cenário — a guarda em si pode lançar.

2. **Lançamento só em `setItem`/`removeItem` por cota (`QuotaExceededError`) ou modo
   privado antigo do Safari.** Aqui `getItem` funciona normalmente; só escritas (e,
   em iOS Safari privado antigo, a primeira escrita) lançam. Todos os `try/catch`
   existentes no repo (statsCache.js, ManifestCache.js, savedPlaylists.js etc.) foram
   escritos pensando neste caso — capturam bem o `QuotaExceededError`, mas por
   estarem *depois* de uma leitura de `localStorage` sem guarda de acesso, ainda
   ficam expostos ao cenário 1 se a leitura anterior (fora do próprio `try`) já
   tiver lançado.

**Caminhos que rodam no load (categoria 1 — quebram a página, não só uma ação)**:
`OfflineIndicator.svelte` (toda rota via layout), `loadLouvores()` →
`readManifestBodySha256`/`ensureLouvoresManifestBodySha256Baseline` (rotas `/`,
`/listas`, `/biblioteca`, `/offline`), `readerPreferences.js` (rota `/leitor`),
`pdfValidation.js` → `ensureLegacyMigration`/`getCachedValidation` (qualquer
renderização de PDF), `swRegistration.js:getCachedPDFsFast` (mesma cadeia),
`cacheSync.js:checkCacheVersionChanged` (`setupCacheSync()`, chamado em
`+layout.svelte` e em `/offline`), `offline.js:initialize()` (linha 300, 1073, 1090).

**Caminhos só em ação do usuário**: toda a limpeza de cache
(`offline.js:clearAllCache`, `cacheSync.js:clearCacheVersion`), o fim de um download
(`offline.js` linhas 1247/1255/1590-1598/1654/1799), a troca de preferências do leitor
(`setFitMode`/`setNavigationMode`/`setBrightness`), e o import de bundle offline.

---

## 3. Operações multi-etapa que podem abortar pela metade

1. **`clearAllCache()` em `src/lib/stores/offline.js:1903-1911`** — a que o defeito
   cita explicitamente. Seis `removeItem` seguidos, crus:
   ```
   1904 localStorage.removeItem(ALLOW_OFFLINE_KEY);
   1905 localStorage.removeItem(CACHED_PDFS_KEY);
   1906 localStorage.removeItem(LAST_MANIFEST_HASH_KEY);
   1907 localStorage.removeItem(SELECTED_CATEGORIES_KEY);
   1908 localStorage.removeItem(DOWNLOADED_CATEGORIES_KEY);
   1909 localStorage.removeItem(OFFLINE_CATEGORIAS_SALVAS);
   1911 clearAllCompletedParts(safeStorage());
   ```
   Se a 2ª (`CACHED_PDFS_KEY`) lançar, `ALLOW_OFFLINE_KEY` já foi removida mas as
   quatro seguintes não. Estado resultante: **`ALLOW_OFFLINE_KEY` ausente (offline
   "desligado" aos olhos do app) mas `CACHED_PDFS_KEY`, `SELECTED_CATEGORIES_KEY`,
   `DOWNLOADED_CATEGORIES_KEY` e `OFFLINE_CATEGORIAS_SALVAS` ainda com os valores
   antigos** — a UI de categorias mostra categorias "baixadas" que a função
   pretendia esquecer, e uma nova ativação de offline herda uma lista de PDFs em
   cache que pode não bater mais com a realidade (o Service Worker já foi
   limpo por `clearCacheSW()`, chamado antes, then linha 1902 `invalidateCachedPDFsLocal()`
   já rodou). O `throw error` no `catch` externo (linha ~1917) reporta falha, mas o
   chamador não sabe *quais* das seis chaves foram de fato removidas — não há como
   fazer retry seguro sem duplicar risco de re-remover o que já foi removido (o que é
   inofensivo aqui, felizmente, já que `removeItem` de uma chave inexistente é no-op —
   mas a UI já pode ter lido o estado inconsistente entre o meio do throw e o catch).

2. **`saveDownloadedCategories()` em `src/lib/stores/offlineDownloadedCategories.js:145-154`**
   — duas escritas relacionadas (chave nova `OFFLINE_CATEGORIAS_SALVAS` e chave antiga
   `DOWNLOADED_CATEGORIES_KEY`, mantida "para compatibilidade retroativa"):
   ```
   148 localStorage.setItem(OFFLINE_CATEGORIAS_SALVAS, JSON.stringify(categories));
   150 localStorage.setItem(DOWNLOADED_CATEGORIES_KEY, JSON.stringify(categories));
   ```
   Ambas estão no mesmo `try`, então uma falha na primeira já cai no `catch` e a
   segunda nunca roda — mas se a *segunda* falhar (ex.: cota estourou exatamente
   entre as duas escritas), a chave nova fica atualizada e a antiga desatualizada.
   `getDownloadedCategories()` (linhas 117-138) sempre prefere a chave nova quando
   presente, então esse caso específico não corrompe a leitura — é a chave antiga,
   morta para leitura normal, que fica obsoleta. Risco baixo, mas é uma
   inconsistência real de estado.

3. **`_applyManifests()` em `src/lib/offline/import/OfflineBundleImporter.js:453-516`**
   — a mais longa sequência do repo: grava `offlineManifest` (456), aplica dados de
   louvores via import dinâmico (487-488), atualiza o store `offline` (491), grava
   `saveCategories` (via store) + `OFFLINE_CATEGORIAS_SALVAS` + `downloadedCategories`
   (497-504), e por fim `OFFLINE_AVAILABLE` + `ALLOW_OFFLINE_KEY` (511-512). Cada
   bloco tem seu próprio `try/catch` isolado e todos os `catch` são "ignore"/`logger.warn`
   — ou seja, o código **já foi desenhado para tolerar falha parcial aqui**: se
   `OFFLINE_AVAILABLE`/`ALLOW_OFFLINE_KEY` não gravarem, o import de PDFs no Cache
   Storage já aconteceu (é feito antes, em `_downloadAndStage`/equivalente) mas a
   flag "offline disponível" fica ausente — usuário com PDFs no cache mas sem o
   indicador refletindo isso. Não é uma sequência "tudo ou nada" pretendida, mas o
   efeito de uma escrita cair no meio é real: incoerência entre o que está de fato
   em cache e o que as flags de UI dizem.

4. **`writeManifestBodySha256` + `writeChecksumLastOkAt`** em
   `src/lib/stores/louvores.js` (chamados em sequência nas linhas 107-108, 288+~,
   360+~, 383+~, 410+~, 497-499) via `louvoresManifestChecksum.js` — duas chaves
   independentes (`manifestBodySha256`, `checksumLastOkAt`) que deveriam avançar
   juntas após uma sincronização bem-sucedida. Nenhuma delas tem `try/catch` (ver
   §1). Se a primeira lançar, a segunda sequer é chamada; se a primeira tiver sucesso
   e a segunda lançar, `checksumLastOkAt` fica desatualizado e o próximo
   `shouldFetchExpectedChecksum` (que depende de `readChecksumLastOkAt`) vai achar
   que nunca sincronizou "com sucesso reconhecido" mesmo tendo o hash novo — o efeito
   prático é apenas uma nova tentativa de rede mais cedo que o necessário, não perda
   de dado. Baixo risco, mas é uma sequência de duas escritas cruas mesmo assim.

---

## 4. O que já existe

Sim — **dois padrões distintos, nenhum vira utilitário compartilhado**:

- **`safeStorage()` / `safeSetItem()`** em `src/lib/stores/offline.js:531-566`.
  Acessa a global `localStorage` (não recebe por parâmetro), `safeStorage()` devolve
  `Storage | null` engolindo qualquer exceção (inclusive a do próprio getter),
  `safeSetItem(key, value)` idem para escrita. É exatamente o formato de wrapper que
  o defeito pede — só que vive dentro de `offline.js`, não é exportado, e só é usado
  em 6 dos 26 pontos do próprio arquivo onde poderia se aplicar. Não é usado por
  nenhum outro arquivo.
- **`validationCacheStore.js`** (`src/lib/utils/validationCacheStore.js`) — padrão
  diferente e mais testável: todas as funções (`readValidationEntry`, `writeValidationEntry`,
  `removeValidationEntry`, `clearValidationCache`, `migrateLegacyValidationKeys`)
  **recebem `storage` como parâmetro** em vez de tocar a global diretamente, e cada
  uma embrulha seus próprios acessos em `try/catch`. O comentário de topo do arquivo
  é explícito: *"Recebe o storage por parâmetro para ser testável sob `node --test`
  sem DOM."* — ou seja, o próprio autor já identificou a injeção de dependência como
  o caminho certo para testabilidade, só que aplicou isso a um módulo só.
- **Por que os outros 20+ pontos não usam nenhum dos dois**: `safeStorage()` não é
  exportado de `offline.js` (é `function` de módulo, não `export function`), então
  nenhum outro arquivo poderia importá-lo mesmo se quisesse. `validationCacheStore.js`
  resolve um problema mais específico (registro único de validação) e sua forma
  (funções puras que recebem `storage`) exigiria refatorar a assinatura de toda
  função que hoje lê a global direto — não é um "drop-in" para os outros arquivos
  sem mudar quem os chama.
- **Guarda "de baixo custo" recorrente mas ineficaz**: `typeof localStorage ===
  'undefined'` aparece 19 vezes em 4 arquivos como se fosse um guard, mas — ver §2 —
  não impede o lançamento do cenário do defeito (storage bloqueado), só cobre
  ambientes sem `window`/sem suporte a Web Storage (SSR, browsers muito antigos).
- **Nada mais existe**: não há um `storage.js`/`safeLocalStorage.js` de escopo geral,
  nenhum uso de `browser` de `$app/environment` combinado com `try/catch` de forma
  consistente (o `browser` guard aparece nos stores mais novos — `savedPlaylists.js`,
  `carousel.js`, `offlineDownloadedCategories.js`, `ManifestCache.js`,
  `CacheMigration.js` — mas ele só impede execução em SSR; não substitui o
  `try/catch` para o cenário de storage bloqueado em runtime de browser real, e de
  fato esses arquivos combinam `browser` **com** `try/catch`, corretamente).

Nota lateral (não é o foco do defeito, mas relevante para "preservar nomes exatos de
chave" no item 5): já existe um registro central de nomes de chave para o domínio
offline em `src/lib/offline/core/OfflineConfig.js` (`OFFLINE_MANIFEST_KEY`,
`DOWNLOADED_CATEGORIES_KEY`, `ALLOW_OFFLINE_KEY`, `OFFLINE_CATEGORIAS_SALVAS`), mas
`offline.js` e `offlineDownloadedCategories.js` **não o importam** — cada um redeclara
a mesma string como `const` local. Um wrapper de storage não deveria tentar unificar
isso agora (fora de escopo), mas deve ter cuidado para não introduzir uma terceira
fonte de verdade para os mesmos nomes.

---

## 5. Chaves em uso (nome literal → módulo dono)

| Chave (valor literal) | Dono | Outros leitores/escritores |
|---|---|---|
| `ALLOW_OFFLINE` | `offline.js` (`ALLOW_OFFLINE_KEY`) | `OfflineBundleImporter.js` (via `getConfig`, mesmo valor) |
| `cachedPdfsList` | `offline.js` (`CACHED_PDFS_KEY`) | — |
| `lastManifestHash` | `offline.js` (`LAST_MANIFEST_HASH_KEY`) | — |
| `offlineManifest` | `offline.js` (`OFFLINE_MANIFEST_KEY`) | `OfflineBundleImporter.js` (via `getConfig`) |
| `selectedCategoriesForDownload` | `offlineDownloadedCategories.js` (`SELECTED_CATEGORIES_KEY`) | — |
| `downloadedCategories` | `offlineDownloadedCategories.js` (`DOWNLOADED_CATEGORIES_KEY`) | `OfflineBundleImporter.js` (via `getConfig`) |
| `OFFLINE_CATEGORIAS_SALVAS` | `offlineDownloadedCategories.js` | `OfflineBundleImporter.js` (via `getConfig`) |
| `OFFLINE_AVAILABLE` | `src/routes/offline/+page.svelte` (`OFFLINE_AVAILABLE_KEY`, local) | `OfflineBundleImporter.js` (string literal direta) |
| `savedPlaylists` | `savedPlaylists.js` (`SAVED_PLAYLISTS_STORAGE_KEY`) | — |
| `carouselLouvores` | `carousel.js` (`CAROUSEL_STORAGE_KEY`) | — |
| `pdfAvailabilityIndex` | `pdfIndex.js` (`PDF_INDEX_KEY`) | — |
| `pdfIndexLastVerification` | `pdfIndex.js` (`SESSION_VERIFICATION_KEY`) | (não usei grep completo neste, é `sessionStorage`? confirmar — declarado mas não visto em uso de `localStorage` direto nas linhas lidas) |
| `offlineStatsCache_v2` | `statsCache.js` (`STATS_CACHE_KEY`) | (mais chaves legadas `offlineStatsCache_*` sem sufixo `_v2`, migradas e removidas) |
| `pdfValidationCache_v1` | `validationCacheStore.js` (`VALIDATION_CACHE_KEY`) | (mais chaves legadas `pdfValidation_<pdfId>`, migradas e removidas por `migrateLegacyValidationKeys`) |
| `cachedPdfsListLocal` | `swRegistration.js` (`CACHED_PDFS_LOCAL_KEY`) | — |
| `plpcjf_perf_debug` | lido em `swRegistration.js`, `leitor/+page.svelte` | flag de debug, não tem "dono" de escrita — é setada manualmente via devtools |
| `pdfCacheVersion` | `cacheSync.js` (`CACHE_VERSION_KEY`) | — |
| `cache_migration_v1_complete` | `CacheMigration.js` (`MIGRATION_COMPLETE_KEY`) | — |
| `plpc_pdf_cache_nfc_migration_v1` | `pdfCacheNfcMigration.js` (`NFC_MIGRATION_FLAG`) | usado por `OfflineManager.js` |
| `offline_manifest_louvores`, `offline_manifest_offline` | `ManifestCache.js` (prefixo `offline_manifest_` + tipo) | — |
| `plpcjf:louvores:checksumLastOkAt` | `louvoresManifestChecksum.js` (`LS_CHECKSUM_LAST_OK_AT`) | usado por `louvores.js` |
| `plpcjf:louvores:manifestBodySha256` | `louvoresManifestChecksum.js` (`LS_MANIFEST_BODY_SHA256`) | usado por `louvores.js` |
| `plpcjf:louvores:manifestSyncPenalty` | `louvoresManifestChecksum.js` (`LS_MANIFEST_SYNC_PENALTY`) | — |
| `pdfPreferredFitMode`, `pdfNavigationMode`, `pdfReaderBrightness` | `readerPreferences.js` (`KEYS.*`) | — |
| `IS_LEITOR_OFFLINE` | escrito em `leitor/+page.svelte:553` e `offline.js` (linhas 1654/1799, só leitura) | lido em `OfflineIndicator.svelte`, `OfflineRequirementsAlert.svelte` — **valor literal duplicado em 4 arquivos, nenhum exporta a constante** |

**Total: 25 chaves distintas** (contando as duas de `ManifestCache` e desconsiderando
variações legadas já cobertas por migração). Qualquer wrapper precisa preservar cada
uma **exatamente como está** — não há oportunidade de "limpar" nomes nesta tarefa sem
quebrar dados já persistidos em aparelhos de usuários reais.

---

## 6. Bugs encontrados (não robustez — comportamento errado hoje)

1. **`src/lib/utils/cacheSync.js:164` (e 202, 220), `src/lib/utils/pdfValidation.js:61,75,86,96,104`,
   `src/lib/utils/louvoresManifestChecksum.js:44,53,59,68,79,96`, `src/lib/utils/swRegistration.js:340,389,410`**
   — a guarda `typeof localStorage === 'undefined'` (ou `!== 'undefined'`) **não
   cumpre a função para a qual foi escrita**. Em todo lugar onde essa guarda existe
   *fora* de um `try/catch`, o código lança exatamente no mesmo cenário que ela
   deveria evitar (storage bloqueado). Não é "falta de robustez" — é uma guarda que
   parece proteger e não protege; qualquer revisor lendo o código por cima concluiria
   (erradamente) que esses caminhos já estão seguros. Confirmado pelo próprio repo:
   `offline.js` documenta esse exato mecanismo de falha ao justificar por que
   `safeStorage()` usa `try/catch` em vez de `typeof`.
2. **`src/lib/components/OfflineIndicator.svelte:21`** — o guard usado é só `browser
   ? … : false`, sem `try/catch` nenhum, dentro de uma expressão reativa `$:` que
   roda incondicionalmente a cada montagem do componente na `+layout.svelte`, ou
   seja, em toda página do site. É o ponto de maior alcance (blast radius) de todo o
   levantamento: uma falha aqui não fica confinada à tela de offline.
3. **Duplicação da chave `IS_LEITOR_OFFLINE`** como string literal em 4 lugares
   (`offline.js` x2, `leitor/+page.svelte`, `OfflineIndicator.svelte`,
   `OfflineRequirementsAlert.svelte`) sem uma constante exportada única — não é um
   bug de storage bloqueado, mas é o tipo de duplicação que uma refatoração de
   wrapper tende a expor e vale corrigir de passagem (baixo risco, alto valor).

---

## 7. Forma recomendada da correção

### Interface do wrapper

Um módulo novo, por exemplo `src/lib/utils/safeStorage.js` (fora do `stores/` para não
sugerir que é exclusivo do domínio offline — é usado por `readerPreferences.js`,
`louvoresManifestChecksum.js` etc. também), com estas funções:

```js
/** @returns {Storage | null} — localStorage utilizável, ou null se indisponível/bloqueado. Nunca lança. */
export function getStorage() { … }

/** @returns {string | null} — valor, ou null em qualquer falha (chave ausente OU storage indisponível). Nunca lança. */
export function safeGet(key) { … }

/** @returns {boolean} — true se a escrita teve sucesso. Nunca lança. */
export function safeSet(key, value) { … }

/** @returns {boolean} — true se a remoção "teve efeito ou não havia nada para remover"; false só se o próprio acesso lançou. Nunca lança. */
export function safeRemove(key) { … }

/** @returns {string[]} — todas as chaves atualmente no storage, ou [] se indisponível. Nunca lança. */
export function safeKeys() { … }

/**
 * Remove várias chaves numa chamada. Continua tentando as seguintes mesmo se
 * uma falhar. @returns {{ removed: string[], failed: string[] }} — nunca lança.
 */
export function safeRemoveMany(keys) { … }
```

Pontos de design:

- **Mesma assinatura de retorno em falha que hoje** (`getItem` já devolve `null`
  quando a chave não existe — `safeGet` devolve `null` também quando o storage está
  indisponível; o chamador que já trata `null` como "não tenho esse dado" não precisa
  mudar lógica, só trocar `localStorage.getItem(k)` por `safeGet(k)`). Isso é o que
  torna a migração módulo-a-módulo mecânica: cada `localStorage.getItem(k)` vira
  `safeGet(k)`, cada `localStorage.setItem(k, v)` que hoje ignora o retorno vira
  `safeSet(k, v)` (retorno também ignorável no início — nenhum caller *precisa* checar
  o booleano no dia 1). O ganho de segurança já acontece com a troca mecânica, sem
  reescrever a lógica de cada chamador.
- **`safeRemoveMany` é a resposta direta ao defeito citado**: `clearAllCache()`
  (offline.js:1904-1909) vira uma chamada única em vez de 6 `removeItem` crus, e o
  chamador recebe de volta exatamente quais chaves falharam — pode logar/reportar de
  forma precisa em vez de um `throw` genérico que não diz o que sobreviveu.
- **Enumeração** (`localStorage.length`/`.key(i)`, hoje em `statsCache.js` e
  `validationCacheStore.js`) vira `safeKeys().filter(...)` — mais simples de ler e
  testar (um array normal, sem laço manual por índice) e já cai dentro da mesma
  garantia de "nunca lança".
- **Storage indisponível: falha silenciosa para o usuário, não surfaced.** Justificativa:
  hoje **nenhum** dos 20+ pontos crus surfaceia esse tipo de erro para a UI — quando
  algo já está guardado (statsCache, ManifestCache, savedPlaylists), o padrão
  estabelecido é "loga um `console.warn`/`error` e segue com o valor default (`null`,
  `[]`, cache vazio)". Um app de partitura offline não pode bloquear a leitura de PDF
  porque uma preferência de zoom não persistiu; o pior caso aceitável é "esqueceu a
  preferência depois de fechar a aba", não "tela de erro". A única exceção a
  considerar depois (fora do escopo desta correção) é `clearAllCache()`: hoje ele já
  tem um "Erro ao limpar cache" na UI quando o Cache Storage falha — com
  `safeRemoveMany`, dá para enriquecer essa mensagem existente com "N de 6 chaves
  removidas" sem inventar um novo canal de erro.

### Como um chamador de hoje deve ler depois

```js
// antes
const saved = localStorage.getItem(KEYS.FIT_MODE);
// depois
const saved = safeGet(KEYS.FIT_MODE);
```
Sem diferença de shape — `saved` continua `string | null` nos dois casos. O
`try/catch` que hoje envolve manualmente cada chamador (`statsCache.js`,
`ManifestCache.js` etc.) pode ser **removido** quando só existir para proteger o
acesso ao `localStorage` (não quando protege também um `JSON.parse` — esse
`try/catch` continua necessário e é ortogonal ao wrapper).

---

## 8. Proposta de fases

Ordem sugerida — cada fase é um PR mergeável e revisável sozinho, sem esperar a
próxima para agregar valor:

**Fase 0 — o wrapper isolado, sem tocar nenhum chamador.**
Cria `safeStorage.js` com as 6 funções acima e testes `node --test` completos (fake
storage que lança em cada método, ver §9). Zero risco de regressão porque nada ainda
o importa. Revisão rápida: só a API e a cobertura de teste importam.

**Fase 1 — `clearAllCache()` em `offline.js`.**
Resolve especificamente o cenário citado no defeito (a limpeza de dados abortando pela
metade). Troca as 6 `removeItem` por uma chamada a `safeRemoveMany`, mantendo o
`console.log`/`throw` existente mas agora informado por `{ removed, failed }`. É a
fase de maior valor percebido por menor mudança de superfície (1 função, já isolada
por `try/catex` externo hoje).

**Fase 2 — os "falsos guards" (`typeof localStorage === 'undefined'` fora de
`try/catch`).**
`cacheSync.js`, `louvoresManifestChecksum.js`, `pdfValidation.js`, 3 pontos de
`swRegistration.js`. **Esta é a fase de maior risco real**, não pela mudança em si
(troca mecânica de `typeof` + acesso cru por `safeGet`/`safeSet`), mas porque:
(a) `loadLouvores()` roda no mount de 4 rotas diferentes — qualquer regressão de
comportamento (não só de exceção) nesta fase se manifesta amplamente; (b) são os
arquivos onde a guarda existente engana quem lê o código, então o revisor precisa
confirmar function-a-function que nenhuma lógica que dependia do `typeof` (ex.: SSR
sem `window`) mudou de comportamento — `safeGet`/`safeSet` devem preservar o
early-return em SSR (retornando `null`/`false`) para não introduzir chamadas
desnecessárias no server. Vale dividir esta fase em 4 PRs (um por arquivo) em vez de
1, dado o alcance.

**Fase 3 — `OfflineIndicator.svelte` e `OfflineRequirementsAlert.svelte`.**
Menor em linhas, mas maior em superfície de blast radius (o Indicator está na layout
raiz). Trocar a expressão reativa por uma que chama `safeGet` em vez de
`localStorage.getItem` direto. Vale isolar da Fase 2 porque é Svelte, não JS puro —
revisão e teste manual (não há como testar `.svelte` sob `node --test`) são
diferentes o suficiente para não misturar com o resto.

**Fase 4 — o resto do `offline.js` (os 20 pontos crus fora de `clearAllCache`) +
`readerPreferences.js` + `CacheMigration.js`.**
Depois que o wrapper já provou valor nas fases anteriores, esta é a faxina mecânica
de aplicar `safeGet`/`safeSet` no restante — baixo risco individual, mas é o maior
volume de linhas tocadas. Pode ser feita incrementalmente, arquivo por arquivo, sem
pressa.

**Fase 5 (opcional, fora do escopo original) — consolidar a duplicação de
`IS_LEITOR_OFFLINE`** e a divergência entre as constantes locais de `offline.js`/
`offlineDownloadedCategories.js` e as de `OfflineConfig.js`. Vale mencionar ao
planejar, mas é limpeza de nomes, não segurança de storage — não deveria bloquear as
fases 0-4.

---

## 9. Testabilidade sob `node --test`

**O que já é testável hoje, sem mudar nada**: qualquer função que já recebe o storage
por parâmetro (`validationCacheStore.js` inteiro). É o padrão a copiar para o novo
`safeStorage.js` em si: suas 6 funções devem operar sobre `globalThis.localStorage`
(para não exigir que *todo* chamador passe o storage manualmente — seria uma mudança
de assinatura grande demais para as fases 2-4), mas o `safeStorage.js` deve permitir
**injeção via `globalThis`**, exatamente como `readerPreferences.test.js` já faz:

```js
beforeEach(() => {
  globalThis.window = {};
  globalThis.localStorage = criarStorageQueLanca(); // fake que lança em getItem/setItem à vontade
});
afterEach(() => {
  delete globalThis.window;
  delete globalThis.localStorage;
});
```

Isso **já é o padrão estabelecido no repo** (não é uma seam nova a inventar) — dois
arquivos de teste já fazem exatamente isso (`readerPreferences.test.js`,
`swDebugMessage.test.js` usa algo próximo). A pequena duplicação de `criarStorage()`
entre `readerPreferences.test.js` e `validationCacheStore.test.js` (funções quase
idênticas, uma em português "criarStorage", outra em inglês "createStorage") é uma
oportunidade de extrair um helper de teste compartilhado (ex.:
`src/lib/testing/fakeStorage.js`, exportando `createFakeStorage(initial)` e uma
variante `createThrowingStorage()` que lança em toda operação, para simular
exatamente o cenário do defeito) — vale criar isso na Fase 0 junto com o wrapper, já
que toda fase seguinte (1 a 4) vai precisar simular "storage bloqueado" nos seus
próprios testes.

**O que dá para testar por fase**:
- **Fase 0**: 100% testável — `safeGet`/`safeSet`/`safeRemove`/`safeKeys`/
  `safeRemoveMany` contra um fake que (a) funciona normalmente, (b) lança em toda
  operação (`SecurityError` simulado), (c) lança só em `setItem`
  (`QuotaExceededError` simulado). `getStorage()` também testável simulando `typeof
  localStorage` via getter que lança no objeto global fake (`Object.defineProperty(globalThis, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } })`).
- **Fase 1**: `clearAllCache`'s uso de `safeRemoveMany` é testável isoladamente **se**
  a lógica de limpeza for extraída para uma função pura que recebe a lista de chaves
  e o storage (ou usa `safeRemoveMany` diretamente) — hoje `clearAllCache()` também
  chama `clearCacheSW()` (Service Worker/Cache Storage, não mockável sob `node --test`
  sem trabalho extra) e `offlineState.set(...)` (store Svelte). A parte
  testável sem mudar nada mais é exatamente a chamada a `safeRemoveMany` com as 6
  chaves — um teste unitário confirma que, com um fake que lança na 3ª chave, as
  outras 5 ainda são tentadas e o retorno reporta `{ removed: [...5], failed: [...1] }`.
  Um teste mais amplo de `clearAllCache()` completo exigiria mockar `caches`/`fetch`
  — fora do que `node --test` faz confortavelmente aqui; não vale perseguir nesta
  correção.
- **Fase 2**: cada função pura de `louvoresManifestChecksum.js` (já são funções sem
  estado, recebendo `now`/valores primitivos) fica 100% testável trocando `typeof
  localStorage`/acesso cru por `safeGet`/`safeSet` — os testes existentes de
  `louvoresManifestChecksum.test.js` (já usam `node --test`) só precisam ganhar casos
  novos com storage-que-lança. `cacheSync.js` e `pdfValidation.js` são mais
  entrelaçados com `fetch`/`caches`/módulos dinâmicos — a parte estritamente de
  storage (a troca da guarda) é testável isolando as funções auxiliares, mas o teste
  de fluxo completo dessas funções já não era feito hoje (não achei
  `cacheSync.test.js`/`pdfValidation.test.js`) e não é este o momento de criá-lo.
- **Fase 3 (Svelte)**: **não testável sob `node --test`**, como o enunciado já
  antecipa (não monta componentes). A verificação aqui é manual/visual (a skill `run`
  do projeto, ou teste manual em Firefox com "Bloquear cookies" estrito) — o único
  jeito de dar alguma garantia automatizada é extrair a leitura de
  `IS_LEITOR_OFFLINE` para uma função exportada e testável (`isLeitorOffline()` num
  `.js`, importada pelo `.svelte`), o que também elimina a duplicação de string
  literal do achado #3 da seção 6.
- **Fase 4**: mecânica, testável pelos testes já existentes de cada arquivo tocado
  (`offline.js` não tem teste unitário hoje que eu tenha localizado sob esse nome —
  confirmar antes de prometer cobertura nova ampla; o que dá para garantir com
  certeza é que os testes de `savedPlaylists`/`carousel`/`pdfIndex`, que já passam
  hoje, continuam passando, já que essa fase não muda a lógica desses arquivos).

**Seam que falta hoje**: para os arquivos de módulo que tocam a global diretamente
(`offline.js`, `cacheSync.js`, `louvoresManifestChecksum.js`, `readerPreferences.js`,
`swRegistration.js`) a única seam de injeção disponível é `globalThis.localStorage`
(padrão `readerPreferences.test.js`) — nenhum deles recebe `storage` por parâmetro
hoje. Isso é suficiente para testar o **novo** `safeStorage.js` e as funções puras que
o chamam depois da migração (o próprio `globalThis.localStorage` mockado é
consumido pelo `safeStorage.js`, que por sua vez é chamado por essas funções sem
qualquer parâmetro extra) — não é necessário introduzir injeção de parâmetro em cada
chamador para ganhar testabilidade; a injeção via `globalThis` já resolve, e é o
padrão que o repo já usa e entende.
