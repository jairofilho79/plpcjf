# A camada de caminho/URL de PDF — mapa completo

Investigação do achado #22 ("a raiz de vinte achados"): a divergência entre
`pathUtils.normalizePdfUrl` e `PdfPathManager.normalizeForStorage`.

**Método.** Todo o código citado foi lido. As tabelas de divergência e as
estatísticas do acervo foram **executadas** com `node` importando os módulos
reais do repositório (via um resolve-hook de ESM que só mapeia `$lib/` para
`src/lib/`; nenhum arquivo do projeto foi alterado ou copiado). Onde uma
afirmação não pôde ser executada, está marcada **[inferido]**.

Marcação usada: **[V]** = verificado (li ou executei o código que prova);
**[I]** = inferido.

---

## 1. As representações

São **nove** formas distintas que um caminho de PDF assume. Sete são de
produção; duas são derivadas/mortas mas ainda existem no aparelho do usuário.

### 1.1 Entrada do `louvores-manifest.json`

**[V]** `louvores-manifest.json` (raiz do repo, não versionado) é um array de
4629 objetos. Não há campo de caminho: há `pdf` (só o nome do arquivo) e
`pdfId`.

```json
{
  "nome": "Conheçamos e prossigamos",
  "classificacao": "PES CIAs",
  "numero": "",
  "categoria": "Cifra",
  "pdf": "Cifra.pdf",
  "pdfId": "MDQxMTIwMjUvQ29uaGXDp2Ftb3MgZSBwcm9zc2lnYW1vcy9DaWZyYS5wZGY=",
  "groupId": "avulso:conhecamos-e-prossigamos"
}
```

O campo `pdf` **não** é usado para montar caminho em lugar nenhum — só o
`pdfId`. **[V]** (grep: `getPdfRelPath`/`getPdfUrl` só leem `louvor.pdfId`).

Estatísticas executadas sobre o manifesto real:

| medida | valor |
|---|---|
| entradas | 4629 |
| caminhos relativos únicos | 4629 (nenhuma duplicata) |
| `pdfId` que já decodifica com prefixo `assets/` | 27 |
| `pdfId` que decodifica contendo `%` | 0 |
| `pdfId` que decodifica começando por `/` | 0 |
| caminhos em forma NFD (acento decomposto) | **8** |
| caracteres não-ASCII no acervo | `º À Á Â É Ó Ú à á â ã ç é ê í ó ô õ ú ́ ̂ ̃ ̧ ’` |
| nomes de arquivo distintos | 1749 (para 4629 caminhos) |
| caminhos que partilham nome de arquivo com outro | **3311** |

Os quatro nomes de arquivo mais repetidos: `Cifra I.pdf` (1036×),
`Cifra II.pdf` (1033×), `Gestos CIAs.pdf` (254×), `Partitura.pdf` (24×).
Isto é o que torna qualquer correspondência por *basename* perigosa (§3).

### 1.2 `pdfId` → caminho relativo (Base64 UTF-8)

**Onde nasce:** gerado pela admin, gravado no manifesto.
**Quem consome:** `getPdfRelPath` (`src/lib/utils/pathUtils.js:101`) e o gêmeo
`getPdfUrl` (`src/lib/stores/offline.js:1519`).

**[V]** `src/lib/utils/pathUtils.js:41-80` (`computePdfRelPath`, memoizado por
`getPdfRelPath` em :101-112):

```js
const decoded = atobUTF8(louvor.pdfId);          // :49  base64 → UTF-8
let path = decoded.replace(/^\/+/, '').trim();   // :51
if (path.includes('%')) path = decodeUrlUtf8Multiple(path, 3);  // :61
const lowerPath = path.toLowerCase();
if (lowerPath.startsWith('assets/')) return path;               // :70-73
return `assets/${path}`;                                        // :76
```

`atobUTF8` (`:22-36`) é `atob()` + `Uint8Array` + `TextDecoder('utf-8')` —
`atob()` sozinho decodifica em latin-1 e quebraria todo acento.

Resultado: `assets/04112025/Conheçamos e prossigamos/Cifra.pdf` — **caixa e
acento exatamente como no bucket**. Nenhuma normalização.

**Duplicata:** `src/lib/stores/offline.js:1519-1545` (`getPdfUrl`) faz o mesmo,
mas devolve **com** barra inicial (`/assets/…`) e **sem** o passo de
`decodeUrlUtf8Multiple`. Duas funções, dois formatos de saída, mesma intenção.

### 1.3 URL de rede

Três construtores diferentes, e eles **não concordam**:

| construtor | arquivo:linha | como codifica |
|---|---|---|
| `PdfPathManager.createRequestUrl` | `src/lib/offline/utils/PdfPathManager.js:75-97` | `createUrlUtf8` → `encodeURI` |
| `new URL('/'+path, origin).href` | `src/routes/leitor/+page.svelte:264` | parser WHATWG |
| `createUrlUtf8('/'+path, origin)` | `src/lib/utils/missingPdfsDownloader.js:112`, `src/lib/utils/pdfValidation.js:121,171` | `encodeURI` |

**[V] Bug encontrado (executado):** `encodeURI` escapa `[` e `]` para
`%5B`/`%5D`; o parser da `URL` deixa-os literais. Sobre os 4629 caminhos reais,
**3 divergem**:

```
p:         assets/30102025/Sobe aqui [26-07-2025] - Coro.pdf
chave gravada (createRequestUrl):  …/Sobe%20aqui%20%5B26-07-2025%5D%20-%20Coro.pdf
URL pedida pelo leitor (new URL):  …/Sobe%20aqui%20[26-07-2025]%20-%20Coro.pdf
```

Os outros dois: `assets/PES/Ó profundidade das riquezas - Vocal [20 03 2026].pdf`
e `assets/PES/Perante a tua grandeza - Vocal [06 02 2025].pdf`.

Para esses três louvores o `cache.match(event.request)` direto do Service
Worker (`src/service-worker.js:203`) **erra sempre**, e só a estratégia de
variações (`:206`) os salva. É a prova concreta e mensurável de que a
correspondência difusa é hoje carga estrutural, não redundância.

### 1.4 Chave do Cache Storage (`plpc-pdfs`)

Cache **sem versão**, protegido do `activate`
(`src/lib/offline/sw/swCaches.js:18,44-48,82-88`). É onde vivem os PDFs que o
usuário baixou.

Há **quatro escritores distintos**:

| # | escritor | arquivo:linha | chave gravada |
|---|---|---|---|
| 1 | `CacheStorageAdapter._putPdfInternal` | `src/lib/offline/storage/CacheStorageAdapter.js:297-300` | `createRequestUrl(pdfPath)` |
| 2 | SW `handlePdf` (grava o que veio da rede) | `src/service-worker.js:219-223` | `createUrlUtf8('/'+normalizeForStorage(url.pathname))` |
| 3 | SW `handleDownloadPDFs` (lote pedido pelo cliente) | `src/service-worker.js:440-444` | **a URL crua enviada pelo cliente**, sem normalizar |
| 4 | `offline.js` extração de ZIP | `src/lib/stores/offline.js:981-986` | `createUrlUtf8(normalizeZipEntryName(name))` |

Os escritores 1, 2 e 4 convergem para a mesma string
(`origin + encodeURI('/' + normalizeForStorage(path))`) **[V]**. O escritor 3
depende de quem chamou: hoje as chamadas passam `validation.url`, que vem de
`PdfPathManager.createRequestUrl` (`CacheValidator.js:80`,
`IndexValidator.js:82`) ou de `createUrlUtf8` (`missingPdfsDownloader.js:112`) —
convergentes. **[I]** Mas nada no código força isso: `handleDownloadPDFs` aceita
qualquer string.

`normalizeZipEntryName` (`src/lib/stores/offline.js:535-569`) é uma **cópia
literal** de `normalizeForStorage`, com uma única diferença: devolve com barra
inicial. **[V]**

### 1.5 Chave do R2

Bucket `pls-louvores` (`wrangler.toml:9-11`). A chave esperada é o caminho
relativo sem barra inicial: `assets/04112025/Conheçamos e prossigamos/Cifra.pdf`.

Três tentativas em cascata, idênticas em `src/hooks.server.js:54-97` e
`worker/index.js:62-102`:

1. `decodeURIComponent(pathname.substring(1))` → `bucket.get(key)`
2. laço de até 5 `decodeURIComponent` sucessivos (codificação dupla/tripla)
3. `bucket.list({prefix})` + `findExactKeyMatch` (`src/lib/server/r2KeyMatch.js:36-44`)

`normalizeR2Key` (`src/lib/server/r2KeyMatch.js:19-29`) é a **terceira**
normalização do sistema, e a mais agressiva:

```js
key.replace(/\\/g,'/').normalize('NFD').replace(/[̀-ͯ]/g,'')
   .toLowerCase().split('/').map(s => s.replace(/[^a-z0-9]/g,'')).join('/')
```

Minúsculas, sem acento (via NFD, portanto correto), e **sem nenhum caractere
não-alfanumérico dentro de cada segmento** — a barra é o único separador que
sobrevive. `Cifra nível I.pdf` → `cifranivelipdf`.

### 1.6 Caminho dentro do ZIP

**[V]** `scripts/generate-offline-packages.mjs:197-200`:

```js
const internalPath = ensurePosixPath(file.pdfPath);
zip.addFile(file.absolutePath, internalPath);
```

onde `file.pdfPath` vem de `decodePdfId` (`:21-51`), que replica
`computePdfRelPath`: base64 → UTF-8, prefixo `assets/`. **O caminho dentro do
ZIP é literalmente a mesma string do §1.2** — caixa e acento preservados.

Na leitura, dois consumidores distintos:

- `OfflineBundleImporter.processPart` → `PdfPathManager.normalizeForStorage(entryName)`
  (`src/lib/offline/import/OfflineBundleImporter.js:211`), grava em staging.
- `offline.js` (download por categoria) → `normalizeZipEntryName(name)`
  (`src/lib/stores/offline.js:971`), grava direto no cache principal.

O staging (`plpc-pdfs-import-staging`) usa a **mesma** convenção de chave e é
copiado verbatim para `plpc-pdfs` no commit
(`OfflineBundleImporter.js:419-435`: `main.put(request, response.clone())`).

### 1.7 `offline-manifest.json` (partes)

**[V]** Estrutura: `{version, timestamp, packages: {<categoria>: {parts: [{filename, url, size, pdfs: string[]}]}}}`.
O campo `pdfs` de cada parte é uma lista de **pdfIds**, não de caminhos. Uma
das amostras é `MDUwNDIwMjYvQSBPYnJhIGRvIFNlbmhvciBlzIEgUGVyZmVpdGEvQ29yby5wZGY=`
→ `05042026/A Obra do Senhor é Perfeita/Coro.pdf` **em NFD** (`e` + U+0301).
Ver §2.4.

### 1.8 O que vai para o `localStorage`

Nenhuma chave de `localStorage` é indexada por caminho normalizado. **[V]**

| chave | conteúdo | indexada por | TTL / versão |
|---|---|---|---|
| `pdfAvailabilityIndex` | `{version:1, timestamp, index: {pdfId: bool}}` | **pdfId** | 24 h + `version` (`src/lib/utils/pdfIndex.js:9-11,148-159`) |
| `pdfValidationCache_v1` | `{v:1, entries: {pdfId: [0\|1, url, ts]}}` | **pdfId** (o *valor* guarda uma URL absoluta) | 24 h (`src/lib/utils/validationCacheStore.js:11-12,58-72`) |
| `cachedPdfsList` | array de URLs absolutas do cache | — | reescrito a cada `reloadCache` (`src/lib/stores/offline.js:363`) |
| `cachedPdfsListLocal` | `{pdfs, timestamp}` | — | 5 min (`src/lib/utils/swRegistration.js:300-301`) |
| `offlineStatsCache_v2` | stats por categoria | categoria | — |
| `cache_migration_v2_completed` | `'true'` | — | permanente (`CacheMigrationV2.js:30`) |
| `offlineManifest`, `OFFLINE_CATEGORIAS_SALVAS`, `downloadedCategories`, `OFFLINE_AVAILABLE`, `ALLOW_OFFLINE` | catálogo e estado | — | permanente (`OfflineBundleImporter.js:449-510`) |

**Consequência importante:** os únicos dados persistidos indexados por *caminho*
são as chaves do Cache Storage. Tudo em `localStorage` é ou indexado por `pdfId`
(imutável, `getPdfRelPath` até memoiza por ele — `pathUtils.js:88`) ou
reconstruível com TTL curto.

### 1.9 IndexedDB: **não existe**

**[V]** `src/lib/pdf-reader/pdfSourceResolver.js:25` só usa IDB se
`getConfig('OFFLINE_IDB_ENABLED') === true`. `getConfig` é
`config[key]` (`OfflineConfig.js:94-96`) e `OFFLINE_IDB_ENABLED` **não está
definido** em `OfflineConfig.js` (grep sem resultado). Logo
`resolvePdfSourceUrl` sempre devolve `{url: fileUrl, newObjectUrl: null}` e
nunca cria object URL. O comentário do arquivo ("priorizando IndexedDB") é
falso. Não há IDB no sistema.

### 1.10 A rota `/leitor?file=` (ver §6)

Nona representação: o valor `encodeURIComponent('/' + pdfRelPath)` no query
param, que é uma URL pública e compartilhável.

---

## 2. As duas normalizações

### 2.1 `normalizePdfUrl` — `src/lib/utils/pathUtils.js:161-207`

```
1. remove protocolo+domínio          :166
2. remove barras inicial/final       :169
3. decodeUrlUtf8Multiple(…, 3)       :172-178
4. normalizeAccents  (mapa fixo)     :182
5. toLowerCase()                     :185
6. \ → /                             :188
7. garante prefixo assets/           :191-193
```

`normalizeAccents` (`:121-142`) é um **mapa literal** de 56 caracteres
pré-compostos. Não usa `normalize('NFD')`.

### 2.2 `normalizeForStorage` — `src/lib/offline/utils/PdfPathManager.js:23-65`

Os mesmos passos 1, 2, 3, 6, 7 — **sem** os passos 4 (acento) e 5 (minúsculas).
A checagem do prefixo é `toLowerCase()` mas o valor devolvido preserva a caixa
original (`:49-52`).

### 2.3 Tabela de divergência (**executada** com os módulos reais)

Origem = `https://plpcg.com`. Casos 1-4 são entradas reais do
`louvores-manifest.json`; 5-14 são adversariais.

| # | caso | entrada | `normalizePdfUrl` | `normalizeForStorage` | iguais? |
|---|------|---------|-----------------|---------------------|---------|
| 1 | acento + cedilha (real) | `assets/04112025/Conheçamos e prossigamos/Cifra.pdf` | `assets/04112025/conhecamos e prossigamos/cifra.pdf` | `assets/04112025/Conheçamos e prossigamos/Cifra.pdf` | **NÃO** |
| 2 | parênteses + acento (real) | `assets/04112025/Jesus Voltará (vou me preparar)/Cifra.pdf` | `assets/04112025/jesus voltara (vou me preparar)/cifra.pdf` | `assets/04112025/Jesus Voltará (vou me preparar)/Cifra.pdf` | **NÃO** |
| 3 | número com zero à esquerda (real) | `assets/ColCIAs/001.pdf` | `assets/colcias/001.pdf` | `assets/ColCIAs/001.pdf` | **NÃO** |
| 4 | nome muito longo + hífen (real) | `assets/Louvores Coletânea de Partituras/255 - Meu Coração Engrandece ao Senhor - Cântico de Vitória/Cifra I.pdf` | `assets/louvores coletanea de partituras/255 - meu coracao engrandece ao senhor - cantico de vitoria/cifra i.pdf` | (idêntico à entrada) | **NÃO** |
| 5 | URL absoluta + `%20` + `%C3%AD` | `https://plpcg.com/assets/ColCIAs/Cifra%20n%C3%ADvel%20I.pdf` | `assets/colcias/cifra nivel i.pdf` | `assets/ColCIAs/Cifra nível I.pdf` | **NÃO** |
| 6 | `+` em vez de espaço | `assets/ColCIAs/Cifra+nivel+I.pdf` | `assets/colcias/cifra+nivel+i.pdf` | `assets/ColCIAs/Cifra+nivel+I.pdf` | **NÃO** |
| 7 | travessão U+2013 | `assets/Coletânea/255 – Meu Coração/Cifra.pdf` | `assets/coletanea/255 – meu coracao/cifra.pdf` | (idêntico à entrada) | **NÃO** |
| 8 | hífen ASCII (mesmo nome de #7) | `assets/Coletânea/255 - Meu Coração/Cifra.pdf` | `assets/coletanea/255 - meu coracao/cifra.pdf` | (idêntico à entrada) | **NÃO** |
| 9 | caixa alta em tudo | `ASSETS/ColCIAs/CIFRA.PDF` | `assets/colcias/cifra.pdf` | `ASSETS/ColCIAs/CIFRA.PDF` | **NÃO** |
| 10 | sem prefixo `assets/` | `04112025/Conheçamos e prossigamos/Cifra.pdf` | `assets/04112025/conhecamos e prossigamos/cifra.pdf` | `assets/04112025/Conheçamos e prossigamos/Cifra.pdf` | **NÃO** |
| 11 | barra invertida (Windows) | `assets\ColCIAs\Cifra nível I.pdf` | `assets/colcias/cifra nivel i.pdf` | `assets/ColCIAs/Cifra nível I.pdf` | **NÃO** |
| 12 | duplo-encode `%2520` | `assets/ColCIAs/Cifra%2520n%25C3%25ADvel%2520I.pdf` | `assets/colcias/cifra nivel i.pdf` | `assets/ColCIAs/Cifra nível I.pdf` | **NÃO** |
| 13 | base64 no nome do arquivo (real) | `assets/Avulsos Diversos/QWRpY2lvbmFkb3M…CGRm=.pdf` | `assets/avulsos diversos/qwrpy2lvbmfkb3m…zgy=.pdf` | (idêntico à entrada) | **NÃO** |
| 14 | espaço final no diretório | `assets/ColCIAs /Cifra.pdf` | `assets/colcias /cifra.pdf` | `assets/ColCIAs /Cifra.pdf` | **NÃO** |

Observações que a tabela revela:

- **Caso 13 é destrutivo.** `normalizePdfUrl` passa `toLowerCase()` num nome de
  arquivo que é ele próprio Base64 — e Base64 é sensível à caixa. A string
  minúscula não decodifica de volta. É uma entrada real do acervo.
- **Casos 7 e 8** divergem entre si em ambas as funções (o travessão sobrevive
  aos dois); só `normalizeR2Key` os colapsa. Isso significa que um travessão no
  R2 e um hífen no manifesto casam **no servidor** e não casam **no cliente**.
- **Casos 6 e 14** mostram que nenhuma das duas trata `+` nem espaço em borda.
- **Caso 12**: as duas colapsam corretamente o duplo-encode, graças ao mesmo
  `decodeUrlUtf8Multiple(…, 3)`.

### 2.4 O número que resume o achado #22

**Executado sobre os 4629 caminhos reais do acervo:**

```
caminhos reais em que as duas normalizações divergem:  4629 / 4629  (100 %)
```

Não é um caso de borda. **Todo caminho do acervo tem pelo menos uma maiúscula**,
logo as duas funções nunca coincidem em produção. Não são duas normalizações que
divergem "às vezes" — são dois espaços de nomes disjuntos.

E, ainda executado:

```
normalizeForStorage : 4629 chaves distintas, 0 colisões
normalizePdfUrl     : 4629 chaves distintas, 0 colisões
normalizeR2Key      : 4629 chaves distintas, 0 colisões
```

Nenhuma das três perde informação suficiente para colidir no acervo atual.
Isto é decisivo para o §4/§6: **unificar não cria ambiguidade de conteúdo**;
o risco é puramente de *chave já gravada*.

### 2.5 Bug executado: `normalizePdfUrl` não trata NFD

`normalizeAccents` usa um mapa de caracteres pré-compostos e não chama
`normalize()`. **[V] Executado:**

```
entrada NFD:  assets/05042026/A Obra do Senhor é Perfeita/Coro.pdf   ("e" + U+0301)
normalizePdfUrl (NFD) → assets/05042026/a obra do senhor é perfeita/coro.pdf   ← acento sobrevive
normalizePdfUrl (NFC) → assets/05042026/a obra do senhor e perfeita/coro.pdf
NFD === NFC ?  false
normalizeR2Key  NFD === NFC ?  true
```

São **8 caminhos reais** do acervo em NFD (`A Obra do Senhor é Perfeita`,
`Bênção Aarônica (Bênção Apostólica)`, `Tabernáculo`, …). Para esses,
`normalizePdfUrl` produz uma chave que não casa com a forma NFC equivalente. É
exatamente a classe de falha silenciosa que a correspondência difusa foi criada
para esconder.

### 2.6 Bug executado: `createSearchVariations` gera lixo

`PdfPathManager.js:128-138` monta cinco variações. A terceira é
`createUrlUtf8(encodeURI('/' + normalizedPath))` — `encodeURI` seguido de
`createUrlUtf8`, que chama `encodeURI` de novo. **[V] Executado:**

```
variações de 'assets/04112025/Conheçamos e prossigamos/Cifra.pdf':
 1  https://plpcg.com/assets/04112025/Conhe%C3%A7amos%20e%20prossigamos/Cifra.pdf
 2  https://plpcg.com/assets/04112025/Conhe%25C3%25A7amos%2520e%2520prossigamos/Cifra.pdf   ← duplo-encode inútil
 3  /assets/04112025/Conheçamos e prossigamos/Cifra.pdf
 4  assets/04112025/Conheçamos e prossigamos/Cifra.pdf
```

(As variações 1 e 2 da lista original são idênticas e o `Set` de `:141` colapsa
uma delas; sobram quatro, e uma é `%2520`.) Cada variação inútil é uma
`cache.match` por PDF, no caminho crítico do leitor.

### 2.7 A terceira normalização, e a quarta

Além das duas do achado, existem:

- `normalizeR2Key` (`src/lib/server/r2KeyMatch.js:19`) — servidor, §1.5.
- `normalizeZipEntryName` (`src/lib/stores/offline.js:535`) — cópia de
  `normalizeForStorage` com barra inicial.
- `toComparablePath` (`src/lib/utils/pdfCacheIndex.js:20-39`) — pathname sem
  barra inicial e sem percent-encoding, **sem** tocar em caixa nem acento.
- `UrlNormalizer.normalizeForCache` (`src/lib/offline/normalization/UrlNormalizer.js:78-102`)
  — `normalizePdfUrl` + `new URL(...).pathname`, o que **reintroduz a barra
  inicial** que `normalizePdfUrl` acabou de tirar. Uma sexta forma.

### 2.8 Testes: o que documenta intenção e o que nunca roda

**[V]** `package.json:"test"` lista 13 arquivos, todos `node --test`. **Não
inclui**:

- `src/lib/offline/utils/PdfPathManager.test.js` — usa `describe/test/expect`
  (Jest). Não há `jest` nem `vitest` em `devDependencies`. **Nunca executa.**
- `src/lib/offline/normalization/UrlNormalizer.test.js` — funções exportadas
  para rodar à mão no console do browser. **Nunca executa.**
- `src/lib/offline/validation/PdfValidator.test.js` — `import {…} from 'vitest'`.
  **Nunca executa.**

Ou seja: o comportamento de *ambas* as normalizações do achado #22 está
documentado apenas por testes mortos. O único teste de normalização que roita
de verdade é `src/lib/server/r2KeyMatch.test.js`, e ele testa a terceira
normalização.

`UrlNormalizer.test.js:21-47` documenta a intenção original explicitamente:
`assets/ColAdultos/001.pdf` → `assets/coladultos/001.pdf`. Já
`PdfPathManager.test.js:10-20` documenta a intenção oposta:
"preserves case and accents". As duas intenções estão escritas, ambas em
arquivos que nenhum runner abre.

**Bug latente encontrado de passagem [V]:**
`src/lib/offline/validation/NetworkValidator.js:43` referencia `urlNormalizer`,
que **não é importado** naquele arquivo (imports em `:6-8`). O ramo é o de
"network check skipped (offline)" — ou seja, dispara um `ReferenceError`
exatamente no modo offline. Está mascarado pelo `try/catch` do
`CompositeValidator.js:124-127`... **não**: a linha 43 está *antes* do `try` do
`NetworkValidator` (`:49`), mas dentro do `try` do chamador, então o erro é
engolido e a validação de rede simplesmente some. **[I]** quanto ao efeito
observável.

---

## 3. A correspondência difusa

**Quatorze** estratégias distintas. Doze no cliente, duas no servidor.

| # | onde | arquivo:linha | o que faz | para que existe | se unificarmos e removermos |
|---|---|---|---|---|---|
| F1 | `PdfPathManager.createSearchVariations` | `PdfPathManager.js:107-142` | 4 variações de URL (encoded, duplo-encoded, `/path`, `path`) | absorver a diferença `encodeURI` vs `new URL` (§1.3) e chaves gravadas por escritores diferentes | **Não pode ser removida sem antes corrigir §1.3.** Hoje é o único mecanismo que serve os 3 PDFs com `[...]` no nome |
| F2 | SW `handlePdf` usa F1 | `service-worker.js:206-214` | idem, no fetch handler | idem | idem |
| F3 | `CacheStorageAdapter.getPdf` usa F1 | `CacheStorageAdapter.js:199-218` | idem, na leitura via adapter | idem | idem |
| F4 | `CacheStorageAdapter.getPdf` fallback extra | `CacheStorageAdapter.js:221-246` | 3 tentativas mais, **incluindo o basename nu** (`:226`) | último recurso histórico | **Remover já.** `new Request('Cifra.pdf')` resolve contra a página atual, não contra `/assets/…`; e com 1036 `Cifra I.pdf` no acervo, um acerto seria o PDF errado |
| F5 | `CacheStorageAdapter.deletePdf` usa F1 | `CacheStorageAdapter.js:487-500` | apaga todas as variações | garantir que o delete pega a entrada real | pode virar um `cache.delete` único |
| F6 | `buildPdfCacheIndex` — fallback por basename | `pdfCacheIndex.js:81-87` | se o caminho não bate, aceita o **nome do arquivo** | substituir a antiga "Estratégia 3" `some(endsWith)` com O(1) | **Falso positivo em massa.** 3311 dos 4629 caminhos partilham basename. Usado por `pdfIndex.js:73` e `findMissingPdfs` (`pdfValidation.js:290`) — hoje o índice de disponibilidade diz "tem" para qualquer louvor cujo `Cifra I.pdf` homônimo esteja em cache. `offline.js:703-712` já documenta que evita este índice de propósito |
| F7 | `pdfIndex` normaliza com a função minúscula | `pdfIndex.js:51-53` | aplica `urlNormalizer.normalizePdfUrl` aos dois lados | tornar o índice insensível a caixa/acento | consistente internamente; ao unificar, ambos os lados mudam juntos — sem quebra |
| F8 | `offline.js verifyPdfInCacheStorage` | `stores/offline.js:1219-1242` | 6 variações de URL | mesma razão de F1, reimplementada | remover junto com F1 |
| F9 | `offline.js isCategoryCompletelyDownloaded` — Estratégia 2 | `stores/offline.js:1334-1354` | `cached.endsWith(pdfPath)` **+** basename igual **+** `cachedDir.includes(expectedDir)` | decidir se uma categoria está completa | falso positivo garantido pelo basename; já há `strictMode` forçado para `Gestos em Gravura` (`:1284-1286`) porque isto errava |
| F10 | `offline.js` filtro de novos PDFs | `stores/offline.js:1495` | `cached.includes(pdfUrl)` — substring | achar PDFs não baixados | substring numa lista de milhares; qualquer prefixo comum casa |
| F11 | leitor: variações no `catch` | `routes/leitor/+page.svelte:371-403` | 6 URLs, tenta `getDocument` em cada | recuperar de falha de carga | cada tentativa é um `getDocument` completo; com a chave unificada, uma só basta |
| F12 | `PackageDownloader.extractPdfsFromZip` | `download/PackageDownloader.js:191-204` | 6 formas de `expectedSet` + `endsWith` nas duas direções (`:202-203`) | casar entrada de ZIP com o esperado | com uma normalização única, vira `set.has(normalize(entryName))` |
| F13 | R2: laço de `decodeURIComponent` | `hooks.server.js:60-75`, `worker/index.js:66-80` | desencapa até 5 vezes | codificação dupla/tripla vinda do cliente | mantém-se enquanto houver clientes antigos; barato (só em miss) |
| F14 | R2: `findExactKeyMatch` + `LIST` | `hooks.server.js:79-97`, `worker/index.js:84-102`, `r2KeyMatch.js:36-44` | lista o prefixo e compara por `normalizeR2Key` | acerto quando a chave real difere só em acento/caixa/pontuação | **Manter.** É a única defesa contra o acervo real ter chaves em NFD/NFC diferentes do manifesto. Custa um `LIST` só no miss |

Fora da linha do PDF, mas do mesmo padrão: `AppPagesCache.js:166-188`
(três tentativas de `cache.match` para a mesma página) e a heurística de acento
com strings fixas `'cifra'`/`'nivel'` em `CacheMigrationV2.js:170-172`.

**A conclusão de §3:** de catorze estratégias, **quatro** (F4, F6, F9, F10)
podem devolver o PDF errado ou um falso positivo, e existem apenas porque a
comparação exata falha. Duas (F13, F14) são defesas de servidor legítimas. As
outras oito são compensação direta da divergência de chave — e desaparecem com
a unificação, desde que §1.3 seja corrigido primeiro.

---

## 4. Superfícies que sobrevivem ao refactor — a pergunta central

### 4.1 O inventário do que está gravado no aparelho

| superfície | indexada por | sobrevive a deploy? | quebra com unificação? |
|---|---|---|---|
| `plpc-pdfs` (Cache Storage) | **URL absoluta percent-encoded, caixa+acento preservados** | **sim** (`swCaches.js:44-48`) | **SIM — total, se a normalização minúscula vencer** |
| `plpc-pdfs-import-staging` | mesma convenção | sim (protegido) | irrelevante: apagado no início (`OfflineBundleImporter.js:186,227`) e no fim (`:436`) de cada importação |
| `plpc-catalog` | `/louvores-manifest.json`, `/offline-manifest.json` | **sim** | **não** — não são caminhos de PDF |
| `plpc-<version>-app` | assets do deploy | não (podado no `activate`) | não |
| `pdfAvailabilityIndex` | pdfId | sim | não; e expira em 24 h |
| `pdfValidationCache_v1` | pdfId (valor = URL) | sim | valor obsoleto por ≤24 h; a URL só é usada para *baixar de novo*, não para ler do cache |
| `cachedPdfsList` / `cachedPdfsListLocal` | — | sim / 5 min | reconstruído a cada `reloadCache` |
| `offlineStatsCache_v2` | categoria | sim | não |
| partes concluídas (`partsStorage`) | categoria + filename | sim | não |
| IndexedDB | — | **não existe** (§1.9) | — |

### 4.2 A resposta

**Sim, e é catastrófico — mas só numa das duas direções.**

**Se a normalização minúscula/sem-acento (`normalizePdfUrl`) vencer:**
todo PDF já baixado deixa de ser encontrado. Não parte dele: **100 %**. A prova
é o número executado de §2.4 — os 4629 caminhos do acervo têm todos alguma
maiúscula, logo a chave que o app passaria a procurar
(`…/assets/04112025/conhecamos e prossigamos/cifra.pdf`) nunca é a chave que
está gravada (`…/assets/04112025/Conhe%C3%A7amos%20e%20prossigamos/Cifra.pdf`).
`cache.match` é comparação exata de URL; não existe modo case-insensitive.

E os três caminhos de leitura falhariam juntos:
`cache.match(event.request)` (`service-worker.js:203`), as variações
(`:206`), e o `CacheStorageAdapter.getPdf` (`:199`). Online, o
`fetch(event.request)` (`:217`) ainda salvaria a situação — o R2 tem F14, que é
insensível a caixa e acento. **Offline, o usuário vê "PDF não está disponível
offline. Por favor, baixe primeiro" para todo o acervo que ele baixou.** É
exatamente a falha silenciosa que o dono descreveu.

**Se a normalização que preserva caixa e acento (`normalizeForStorage`) vencer:**
**nada gravado quebra.** É já a convenção de todos os quatro escritores do cache
(§1.4) e de todos os validadores. `normalizePdfUrl` sobrevive em produção em
apenas **dois** lugares:

- `src/lib/utils/pdfIndex.js:52` — aplicado aos **dois lados** da comparação
  (`buildPdfCacheIndex` normaliza a lista em cache *e* o candidato), portanto
  trocar a função é internamente consistente e não invalida nada gravado; o
  índice é `{pdfId → bool}` com TTL de 24 h.
- `src/lib/offline/storage/CacheRepository.js:118` (via
  `urlNormalizer.normalizeForCache`) — chamado só por `_normalizePath`, que só é
  chamado por `LocalStorageAdapter` (`:51,81,105`), que **não é importado por
  ninguém** (grep verificado). Código morto.

Mais `NetworkValidator.js:43`, que é o bug de §2.8.

### 4.3 É preciso migração? De que tipo?

**Se vencer `normalizeForStorage`: nenhuma migração de dados.** Só é preciso:

1. Bump de `INDEX_VERSION` em `pdfIndex.js:10` (de `1` para `2`), para que o
   índice antigo — construído com a normalização minúscula e contaminado pelo
   falso positivo de basename (F6) — seja descartado em vez de expirar em 24 h.
   `loadPdfIndex:148-152` já faz isso sozinho ao ver versão diferente.
2. Bump de `VALIDATION_CACHE_KEY` (`validationCacheStore.js:11`) de `_v1` para
   `_v2`, **opcional**: as entradas guardam uma URL que só serve para
   re-download, e expiram em 24 h de qualquer forma.
3. **Não** rodar nenhum `CacheMigrationV2` novo. Ao contrário: a `CacheMigrationV2`
   existente deveria ser aposentada. Ela reescreve entradas com base numa
   heurística de string (`:170-172`: `storedPath.includes('cifra') && includes('nivel')`)
   e **apaga a entrada antiga** (`:202-208`). Enquanto a normalização for
   idempotente sobre o que já está gravado — e é, porque `normalizeForStorage`
   aplicado à própria saída devolve a mesma string — ela não tem trabalho a
   fazer; mas a flag `cache_migration_v2_completed` já está `true` na maioria
   dos aparelhos, então na prática ela já não roda. **[I]** quanto à proporção
   de aparelhos.

**Se vencer `normalizePdfUrl`: migração obrigatória, offline-safe, e cara.**
Seria preciso, no `activate` do SW ou no `OfflineManager.initialize`, varrer
`plpc-pdfs`, e para cada entrada fazer `put(chaveNova, response)` +
`delete(chaveAntiga)` — sem rede, porque o usuário pode estar offline, e sem
poder falhar pela metade (uma queda no meio deixa metade do acervo inacessível
por *duas* chaves). Com centenas de MB e milhares de entradas, num Cache Storage
de browser móvel, isso é a operação de maior risco possível. **Não faça isso.**

### 4.4 A superfície esquecida

Um ponto que não é de dados mas quebra igual: `service-worker.js:440-444`
grava com a URL crua que o **cliente** mandou. Durante o intervalo entre o
deploy do SW novo e o `skipWaiting` efetivo, uma página antiga pode mandar
URLs no formato antigo para um SW novo, ou vice-versa. **[I]** — o
`skipWaiting()` em `:120` e o `clients.claim()` em `:149` reduzem a janela, mas
não a fecham para abas já abertas com o JS antigo carregado.

---

## 5. Consumidores fora deste repositório

### 5.1 O que existe

**[V]** `worker/wrangler.toml:12-17` declara explicitamente:

> "O Worker continua necessário porque **v2.plpcg.com e 120826.plpcg.com** servem
> `/assets/**.pdf` e **NÃO têm binding de R2** — só funcionam através dele.
> Enquanto esses dois existirem, a regra de correspondência de chave tem de valer
> nos dois caminhos: por isso ela é importada de `src/lib/server/`, e não copiada."

A rota do Worker é `*.plpcg.com/*` (só subdomínios); o apex voltou ao Pages.

### 5.2 O acoplamento exato

**[V]** Há **um único** símbolo importado de `src/lib/server/` para fora deste
app:

```js
// worker/index.js:12
import { findExactKeyMatch } from '../src/lib/server/r2KeyMatch.js';
```

E o mesmo símbolo, do mesmo arquivo, em `src/hooks.server.js:2`. O contrato é
`findExactKeyMatch(candidates: string[], expected: string): string | null`,
apoiado em `normalizeR2Key`.

O repo `plpcg-admin` (privado, referido em `wrangler.toml:22` e na memória do
projeto) publica o manifesto e o checksum no R2, mas **não** aparece como
consumidor de lógica de caminho neste repositório.

### 5.3 O que quebra lá fora

**Se a normalização do cliente mudar e `normalizeR2Key` não mudar: nada quebra.**
O Worker nunca vê a normalização do cliente — vê só um `pathname` HTTP. Ele
decodifica (F13) e, no miss, normaliza os **candidatos do próprio bucket** (F14).
Cliente e servidor estão desacoplados por HTTP.

**A condição a respeitar:** o cliente precisa continuar pedindo uma URL cujo
`decodeURIComponent(pathname.substring(1))` seja a chave real do R2, ou pelo
menos `normalizeR2Key`-equivalente a ela. A normalização que preserva caixa e
acento satisfaz isso trivialmente. A minúscula **também** satisfaria — mas só
via F14, ou seja, pagando um `bucket.list({prefix})` em **todo** pedido de PDF,
para todos os 4629 arquivos, para sempre. Um `LIST` por PDF, num Worker, é uma
regressão de latência e de custo que se acumula no domínio inteiro.

**Se `normalizeR2Key` for tocado, o Worker precisa de deploy próprio.**
`worker/index.js` importa de `src/lib/server/` por caminho relativo, então uma
mudança em `r2KeyMatch.js` afeta os dois — mas o Pages e o Worker são **dois
deploys distintos** (`wrangler.toml` vs `worker/wrangler.toml`). Publicar só o
Pages deixa `v2.plpcg.com` e `120826.plpcg.com` com a regra antiga. **[V]** pela
existência de dois `wrangler.toml` com `name` diferentes.

**Recomendação:** **não tocar em `normalizeR2Key`.** Ela tem o único teste de
normalização que roda de verdade (`r2KeyMatch.test.js`, 8 casos, incluindo o
caso de regressão do achado #09 em `:43-47`), trata NFD corretamente, e serve
dois deploys. É a peça saudável do sistema.

---

## 6. A rota `/leitor`

### 6.1 Como recebe o PDF

**[V]** Exclusivamente por **query param**. Não há store envolvido na escolha
do PDF.

```svelte
// src/routes/leitor/+page.svelte:100-104
$: searchParams  = new URLSearchParams($page.url.search);
$: file          = searchParams.get('file') ?? '/pdfs/exemplo.pdf';
$: titulo        = searchParams.get('titulo') ?? '';
$: subtitulo     = searchParams.get('subtitulo') ?? '';
$: skipValidation = searchParams.get('validated') === 'true';
```

`src/routes/leitor/+page.js` só desliga SSR/prerender (`ssr = false`,
`prerender = false`, `csr = true`). Não há `load`.

O store `carousel` (`:8`) é importado, mas só para a **barra de navegação entre
louvores** (`:1928`) e para sincronizar entre abas (`:591-600`); a troca de PDF
pelo carrossel é feita por `goto()` com uma nova URL (`:1231-1240`), não por
estado. Ou seja: **a URL é a única fonte de verdade do PDF aberto.**

### 6.2 O formato exato

Montado em cinco lugares idênticos — `navigateLouvorToLeitor.js:35-39,85-90,96-100`,
`LouvorCard.svelte:133,189,199`, `CarouselChips.svelte:350`,
`leitor/+page.svelte:1236-1240`:

```js
const fileParam      = encodeURIComponent(`/${pdfPath}`);   // pdfPath = getPdfRelPath(louvor)
const tituloParam    = encodeURIComponent(louvor.nome || '');
const subtituloText  = `${louvor.categoria || ''} | ${louvor.classificacao || ''}`.trim();
const subtituloParam = encodeURIComponent(subtituloText);
`/leitor?file=${fileParam}&titulo=${tituloParam}&subtitulo=${subtituloParam}&validated=true`
```

Um exemplo real, hard-coded em `src/routes/offline/+page.svelte:1117`:

```
/leitor?file=%2Fassets%2FColCIAs%2F001.pdf&titulo=Meu%20Deus%2C%20meu%20pai&subtitulo=Partitura%20%7C%20Coletânea%20CIAs&validated=true
```

### 6.3 É compartilhável? **Sim.**

**[V]** Nada na rota depende de estado de sessão:

- `+page.js` não tem `load`; `+page.svelte` lê tudo de `$page.url.search`.
- Uma navegação direta (colar a URL) entra pela rota `navigation` do SW
  (`swRouter.js:25`), que cai no shell `/` pré-cacheado
  (`service-worker.js:256`) e o SvelteKit roteia no cliente.
- `load(fileUrl)` (`:251`) reconstrói o `pdfPath` a partir do param
  (`:262-264`) e valida do zero.

Logo, **o formato do `?file=` faz parte do contrato de compatibilidade** — e
não só com o cache do usuário: com links já enviados por WhatsApp, favoritos,
e a atalho hard-coded de `offline/+page.svelte:1117`.

### 6.4 O que o `?file=` obriga

O valor é `encodeURIComponent('/' + getPdfRelPath(louvor))` — **caixa e acento
exatos do `pdfId`**. Duas consequências:

1. Se a normalização unificada passar a ser a minúscula, **todo link
   compartilhado existente deixa de casar com a nova chave de cache**. Online
   ainda funciona (F14 no R2); offline, não. Uma URL antiga tem de continuar
   resolvendo — e a única forma barata de garantir isso é manter o
   `?file=` no formato que preserva caixa e acento.
2. `searchParams.get('file')` devolve o valor **já decodificado**. Aí
   `new URL(decoded, origin)` (`:262`) re-codifica pelo parser WHATWG, o que
   reintroduz a divergência dos colchetes de §1.3. **[V] Executado:** a URL
   derivada do `?file=` difere da chave gravada nos mesmos 3 caminhos
   (`Sobe aqui [26-07-2025] - Coro.pdf` e os dois `[dd mm aaaa]` de `assets/PES/`).

**Recomendação para o contrato:** congelar `?file=` como está
(`encodeURIComponent('/' + caminho com caixa e acento originais)`), e resolver
§1.3 escolhendo **um** codificador — o do parser `URL`, não `encodeURI` — para
gerar a chave de cache. Isso alinha o `?file=`, o pedido do leitor e a chave
gravada numa só string, e é a mudança que permite apagar F1/F2/F3/F8/F11 com
segurança.

---

## Apêndice — recomendação

**`normalizeForStorage` (preserva caixa e acento) deve vencer.** Cinco razões,
todas verificadas:

1. É a única que **não invalida dados já no aparelho**. A outra invalida 100 %
   (§2.4, §4.2).
2. É a chave real do R2. Preservar caixa e acento mantém o *fast path* do
   bucket (`bucket.get` direto) e reserva o `LIST` de F14 para o miss genuíno
   (§5.3).
3. É a que já ganhou de facto: os quatro escritores do cache, todos os
   validadores, o importador de bundle e o extrator de ZIP já a usam. A
   minúscula sobrevive em **dois** call-sites, um deles morto (§4.2).
4. É a que o `?file=` já carrega, em links que existem no mundo (§6.4).
5. Não perde informação: 0 colisões nos 4629 caminhos reais (§2.4).

**Mas ela precisa de duas correções antes de virar a única:**

- **Adotar `.normalize('NFC')`** no início. `normalizePdfUrl` erra os 8
  caminhos NFD (§2.5); `normalizeForStorage` não erra, mas também não os
  *unifica* — dois caminhos byte-diferentes que o usuário vê iguais continuam
  sendo duas chaves. Uma linha resolve, e alinha o cliente com `normalizeR2Key`,
  que já faz NFD.
- **Escolher um codificador de URL.** `createUrlUtf8`/`encodeURI` e o parser
  `URL` divergem em `[` e `]`, em 3 arquivos reais (§1.3). Enquanto os dois
  coexistirem, F1 não pode ser removida.

**Ordem sugerida do trabalho** (cada passo é reversível e observável sozinho):

1. Corrigir §1.3 — um codificador só. Depois disso, medir quantas vezes as
   variações de F1 ainda acertam; a expectativa é zero.
2. Adicionar `NFC` a `normalizeForStorage`. Rodar um `node --test` novo com o
   `louvores-manifest.json` real como fixture.
3. Trocar `pdfIndex.js:52` para `normalizeForStorage` e bumpar
   `INDEX_VERSION` para `2`. Remover **F6** (o fallback por basename de
   `pdfCacheIndex.js:81-87`) — é o falso positivo de maior alcance (3311
   caminhos) e não protege nada que a chave exata não proteja.
4. Remover **F4** (`CacheStorageAdapter.js:221-246`) — é o único lugar que pode
   devolver o PDF *errado*.
5. Só então remover F1/F2/F3/F5/F8/F9/F10/F11/F12 e apagar
   `normalizePdfUrl`, `normalizeAccents`, `UrlNormalizer`, `NormalizationCache`,
   `LocalStorageAdapter` (morto), `CacheRepository._normalizePath`,
   `CacheMigrationV2` e `normalizeZipEntryName`.
6. **Não tocar** em `r2KeyMatch.js` nem no `worker/`.
