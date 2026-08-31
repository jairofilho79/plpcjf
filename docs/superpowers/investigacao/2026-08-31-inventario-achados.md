# Inventário de verificação — plano C

Repositório: `/Volumes/SSD 2TB SD/dev/plpcjf`, branch `main`, HEAD `b837d4ad0a85416b0020139b96f828ebe62e7fd5`.
Verificação somente leitura — nenhum arquivo do projeto foi alterado.

---

## 1. `#16` — listas longas sem `content-visibility: auto`

**MUDOU.** Não existe `content-visibility` em nenhum lugar do projeto (`grep -r "content-visibility"` vazio em `src/` e `static/`). Mas a premissa "listas longas" também mudou: tanto a home (`src/routes/+page.svelte:657`) quanto a biblioteca (`src/routes/biblioteca/+page.svelte:898`) já renderizam listas **paginadas**, não a lista inteira:

- `src/routes/+page.svelte:462-465` — `paginatedResults` é um `.slice()` de `groupedResults` por `currentPage`/`itemsPerPageHome`.
- `src/routes/biblioteca/+page.svelte:340-343` — mesmo padrão com `paginatedLouvores`.
- `src/lib/stores/bibliotecaItemsPerPage.js:8` — `VALID_OPTIONS = [10, 25, 50]`, `DEFAULT_ITEMS_PER_PAGE = 10`.

Ou seja, no máximo 50 `<LouvorCard>` são montados de uma vez (o default é 10). `content-visibility: auto` ainda não existe, mas o "custo" de renderizar tudo de uma vez que a auditoria original mirava já foi cortado pela paginação — o item real que sobra é bem menor do que "lista longa".

---

## 2. `#18` — pasta `web` do pdfjs copiada inteira para `static/`, incluindo o source map de ~724 KB

**CONFIRMADO** (a cópia existe), **mas a estratégia de cache já foi corrigida** — é um item misto.

`static/pdfjs/` hoje tem **3,1 MB** (`du -sh`). Arquivos acima de 100 KB:

| Arquivo | Tamanho |
|---|---|
| `static/pdfjs/build/pdf.worker.min.mjs` | 1.369.805 B (~1,3 MB) |
| `static/pdfjs/web/pdf_viewer.mjs.map` | 723.799 B (~724 KB) — confirma o número citado |
| `static/pdfjs/build/pdf.mjs` | 628.531 B (~628 KB) |
| `static/pdfjs/web/pdf_viewer.mjs` | 264.296 B (~264 KB) |
| `static/pdfjs/web/pdf_viewer.css` | 96.976 B (~97 KB, abaixo do corte mas citado abaixo) |

Requisitado de fato em runtime: **só `static/pdfjs/web/pdf_viewer.css`**, via `<link rel="stylesheet" href="/pdfjs/web/pdf_viewer.css" />` em `src/routes/leitor/+page.svelte:1382`. Todo o resto (`pdf.mjs`, `pdf.worker.min.mjs`, `pdf_viewer.mjs`, o `.map`) **não é importado da pasta `static/`** — `src/lib/utils/pdfjsLoader.js:126,138,146,205` importa via `pdfjs-dist/build/pdf.mjs?url` etc., que o Vite resolve a partir de `node_modules` e emite como asset com hash em `/_app/immutable/`, servido pelo `build` do SvelteKit — não pela pasta `static/pdfjs`.

O achado da auditoria sobre **cache do Service Worker** já foi resolvido explicitamente: `src/service-worker.js:73-92` tem um comentário e código que excluem `/pdfjs/` inteiro do pré-cache (`STATIC_SHELL = files.filter(f => !f.startsWith('/pdfjs/') ...)`), citando textualmente "são 3,1 MB de módulos legados que o app não consome mais" e recacheando manualmente só `PDFJS_VIEWER_CSS = '/pdfjs/web/pdf_viewer.css'` (linha 92-93). `src/lib/offline/sw/swRouter.js:27` também trata `/pdfjs/` como rota própria.

O que **não** mudou: o script `scripts/copy-pdfjs-viewer.mjs` (rodado no `postinstall`) continua copiando a pasta `web` inteira do pacote `pdfjs-dist` para `static/pdfjs/web`, incluindo o `.map` de 724 KB — esses arquivos entram no deploy (Cloudflare Pages serve todo `static/`) mesmo não sendo pré-cacheados pelo SW nem importados pelo app. É peso de deploy morto, não peso de cache offline.

---

## 3. `#23` — três arquivos passam de 2.000 linhas

**CONFIRMADO**, com os mesmos três arquivos (contando apenas `.svelte`/`.js` em `src/` e `static/`, excluindo `node_modules`/`.kilo`/`.svelte-kit`):

| Arquivo | Linhas |
|---|---|
| `src/routes/offline/+page.svelte` | 2.863 |
| `src/lib/stores/offline.js` | 2.828 |
| `src/routes/leitor/+page.svelte` | 2.142 |

Nenhum outro arquivo do projeto passa de 2.000 linhas.

Todo arquivo acima de 1.000 linhas (5 no total, os três acima mais):

| Arquivo | Linhas |
|---|---|
| `src/routes/listas/+page.svelte` | 1.510 |
| `src/routes/biblioteca/+page.svelte` | 1.253 |

(`src/lib/components/CarouselChips.svelte` com 997 linhas fica logo abaixo do corte.)

---

## 4. `#27` — home não distingue "digite para buscar" / "nada encontrado" / "todos os filtros desmarcados"

**CONFIRMADO.** `src/routes/+page.svelte:638-680`:

```
{#if groupedResults.length > 0}
  ... lista paginada ...
{:else if searchQuery}
  <p class="text-center mt-8 no-results-message">Nenhum resultado encontrado.</p>
{/if}
```

Só existem dois estados de UI: lista com resultados, ou "Nenhum resultado encontrado." quando há `searchQuery` mas nada bate. Quando `groupedResults.length === 0` **e** `searchQuery` é vazio (por exemplo, todos os filtros de categoria/classificação desmarcados, ou a página acabou de montar antes dos dados chegarem), o `{#if}` some sem renderizar nada — nenhuma mensagem, painel em branco. Não há distinção entre "ainda não veio nada porque não digitou" e "veio vazio porque os filtros zeraram o resultado".

---

## 5. `#28` — sem skeleton/estado de carregamento

**CONFIRMADO.** `src/routes/+page.svelte:193` faz o fetch em `onMount(async () => {...})`; não há nenhuma variável `loading`/`isLoading`/`skeleton` nem texto "Carregando" na página (grep vazio). Como `groupedResults` começa vazio e `searchQuery` também, o painel de resultados renderiza em branco (mesmo `{#if}` do item 4) até os dados chegarem — sem indicação visual de que algo está em andamento.

---

## 6. `#29` — modo offline completo atrás de sete toques no cabeçalho

**MUDOU** — o easter egg existe no código mas está **desligado** (não wireado a lugar nenhum).

`src/lib/components/OfflineGestureDetector.svelte:6-32` implementa exatamente o gesto: `TAPS_REQUIRED = 7` toques em `TIME_WINDOW = 5000` ms disparam `dispatch('gesture-detected')`.

Porém `grep -rn "OfflineGestureDetector" src` só encontra o próprio arquivo do componente — **nenhuma outra parte do app o importa ou usa**. Não existe componente de "Header"/cabeçalho no projeto (`find src -iname "*header*"` vazio) e `src/routes/+layout.svelte` não referencia o componente nem o evento `gesture-detected`.

A rota `/offline` hoje é alcançada diretamente por navegação normal: `goto('/offline')` em `src/lib/components/OfflineIndicator.svelte:97` e em `src/routes/+layout.svelte:152` — sem gesto secreto no caminho. O componente do easter egg é código órfão (histórico: único commit `8bb391c "adding new sw"` o introduziu e nunca foi ligado a nada).

---

## 7. `#30` — não há controle de brilho no leitor

**CONFIRMADO.** As únicas ocorrências de "brightness" em `src/routes/leitor/+page.svelte` (linhas 1600, 1637) e em outros componentes (`AppSnackbarToast.svelte:141`, `CarouselNavigator.svelte:144`) são `filter: brightness(1.05)`/`brightness(1.1)` de efeito hover em CSS — não um controle de brilho de leitura.

Estrutura do leitor onde um controle desse tipo entraria: `src/routes/leitor/+page.svelte:1897` tem uma `<div class="toolbar" bind:this={toolbarEl}>` com duas áreas — `toolbar-left` (marca + título) e `toolbar-controls` (linha ~1921 em diante), cujo conteúdo varia por "camada" ativa (`activeToolbarLayer`/`toolbarLayerCount`, linha 1350: `3` camadas em mobile, `1` em desktop, alternadas pelo botão `.layer-toggle` em ~2029-2040). Zoom (`zoomIn`/`zoomOut`, ~linha 832-838), toggle de modo de navegação (`toggleNavigationMode`, ~2015) e navegação entre páginas já vivem nessa área como blocos `{#if showX}` condicionais — um controle de brilho (provavelmente um slider ou toggle) se encaixaria como mais um desses blocos condicionais dentro de `toolbar-controls`, competindo por espaço com as camadas existentes em mobile.

---

## 8. `#20` — `npm run check` acusa erros

**CONFIRMADO e executado.**

```
svelte-check found 1278 errors and 52 warnings in 102 files
```

Total de diagnósticos (erros + avisos): **1330**, todos com `arquivo:linha:coluna`. Contagem por diretório de topo (`src/<lib-ou-routes>/<subpasta>`):

| Diretório | Diagnósticos |
|---|---|
| `src/lib/offline/**` | **640** |
| `src/lib/utils/**` | 252 |
| `src/lib/stores/**` | 174 |
| `src/lib/components/**` | 85 |
| `src/routes/offline/**` | 56 |
| `src/routes/listas/**` | 48 |
| `src/routes/+page.svelte` | 37 |
| `src/routes/biblioteca/**` | 18 |
| `src/routes/+layout.svelte` | 8 |
| `src/hooks.server.js` | 5 |
| `src/routes/offline-manifest.json` | 2 |
| `src/routes/louvores-manifest.json` | 2 |
| `src/lib/server/**` | 2 |
| `src/routes/louvores-manifest.sha256` | 1 |

`src/lib/offline/**` concentra quase metade de todos os diagnósticos do projeto (640 de 1330 ≈ 48%).

---

## 9. `#24` — dos 14 `*.test.js`, só 8 rodam

**MUDOU** — os números da auditoria estão desatualizados; a situação real hoje é maior nos dois lados.

`find src -name "*.test.js"` encontra **19 arquivos**, não 14:

```
src/lib/offline/download/partProgress.test.js
src/lib/offline/import/bundleValidation.test.js
src/lib/offline/import/OfflineBundleImporter.rollback.test.js
src/lib/offline/import/zipCdReader.test.js
src/lib/offline/normalization/UrlNormalizer.test.js
src/lib/offline/sw/swCaches.test.js
src/lib/offline/sw/swRouter.test.js
src/lib/offline/utils/PdfPathManager.test.js
src/lib/offline/validation/PdfValidator.test.js
src/lib/server/r2KeyMatch.test.js
src/lib/stores/louvores.checksum.test.js
src/lib/stores/louvores.versioning.test.js
src/lib/utils/groupLouvores.test.js
src/lib/utils/louvoresManifestChecksum.test.js
src/lib/utils/louvorSearch.memo.test.js
src/lib/utils/pathUtils.memo.test.js
src/lib/utils/pdfCacheIndex.test.js
src/lib/utils/swDebugMessage.test.js
src/lib/utils/validationCacheStore.test.js
```

O script `"test"` em `package.json` lista **13 arquivos** manualmente para `node --test`: `groupLouvores`, `zipCdReader`, `OfflineBundleImporter.rollback`, `bundleValidation`, `swRouter`, `swCaches`, `pdfCacheIndex`, `louvorSearch.memo`, `validationCacheStore`, `r2KeyMatch`, `pathUtils.memo`, `partProgress`, `swDebugMessage` — todos rodam e passam.

Os **6 que ficam de fora** e por quê (inspecionados diretamente):

- `src/lib/offline/normalization/UrlNormalizer.test.js` — importa `$lib/utils/pathUtils` (alias do SvelteKit), que `node --test` puro não resolve.
- `src/lib/offline/utils/PdfPathManager.test.js` — usa `describe`/`test`/`expect` como **globais soltos**, sem nenhum `import` de framework de teste no arquivo — não roda sob `node --test` nem sob nada sem um runner que injete esses globais.
- `src/lib/offline/validation/PdfValidator.test.js` — importa de `'vitest'`.
- `src/lib/stores/louvores.checksum.test.js` — importa de `'vitest'` e faz `vi.mock('$app/environment', ...)`.
- `src/lib/stores/louvores.versioning.test.js` — importa de `'vitest'` e de `$lib/utils/louvoresManifestChecksum.js`.
- `src/lib/utils/louvoresManifestChecksum.test.js` — importa de `'vitest'`.

**`vitest` não está instalado no projeto** (`grep -i vitest package.json` vazio; `node_modules/.bin/vitest` não existe) — os 4 arquivos acima que dependem dele não têm como rodar hoje de jeito nenhum, mesmo fora do `npm test`.

`npm test` executado:

```
ℹ tests 131
ℹ suites 28
ℹ pass 131
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

**131 testes, 28 suítes, 0 falhas.**

---

## 10. Paginação da biblioteca aninha `<button>` real dentro do `GestureButton`

**CONFIRMADO**, com uma nuance: o bug foi corrigido no componente compartilhado, mas **não** na cópia inline da biblioteca.

`src/routes/biblioteca/+page.svelte` tem sua própria seção de paginação inline (não usa o componente `LouvorPaginationControls`), com quatro ocorrências de `<button>` real dentro de `<GestureButton>`:

- Linhas 843-858 (botão "anterior", topo)
- Linhas 877-892 (botão "próxima", topo)
- Linhas 947-962 (botão "anterior", rodapé)
- Linhas 981-996 (botão "próxima", rodapé)

Exemplo (843-858):
```svelte
<GestureButton on:click={previousPage} on:longpress={goToFirstPage} ...>
  <button type="button" class="pagination-button" disabled={currentPage === 1} ...>
    <ChevronLeft class="w-5 h-5" />
  </button>
</GestureButton>
```

`GestureButton.svelte:389-414` renderiza um `<div class="gesture-button-wrapper">` com `<slot/>` dentro — então cada instância acima é literalmente um `<button>` HTML dentro do wrapper interativo.

Em contraste, `src/lib/components/LouvorPaginationControls.svelte:120-166` (usado pela **home**, `src/routes/+page.svelte:638-648`) já foi corrigido: usa `<div class="pagination-button">` em vez de `<button>` dentro do `GestureButton` (linhas 128-134 e 158-164). A biblioteca tem uma cópia duplicada e desatualizada dessa mesma lógica de paginação, com o defeito ainda presente.

---

## 11. `migrateLegacyValidationKeys` apaga as chaves antigas antes de gravar o registro consolidado

**CONFIRMADO.** `src/lib/utils/validationCacheStore.js:115-149`:

```js
export function migrateLegacyValidationKeys(storage) {
  ...
  const data = readAll(storage);
  for (const key of legacyKeys) {
    ...
    data.entries[pdfId] = [...];
    ...
    storage.removeItem(key);   // linha ~144 — apaga a chave legada AGORA
  }
  writeAll(storage, data);      // linha 148 — só grava o consolidado DEPOIS do loop inteiro
  return legacyKeys.length;
}
```

Cada chave legada é removida dentro do laço, uma por uma; o registro consolidado só é persistido (`writeAll`) depois que todas já foram apagadas. Se a aba fechar/crashar entre a última remoção e o `writeAll`, os dados daquelas entradas somem (nem na chave antiga, nem na nova). O teste existente (`validationCacheStore.test.js`, "migra e apaga as chaves antigas pdfValidation_*") cobre o caminho feliz, não esse cenário de interrupção.

---

## 12. `iterateZipEntriesCd` infla toda entrada antes de filtrar por nome

**CONFIRMADO.** `src/lib/offline/import/zipCdReader.js:160-172`:

```js
export async function* iterateZipEntriesCd(file, signal) {
  const { entries } = await readZipCentralDirectory(file);
  for (const entry of entries) {
    if (signal?.aborted) throw new DOMException(...);
    if (!entry.name || entry.name.endsWith('/')) continue;
    const data = await readZipEntryData(file, entry);  // inflateSync já roda aqui
    yield { name: entry.name, data };
  }
}
```

`readZipEntryData` (linha ~150, chama `inflateSync`) descomprime a entrada **antes** de ser entregue ao consumidor via `yield`. O único filtro aplicado dentro do próprio gerador é "não é diretório" — qualquer filtro por nome específico só existe do lado de quem consome. Confirmado no consumidor real, `src/lib/offline/import/OfflineBundleImporter.js:233-239`: o `for await` recebe `entry` já com `.data` inflado, e só então checa `isUnsafeZipPath`, calcula `base = zipEntryBasename(entry.name)` e descarta com `if (!base || base.startsWith('.')) continue;` — a inflação de cada entrada já aconteceu independentemente de o nome interessar ou não.

---

## 13. `isDevelopmentAsset()` — sem uso após a reescrita do roteamento

**JÁ RESOLVIDO** (resolvido por remoção total). `grep -rn "isDevelopmentAsset" .` (excluindo `node_modules`/`.kilo`) não encontra nenhuma ocorrência em lugar nenhum do repositório. `static/sw.js`, onde a função vivia, de fato não existe mais (`ls static/sw.js` → "No such file or directory"; `find . -name sw.js` não encontra nada fora de `node_modules`). A função foi removida junto com o arquivo inteiro na reescrita do service worker — não há resto dela em nenhum outro módulo.

---

## 14. Listener `statechange` registrado por `updatefound` sem remoção

**CONFIRMADO.** `src/lib/utils/swRegistration.js:80-89`:

```js
const onUpdateFound = () => {
  const newWorker = registration.installing;
  if (!newWorker) return;
  newWorker.addEventListener('statechange', () => {   // linha 82 — sem referência guardada
    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
      dispatchUpdateEvent();
    }
  });
};
registration.addEventListener('updatefound', onUpdateFound);
```

O `cleanup()` devolvido (linhas 96-101) só remove `updatefound` e `controllerchange`:
```js
cleanup: () => {
  clearInterval(updateIntervalId);
  registration.removeEventListener('updatefound', onUpdateFound);
  navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
}
```
O listener `statechange` de linha 82 é uma função anônima nunca guardada em variável — não há como removê-lo, e nada tenta.

---

## 15. `src/routes/+layout.svelte` (~115-124) captura o cleanup de forma assíncrona

**CONFIRMADO**, linhas atuais 113-141:

```js
let swCleanup = null;
let swMessageCleanup = null;

registerServiceWorker().then(({ cleanup }) => {   // linha ~118 — assíncrono
  swCleanup = cleanup;
  swMessageCleanup = setupServiceWorkerMessageListener();
  setupCacheSync();
});
...
return () => {
  removeLouvoresChecksumTriggers();
  removeStaleChunkListeners();
  cancelStaleRecoveryReset();
  swCleanup?.();          // linha ~139 — se a promise não resolveu ainda, isto é `null?.()`, um no-op
  swMessageCleanup?.();
};
```

Se o componente for destruído antes de `registerServiceWorker()` resolver, o cleanup retornado por `onMount` roda com `swCleanup` ainda `null` — os listeners de service worker registrados depois (quando a promise finalmente resolve) nunca são removidos.

---

## 16. `handleClearCache` não apaga o cache `plpc-pdfs-import-staging`

**CONFIRMADO.** `src/service-worker.js:649-660`:

```js
async function handleClearCache(event) {
  try {
    await caches.delete(PDF_CACHE);
    await caches.delete(CATALOG_CACHE);
    await caches.delete(APP_CACHE);
    ...
```

`PDF_IMPORT_STAGING_CACHE_NAME` (= `'plpc-pdfs-import-staging'`, definido em `src/lib/offline/sw/swCaches.js:21`) **não está entre os imports** de `src/service-worker.js` (linhas 18-25 só trazem `appCacheName`, `isObsoleteCacheName`, `migrateCatalogManifests`, `CATALOG_CACHE_NAME`, `CATALOG_MANIFEST_PATHS`, `PDF_CACHE_NAME`) — o cache de staging de importação de ZIP fica de fora de "Limpar tudo" no service worker.

---

## 17. `getPartPdfPaths` estreita o conjunto de verificação

**CONFIRMADO.** `src/lib/stores/offline.js:734-743`:

```js
function getPartPdfPaths(part) {
  const ids = Array.isArray(part?.pdfs) ? part.pdfs : [];
  const paths = [];
  for (const pdfId of ids) {
    if (typeof pdfId !== 'string') continue;      // descarta silenciosamente
    const relPath = getPdfRelPath({ pdfId });
    if (relPath) paths.push(relPath);              // descarta silenciosamente
  }
  return paths;
}
```

Usada por `verifyCompletedPart` (linhas 753-761) para decidir se uma parte marcada como concluída pode ser pulada de fato. Qualquer `pdfId` que não seja string, ou para o qual `getPdfRelPath` devolva um valor falso, simplesmente some do array `paths` sem erro nem aviso — o conjunto que `every()` verifica fica menor do que o declarado em `part.pdfs`, então a parte pode ser considerada "completa" com menos garantia do que parece.

---

## 18. `looksLikeCaptivePortal` só casa `text/html`

**CONFIRMADO.** `src/lib/offline/download/partProgress.js:337-344`:

```js
export function looksLikeCaptivePortal(response) {
  try {
    const contentType = response?.headers?.get?.('content-type') || '';
    return contentType.toLowerCase().includes('text/html');
  } catch {
    return false;
  }
}
```

Só reconhece `text/html`. Não cobre portais que respondem sem `content-type`, com `application/xhtml+xml`, ou por redirecionamento para outro host sem esse header específico.

---

## 19. `localStorage` cru em `src/lib/stores/offline.js` (linha pode ter mudado)

**CONFIRMADO na linha exata citada**, com uma nuance interessante: o mesmo arquivo já tem a versão corrigida ao lado, mas não aplicada aqui.

`src/lib/stores/offline.js:2285`:
```js
const isLeitorOffline = localStorage.getItem('IS_LEITOR_OFFLINE');
```
Chave como string literal solta (não usa nenhuma constante nomeada como as outras `*_KEY` do arquivo), sem guarda de `browser`, sem `try/catch`.

O arquivo já tem `safeStorage()` (linhas 600-606), um wrapper feito exatamente para isso ("`localStorage.setItem` desprotegido... faz o Firefox com dados do site bloqueados lançar ali", comentário nas linhas 612-615) — e uma outra leitura da **mesma chave** já usa esse wrapper, em `src/lib/stores/offline.js:2143`:
```js
const isLeitorOffline = safeStorage()?.getItem('IS_LEITOR_OFFLINE');
```
Ou seja: a correção existe no arquivo, mas não foi aplicada de forma consistente — a leitura da linha 2285 continua exposta.

---

## 20. `npm run check:offline` citado na verificação final do plano, mas não existe como script

**CONFIRMADO.** `package.json` (seção `"scripts"`) lista: `prepare`, `postinstall`, `dev`, `dev:cloudflare`, `build`, `preview`, `check`, `check:watch`, `deploy`, `generate-icons`, `generate-offline-packages`, `build-offline-bundle`, `test`, `test:offline-bundle`. Não há `check:offline` em lugar nenhum do arquivo (`grep -n "check:offline" package.json` não encontra nada).
