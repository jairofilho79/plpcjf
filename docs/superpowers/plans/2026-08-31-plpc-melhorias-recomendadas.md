# PLPC — Melhorias Recomendadas (faixa "Recomendado") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Executar os quinze achados marcados "✓ Recomendado" na auditoria — do fallback difuso do R2 que pode servir o PDF errado até a reescrita da sincronização URL ↔ estado que hoje depende de seis flags e `setTimeout`.

**Architecture:** Ordenado por risco crescente. As cinco primeiras tarefas são correções contidas e independentes. As tarefas 6-8 reconstroem o pipeline de download offline (precache pelo manifesto de build, retomada, progresso legível) e devem ser feitas em sequência. As tarefas 9-13 são qualidade de interface e de manutenção; a última, a reescrita da sincronização de URL, é a de maior superfície e fica por último de propósito.

**Tech Stack:** SvelteKit 2 / Svelte 4, Vite 5, Tailwind 3, fflate, pdfjs-dist 4.8.69, Cloudflare Pages + R2, `node --test`.

**Spec:** Auditoria Técnica PLPC — https://claude.ai/code/artifact/a4e1959b-9b0f-48ce-8163-6c94af4390e3 (achados #09, #07, #08, #17, #15, #14, #04, #02, #06, #25, #27, #28, #24, #20, #21)

**Pré-requisito:** o plano `2026-08-31-plpc-correcoes-imediatas.md` deve estar concluído. Este plano assume `static/sw-router.js`, `src/lib/utils/pdfCacheIndex.js` e `src/lib/utils/validationCacheStore.js` já existindo, e o script `npm test` já configurado.

## Global Constraints

- **Runtime de teste:** `node --test`. Não introduzir vitest ou jest.
- **Imports em arquivos testáveis:** só caminhos relativos. `$lib` não resolve sob `node --test`.
- **Nada em `static/` pode ser arquivo de teste** — o diretório inteiro vai para o deploy.
- **Idioma:** comentários e UI em pt-BR.
- **Commits:** um por tarefa, Conventional Commits.
- **Verificação a cada tarefa:** `npm test` passa; `npm run build` conclui.
- **Escopo de tipos:** a Task 12 zera `svelte-check` **apenas** em `src/lib/offline/**`. Nas demais tarefas, não tentar reduzir a contagem global de 1.154 erros.

---

### Task 1: Exigir correspondência exata no fallback do R2 (#09)

Quando a chave não existe no bucket, `servePdf` lista o diretório e aceita como correspondência qualquer arquivo cujo nome normalizado contenha os **dez primeiros caracteres** do esperado — ou vice-versa. Os nomes neste acervo são repetitivos (`Cifra.pdf`, `Coro.pdf`, `Partitura.pdf`) e a normalização remove tudo que não é alfanumérico, então dez caracteres não distinguem partituras diferentes. O usuário recebe o louvor errado, e o service worker grava essa resposta sob o caminho pedido — o erro persiste offline.

**Files:**
- Create: `src/lib/server/r2KeyMatch.js`
- Create: `src/lib/server/r2KeyMatch.test.js`
- Modify: `src/hooks.server.js:34-110` (`servePdf`), `:113-172` (`serveZipPackage`)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `normalizeR2Key(key: string): string`
  - `findExactKeyMatch(candidates: string[], expected: string): string | null`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/server/r2KeyMatch.test.js`:

```js
/**
 * Correspondência de chave no R2. Run: node --test src/lib/server/r2KeyMatch.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeR2Key, findExactKeyMatch } from './r2KeyMatch.js';

describe('normalizeR2Key', () => {
  it('remove acentos, caixa e separadores, preservando a estrutura', () => {
    assert.equal(normalizeR2Key('assets/Coleânea/Cifra nível I.pdf'), 'assets/coleanea/cifranivelipdf');
  });

  it('normaliza barra invertida para barra', () => {
    assert.equal(normalizeR2Key('assets\\Col\\Cifra.pdf'), 'assets/col/cifrapdf');
  });

  it('aceita entrada vazia', () => {
    assert.equal(normalizeR2Key(''), '');
    assert.equal(normalizeR2Key(null), '');
  });
});

describe('findExactKeyMatch', () => {
  const candidates = [
    'assets/05042026/Obra Santa/Coro.pdf',
    'assets/05042026/Obedecer/Coro.pdf',
    'assets/05042026/O Rei Vem!/Coro.pdf'
  ];

  it('acerta a chave equivalente após normalização', () => {
    assert.equal(
      findExactKeyMatch(candidates, 'assets/05042026/Obra Santa/Coro.pdf'),
      'assets/05042026/Obra Santa/Coro.pdf'
    );
  });

  it('acerta quando só o acento difere', () => {
    const comAcento = ['assets/Colêtanea/Cifra.pdf'];
    assert.equal(findExactKeyMatch(comAcento, 'assets/Coletanea/Cifra.pdf'), 'assets/Colêtanea/Cifra.pdf');
  });

  it('NÃO acerta por prefixo — este era o defeito #09', () => {
    // "Obra Santa/Coro.pdf" e "Obedecer/Coro.pdf" compartilham prefixo normalizado
    // longo o bastante para a heurística antiga de 10 caracteres casar errado.
    assert.equal(findExactKeyMatch(candidates, 'assets/05042026/Outro Louvor/Coro.pdf'), null);
  });

  it('devolve null quando não há candidato', () => {
    assert.equal(findExactKeyMatch([], 'assets/x/Coro.pdf'), null);
    assert.equal(findExactKeyMatch(null, 'assets/x/Coro.pdf'), null);
  });

  it('devolve a primeira ocorrência quando há empate exato', () => {
    const dup = ['assets/a/Coro.pdf', 'assets/A/Coro.pdf'];
    assert.equal(findExactKeyMatch(dup, 'assets/a/Coro.pdf'), 'assets/a/Coro.pdf');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
node --test src/lib/server/r2KeyMatch.test.js
```

Esperado: FAIL — módulo inexistente.

- [ ] **Step 3: Escrever o módulo**

Criar `src/lib/server/r2KeyMatch.js`:

```js
/**
 * Correspondência de chave no bucket R2.
 *
 * Substitui a heurística de prefixo de 10 caracteres (achado #09), que podia
 * servir a partitura errada: neste acervo os nomes de arquivo se repetem
 * (Cifra.pdf, Coro.pdf, Partitura.pdf) e a normalização remove tudo que não é
 * alfanumérico, então prefixos curtos colidem com facilidade.
 *
 * Regra: igualdade após uma normalização única. Sem correspondência, 404 —
 * errar explicitamente é melhor que acertar por acaso.
 */

/**
 * Minúsculas, sem acentos, sem separadores dentro de cada segmento;
 * a estrutura de diretórios (as barras) é preservada.
 * @param {string | null | undefined} key
 * @returns {string}
 */
export function normalizeR2Key(key) {
  if (!key || typeof key !== 'string') return '';
  return key
    .replace(/\\/g, '/')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split('/')
    .map((segment) => segment.replace(/[^a-z0-9]/g, ''))
    .join('/');
}

/**
 * @param {string[] | null | undefined} candidates chaves reais do bucket
 * @param {string} expected chave pedida
 * @returns {string | null} a chave real equivalente, ou null
 */
export function findExactKeyMatch(candidates, expected) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const target = normalizeR2Key(expected);
  if (!target) return null;

  for (const candidate of candidates) {
    if (normalizeR2Key(candidate) === target) return candidate;
  }
  return null;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
node --test src/lib/server/r2KeyMatch.test.js
```

Esperado: PASS — 8 testes.

- [ ] **Step 5: Trocar a heurística em `hooks.server.js`**

Acrescentar ao topo:

```js
import { findExactKeyMatch } from '$lib/server/r2KeyMatch.js';
```

Em `servePdf`, substituir todo o bloco "If still not found, try to find a similar filename" (linhas ~62-90) por:

```js
    // Último recurso: a chave real pode diferir só em acento/caixa.
    // Correspondência exata após normalização — nunca por prefixo (achado #09).
    if (!object) {
      const pathParts = r2Key.split('/');
      const expectedFilename = pathParts.pop();
      const prefix = pathParts.join('/');

      const list = await platform.env.LOUVORES_BUCKET.list({ prefix });
      const matched = findExactKeyMatch(
        list.objects.map((item) => item.key),
        `${prefix}/${expectedFilename}`
      );

      if (matched) {
        object = await platform.env.LOUVORES_BUCKET.get(matched);
        if (object) {
          console.log(`[R2] Chave equivalente encontrada: ${r2Key} -> ${matched}`);
          r2Key = matched;
        }
      }
    }
```

- [ ] **Step 6: Repassar validadores de cache**

Ainda em `servePdf`, substituir o retorno final por uma resposta que permita revalidação (achado #10, resolvido de carona por ser a mesma linha):

```js
    return new Response(object.body, {
      headers: {
        ...corsHeaders,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        ...(object.httpEtag ? { ETag: object.httpEtag } : {}),
        ...(object.uploaded ? { 'Last-Modified': new Date(object.uploaded).toUTCString() } : {})
      }
    });
```

E remover `'Cache-Control': 'public, max-age=31536000'` do objeto `corsHeaders` no topo da função, já que agora é definido no retorno.

- [ ] **Step 7: Verificar contra o bucket real**

```bash
npm run build && npx wrangler pages dev .svelte-kit/cloudflare
```

1. Peça um PDF que existe: `curl -sI http://localhost:8788/assets/<caminho-real>.pdf` → `200`, com header `ETag`.
2. Peça um PDF que **não** existe mas cujo nome de arquivo existe em outra pasta — ex.: `/assets/05042026/Louvor Inexistente/Coro.pdf`. Esperado: `404`. Antes desta tarefa, retornava `200` com o `Coro.pdf` de outro louvor.
3. Peça um PDF cujo nome real tem acento, usando a versão sem acento. Esperado: `200`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/r2KeyMatch.js src/lib/server/r2KeyMatch.test.js src/hooks.server.js
git commit -m "fix(r2): require exact normalized key match so the wrong PDF is never served"
```

---

### Task 2: Fechar os vazamentos de ciclo de vida do service worker (#07, #08)

Dois defeitos pequenos, mesmo arquivo. `sendMessageToSW` nunca cancela o `setTimeout` de 5 minutos no caminho de sucesso e nunca fecha as `MessagePort` — e `GET_CACHED_PDFS` é chamado com frequência. Em paralelo, o SW é registrado duas vezes (inline em `app.html` e via `registerServiceWorker()` no layout), e o `setInterval` de update de uma hora nunca é limpo.

**Files:**
- Modify: `src/lib/utils/swRegistration.js:73-95` (`sendMessageToSW`), `:15-50` (`registerServiceWorker`)
- Modify: `src/app.html:18-29` (remover o registro inline)
- Modify: `src/routes/+layout.svelte` (guardar e limpar o cleanup)

**Interfaces:**
- Consumes: nada.
- Produces: `registerServiceWorker()` passa a devolver `Promise<{ registration: ServiceWorkerRegistration | null, cleanup: () => void }>` em vez de `Promise<ServiceWorkerRegistration | null>`. **Todos os chamadores precisam ser ajustados** — hoje só `+layout.svelte`.

- [ ] **Step 1: Confirmar quem chama `registerServiceWorker`**

```bash
grep -rn "registerServiceWorker" src/
```

Esperado: a definição e uma única chamada, em `src/routes/+layout.svelte`.

- [ ] **Step 2: Corrigir o vazamento em `sendMessageToSW`**

Substituir a função (linhas 73-95) por:

```js
/**
 * Envia mensagem ao Service Worker e aguarda resposta.
 * Cancela o timeout e fecha as portas nos dois caminhos — o de sucesso
 * vazava um timer de 5 min e um par de MessagePort por chamada.
 *
 * @param {object} message
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<any>}
 */
export function sendMessageToSW(message, options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.serviceWorker.controller) {
      reject(new Error('No service worker controller'));
      return;
    }

    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30000;
    const channel = new MessageChannel();
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      try { channel.port1.onmessage = null; } catch {}
      try { channel.port1.close?.(); } catch {}
      try { channel.port2.close?.(); } catch {}
    };

    channel.port1.onmessage = (event) => {
      cleanup();
      resolve(event.data);
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Service worker message timeout'));
    }, timeoutMs);

    navigator.serviceWorker.controller.postMessage(message, [channel.port2]);
  });
}
```

O timeout padrão cai de 5 min para 30 s: nenhuma das mensagens que passam por aqui (`GET_CACHED_PDFS`, `CLEAR_CACHE`, `CLEAR_PDF_CACHE_ENTRY`, `CLEAR_LOUVORES_MANIFEST_CACHE`, `CANCEL_DOWNLOAD`) é uma operação longa — downloads usam `downloadPDFsViaSW`, que tem timeout próprio.

- [ ] **Step 3: Devolver um cleanup de `registerServiceWorker`**

Substituir o corpo (linhas 15-50) por:

```js
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[SW Registration] Service workers not supported');
    return { registration: null, cleanup: () => {} };
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    swRegistration = registration;

    const updateIntervalId = setInterval(() => {
      registration.update();
    }, 60 * 60 * 1000);

    const onUpdateFound = () => {
      const newWorker = registration.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          console.log('[SW Registration] New service worker available');
          dispatchUpdateEvent();
        }
      });
    };

    registration.addEventListener('updatefound', onUpdateFound);

    console.log('[SW Registration] Service worker registered successfully');

    return {
      registration,
      cleanup: () => {
        clearInterval(updateIntervalId);
        registration.removeEventListener('updatefound', onUpdateFound);
      }
    };
  } catch (error) {
    console.error('[SW Registration] Failed to register service worker:', error);
    return { registration: null, cleanup: () => {} };
  }
}
```

- [ ] **Step 4: Remover o registro duplicado do `app.html`**

Em `src/app.html`, apagar o bloco `<script>` inteiro (linhas 18-29), deixando só:

```html
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
```

O registro passa a acontecer só no layout — que é onde estão os listeners de ciclo de vida.

- [ ] **Step 5: Consumir o cleanup no layout**

Em `src/routes/+layout.svelte`, dentro de `onMount`, trocar:

```js
      registerServiceWorker().then(() => {
        setupServiceWorkerMessageListener();
        setupCacheSync();
      });
```

por:

```js
      /** @type {(() => void) | null} */
      let swCleanup = null;
      /** @type {(() => void) | null} */
      let swMessageCleanup = null;

      registerServiceWorker().then(({ cleanup }) => {
        swCleanup = cleanup;
        swMessageCleanup = setupServiceWorkerMessageListener();
        setupCacheSync();
      });
```

E acrescentar as duas chamadas à função de cleanup que `onMount` já devolve:

```js
      return () => {
        removeStaleChunkListeners();
        cancelStaleRecoveryReset();
        swCleanup?.();
        swMessageCleanup?.();
      };
```

Se o `return` do `onMount` já existir com outro conteúdo, some as linhas novas ao existente em vez de substituir.

- [ ] **Step 6: Verificar**

```bash
npm run build && npm run preview
```

1. DevTools → Application → Service Workers: deve haver **um** registro, escopo `/`.
2. Console: apenas uma linha `[SW Registration] Service worker registered successfully`; a linha `[App] SW registered:` do inline deve ter sumido.
3. Navegue entre `/`, `/biblioteca` e `/leitor` várias vezes. Em Memory → tire dois heap snapshots com um minuto de intervalo e compare a contagem de `MessagePort` — deve ficar estável.

- [ ] **Step 7: Rodar a suíte**

```bash
npm test
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/utils/swRegistration.js src/app.html src/routes/+layout.svelte
git commit -m "fix(sw): clear message timeouts and ports, and register the worker only once"
```

---

### Task 3: Colocar o log de produção atrás de uma flag (#17)

194 chamadas a `console.log` no código de produção, incluindo dentro do `fetch` handler do SW, que loga em **toda** requisição de PDF e monta um objeto de debug para cada requisição de pacote. Numa leitura de playlist longa são milhares de entradas serializando objetos.

O padrão já existe no projeto: `localStorage.getItem('plpcjf_perf_debug') === '1'`, usado no leitor. Esta tarefa o estende ao SW e aos utilitários de maior volume. `console.error` e `console.warn` permanecem sempre ativos.

**Files:**
- Create: `static/sw-debug.js`
- Modify: `static/sw.js` (importScripts e todas as chamadas `console.log`)
- Modify: `src/lib/utils/swRegistration.js`, `src/lib/utils/pdfIndex.js`, `src/lib/utils/pdfValidation.js` (chamadas `console.log`)

**Interfaces:**
- Consumes: nada.
- Produces: `swDebug(...args: unknown[]): void` publicado em `self` por `static/sw-debug.js`.

- [ ] **Step 1: Medir o volume atual**

```bash
grep -c "console.log" static/sw.js
grep -rc "console.log" src/lib/utils/swRegistration.js src/lib/utils/pdfIndex.js src/lib/utils/pdfValidation.js
```

Anote os números — servem de verificação no Step 5.

- [ ] **Step 2: Criar o gate de debug do SW**

Um Service Worker não tem acesso a `localStorage`. O gate usa uma variável no escopo do worker, alimentada por mensagem do cliente. Criar `static/sw-debug.js`:

```js
/**
 * Gate de log do Service Worker.
 * Desligado por padrão; o cliente liga com postMessage({ type: 'SET_DEBUG', data: { enabled: true } }).
 */

let swDebugEnabled = false;

/** @param {...unknown} args */
function swDebug(...args) {
  if (swDebugEnabled) console.log(...args);
}

/** @param {boolean} enabled */
function setSwDebug(enabled) {
  swDebugEnabled = !!enabled;
}

if (typeof self !== 'undefined') {
  self.swDebug = swDebug;
  self.setSwDebug = setSwDebug;
}
```

- [ ] **Step 3: Ligar no service worker**

Em `static/sw.js`, linha 6:

```js
importScripts('/sw-utils.js', '/sw-router.js', '/sw-debug.js');
```

No handler de `message`, acrescentar o caso:

```js
    case 'SET_DEBUG':
      setSwDebug(data?.enabled);
      break;
```

E substituir **todas** as chamadas `console.log(` por `swDebug(` no arquivo:

```bash
sed -i '' 's/console\.log(/swDebug(/g' static/sw.js
```

`console.error` e `console.warn` não são tocados por esse `sed` — confirme:

```bash
grep -c "console.log" static/sw.js   # esperado: 0
grep -c "console.error\|console.warn" static/sw.js  # inalterado
```

- [ ] **Step 4: Propagar a flag do cliente para o SW**

Em `src/lib/utils/swRegistration.js`, dentro de `registerServiceWorker`, logo após o `await navigator.serviceWorker.register(...)`:

```js
    // Propaga o gate de debug (mesma flag do leitor: plpcjf_perf_debug).
    try {
      const debugOn = localStorage.getItem('plpcjf_perf_debug') === '1';
      navigator.serviceWorker.ready.then(() => {
        navigator.serviceWorker.controller?.postMessage({
          type: 'SET_DEBUG',
          data: { enabled: debugOn }
        });
      });
    } catch {
      // localStorage indisponível: segue sem debug.
    }
```

- [ ] **Step 5: Aplicar o mesmo gate nos três utilitários de maior volume**

Criar o helper compartilhado no fim de `src/lib/utils/swRegistration.js`:

```js
/**
 * Log de diagnóstico, ativado por `localStorage.plpcjf_perf_debug = '1'`.
 * Erros e avisos continuam sempre visíveis — só o ruído de fluxo normal é filtrado.
 * @param {...unknown} args
 */
export function debugLog(...args) {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('plpcjf_perf_debug') === '1') {
      console.log(...args);
    }
  } catch {
    // ignorar
  }
}
```

E em `swRegistration.js`, `pdfIndex.js` e `pdfValidation.js`, trocar `console.log(` por `debugLog(` (importando `debugLog` de `./swRegistration.js` nos dois últimos). Não trocar `console.error` nem `console.warn`.

- [ ] **Step 6: Verificar os dois modos**

```bash
npm run build && npm run preview
```

1. Com o cache limpo e sem a flag: abra a home e navegue até um louvor no leitor. O console deve ficar essencialmente silencioso — só erros, se houver.
2. No console: `localStorage.setItem('plpcjf_perf_debug', '1')` e recarregue. O log detalhado volta, incluindo o do SW.
3. `localStorage.removeItem('plpcjf_perf_debug')` e recarregue. Silêncio de novo.

- [ ] **Step 7: Commit**

```bash
git add static/sw-debug.js static/sw.js src/lib/utils/swRegistration.js src/lib/utils/pdfIndex.js src/lib/utils/pdfValidation.js
git commit -m "perf: gate production console logging behind the existing debug flag"
```

---

### Task 4: Memoizar a resolução de caminho de PDF (#15)

`getPdfRelPath` faz `atob` + `Uint8Array` + `TextDecoder('utf-8')` + duas regex, e é chamada em blocos reativos do `LouvorCard` — por material, por card, a cada mudança de página, filtro ou carrossel. Com 100 itens por página e grupos multi-material, são centenas de decodificações UTF-8 por interação.

**Files:**
- Modify: `src/lib/utils/pathUtils.js` (`getPdfRelPath`)
- Create: `src/lib/utils/pathUtils.memo.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: nenhuma assinatura nova. `getPdfRelPath` passa a memoizar por `pdfId` num `Map` de módulo.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/utils/pathUtils.memo.test.js`:

```js
/**
 * Memoização de getPdfRelPath. Run: node --test src/lib/utils/pathUtils.memo.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPdfRelPath, __resetPdfRelPathCache } from './pathUtils.js';

// btoa/atob existem no Node >= 16 globalmente.
const encode = (s) => Buffer.from(s, 'utf8').toString('base64');

describe('getPdfRelPath memoizado', () => {
  it('resolve o caminho a partir do pdfId em base64 UTF-8', () => {
    const pdfId = encode('05042026/Bênção Aarônica/Coro.pdf');
    assert.equal(getPdfRelPath({ pdfId }), 'assets/05042026/Bênção Aarônica/Coro.pdf');
  });

  it('devolve a mesma referência de string em chamadas repetidas', () => {
    __resetPdfRelPathCache();
    const pdfId = encode('assets/ColAdultos/001.pdf');
    const a = getPdfRelPath({ pdfId });
    const b = getPdfRelPath({ pdfId });
    assert.equal(a, b);
    assert.equal(a, 'assets/ColAdultos/001.pdf');
  });

  it('memoiza também o resultado nulo, sem repetir o atob', () => {
    __resetPdfRelPathCache();
    assert.equal(getPdfRelPath({ pdfId: '!!!nao-e-base64!!!' }), null);
    assert.equal(getPdfRelPath({ pdfId: '!!!nao-e-base64!!!' }), null);
  });

  it('devolve null sem pdfId', () => {
    assert.equal(getPdfRelPath(null), null);
    assert.equal(getPdfRelPath({}), null);
  });

  it('não confunde dois pdfIds diferentes', () => {
    __resetPdfRelPathCache();
    assert.equal(getPdfRelPath({ pdfId: encode('a/Coro.pdf') }), 'assets/a/Coro.pdf');
    assert.equal(getPdfRelPath({ pdfId: encode('b/Coro.pdf') }), 'assets/b/Coro.pdf');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
node --test src/lib/utils/pathUtils.memo.test.js
```

Esperado: FAIL — `__resetPdfRelPathCache` não é exportado.

- [ ] **Step 3: Memoizar**

Em `src/lib/utils/pathUtils.js`, renomear a função atual para `computePdfRelPath` (mantendo o corpo idêntico, sem `export`) e acrescentar em volta:

```js
/**
 * Cache de caminho por pdfId. O pdfId é imutável para um louvor, então o
 * resultado nunca fica obsoleto. Guarda também o null, para não repetir o atob
 * de entradas quebradas.
 * @type {Map<string, string | null>}
 */
const pdfRelPathCache = new Map();

/** Só para teste. */
export function __resetPdfRelPathCache() {
  pdfRelPathCache.clear();
}

/**
 * Caminho relativo do PDF, sem barra inicial. Ex.: "assets/ColAdultos/001.pdf".
 * Memoizado por pdfId — era chamado centenas de vezes por render de página.
 * @param {any} louvor
 * @returns {string | null}
 */
export function getPdfRelPath(louvor) {
  const pdfId = louvor?.pdfId;
  if (!pdfId || typeof pdfId !== 'string') return null;

  if (pdfRelPathCache.has(pdfId)) {
    return pdfRelPathCache.get(pdfId) ?? null;
  }

  const resolved = computePdfRelPath(louvor);
  pdfRelPathCache.set(pdfId, resolved);
  return resolved;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
node --test src/lib/utils/pathUtils.memo.test.js
```

Esperado: PASS — 5 testes.

- [ ] **Step 5: Verificar o ganho**

```bash
npm run build && npm run preview
```

Na biblioteca, com "itens por página" em 100, grave um perfil da aba Performance e troque de página duas vezes. Esperado: `atobUTF8` e `TextDecoder.decode` somem do topo do gráfico de chamadas.

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/pathUtils.js src/lib/utils/pathUtils.memo.test.js
git commit -m "perf: memoize PDF path resolution by pdfId"
```

---

### Task 5: Memoizar o agrupamento e reutilizar o colador (#14)

Na home, `groupLouvoresByGroupId(...)` é chamado num bloco reativo **e** dentro de `finalizeFilteredResults` **e** dentro de `setPage` — três passagens completas sobre a lista filtrada por interação, cada uma alocando um `Map`, um array de ordem e um array ordenado por grupo (1.898 grupos). Na biblioteca, `sortedLouvores` chama `localeCompare(nome, 'pt-BR')`, que cria um colador novo a cada comparação, em `n log n` comparações.

**Files:**
- Modify: `src/lib/utils/groupLouvores.js` (memoização + colador)
- Modify: `src/lib/utils/groupLouvores.test.js` (casos novos)
- Modify: `src/routes/+page.svelte` (`finalizeFilteredResults`, `setPage`)
- Modify: `src/routes/biblioteca/+page.svelte:290-301` (`sortedLouvores`)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `groupLouvoresByGroupId(list)` passa a devolver **a mesma referência de array** quando chamada com a mesma referência de `list`. Os chamadores não podem mutar o resultado.
  - `compareLouvorNome(a: any, b: any): number` — comparador estável por nome, com `Intl.Collator` único.

- [ ] **Step 1: Acrescentar os testes que falham**

Em `src/lib/utils/groupLouvores.test.js`, acrescentar ao final:

```js
import { compareLouvorNome } from './groupLouvores.js';

describe('memoização de groupLouvoresByGroupId', () => {
  it('devolve a mesma referência para a mesma lista', () => {
    const list = [{ pdfId: 'a', nome: 'A', categoria: 'Partitura' }];
    assert.equal(groupLouvoresByGroupId(list), groupLouvoresByGroupId(list));
  });

  it('recalcula para uma lista diferente', () => {
    const a = [{ pdfId: 'a', nome: 'A', categoria: 'Partitura' }];
    const b = [{ pdfId: 'b', nome: 'B', categoria: 'Partitura' }];
    assert.notEqual(groupLouvoresByGroupId(a), groupLouvoresByGroupId(b));
    assert.equal(groupLouvoresByGroupId(b)[0].groupId, 'b');
  });
});

describe('compareLouvorNome', () => {
  it('ordena em pt-BR ignorando acentos na ordenação primária', () => {
    const nomes = [{ nome: 'Órgão' }, { nome: 'Obra' }, { nome: 'Amor' }];
    const ordenado = [...nomes].sort(compareLouvorNome).map((x) => x.nome);
    assert.deepEqual(ordenado, ['Amor', 'Obra', 'Órgão']);
  });

  it('tolera nome ausente', () => {
    const nomes = [{ nome: 'Zelo' }, {}, { nome: 'Amor' }];
    const ordenado = [...nomes].sort(compareLouvorNome).map((x) => x.nome ?? '');
    assert.deepEqual(ordenado, ['', 'Amor', 'Zelo']);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
node --test src/lib/utils/groupLouvores.test.js
```

Esperado: FAIL — `compareLouvorNome` não existe e o agrupamento devolve arrays novos.

- [ ] **Step 3: Implementar**

Em `src/lib/utils/groupLouvores.js`, renomear a função atual para `computeGroups` (corpo idêntico, sem `export`) e acrescentar:

```js
/**
 * Colador único. Criar um Intl.Collator por comparação — que é o que
 * String.prototype.localeCompare faz — é uma das operações mais caras em JS,
 * e aqui roda n log n vezes.
 */
const nomeCollator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

/**
 * @param {any} a
 * @param {any} b
 * @returns {number}
 */
export function compareLouvorNome(a, b) {
  return nomeCollator.compare(a?.nome || '', b?.nome || '');
}

/**
 * Memoização de um slot só: a home chama esta função três vezes por interação,
 * sempre com a mesma referência de lista.
 * @type {{ input: any[] | null, output: any[] }}
 */
let lastGrouping = { input: null, output: [] };

/**
 * Agrupa entradas do manifesto por groupId.
 *
 * AVISO: o array devolvido é memoizado por referência de entrada — não mute
 * o resultado. Para uma cópia mutável, use [...groupLouvoresByGroupId(list)].
 *
 * @param {any[]} list
 * @returns {{ groupId: string, nome: string, numero: string, classificacao: string, materials: any[] }[]}
 */
export function groupLouvoresByGroupId(list) {
  if (!Array.isArray(list) || list.length === 0) return [];
  if (lastGrouping.input === list) return lastGrouping.output;

  const output = computeGroups(list);
  lastGrouping = { input: list, output };
  return output;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
node --test src/lib/utils/groupLouvores.test.js
```

Esperado: PASS — os testes originais mais os 4 novos.

- [ ] **Step 5: Usar o colador na biblioteca**

Em `src/routes/biblioteca/+page.svelte`, acrescentar `compareLouvorNome` ao import de `groupLouvores.js` e substituir `sortedLouvores` (linhas 290-301) por:

```js
  $: sortedLouvores = (() => {
    const sorted = [...filteredLouvores];
    if ($bibliotecaSort === 'numero') {
      return sorted.sort((a, b) => Number(a.numero || 0) - Number(b.numero || 0));
    }
    return sorted.sort(compareLouvorNome);
  })();
```

- [ ] **Step 6: Confirmar que a home aproveita a memoização**

Em `src/routes/+page.svelte`, as três chamadas passam a bater no mesmo slot porque recebem a mesma referência (`results` em `finalizeFilteredResults`, `filteredResults` em `setPage`, `filteredResults` no bloco reativo `groupedResults`). Verifique que `finalizeFilteredResults` atribui `filteredResults = results` **antes** de chamar `groupLouvoresByGroupId(results)` — se a ordem for outra, o slot é invalidado a cada chamada. Na versão atual a atribuição já é a primeira linha da função; confirme que continua assim.

- [ ] **Step 7: Verificar**

```bash
npm run build && npm run preview
```

Na home, digite uma busca com resultado amplo (ex.: "senhor") e grave um perfil. Esperado: `computeGroups` aparece **uma** vez por tecla, não três. Na biblioteca, ordene por nome com 100 itens por página — a troca de ordenação deve ficar visivelmente mais rápida.

- [ ] **Step 8: Commit**

```bash
git add src/lib/utils/groupLouvores.js src/lib/utils/groupLouvores.test.js src/routes/+page.svelte src/routes/biblioteca/+page.svelte
git commit -m "perf: memoize louvor grouping and reuse a single pt-BR collator"
```

---

### Task 6: Migrar o service worker para o manifesto de build do SvelteKit (#04, #02)

`APP_SHELL` e `PDFJS_MODULES` são listas fixas, e `CACHE_VERSION` é a string `'plpc-v5'` atualizada à mão. Sem versão atrelada ao deploy, o `activate` só invalida o cache quando alguém lembra de incrementar; e rota ou chunk novo nunca entra no shell offline sem edição manual. Esta tarefa também termina o achado #02: as estratégias por rota viram dados, não `if`.

**Files:**
- Create: `src/service-worker.js`
- Delete: `static/sw.js`
- Modify: `static/sw-router.js` → mover para `src/lib/offline/sw/swRouter.js` (vira ES module)
- Modify: `src/lib/offline/sw/swRouter.test.js` (import direto, sem `node:vm`)
- Modify: `src/lib/utils/swRegistration.js` (caminho do worker)
- Modify: `src/lib/utils/staleChunkRecovery.js:9-21` (padrão dos nomes de cache)

**Interfaces:**
- Consumes: `matchSwRoute` e `SW_APP_SHELL_PATHS` da Task 2 do plano anterior.
- Produces: o worker passa a ser servido em `/service-worker.js` (padrão do SvelteKit), não `/sw.js`.

- [ ] **Step 1: Converter o roteador em ES module**

Mover `static/sw-router.js` para `src/lib/offline/sw/swRouter.js`, trocando o rodapé `if (typeof self !== 'undefined') { … }` por exports reais:

```js
export const SW_APP_SHELL_PATHS = [ /* … lista inalterada … */ ];

/**
 * @param {string} pathname
 * @param {{ isNavigation?: boolean }} [ctx]
 * @returns {'navigation'|'pdfjs'|'pdf'|'checksum'|'package-zip'|'hashed-asset'|'app-shell'|'default'}
 */
export function matchSwRoute(pathname, ctx) {
  /* … corpo inalterado … */
}
```

E simplificar `src/lib/offline/sw/swRouter.test.js`, trocando o preâmbulo de `node:vm` por:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchSwRoute } from './swRouter.js';
```

Os oito casos de teste ficam idênticos.

- [ ] **Step 2: Rodar e confirmar que os testes continuam passando**

```bash
node --test src/lib/offline/sw/swRouter.test.js
```

Esperado: PASS — 8 testes, agora sem sandbox.

- [ ] **Step 3: Criar o worker com precache derivado do build**

Criar `src/service-worker.js`. O SvelteKit expõe `build` (chunks versionados), `files` (conteúdo de `static/`) e `version` (identificador do deploy):

```js
/// <reference types="@sveltejs/kit" />

import { build, files, version } from '$service-worker';
import { matchSwRoute, SW_APP_SHELL_PATHS } from '$lib/offline/sw/swRouter.js';

// Versão atrelada ao deploy: o activate passa a invalidar sozinho.
const APP_CACHE = `plpc-${version}-app`;
// Cache de PDFs é deliberadamente sem versão — sobrevive a deploys.
const PDF_CACHE = 'plpc-pdfs';

/** Assets de `static/` que fazem parte do shell (ícones, manifest, CSS do viewer). */
const STATIC_SHELL = files.filter(
  (f) => !f.startsWith('/pdfs/') && !f.endsWith('.map') && !f.endsWith('.d.mts')
);

/** Tudo que precisa existir para o app abrir offline. */
const PRECACHE = [...build, ...STATIC_SHELL, '/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('plpc-') && name !== APP_CACHE && name !== PDF_CACHE)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});
```

`build` já contém os chunks `/_app/immutable/...` do PDF.js — o achado #03 fica resolvido de forma definitiva, e `warmPdfJsCache` (Task 3 do plano anterior) vira redundante. Remova-a e sua chamada em `+layout.svelte`.

- [ ] **Step 4: Declarar as estratégias como dados**

Ainda em `src/service-worker.js`, abaixo do `activate`:

```js
/**
 * Uma estratégia por rota. A tabela é a única definição de comportamento de
 * cache do app — nada de `if` encadeado (achado #02).
 * @type {Record<string, (event: FetchEvent) => Promise<Response>>}
 */
const STRATEGIES = {
  // Documentos: rede primeiro, cache como rede de segurança offline.
  navigation: async (event) => {
    try {
      return await fetch(event.request);
    } catch {
      const cached = await caches.match(event.request);
      return cached || (await caches.match('/')) || Response.error();
    }
  },

  // PDFs do acervo: cache primeiro; é o conteúdo que o modo offline existe para servir.
  pdf: (event) => cacheFirst(event, PDF_CACHE),

  // CSS do viewer, servido de /pdfjs/.
  pdfjs: (event) => cacheFirst(event, APP_CACHE),

  // Checksum: sempre fresco, nunca em cache.
  checksum: (event) => fetch(event.request.clone(), { cache: 'no-store' }),

  // Pacotes de ~30 MB: rede apenas; entram no cache já extraídos, como PDFs.
  'package-zip': (event) => fetch(event.request.clone(), { cache: 'no-store' }),

  // Chunks versionados: já estão no precache; cache primeiro é seguro e rápido.
  'hashed-asset': (event) => cacheFirst(event, APP_CACHE),

  'app-shell': (event) => cacheFirst(event, APP_CACHE),

  default: (event) => cacheFirst(event, APP_CACHE)
};

/**
 * @param {FetchEvent} event
 * @param {string} cacheName
 * @returns {Promise<Response>}
 */
async function cacheFirst(event, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);
  if (cached) return cached;

  const response = await fetch(event.request);
  if (response && response.status === 200) {
    cache.put(event.request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const route = matchSwRoute(url.pathname, { isNavigation: event.request.mode === 'navigate' });
  event.respondWith(STRATEGIES[route](event));
});
```

- [ ] **Step 5: Migrar os handlers de mensagem**

Copiar de `static/sw.js` para `src/service-worker.js`, sem alteração de lógica, o `addEventListener('message', …)` inteiro e as funções que ele chama: `handleDownloadPDFs`, `handleCancelDownload`, `handleGetCachedPDFs`, `handleClearCache`, `handleClearPdfCacheEntry`, `handleClearLouvoresManifestCache`, `notifyClientsCacheUpdated`, e o objeto `downloadState`.

As funções de normalização hoje vindas de `sw-utils.js` (`normalizePdfPathForCache`, `createPdfRequestVariations`, `createUrlUtf8`) agora podem ser importadas como ES modules — `src/lib/offline/utils/PdfPathManager.js` e `src/lib/utils/urlEncoding.js` já têm equivalentes. Substituir os `importScripts` por imports diretos e apagar `static/sw-utils.js` e `static/sw-debug.js` (o gate de debug passa a ser uma constante de módulo alimentada pela mesma mensagem `SET_DEBUG`).

- [ ] **Step 6: Apontar o registro para o novo caminho**

Em `src/lib/utils/swRegistration.js`:

```js
    const registration = await navigator.serviceWorker.register('/service-worker.js', {
      scope: '/',
      type: 'module'
    });
```

E em `src/lib/utils/staleChunkRecovery.js`, atualizar o padrão de nomes (linhas 9-21), já que o formato mudou de `plpc-v5-app` para `plpc-<version>-app`:

```js
function isSwShellOrPdfJsCache(name) {
  if (name === PDF_CACHE_NAME) return false;
  return /^plpc-[\w.-]+-app$/.test(name);
}
```

- [ ] **Step 7: Apagar o worker antigo**

```bash
git rm static/sw.js static/sw-utils.js static/sw-debug.js
```

Confirmar que nada mais referencia `/sw.js`:

```bash
grep -rn "sw\.js\|sw-utils\|sw-debug" src/ static/ --include="*.js" --include="*.svelte" --include="*.html"
```

Esperado: nenhuma saída.

- [ ] **Step 8: Verificar a atualização entre deploys**

```bash
npm run build && npm run preview
```

1. Carregue o app, vá offline, navegue por `/`, `/biblioteca` e `/leitor`. Todas devem funcionar **sem terem sido visitadas online antes** — é isso que o precache do `build` garante e a lista manual não garantia.
2. Volte online. Faça uma alteração trivial (ex.: um espaço em `src/app.css`), rode `npm run build && npm run preview` de novo e recarregue duas vezes.
3. Em Application → Cache Storage: deve existir **um** cache `plpc-<hash>-app` (o novo) e `plpc-pdfs`. O cache do deploy anterior deve ter sido apagado pelo `activate`.
4. Confirme que `staleChunkRecovery` não disparou (nenhum reload automático, `sessionStorage.plpcjf:staleChunkRecovery` ausente).

- [ ] **Step 9: Rodar a suíte**

```bash
npm test && npm run build
```

- [ ] **Step 10: Commit**

```bash
git add -A src/service-worker.js src/lib/offline/sw/ src/lib/utils/swRegistration.js src/lib/utils/staleChunkRecovery.js static/
git commit -m "refactor(sw): precache from the SvelteKit build manifest and declare strategies as data"
```

---

### Task 7: Retentativa e retomada no download por partes (#06)

Uma falha de rede em qualquer `fetch` de parte lança e encerra o download inteiro, e não há registro de quais partes já terminaram. Cair na parte 12 de 17 significa refazer 12 partes de ~30 MB. O contraste é gritante: o download do manifesto (1,45 MB) tem quatro tentativas com backoff; o de 846 MB não tem nenhuma.

**Files:**
- Create: `src/lib/offline/download/partProgress.js`
- Create: `src/lib/offline/download/partProgress.test.js`
- Modify: `src/lib/stores/offline.js:578-840` (`startZipDownloadWithSpecificParts`)

**Interfaces:**
- Consumes: `iterateZipEntriesCd` (Task 5 do plano anterior).
- Produces:
  - `readCompletedParts(storage, downloadKey): Set<string>`
  - `markPartCompleted(storage, downloadKey, filename): void`
  - `clearCompletedParts(storage, downloadKey): void`
  - `fetchWithRetry(url, init, options): Promise<Response>` — `options: { attempts?: number, baseDelayMs?: number, signal?: AbortSignal, onRetry?: (attempt: number, error: Error) => void }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/offline/download/partProgress.test.js`:

```js
/**
 * Progresso por parte e retentativa. Run: node --test src/lib/offline/download/partProgress.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  readCompletedParts,
  markPartCompleted,
  clearCompletedParts,
  fetchWithRetry
} from './partProgress.js';

function createStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); }
  };
}

describe('partes concluídas', () => {
  let storage;
  beforeEach(() => { storage = createStorage(); });

  it('começa vazio', () => {
    assert.equal(readCompletedParts(storage, 'Cifra').size, 0);
  });

  it('registra e relê', () => {
    markPartCompleted(storage, 'Cifra', 'Cifra-1.zip');
    markPartCompleted(storage, 'Cifra', 'Cifra-2.zip');
    const done = readCompletedParts(storage, 'Cifra');
    assert.equal(done.has('Cifra-1.zip'), true);
    assert.equal(done.size, 2);
  });

  it('isola downloads diferentes', () => {
    markPartCompleted(storage, 'Cifra', 'Cifra-1.zip');
    assert.equal(readCompletedParts(storage, 'Partitura').size, 0);
  });

  it('limpa ao concluir', () => {
    markPartCompleted(storage, 'Cifra', 'Cifra-1.zip');
    clearCompletedParts(storage, 'Cifra');
    assert.equal(readCompletedParts(storage, 'Cifra').size, 0);
  });

  it('sobrevive a JSON corrompido', () => {
    storage.setItem('plpc:downloadParts:Cifra', '{quebrado');
    assert.equal(readCompletedParts(storage, 'Cifra').size, 0);
  });
});

describe('fetchWithRetry', () => {
  it('devolve na primeira tentativa quando dá certo', async () => {
    let calls = 0;
    const fakeFetch = async () => { calls++; return { ok: true, status: 200 }; };
    const res = await fetchWithRetry('/x.zip', {}, { fetchImpl: fakeFetch });
    assert.equal(res.ok, true);
    assert.equal(calls, 1);
  });

  it('reintenta erro de transporte e acaba dando certo', async () => {
    let calls = 0;
    const fakeFetch = async () => {
      calls++;
      if (calls < 3) throw new Error('network');
      return { ok: true, status: 200 };
    };
    const res = await fetchWithRetry('/x.zip', {}, { fetchImpl: fakeFetch, baseDelayMs: 1 });
    assert.equal(res.ok, true);
    assert.equal(calls, 3);
  });

  it('reintenta 5xx mas não 404', async () => {
    let calls = 0;
    const fakeFetch = async () => { calls++; return { ok: false, status: 404 }; };
    await assert.rejects(
      () => fetchWithRetry('/x.zip', {}, { fetchImpl: fakeFetch, baseDelayMs: 1 }),
      /404/
    );
    assert.equal(calls, 1);
  });

  it('desiste após o número de tentativas', async () => {
    let calls = 0;
    const fakeFetch = async () => { calls++; throw new Error('network'); };
    await assert.rejects(
      () => fetchWithRetry('/x.zip', {}, { fetchImpl: fakeFetch, attempts: 3, baseDelayMs: 1 })
    );
    assert.equal(calls, 3);
  });

  it('propaga AbortError sem reintentar', async () => {
    let calls = 0;
    const fakeFetch = async () => {
      calls++;
      throw new DOMException('abort', 'AbortError');
    };
    await assert.rejects(() => fetchWithRetry('/x.zip', {}, { fetchImpl: fakeFetch, baseDelayMs: 1 }));
    assert.equal(calls, 1);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
node --test src/lib/offline/download/partProgress.test.js
```

Esperado: FAIL — módulo inexistente.

- [ ] **Step 3: Escrever o módulo**

Criar `src/lib/offline/download/partProgress.js`:

```js
/**
 * Retomada e retentativa do download por partes.
 *
 * Cada pacote tem ~30 MB e uma categoria chega a 17 partes: sem isso, uma queda
 * de rede na parte 12 obrigava a refazer as 12 anteriores.
 */

const KEY_PREFIX = 'plpc:downloadParts:';

/**
 * @param {Storage} storage
 * @param {string} downloadKey normalmente a categoria
 * @returns {Set<string>} nomes de arquivo das partes já gravadas
 */
export function readCompletedParts(storage, downloadKey) {
  try {
    const raw = storage.getItem(KEY_PREFIX + downloadKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

/**
 * @param {Storage} storage
 * @param {string} downloadKey
 * @param {string} filename
 */
export function markPartCompleted(storage, downloadKey, filename) {
  try {
    const done = readCompletedParts(storage, downloadKey);
    done.add(filename);
    storage.setItem(KEY_PREFIX + downloadKey, JSON.stringify([...done]));
  } catch {
    // Sem persistência: o download continua, só perde a retomada.
  }
}

/**
 * @param {Storage} storage
 * @param {string} downloadKey
 */
export function clearCompletedParts(storage, downloadKey) {
  try {
    storage.removeItem(KEY_PREFIX + downloadKey);
  } catch {
    // ignorar
  }
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {number} status
 * @returns {boolean}
 */
function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * fetch com backoff exponencial. Não reintenta cancelamento nem 4xx (exceto 408/429).
 *
 * @param {string} url
 * @param {RequestInit} init
 * @param {{ attempts?: number, baseDelayMs?: number, fetchImpl?: typeof fetch, onRetry?: (attempt: number, error: Error) => void }} [options]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, init, options = {}) {
  const attempts = options.attempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 800;
  const fetchImpl = options.fetchImpl ?? fetch;

  /** @type {Error | null} */
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }

    /** @type {Response} */
    let response;

    // Só a chamada fica dentro do try: assim a decisão sobre o status HTTP
    // acontece fora, e um `throw` de erro não-retentável não é reengolido
    // pelo próprio catch.
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      // Cancelamento do usuário nunca é retentado.
      if (error?.name === 'AbortError') throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      options.onRetry?.(attempt + 1, lastError);
      continue;
    }

    if (response.ok) return response;

    lastError = new Error(`HTTP ${response.status} ao baixar ${url}`);
    // 404, 403 e afins não melhoram com repetição — desiste imediatamente.
    if (!isRetryableStatus(response.status)) throw lastError;
    options.onRetry?.(attempt + 1, lastError);
  }

  throw lastError ?? new Error(`Falha ao baixar ${url}`);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
node --test src/lib/offline/download/partProgress.test.js
```

Esperado: PASS — 10 testes.

- [ ] **Step 5: Ligar no fluxo de download**

Em `src/lib/stores/offline.js`, acrescentar o import:

```js
import {
  readCompletedParts,
  markPartCompleted,
  clearCompletedParts,
  fetchWithRetry
} from '$lib/offline/download/partProgress.js';
```

Dentro do laço `for (const part of requiredParts)` de `startZipDownloadWithSpecificParts`, envolver com a retomada e trocar o `fetch` cru:

```js
      const completedParts = readCompletedParts(localStorage, category);

      for (const part of requiredParts) {
        if (zipDownloadCancelled) throw new Error('DOWNLOAD_CANCELLED');

        // Retomada: partes já gravadas em uma tentativa anterior são puladas.
        if (completedParts.has(part.filename)) {
          console.info(`[Offline Store] Parte já baixada, pulando: ${part.filename}`);
          continue;
        }

        const packageUrl = normalizePackageUrl(part.url, part.filename);

        const response = await fetchWithRetry(
          packageUrl,
          { signal: zipDownloadController.signal, cache: 'no-store' },
          {
            attempts: 4,
            onRetry: (attempt, error) => {
              console.warn(`[Offline Store] Tentativa ${attempt} de ${part.filename}:`, error.message);
            }
          }
        );

        // … extração por streaming, inalterada …

        markPartCompleted(localStorage, category, part.filename);
      }
```

E ao concluir a categoria inteira com sucesso, antes de sair do laço de categorias:

```js
      clearCompletedParts(localStorage, category);
```

Substituir o `catch` que traduz `AbortError` para garantir que ele **não** limpa as partes concluídas — é justamente o que permite retomar.

- [ ] **Step 6: Verificar a retomada**

```bash
npm run build && npm run preview
```

1. Inicie o download de uma categoria com várias partes.
2. Após duas ou três partes, desligue a rede (DevTools → Network → Offline). O download deve mostrar erro após as retentativas, **sem** travar a interface.
3. No console: `JSON.parse(localStorage.getItem('plpc:downloadParts:Cifra'))` → array com as partes já gravadas.
4. Religue a rede e reinicie o download da mesma categoria. As partes listadas devem ser puladas (procure as linhas "Parte já baixada, pulando").
5. Ao concluir, a chave `plpc:downloadParts:Cifra` deve ter sumido.

- [ ] **Step 7: Rodar a suíte**

```bash
npm test
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/offline/download/partProgress.js src/lib/offline/download/partProgress.test.js src/lib/stores/offline.js
git commit -m "feat(offline): retry each package part with backoff and resume interrupted downloads"
```

---

### Task 8: Progresso legível durante o download (#25)

O estado exposto durante um download de até 17 partes de ~30 MB é `progress`, `completed`, `failed` e `total`, contados em PDFs. O usuário vê uma porcentagem parada por minutos enquanto uma parte baixa e descomprime — e é isso que faz alguém fechar o app.

**Files:**
- Modify: `src/lib/stores/offline.js` (novos campos de estado)
- Modify: `src/routes/offline/+page.svelte` (bloco de progresso)

**Interfaces:**
- Consumes: `readCompletedParts` (Task 7).
- Produces: `offlineState` ganha `currentPart: number`, `totalParts: number`, `currentPartName: string`, `bytesDownloaded: number`, `bytesTotal: number`, `phase: 'baixando' | 'extraindo' | 'gravando' | null`.

- [ ] **Step 1: Estender o estado**

Em `src/lib/stores/offline.js`, no `offlineState.update` que abre `startZipDownloadWithSpecificParts` (linha ~606), acrescentar os campos:

```js
    offlineState.update(state => ({
      ...state,
      downloading: true,
      autoDownloading: false,
      progress: total === 0 ? 100 : 0,
      completed: 0,
      failed: 0,
      total,
      currentPart: 0,
      totalParts: Object.values(partsByCategory).reduce((n, parts) => n + parts.length, 0),
      currentPartName: '',
      bytesDownloaded: 0,
      bytesTotal: Object.values(partsByCategory)
        .flat()
        .reduce((n, part) => n + (part.size || 0), 0),
      phase: null,
      selectedCategories: categories,
      error: null
    }));
```

E dentro do laço de partes, marcar cada fase:

```js
        partIndex++;
        offlineState.update(s => ({
          ...s,
          currentPart: partIndex,
          currentPartName: part.filename,
          phase: 'baixando'
        }));

        const response = await fetchWithRetry(/* … */);

        offlineState.update(s => ({ ...s, phase: 'extraindo' }));
        const blob = await response.blob();

        offlineState.update(s => ({
          ...s,
          phase: 'gravando',
          bytesDownloaded: s.bytesDownloaded + (part.size || blob.size)
        }));

        for await (const { name, data } of iterateZipEntriesCd(blob, zipDownloadController.signal)) {
          /* … inalterado … */
        }
```

Declarar `let partIndex = 0;` antes do laço de categorias.

- [ ] **Step 2: Mostrar na interface**

Em `src/routes/offline/+page.svelte`, no bloco que exibe o progresso do download, substituir a barra solitária por:

```svelte
{#if $offlineState.downloading}
  <div class="download-progress" role="status" aria-live="polite">
    <div class="download-progress-header">
      <span class="download-part">
        Parte {$offlineState.currentPart} de {$offlineState.totalParts}
      </span>
      <span class="download-phase">
        {#if $offlineState.phase === 'baixando'}Baixando{:else if $offlineState.phase === 'extraindo'}Extraindo{:else if $offlineState.phase === 'gravando'}Gravando{/if}
        {$offlineState.currentPartName}
      </span>
    </div>

    <div class="progress-bar-track">
      <div class="progress-bar-fill" style={`width: ${$offlineState.progress}%`}></div>
    </div>

    <div class="download-progress-footer">
      <span>{formatSize($offlineState.bytesDownloaded)} de {formatSize($offlineState.bytesTotal)}</span>
      <span>{$offlineState.completed} de {$offlineState.total} louvores</span>
    </div>

    <p class="download-warning">
      Mantenha o app aberto até terminar. Se a conexão cair, o download retoma da parte
      em que parou na próxima tentativa.
    </p>
  </div>
{/if}
```

`formatSize` já existe no arquivo (linha 915).

- [ ] **Step 3: Estilizar**

Acrescentar ao `<style>` de `src/routes/offline/+page.svelte`, junto dos estilos de progresso existentes:

```css
  .download-progress-header,
  .download-progress-footer {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.85rem;
  }

  .download-part {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .download-phase {
    color: var(--placeholder-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .download-progress-footer {
    margin-top: 0.5rem;
    color: var(--placeholder-color);
    font-variant-numeric: tabular-nums;
  }

  .download-warning {
    margin-top: 0.75rem;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--placeholder-color);
  }
```

- [ ] **Step 4: Verificar**

```bash
npm run build && npm run preview
```

Inicie um download e confirme: o contador de partes avança, o rótulo de fase alterna entre Baixando/Extraindo/Gravando, os MB sobem, e o aviso aparece. Com o VoiceOver ligado, o `aria-live="polite"` deve anunciar a troca de parte sem interromper.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/offline.js src/routes/offline/+page.svelte
git commit -m "feat(offline): show part, phase and byte progress during package download"
```

---

### Task 9: Distinguir os três estados vazios da home (#27)

`filterLouvores` chama `finalizeFilteredResults([])` em três situações com causas e saídas completamente diferentes — busca em branco, nenhuma categoria marcada, nenhum resultado — e todas produzem a mesma tela vazia. Quem desmarcou todos os arranjos sem perceber conclui que o catálogo sumiu.

**Files:**
- Modify: `src/routes/+page.svelte` (`filterLouvores`, bloco `{#if groupedResults.length > 0}`)

**Interfaces:**
- Consumes: nada.
- Produces: variável de módulo `emptyReason: 'aguardando-busca' | 'sem-categoria' | 'sem-arranjo' | 'sem-resultado' | null`.

- [ ] **Step 1: Registrar o motivo em cada saída vazia**

Em `src/routes/+page.svelte`, declarar junto das outras variáveis de estado:

```js
  /** @type {'aguardando-busca' | 'sem-categoria' | 'sem-arranjo' | 'sem-resultado' | null} */
  let emptyReason = null;
```

E em `filterLouvores`, anotar cada ramo antes do `finalizeFilteredResults([])`:

```js
    if (!$louvores || $louvores.length === 0) {
      emptyReason = 'aguardando-busca';
      finalizeFilteredResults([]);
      return;
    }
    // …
    if (activeCategories.length === 0) {
      emptyReason = 'sem-categoria';
      finalizeFilteredResults([]);
      return;
    }
    // …
    if (selectedFilters.length === 0) {
      emptyReason = 'sem-arranjo';
      finalizeFilteredResults([]);
      return;
    }
    // …
    if (!searchQuery.trim()) {
      emptyReason = 'aguardando-busca';
      finalizeFilteredResults([]);
      return;
    }
```

E nos dois ramos que efetivamente filtram (busca por número e por texto), antes de `finalizeFilteredResults(...)`:

```js
    emptyReason = 'sem-resultado';
```

(`emptyReason` só é lido quando a lista está vazia, então marcá-lo antes do filtro é suficiente.)

- [ ] **Step 2: Trocar o estado vazio por três mensagens com ação**

No template, substituir o `{:else}` do bloco `{#if groupedResults.length > 0}` por:

```svelte
    {:else}
      <div class="empty-state" role="status">
        {#if emptyReason === 'sem-categoria'}
          <p class="empty-title">Nenhuma categoria selecionada</p>
          <p class="empty-hint">Marque ao menos uma categoria para ver louvores.</p>
          <button type="button" class="empty-action" on:click={() => filters.selectAll(CATEGORY_OPTIONS)}>
            Selecionar todas as categorias
          </button>
        {:else if emptyReason === 'sem-arranjo'}
          <p class="empty-title">Nenhum arranjo selecionado</p>
          <p class="empty-hint">Marque ao menos um arranjo para ver louvores.</p>
          <button
            type="button"
            class="empty-action"
            on:click={() => classificationFilters.selectAll(uniqueNormalizedClassifications)}
          >
            Selecionar todos os arranjos
          </button>
        {:else if emptyReason === 'sem-resultado'}
          <p class="empty-title">Nenhum louvor encontrado para “{searchQuery}”</p>
          <p class="empty-hint">
            Tente outro trecho do título, ou o número do louvor. A busca ignora acentos e
            palavras como “o”, “de”, “que”.
          </p>
          <button type="button" class="empty-action" on:click={handleClear}>Limpar pesquisa</button>
        {:else}
          <p class="empty-title">Busque um louvor</p>
          <p class="empty-hint">Digite parte do título ou o número para começar.</p>
        {/if}
      </div>
    {/if}
```

Verifique as assinaturas antes de usar: `filters.selectAll` e `classificationFilters.selectAll` — confirme com

```bash
grep -n "selectAll" src/lib/stores/filters.js src/lib/stores/classificationFilters.js
```

Se `filters` não tiver `selectAll`, use o método equivalente que existir (por exemplo `filters.set(CATEGORY_OPTIONS)`).

- [ ] **Step 3: Estilizar**

No `<style>` de `src/routes/+page.svelte`:

```css
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 3rem 1.5rem;
    text-align: center;
    max-width: 42ch;
  }

  .empty-title {
    font-family: 'EB Garamond', serif;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--card-color);
    margin: 0;
  }

  .empty-hint {
    font-size: 0.9rem;
    line-height: 1.6;
    color: var(--placeholder-color);
    margin: 0;
  }

  .empty-action {
    margin-top: 0.75rem;
    padding: 0.5rem 1.25rem;
    border: 1px solid var(--gold-color);
    border-radius: 24px;
    background: transparent;
    color: var(--gold-color);
    font-weight: 600;
    cursor: pointer;
  }

  .empty-action:hover {
    background: var(--gold-color);
    color: var(--background-color);
  }
```

- [ ] **Step 4: Verificar os quatro estados**

```bash
npm run build && npm run preview
```

1. Home recém-carregada, sem busca → "Busque um louvor".
2. Digite "zzzqqq" → "Nenhum louvor encontrado para 'zzzqqq'" com o botão de limpar.
3. Desmarque todas as categorias → "Nenhuma categoria selecionada"; o botão restaura e a lista volta.
4. Desmarque todos os arranjos → "Nenhum arranjo selecionado"; o botão restaura.

- [ ] **Step 5: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat(ui): distinguish the four empty states on the home page"
```

---

### Task 10: Estado de carregamento na home e na biblioteca (#28)

A página offline tem um conjunto de skeletons bem feito. As duas telas principais não têm nada entre a montagem e a lista pronta — e há 1,45 MB de manifesto nesse intervalo.

**Files:**
- Create: `src/lib/components/LouvorCardSkeleton.svelte`
- Modify: `src/routes/+page.svelte`, `src/routes/biblioteca/+page.svelte`

**Interfaces:**
- Consumes: `$louvoresLoaded` do store `louvores`.
- Produces: componente `<LouvorCardSkeleton count={number} />`.

- [ ] **Step 1: Criar o componente**

Criar `src/lib/components/LouvorCardSkeleton.svelte`:

```svelte
<script>
  /** Quantos cards-fantasma renderizar. */
  export let count = 5;
</script>

<div class="skeleton-list" aria-hidden="true">
  {#each Array(count) as _, i (i)}
    <div class="skeleton-card">
      <div class="skeleton-line title"></div>
      <div class="skeleton-line subtitle"></div>
      <div class="skeleton-chips">
        <div class="skeleton-chip"></div>
        <div class="skeleton-chip"></div>
      </div>
    </div>
  {/each}
</div>

<style>
  .skeleton-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
  }

  .skeleton-card {
    background: var(--card-color);
    border-radius: 12px;
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    opacity: 0.45;
  }

  .skeleton-line,
  .skeleton-chip {
    background: linear-gradient(90deg, #d8ccae 25%, #ece2c9 50%, #d8ccae 75%);
    background-size: 200% 100%;
    border-radius: 4px;
    animation: shimmer 1.4s ease-in-out infinite;
  }

  .skeleton-line.title { height: 1.1rem; width: 60%; }
  .skeleton-line.subtitle { height: 0.8rem; width: 35%; }

  .skeleton-chips { display: flex; gap: 0.5rem; }
  .skeleton-chip { height: 1.6rem; width: 5.5rem; border-radius: 24px; }

  @keyframes shimmer {
    from { background-position: 200% 0; }
    to { background-position: -200% 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton-line,
    .skeleton-chip {
      animation: none;
    }
  }
</style>
```

- [ ] **Step 2: Usar na home**

Em `src/routes/+page.svelte`, importar e inserir como primeiro ramo do bloco de resultados:

```svelte
  import LouvorCardSkeleton from '$lib/components/LouvorCardSkeleton.svelte';
```

```svelte
  <div id="home-louvores-results" class="mt-8 flex justify-center">
    {#if !$louvoresLoaded}
      <div class="louvores-container w-full max-w-4xl">
        <span class="container-tag">Louvores</span>
        <LouvorCardSkeleton count={5} />
      </div>
    {:else if groupedResults.length > 0}
      <!-- … lista existente … -->
    {:else}
      <!-- … estados vazios da Task 9 … -->
    {/if}
  </div>
```

- [ ] **Step 3: Usar na biblioteca**

Em `src/routes/biblioteca/+page.svelte`, importar o mesmo componente e envolver a `.louvores-list` (linha ~959) com a mesma guarda:

```svelte
        {#if !$louvoresLoaded}
          <LouvorCardSkeleton count={10} />
        {:else}
          <div class="louvores-list">
            {#each paginatedLouvores as group (getGroupKey(group))}
              <LouvorCard louvor={group.materials[0]} materials={group.materials} />
            {/each}
          </div>
        {/if}
```

- [ ] **Step 4: Verificar**

```bash
npm run build && npm run preview
```

Em DevTools → Network, aplique throttling "Slow 3G" e recarregue a home e a biblioteca. Os skeletons devem aparecer e ser substituídos pela lista real. Com "Reduce motion" ligado no sistema, o shimmer deve parar (mas os blocos continuam visíveis).

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/LouvorCardSkeleton.svelte src/routes/+page.svelte src/routes/biblioteca/+page.svelte
git commit -m "feat(ui): show loading skeletons on home and library while the manifest loads"
```

---

### Task 11: Cobrir a normalização de caminho com testes de tabela (#24)

Os testes existentes cobrem `bundleValidation`, `zipCdReader`, rollback de import, checksum e `groupLouvores` — tudo que já funciona. Não há nenhum para a divergência entre as duas normalizações de caminho, que é a origem dos achados #09, #11 e #22. Esta tarefa não corrige a divergência (isso é #22, projeto próprio); ela a **documenta em código executável**, para que a unificação futura tenha um alvo verificável.

**Files:**
- Create: `src/lib/utils/pathNormalization.contract.test.js`

**Interfaces:**
- Consumes: `normalizePdfUrl`, `getPdfRelPath` de `./pathUtils.js`; `normalizeForStorage` de `../offline/utils/PdfPathManager.js`.
- Produces: nada. Teste de caracterização.

- [ ] **Step 1: Confirmar que PdfPathManager é importável sem `$lib`**

```bash
grep -n "^import" src/lib/offline/utils/PdfPathManager.js
```

Se houver algum import de `$lib`, este teste não roda sob `node --test`. Nesse caso, extraia primeiro a função pura para um módulo com imports relativos e ajuste o teste.

- [ ] **Step 2: Escrever o teste de caracterização**

Criar `src/lib/utils/pathNormalization.contract.test.js`:

```js
/**
 * Contrato de normalização de caminho de PDF.
 *
 * Este teste NÃO afirma que o comportamento atual é o certo — ele registra
 * exatamente onde as duas normalizações divergem, para que a unificação
 * (achado #22) tenha um alvo verificável e para que a divergência não aumente.
 *
 * Run: node --test src/lib/utils/pathNormalization.contract.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePdfUrl, getPdfRelPath } from './pathUtils.js';
import PdfPathManager from '../offline/utils/PdfPathManager.js';

const encode = (s) => Buffer.from(s, 'utf8').toString('base64');

const CASES = [
  { rotulo: 'simples', entrada: 'assets/ColAdultos/001.pdf' },
  { rotulo: 'com acento', entrada: 'assets/Coletânea/Cifra.pdf' },
  { rotulo: 'com espaço', entrada: 'assets/PES CIAs/Coro.pdf' },
  { rotulo: 'nível romano', entrada: 'assets/Col/Cifra nível I.pdf' },
  { rotulo: 'percent-encoded', entrada: 'assets/Cole%C3%A2nea/Cifra.pdf' },
  { rotulo: 'dupla codificação', entrada: 'assets/Cole%25C3%25A2nea/Cifra.pdf' },
  { rotulo: 'barra invertida', entrada: 'assets\\Col\\Cifra.pdf' },
  { rotulo: 'sem prefixo assets', entrada: 'ColAdultos/001.pdf' },
  { rotulo: 'barra inicial', entrada: '/assets/ColAdultos/001.pdf' },
  { rotulo: 'URL completa', entrada: 'https://plpcg.com/assets/ColAdultos/001.pdf' }
];

describe('normalizePdfUrl (pathUtils) — minúsculas e sem acento', () => {
  for (const { rotulo, entrada } of CASES) {
    it(`é idempotente: ${rotulo}`, () => {
      const uma = normalizePdfUrl(entrada);
      assert.equal(normalizePdfUrl(uma), uma, `normalizePdfUrl não é idempotente para ${rotulo}`);
    });

    it(`sempre começa com assets/: ${rotulo}`, () => {
      assert.match(normalizePdfUrl(entrada), /^assets\//);
    });
  }

  it('minúsculas e acentos removidos', () => {
    assert.equal(normalizePdfUrl('assets/Coletânea/Cifra nível I.pdf'), 'assets/coletanea/cifra nivel i.pdf');
  });
});

describe('PdfPathManager.normalizeForStorage — preserva caixa e acento', () => {
  for (const { rotulo, entrada } of CASES) {
    it(`é idempotente: ${rotulo}`, () => {
      const uma = PdfPathManager.normalizeForStorage(entrada);
      assert.equal(
        PdfPathManager.normalizeForStorage(uma),
        uma,
        `normalizeForStorage não é idempotente para ${rotulo}`
      );
    });
  }
});

describe('divergência conhecida entre as duas normalizações (achado #22)', () => {
  it('divergem em caixa e acento — é o que a unificação precisa resolver', () => {
    const entrada = 'assets/Coletânea/Cifra nível I.pdf';
    assert.notEqual(
      normalizePdfUrl(entrada),
      PdfPathManager.normalizeForStorage(entrada),
      'Se este teste falhar, as duas normalizações convergiram: revise o achado #22.'
    );
  });
});

describe('getPdfRelPath preserva o caminho original do pdfId', () => {
  it('não normaliza caixa nem acento', () => {
    const pdfId = encode('05042026/Bênção Aarônica/Coro.pdf');
    assert.equal(getPdfRelPath({ pdfId }), 'assets/05042026/Bênção Aarônica/Coro.pdf');
  });

  it('decodifica base64 como UTF-8, não latin-1', () => {
    // O bug clássico: atob() puro devolveria "BÃªnÃ§Ã£o".
    const pdfId = encode('a/Bênção.pdf');
    assert.equal(getPdfRelPath({ pdfId }), 'assets/a/Bênção.pdf');
  });
});
```

- [ ] **Step 3: Rodar**

```bash
node --test src/lib/utils/pathNormalization.contract.test.js
```

Esperado: PASS. **Se algum caso de idempotência falhar, isso é um defeito real encontrado** — registre-o e trate antes de seguir; é exatamente para isso que este teste existe.

- [ ] **Step 4: Commit**

```bash
git add src/lib/utils/pathNormalization.contract.test.js
git commit -m "test: characterize PDF path normalization and lock in the known divergence"
```

---

### Task 12: Zerar `svelte-check` em `src/lib/offline/**` e travar no CI (#20)

`npm run check` acusa 1.154 erros em 94 arquivos. Uma verificação que sempre falha é equivalente a não ter verificação. A estratégia não é zerar tudo — é escolher uma pasta, zerá-la e travá-la, depois expandir.

**Files:**
- Create: `tsconfig.offline.json`
- Modify: `package.json` (script `check:offline`)
- Modify: arquivos em `src/lib/offline/**` conforme os erros apontarem

**Interfaces:**
- Consumes: nada.
- Produces: script `npm run check:offline`, que deve sair com código 0.

- [ ] **Step 1: Medir a linha de base da pasta**

```bash
npx svelte-check --tsconfig ./tsconfig.json --output human 2>&1 | grep "src/lib/offline" | grep -c "Error"
```

Anote o número — é a meta a levar a zero.

- [ ] **Step 2: Criar um tsconfig restrito à pasta**

Criar `tsconfig.offline.json`:

```json
{
  "extends": "./tsconfig.json",
  "include": ["src/lib/offline/**/*.js"],
  "compilerOptions": {
    "checkJs": true,
    "strict": false,
    "noImplicitAny": true,
    "useUnknownInCatchVariables": true
  }
}
```

- [ ] **Step 3: Adicionar o script**

Em `package.json`:

```json
"check:offline": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.offline.json --fail-on-warnings false"
```

- [ ] **Step 4: Rodar e listar os erros**

```bash
npm run check:offline 2>&1 | tee /tmp/plpc-offline-check.txt
grep -c "Error:" /tmp/plpc-offline-check.txt
```

- [ ] **Step 5: Corrigir por classe de erro, não por arquivo**

Os erros se concentram em três padrões. Corrija um padrão de cada vez, rodando `npm run check:offline` entre eles:

**Padrão 1 — `'error' is of type 'unknown'`.** Em cada `catch (error)` que acessa `error.message`:

```js
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Modulo', message);
  }
```

**Padrão 2 — parâmetro implicitamente `any`.** Acrescentar JSDoc à assinatura:

```js
/**
 * @param {string} pdfPath
 * @param {{ useIndex?: boolean, checkNetwork?: boolean, pdfId?: string | null }} [options]
 * @returns {Promise<{ available: boolean, needsDownload: boolean, url: string | null, source: string }>}
 */
async validate(pdfPath, options = {}) {
```

**Padrão 3 — índice de objeto sem tipo.** Anotar o mapa na declaração:

```js
/** @type {Record<string, { total: number, available: number, missing: number, percentage: number }>} */
const categoryStats = {};
```

- [ ] **Step 6: Confirmar zero**

```bash
npm run check:offline
```

Esperado: `svelte-check found 0 errors`.

- [ ] **Step 7: Travar**

Se houver CI configurado, acrescentar `npm run check:offline` ao pipeline. Se não houver, criar `.github/workflows/check.yml`:

```yaml
name: check
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.node-version'
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run check:offline
      - run: npm run build
```

E documentar a regra de expansão no topo de `tsconfig.offline.json` — ao zerar uma pasta nova, acrescentá-la ao `include`.

- [ ] **Step 8: Commit**

```bash
git add tsconfig.offline.json package.json .github/workflows/check.yml src/lib/offline/
git commit -m "chore: bring src/lib/offline to zero svelte-check errors and gate it in CI"
```

---

### Task 13: Reescrever a sincronização URL ↔ estado em direção única (#21)

Home e biblioteca mantêm seis flags (`isUpdatingFromUrl`, `isUpdatingPageFromUrl`, `isUpdatingSortFromUrl`, `isUpdatingItemsPerPageFromUrl`, `isUpdatingArranjoEspecialFromUrl`) e um objeto `lastKnownUrlState`, todos reabilitados por `setTimeout` de 0 a 100 ms, para evitar laços entre blocos reativos que leem **e** escrevem a URL. Uma janela de 100 ms é uma corrida, não uma garantia — e foi exatamente aqui que a telemetria do achado #19 foi plantada.

A regra que elimina o problema: **a URL é a fonte da verdade; blocos reativos só leem, handlers de evento só escrevem.** Sem escrita reativa não há laço, e as seis flags desaparecem.

Esta é a tarefa de maior superfície do plano. Faça-a por último e numa branch própria.

**Files:**
- Create: `src/lib/utils/listViewState.js`
- Create: `src/lib/utils/listViewState.test.js`
- Modify: `src/routes/+page.svelte` (blocos de sincronização, `setPage`, `finalizeFilteredResults`, `flushSearchToUrlOnBlur`)
- Modify: `src/routes/biblioteca/+page.svelte` (blocos de sincronização, `setPage`)

**Interfaces:**
- Consumes: `parseUrlParams`, `updateUrlParams` de `$lib/utils/urlSync.js`.
- Produces:
  - `readListViewState(url: URL, defaults?: Partial<ListViewState>): ListViewState` onde
    `ListViewState = { pesquisa: string, pagina: number, itensPorPagina: number, ordenar: 'numero'|'nome', arranjoEspecial: string[] }`
  - `clampPage(pagina: number, totalPages: number): number`
  - `listViewStateToParams(state: Partial<ListViewState>): Record<string, unknown>`

- [ ] **Step 1: Criar a branch**

```bash
git checkout -b refactor/url-state-single-direction
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `src/lib/utils/listViewState.test.js`:

```js
/**
 * Estado de listagem derivado da URL. Run: node --test src/lib/utils/listViewState.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readListViewState, clampPage, listViewStateToParams } from './listViewState.js';

const url = (s) => new URL(s, 'https://plpcg.com');

describe('readListViewState', () => {
  it('devolve os padrões para uma URL sem parâmetros', () => {
    assert.deepEqual(readListViewState(url('/')), {
      pesquisa: '',
      pagina: 1,
      itensPorPagina: 10,
      ordenar: 'numero',
      arranjoEspecial: []
    });
  });

  it('lê todos os parâmetros', () => {
    const s = readListViewState(url('/biblioteca?pesquisa=amor&pagina=3&itensPorPagina=50&ordenar=nome'));
    assert.equal(s.pesquisa, 'amor');
    assert.equal(s.pagina, 3);
    assert.equal(s.itensPorPagina, 50);
    assert.equal(s.ordenar, 'nome');
  });

  it('rejeita valores inválidos e cai no padrão', () => {
    const s = readListViewState(url('/?pagina=-2&itensPorPagina=7&ordenar=aleatorio'));
    assert.equal(s.pagina, 1);
    assert.equal(s.itensPorPagina, 10);
    assert.equal(s.ordenar, 'numero');
  });

  it('aceita padrões injetados', () => {
    const s = readListViewState(url('/'), { itensPorPagina: 25 });
    assert.equal(s.itensPorPagina, 25);
  });

  it('lê arranjoEspecial como lista', () => {
    const s = readListViewState(url('/biblioteca?arranjoEspecial=Padr%C3%A3o,Vozes'));
    assert.deepEqual(s.arranjoEspecial, ['Padrão', 'Vozes']);
  });
});

describe('clampPage', () => {
  it('limita ao intervalo válido', () => {
    assert.equal(clampPage(5, 3), 3);
    assert.equal(clampPage(0, 3), 1);
    assert.equal(clampPage(2, 3), 2);
  });

  it('devolve 1 quando não há páginas', () => {
    assert.equal(clampPage(4, 0), 1);
  });
});

describe('listViewStateToParams', () => {
  it('omite valores iguais ao padrão, para manter a URL curta', () => {
    assert.deepEqual(listViewStateToParams({ pesquisa: '', pagina: 1, itensPorPagina: 10 }), {});
  });

  it('inclui só o que difere do padrão', () => {
    assert.deepEqual(listViewStateToParams({ pesquisa: 'amor', pagina: 2, itensPorPagina: 10 }), {
      pesquisa: 'amor',
      pagina: 2
    });
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
node --test src/lib/utils/listViewState.test.js
```

- [ ] **Step 4: Escrever o módulo**

Criar `src/lib/utils/listViewState.js`:

```js
/**
 * Estado de listagem derivado da URL.
 *
 * A URL é a única fonte da verdade para pesquisa, paginação, ordenação e filtros
 * de arranjo. Blocos reativos LEEM daqui; só handlers de evento escrevem de volta.
 * Isso elimina o laço que as seis flags `isUpdating*From*` tentavam quebrar com
 * setTimeout de 100 ms (achado #21).
 *
 * Sem imports de $lib — precisa rodar sob `node --test`.
 */

export const VALID_ITEMS_PER_PAGE = [10, 25, 50, 100];
export const VALID_SORTS = ['numero', 'nome'];

const DEFAULTS = {
  pesquisa: '',
  pagina: 1,
  itensPorPagina: 10,
  ordenar: 'numero',
  arranjoEspecial: []
};

/**
 * @typedef {{ pesquisa: string, pagina: number, itensPorPagina: number, ordenar: 'numero'|'nome', arranjoEspecial: string[] }} ListViewState
 */

/**
 * @param {URL} url
 * @param {Partial<ListViewState>} [defaults]
 * @returns {ListViewState}
 */
export function readListViewState(url, defaults = {}) {
  const base = { ...DEFAULTS, ...defaults };
  const params = url?.searchParams;
  if (!params) return base;

  const paginaRaw = Number(params.get('pagina'));
  const pagina = Number.isInteger(paginaRaw) && paginaRaw > 0 ? paginaRaw : base.pagina;

  const ippRaw = Number(params.get('itensPorPagina'));
  const itensPorPagina = VALID_ITEMS_PER_PAGE.includes(ippRaw) ? ippRaw : base.itensPorPagina;

  const ordenarRaw = params.get('ordenar');
  const ordenar = VALID_SORTS.includes(ordenarRaw) ? ordenarRaw : base.ordenar;

  const arranjoRaw = params.get('arranjoEspecial');
  const arranjoEspecial = arranjoRaw
    ? arranjoRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : base.arranjoEspecial;

  return {
    pesquisa: params.get('pesquisa') ?? base.pesquisa,
    pagina,
    itensPorPagina,
    ordenar: /** @type {'numero'|'nome'} */ (ordenar),
    arranjoEspecial
  };
}

/**
 * @param {number} pagina
 * @param {number} totalPages
 * @returns {number}
 */
export function clampPage(pagina, totalPages) {
  if (!Number.isFinite(totalPages) || totalPages < 1) return 1;
  return Math.max(1, Math.min(totalPages, Math.trunc(pagina) || 1));
}

/**
 * Converte estado em parâmetros de URL, omitindo o que é igual ao padrão.
 * @param {Partial<ListViewState>} state
 * @returns {Record<string, unknown>}
 */
export function listViewStateToParams(state) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(state)) {
    const fallback = DEFAULTS[/** @type {keyof ListViewState} */ (key)];
    const isDefault = Array.isArray(value)
      ? value.length === 0
      : value === fallback;
    if (!isDefault) out[key] = value;
  }
  return out;
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
node --test src/lib/utils/listViewState.test.js
```

Esperado: PASS — 9 testes.

- [ ] **Step 6: Converter a home para direção única**

Em `src/routes/+page.svelte`:

**Apagar** as declarações `isUpdatingFromUrl`, `isUpdatingPageFromUrl`, `isUpdatingItemsPerPageFromUrl`, `homeUrlSyncInitialized`, `lastKnownHomeUrl`, `pageInitializedFromUrl`, `lastSearchAppliedInFilter`, `lastFilterCriteriaKey`, `shouldResetPageOnFilterResult`, e todos os blocos reativos que escrevem na URL.

**Substituir** por um único bloco de leitura:

```js
  import { readListViewState, clampPage, listViewStateToParams } from '$lib/utils/listViewState.js';

  // ÚNICA leitura da URL. Nada aqui escreve de volta — é isso que quebra o laço.
  $: viewState = readListViewState($page.url, { itensPorPagina: $bibliotecaItemsPerPage });
  $: searchQuery = viewState.pesquisa;
  $: currentPage = clampPage(viewState.pagina, totalPagesHome);
  $: pageInput = String(currentPage);
```

**Escrever** só em handlers. `setPage` vira:

```js
  /**
   * @param {number} p
   * @param {{ scroll?: boolean }} [opts]
   */
  function setPage(p, { scroll = true } = {}) {
    const alvo = clampPage(p, totalPagesHome);
    updateUrlParams(listViewStateToParams({ ...viewState, pagina: alvo }));
    if (scroll && browser) {
      document.getElementById('home-louvores-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
```

O debounce da busca passa a escrever a URL diretamente, sem flag:

```js
  /** @type {ReturnType<typeof setTimeout> | null} */
  let searchDebounce = null;

  /** @param {string} texto */
  function onSearchInput(texto) {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      // Texto novo sempre volta à página 1 — não há estado a preservar.
      updateUrlParams(listViewStateToParams({ ...viewState, pesquisa: texto, pagina: 1 }));
    }, 300);
  }
```

E `flushSearchToUrlOnBlur` some: o blur passa a só fazer `clearTimeout` + a mesma escrita imediata.

`finalizeFilteredResults` deixa de mexer em página — o `clampPage` reativo já corrige quando `totalPagesHome` encolhe.

- [ ] **Step 7: Converter a biblioteca do mesmo jeito**

Em `src/routes/biblioteca/+page.svelte`, aplicar exatamente o mesmo padrão: apagar `urlSyncInitialized`, `isUpdatingSortFromUrl`, `isUpdatingItemsPerPageFromUrl`, `isUpdatingPageFromUrl`, `isUpdatingArranjoEspecialFromUrl`, `lastKnownUrlState`, `previousFilteredCount`, `pageInitializedFromUrl`; substituir por `viewState` derivado e escrita só em handlers (`goToPage`, troca de ordenação, troca de itens por página, alternância de arranjo especial).

- [ ] **Step 8: Confirmar que as flags sumiram**

```bash
grep -rn "isUpdating\|lastKnownUrlState\|lastKnownHomeUrl\|urlSyncInitialized\|pageInitializedFromUrl" src/routes/
```

Esperado: nenhuma saída.

```bash
grep -rn "setTimeout" src/routes/+page.svelte src/routes/biblioteca/+page.svelte
```

Esperado: só o debounce da busca.

- [ ] **Step 9: Verificar os cenários que as flags tentavam cobrir**

```bash
npm run build && npm run preview
```

Percorra cada um — são os casos que a corrida de 100 ms quebrava:

1. Buscar "senhor", ir para a página 3, recarregar → volta na página 3 com a busca preservada.
2. Página 3, depois voltar (botão Voltar do navegador) → volta para a página 2, depois 1.
3. Página 3, digitar uma busca nova → vai para a página 1.
4. Página 5, mudar "itens por página" de 10 para 100 → a página é limitada ao novo total, sem tela vazia.
5. Colar uma URL com `?pagina=999` → mostra a última página válida.
6. Digitar rápido e apertar Tab (blur) antes dos 300 ms → a URL recebe o texto completo, uma vez só.
7. Na biblioteca, trocar ordenação e recarregar → a ordenação persiste.
8. Abrir duas abas na mesma busca, paginar numa → a outra não muda (comportamento correto; não há sincronização entre abas para isso).

- [ ] **Step 10: Rodar tudo**

```bash
npm test && npm run build
```

- [ ] **Step 11: Commit e merge**

```bash
git add src/lib/utils/listViewState.js src/lib/utils/listViewState.test.js src/routes/+page.svelte src/routes/biblioteca/+page.svelte
git commit -m "refactor(url): make the URL the single source of truth for list state"
git checkout main && git merge --no-ff refactor/url-state-single-direction
```

---

## Verificação final do plano

- [ ] `npm test` — PASS, incluindo os ~70 testes novos deste plano.
- [ ] `npm run check:offline` — 0 erros.
- [ ] `npm run build` — conclui.
- [ ] Um PDF pedido com nome inexistente mas basename existente em outra pasta devolve 404, não o arquivo errado.
- [ ] Offline, sem nunca ter visitado `/leitor` online: a rota abre e renderiza um PDF em cache.
- [ ] Um download de categoria interrompido no meio retoma da parte correta, e a interface mostra parte, fase e MB.
- [ ] Nenhuma flag `isUpdating*` sobrou em `src/routes/`.

Fora de escopo, por decisão registrada na auditoria: #10 (parcialmente resolvido na Task 1), #16 (`content-visibility`), #18 (cópia do pdfjs), #22 (unificação da normalização — projeto próprio, preparado pela Task 11), #23 (quebra de arquivos grandes), #29 (descoberta do modo offline), #30 (controle de brilho no leitor).
