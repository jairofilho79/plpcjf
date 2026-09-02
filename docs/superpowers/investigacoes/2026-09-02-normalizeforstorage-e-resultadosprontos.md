# Investigação — duas pendências menores

Investigação só-leitura. Nenhum arquivo do repositório foi alterado; os
`node -e`/scripts usados para confirmar comportamento em runtime viveram só
no scratchpad e importaram o módulo real por caminho relativo (não o
modificaram).

---

# Item 1 — `normalizeForStorage` não é idempotente

Arquivo sob exame: `src/lib/offline/utils/PdfPathManager.js` (método estático
`normalizeForStorage`, linhas 26-74). Tratado como área de alto risco: uma
gravação de chave errada nesta função apaga PDFs baixados do usuário em
silêncio. Nada foi alterado nela nem em nada que ela toca.

## 1.1 — A não-idempotência exata, com strings reais

Confirmado rodando o módulo real via `node` (não vitest/jest — o módulo já é
ESM puro, sem `$lib`, exatamente para isso).

Input adversarial: um caminho cru cujo nome de arquivo contém um `%` literal
encapsulado em **percent-encoding aninhado** (3+ camadas de
`encodeURIComponent` em cima do caractere `%`):

```
x  = "assets/a%252525b.pdf"        // 3 camadas de encoding em torno de um "%"
F(x)  = normalizeForStorage(x)     = "assets/a%25b.pdf"
F(F(x)) = normalizeForStorage(F(x)) = "assets/a\x0Bpdf"   // note: sumiu o "." antes de "pdf"
```

`F(x) !== F(F(x))` — a definição exata de não-idempotência pedida. Com 4
camadas (`"assets/a%25252525b.pdf"`) o mesmo padrão se repete: `F(x) =
"assets/a%25b.pdf"`, `F(F(x)) = "assets/a\x0Bpdf"`, e a partir daí sim
estabiliza (`F(F(F(x))) === F(F(x))`).

**Mecanismo, linha a linha:**
- `normalizeForStorage` (PdfPathManager.js:41-46) só decodifica se
  `normalized.includes('%')`, delegando para
  `decodeUrlUtf8Multiple(normalized, 3)` (`src/lib/utils/urlEncoding.js:294-314`),
  que decodifica no máximo 3 iterações e para mesmo se ainda sobrar um `%`
  não resolvido — é exatamente esse resíduo (`"a%25b.pdf"`) que sobrevive à
  primeira chamada.
- Na segunda chamada, esse `%25` residual decodifica para um `%` literal em
  `decodeUrlComponentUtf8` (urlEncoding.js:83-113); a iteração seguinte tenta
  decodificar esse `%` sozinho — `decodeURIComponent("assets/a%b.pdf")` lança
  `URIError: URI malformed` (`%b.` não é um par hex válido) — e cai no
  fallback manual (urlEncoding.js:99-111), que faz
  `parseInt(encoded.substring(i+1, i+3), 16)`. Para `"b."`, `parseInt` para no
  primeiro caractere inválido e devolve `11` (`0x0B`), mas o `i += 2` já
  consumiu os dois caracteres — inclusive o `.` que não fazia parte de
  escape nenhum. Resultado: um byte de controle no lugar de `%b.` **e o `.`
  desaparece**, colando `"a"` com `"pdf"` sem separador.

O script exato usado para gerar isso está reproduzido no fim deste item, sob
"Scripts de verificação", para quem quiser rodar de novo.

**Causa raiz, não só sintoma:** a função assume que qualquer `%` que
encontrar é o início de um escape de URL válido. Isso é falso sempre que o
conteúdo tiver um `%` literal — seja de uma única camada (um nome de arquivo
com `%` de verdade) ou de várias (o caso aninhado). A não-idempotência é uma
consequência dessa suposição, não um bug isolado nela.

## 1.2 — Todos os chamadores, e se algum pode receber valor já normalizado

Levantamento completo (fora de arquivos `*.test.js` e da própria definição):

| Local | O que recebe | Já normalizado antes? |
|---|---|---|
| `src/service-worker.js:219` | `url.pathname` (Request de fetch real) | Não diretamente — mas `url.pathname` é o resultado de `encodeURI` sobre um `normalizeForStorage` anterior (via `createRequestUrl`), ou seja, já passou por uma decodificação/recodificação. Uma única camada é segura hoje (ver 1.3); nunca duas. |
| `src/service-worker.js:556`, `:563` | `pdfPath` cru (postMessage) e `url.pathname` de chaves do cache | Idem — single-shot cada um. |
| `src/lib/utils/pdfIndex.js:56` | `path` vindo de `getCachedPDFsFast()` (URLs do cache, single-encoded) | Não. |
| `src/lib/utils/pdfValidation.js:121,171,286` | `pdfPath` cru do catálogo (`getPdfRelPath(louvor)`) | Não. |
| `src/lib/offline/validation/CompositeValidator.js:63` | `pdfPath` cru, repassado como cru para os sub-validadores (`indexValidator.validate(pdfPath, ...)`) | Não. |
| `src/lib/offline/validation/CacheValidator.js:50` | `pdfPath` cru | Não neste ponto — **mas** `:77` (não citado no grep porque a linha exata é a chamada de `createRequestUrl`) chama `PdfPathManager.createRequestUrl(normalizedPath, ...)` — **aqui sim**: `normalizedPath` já é `F(pdfPath)`, e `createRequestUrl` roda `F` de novo por dentro (PdfPathManager.js:107). **Aplicação dupla confirmada, em todo `validatePdfAvailability`.** |
| `src/lib/offline/validation/IndexValidator.js`, `NetworkValidator.js` | `pdfPath` cru (recebido do Composite, não do `normalizedPath` de ninguém) | Não. |
| `src/lib/offline/storage/CacheStorageAdapter.js` `getPdf` (:153) | `pdfPath` cru | Não — usa `pdfPath` original tanto para `normalizedPath` (bookkeeping) quanto para `createRequestUrl(pdfPath, ...)` (:191). Sem duplicação. |
| `CacheStorageAdapter.js` `deletePdf` (:266) | `pdfPath` cru | Idem, sem duplicação (usa `pdfPath` original para `createRequestUrl`). |
| `CacheStorageAdapter.js` `_putPdfInternal` (:457, mais precisamente a normalização em :266 do grep é de outro método — a de `_putPdfInternal` fica perto de "PDF stored in cache") | `pdfPath` recebido pelo método | Depende de quem chama — ver próxima linha. |
| `CacheStorageAdapter.js` `listPdfs` (:523) | `path = decodeUrlUtf8(urlObj.pathname)` — **já decodificado uma vez** antes de `normalizeForStorage(path)` | **Sim, decodificação dupla by design** — mesmo padrão de risco da migração NFC (ver 1.3). Hoje inofensivo (sem `%` real), mas é o segundo lugar no código-fonte (além da migração) que decodifica antes de entregar para uma função que decodifica de novo. |
| `src/lib/offline/download/PackageDownloader.js:166,263,360,406` | `pdf`/`originalPath`/`entryName` crus (nomes de entrada de ZIP, caminhos do catálogo) | Não diretamente aqui — **mas** `storePdfsInCache` (por volta de :263) chama `cacheStorageAdapter.putPdf(normalizedPath, pdf.blob)` **com o `normalizedPath` já calculado**, e `putPdf` → `_putPdfInternal` roda `normalizeForStorage(pdfPath)` de novo (bookkeeping) **e** `createRequestUrl(pdfPath, ...)` de novo — `createRequestUrl` aplica `F` uma segunda vez sobre o `pdfPath` recebido, que já é `F(originalPath)`. **Aplicação dupla confirmada na chave real de gravação de todo download em pacote.** |
| `src/lib/offline/import/OfflineBundleImporter.js:216` | `path = PdfPathManager.normalizeForStorage(entryName)`, repassado para `stagingAdapter._putPdfInternal(path, ...)` | **Sim.** Mesmo mecanismo do item acima: `_putPdfInternal` roda `normalizeForStorage` e `createRequestUrl` de novo sobre um `path` que já é `F(entryName)`. **Aplicação dupla confirmada na chave real de gravação de toda importação de bundle ZIP.** |
| `src/lib/stores/offline.js:668` (`readCachedPdfPaths`) | `toComparablePath(request.url)` — URL do cache, single-encoded | Não. |
| `src/lib/stores/offline.js:690` (`getPdfRelPathNormalizado`) | `relPath` cru do catálogo | Não. |
| `src/lib/stores/offline.js:733-734/745` e `:1310-1311/1322` (`prepareForComparison`, `wantedIndex`) | `url`/`pdfUrls` crus do catálogo | Não. |
| `src/lib/stores/offline.js:906,909` e `:1503,1506` (dentro de `startZipDownloadWithSpecificParts`/`startZipDownload`) | `preparedPath = normalizeForStorage(name)` (nome de entrada de ZIP), depois `pathForComparison = prepareForComparison(preparedPath)` — **literalmente `normalizeForStorage(normalizeForStorage(name))`** | **Sim, explícito e incondicional.** Roda para **toda entrada de PDF de todo ZIP baixado**, hoje sem efeito observável porque `F` é um no-op sobre a própria saída quando não há `%` no acervo (confirmado por teste, ver 1.1/1.5). |
| Mesmo bloco, `:916`/`:1513` | `createRequestUrl(preparedPath, location.origin)` — a URL real usada em `cache.put(...)` | **Sim, segunda aplicação dupla no mesmo laço**: `createRequestUrl` roda `F` de novo sobre `preparedPath`, que já é `F(name)`. Esta é a chave efetivamente gravada no Cache Storage para todo PDF extraído de um ZIP de pacote offline. |
| `src/lib/offline/validation/IndexValidator.js:42,50,94`, `NetworkValidator.js:47,55,98` | `pdfPath` cru repassado pelo Composite | Não. |

**Conclusão do levantamento:** a suposição de que `normalizeForStorage` é
idempotente **não é uma hipótese remota** — o código já depende dela, sem
comentário dizendo isso, em pelo menos quatro pontos de escrita/validação
reais e correntes:
1. `CacheValidator.validate` → `createRequestUrl(normalizedPath, ...)`.
2. `PackageDownloader.storePdfsInCache` → `putPdf(normalizedPath, ...)` → `_putPdfInternal` → `createRequestUrl(pdfPath, ...)`.
3. `OfflineBundleImporter` (importação de bundle) → mesmo caminho via `_putPdfInternal`.
4. `offline.js` `startZipDownload(WithSpecificParts)` — dobrado: uma vez em `prepareForComparison(preparedPath)` e outra em `createRequestUrl(preparedPath, ...)`, para **cada PDF de cada pacote baixado**.

Hoje, com **zero** ocorrências de `%` nos 4629 caminhos do acervo (confirmado
lendo `louvores-manifest.json` e `offline-manifest.json` no repositório —
`grep -o '%' | wc -l` = 0 nos dois arquivos), toda essa dupla aplicação é um
no-op inofensivo. O gatilho é: o dia em que **qualquer um** desses quatro
pontos processar um caminho cujo nome de arquivo contenha um `%` — literal
(já seria ruim isoladamente, ver 1.3) ou, pior, aninhado (por vir de uma
ferramenta externa que já codificou o nome mais de uma vez — um gerador de
manifesto, um ZIP de terceiro, uma re-exportação). Como os pontos 2-4 correm
sobre **todo o acervo, em todo download/importação**, uma única entrada
futura com `%` no nome já dispara a dupla aplicação sem que ninguém precise
fazer nada de exótico.

## 1.3 — O caminho destrutivo (migração NFC)

Arquivos: `src/lib/offline/storage/pdfCacheNfcMigration.js` e
`src/lib/offline/core/OfflineManager.js` (`ensureNfcMigration`, linhas 91-118).

Mecanismo de `migrarChavesPdfParaNfc` (pdfCacheNfcMigration.js:29-67), para
cada chave `requisicao` do cache:
```js
urlNova = canonicalizar(urlAntiga);           // linha ~40
if (!urlNova || urlNova === urlAntiga) { mantidas++; continue; }
const resposta = await cache.match(requisicao);
await cache.put(urlNova, resposta.clone());   // grava a nova — linha ~53
...
await cache.delete(requisicao);               // APAGA A ORIGINAL — pdfCacheNfcMigration.js:61
```

`canonicalizar` real, injetado por `OfflineManager.ensureNfcMigration`
(OfflineManager.js:104-107):
```js
const r = await migrarChavesPdfParaNfc(cachePdfs, (url) => {
  const u = new URL(url);
  return PdfPathManager.createRequestUrl(decodeURIComponent(u.pathname), u.origin);
});
```

**Demonstração concreta, ponta a ponta, com o código real** (script no fim
deste item):

1. Caminho cru hipotético do catálogo com percent-encoding aninhado (3+
   camadas em torno de um `%`):
   `raw = "assets/a%252525b.pdf"`.
2. Uma gravação normal (ex.: `handlePdf` do service worker, ou qualquer um
   dos quatro pontos do item 1.2) grava a chave real via
   `createRequestUrl(raw, origin)`:
   `K_orig = "https://plpcg.com/assets/a%25b.pdf"`.
   Essa é a chave que **qualquer leitura futura** também calcula — confirmado:
   chamar `createRequestUrl(raw, origin)` de novo, do zero, dá **exatamente**
   `K_orig` de novo (`K_read_again === K_orig` → `true`). Ou seja: **sem a
   migração, este PDF nunca teria problema** — a chave é auto-consistente.
3. A migração roda depois e chama `canonicalizar(K_orig)`:
   `K_new = "https://plpcg.com/assets/a\x0Bpdf"` (o mesmo colapso do `.`
   descrito em 1.1, porque `canonicalizar` decodifica a pathname **uma vez**
   com `decodeURIComponent` e entrega para `createRequestUrl`, que decodifica
   **de novo** por dentro de `normalizeForStorage` — uma camada de decode a
   mais do que uma leitura fresca de `raw` jamais faria).
4. `K_new !== K_orig` → a migração grava `K_new` (`cache.put`) e **apaga
   `K_orig`** (`cache.delete`, pdfCacheNfcMigration.js:61).
5. Qualquer leitura futura — inclusive a leitura que rodaria no minuto
   seguinte, para o mesmo `raw` — continua calculando `K_orig`
   (`createRequestUrl(raw, origin)` de novo dá `K_orig`, não `K_new`;
   confirmado: `K_read_again === K_new` → `false`). O PDF passa a existir
   **só** sob `K_new`, uma chave que nada no app jamais volta a construir.

**Condição precisa de perda:** um caminho do acervo cujo nome de arquivo
contém percent-encoding aninhado (≥3 camadas em torno de um `%`) sobrevive
sem problema até a chave ser tocada pela migração NFC — que introduz uma
camada de decodificação a mais do que qualquer leitura normal, produz uma
chave diferente da que qualquer leitura recalcula, grava sob essa chave
errada e apaga a única chave que o app ainda sabe pedir. **Não depende de
`normalizeForStorage` rodar duas vezes no mesmo lugar** (os pontos do item
1.2 não bastam sozinhos, testado por fuzzing com um único nível de `%`: em
22 variações de sufixo depois de um `%` solto, `canonicalizar(createRequestUrl(raw))
=== createRequestUrl(raw)` em 100% dos casos — sem aninhamento, a migração
é inofensiva mesmo com `%` literal no nome). O aninhamento é a chave.

**Confirmado, e não apenas hipotético quanto ao acervo real:**
`grep -o '%' louvores-manifest.json | wc -l` e o mesmo para
`offline-manifest.json` deram **0** — os 4629 caminhos reais não contêm `%`
em lugar nenhum, aninhado ou não. **Nenhum caminho do catálogo atual pode
disparar isto hoje.** O risco é inteiramente prospectivo: um título de
louvor com `%` no nome (plausível em português — "100% Perto de Ti" não seria
estranho) já bastaria para uma camada de `%`; chegar a 3+ camadas aninhadas
exige que o `%` já tenha passado por alguma codificação externa antes de
entrar no `pdfId`/manifesto (uma ferramenta de geração de manifesto, uma
exportação de ZIP de terceiro, ou os próprios pontos de dupla aplicação do
item 1.2 comportos ao longo de múltiplas operações — baixar o pacote, depois
reimportar um bundle, depois rodar a migração — cada uma potencialmente
adicionando decodificação/recodificação sem que nenhuma sozinha pareça
suspeita).

### Scripts de verificação usados (não fazem parte do repositório)

```js
// probe2.mjs — não-idempotência
import PdfPathManager from ".../src/lib/offline/utils/PdfPathManager.js";
function levels(n){ let s="%"; for(let i=0;i<n;i++) s=encodeURIComponent(s); return s; }
const input = `assets/a${levels(4)}b.pdf`;
const n1 = PdfPathManager.normalizeForStorage(input);
const n2 = PdfPathManager.normalizeForStorage(n1);
// n1 = "assets/a%25b.pdf", n2 = "assets/a\x0Bpdf", n1 !== n2

// probe5.mjs — caminho destrutivo ponta a ponta
function canonicalizarReal(url) {
  const u = new URL(url);
  return PdfPathManager.createRequestUrl(decodeURIComponent(u.pathname), u.origin);
}
const raw = `assets/a${levels(3)}b.pdf`; // "assets/a%252525b.pdf"
const K_orig = PdfPathManager.createRequestUrl(raw, "https://plpcg.com");
const K_new  = canonicalizarReal(K_orig);
const K_read_again = PdfPathManager.createRequestUrl(raw, "https://plpcg.com");
// K_orig === K_read_again (true)  — a chave que qualquer leitura recalcula
// K_new  === K_read_again (false) — a chave que sobrevive à migração é outra
```

## 1.4 — O fix seguro, com o trade nomeado

Três famílias de opção, avaliadas explicitamente pelo critério "errar aqui
apaga dado do usuário":

**Opção A — Consertar `normalizeForStorage` na raiz** (não decodificar
especulativamente qualquer `%`; só tratar como escape uma sequência que
decodifica-e-recodifica de forma estável, ou separar de vez "decodificar
entrada vinda de URL de navegador" de "normalizar um caminho já cru").
- Custo: exatamente a função declarada off-limits/alto risco. Qualquer
  mudança aqui precisa provar, sobre os 4629 caminhos reais **e** sobre casos
  adversariais, que nenhuma chave já gravada muda de forma — senão o próprio
  fix apaga PDFs por descompasso de chave (o mesmo tipo de acidente que a
  migração NFC já documenta ter evitado com "grava a nova antes de apagar a
  velha"). É o fix *correto*, mas é trabalho de plano próprio, não algo para
  encaixar ao lado de uma investigação de pendências menores.

**Opção B — Detectar "já normalizado" e não reprocessar.**
- Não há como distinguir de forma confiável, só olhando a string, "isto já
  passou por `normalizeForStorage`" de "isto sempre foi assim" — não existe
  metadado de proveniência. Qualquer heurística (ex.: "se já começa com
  `assets/` e é NFC, não decodifique") não resolve a ambiguidade real entre
  `%` literal e `%` de escape, que é a causa raiz. Descartada: resolveria o
  sintoma de dupla aplicação (item 1.2) mas não a causa (item 1.1/1.3).

**Opção C — Tornar a migração não-destrutiva** (recomendada para já).
- Mudança mínima, local, inteiramente dentro de
  `pdfCacheNfcMigration.js`/`OfflineManager.ensureNfcMigration` — **não toca
  em `normalizeForStorage` nem em `PdfPathManager.js`**, respeitando o
  off-limits.
- Testado por que a guarda óbvia ("só apague se `canonicalizar(urlNova)`
  for ponto fixo") **não pega o caso real**: nos três casos de aninhamento
  testados (probe7.mjs), `canonicalizar(K_new) === K_new` deu `true` mesmo
  para a chave corrompida — a corrupção é, ironicamente, estável sob
  `canonicalizar`. A guarda que funciona é mais estreita e mais fiel ao nome
  da migração: **a migração NFC só deveria mudar a forma Unicode, nada mais.**
  Antes de apagar `urlAntiga`, decodificar as duas pathnames
  (`decodeURIComponent`) e comparar depois de `.normalize('NFC')` em ambas —
  se sobrar qualquer diferença além da forma Unicode (sinal de que o
  `%`-handling mexeu em conteúdo, não só em acentuação), **não apagar**:
  manter as duas chaves (o próprio código já documenta que isso é
  inofensivo — "duas chaves apontando para o mesmo PDF... nunca nenhuma") e
  logar/contar à parte para investigação.
- Trade: perde um pouco da "limpeza" de chave única nesse caso raro
  (duplicata inofensiva ocupando espaço), e não corrige a causa raiz — os
  quatro pontos de dupla aplicação do item 1.2 continuam frágeis. Mas fecha
  o único caminho hoje comprovado de **apagar** a chave boa, com uma mudança
  pequena, testável sem browser, e sem tocar na função de alto risco.

**Recomendação:** ship a Opção C agora (barata, local, testável, sem tocar
em `PdfPathManager.js`). Tratar a Opção A como item de plano à parte, com o
mesmo rigor (fixture completa dos 4629 caminhos + casos adversariais) que já
existe para o resto de `normalizeForStorage`. Opção B, descartar.

## 1.5 — Testabilidade sob `node --test`

Já existe, e já prova algo adjacente: `PdfPathManager.nfc.test.js:53-58`
tem um teste chamado literalmente "normalizeForStorage é idempotente", mas
roda só sobre os 8 caminhos NFD do acervo — nenhum deles tem `%`, então esse
teste **não pega** o defeito e não deveria ser tocado (ele prova uma
propriedade real e diferente: idempotência para acentuação, que continua
verdadeira). O contrato em
`src/lib/utils/normalizacaoCaminho.contrato.test.js:40-47` roda a mesma
asserção de idempotência sobre a fixture de 42 caminhos do acervo — mesma
limitação, mesmo motivo para não misturar.

Testes novos deveriam ficar em **arquivo separado** (ex.:
`PdfPathManager.percentEncoding.test.js`, ao lado dos outros
`PdfPathManager.*.test.js`), explicitamente rotulado como cobrindo entrada
**adversarial/sintética**, nunca do acervo real — para não sujar a leitura
de "a fixture real é idempotente" com casos que hoje são conhecidos por
falhar essa propriedade. Sugestão de conteúdo:
1. Um teste que **documenta o defeito atual** (não que o esconde): gera
   `%` aninhado com 3-5 camadas de `encodeURIComponent`, roda `F` duas vezes
   e afirma `assert.notEqual(F(x), F(F(x)))` — vira `assert.equal` no dia em
   que a Opção A for implementada, e o teste falhar nesse dia é o sinal
   correto de que a propriedade mudou (comentário no teste dizendo isso).
2. Um teste round-trip para `%` literal **não aninhado** (uma só camada),
   confirmando que hoje ele *não* quebra a auto-consistência
   `createRequestUrl(raw) === createRequestUrl(createRequestUrl_pathname_decoded)`
   mesmo sendo "corrompido" (documenta o comportamento atual, não o valida
   como correto).
3. Para `pdfCacheNfcMigration.test.js`: um teste usando o **`canonicalizar`
   real** de `OfflineManager.js` (hoje o arquivo só usa um `canonicalizar`
   de teste simplificado, linhas 41-45, que nunca decodifica duas vezes e
   por isso não expõe o problema) contra uma chave `K_orig` construída com
   `%` aninhado — e afirmando que, com a Opção C implementada, a migração
   **mantém as duas chaves** em vez de apagar a original. Este é o teste que
   fecha o buraco real: hoje a suíte de migração prova a mecânica
   grava-antes-de-apagar corretamente, mas nunca com um `canonicalizar` que
   possa produzir uma chave "errada" — só com o `canonicalizar` de brinquedo
   que decodifica uma vez e recodifica, sempre seguro.

---

# Item 2 — `resultadosProntos`: mesma variável, duas semânticas

## 2.1 — As duas definições

- **`/` (home)** — `src/routes/+page.svelte:67`: `let resultadosProntos =
  false;` (variável simples, não reativa). É setada para `true` **uma vez**,
  dentro de `finalizeFilteredResults()` (linha 83), quando
  `$louvoresLoaded && $louvores.length > 0 && $classificationFilters.length
  > 0` é verdade **naquele instante em que a função roda**. Não existe
  nenhum outro lugar no arquivo que a reatribua para `false` — é uma
  **trava (latch)**: uma vez `true`, permanece `true` pelo resto da vida da
  página, mesmo que `$classificationFilters` volte a ficar vazio depois.
- **`/biblioteca`** — `src/routes/biblioteca/+page.svelte:335`:
  `$: resultadosProntos = $louvoresLoaded && $louvores.length > 0 &&
  $classificationFilters.length > 0;` — uma **derivação `$:` viva**,
  recalculada a cada mudança de qualquer uma das três dependências. Pode ir
  de `true` para `false` e voltar quantas vezes o usuário mexer nos filtros.

**Diferença de semântica:** home = "em algum momento já produzi um
resultado real" (fato histórico, permanente); biblioteca = "agora mesmo,
neste instante, há filtro selecionado e catálogo carregado" (fato presente,
reversível). Nenhum comentário no código nomeia essa diferença — ambos os
comentários próximos (`+page.svelte:415-416` e
`biblioteca/+page.svelte:334`) descrevem o **propósito** (proteger
`?pagina=N` de um deep link) sem notar que a *forma* da proteção diverge
entre as duas páginas.

## 2.2 — A consequência concreta, e o veredito sobre a alegação registrada

**A alegação registrada se confirma integralmente.** Sequência reproduzida
por leitura de código (sem precisar de browser para o mecanismo em si — a
cadeia reativa é síncrona e determinística):

1. Usuário está em `/biblioteca?pagina=5` (ou qualquer página > 1) com pelo
   menos um "Arranjo" selecionado.
2. Usuário clica "desmarcar todos" nos filtros de Arranjo —
   `ClassificationFilters.svelte:33` chama `classificationFilters.deselectAll()`
   (`src/lib/stores/classificationFilters.js`), que faz `set([])` e
   `updateUrl([])` → `updateUrlParams({ arranjo: [] })`. O parâmetro
   `pagina` não é tocado por essa chamada (`construirQueryAtualizada` só
   mexe nos params passados). URL final: `?arranjo=&pagina=5`.
3. `estadoUrl` (via `lerEstadoDaUrl`, `src/lib/utils/urlEstado.js:73-91`)
   recalcula: `params.has('arranjo')` é `true` (a chave existe, vazia) →
   `temArranjo = true`, `arranjo = []` (via `deserializeArrayParam('')`,
   `src/lib/utils/urlParams.js:69`).
4. O `page.subscribe` de `classificationFilters.js` (linhas 39-51) vê
   `estado.temArranjo === true` e `estado.arranjo = []` → `set([])`.
   `$classificationFilters` fica `[]`.
5. Em `biblioteca/+page.svelte`: `resultadosProntos` (linha 335) recalcula
   para `false` (a terceira condição falha). `classificationFilteredLouvores`
   (linha 151-159) retorna `[]` explicitamente ("se nenhum filtro
   selecionado, mostra nada, não tudo"). `groupedLouvores` → `[]`.
   `totalPages` (linha 282-283) cai no fallback `1`. `currentPage` (linha
   286) = `Math.min(Math.max(1, 5), 1) = 1` — a UI renderiza página 1
   (ou o estado vazio) corretamente.
6. **O bloco de correção da URL** (linha 346):
   `$: if (browser && naBiblioteca && resultadosProntos && estadoUrl.pagina
   !== currentPage) { updateUrlParams({ pagina: currentPage }); }` —
   **não dispara**, porque `resultadosProntos` é `false`. `estadoUrl.pagina`
   (5, ou 999 se era esse o valor) permanece na URL, **descasado** do que
   está de fato renderizado (página 1).
7. Enquanto o(s) Arranjo(s) continuar(em) vazio(s), a URL mostra/compartilha
   `?arranjo=&pagina=999` mesmo a página exibida sendo 1. No instante em que
   o usuário reseleciona qualquer Arranjo, `resultadosProntos` volta a
   `true` e, **na primeira passada seguinte**, o bloco da linha 346 corrige
   sozinho (comparando o `estadoUrl.pagina` ainda velho contra o novo
   `currentPage`) — ou seja, o "preso" dura exatamente enquanto o filtro de
   Arranjo estiver vazio, não para sempre, mas é observável e
   compartilhável nesse meio-tempo (link copiado, aba deixada aberta,
   navegação de volta pelo histórico).

**Contraste em `/` (home):** a mesma ação (zerar `$classificationFilters`,
possível lá também — home importa o mesmo componente
`ClassificationFilters` e o mesmo store, `+page.svelte:9,584`) muda
`homeEmptyState` para `'arranjos-vazios'` (linha 399-400) mas **não** afeta
`resultadosProntos`, porque essa variável já foi travada em `true` na
primeira filtragem bem-sucedida e nunca mais é lida a partir de
`$classificationFilters` diretamente — só dentro de
`finalizeFilteredResults()`, que já rodou. O bloco equivalente de correção
(linha 417) continua ativo e corrige `?pagina=` normalmente mesmo com Arranjo
vazio. **A alegação registrada está certa em cada detalhe verificável**,
inclusive na causa (nomes iguais, semânticas diferentes, sem comentário) e
no efeito (`?arranjo=` vazio + `?pagina=` grande fica preso, só em
`/biblioteca`).

## 2.3 — Unificar, renomear, ou documentar?

São **o mesmo conceito com portas de saída diferentes**, não conceitos
genuinamente distintos: as duas variáveis existem exclusivamente para
responder "é seguro corrigir `?pagina=` agora, ou ainda estamos no
transiente de carregamento inicial?". A diferença de comportamento (trava
vs. viva) parece ser não-intencional — nenhum comentário defende a versão
viva da biblioteca como escolha deliberada; o comentário da linha 334 só
repete o motivo geral ("só depois disso faz sentido corrigir a paginação"),
que é exatamente o motivo dado para a versão travada da home.

**Sem mudar o comportamento observável de URL, dá para unificar**: trocar a
`$:` viva da biblioteca por uma trava equivalente à da home — um
`let catalogoProntoUmaVez = false` setado (e nunca desfeito) dentro de um
`$:` ou função quando as três condições valerem pela primeira vez, e usar
essa trava (não a condição viva) no guard da linha 346. Isso muda o
comportamento **de fato** (o `?pagina=` some/corrige mesmo com Arranjo
vazio) — que é a correção desejada, não um efeito colateral indesejado — mas
não muda o *contrato de URL* declarado em nenhum comentário: o objetivo
descrito em ambos os arquivos ("não apagar `?pagina=N` de um deep link
antes da lista real existir") continua satisfeito, e passa a valer também
depois que a lista fica vazia por escolha do usuário.

**Recomendação:** unificar (dar à biblioteca a mesma semântica de trava da
home), não apenas renomear/documentar. Documentar sem unificar deixaria o
bug (`?pagina=999` preso) existindo, só com uma explicação melhor ao lado.

## 2.4 — Risco

A camada de URL deste projeto já quebrou leitura de PDF e compartilhamento
de playlist em mudanças anteriores (conforme instrução da tarefa) — os
comentários no próprio código (`D-3`, "aba fria x aba quente", "achado em
navegador... não pego pela revisão de código", nas linhas 78-81 da home e
465-478/374-396 da biblioteca) documentam pelo menos três corridas reais já
encontradas manualmente, todas por causa de timing de blocos `$:` que leem
stores que outras partes do mesmo bloco escrevem. Trocar a variável viva por
uma trava é exatamente o tipo de mudança que historicamente expôs essas
corridas nesta base:

- **O que poderia quebrar:** se a trava for setada cedo demais (antes de
  `classificationFilters.aplicarPadrao(...)` rodar pela primeira vez — a
  mesma corrida que o comentário da linha 78-97 da home já descreve ter
  existido e corrigido), a biblioteca voltaria a apagar `?pagina=3` de um
  deep link em aba fria antes da lista real existir — reintroduzindo
  exatamente o bug que `resultadosProntos` foi criado para evitar, só que
  agora do lado da biblioteca.
- **O que precisaria ser verificado em navegador** (não só por leitura,
  dado o histórico desta área):
  1. Abrir `/biblioteca?pagina=3` em aba fria (sem cache, sem stores
     populadas) com um link que não tem `?arranjo=` — confirmar que a
     página 3 sobrevive ao carregamento inicial e ao `aplicarPadrao` (a
     mesma corrida D-3, agora no código da trava nova).
  2. Abrir `/biblioteca?arranjo=&pagina=999` diretamente (sem passar pela
     UI) — confirmar que corrige para `pagina=1` (ou o valor válido) assim
     que os dados carregam, sem re-zerar para `pagina=1` por engano via o
     bloco de "critério mudou" (linha 360-369), que é um mecanismo
     **separado** e não deveria disparar só por causa da trava mudar de
     `false` para `true`.
  3. Repetir 1 e 2 na home, para confirmar que unificar o *estilo* de trava
     não muda o comportamento dela (já é trava; deve continuar idêntico).
  4. Testar a sequência completa do item 2.2 (desmarcar todos os Arranjos
     com `pagina=5`, confirmar URL, remarcar um Arranjo, confirmar
     correção) nas duas páginas, comparando lado a lado.
  5. Confirmar que leitura de PDF e compartilhamento de playlist — as duas
     áreas que já quebraram por mudança na camada de URL — não são tocadas
     por esta mudança: `resultadosProntos` não aparece em nenhum caminho de
     `playlistShare.js` nem de abertura de PDF; o raio de impacto esperado
     é só a correção de `?pagina=`. Ainda assim, como o histórico mostra que
     o `$:` graph inteiro da página reage em conjunto, uma verificação manual
     de "abrir um PDF" e "compartilhar uma playlist" em `/biblioteca` depois
     da mudança é barata e recomendada mesmo sem relação de código aparente.
