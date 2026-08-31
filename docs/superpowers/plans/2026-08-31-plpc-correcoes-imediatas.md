# PLPC — Correções Imediatas (faixa "Recomendado já") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os oito achados marcados "Recomendado já" na auditoria — três defeitos de produção (telemetria vazada, roteamento do service worker, precache errado do PDF.js) e cinco gargalos de CPU/memória no caminho crítico do modo offline.

**Architecture:** Cada tarefa é isolada e reversível. A ordem é deliberada: primeiro as remoções e o roteamento do SW (que reativam código já escrito e hoje morto), depois um módulo puro novo (`pdfCacheIndex.js`) que substitui três implementações duplicadas de correspondência de caminho, depois as mudanças de memória e por fim a acessibilidade. Nenhuma tarefa altera a normalização canônica de caminho — essa unificação é o achado #22 e tem plano próprio.

**Tech Stack:** SvelteKit 2 / Svelte 4, Vite 5, Tailwind 3, fflate, pdfjs-dist 4.8.69, Cloudflare Pages + R2, `node --test` (test runner nativo do Node, sem vitest).

**Spec:** Auditoria Técnica PLPC — https://claude.ai/code/artifact/a4e1959b-9b0f-48ce-8163-6c94af4390e3 (achados #19, #01, #03, #11, #05, #12, #13, #26)

## Global Constraints

- **Runtime de teste:** `node --test`. Não introduzir vitest, jest ou qualquer runner novo.
- **Imports em arquivos testáveis:** módulos cobertos por teste só podem importar por caminho relativo (`./x.js`). O alias `$lib` **não** resolve sob `node --test`. Nenhum teste existente usa `$lib` — manter assim.
- **Service Worker:** `static/sw.js` e seus auxiliares são scripts simples carregados por `importScripts`. Não usar `import`/`export` neles. O padrão de exportação estabelecido é o do fim de `static/sw-utils.js`: `if (typeof self !== 'undefined') { self.fn = fn; }`.
- **Nada em `static/` pode ser arquivo de teste** — o diretório inteiro vai para o deploy do Cloudflare Pages.
- **Idioma:** comentários e mensagens de UI em português (pt-BR), como no restante do código.
- **Commits:** um commit por tarefa, prefixo Conventional Commits (`fix:`, `perf:`, `refactor:`, `test:`).
- **Verificação a cada tarefa:** `npm run test:offline-bundle` deve continuar passando (12 testes, 3 suítes). `npm run build` deve concluir.
- **Não corrigir de passagem:** `npm run check` acusa 1.154 erros pré-existentes. Não é escopo deste plano (é o achado #20). Não tentar zerar.

---

### Task 1: Remover a telemetria de depuração apontada para 127.0.0.1 (#19)

Dez blocos `// #region agent log` em `src/routes/+page.svelte` disparam `fetch` para `http://127.0.0.1:7440/ingest/…` a cada paginação, filtro, blur da busca e sincronização de URL. Em produção sobre HTTPS cada um é uma requisição bloqueada por mixed content, com a URL completa da sessão no payload.

**Files:**
- Modify: `src/routes/+page.svelte` — blocos nas linhas 71-73, 78-80, 108-110, 117-119, 202-204, 359-361, 364-366, 403-405, 521-523, 581-583

**Interfaces:**
- Consumes: nada.
- Produces: nada. Remoção pura — nenhuma outra tarefa depende dela, mas ela vai primeiro porque é a de menor risco e maior urgência.

- [ ] **Step 1: Confirmar o estado atual antes de mexer**

```bash
grep -c "127.0.0.1:7440" src/routes/+page.svelte
grep -c "#region agent log" src/routes/+page.svelte
```

Esperado: `10` nas duas linhas. Se der outro número, os blocos mudaram de lugar — localize com `grep -n "#region agent log" src/routes/+page.svelte` e ajuste o passo seguinte.

- [ ] **Step 2: Remover os dez blocos**

Cada bloco tem exatamente três linhas e o mesmo formato:

```js
      // #region agent log
      fetch('http://127.0.0.1:7440/ingest/a9d50c94-866c-49ac-b737-468ccc2df6c6',{method:'POST',/* … */}).catch(()=>{});
      // #endregion
```

Remova as três linhas de cada um dos dez blocos. Nada mais na função muda — os blocos são efeito colateral puro, nenhuma variável declarada dentro deles é usada fora.

**Atenção a um caso:** o bloco das linhas 108-110 fica dentro de `setPage`, entre a atribuição de `isUpdatingPageFromUrl = true` e `lastKnownHomeUrl = ...`. Remover só as três linhas do bloco; as atribuições ao redor permanecem.

- [ ] **Step 3: Verificar que não sobrou nada**

```bash
grep -rn "127.0.0.1\|#region agent log\|#endregion\|X-Debug-Session-Id\|hypothesisId" src/ static/
```

Esperado: nenhuma saída.

- [ ] **Step 4: Confirmar que a página ainda compila**

```bash
npm run build
```

Esperado: build conclui sem erro. (Ignore avisos de `svelte-check` — este comando não roda checagem de tipos.)

- [ ] **Step 5: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "fix: remove debug telemetry pointed at 127.0.0.1 from home page"
```

---

### Task 2: Corrigir o roteamento do fetch handler do service worker (#01)

`APP_SHELL` contém `'/'` e o teste do branch é `url.pathname.startsWith(path)`, então todo caminho same-origin casa. O `if` da linha 400 captura tudo que não é navegação/PDF/PDF.js e responde cache-first — deixando morto o tratamento de `/louvores-manifest.sha256` (linha 435), de `/packages/*.zip` (449) e dos chunks `/_app/immutable/` (488).

A correção extrai a decisão de rota para um módulo puro e testável, e converte a cadeia de `if` numa dispatch única. Isso corrige o defeito **e** remove o formato que o produziu.

**Files:**
- Create: `static/sw-router.js`
- Create: `src/lib/offline/sw/swRouter.test.js`
- Modify: `static/sw.js:6` (importScripts), `static/sw.js:55-67` (APP_SHELL), `static/sw.js:157-570` (fetch handler)
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `matchSwRoute(pathname: string, ctx: { isNavigation?: boolean }): SwRoute` onde
    `SwRoute = 'navigation' | 'pdfjs' | 'pdf' | 'checksum' | 'package-zip' | 'hashed-asset' | 'app-shell' | 'default'`
  - `SW_APP_SHELL_PATHS: string[]`
  - Ambos publicados em `self` por `static/sw-router.js` e consumidos por `static/sw.js`.
  - A Task 3 modifica `PDFJS_MODULES` no mesmo arquivo; faça a Task 2 antes.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/offline/sw/swRouter.test.js`. O módulo sob teste é um script simples (sem `export`), então o teste o avalia num contexto de `node:vm` — mesmo padrão que o SW usa via `importScripts`.

```js
/**
 * Teste de roteamento do Service Worker.
 * Run: node --test src/lib/offline/sw/swRouter.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(here, '../../../../static/sw-router.js'), 'utf8');
const sandbox = { self: {} };
runInContext(source, createContext(sandbox));

/** @type {(pathname: string, ctx?: object) => string} */
const matchSwRoute = sandbox.self.matchSwRoute;

describe('matchSwRoute', () => {
  it('trata navegação antes de qualquer outra regra', () => {
    assert.equal(matchSwRoute('/leitor', { isNavigation: true }), 'navigation');
    assert.equal(matchSwRoute('/assets/x/Cifra.pdf', { isNavigation: true }), 'navigation');
  });

  it('roteia PDF.js e PDFs', () => {
    assert.equal(matchSwRoute('/pdfjs/web/pdf_viewer.css', {}), 'pdfjs');
    assert.equal(matchSwRoute('/assets/ColAdultos/001.pdf', {}), 'pdf');
  });

  it('não trata bundles do SvelteKit como PDF', () => {
    assert.equal(matchSwRoute('/_app/immutable/chunks/a.pdf.js', {}), 'hashed-asset');
  });

  it('nunca serve o checksum pelo app shell', () => {
    assert.equal(matchSwRoute('/louvores-manifest.sha256', {}), 'checksum');
  });

  it('nunca serve pacotes ZIP pelo app shell', () => {
    assert.equal(matchSwRoute('/packages/Cifra-1.zip', {}), 'package-zip');
  });

  it('roteia assets versionados do SvelteKit', () => {
    assert.equal(matchSwRoute('/_app/immutable/entry/start.abc123.js', {}), 'hashed-asset');
    assert.equal(matchSwRoute('/_app/version.json', {}), 'hashed-asset');
    assert.equal(matchSwRoute('/_app/env.js', {}), 'hashed-asset');
  });

  it('app shell casa por igualdade exata, nunca por prefixo', () => {
    assert.equal(matchSwRoute('/', {}), 'app-shell');
    assert.equal(matchSwRoute('/manifest.json', {}), 'app-shell');
    assert.equal(matchSwRoute('/louvores-manifest.json', {}), 'app-shell');
    // Este é o defeito #01: com startsWith('/'), tudo abaixo virava 'app-shell'.
    assert.equal(matchSwRoute('/qualquer/coisa', {}), 'default');
    assert.equal(matchSwRoute('/manifest.json.bak', {}), 'default');
  });

  it('tudo que não casa cai no padrão', () => {
    assert.equal(matchSwRoute('/sobre/imagem.png', {}), 'default');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
node --test src/lib/offline/sw/swRouter.test.js
```

Esperado: FAIL — `ENOENT: no such file or directory, open '.../static/sw-router.js'`.

- [ ] **Step 3: Escrever o módulo de roteamento**

Criar `static/sw-router.js`:

```js
/**
 * Roteamento do fetch handler do Service Worker.
 *
 * Script simples, sem ES modules — carregado por importScripts, igual a sw-utils.js.
 * A ordem das regras é significativa e é a única definição dela no projeto:
 * a primeira que casar vence.
 */

const SW_APP_SHELL_PATHS = [
  '/',
  '/manifest.json',
  '/louvores-manifest.json',
  '/offline-manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png'
];

/**
 * @param {string} pathname
 * @param {{ isNavigation?: boolean }} [ctx]
 * @returns {'navigation'|'pdfjs'|'pdf'|'checksum'|'package-zip'|'hashed-asset'|'app-shell'|'default'}
 */
function matchSwRoute(pathname, ctx) {
  if (ctx && ctx.isNavigation) return 'navigation';

  if (pathname.indexOf('/pdfjs/') !== -1) return 'pdfjs';

  if (
    pathname.endsWith('.pdf') &&
    pathname.indexOf('/_app/') === -1 &&
    pathname.indexOf('/node_modules/') === -1
  ) {
    return 'pdf';
  }

  if (pathname === '/louvores-manifest.sha256') return 'checksum';

  if (pathname.startsWith('/packages/') && pathname.endsWith('.zip')) return 'package-zip';

  if (
    pathname.startsWith('/_app/immutable/') ||
    pathname === '/_app/version.json' ||
    pathname === '/_app/env.js'
  ) {
    return 'hashed-asset';
  }

  // Igualdade exata. Usar startsWith aqui fazia '/' casar com tudo (defeito #01).
  if (SW_APP_SHELL_PATHS.indexOf(pathname) !== -1) return 'app-shell';

  return 'default';
}

// Exporta no escopo global do Service Worker (mesmo padrão de sw-utils.js).
if (typeof self !== 'undefined') {
  self.matchSwRoute = matchSwRoute;
  self.SW_APP_SHELL_PATHS = SW_APP_SHELL_PATHS;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
node --test src/lib/offline/sw/swRouter.test.js
```

Esperado: PASS — 8 testes.

- [ ] **Step 5: Carregar o roteador no service worker**

Em `static/sw.js`, linha 6, trocar:

```js
importScripts('/sw-utils.js');
```

por:

```js
importScripts('/sw-utils.js', '/sw-router.js');
```

E nas linhas 55-67, trocar a declaração local de `APP_SHELL` para reusar a lista do roteador (fonte única):

```js
// Definido em /sw-router.js — importScripts publica em self.
const APP_SHELL = self.SW_APP_SHELL_PATHS;
const APP_SHELL_INSTALL = APP_SHELL.filter((path) => path !== '/louvores-manifest.json');
```

- [ ] **Step 6: Converter a cadeia de `if` em dispatch por rota**

No handler de `fetch` (`static/sw.js:157`), logo após o guarda de origem cruzada, substituir toda a cadeia de `if` por uma dispatch única. Mantenha **o corpo de cada branch exatamente como está hoje** — mova, não reescreva. O objetivo desta tarefa é só a decisão de rota.

```js
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;

  const isNavigationRequest = event.request.mode === 'navigate';
  const route = matchSwRoute(url.pathname, { isNavigation: isNavigationRequest });

  switch (route) {
    case 'pdfjs':
      event.respondWith(handlePdfJs(event, url));
      return;
    case 'pdf':
      event.respondWith(handlePdf(event, url));
      return;
    case 'navigation':
      event.respondWith(handleNavigation(event, url));
      return;
    case 'checksum':
      event.respondWith(handleChecksum(event));
      return;
    case 'package-zip':
      event.respondWith(handlePackageZip(event, url));
      return;
    case 'hashed-asset':
      // Em dev os assets do Vite mudam a cada recarga: rede sempre.
      event.respondWith(IS_DEV ? handleDefault(event, url) : handleHashedAsset(event));
      return;
    case 'app-shell':
      event.respondWith(handleAppShell(event));
      return;
    default:
      event.respondWith(handleDefault(event, url));
      return;
  }
});
```

Extraia cada corpo existente para uma função `async` de mesmo nome, no escopo de módulo do SW, abaixo do handler. Exemplo do menor deles, para fixar o formato:

```js
/** Checksum precisa ser sempre fresco — nunca entra em cache. */
async function handleChecksum(event) {
  return fetch(event.request.clone(), { cache: 'no-store' });
}
```

Os demais (`handlePdfJs`, `handlePdf`, `handleNavigation`, `handlePackageZip`, `handleHashedAsset`, `handleAppShell`, `handleDefault`) recebem o conteúdo que já está hoje dentro de cada `event.respondWith(...)`, convertido de cadeia `.then/.catch` para `async/await` só onde for mecânico. `handleDefault` recebe o corpo do último bloco (cache-first em produção, network-first em dev).

- [ ] **Step 7: Subir a versão do cache**

Em `static/sw.js:11`, incrementar para forçar o `activate` a limpar os caches escritos pelo roteamento defeituoso:

```js
const CACHE_VERSION = 'plpc-v5';
```

- [ ] **Step 8: Verificar o comportamento no navegador**

```bash
npm run build && npm run preview
```

Em DevTools → Application → Service Workers, marque "Update on reload" e recarregue. Depois, na aba Network, confirme:

| Requisição | Esperado |
|---|---|
| `/louvores-manifest.sha256` | vai à rede toda vez, nunca "(ServiceWorker)" a partir de cache |
| `/_app/immutable/...` | rede primeiro; some do cache velho após novo deploy |
| `/packages/*.zip` (durante download offline) | rede, e **não** aparece em Application → Cache Storage → `plpc-v5-app` |
| `/` e `/manifest.json` | servidos do cache |

- [ ] **Step 9: Adicionar um script `test` que roda a suíte inteira**

Em `package.json`, trocar o script `test:offline-bundle` por um `test` abrangente (mantendo o antigo como alias, para não quebrar quem já o usa):

```json
"test": "node --test 'src/**/*.test.js'",
"test:offline-bundle": "node --test src/lib/offline/import/bundleValidation.test.js src/lib/offline/import/OfflineBundleImporter.rollback.test.js src/lib/offline/import/zipCdReader.test.js"
```

- [ ] **Step 10: Rodar tudo**

```bash
npm test
```

Esperado: PASS, incluindo os 12 testes pré-existentes e os 8 novos.

- [ ] **Step 11: Commit**

```bash
git add static/sw-router.js static/sw.js src/lib/offline/sw/swRouter.test.js package.json
git commit -m "fix(sw): route by exact match so checksum, ZIP and hashed-asset handling stop being dead code"
```

---

### Task 3: Corrigir o precache do PDF.js (#03)

O SW baixa 2,26 MB no `install` (`pdf.mjs` 628 KB, `pdf.worker.min.mjs` 1,37 MB, `pdf_viewer.mjs` 264 KB) de `/pdfjs/`, mas o runtime importa o PDF.js pelo Vite, que resolve para `/_app/immutable/…`. A única coisa realmente servida de `/pdfjs/` é `pdf_viewer.css`. Resultado: 2,26 MB de dados móveis desperdiçados por instalação, **e** o PDF.js de verdade sem garantia offline.

A correção definitiva (precache a partir do manifesto de build) é o achado #04, no plano da faixa seguinte. Aqui removemos o desperdício e garantimos que os módulos reais entrem no cache de forma explícita.

**Files:**
- Modify: `static/sw.js:66-72` (`PDFJS_MODULES`)
- Modify: `src/lib/utils/pdfjsLoader.js` (nova função `warmPdfJsCache`)
- Modify: `src/routes/+layout.svelte` (chamar a nova função no preload de prioridade média)

**Interfaces:**
- Consumes: `matchSwRoute` da Task 2 já roteia `/pdfjs/*` como `'pdfjs'` e `/_app/immutable/*` como `'hashed-asset'` — é essa segunda rota, reativada pela Task 2, que faz o aquecimento abaixo funcionar. **Task 2 é pré-requisito.**
- Produces: `warmPdfJsCache(): Promise<void>` exportada de `src/lib/utils/pdfjsLoader.js`.

- [ ] **Step 1: Confirmar que os módulos pré-cacheados não são os usados**

```bash
grep -rn "'/pdfjs\|\"/pdfjs\|/pdfjs/" src/ --include="*.svelte" --include="*.js" --include="*.ts"
```

Esperado: uma única linha — `src/routes/leitor/+page.svelte:1382`, a folha de estilo. Nenhuma referência a `/pdfjs/build/` ou `/pdfjs/web/pdf_viewer.mjs`.

- [ ] **Step 2: Reduzir o precache ao que é realmente servido de /pdfjs/**

Em `static/sw.js:66-72`:

```js
// Só a folha de estilo do viewer é servida de /pdfjs/ (leitor/+page.svelte:1382).
// O core, o worker e o viewer são importados pelo Vite e chegam como /_app/immutable/*,
// aquecidos pelo cliente em warmPdfJsCache() — ver src/lib/utils/pdfjsLoader.js.
const PDFJS_MODULES = [
  '/pdfjs/web/pdf_viewer.css'
];
```

- [ ] **Step 3: Adicionar o aquecimento explícito do PDF.js real**

Em `src/lib/utils/pdfjsLoader.js`, ao fim do arquivo (antes do `export { requestIdleCallback }`):

```js
/**
 * Garante que core, worker e viewer do PDF.js entrem no cache do Service Worker
 * mesmo que o usuário nunca abra /leitor com rede.
 *
 * As URLs são resolvidas pelo Vite (/_app/immutable/...), então não podem ser
 * pré-cacheadas por uma lista fixa no sw.js — daí o aquecimento no cliente.
 *
 * Silencioso por design: falhar aqui nunca deve quebrar navegação.
 * @returns {Promise<void>}
 */
export async function warmPdfJsCache() {
  if (typeof window === 'undefined') return;

  try {
    const [coreUrlMod, workerUrlMod, viewerUrlMod] = await Promise.all([
      import('pdfjs-dist/build/pdf.mjs?url'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      import('pdfjs-dist/web/pdf_viewer.mjs?url')
    ]);

    const urls = [coreUrlMod.default, workerUrlMod.default, viewerUrlMod.default, '/pdfjs/web/pdf_viewer.css'];

    await Promise.allSettled(
      urls.filter(Boolean).map((url) => fetch(url, { cache: 'force-cache' }))
    );

    console.info('[PDF.js Loader] Cache aquecido para uso offline');
  } catch (error) {
    console.warn('[PDF.js Loader] Falha ao aquecer cache do PDF.js:', error);
  }
}
```

- [ ] **Step 4: Chamar o aquecimento junto do preload de prioridade média**

Em `src/routes/+layout.svelte`, no import do topo, acrescentar `warmPdfJsCache`:

```js
  import {
    getPdfJsPriority,
    shouldPreload,
    preloadPdfJs,
    warmPdfJsCache,
    requestIdleCallback
  } from '$lib/utils/pdfjsLoader';
```

E no ramo `priority === 'medium'` de `smartPreloadPdfJs`, encadear o aquecimento após o preload:

```js
    } else if (priority === 'medium') {
      // Carregar após recursos críticos (requestIdleCallback)
      requestIdleCallback(() => {
        preloadPdfJs({ priority: 'medium', loadViewer: false })
          .then(() => warmPdfJsCache())
          .catch(err => {
            console.warn('[Layout] Erro ao pré-carregar PDF.js:', err);
          });
      }, { timeout: 2000 });
    }
```

- [ ] **Step 5: Verificar no navegador**

```bash
npm run build && npm run preview
```

1. Abra a home com o cache limpo (DevTools → Application → Clear site data).
2. Na aba Network, filtre por `pdfjs`. Confirme que **não** há requisição a `/pdfjs/build/pdf.mjs` nem a `/pdfjs/build/pdf.worker.min.mjs` na instalação do SW.
3. Espere alguns segundos na home. Em Application → Cache Storage → `plpc-v5-app`, confirme que aparecem entradas `/_app/immutable/...` correspondentes ao core e ao worker do PDF.js.
4. Vá offline (DevTools → Network → Offline) e abra um louvor no leitor. O PDF deve renderizar.

- [ ] **Step 6: Commit**

```bash
git add static/sw.js src/lib/utils/pdfjsLoader.js src/routes/+layout.svelte
git commit -m "perf(sw): stop precaching 2.3MB of unused PDF.js and warm the real modules instead"
```

---

### Task 4: Substituir as três buscas O(n²) por um índice consultável em O(1) (#11)

O mesmo antipadrão aparece em quatro lugares: uma "Estratégia 3" que faz `Array.from(set).some(...)` **dentro** do laço principal. Com 4.629 louvores e um cache de tamanho comparável são dezenas de milhões de comparações de string por chamada, mais uma alocação de array de milhares de elementos por iteração.

A observação que permite eliminar a estratégia inteira: as condições `cached.endsWith(expected)` e `expected.endsWith(cached)` só podem ser verdadeiras, para caminhos que terminam em nome de arquivo, quando os nomes de arquivo são iguais — caso já coberto pela comparação por basename. Um `Set` de basenames é portanto um superconjunto estrito da Estratégia 3, e custa O(1).

**Files:**
- Create: `src/lib/utils/pdfCacheIndex.js`
- Create: `src/lib/utils/pdfCacheIndex.test.js`
- Modify: `src/lib/utils/pdfValidation.js:336-450` (`findMissingPdfs`)
- Modify: `src/lib/utils/pdfIndex.js:47-135` (`generatePdfIndex`)

**Interfaces:**
- Consumes: `decodeUrlUtf8Multiple` de `./urlEncoding.js` (import relativo, já existente).
- Produces:
  - `toComparablePath(url: string): string`
  - `basenameOf(path: string): string`
  - `buildPdfCacheIndex(cachedUrls: string[], options?: { normalize?: (p: string) => string }): { size: number, has(candidate: string): boolean }`
  - A Task 5 consome `buildPdfCacheIndex` no laço de download.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/utils/pdfCacheIndex.test.js`:

```js
/**
 * Índice de PDFs em cache. Run: node --test src/lib/utils/pdfCacheIndex.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toComparablePath, basenameOf, buildPdfCacheIndex } from './pdfCacheIndex.js';

describe('toComparablePath', () => {
  it('extrai o pathname de uma URL completa e remove a barra inicial', () => {
    assert.equal(
      toComparablePath('https://plpcg.com/assets/ColAdultos/001.pdf'),
      'assets/ColAdultos/001.pdf'
    );
  });

  it('aceita caminho relativo direto', () => {
    assert.equal(toComparablePath('assets/ColAdultos/001.pdf'), 'assets/ColAdultos/001.pdf');
    assert.equal(toComparablePath('/assets/ColAdultos/001.pdf'), 'assets/ColAdultos/001.pdf');
  });

  it('decodifica acentos, inclusive em dupla codificação', () => {
    assert.equal(
      toComparablePath('https://plpcg.com/assets/Cole%C3%A2nea/Cifra.pdf'),
      'assets/Coleânea/Cifra.pdf'
    );
    assert.equal(
      toComparablePath('/assets/Cole%25C3%25A2nea/Cifra.pdf'),
      'assets/Coleânea/Cifra.pdf'
    );
  });

  it('devolve string vazia para entrada inútil', () => {
    assert.equal(toComparablePath(''), '');
    assert.equal(toComparablePath(null), '');
    assert.equal(toComparablePath('/'), '');
  });
});

describe('basenameOf', () => {
  it('devolve o último segmento', () => {
    assert.equal(basenameOf('assets/ColAdultos/001.pdf'), '001.pdf');
    assert.equal(basenameOf('001.pdf'), '001.pdf');
  });
});

describe('buildPdfCacheIndex', () => {
  const cached = [
    'https://plpcg.com/assets/ColAdultos/001.pdf',
    'https://plpcg.com/assets/PES%20CIAs/Conhe%C3%A7amos/Cifra.pdf'
  ];

  it('acerta por caminho exato', () => {
    const index = buildPdfCacheIndex(cached);
    assert.equal(index.has('assets/ColAdultos/001.pdf'), true);
    assert.equal(index.has('/assets/ColAdultos/001.pdf'), true);
  });

  it('acerta por nome de arquivo quando o diretório difere', () => {
    const index = buildPdfCacheIndex(cached);
    assert.equal(index.has('assets/OutraPasta/001.pdf'), true);
  });

  it('acerta com acento após decodificação', () => {
    const index = buildPdfCacheIndex(cached);
    assert.equal(index.has('assets/PES CIAs/Conheçamos/Cifra.pdf'), true);
  });

  it('erra o que não está em cache', () => {
    const index = buildPdfCacheIndex(cached);
    assert.equal(index.has('assets/ColAdultos/999.pdf'), false);
    assert.equal(index.has(''), false);
  });

  it('aceita lista vazia ou inválida sem lançar', () => {
    assert.equal(buildPdfCacheIndex([]).has('assets/x.pdf'), false);
    assert.equal(buildPdfCacheIndex(null).size, 0);
  });

  it('aplica a normalização opcional na indexação e na consulta', () => {
    const lower = (p) => p.toLowerCase();
    const index = buildPdfCacheIndex(['/assets/ColAdultos/001.pdf'], { normalize: lower });
    assert.equal(index.has('assets/coladultos/001.pdf'), true);
  });

  it('substitui a antiga Estratégia 3: sufixo com mesmo nome de arquivo', () => {
    // cached tem prefixo extra; a comparação por basename cobre o caso.
    const index = buildPdfCacheIndex(['/prefixo/extra/assets/ColAdultos/001.pdf']);
    assert.equal(index.has('assets/ColAdultos/001.pdf'), true);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
node --test src/lib/utils/pdfCacheIndex.test.js
```

Esperado: FAIL — `Cannot find module '.../pdfCacheIndex.js'`.

- [ ] **Step 3: Escrever o módulo**

Criar `src/lib/utils/pdfCacheIndex.js`:

```js
/**
 * Índice de PDFs em cache.
 *
 * Substitui as três cópias da "Estratégia 3" (Array.from(set).some(...) dentro do
 * laço principal) por duas consultas O(1). O Set de nomes de arquivo é um
 * superconjunto estrito daquela estratégia: para caminhos que terminam em nome de
 * arquivo, `a.endsWith(b)` implica basename(a) === basename(b).
 *
 * Só importa por caminho relativo — precisa rodar sob `node --test`.
 */

import { decodeUrlUtf8Multiple } from './urlEncoding.js';

/**
 * Converte URL completa ou caminho em uma forma comparável:
 * sem origem, sem barra inicial, com percent-encoding desfeito.
 * @param {string} url
 * @returns {string}
 */
export function toComparablePath(url) {
  if (!url || typeof url !== 'string') return '';

  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    const match = url.match(/https?:\/\/[^/]+(\/.*)/);
    if (match) pathname = match[1];
  }

  pathname = pathname.replace(/^\/+/, '');
  if (!pathname) return '';

  try {
    return decodeUrlUtf8Multiple(pathname, 3);
  } catch {
    return pathname;
  }
}

/**
 * @param {string} path
 * @returns {string}
 */
export function basenameOf(path) {
  if (!path) return '';
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

/**
 * @typedef {{ size: number, has: (candidate: string) => boolean }} PdfCacheIndex
 */

/**
 * @param {string[] | null | undefined} cachedUrls
 * @param {{ normalize?: (path: string) => string }} [options]
 * @returns {PdfCacheIndex}
 */
export function buildPdfCacheIndex(cachedUrls, options = {}) {
  const normalize =
    typeof options.normalize === 'function' ? options.normalize : (/** @type {string} */ p) => p;

  /** @type {Set<string>} */
  const byPath = new Set();
  /** @type {Set<string>} */
  const byBasename = new Set();

  const list = Array.isArray(cachedUrls) ? cachedUrls : [];

  for (const url of list) {
    const path = normalize(toComparablePath(url));
    if (!path) continue;
    byPath.add(path);
    const base = basenameOf(path);
    if (base) byBasename.add(base);
  }

  return {
    size: byPath.size,
    has(candidate) {
      const path = normalize(toComparablePath(candidate));
      if (!path) return false;
      if (byPath.has(path)) return true;
      const base = basenameOf(path);
      return base ? byBasename.has(base) : false;
    }
  };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
node --test src/lib/utils/pdfCacheIndex.test.js
```

Esperado: PASS — 12 testes.

- [ ] **Step 5: Substituir o corpo de `findMissingPdfs`**

Em `src/lib/utils/pdfValidation.js`, acrescentar ao topo o import:

```js
import { buildPdfCacheIndex } from './pdfCacheIndex.js';
```

E substituir tudo entre a linha 336 (`// Prepare cached PDFs for comparison`) e o fim do laço `for (const louvor of louvores)` por:

```js
  const cacheIndex = buildPdfCacheIndex(cachedPdfs);

  const missing = [];

  for (const louvor of louvores) {
    if (!louvor.pdfId) continue;

    const pdfPath = getPdfRelPath(louvor);
    if (!pdfPath) continue;

    if (!cacheIndex.has(pdfPath)) {
      missing.push(louvor);
    }
  }

  if (missing.length > 0) {
    const cacheKey = `missing_${missing.length}_${louvores.length}`;
    if (findMissingPdfs._lastLog !== cacheKey) {
      findMissingPdfs._lastLog = cacheKey;
      console.warn(`[PDF Validation] ${missing.length} PDFs ausentes de ${louvores.length} louvores`);
    }
  }

  return missing;
```

Isso remove também o array `debugInfo`, que colecionava amostras só para o `console.warn`.

- [ ] **Step 6: Substituir o corpo de `generatePdfIndex`**

Em `src/lib/utils/pdfIndex.js`, acrescentar o import:

```js
import { buildPdfCacheIndex } from './pdfCacheIndex.js';
```

Substituir a construção de `normalizedCacheSet` (linhas ~47-70) por:

```js
    const cachedPdfs = await getCachedPDFsFast();

    // Mesma normalização de antes (minúsculas + sem acento), agora aplicada
    // uma vez na indexação e uma vez na consulta.
    const cacheIndex = buildPdfCacheIndex(cachedPdfs, {
      normalize: (path) => urlNormalizer.normalizePdfUrl(path)
    });
```

E substituir o corpo de `processChunk` (as três estratégias, linhas ~80-135) por:

```js
    const processChunk = (chunk) => {
      for (const louvor of chunk) {
        if (!louvor.pdfId) continue;

        const pdfPath = getPdfRelPath(louvor);
        if (!pdfPath) {
          index.set(louvor.pdfId, false);
          continue;
        }

        index.set(louvor.pdfId, cacheIndex.has(pdfPath));
      }
    };
```

- [ ] **Step 7: Medir o ganho**

```bash
npm run build && npm run preview
```

Na página `/offline`, com o console aberto, cronometre o cálculo de estatísticas antes e depois:

```js
// Cole no console, na página /offline
const t = performance.now();
await window.__plpcDebugRecalcStats?.();
console.log('ms:', performance.now() - t);
```

Se o gancho de debug não existir, use o perfil da aba Performance: grave a abertura de `/offline` e confirme que `findMissingPdfs` e `generatePdfIndex` saíram do topo do gráfico de chamadas. O esperado é sair da ordem de segundos para dezenas de milissegundos.

- [ ] **Step 8: Rodar a suíte inteira**

```bash
npm test
```

Esperado: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/utils/pdfCacheIndex.js src/lib/utils/pdfCacheIndex.test.js src/lib/utils/pdfValidation.js src/lib/utils/pdfIndex.js
git commit -m "perf: replace O(n^2) cached-PDF matching with an O(1) index"
```

---

### Task 5: Extrair os pacotes ZIP por entrada, sem carregar 30 MB em memória (#05)

`startZipDownloadWithSpecificParts` (linha 578) e `startZipDownload` (linha 1509) fazem `await response.arrayBuffer()` sobre um pacote de ~30 MB e entregam o buffer inteiro ao `unzip` do fflate, que devolve **todas** as entradas descomprimidas de uma vez. Pico de várias centenas de MB por parte, num fluxo de até 17 partes — a causa mais provável de a aba ser descartada no Safari do iOS no meio do download.

O leitor por central directory já existe e já é testado: `src/lib/offline/import/zipCdReader.js`, com `iterateZipEntriesCd(blob, signal)`. Esta tarefa passa os dois caminhos de download a usá-lo, e de quebra elimina as duas cópias restantes do O(n²) (linhas 684-701 e 1630-1647).

**Files:**
- Modify: `src/lib/stores/offline.js:578-840` (`startZipDownloadWithSpecificParts`)
- Modify: `src/lib/stores/offline.js:1509-1800` (`startZipDownload`)
- Modify: `src/lib/stores/offline.js:839-853` (remover `unzipEntries`)
- Modify: `src/lib/stores/offline.js` (imports do topo)

**Interfaces:**
- Consumes: `iterateZipEntriesCd(file: Blob, signal?: AbortSignal): AsyncGenerator<{ name: string, data: Uint8Array }>` de `$lib/offline/import/zipCdReader.js`; `buildPdfCacheIndex` da Task 4.
- Produces: nada de novo. **Task 4 é pré-requisito** (o índice substitui o `Array.from(...).some(...)` nos dois laços).

- [ ] **Step 1: Confirmar as duas cópias do laço**

```bash
grep -n "response.arrayBuffer()\|unzipEntries(\|Array.from(pdfSetOriginal)\|Array.from(remainingSet)" src/lib/stores/offline.js
```

Esperado: seis linhas — duas de cada padrão, uma por função. As duas funções recebem o mesmo tratamento.

- [ ] **Step 2: Ajustar os imports**

No topo de `src/lib/stores/offline.js`, remover `unzip` do import do fflate (verifique se `unzip` não é usado em outro ponto do arquivo antes de remover) e acrescentar:

```js
import { iterateZipEntriesCd } from '$lib/offline/import/zipCdReader.js';
import { buildPdfCacheIndex } from '$lib/utils/pdfCacheIndex.js';
```

- [ ] **Step 3: Trocar o conjunto de comparação pelo índice, nas duas funções**

Em `startZipDownloadWithSpecificParts`, substituir as linhas 600-605:

```js
  const pdfSet = new Set(pdfUrls.map(prepareForComparison));
  const pdfSetOriginal = new Set(pdfUrls);
  const remainingSet = new Set(pdfUrls.map(prepareForComparison));
```

por:

```js
  // Índice O(1) dos PDFs desejados; `remaining` controla o que ainda falta gravar.
  const wantedIndex = buildPdfCacheIndex(pdfUrls);
  const remaining = new Set(pdfUrls.map(prepareForComparison));
```

Aplicar exatamente a mesma substituição nas linhas 1533-1535, dentro de `startZipDownload`.

- [ ] **Step 4: Trocar a leitura do ZIP por iteração em streaming, nas duas funções**

Em `startZipDownloadWithSpecificParts`, substituir do `const arrayBuffer = await response.arrayBuffer();` até o fechamento do `for (const entryName of entryNames)` por:

```js
        const blob = await response.blob();

        for await (const { name, data } of iterateZipEntriesCd(blob, zipDownloadController.signal)) {
          if (zipDownloadCancelled) {
            throw new Error('DOWNLOAD_CANCELLED');
          }

          const preparedPath = normalizeZipEntryName(name);
          if (!preparedPath || !preparedPath.endsWith('.pdf')) continue;

          const pathForComparison = prepareForComparison(preparedPath);

          // Só grava o que foi pedido e ainda não foi gravado.
          if (!wantedIndex.has(preparedPath)) continue;
          if (!remaining.has(pathForComparison)) continue;

          const pdfBlob = new Blob([data], { type: 'application/pdf' });
          const requestUrl = createUrlUtf8(preparedPath, location.origin);
          const pdfResponse = new Response(pdfBlob, {
            headers: { 'Content-Type': 'application/pdf' }
          });

          await cache.put(new Request(requestUrl), pdfResponse);

          remaining.delete(pathForComparison);
          completed++;

          const progress = total === 0 ? 100 : Math.min(99, Math.floor((completed / total) * 100));

          offlineState.update(state => ({
            ...state,
            completed,
            failed: 0,
            progress
          }));
        }
```

Note as diferenças de comportamento, todas intencionais:
- `data` já vem descomprimido só para **esta** entrada; não há mais objeto com todas as entradas nem `delete entries[...]` para liberar memória.
- `iterateZipEntriesCd` recebe o `AbortSignal` e lança `AbortError` no cancelamento — o `catch` existente da função já traduz `AbortError` para `DOMException`; confirme no Step 6 que o cancelamento continua produzindo a mensagem "Download cancelado pelo usuário."

Aplicar a mesma substituição em `startZipDownload` (a partir da linha ~1600), preservando qualquer diferença de atualização de estado que essa função já tenha.

- [ ] **Step 5: Remover a função morta**

Apagar `unzipEntries` (linhas 839-853). Confirmar que não sobrou uso:

```bash
grep -n "unzipEntries\|unzip(" src/lib/stores/offline.js
```

Esperado: nenhuma saída.

- [ ] **Step 6: Verificar o download real com medição de memória**

```bash
npm run build && npm run preview
```

1. Abra `/offline` (sete cliques no cabeçalho "PLPC" em 10 s, se necessário).
2. DevTools → Performance monitor → marque "JS heap size".
3. Inicie o download de uma categoria e observe o heap.

Esperado: o heap fica na casa de dezenas de MB e estável ao longo das partes. Antes, subia em degraus de centenas de MB a cada parte.

4. Durante o download, clique em cancelar. Esperado: a mensagem "Download cancelado pelo usuário." e nenhuma exceção não tratada no console.
5. Ao final, em Application → Cache Storage → `plpc-pdfs`, confirme que a contagem de PDFs bate com a esperada para a categoria.

- [ ] **Step 7: Rodar a suíte**

```bash
npm test
```

Esperado: PASS. (Os testes de `zipCdReader` já cobrem o leitor; esta tarefa muda quem o chama.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/stores/offline.js
git commit -m "perf(offline): stream ZIP entries instead of buffering 30MB packages in memory"
```

---

### Task 6: Enriquecer o manifesto sob demanda em vez de na carga (#12)

`applyLouvoresManifest` percorre as 4.629 linhas do manifesto gerando dois campos derivados por item — `tokensContent(nome)` e `normalizeForSearch(nome)`, cada um com `normalize('NFD')` e duas substituições por regex. São ~14 mil operações de normalização Unicode bloqueando a thread antes da primeira lista aparecer.

O consumidor (`louvorSearch.js`) **já tem** o caminho de fallback que calcula o campo quando ele não existe. Basta parar de calcular na carga e memoizar no primeiro uso. Como a busca só compara tokens quando a comparação por substring falha, boa parte das linhas nunca precisa dos tokens.

**Files:**
- Modify: `src/lib/stores/louvores.js:19-33` (`applyLouvoresManifest`)
- Modify: `src/lib/utils/louvorSearch.js:118-128` (`rowTitleNorm`, `rowContentTokens`)
- Create: `src/lib/utils/louvorSearch.memo.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: nenhuma assinatura nova. `rowTitleNorm` e `rowContentTokens` passam a memoizar em `_searchTitleNorm` / `_searchContentTokens` como propriedades **não enumeráveis** — os campos não aparecem em `JSON.stringify`, então playlists salvas e o carrossel no `localStorage` não crescem.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/utils/louvorSearch.memo.test.js`:

```js
/**
 * Memoização sob demanda dos campos de busca.
 * Run: node --test src/lib/utils/louvorSearch.memo.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prepareSearchQuery, louvorRowMatchesPreparedSearch } from './louvorSearch.js';

describe('memoização dos campos de busca', () => {
  it('encontra o louvor sem campos pré-computados', () => {
    const row = { nome: 'Senhor, minha rocha' };
    assert.equal(louvorRowMatchesPreparedSearch(row, prepareSearchQuery('senhor')), true);
  });

  it('grava o título normalizado na linha, na primeira consulta', () => {
    const row = { nome: 'Bênção Aarônica' };
    assert.equal(row._searchTitleNorm, undefined);
    louvorRowMatchesPreparedSearch(row, prepareSearchQuery('bencao'));
    assert.equal(row._searchTitleNorm, 'bencao aaronica');
  });

  it('grava os tokens de conteúdo quando a busca por substring não casa', () => {
    const row = { nome: 'O Senhor é a minha rocha' };
    // "senhor rocha" não é substring, força o caminho de tokens.
    louvorRowMatchesPreparedSearch(row, prepareSearchQuery('senhor rocha'));
    assert.deepEqual(row._searchContentTokens, ['senhor', 'minha', 'rocha']);
  });

  it('os campos memoizados não vazam para JSON.stringify', () => {
    const row = { nome: 'Obra Santa', pdfId: 'abc' };
    louvorRowMatchesPreparedSearch(row, prepareSearchQuery('obra'));
    assert.equal(JSON.stringify(row), '{"nome":"Obra Santa","pdfId":"abc"}');
  });

  it('respeita campos já pré-computados sem recalcular', () => {
    const row = { nome: 'Qualquer coisa', _searchTitleNorm: 'valor injetado' };
    assert.equal(louvorRowMatchesPreparedSearch(row, prepareSearchQuery('injetado')), true);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
node --test src/lib/utils/louvorSearch.memo.test.js
```

Esperado: FAIL nos testes 2, 3 e 4 — hoje `rowTitleNorm` calcula e descarta, sem gravar na linha.

- [ ] **Step 3: Memoizar em `louvorSearch.js`**

Substituir `rowTitleNorm` e `rowContentTokens` (linhas 118-128) por:

```js
/**
 * Grava o valor derivado na própria linha, sem torná-lo enumerável —
 * assim ele não entra em JSON.stringify (playlists, carrossel no localStorage).
 * @param {any} row
 * @param {string} key
 * @param {any} value
 */
function memoizeOnRow(row, key, value) {
  try {
    Object.defineProperty(row, key, {
      value,
      enumerable: false,
      writable: true,
      configurable: true
    });
  } catch {
    // Objeto congelado/selado: seguir sem memoizar.
  }
  return value;
}

function rowTitleNorm(row) {
  if (typeof row?._searchTitleNorm === 'string') return row._searchTitleNorm;
  const value = normalizeForSearch(row?.nome ?? '');
  if (row && typeof row === 'object') memoizeOnRow(row, '_searchTitleNorm', value);
  return value;
}

function rowContentTokens(row) {
  if (Array.isArray(row?._searchContentTokens)) return row._searchContentTokens;
  const value = tokensContent(row?.nome ?? '');
  if (row && typeof row === 'object') memoizeOnRow(row, '_searchContentTokens', value);
  return value;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
node --test src/lib/utils/louvorSearch.memo.test.js
```

Esperado: PASS — 5 testes.

- [ ] **Step 5: Parar de enriquecer na carga**

Em `src/lib/stores/louvores.js`, substituir `applyLouvoresManifest` (linhas 19-33) por:

```js
/**
 * Aplica o manifesto ao store sem derivar nada.
 *
 * Os campos de busca (_searchTitleNorm, _searchContentTokens) são calculados sob
 * demanda e memoizados em louvorSearch.js — enriquecer aqui custava ~14 mil
 * normalizações Unicode bloqueando a primeira pintura.
 *
 * @param {any[]} data
 * @returns {any[]}
 */
function applyLouvoresManifest(data) {
  const list = Array.isArray(data) ? data : [];
  louvores.set(list);
  return list;
}
```

Remover o import agora não usado, se `tokensContent` e `normalizeForSearch` não forem usados em outro ponto do arquivo:

```bash
grep -n "tokensContent\|normalizeForSearch" src/lib/stores/louvores.js
```

Se só aparecerem na linha do import, remova-os do import.

- [ ] **Step 6: Verificar o ganho na carga**

```bash
npm run build && npm run preview
```

Na home, com o cache limpo, grave um perfil da aba Performance durante o carregamento. Esperado: o bloco longo de `normalizeForSearch`/`tokensContent` imediatamente após o `JSON.parse` do manifesto desaparece do gráfico. A busca por texto continua funcionando idêntica — teste digitando um título com acento (ex.: "bencao") e um com palavras omitidas (ex.: "senhor rocha").

- [ ] **Step 7: Rodar a suíte**

```bash
npm test
```

Esperado: PASS. Confirme que `src/lib/stores/louvores.checksum.test.js` e `louvores.versioning.test.js` continuam passando — eles exercitam o caminho do manifesto.

- [ ] **Step 8: Commit**

```bash
git add src/lib/utils/louvorSearch.js src/lib/utils/louvorSearch.memo.test.js src/lib/stores/louvores.js
git commit -m "perf: derive louvor search fields lazily instead of on every manifest load"
```

---

### Task 7: Consolidar o cache de validação em um único registro (#13)

`cacheValidation` grava **uma chave de `localStorage` por PDF** (`pdfValidation_<base64>`). Com 4.629 louvores são milhares de chaves; somadas a `pdfAvailabilityIndex` e `cachedPdfsListLocal`, o total encosta no teto de ~5 MB por origem. Quando estoura, `clearExpiredValidationCache` itera `localStorage.length` inteiro fazendo `JSON.parse` em cada entrada — síncrono, na main thread, exatamente no pior momento.

**Files:**
- Create: `src/lib/utils/validationCacheStore.js`
- Create: `src/lib/utils/validationCacheStore.test.js`
- Modify: `src/lib/utils/pdfValidation.js:13`, `:54-165` (as cinco funções de cache)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `readValidationEntry(storage, pdfId, now): { available: boolean, url: string } | null`
  - `writeValidationEntry(storage, pdfId, entry, now): void`
  - `removeValidationEntry(storage, pdfId): void`
  - `clearValidationCache(storage): void`
  - `migrateLegacyValidationKeys(storage): number` — devolve quantas chaves antigas removeu
  - `VALIDATION_CACHE_KEY: string`, `VALIDATION_CACHE_TTL: number`
  - `storage` é qualquer objeto com a interface de `Storage` (`getItem`/`setItem`/`removeItem`/`key`/`length`), o que torna o módulo testável sob Node sem DOM.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/utils/validationCacheStore.test.js`:

```js
/**
 * Cache de validação em registro único.
 * Run: node --test src/lib/utils/validationCacheStore.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  VALIDATION_CACHE_KEY,
  VALIDATION_CACHE_TTL,
  readValidationEntry,
  writeValidationEntry,
  removeValidationEntry,
  clearValidationCache,
  migrateLegacyValidationKeys
} from './validationCacheStore.js';

/** Storage de memória com a mesma interface de window.localStorage. */
function createStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    _dump() { return Object.fromEntries(map); }
  };
}

describe('validationCacheStore', () => {
  let storage;
  const NOW = 1_700_000_000_000;

  beforeEach(() => {
    storage = createStorage();
  });

  it('grava e lê uma entrada', () => {
    writeValidationEntry(storage, 'abc', { available: true, url: '/assets/x.pdf' }, NOW);
    assert.deepEqual(readValidationEntry(storage, 'abc', NOW), {
      available: true,
      url: '/assets/x.pdf'
    });
  });

  it('usa uma única chave de storage para muitas entradas', () => {
    writeValidationEntry(storage, 'a', { available: true, url: '/a.pdf' }, NOW);
    writeValidationEntry(storage, 'b', { available: false, url: '/b.pdf' }, NOW);
    writeValidationEntry(storage, 'c', { available: true, url: '/c.pdf' }, NOW);
    assert.deepEqual(Object.keys(storage._dump()), [VALIDATION_CACHE_KEY]);
  });

  it('devolve null para entrada inexistente', () => {
    assert.equal(readValidationEntry(storage, 'nao-existe', NOW), null);
  });

  it('devolve null e descarta entrada expirada', () => {
    writeValidationEntry(storage, 'abc', { available: true, url: '/x.pdf' }, NOW);
    const depois = NOW + VALIDATION_CACHE_TTL + 1;
    assert.equal(readValidationEntry(storage, 'abc', depois), null);
    assert.equal(readValidationEntry(storage, 'abc', NOW), null);
  });

  it('remove uma entrada sem afetar as outras', () => {
    writeValidationEntry(storage, 'a', { available: true, url: '/a.pdf' }, NOW);
    writeValidationEntry(storage, 'b', { available: true, url: '/b.pdf' }, NOW);
    removeValidationEntry(storage, 'a');
    assert.equal(readValidationEntry(storage, 'a', NOW), null);
    assert.notEqual(readValidationEntry(storage, 'b', NOW), null);
  });

  it('limpa tudo', () => {
    writeValidationEntry(storage, 'a', { available: true, url: '/a.pdf' }, NOW);
    clearValidationCache(storage);
    assert.equal(storage.getItem(VALIDATION_CACHE_KEY), null);
  });

  it('migra e apaga as chaves antigas pdfValidation_*', () => {
    const legacy = createStorage({
      'pdfValidation_a': JSON.stringify({ available: true, url: '/a.pdf', timestamp: NOW }),
      'pdfValidation_b': JSON.stringify({ available: false, url: '/b.pdf', timestamp: NOW }),
      'outraCoisa': 'preservar'
    });
    const removidas = migrateLegacyValidationKeys(legacy);
    assert.equal(removidas, 2);
    assert.equal(legacy.getItem('pdfValidation_a'), null);
    assert.equal(legacy.getItem('outraCoisa'), 'preservar');
    assert.deepEqual(readValidationEntry(legacy, 'a', NOW), { available: true, url: '/a.pdf' });
  });

  it('sobrevive a JSON corrompido no registro', () => {
    storage.setItem(VALIDATION_CACHE_KEY, '{corrompido');
    assert.equal(readValidationEntry(storage, 'a', NOW), null);
    writeValidationEntry(storage, 'a', { available: true, url: '/a.pdf' }, NOW);
    assert.notEqual(readValidationEntry(storage, 'a', NOW), null);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
node --test src/lib/utils/validationCacheStore.test.js
```

Esperado: FAIL — `Cannot find module '.../validationCacheStore.js'`.

- [ ] **Step 3: Escrever o módulo**

Criar `src/lib/utils/validationCacheStore.js`:

```js
/**
 * Cache de validação de PDFs em um único registro de storage.
 *
 * Antes: uma chave por pdfId (`pdfValidation_<base64>`) — milhares de chaves,
 * encostando no teto de ~5 MB, com varredura síncrona de todo o localStorage
 * quando a cota estourava.
 *
 * Recebe o storage por parâmetro para ser testável sob `node --test` sem DOM.
 */

export const VALIDATION_CACHE_KEY = 'pdfValidationCache_v1';
export const VALIDATION_CACHE_TTL = 24 * 60 * 60 * 1000;

const LEGACY_PREFIX = 'pdfValidation_';

/**
 * @param {Storage} storage
 * @returns {{ v: number, entries: Record<string, [0|1, string, number]> }}
 */
function readAll(storage) {
  try {
    const raw = storage.getItem(VALIDATION_CACHE_KEY);
    if (!raw) return { v: 1, entries: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1 || typeof parsed.entries !== 'object') {
      return { v: 1, entries: {} };
    }
    return parsed;
  } catch {
    return { v: 1, entries: {} };
  }
}

/**
 * @param {Storage} storage
 * @param {{ v: number, entries: Record<string, [0|1, string, number]> }} data
 */
function writeAll(storage, data) {
  try {
    storage.setItem(VALIDATION_CACHE_KEY, JSON.stringify(data));
  } catch (error) {
    // Cota estourada: descarta o cache inteiro (é reconstruível) e tenta uma vez.
    try {
      storage.removeItem(VALIDATION_CACHE_KEY);
      storage.setItem(VALIDATION_CACHE_KEY, JSON.stringify({ v: 1, entries: {} }));
    } catch {
      // Storage indisponível (modo privado): seguir sem cache.
    }
  }
}

/**
 * @param {Storage} storage
 * @param {string} pdfId
 * @param {number} now
 * @returns {{ available: boolean, url: string } | null}
 */
export function readValidationEntry(storage, pdfId, now) {
  if (!pdfId) return null;
  const data = readAll(storage);
  const entry = data.entries[pdfId];
  if (!Array.isArray(entry)) return null;

  const [available, url, timestamp] = entry;
  if (now - timestamp > VALIDATION_CACHE_TTL) {
    delete data.entries[pdfId];
    writeAll(storage, data);
    return null;
  }

  return { available: available === 1, url: url || '' };
}

/**
 * @param {Storage} storage
 * @param {string} pdfId
 * @param {{ available: boolean, url: string }} entry
 * @param {number} now
 */
export function writeValidationEntry(storage, pdfId, entry, now) {
  if (!pdfId || !entry) return;
  const data = readAll(storage);
  data.entries[pdfId] = [entry.available ? 1 : 0, entry.url || '', now];
  writeAll(storage, data);
}

/**
 * @param {Storage} storage
 * @param {string} pdfId
 */
export function removeValidationEntry(storage, pdfId) {
  if (!pdfId) return;
  const data = readAll(storage);
  if (data.entries[pdfId] === undefined) return;
  delete data.entries[pdfId];
  writeAll(storage, data);
}

/** @param {Storage} storage */
export function clearValidationCache(storage) {
  try {
    storage.removeItem(VALIDATION_CACHE_KEY);
  } catch {
    // ignorar
  }
}

/**
 * Move as chaves antigas `pdfValidation_*` para o registro único e as apaga.
 * Roda uma vez por sessão; é barato quando não há nada a migrar.
 *
 * @param {Storage} storage
 * @returns {number} quantidade de chaves antigas removidas
 */
export function migrateLegacyValidationKeys(storage) {
  /** @type {string[]} */
  const legacyKeys = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(LEGACY_PREFIX) && key !== VALIDATION_CACHE_KEY) {
        legacyKeys.push(key);
      }
    }
  } catch {
    return 0;
  }

  if (legacyKeys.length === 0) return 0;

  const data = readAll(storage);
  for (const key of legacyKeys) {
    try {
      const raw = storage.getItem(key);
      if (raw) {
        const { available, url, timestamp } = JSON.parse(raw);
        const pdfId = key.slice(LEGACY_PREFIX.length);
        data.entries[pdfId] = [available ? 1 : 0, url || '', timestamp || 0];
      }
    } catch {
      // entrada ilegível: apenas descartar
    }
    try {
      storage.removeItem(key);
    } catch {
      // ignorar
    }
  }

  writeAll(storage, data);
  return legacyKeys.length;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
node --test src/lib/utils/validationCacheStore.test.js
```

Esperado: PASS — 8 testes.

- [ ] **Step 5: Ligar em `pdfValidation.js`**

Acrescentar o import:

```js
import {
  readValidationEntry,
  writeValidationEntry,
  removeValidationEntry,
  clearValidationCache,
  migrateLegacyValidationKeys
} from './validationCacheStore.js';
```

Substituir as cinco funções (linhas 54-165) por delegações finas, preservando as assinaturas públicas — `getCachedValidation` é usada em `LouvorCard.svelte`, `invalidateValidationCache` e `clearAllValidationCache` são usadas em `offline.js`:

```js
let legacyMigrationDone = false;

/** Migração das chaves antigas, uma vez por sessão. */
function ensureLegacyMigration() {
  if (legacyMigrationDone || typeof localStorage === 'undefined') return;
  legacyMigrationDone = true;
  const removed = migrateLegacyValidationKeys(localStorage);
  if (removed > 0) {
    console.info(`[PDF Validation] ${removed} chaves de cache antigas consolidadas`);
  }
}

/**
 * @param {string} pdfId
 * @returns {{available: boolean, url: string} | null}
 */
export function getCachedValidation(pdfId) {
  if (!pdfId || typeof localStorage === 'undefined') return null;
  ensureLegacyMigration();
  return readValidationEntry(localStorage, pdfId, Date.now());
}

/**
 * @param {string} pdfId
 * @param {{available: boolean, url: string}} result
 */
export function cacheValidation(pdfId, result) {
  if (!pdfId || !result || typeof localStorage === 'undefined') return;
  ensureLegacyMigration();
  writeValidationEntry(localStorage, pdfId, result, Date.now());
}

/** @param {string} pdfId */
export function invalidateValidationCache(pdfId) {
  if (!pdfId || typeof localStorage === 'undefined') return;
  removeValidationEntry(localStorage, pdfId);
}

export function clearAllValidationCache() {
  if (typeof localStorage === 'undefined') return;
  clearValidationCache(localStorage);
}
```

A função privada `clearExpiredValidationCache` some — a expiração agora é tratada por entrada em `readValidationEntry`, e a cota é tratada em `writeAll`. Confirme que ela não é chamada em outro lugar:

```bash
grep -rn "clearExpiredValidationCache" src/
```

Esperado: nenhuma saída após a edição.

- [ ] **Step 6: Verificar a migração no navegador**

```bash
npm run build && npm run preview
```

1. Antes de carregar, no console: crie chaves antigas para simular um usuário existente.

```js
for (let i = 0; i < 50; i++) {
  localStorage.setItem(`pdfValidation_teste${i}`, JSON.stringify({ available: true, url: `/a${i}.pdf`, timestamp: Date.now() }));
}
Object.keys(localStorage).filter(k => k.startsWith('pdfValidation_')).length; // 50
```

2. Recarregue a home e abra um louvor no leitor (para disparar uma validação).
3. No console:

```js
Object.keys(localStorage).filter(k => k.startsWith('pdfValidation_') && k !== 'pdfValidationCache_v1').length; // 0
JSON.parse(localStorage.getItem('pdfValidationCache_v1')).entries; // contém teste0..teste49
```

- [ ] **Step 7: Rodar a suíte**

```bash
npm test
```

Esperado: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/utils/validationCacheStore.js src/lib/utils/validationCacheStore.test.js src/lib/utils/pdfValidation.js
git commit -m "perf: consolidate per-PDF validation cache into a single localStorage record"
```

---

### Task 8: Repor foco visível e rotular os controles (#26)

`src/app.css` zera `outline` e `box-shadow` de inputs em `:focus`, `:focus-visible` e `:active` com `!important`, sem repor nada — não há indicador de foco utilizável em lugar nenhum do app. E seis componentes de filtro e navegação não têm um único `aria-label`.

**Files:**
- Modify: `src/app.css:48-54`
- Modify: `src/lib/components/SearchBar.svelte`
- Modify: `src/lib/components/CategoryFilters.svelte`
- Modify: `src/lib/components/ClassificationFilters.svelte`
- Modify: `src/lib/components/SpecialArrangementFilters.svelte`
- Modify: `src/lib/components/CarouselChips.svelte`
- Modify: `src/lib/components/OfflineIndicator.svelte`

**Interfaces:**
- Consumes: nada.
- Produces: nada. Tarefa isolada — pode ser feita em qualquer ponto do plano.

- [ ] **Step 1: Trocar a supressão de foco por um anel visível**

Em `src/app.css`, substituir o bloco das linhas 48-54:

```css
  /* Remover outline azul padrão de inputs em focus */
  input:focus,
  input:focus-visible,
  input:active {
    outline: none !important;
    box-shadow: none !important;
  }
```

por:

```css
  /* Suprime só o realce nativo do browser em clique/digitação; o teclado
     continua com indicador próprio, definido logo abaixo. */
  input:focus:not(:focus-visible) {
    outline: none;
    box-shadow: none;
  }

  /* Indicador de foco por teclado — dourado sobre o marrom do fundo e
     sobre o creme dos cards, legível nos dois. */
  :where(a, button, input, select, textarea, summary, [tabindex]):focus-visible {
    outline: 2px solid var(--gold-color);
    outline-offset: 2px;
    border-radius: 4px;
  }
```

Note a troca de `input:focus` para `input:focus:not(:focus-visible)`: o realce some para quem usa mouse, e aparece para quem usa teclado. O `!important` desaparece — sem ele, componentes podem sobrescrever o anel quando precisarem, o que hoje é impossível.

- [ ] **Step 2: Rotular a busca**

Em `src/lib/components/SearchBar.svelte`, no `<input id="louvor-search-input">`, acrescentar:

```svelte
      aria-label="Buscar louvor por nome ou número"
```

E no botão de limpar (que hoje só tem `title`):

```svelte
        aria-label="Limpar pesquisa"
```

- [ ] **Step 3: Rotular os grupos de filtro**

Em `CategoryFilters.svelte`, `ClassificationFilters.svelte` e `SpecialArrangementFilters.svelte`, envolver a lista de chips no papel semântico correto e rotular cada botão com seu estado. Padrão a aplicar nos três (ajuste o nome do grupo e a variável do laço ao que cada arquivo já usa):

```svelte
<div class="chips" role="group" aria-label="Filtrar por categoria">
  {#each CATEGORY_OPTIONS as option}
    <button
      type="button"
      class="chip"
      class:selected={isSelected(option)}
      aria-pressed={isSelected(option)}
      aria-label={`Categoria ${option}`}
      on:click={() => toggle(option)}
    >
      {option}
    </button>
  {/each}
</div>
```

Rótulos de grupo por arquivo:
- `CategoryFilters.svelte` → `"Filtrar por categoria"`, item → `` `Categoria ${option}` ``
- `ClassificationFilters.svelte` → `"Filtrar por arranjo"`, item → `` `Arranjo ${option}` ``
- `SpecialArrangementFilters.svelte` → `"Filtrar por arranjo especial"`, item → `` `Arranjo especial ${option}` ``

O atributo que importa é `aria-pressed` — é ele que faz o leitor de tela anunciar "selecionado"/"não selecionado" em vez de só ler o texto.

- [ ] **Step 4: Rotular os chips do carrossel e o indicador offline**

Em `CarouselChips.svelte`, no contêiner da lista e nos botões de remover:

```svelte
<div class="chips-container" role="list" aria-label="Louvores na lista atual">
  <!-- cada chip: -->
  <div role="listitem">
    …
    <button type="button" aria-label={`Remover ${louvor.nome} da lista`} on:click={…}>
```

Em `OfflineIndicator.svelte`, o estado precisa ser anunciado quando muda:

```svelte
<div class="offline-indicator" role="status" aria-live="polite" aria-label={isOnline ? 'Conectado' : 'Sem conexão'}>
```

- [ ] **Step 5: Verificar com teclado e com leitor de tela**

```bash
npm run build && npm run preview
```

1. Na home, pressione Tab repetidamente do topo até o rodapé. Todo elemento focável deve mostrar o anel dourado. Nenhum "salto invisível".
2. Clique num chip de filtro com o mouse — o anel **não** deve aparecer (é `:focus-visible`).
3. Foque um chip com Tab e pressione Espaço — ele deve alternar, e o anel permanecer.
4. No macOS, ative o VoiceOver (Cmd+F5) e navegue pelos filtros. Cada chip deve ser anunciado como "Categoria Partitura, botão, selecionado" (ou "não selecionado").

- [ ] **Step 6: Commit**

```bash
git add src/app.css src/lib/components/SearchBar.svelte src/lib/components/CategoryFilters.svelte src/lib/components/ClassificationFilters.svelte src/lib/components/SpecialArrangementFilters.svelte src/lib/components/CarouselChips.svelte src/lib/components/OfflineIndicator.svelte
git commit -m "fix(a11y): restore visible keyboard focus and label filter controls"
```

---

## Verificação final do plano

Após a Task 8, com tudo aplicado:

- [ ] `npm test` — PASS, incluindo os 12 testes pré-existentes e os 33 novos.
- [ ] `npm run build` — conclui sem erro.
- [ ] `grep -rn "127.0.0.1" src/ static/` — sem saída.
- [ ] Com o app em produção local (`npm run preview`), offline no DevTools: a home carrega, a busca funciona, um louvor já baixado abre no leitor, e `/louvores-manifest.sha256` aparece na aba Network como falha de rede (não como resposta de cache).
- [ ] Um download de categoria completo, com o Performance monitor aberto, mantém o JS heap estável.

Não incluído neste plano, por pertencer à faixa seguinte: #02 (estratégias como dados), #04 (precache pelo manifesto de build), #06 (retomada de download), #07, #08, #09, #14, #15, #17, #20, #21, #24, #25, #27, #28. Ver `2026-08-31-plpc-melhorias-recomendadas.md`.
