# Verificação manual antes do deploy — branch `feat/auditoria-correcoes-imediatas`

Oito das tarefas deste branch têm passos de verificação que **exigem um navegador** e não puderam ser executados automaticamente. Tudo abaixo foi revisado estaticamente e passa em `npm test` (56) e `npm run build`, mas o comportamento real de Service Worker, memória e leitor de tela só se prova rodando.

Ordem de prioridade. Cada item diz o que caracteriza **falha**.

---

## 1. Update → cold start offline  ⚠️ o mais importante

O único risco de regressão real identificado na revisão final.

1. Com a versão **atual de produção** instalada, baixe uma categoria de louvores e confirme que funciona offline.
2. Anote a contagem de entradas em DevTools → Application → Cache Storage → `plpc-pdfs`.
3. Faça o deploy deste branch. Abra o app **uma vez** com rede.
4. Feche o app completamente. Desligue a rede. Faça um cold start do PWA.

**Falha:** tela em branco ou presa no carregamento.

**Contexto:** o `install` grava o shell novo em `plpc-v5-app` mas não os chunks `/_app/immutable/*` que ele referencia — eles só entram via `handleHashedAsset` depois do `clients.claim()`. Nada escuta o evento `sw-update-available`, então não há prompt de recarregar. É propriedade pré-existente do desenho do SW, amplificada por este branch, não introduzida por ele. Se falhar, o remédio é um prompt de reload no `sw-update-available`.

**Também confirme:** a contagem de `plpc-pdfs` do passo 2 está inalterada.

## 2. Nenhum louvor fantasma faltando

Abra `/offline` depois do update. As estatísticas de "baixado / faltando" por categoria devem bater **exatamente** com as de antes.

**Falha:** qualquer categoria passando a reportar PDFs faltando, ou qualquer convite a rebaixar conteúdo.

A revisão traçou este caminho e concluiu que é seguro — o índice novo é superconjunto estrito do matcher antigo, só pode reportar *menos* ausências. Este passo confirma na prática.

## 3. Roteamento do Service Worker  (achado #01, o núcleo do branch)

DevTools → Network, com o SW ativo:

| Requisição | Esperado | Falha |
|---|---|---|
| `/louvores-manifest.sha256` | *(from network)* em toda carga | aparecer como *(from ServiceWorker)* |
| `/packages/*.zip` | nunca vira chave em `plpc-v5-app` | qualquer ZIP no Cache Storage |
| `/_app/immutable/*` | rede primeiro, depois cai em `plpc-v5-app` | servido de cache sem ir à rede |

## 4. Precache do PDF.js  (achado #03)

- `plpc-v5-pdfjs` deve conter **exatamente uma** entrada: `/pdfjs/web/pdf_viewer.css`, abaixo de 100 KB.
- Carregue `/`, espere alguns segundos, confirme que os três assets `pdfjs-dist` entraram em `plpc-v5-app`.
- Vá offline e abra um louvor em `/leitor`.

**Falha:** os 2,26 MB ainda sendo pré-cacheados, ou `/leitor` quebrado offline.

## 5. Memória durante um download real de 30 MB  (achado #05)

DevTools → Memory → allocation timeline, durante `startZipDownload` de uma categoria.

**Falha:** pico de heap subindo ~30 MB de uma vez. O esperado é um dente de serra por PDF.

**Também:** cancele no meio do download. A mensagem deve ser *"Download cancelado pelo usuário."* — nunca um `Import cancelled` cru em inglês.

## 6. Migração do localStorage  (achado #13)

Antes do update, no console:

```js
Object.keys(localStorage).filter(k => k.startsWith('pdfValidation_')).length
```

Depois do update, abra um louvor no leitor (dispara uma validação) e rode:

```js
Object.keys(localStorage).filter(k => k.startsWith('pdfValidation_') && k !== 'pdfValidationCache_v1').length  // esperado: 0
Object.keys(JSON.parse(localStorage.getItem('pdfValidationCache_v1')).entries).length  // esperado: a contagem anterior
```

**Falha:** entradas perdidas **e** o app voltando a validar pela rede.

## 7. Teclado e leitor de tela  (achado #26)

Tab pela home, do topo ao rodapé:

- Todo ponto focável mostra o anel de dois tons — tanto sobre o card creme quanto sobre o fundo marrom.
- Clique com o mouse num chip: o anel **não** deve aparecer (é `:focus-visible`).
- Foque um chip e pressione **Enter**; depois **Espaço**. O filtro deve alternar **exatamente uma vez** em cada — e a contagem de resultados mudar.
- Com VoiceOver (Cmd+F5), um chip deve ser anunciado como *"Categoria Partitura, botão, selecionado"* ou *"não selecionado"*.
- Foque o link que abre o PDF de um louvor (`.material-open`) — ele deve mostrar o anel.

**Falha:** um ponto focável sem anel, um toggle duplo, ou ausência do anúncio "selecionado".

## 8. Verificações pontuais

- **Achado #19:** interaja com a home (paginar, filtrar, buscar) com o Network aberto. **Zero** requisições para `127.0.0.1:7440`.
- **Achado #12:** busca por nome com acento (`bencao` deve achar *Bênção Aarônica*) e por número, tanto após cold load quanto após "Atualizar banco de louvores".

---

## Pendências conhecidas, deliberadamente não corrigidas

| Item | Onde | Por quê ficou |
|---|---|---|
| `<button>` aninhado dentro do `GestureButton` na paginação | `src/routes/biblioteca/+page.svelte:905-1052` | Mesma classe do achado F2, mas pré-existente e fora do escopo declarado. Produz tab stop duplicado e nome acessível vindo só de `title`. |
| `migrateLegacyValidationKeys` apaga antes de gravar | `src/lib/utils/validationCacheStore.js` | Falha de `setItem` ali perde o cache migrado. Cache reconstruível, não é dado do usuário. Correção barata: gravar primeiro, apagar depois. |
| `iterateZipEntriesCd` infla toda entrada antes de filtrar por nome | `src/lib/offline/import/zipCdReader.js:158` | Num download parcial, infla PDFs que descarta. O ganho da tarefa 5 é de memória, não de CPU. |
| `isDevelopmentAsset()` sem uso | `static/sw.js` | Código morto após a reescrita do roteamento. |
| Lista manual de testes em `package.json` | `package.json` | 14 arquivos `*.test.js` existem, 8 rodam; 6 usam vitest (não instalado) ou globais bare. Mover os inertes para `*.vitest.js` permitiria voltar ao glob. |
