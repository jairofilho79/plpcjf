# Camada de URL ↔ estado (não-PDF) — mapa cirúrgico

Repositório: `/Volumes/SSD 2TB SD/dev/plpcjf` — SvelteKit 2 / Svelte 4, SPA (`ssr=false` no `/leitor`, adapter-cloudflare).
Data da investigação: 2026-08-31. Commit base: `1ed4609`.

Convenção deste relatório:
- **[V]** = verificado (li o código / rodei o dado que prova).
- **[I]** = inferido (dedução a partir do código, não executei o caminho).
- **[A]** = ambíguo (o código não decide; precisa de decisão humana).

---

## Correções de premissa antes de começar

Três coisas do briefing não batem com o repositório. Corrijo aqui porque mudam o escopo:

1. **`src/lib/stores/listViewState.js` não existe.** **[V]** Não há arquivo com esse nome em lugar nenhum de `src/`. As únicas ocorrências do identificador estão em `docs/superpowers/plans/2026-08-31-plpc-melhorias-recomendadas.md:2176-2478`, onde ele é *proposto* (Task 13). Os "9 testes prontos" são o **código de teste escrito dentro do plano** (`docs/.../2026-08-31-plpc-melhorias-recomendadas.md:2197-2276`), não testes existentes no repositório.

2. **Não existe nenhum teste automatizado da camada de URL.** **[V]** `package.json:test` lista 13 arquivos de teste; nenhum toca `urlSync`, `filters`, `classificationFilters`, `pdfViewer`, `playlistUtils` ou as páginas. A camada é 100 % descoberta. Isso eleva o valor da Seção 5 — ela é o único contrato que vai existir.

3. **São mais de seis flags.** **[V]** A auditoria fala em "seis flags reabilitadas por `setTimeout` de 100 ms". Contei **7 resets a 100 ms**, **1 reset composto a 100 ms que religa 3 flags de uma vez + 1 aninhado de 500 ms**, e **6 resets a 0 ms** — 14 pontos de religamento por timer no total, distribuídos por 5 arquivos. Detalhe na Seção 3.

O arquivo central da camada é `src/lib/utils/urlSync.js` (199 linhas), e é ele — não um `listViewState` — que precisa ser substituído.

---

## 1. Inventário de parâmetros de URL

### 1.0 Panorama

Nenhum uso de **hash** (`location.hash` / `url.hash`) em código de aplicação. **[V]** — a única ocorrência de `.hash` é em `src/lib/utils/urlEncoding.js:246`, que apenas repassa o hash de uma URL de PDF. Nenhum segmento de rota dinâmico: todas as rotas são estáticas (`/`, `/biblioteca`, `/listas`, `/leitor`, `/offline`, `/sobre` + 3 endpoints `+server.js`). **Toda a camada é query string.**

**16 parâmetros no total: 12 não-PDF + 4 do caminho de PDF.**

| # | Param | Rotas onde importa | Escrito em | Lido em | Tipo/codificação |
|---|-------|--------------------|------------|---------|------------------|
| 1 | `pesquisa` | `/` | `+page.svelte:345,368,555` | `urlSync.js:51,64`; `+page.svelte:29,130,341,549` | string, `URLSearchParams.set` + **decode extra** |
| 2 | `materiais` | global | `filters.js:108` | `urlSync.js:58`; `filters.js:74-83` | CSV |
| 3 | `arranjo` | global | `classificationFilters.js:58` | `urlSync.js:59`; `classificationFilters.js:35-41` | CSV |
| 4 | `arranjoEspecial` | `/biblioteca` | `biblioteca:223,238,733,744,755,763` | `urlSync.js:60`; `biblioteca:166,193-194,229` | CSV |
| 5 | `comoAbrir` | global | `pdfViewer.js:57` | `urlSync.js:50,62`; `pdfViewer.js:38-42` | enum string |
| 6 | `ordenar` | `/biblioteca` (store é global) | `biblioteca:468` | `urlSync.js:53,65`; `bibliotecaSort.js:16-20`; `biblioteca:394,466,600` | enum `numero`\|`nome` |
| 7 | `itensPorPagina` | `/` e `/biblioteca` | `biblioteca:477`; `+page.svelte:520` | `urlSync.js:54,66`; `bibliotecaItemsPerPage.js:17-20` | int (10\|25\|50) |
| 8 | `pagina` | `/` e `/biblioteca` | `biblioteca:330`; `+page.svelte:75,82,104,368` | `urlSync.js:55,67` | int ≥ 1 |
| 9 | `sharepdfs` | `/` (consumido e apagado) | `playlistUtils.js:60` | `+page.svelte:260,267,290` | CSV de base64 **sem encode** |
| 10 | `sharename` | `/` (consumido e apagado) | `playlistUtils.js:59-60` | `+page.svelte:261,277` | string **`encodeURIComponent` + duplo decode** |
| 11 | `viewId` | `/listas` | `listas:324`; `CarouselNavigator.svelte:74` | `listas:36,331,347` | id opaco |
| 12 | `editId` | `/listas` (consumido e apagado) | `CarouselChips.svelte:279` | `listas:346,350,355` | id opaco |
| — | `file` | `/leitor` | `LouvorCard:130,187,197`; `navigateLouvorToLeitor:35,85,96`; `leitor:1240`; `offline.js:2146` | `leitor/+page.svelte:101` | path `encodeURIComponent` (**fora de escopo, ver 1.7**) |
| — | `titulo` | `/leitor` | idem | `leitor:102` | idem |
| — | `subtitulo` | `/leitor` | idem | `leitor:103` | idem |
| — | `validated` | `/leitor` | idem | `leitor:104` (`=== 'true'`) | booleano-string |

### 1.1 `pesquisa`

- **Escrita** — três pontos, todos via `updateUrlParams`:
  - debounce de 500 ms no bloco reativo `src/routes/+page.svelte:546-562`;
  - `flushSearchToUrlOnBlur()` em `src/routes/+page.svelte:334-349` (dispara no `blur` do input, para não perder o texto);
  - `handleClear()` em `src/routes/+page.svelte:351-371` (grava `''` → o param é **removido**).
- **Regra de escrita** — `urlSync.js:148-155`: `.trim()`; string vazia → `delete`. Não existe `pesquisa=` vazio produzido pelo app. **[V]**
- **Leitura** — inicialização em `src/routes/+page.svelte:29` e bloco reativo `128-145`.
- **Codificação** — `URLSearchParams.set` (espaço vira `+`, vírgula vira `%2C`) **e depois** `safeDecodeURIComponent` na leitura (`urlSync.js:51,64` → `27-34`). Isso é um **decode duplo**. Consequências medidas **[V]**:
  - `100%` → URL `pesquisa=100%25` → volta `100%` — OK (o `try/catch` de `safeDecodeURIComponent` salva).
  - `a%20b` (usuário digita literalmente) → URL `pesquisa=a%2520b` → volta **`a b`**. Texto corrompido silenciosamente.
  - `café`, `a+b`, `a,b`, `PES CIAs` → OK.
- **Ausente** → `''`. **Vazio (`?pesquisa=`)** → `''` (mesmo comportamento; a home então não filtra nada, ver 1.9). **Malformado** → nunca lança, por causa do `try/catch`.

### 1.2 `materiais` (store `filters`)

- **Escrita** — `src/lib/stores/filters.js:102-113`, com `defaultMateriais: CATEGORY_OPTIONS`.
- **Regra de escrita crucial** (`urlSync.js:96-113`): se **todos** os materiais estiverem selecionados **ou** se o array estiver **vazio**, o param é **apagado**. **[V]** Ou seja: "tudo selecionado" e "nada selecionado" produzem exatamente a mesma URL — `sem materiais`. A informação "nenhum material" é **irrepresentável** na URL.
- **Leitura** — `filters.js:71-99`. Usa o teste de substring `$page.url.search.includes('materiais=')` (`filters.js:75`) para distinguir "param ausente" de "param vazio":
  - ausente → store volta para `CATEGORY_OPTIONS` (**reset ativo**, `filters.js:92-97`);
  - `?materiais=` (vazio) → store vira `[]` → **zero resultados**.
- **Ordem** — `normalizeCategoryOrder` (`filters.js:13-25`) força a ordem de `CATEGORY_OPTIONS`. Então `?materiais=Cifra,Partitura` é reescrito para `Partitura,Cifra` na próxima gravação. A ordem na URL **não** é semântica, mas **é** normalizada — a comparação usa `areCategoriesEqual` (Set), então não há laço por reordenação. **[V]**
- **Valores válidos** — `Partitura`, `Cifra`, `Gestos em Gravura` (`filters.js:6`). Valores desconhecidos são **preservados** (`filters.js:22-24` joga os extras no fim) e simplesmente nunca casam com `louvor.categoria`. Note que o manifesto tem 5 categorias reais: `Cifra`, `Gestos em Gravura`, `Partitura`, `Cifra nível I`, `Cifra nível II` **[V]** — as duas últimas são alcançadas pela expansão de `Cifra` em `expandCategoryFilter` (`+page.svelte:309-316`, `biblioteca:57-64`), não pela URL.

### 1.3 `arranjo` (store `classificationFilters`)

- **Escrita** — `classificationFilters.js:54-62`. **Sem regra de "todos → apagar"** (`urlSync.js:115-128` só apaga quando o array é vazio).
- **Consequência de primeira ordem, muito visível:** ao abrir `/` limpo, `initializeFiltersIfNeeded` (`+page.svelte:151-175`) chama `classificationFilters.selectAll(classifications)`, que grava os **5** arranjos na URL. **[V]** O usuário vê a barra de endereços virar, sozinha, algo como:
  ```
  /?arranjo=Avulsos+Diversos%2CColet%C3%A2nea+Adultos%2CColet%C3%A2nea+CIAs%2CPES%2CPES+CIAs
  ```
  Isso acontece por `replaceState`, ~200 ms depois do load. Qualquer link que alguém tenha copiado da barra de endereços **contém esse `arranjo=` gigante**. É o formato de link mais compartilhado depois do de playlist. **[I — quanto ao hábito do usuário; V quanto ao código]**
- **Leitura** — `classificationFilters.js:32-51`, também por substring `includes('arranjo=')`. **Assimetria com `materiais`:** se o param está **ausente**, este store **não reseta** — mantém o valor atual (`classificationFilters.js:50`, comentário explícito). **[V]**
- **Valores válidos hoje (normalizados, sem parênteses)** **[V]**, 5: `Avulsos Diversos`, `Coletânea Adultos`, `Coletânea CIAs`, `PES`, `PES CIAs`. Nenhum contém vírgula **[V]** — o formato CSV sem escape (`urlSync.js:11-18`, comentado no próprio arquivo) sobrevive por sorte, não por design.

### 1.4 `arranjoEspecial`

- **Escrita** — 6 pontos em `src/routes/biblioteca/+page.svelte` (223, 238, 733, 744, 755, 763). Os quatro últimos são handlers de evento; os dois primeiros são **escritas dentro de blocos reativos** (`$:`), que é exatamente o padrão que a reescrita quer eliminar.
- **Leitura** — `biblioteca:166` (init), `192-208` (bloco reativo URL→estado), `229-230`.
- **Filtragem na leitura** — `biblioteca:197`: só entram valores que existem em `availableSpecialArrangements`. Valores desconhecidos são **descartados silenciosamente** e o param **não** é reescrito. **[V]**
- **Valores válidos hoje** **[V]**, 6: `Padrão`, `Encontro de Louvor Abril 2025`, `Encontro de Louvor Abril 2026`, `Encontro de Louvor Agosto 2025`, `Evangelização CIAs Out 2025`, `GLTM`, `Trombetas e Festas 2025`. (`Padrão` é sintético — `biblioteca:50`.) Nenhum com vírgula **[V]**.
- **Auto-seleção** — `biblioteca:226-244`: quando os arranjos especiais "aparecem" pela primeira vez e a URL **não** tem `arranjoEspecial=`, o app seleciona todos e **grava na URL**. Mais um `replaceState` automático.

### 1.5 `comoAbrir` (store `pdfViewer`)

- **Escrita** — `pdfViewer.js:53-61`, com `defaultComoAbrir: 'leitor'` → o valor default é **apagado** da URL (`urlSync.js:130-140`).
- **Leitura** — `pdfViewer.js:35-50`, substring `includes('comoAbrir=')`.
- **Valores válidos** — `leitor`, `online`, `newtab`, `share`, `save` (`pdfViewer.js:7`). Todos os 5 estão expostos na UI (`PdfViewerSelector.svelte:6-12`). **[V]**
- **Valor inválido** — o store cai para `'leitor'` mas **o param permanece na URL**, porque nada chama `updateUrlParams` nesse caminho (`pdfViewer.js:40-49` só faz `set`). Então `/?comoAbrir=lixo` fica pendurado na barra de endereços para sempre, inerte. **[V]**
- **Global**: o `page.subscribe` é de módulo, então `comoAbrir` funciona em **qualquer** rota, inclusive `/listas` e `/leitor`. **[V]**

### 1.6 `ordenar`, `itensPorPagina`, `pagina`

- `ordenar` — só `/biblioteca` escreve (`biblioteca:468`). Default `'numero'` é apagado (`urlSync.js:158-166`). Aceita apenas `numero`|`nome` (`biblioteca:431`, `bibliotecaSort.js:19`, `35`). Qualquer outro valor é ignorado **e mantido na URL**. **[V]**
  - **`ordenar` na home é lido mas nunca usado.** `parseUrlParams` devolve o campo, `src/routes/+page.svelte` nunca o consulta, e `updateUrlParams` preserva params não citados (`urlSync.js:92` parte da query atual). Logo `/?ordenar=nome` é inerte e **persiste** por todas as reescritas subsequentes. **[V]**
- `itensPorPagina` — `VALID_OPTIONS = [10, 25, 50]` (`bibliotecaItemsPerPage.js:8`). Default 10 é apagado (`urlSync.js:168-176`).
  - **Assimetria home/biblioteca com valor inválido** **[V]**: `?itensPorPagina=7` na `/biblioteca` é normalizado — `biblioteca:475` calcula `urlItensPorPagina = 7` (truthy), difere do store (10), e `biblioteca:477` grava `updateUrlParams({itensPorPagina: 10})`, que **apaga** o param. Na `/`, `+page.svelte:516` faz `VALID_OPTIONS.includes(7) ? 7 : 10` → 10 = store → **não reescreve** → o param inválido **fica na URL**.
  - **Store compartilhado entre rotas**: `bibliotecaItemsPerPage` é o mesmo módulo nas duas páginas. Sair de `/biblioteca?itensPorPagina=25` para `/` faz o bloco `+page.svelte:507-523` **gravar `itensPorPagina=25` na URL da home**. Vazamento de estado entre rotas via store. **[V]**
- `pagina` — default 1 apagado (`urlSync.js:178-186`); `parseInt` sem base explícita? Não: `parseInt(x, 10)` em todos os pontos. **[V]**
  - `parseUrlParams` devolve **`NaN`**, não `null`, para `?pagina=abc` (`urlSync.js:67`: `paginaParam ? parseInt(...) : null` — `'abc'` é truthy). Os dois consumidores blindam com `> 0` (`+page.svelte:482`, `biblioteca:397`), mas o contrato da função é enganoso: `pagina !== null` não implica número. **[V] — armadilha de refatoração.**
  - `?pagina=0` e `?pagina=-3` → tratados como 1.

### 1.7 `file` / `titulo` / `subtitulo` / `validated` (fronteira com o PDF)

Fora do escopo do refactor, mas é **a fronteira que não pode ser cruzada**, então documento o contrato:

- Leitura em `src/routes/leitor/+page.svelte:100-104`, via `new URLSearchParams($page.url.search)` — **decode simples**, sem passar por `parseUrlParams`. Portanto os defeitos de duplo decode da Seção 1.1 **não** afetam o PDF hoje. **[V]**
- Escrita em 4 lugares, todos com o mesmo template literal repetido: `LouvorCard.svelte:126-134,183-190,194-200`, `navigateLouvorToLeitor.js:35-39,85-90,96-100`, `leitor/+page.svelte:1236-1240`, `offline.js:2146-2147`.
- Formato: `/leitor?file=<encodeURIComponent('/'+relPath)>&titulo=<enc>&subtitulo=<enc(categoria + ' | ' + classificacao)>[&validated=true]`.
- `file` ausente → default `'/pdfs/exemplo.pdf'` (`leitor:101`).
- **Ordem dos params é irrelevante** aqui (leitura por `.get()`). **[V]**
- **Perigo para a reescrita:** `updateUrlParams` (`urlSync.js:188-199`) reconstrói a query inteira a partir de `get(page)` e navega com `goto(pathname + '?' + search)`. Ela **não tem guarda de rota**. Hoje nenhum caller dispara em `/leitor` porque os componentes que escrevem (`PdfViewerSelector`, `CategoryFilters`, `ClassificationFilters`, páginas de lista) não são montados lá. Mas as três **stores globais** (`filters`, `classificationFilters`, `pdfViewer`) *podem* chamar `updateUrlParams` de qualquer rota — basta alguém expor um controle desses no leitor, ou a reescrita mover uma escrita para um `page.subscribe`. Se isso acontecer, a URL do leitor é reescrita e o PDF quebra. **É este o mecanismo exato do medo "pode quebrar a leitura dos PDFs".** **[V quanto ao código; I quanto ao gatilho]**

### 1.8 `viewId` e `editId` (`/listas`)

- `viewId` — produzido em `listas:324` (`handleView`) e `CarouselNavigator.svelte:74` (toque longo). Lido em `listas:36`. Se o id **não existe** em `savedPlaylists`, o bloco reativo `listas:42-50` **apaga o param** com `replaceState` e a tela volta à lista geral. **[V]** É o único param do app com auto-limpeza de valor inválido.
- `editId` — produzido em `CarouselChips.svelte:279` (`goto('/listas?editId=...')`, **sem** `replaceState` → **entra no histórico**). Consumido no `onMount` de `listas:346-366`: entra em modo edição e depois `goto('/listas', { replaceState: true })`, que **apaga toda a query**, inclusive um `viewId` que estivesse junto. Há um curto-circuito em `listas:347-353`: se houver `viewId` **válido** junto, o `editId` é simplesmente descartado. **[V]**
- Ambos são **ids de `localStorage`** (`savedPlaylists.js:26-28`: `Date.now().toString(36) + Math.random().toString(36).substr(2)`), portanto **não são compartilháveis** — um link `/listas?viewId=xyz` mandado para outra pessoa cai no caminho de auto-limpeza e não mostra nada. **[V]** Isso é correto e deve ser preservado.

### 1.9 O que acontece com "ausente / vazio / malformado" — tabela consolidada

| Param | Ausente | Vazio (`x=`) | Inválido |
|---|---|---|---|
| `pesquisa` | `''`, home não filtra nada (`+page.svelte:441-444` → lista vazia) | idem ausente | nunca; `try/catch` |
| `materiais` | **reseta** store para as 3 categorias | store `[]` → **zero resultados**, sem aviso | valor extra preservado, nunca casa |
| `arranjo` | **mantém** valor atual do store (não reseta) | `urlHasArranjo=true` → auto-select-all **não roda** → store `[]` → **zero resultados** | valor extra preservado, nunca casa |
| `arranjoEspecial` | auto-seleciona todos e **grava na URL** | descartado (filtro por `availableSpecialArrangements`) | descartado, param permanece |
| `comoAbrir` | `'leitor'` | `'leitor'` | `'leitor'`, **param permanece** |
| `ordenar` | `'numero'` | `'numero'` | ignorado, **param permanece** |
| `itensPorPagina` | 10 | 10 | biblioteca **limpa**; home **mantém** |
| `pagina` | 1 | 1 | `NaN` → 1 |
| `sharepdfs` | nada acontece | nada acontece, e `sharedLinkProcessed` **não** é marcado → o bloco reativo `+page.svelte:287-294` reavalia a cada mudança de `$page` | ids desconhecidos **descartados em silêncio** |
| `sharename` | nome default `lista dd/mm/aaaa HH:MM:SS` | nome default (`''` é falsy → `undefined` → default) | **pode lançar `URIError`** (ver 2.4) |
| `viewId` | modo lista | apagado da URL | apagado da URL |
| `editId` | nada | nada | nada; query inteira é limpa mesmo assim |

---

## 2. Compartilhamento de listas / playlists

### 2.1 Resposta direta às perguntas

> Um link compartilhado hoje contém os IDs dos louvores embutidos, ou aponta para algo salvo localmente?

**Contém os IDs embutidos.** **[V]** O link de compartilhamento (`sharepdfs`) é autocontido: carrega a lista inteira de `pdfId` na query string. Não há servidor, não há id curto, não há nada salvo remotamente. O receptor não precisa de nada além do link e do catálogo (`louvores-manifest.json`).

Os links de `/listas?viewId=` e `/listas?editId=`, ao contrário, **apontam para o `localStorage` do próprio aparelho** e são inúteis fora dele. **[V]** São links de navegação interna, não de compartilhamento.

> Qual a codificação?

`pdfId` é **base64 padrão do caminho relativo do PDF em UTF-8** — não base64url. **[V]** Verificado decodificando o manifesto:
```
MDQxMTIwMjUvQ29uaGXDp2Ftb3MgZSBwcm9zc2lnYW1vcy9DaWZyYS5wZGY=
  →  04112025/Conheçamos e prossigamos/Cifra.pdf
```
Os ids são juntados com vírgula e **inseridos crus na URL, sem `encodeURIComponent`** (`playlistUtils.js:58-60`).

> Qual o limite prático de tamanho?

Medido sobre o manifesto real (4629 linhas) **[V]**: `pdfId` tem 20 a 148 caracteres, mediana 92, média 74,3.

| Louvores na lista | Tamanho da URL |
|---|---|
| 5 | 409 chars |
| 10 | 762 chars |
| 20 | 1 452 chars |
| 50 | 3 454 chars |

Corte prático: ~2 000 chars é o limite seguro universal (IE/alguns proxies), 8 000 no Chrome/Firefox modernos, e o WhatsApp encurta a **visualização** mas transmite o link inteiro. Na prática **listas de até ~25 louvores (≈1 800 chars) são seguras; acima de ~100 (≈6 900 chars) o risco é real.** **[I — o limite depende do transporte, não do nosso código]**

### 2.2 Formato exato e exemplo real

`src/lib/utils/playlistUtils.js:52-61`:
```js
export function generatePlaylistShareUrl(pdfIds, nome) {
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const pdfIdsParam = pdfIds.join(',');            // sem encode
  const nameParam = encodeURIComponent(nome);      // com encode
  return `${baseUrl}/?sharepdfs=${pdfIdsParam}&sharename=${nameParam}`;
}
```

Exemplo montado a partir de dados reais do manifesto (2 louvores, nome default):
```
https://plpcg.com/?sharepdfs=MDQxMTIwMjUvQ29uaGXDp2Ftb3MgZSBwcm9zc2lnYW1vcy9DaWZyYS5wZGY=,MDQxMTIwMjUvQ29uaGXDp2Ftb3MgZSBwcm9zc2lnYW1vcy9HZXN0b3MgQ0lBcy5wZGY=&sharename=lista%2004%2F11%2F2025%2010%3A20%3A30
```
Observe: **`=` de padding e `,` separador aparecem crus na URL.** Isso funciona (`=` só é significativo na primeira ocorrência de cada par; `,` é `sub-delim` válido em query) — confirmado por round-trip **[V]**.

Note também que `baseUrl` vem de `window.location.origin`, então um link gerado num deploy de Preview do Cloudflare Pages aponta para o domínio de preview. **[V]**

### 2.3 Caminhos de compartilhamento (inventário completo)

| # | Origem | Arquivo:linha | O que faz |
|---|--------|---------------|-----------|
| 1 | Botão compartilhar num card de `/listas` | `listas:218-236` → `generatePlaylistShareUrl` → `sharePlaylistLink` | Web Share API, fallback clipboard + snackbar "copiado" por 2 s |
| 2 | Botão compartilhar da barra do carrossel | `CarouselChips.svelte:~290-300` (`handleShare`) | idem, usando o nome da playlist salva casada por `findPlaylistByPdfIds`, ou um nome default gerado na hora |
| 3 | Web Share API / clipboard | `playlistUtils.js:7-47` (`sharePlaylistLink`) | `navigator.share({url,title,text})` com validação por `canShare`; `AbortError` (usuário cancelou) → **não** copia; outros erros → `navigator.clipboard.writeText` |
| 4 | Compartilhar o **PDF** (arquivo, não link) | `pdfUtils.js:76-85` (`sharePdf`), `folhetoUtils.js:137-138` | `navigator.share({files:[...]})` — **não é link, é blob**; fora desta camada |

O consumo do link está inteiramente em `src/routes/+page.svelte:256-294`.

### 2.4 Defeitos verificados no compartilhamento

**(a) `sharename` sofre decode duplo e pode lançar `URIError`.** **[V]**
`playlistUtils.js:59` faz `encodeURIComponent(nome)`. `+page.svelte:261` lê com `URLSearchParams.get()` — que **já decodifica**. E `+page.svelte:277` decodifica **de novo**. Round-trip medido:

| Nome da lista | Resultado ao abrir o link |
|---|---|
| `lista 04/11/2025 10:20:30` | OK |
| `Ação de Graças` | OK |
| `Louvor 100%` | **`URIError` lançado** |
| `Culto 50%off` | **`URIError` lançado** |
| `Ensaio %20 teste` | vira `Ensaio   teste` (corrompido) |

O `URIError` não é capturado. Ele é lançado **depois** de `carousel.clearCarousel()` e `carousel.loadPlaylist()` mas **antes** de `savedPlaylists.savePlaylist()` e do `goto()` de limpeza (`+page.svelte:271-281`). Resultado: o carrossel é carregado, **a lista não é salva**, a URL suja permanece, e o erro sobe de dentro de um bloco reativo `$:`. Como `sharedLinkProcessed` já foi marcado em `+page.svelte:264`, não há segunda tentativa. **Bug real, silencioso, disparado por qualquer `%` no nome da lista.**

**(b) Um `+` num `pdfId` quebraria a lista em silêncio.** **[V]**
`pdfIds.join(',')` sem encode; do outro lado, `URLSearchParams` interpreta `+` como espaço. Testado com um id sintético:
```
YWJj+ZGVm/Z2hp=   →   lido de volta como   "YWJj ZGVm/Z2hp="
```
O id corrompido não casa no `Map` de `carousel.loadPlaylist` (`carousel.js:128-130`) e é **descartado sem aviso**. Hoje o manifesto tem **0 ids com `+`**, 9 com `/` (inofensivo) e 2 198 com `=` (inofensivo) **[V]** — ou seja, a bomba está armada mas não armou ainda. Como o `pdfId` é base64 de um caminho arbitrário, **um único arquivo novo com o byte certo introduz um `+` e quebra o compartilhamento daquele louvor**, sem erro visível.

**(c) Ids não resolvidos entram na lista salva, mas não no carrossel.** **[V]**
`+page.svelte:274` chama `carousel.loadPlaylist(pdfIds, $louvores)`, que **filtra** os desconhecidos (`carousel.js:128-130`). `+page.svelte:278` chama `savedPlaylists.savePlaylist(pdfIds, ...)` com o array **cru**. A lista salva no `localStorage` fica com "fantasmas" que o carrossel não mostra — e que voltam a assombrar em `findPlaylistByPdfIds` (`savedPlaylists.js:182-189`, comparação por `join(',')`), que passa a nunca casar com o carrossel real.

**(d) Abrir o mesmo link N vezes cria N listas duplicadas.** **[V]**
`+page.svelte:278` chama `savePlaylist` incondicionalmente; `savedPlaylists.savePlaylist` sempre gera um id novo (`savedPlaylists.js:61-86`). Não há deduplicação por `findPlaylistByPdfIds`, embora a função exista e seja usada em `CarouselNavigator.svelte:73`.

**(e) `?sharepdfs=` vazio deixa o bloco reativo re-executando.** **[V]** `sharedLinkProcessed = true` está **dentro** do `if (sharepdfs && ...)` (`+page.svelte:263-264`). Com valor vazio, a flag nunca é marcada e o bloco `287-294` reavalia a cada `$page`.

**(f) `?sharepdfs=,,,` marca processado e não limpa a URL.** **[V]** `pdfIds` fica `[]` (`+page.svelte:267`), `sharedLinkProcessed` já é `true` (linha 264), mas o `goto` de limpeza está dentro do `if (pdfIds.length > 0)` (269-282). A URL suja fica na barra para sempre.

**(g) A limpeza descarta *toda* a query.** **[V]** `+page.svelte:281`: `goto($page.url.pathname, {replaceState:true})`. Um link `/?sharepdfs=...&pesquisa=amor&comoAbrir=newtab` perde `pesquisa` e `comoAbrir` junto. Provavelmente inofensivo hoje (ninguém gera esse link), mas é uma decisão implícita a preservar ou mudar conscientemente. **[A]**

**(h) O `replaceState` da limpeza é, na verdade, o comportamento certo.** **[V]** Ele impede que o botão voltar reimporte a lista. Preservar.

---

## 3. Os laços reativos e as flags

### 3.1 Inventário completo das flags

**Home — `src/routes/+page.svelte`**

| Flag | Decl. | Onde é ligada | Onde é religada | Laço que quebra |
|---|---|---|---|---|
| `isUpdatingFromUrl` | :39 | :138, :344, :554 | :141-143 (**0 ms**), :346-348 (**0 ms**), :557-559 (**100 ms**) | URL→`searchQuery` (bloco :128) ↔ `searchQuery`→URL (bloco :546) |
| `isUpdatingPageFromUrl` | :44 | :102, :497 | :105-107 (**100 ms**), :500-502 (**100 ms**) | `setPage`→URL (:104) ↔ URL→`currentPage` (:496) |
| `isUpdatingItemsPerPageFromUrl` | :45 | :206, :490 | :208-210 (**0 ms**), :492-494 (**100 ms**) | URL→store (:491) ↔ store→URL (bloco :507) |
| `homeUrlSyncInitialized` | :46 | :218 (`onMount`) | — | Impede qualquer escrita antes do `onMount` ler a URL |
| `pageInitializedFromUrl` | :49 | :213 | :365, :381, :386 | Marca "a página veio de deep link" — mas **é lida em lugar nenhum na home** (ver 4.7) |
| `sharedLinkProcessed` | :40 | :264 | — | Idempotência da importação de lista |
| `shouldResetPageOnFilterResult` | :56 | :380 | :73 | Adia o reset de paginação até o resultado do filtro existir |
| `lastKnownHomeUrl` | :48 | :76,:83,:103,:204,:484,:521 | — | Memória "esta URL fui eu que escrevi" para o bloco :468 |
| `filtersInitialized` | :147 | :169,:173 | — | Auto-select-all dos arranjos roda uma vez só |

**Biblioteca — `src/routes/biblioteca/+page.svelte`**

| Flag | Decl. | Onde é ligada | Onde é religada | Laço que quebra |
|---|---|---|---|---|
| `urlSyncInitialized` | :290 | :637 (dentro de `setTimeout` de **100 ms**), :644 | — | Nenhuma escrita antes do `onMount` terminar |
| `isUpdatingSortFromUrl` | :291 | :432, :603 | :434-436 (**100 ms**), :634 (**100 ms**) | URL→`bibliotecaSort` (:433) ↔ store→URL (bloco :464) |
| `isUpdatingItemsPerPageFromUrl` | :292 | :441, :609 | :443-445 (**100 ms**), :635 (**100 ms**) | URL→store (:442) ↔ store→URL (bloco :473) |
| `isUpdatingPageFromUrl` | :293 | :450, :617 | :455-457 (**100 ms**), :636 (**100 ms**) | `setPage`→URL (:330) ↔ URL→`currentPage` (:453) |
| `isUpdatingArranjoEspecialFromUrl` | :167 | :199,:217,:234 | :202,:221,:237 (**síncrono**, mesmo tick) | Bloco URL→seleção (:192) ↔ blocos :212 e handlers :725-765 |
| `pageInitializedFromUrl` | :358 | :619 | :640 (**500 ms** aninhado) | Impede o reset de página do bloco :359 de matar o deep link |
| `lastKnownUrlState` | :296-300 | :417,:424,:626 | — | Memória "esta URL fui eu que escrevi" para o bloco :392 |
| `previousAvailableLength` | :188 | :246 | — | Detecta "apareceu/sumiu" de arranjo especial (borda, não valor) |
| `specialArrangementsInitialized` | :189 | :201,:236,:241 | :220 | Auto-select-all dos especiais roda uma vez só |
| `previousSelectedClassifications` | :170 | :183 | — | Detecta mudança **estrutural** do conjunto de arranjos |
| `previousFilteredCount` | :357 | :363,:386 | — | Detecta mudança de contagem → reset de página |
| `filtersInitialized` | :554 | :576,:584,:665,:668 | — | Auto-select-all dos arranjos roda uma vez só |

**Stores (globais, escrevem a URL de qualquer rota)**

| Flag | Arquivo:linha | Religada |
|---|---|---|
| `isUpdatingFromUrl` / `isUpdatingUrl` | `filters.js:65-66` | `:110-112` (**0 ms**) |
| `isUpdatingFromUrl` / `isUpdatingUrl` | `classificationFilters.js:26-27` | `:59-61` (**0 ms**) |
| `isUpdatingFromUrl` / `isUpdatingUrl` | `pdfViewer.js:29-30` | `:58-60` (**0 ms**) |

**Contagem:** 7 religamentos a **100 ms** (`+page.svelte` 105, 492, 500, 557; `biblioteca` 434, 443, 455), 1 religamento composto a **100 ms** que solta 3 flags e liga `urlSyncInitialized` (`biblioteca:633-642`), 1 aninhado a **500 ms** (`biblioteca:639-641`), e 6 a **0 ms** (`+page.svelte` 141, 208, 346; `filters.js` 110; `classificationFilters.js` 59; `pdfViewer.js` 58). **Total: 15 religamentos por timer.**

### 3.2 Os ciclos reais, traçados

**Ciclo A — pesquisa (home).**
```
usuário digita
  → bloco reativo :527 dispara (dep: searchQuery)
    → timer 500 ms → :554 liga isUpdatingFromUrl
      → :555 updateUrlParams({pesquisa, pagina?})
        → goto(replaceState) → $page muda
          → bloco :128 dispara (dep: $page)   ←── AQUI FECHARIA O LAÇO
             mas isUpdatingFromUrl está ligada → não faz nada
      → :557 setTimeout 100 ms desliga a flag
```
Sem a flag: `:128` veria `urlPesquisa !== currentPesquisa`? Não — seriam iguais, então **não** haveria laço infinito nesse caso específico. A flag protege o caso **intermediário**: durante o `goto` assíncrono, `$page` ainda tem o valor **antigo**, e `:128` sobrescreveria `searchQuery` com o texto velho, apagando o que o usuário digitou. Existe um segundo guarda contra isso (`searchInputFocused`, `:134-135`) e um terceiro (`flushSearchToUrlOnBlur`, `:334`). **Três mecanismos para o mesmo perigo.** **[V]**

**Ciclo B — paginação (home).**
```
clique em "próxima"
  → setPage(:92) → :102 liga isUpdatingPageFromUrl
    → :104 updateUrlParams({pagina}) → goto → $page muda
      → bloco :468 dispara            ←── laço: leria pagina e faria currentPage = pagina
         mas isUpdatingPageFromUrl está ligada → bloco inteiro é pulado
    → :105 setTimeout 100 ms desliga
```
Repare que `lastKnownHomeUrl` é atualizado em `:103` **antes** do `updateUrlParams` — é o segundo cinto de segurança. Se a flag sumisse mas `lastKnownHomeUrl` ficasse, o bloco `:483` compararia igual e não faria nada. **A flag é redundante com `lastKnownHomeUrl` neste caminho.** **[I — alta confiança]**

**Ciclo C — `itensPorPagina` (home): laço genuíno de duas pontas.**
```
bloco :507  (store → URL):  se urlIpp !== $bibliotecaItemsPerPage → grava a URL
bloco :468  (URL → store):  se lastKnownHomeUrl mudou → bibliotecaItemsPerPage.set(urlIpp)
```
Estes dois blocos são **exatamente opostos** e ambos disparam em `$page`. Sem `isUpdatingItemsPerPageFromUrl` e sem `lastKnownHomeUrl`, isso é um ping-pong infinito. **Este é o único ponto onde a remoção de uma flag causa laço real e imediato.** **[V]**
Note que `:507` **não** consulta `isUpdatingFromUrl` nem `isUpdatingPageFromUrl` — só `isUpdatingItemsPerPageFromUrl` (`:510`). É a guarda mais fraca do arquivo.

**Ciclo D — biblioteca, o triângulo.**
```
bloco :392  (URL → 3 stores)
bloco :464  (bibliotecaSort → URL)
bloco :473  (bibliotecaItemsPerPage → URL)
setPage :322 (currentPage → URL)
```
`:392` é guardado por **três** flags simultâneas + `lastKnownUrlState`. `:464` e `:473` são guardados por **uma** flag cada. A janela de 100 ms de `:434/:443/:455` existe para cobrir o intervalo entre `bibliotecaSort.set()` (síncrono) e a resolução do `goto` (assíncrona). **Se o `goto` demorar mais de 100 ms** — aba em segundo plano, dispositivo lento, navegação concorrente — a flag já desligou quando `$page` finalmente muda, `:392` roda, vê `lastKnownUrlState` **já atualizado em `:424`**, e não faz nada. Ou seja: **o `lastKnownUrlState` é quem realmente segura o laço; as flags de 100 ms são cinto redundante.** **[I — alta confiança, é a leitura mais provável]**

**Ciclo E — `arranjoEspecial` (biblioteca), o único com escrita dentro de bloco reativo.**
```
bloco :212  → se availableSpecialArrangements ficou vazio → grava updateUrlParams({arranjoEspecial: []})  (:223)
            → se acabou de aparecer → seleciona todos e grava (:238)
bloco :192  → lê arranjoEspecial da URL e escreve em selectedSpecialArrangements
bloco :171  → reseta selectedSpecialArrangements quando selectedClassifications muda
bloco :250  → filteredLouvores depende de selectedSpecialArrangements
bloco :77   → availableSpecialArrangements depende de classificationFilteredLouvores
```
Cinco blocos reativos num anel: `:212` escreve a URL → `$page` muda → `:192` escreve o estado → `:250` recalcula → `:77` recalcula `availableSpecialArrangements` → `:212` dispara de novo. `isUpdatingArranjoEspecialFromUrl` é ligada e desligada **no mesmo tick síncrono** (`:199-202`, `:217-221`, `:234-237`), portanto **não protege nada contra o `$page` assíncrono** — só contra reentrância síncrona do próprio Svelte. O que realmente segura o anel é `specialArrangementsInitialized` + `previousAvailableLength`. **[V]** Este é o subsistema mais frágil do repositório inteiro.

### 3.3 O que acontece se cada flag sumir

| Flag | Se sumir |
|---|---|
| `isUpdatingItemsPerPageFromUrl` (home e biblioteca) | **Laço infinito imediato** entre os dois blocos opostos, se `lastKnownHomeUrl`/`lastKnownUrlState` também saírem. Sozinha: provavelmente sobrevive. |
| `isUpdatingFromUrl` (home, pesquisa) | O texto digitado é **sobrescrito pelo valor antigo da URL** durante a janela do `goto`. Mitigado por `searchInputFocused`, mas só enquanto o input tem foco. |
| `isUpdatingPageFromUrl` | Provavelmente nada — `lastKnownHomeUrl`/`lastKnownUrlState` cobrem. **[I]** |
| `isUpdatingSortFromUrl` | Idem. **[I]** |
| `isUpdatingArranjoEspecialFromUrl` | Nada — já é síncrona e inefetiva contra o ciclo assíncrono. **[V]** |
| `lastKnownHomeUrl` / `lastKnownUrlState` | **É a proteção que realmente importa.** Sem elas, as flags de 100 ms não bastam. |
| `urlSyncInitialized` / `homeUrlSyncInitialized` | O `onMount` grava a URL antes de terminar de lê-la → **o deep link é apagado no carregamento**. |
| `pageInitializedFromUrl` (biblioteca) | O bloco `:359` reseta a página para 1 assim que os filtros chegam → **`?pagina=3` deixa de funcionar.** |
| `shouldResetPageOnFilterResult` | A página não voltaria a 1 ao trocar filtros → usuário fica preso numa página vazia. |
| `sharedLinkProcessed` | A lista compartilhada seria importada **repetidamente**, criando duplicatas a cada re-render. |

---

## 4. Gambiarras e armadilhas

### 4.1 Comparação de string onde deveria haver comparação estrutural

- **`JSON.stringify(a.sort()) !== JSON.stringify(b.sort())`** — `classificationFilters.js:43` e `biblioteca:198`. Além de ser comparação de string por serialização, **`.sort()` muta os arrays no lugar**: em `classificationFilters.js:43`, `currentValue.sort()` reordena o array já guardado; em `biblioteca:198`, `selectedSpecialArrangements.sort()` **muta o estado reativo do componente sem disparar reatividade** (mutação in-place não é atribuição em Svelte 4). **[V]** Efeito colateral escondido dentro de um `if`.
- **`$page.url.search.includes('arranjo=')`** — `+page.svelte:156`, `biblioteca:563,652`, `classificationFilters.js:36`; e as gêmeas `includes('materiais=')` (`filters.js:75`), `includes('comoAbrir=')` (`pdfViewer.js:39`), `includes('arranjoEspecial=')` (`biblioteca:230`). Substring numa query string, para responder "o param existe?", quando `url.searchParams.has()` existe. Consequências:
  - `?pesquisa=arranjo=x` — não produzível pelo app (o `=` seria escapado como `%3D`), mas **um link colado à mão** com `arranjo=` dentro de outro valor faz `urlHasArranjo` virar `true`, o auto-select-all não roda, e a home mostra **zero resultados**. **[V]**
  - Um param futuro chamado `subarranjo=` ou `pre_materiais=` casaria por acidente.
  - Vantagem acidental: `arranjoEspecial=` **não** contém a substring `arranjo=` (o caractere seguinte é `E`), então essa colisão específica não existe. **[V]**
- **`p.pdfIds.join(',') === pdfIdsStr`** — `savedPlaylists.js:185-186`. Comparação de listas por concatenação; quebra se um `pdfId` contiver vírgula (hoje nenhum contém). **[V]**
- **`criteriaKey = \`${q}::${cats}::${cls}\`` ** — `+page.svelte:375-377`. Chave de identidade de filtro montada por `join('|')` + `::`. Um arranjo chamado `A::B` colidiria. Improvável, mas é comparação estrutural feita por string.
- **`searchParams.get('validated') === 'true'`** — `leitor:104`. Boolean por string, mas contido e correto.

### 4.2 `replaceState` vs `pushState` e o botão voltar

**[V]** — inventário completo:

| Navegação | Modo | Efeito no voltar |
|---|---|---|
| **Toda** escrita de filtro/busca/paginação (`updateUrlParams`, `urlSync.js:194-199`) | `replaceState: true` | **Nada da camada de filtros entra no histórico.** Trocar de página, buscar, filtrar — nenhum desses passos é "desfazível" com o botão voltar. |
| Limpeza do link de compartilhamento (`+page.svelte:281`) | `replaceState` | Correto: impede reimportação ao voltar |
| `handleView` / `closeView` / limpeza de `viewId` (`listas:49,325,334`) | `replaceState` | Abrir e fechar a visualização de uma lista **não** é desfazível pelo voltar |
| `CarouselNavigator` toque longo → `/listas?viewId=` (`:74`) | `replaceState` | Substitui a entrada atual — sai do carrossel sem deixar rastro |
| `CarouselChips` salvar → `/listas?editId=` (`:279`) | **push** (default) | **Entra no histórico.** Voltar retorna para `/listas?editId=...` já consumido — mas o `onMount` só roda uma vez, então voltar reabre `/listas` sem modo edição. Inconsistente com as demais. |
| `LouvorCard` → `/leitor?file=...` (`:134,190,200`) | **push** | Correto: voltar sai do PDF |
| `navigateLouvorToLeitor` (`:40,91,101`) | **push** | Correto |
| Navegação **dentro** do leitor entre PDFs do carrossel (`leitor:1240`) | `replaceState` | Deliberado: o carrossel não empilha histórico |
| `goToHome` do leitor (`leitor:1194-1209`) | `history.go(-1)` + fallback | Ver 4.5 |
| Botões da toolbar (`+layout.svelte:152,157,162,202,217`) | **push** | Correto |

**A opção `replaceState` de `updateUrlParams` é configuração morta.** **[V]** A assinatura aceita `options.replaceState` (`urlSync.js:74,77`), mas **nenhum dos 19 call sites passa options com essa chave** — os únicos options passados são `defaultMateriais` e `defaultComoAbrir`. O default `true` vale sempre.

**Consequência prática para a reescrita:** hoje, um usuário que pesquisa, pagina e filtra e depois aperta voltar **sai do app** (ou volta para a página anterior real). Se a reescrita trocar para `pushState`, esse comportamento muda drasticamente — e o `replaceState` combinado com o auto-`arranjo=` da Seção 1.3 significa que a URL do histórico **já foi reescrita** por baixo do usuário.

### 4.3 Ordem de params: importa sem precisar importar

- **Na leitura, a ordem nunca importa** — tudo passa por `URLSearchParams.get()`. **[V]**
- **Na escrita, a ordem é acidental e instável.** `urlSync.js:92` reconstrói de `new URLSearchParams(search)` (preserva a ordem de chegada) e `set()` mantém a posição de uma chave existente mas **anexa no fim** uma chave nova. Logo a ordem final depende de **qual bloco reativo escreveu primeiro** — que por sua vez depende de timers de 0/100/200/300/500 ms. Duas sessões idênticas produzem URLs com params em ordens diferentes. **[V]** Isso não afeta funcionalidade, mas **impede qualquer teste de igualdade de string sobre a URL gerada**, e faz links "iguais" parecerem diferentes ao usuário.
- **Ordem interna do CSV de `materiais` é normalizada** (`filters.js:13-25`) mas a de `arranjo` e `arranjoEspecial` **não é** — elas seguem a ordem de clique. **[V]**

### 4.4 Params escritos e nunca lidos (e vice-versa)

| Situação | Detalhe |
|---|---|
| **Lido, nunca usado** | `ordenar` na `/` — `parseUrlParams` o extrai (`urlSync.js:65`) mas `+page.svelte` jamais o consulta. Fica na URL indefinidamente porque `updateUrlParams` preserva params não citados. **[V]** |
| **Lido, nunca usado** | `arranjoEspecial` na `/` — mesmo caso: a home não tem `SpecialArrangementFilters`. **[V]** |
| **Escrito, nunca lido de volta pela origem** | `itensPorPagina` escrito pela home (`+page.svelte:520`) por causa do store compartilhado com a biblioteca. **[V]** |
| **Removido sem nunca poder ser escrito** | "nenhum material selecionado" (`urlSync.js:100-103`: `materiais.length === 0` → `delete`). O estado existe no store, é alcançável pela UI (`filters.deselectAll()`, `CategoryFilters.svelte:34`), e é **impossível de representar na URL**. Recarregar a página o perde. **[V]** |
| **Aceito na leitura, nunca produzido na escrita** | `materiais` com as 3 categorias; `comoAbrir=leitor`; `ordenar=numero`; `itensPorPagina=10`; `pagina=1`. Todos são apagados na escrita mas aceitos na leitura. **A reescrita precisa continuar aceitando-os.** |
| **Código morto** | `handleSearch()` (`+page.svelte:325-327`) — `SearchBar.svelte` só despacha `clear` e `blur`; nada chama `handleSearch`. **[V]** |
| **Bug tipográfico inerte** | `biblioteca:204`: `$page.pathname === '/biblioteca'` — `$page.pathname` **não existe** (o correto é `$page.url.pathname`), logo a condição é sempre `false`. O corpo do `else if` é vazio (só comentários), então não há efeito — mas é um `if` que nunca pode ser verdadeiro. **[V]** |
| **Flag decorativa** | `pageInitializedFromUrl` na **home** (`+page.svelte:49,213,365,381,386`) é escrita em 4 lugares e **lida em nenhum**. Na biblioteca (`:358`) ela é lida e importa. **[V]** |

### 4.5 `setTimeout` / `tick()` usados como sincronização

Além dos 15 religamentos de flag da Seção 3.1:

| Local | Delay | Papel |
|---|---|---|
| `+page.svelte:225-227` | 200 ms | "esperar os dados reativos processarem" antes de auto-selecionar arranjos |
| `+page.svelte:537-539` | 300 ms | debounce da filtragem |
| `+page.svelte:546-562` | 500 ms | debounce da escrita de `pesquisa` na URL |
| `biblioteca:578-582` | 0 ms | "evitar conflito com outras atualizações" antes de `selectAll` |
| `biblioteca:633-642` | 100 ms + 500 ms aninhado | liberar a sincronização bidirecional após o `onMount` |
| `biblioteca:676-678` | 200 ms | idem home |
| `+layout.svelte:104-106,113` | 0 ms e 100 ms | `checkAndFixUrl` — corrige divergência entre `window.location` e `$page.url` quando o SW serve o shell (standalone/PWA) |
| `leitor:1204-1208` | 100 ms | detectar se `history.go(-1)` "funcionou" comparando `window.location.href` antes/depois |
| `listas:247-252` | 10 ms | esperar o input de edição ganhar foco para dar `select()` |
| `listas:343,357` | `await tick()` (2×) | esperar o DOM antes de ler `editId` |
| `CarouselChips.svelte:281-283` | 0 ms | soltar `isSaving` |
| `listas:295-297,305-307` | 100 ms | `isSavingOrCanceling` — evitar que o `blur` cancele o save |

**O caso mais frágil é `+layout.svelte:92-113`** (`checkAndFixUrl`): compara `window.location.pathname + search` com `$page.url.pathname + search` como **strings**, e se diferirem chama `goto(windowUrl, {replaceState:true})`. Como as duas fontes podem codificar espaços de forma diferente (`+` vs `%20`) e a ordem dos params pode divergir após uma reescrita, essa comparação pode dar falso-positivo e **forçar uma navegação espúria**. Roda duas vezes: imediatamente e 100 ms depois. **[I — não observei o falso-positivo, mas a comparação de strings de URL é estruturalmente insegura]** Este é um caminho que **pode reescrever a URL do `/leitor`**.

### 4.6 Código que depende da ordem de execução de blocos `$:`

Svelte 4 ordena blocos `$:` por dependência topológica **dentro do mesmo componente**; entre componentes e entre stores não há ordem garantida. Pontos onde isso importa:

- `biblioteca:171-185` (reset de `selectedSpecialArrangements`) lê `availableSpecialArrangements`, que é definido **depois**, em `:77-105`. Svelte reordena por dependência — mas isso é invisível na leitura do arquivo e frágil a qualquer edição que quebre a análise estática (por exemplo, mover a leitura para dentro de uma função). **[V]**
- `biblioteca:212-247` lê **e escreve** `selectedSpecialArrangements` e `previousAvailableLength`, e escreve a URL. Um bloco que escreve suas próprias dependências indiretas.
- `+page.svelte:468-505` e `:507-523` são dois blocos que dependem ambos de `$page` e de `$bibliotecaItemsPerPage`, e um deles escreve a URL. A ordem entre eles decide se `itensPorPagina` é lido antes ou depois de ser escrito. **[V]**
- **Fora do componente**: os três `page.subscribe` de módulo (`filters.js:71`, `classificationFilters.js:32`, `pdfViewer.js:35`) rodam na **ordem de importação dos módulos**, antes ou depois dos blocos `$:` das páginas, sem nenhuma garantia. **[V]**

### 4.7 A corrida que faz o deep link `?pesquisa=X&pagina=3` funcionar "às vezes"

Este é o achado que mais me preocupa. Traçando **[V para cada trecho de código; I para a conclusão temporal]**:

1. `t≈0` — componente monta. `+page.svelte:29` inicializa `searchQuery` da URL. Bloco `:527` dispara e agenda `filterLouvores` para `t=300`.
2. `onMount` → `await loadLouvores()`. Ao voltar, `:215-216` põe `currentPage = 3`.
3. `filterLouvores` roda em `t=300` (ou 300 ms depois da última mudança de `$filters`/`$classificationFilters`). Na **primeira** execução, `lastFilterCriteriaKey` é `null` (`:379`), então `shouldResetPageOnFilterResult` **não** é ligado, e a chave é registrada em `:383` — **inclusive quando `$louvores` ainda está vazio**, porque `:383` vem **antes** do early-return de `:390`.
4. `initializeFiltersIfNeeded` roda ~200 ms após `louvoresLoaded` (`:225-227`) e chama `classificationFilters.selectAll(...)`, mudando `$classificationFilters`.
5. Isso **re-dispara** o bloco `:527` (dependência em `:529`), reagendando `filterLouvores`.

**Se o passo 4 acontecer antes de `t=300`** (manifesto rápido, cache quente): o debounce é reagendado, `filterLouvores` roda **uma única vez** com a chave final. Sem reset. **A página 3 é preservada.**

**Se o passo 4 acontecer depois de `t=300`** (rede lenta, cold start, primeira visita): `filterLouvores` já rodou com `criteriaKey` A (arranjos vazios). Na segunda execução, `criteriaKey` B ≠ A → `:380` liga `shouldResetPageOnFilterResult` → `finalizeFilteredResults:70-77` faz `currentPage = 1` **e reescreve a URL removendo `pagina`**.

Ou seja: **`https://plpcg.com/?pesquisa=amor&pagina=3` leva à página 3 numa aba quente e à página 1 numa aba fria.** Esse é o tipo de bug que o dono descreveu. A reescrita precisa **decidir conscientemente** qual dos dois comportamentos é o correto — não reproduzir a corrida. **[A]**

### 4.8 A corrida entre o debounce de busca e a navegação para o leitor

`+page.svelte:546-562` é o **único** escritor de URL da home **sem guarda de `pathname`** (compare com `:335`, `:74`, `:81`, `:101`, `:474`, `:511`, que todos checam `pathname === '/'`). Cenário **[I — plausível, não observado]**:

1. Usuário digita "amor" e, em menos de 500 ms, clica num `LouvorCard`.
2. `LouvorCard:134` dispara `goto('/leitor?file=...&titulo=...')` (push).
3. O timer de 500 ms dispara. `updateUrlParams` lê `get(page)`:
   - se a navegação ainda **não** resolveu → `pathname === '/'` → `goto('/?pesquisa=amor', {replaceState:true})` **compete com / cancela** a navegação para o leitor;
   - se **já** resolveu → `pathname === '/leitor'` e `currentParams` já contém `file`/`titulo` → a URL vira `/leitor?file=...&titulo=...&subtitulo=...&pesquisa=amor`, **com replaceState**. O PDF continua abrindo (o `file` é preservado), mas a URL do leitor fica poluída e o histórico foi sobrescrito.

**Este é o mecanismo concreto pelo qual a camada de filtros pode tocar a URL do PDF.** A guarda que falta é uma linha.

### 4.9 Escritas concorrentes se sobrescrevem (last-write-wins)

`updateUrlParams` lê a base da query com `get(page)` (`urlSync.js:83`) e navega com `goto` (assíncrono). **Duas chamadas no mesmo tick partem da mesma base e a segunda descarta a primeira.** **[I — alta confiança pela estrutura; o próprio código admite]**

Prova de que o time já bateu nisso: `homeSearchUrlParams` (`+page.svelte:120-123`) existe **exatamente** para reinjetar `pagina` junto com `pesquisa`, com o comentário *"Mantém `pagina` na URL ao sincronizar pesquisa (evita reset para página 1)"*. É uma correção pontual para um problema estrutural. **[V]**

Pares em risco: `biblioteca:468` (`ordenar`) + `:477` (`itensPorPagina`) — dois blocos reativos que podem disparar no mesmo flush; `filters.updateUrl` + `classificationFilters.updateUrl` quando um clique muda os dois.

### 4.10 Duplo decode em `parseUrlParams` (resumo do defeito estrutural)

`urlSync.js:47-68` extrai valores com `URLSearchParams.get()` — **que já decodifica** — e depois aplica `safeDecodeURIComponent` (`:20-26`) ou `deserializeArrayParam` (`:36-42`, que decodifica cada item). O comentário em `:11-14` demonstra que o autor sabia do risco na **escrita** ("não codifique por item, geraria `%2520`") mas replicou o erro na **leitura**. Efeito medido em 4.1/1.1: qualquer `%XX` literal digitado pelo usuário é decodificado a mais.

Salvo pelo `try/catch`, nunca lança. Mas **corrompe silenciosamente**. E: `deserializeArrayParam` também aplica `.trim()` por item e `.filter(Boolean)` — logo `?arranjo=PES,,PES CIAs` e `?arranjo= PES , PES CIAs ` são ambos aceitos e normalizados. **[V]** Esse comportamento tolerante **deve ser preservado**.

---

## 5. Contrato de compatibilidade

Esta é a lista de URLs que precisam continuar funcionando. Cada linha é um caso de teste: **URL de entrada → estado esperado**. Marquei com **⚠︎** os casos em que o comportamento atual é discutível e a reescrita precisa **decidir** em vez de reproduzir.

### 5.1 Links de compartilhamento de lista — prioridade máxima

| # | URL de entrada | Estado esperado |
|---|---|---|
| C1 | `/?sharepdfs=<b64A>,<b64B>&sharename=Culto%20de%20Domingo` | Carrossel limpo e recarregado com A e B **na ordem dada**; lista salva no `localStorage` com nome `Culto de Domingo`; URL reescrita para `/` com `replaceState` (voltar **não** reimporta) |
| C2 | Mesma URL de C1, aberta **antes** de o manifesto carregar | Nada acontece até `$louvores.length > 0`; então C1 se aplica. Nunca perder o link por chegar cedo. |
| C3 | `/?sharepdfs=<b64A>` (sem `sharename`) | Lista salva com nome default `lista dd/mm/aaaa HH:MM:SS` |
| C4 | `/?sharepdfs=<b64A>,<b64_inexistente>,<b64B>` | Carrossel com **A e B apenas**; ids desconhecidos descartados sem erro visível. ⚠︎ Hoje a lista **salva** guarda o id fantasma (§2.4c) — decidir se corrige. |
| C5 | `/?sharepdfs=<id_com_igual=>` | Ids com `=` de padding **devem** sobreviver (2 198 dos 4 629 ids têm `=`). Verificado que sobrevivem hoje. |
| C6 | `/?sharepdfs=<id_com_barra/>` | Ids com `/` **devem** sobreviver (9 ids). Verificado que sobrevivem hoje. |
| C7 | `/?sharepdfs=<id_com_mais+>` | ⚠︎ Hoje **quebra em silêncio** (`+`→espaço). Nenhum id assim existe hoje, mas a reescrita **deve** corrigir isso — encodar cada id, ou trocar para base64url. **Se mudar a codificação de saída, a leitura tem que continuar aceitando o formato antigo (base64 cru separado por vírgula), senão todo link já enviado no WhatsApp morre.** |
| C8 | `/?sharepdfs=<b64A>&sharename=Louvor%20100%25` | ⚠︎ Hoje lança `URIError`, deixa a URL suja e **não salva a lista**. Esperado após a reescrita: nome `Louvor 100%`, lista salva, URL limpa. |
| C9 | `/?sharepdfs=&sharename=x` | Nada é importado; URL deveria ser limpa. ⚠︎ Hoje fica suja e o bloco reativo reavalia sem fim. |
| C10 | `/?sharepdfs=,,,` | Nada importado; URL limpa. ⚠︎ Hoje fica suja. |
| C11 | Mesmo link de C1 aberto **três vezes** | ⚠︎ Hoje cria 3 listas idênticas. Decidir: deduplicar por `findPlaylistByPdfIds` ou manter. |
| C12 | Link C1 com 50 louvores (~3 450 chars) | Deve funcionar por inteiro |
| C13 | `/?sharepdfs=...&pesquisa=amor` | ⚠︎ Hoje `pesquisa` é descartado junto na limpeza (§2.4g) |
| C14 | Link C1 aberto **offline**, com o manifesto em cache | Deve importar normalmente — o consumo não faz rede |

### 5.2 Links de filtro e busca — o que já está circulando

| # | URL de entrada | Estado esperado |
|---|---|---|
| F1 | `/?arranjo=Avulsos+Diversos%2CColet%C3%A2nea+Adultos%2CColet%C3%A2nea+CIAs%2CPES%2CPES+CIAs` | Os 5 arranjos selecionados. **Este é o formato que o app grava sozinho na barra de endereços de todo mundo** (§1.3) — é, na prática, o link mais copiado do app. |
| F2 | `/?arranjo=PES,PES CIAs` (vírgula e espaço crus, digitados à mão) | 2 arranjos selecionados. Aceitar espaço literal **e** `+` **e** `%20`. |
| F3 | `/?arranjo=%20PES%20,,PES%20CIAs%20` | Igual a F2 — `trim()` por item + `filter(Boolean)` (§4.10) |
| F4 | `/?materiais=Cifra` | Só material Cifra (expandido para incluir `Cifra nível I` e `Cifra nível II` na filtragem) |
| F5 | `/?materiais=Cifra,Partitura` | Os dois. **A ordem na URL é irrelevante** (normalizada) |
| F6 | `/?materiais=Partitura,Cifra,Gestos em Gravura` | Todos os três (equivalente a sem param). Nunca produzido pela escrita, **deve continuar aceito** |
| F7 | `/?materiais=` (vazio) | ⚠︎ Hoje: **zero materiais → zero resultados**. Estado alcançável na UI mas irrepresentável na escrita. Decidir. |
| F8 | `/?arranjo=` (vazio) | ⚠︎ Hoje: `urlHasArranjo=true` bloqueia o auto-select-all → **zero resultados**. |
| F9 | `/?comoAbrir=newtab` | `pdfViewer` = `newtab`; clicar num louvor abre o PDF em nova aba |
| F10 | `/?comoAbrir=share` / `save` / `online` / `leitor` | Todos os 5 modos válidos precisam continuar funcionando |
| F11 | `/biblioteca?comoAbrir=newtab` | **`comoAbrir` funciona em qualquer rota** (store global) |
| F12 | `/?comoAbrir=lixo` | Modo cai para `leitor`. ⚠︎ Hoje o param inválido **permanece na URL**; decidir se passa a limpar |
| F13 | `/?pesquisa=amor` | Campo de busca preenchido com `amor`, resultados filtrados |
| F14 | `/?pesquisa=124` | Busca numérica: casa `Number(louvor.numero) === 124` (`+page.svelte:446-451`) — caminho distinto da busca textual |
| F15 | `/?pesquisa=Cora%C3%A7%C3%A3o` | Acentos preservados |
| F16 | `/?pesquisa=100%25` | Texto `100%` na caixa (o `try/catch` de §1.1 tem que continuar existindo) |
| F17 | `/?pesquisa=` (vazio) | Caixa vazia, nenhum resultado (a home só lista com busca) |
| F18 | `/?pesquisa=amor&arranjo=PES&materiais=Cifra&comoAbrir=newtab` | Todos os quatro aplicados simultaneamente |

### 5.3 Paginação e ordenação

| # | URL de entrada | Estado esperado |
|---|---|---|
| P1 | `/?pesquisa=amor&pagina=3` | ⚠︎ **Página 3.** Hoje é uma corrida (§4.7): funciona em aba quente, cai para 1 em cold start. **A reescrita tem que escolher — e página 3 é a escolha certa.** |
| P2 | `/?pesquisa=amor&pagina=999` | Clampado para a última página válida; URL reescrita com o valor clampado (ou sem `pagina` se for 1) |
| P3 | `/?pagina=3` (sem `pesquisa`) | Home não lista nada sem busca → clampa para 1 e **remove** `pagina` da URL |
| P4 | `/?pagina=0` / `/?pagina=-2` / `/?pagina=abc` | Página 1, sem erro |
| P5 | `/biblioteca?pagina=5` | Página 5 da biblioteca (que lista sem precisar de busca) |
| P6 | `/biblioteca?pagina=5&itensPorPagina=25` | 25 por página, página 5 — **as duas coisas ao mesmo tempo**. Este é o caso que as flags de 100 ms mais protegem. |
| P7 | `/biblioteca?ordenar=nome` | Ordenação alfabética (`compareLouvorNome`) |
| P8 | `/biblioteca?ordenar=numero` | Ordenação numérica (= default). Aceito na leitura, nunca produzido na escrita |
| P9 | `/biblioteca?ordenar=aleatorio` | Ignorado → `numero`. ⚠︎ Hoje o param permanece na URL |
| P10 | `/biblioteca?itensPorPagina=7` | Cai para 10, e hoje a **biblioteca limpa** o param da URL |
| P11 | `/?itensPorPagina=7` | Cai para 10, mas hoje a **home mantém** o param. ⚠︎ Assimetria a resolver |
| P12 | `/biblioteca?ordenar=nome&itensPorPagina=50&pagina=4&arranjo=PES&arranjoEspecial=GLTM&materiais=Cifra&comoAbrir=newtab` | **Todos os 7 params simultâneos.** Este é o caso de regressão mais denso do app. |
| P13 | `/biblioteca?arranjoEspecial=GLTM` | Só o arranjo especial GLTM; auto-select-all **não** roda |
| P14 | `/biblioteca?arranjoEspecial=Inexistente` | Descartado; auto-select-all **não** roda (porque `includes('arranjoEspecial=')` é verdadeiro) → nenhum especial selecionado |
| P15 | `/biblioteca?arranjoEspecial=Padr%C3%A3o` | O valor sintético `Padrão` tem que continuar funcionando |
| P16 | Vir de `/biblioteca?itensPorPagina=25` e navegar para `/` | ⚠︎ Hoje a home **grava `itensPorPagina=25`** na própria URL (store compartilhado, §1.6). Decidir se é feature ou vazamento. |

### 5.4 Listas locais

| # | URL de entrada | Estado esperado |
|---|---|---|
| L1 | `/listas?viewId=<id_existente>` | Abre a visualização daquela lista |
| L2 | `/listas?viewId=<id_inexistente>` | Volta para a lista geral **e apaga `viewId` da URL** com `replaceState` (comportamento correto — preservar) |
| L3 | `/listas?viewId=` (vazio) | Idem L2 |
| L4 | `/listas?editId=<id>` | Entra em modo edição do nome e limpa **toda** a query com `goto('/listas', {replaceState})` |
| L5 | `/listas?editId=<id1>&viewId=<id2_válido>` | `editId` é descartado, `viewId` prevalece (`listas:347-353`) |
| L6 | `/listas?editId=<id_inexistente>` | Nada acontece, mas a query é limpa mesmo assim |
| L7 | Link `/listas?viewId=<id>` mandado para **outro aparelho** | Cai em L2 — ids são de `localStorage`. **Correto; não "consertar".** |

### 5.5 A fronteira do PDF — não pode quebrar

| # | URL de entrada | Estado esperado |
|---|---|---|
| R1 | `/leitor?file=%2F04112025%2FConhe%C3%A7amos%20e%20prossigamos%2FCifra.pdf&titulo=Conhe%C3%A7amos%20e%20prossigamos&subtitulo=Cifra%20%7C%20PES%20CIAs&validated=true` | Abre o PDF, com título e subtítulo, pulando a validação |
| R2 | Mesma URL sem `&validated=true` | Abre o PDF **com** o fluxo de validação/download |
| R3 | `/leitor` sem params | Abre `/pdfs/exemplo.pdf` |
| R4 | Navegar `/?pesquisa=X` → clicar num louvor **em menos de 500 ms** | ⚠︎ §4.8. Deve abrir o PDF; a URL do leitor **não pode** ganhar `pesquisa`, e a navegação **não pode** ser cancelada. |
| R5 | Qualquer escrita de filtro enquanto `$page.url.pathname === '/leitor'` | **Nenhuma escrita de URL pode ocorrer em `/leitor`.** Hoje isso é garantido por acidente (nenhum componente escritor é montado lá). A reescrita precisa de uma **guarda explícita de rota** em `updateUrlParams`. |
| R6 | `/leitor?file=...` aberto em modo standalone (PWA) com o SW servindo o shell | `checkAndFixUrl` (`+layout.svelte:92-113`) deve reparar a URL — mas usa comparação de string (§4.5). Não regredir. |

### 5.6 Casos degenerados adicionais

| # | URL de entrada | Estado esperado |
|---|---|---|
| D1 | `/?parametroDesconhecido=x` | Ignorado **e preservado** por todas as reescritas (`urlSync.js:92` parte da query existente). Um param de terceiros (`utm_source`, `fbclid`) **não pode** ser apagado — links do WhatsApp/Facebook carregam esses. |
| D2 | `/?utm_source=whatsapp&sharepdfs=<b64>` | A importação funciona; ⚠︎ hoje o `utm_source` é apagado junto na limpeza (§2.4g) |
| D3 | `/?pesquisa=arranjo=x` | ⚠︎ §4.1 — `includes('arranjo=')` dá falso-positivo, o auto-select-all não roda, **zero resultados**. Regressão a corrigir. |
| D4 | `/?pesquisa=amor&pesquisa=paz` (chave repetida) | `URLSearchParams.get` devolve o **primeiro**. A escrita seguinte (`.set`) colapsa para um só. |
| D5 | `/?PESQUISA=amor` (maiúsculas) | Ignorado — chaves são case-sensitive |
| D6 | `/?ordenar=nome` na **home** | Inerte, mas **preservado indefinidamente**. Não regredir para "apagar params de outras rotas". |
| D7 | URL sem nenhum param, `/` | ⚠︎ ~200 ms depois, a URL vira `/?arranjo=<5 valores>` sozinha (§1.3), via `replaceState`. Decidir se a reescrita mantém isso. Se **remover**, todos os links F1 já compartilhados continuam funcionando (são só arranjo=tudo, que é o default) — **mudar isso é seguro**. Se **manter**, a URL default continua feia. |
| D8 | Voltar (botão do navegador) depois de buscar/paginar/filtrar | ⚠︎ Hoje **sai do app** — nada disso está no histórico. Se a reescrita passar a usar `pushState`, é uma mudança de comportamento visível ao usuário, e precisa ser decisão explícita. |
| D9 | Recarregar (F5) numa URL com filtros | Todo o estado é restaurado da URL — este é o contrato central e não pode regredir em nenhum param. |

---

## Apêndice — arquivos que a reescrita toca

**Núcleo (reescrever):**
- `src/lib/utils/urlSync.js` — 199 linhas, `serializeArrayParam`, `deserializeArrayParam`, `parseUrlParams`, `updateUrlParams`
- `src/routes/+page.svelte:25-581` — home
- `src/routes/biblioteca/+page.svelte:1-765` — biblioteca

**Stores que escrevem a URL a partir de `page.subscribe` (o padrão a eliminar):**
- `src/lib/stores/filters.js:63-148`
- `src/lib/stores/classificationFilters.js:24-89`
- `src/lib/stores/pdfViewer.js:27-74`

**Stores que só leem a URL na inicialização (seguros):**
- `src/lib/stores/bibliotecaSort.js:9-40`
- `src/lib/stores/bibliotecaItemsPerPage.js:10-42`

**Compartilhamento:**
- `src/lib/utils/playlistUtils.js` (52 → 61 é a função crítica)
- `src/routes/+page.svelte:256-294` (consumo)
- `src/routes/listas/+page.svelte:36-50, 218-236, 320-367`
- `src/lib/components/CarouselChips.svelte:279, ~290`
- `src/lib/components/CarouselNavigator.svelte:68-75`

**Não tocar (fronteira do PDF):**
- `src/routes/leitor/+page.svelte:100-104, 1236-1240`
- `src/lib/utils/navigateLouvorToLeitor.js`
- `src/lib/components/LouvorCard.svelte:126-200`
- `src/lib/stores/offline.js:2146-2147`
- `src/routes/+layout.svelte:92-113` (`checkAndFixUrl`) — tocar só com muito cuidado
