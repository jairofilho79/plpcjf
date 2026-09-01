# PLPC — O que falta: URLs, caminhos e o resto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os onze achados abertos da auditoria mais os descobertos durante a execução, tendo como peça central a unificação da normalização de caminho de PDF (#22) e a reescrita da sincronização URL ↔ estado (#21) — as duas áreas que o dono do projeto identificou como construídas às pressas e cheias de armadilhas de refatoração.

**Architecture:** Três fases de rede de segurança antes de qualquer mudança de comportamento, porque as duas áreas de maior valor são também as que quebram em silêncio: um erro em #22 apaga o acervo offline inteiro do aparelho do usuário sem uma mensagem de erro, e um erro em #21 mata links de playlist que já circulam no WhatsApp. As Tarefas 1-3 criam testes executáveis que congelam o comportamento de hoje; nada depois delas pode ser integrado com o contrato vermelho. A Tarefa 4 é contenção imediata. As Tarefas 5-9 unificam a normalização na direção que **não** invalida dado gravado. As Tarefas 10-12 reescrevem a camada de URL. O resto é interface, limpeza e manutenção, em ordem decrescente de valor.

**Tech Stack:** SvelteKit 2 / Svelte 4, Vite 5, Tailwind 3, fflate, pdfjs-dist 4.8.69, Cloudflare Pages + R2, `node --test`.

**Spec:** Auditoria Técnica PLPC — https://claude.ai/code/artifact/a4e1959b-9b0f-48ce-8163-6c94af4390e3
(achados #16, #18, #20, #21, #22, #23, #24, #27, #28, #29, #30 + os descobertos durante a execução do plano anterior)

**Fora de escopo, por decisão do dono:** o achado **#33** (aposentar `v2.plpcg.com` e `120826.plpcg.com` para poder apagar o Worker) fica adiado. Enquanto esses dois sites viverem, a regra de correspondência de chave R2 continua valendo em dois deploys distintos — por isso a restrição de não tocar em `src/lib/server/r2KeyMatch.js` nem em `worker/` é ainda mais rígida neste plano do que seria se o #33 estivesse em execução.

**Investigação de apoio** — leia antes de executar qualquer tarefa das Fases 0-3. São mapas produzidos por leitura e **execução** do código real, com cada afirmação marcada como verificada ou inferida:
- `docs/superpowers/investigacao/2026-08-31-caminho-pdf.md` — as nove representações de um caminho de PDF, a tabela de divergência executada sobre os 4629 caminhos reais do acervo, e as catorze estratégias de correspondência difusa.
- `docs/superpowers/investigacao/2026-08-31-url-estado.md` — os dezesseis parâmetros de URL, o formato exato do link de compartilhamento, os quinze religamentos de flag por timer, e o contrato de compatibilidade completo.

**Pré-requisito:** `2026-08-31-plpc-melhorias-recomendadas.md` concluído (está: merge `b837d4a`, em produção e verificado em navegador). Este plano assume `src/service-worker.js`, `src/lib/offline/sw/swCaches.js` e `src/lib/offline/download/partProgress.js` já existindo.

---

## Global Constraints

- **Runtime de teste:** `node --test`. Não introduzir vitest nem jest. A Tarefa 1 resolve os testes que hoje dependem deles **convertendo**, nunca instalando.
- **Imports em arquivos testáveis:** só caminhos relativos. `$lib` não resolve sob `node --test`.
- **Nada em `static/` pode ser arquivo de teste** — o diretório inteiro vai para o deploy.
- **Idioma:** comentários e UI em pt-BR.
- **Commits:** um por tarefa, Conventional Commits.
- **Verificação a cada tarefa:** `npm test` passa; `npm run build` conclui.
- **A normalização vencedora é `normalizeForStorage`** — a que preserva caixa e acento. Está provado por execução que a alternativa invalida **4629 de 4629** chaves já gravadas no aparelho do usuário. Nenhuma tarefa pode inverter essa direção.
- **`src/lib/server/r2KeyMatch.js` e `worker/` não podem ser tocados por nenhuma tarefa deste plano.** `worker/index.js` importa `findExactKeyMatch` por caminho relativo e é um **deploy separado**; mudar a regra ali sem publicar o Worker deixa `v2.plpcg.com` e `120826.plpcg.com` com a regra antiga.
- **O formato do `?file=` do leitor está congelado:** `encodeURIComponent('/' + caminho relativo com caixa e acento originais)`. Existem links assim no mundo, e um deles está hard-coded em `src/routes/offline/+page.svelte:1117`.
- **Nenhuma escrita de URL pode ocorrer em `/leitor`.** Hoje isso é garantido por acidente; a Tarefa 4 torna a garantia explícita e as tarefas seguintes não podem removê-la.
- **Parâmetros desconhecidos são preservados.** `utm_source`, `fbclid` e afins chegam em links de WhatsApp e Facebook; nenhuma reescrita de URL pode apagá-los.
- **Ordem obrigatória:** Tarefas 1-3 antes de qualquer outra. Tarefa 5 antes da 9. Tarefa 2 antes de 5-9. Tarefa 3 antes de 4 e de 10-12.

---

## Decisões tomadas antes da execução

O relatório de URL marcou vinte e um pontos onde o comportamento atual é discutível e a reescrita precisa **decidir** em vez de reproduzir. Decido aqui, com o custo de estar errado, para que nenhuma tarefa pare esperando resposta. Cada uma é reversível e está isolada num commit próprio.

| # | Questão | Decisão | Por quê | Custo se eu estiver errado |
|---|---|---|---|---|
| D-1 | `pushState` ou `replaceState` para filtros? | **Manter `replaceState`** | Trocar muda o botão voltar para todo mundo, e ninguém pediu | Nenhum; o inverso é que seria caro |
| D-2 | A home reescrever a URL sozinha para `?arranjo=<5 valores>` ~200 ms após abrir | **Remover** | O valor gravado é idêntico ao default; os links já compartilhados nesse formato continuam funcionando porque a leitura continua aceitando-os. URL limpa de graça | Nenhum verificado |
| D-3 | `?pesquisa=X&pagina=3` em aba fria | **Página 3 sempre** | Hoje é corrida: página 3 em aba quente, 1 em aba fria. Um deep link que funciona "às vezes" é pior que qualquer dos dois | Se alguém dependia do reset, perde-o |
| D-4 | Abrir o mesmo link de lista 3× | **Deduplicar** por `findPlaylistByPdfIds` | A função já existe e já é usada em `CarouselNavigator`. Três listas idênticas é lixo, não recurso | Quem quisesse duas cópias precisa duplicar à mão |
| D-5 | `pdfId` com `+` no link de compartilhamento | **Encodar cada id na escrita; continuar aceitando o formato cru na leitura** | Hoje zero ids têm `+`, mas o `pdfId` é base64 de caminho arbitrário: um arquivo novo arma a bomba. A leitura tolerante preserva todo link já enviado | Nenhum; é estritamente aditivo |
| D-6 | `sharename` com `%` lança `URIError` | **Corrigir** removendo o decode extra | Hoje "Louvor 100%" carrega o carrossel, **não salva a lista**, e deixa a URL suja | Nenhum |
| D-7 | Limpeza do link apaga a query inteira | **Preservar params de terceiros**, remover só `sharepdfs` e `sharename` | `utm_source` e `fbclid` chegam nesses links | Nenhum |
| D-8 | "Nenhum material selecionado" é irrepresentável na URL | **Passar a gravar `materiais=` vazio** | O estado é alcançável pela UI e some ao recarregar. A leitura já o interpreta corretamente | URLs um pouco mais longas nesse estado |
| D-9 | `?comoAbrir=lixo` fica pendurado para sempre | **Normalizar na próxima escrita** | Barato, e só afeta params conhecidos com valor inválido | Nenhum |
| D-10 | `itensPorPagina` vaza de `/biblioteca` para `/` (store compartilhado) | **Manter o compartilhamento**, só igualar o tratamento de valor inválido | É preferência do usuário, não estado de rota. A assimetria é que é bug | Se for vazamento indesejado, fica para depois |
| D-11 | `/listas?viewId=` não funciona em outro aparelho | **Preservar** | Ids são de `localStorage`. Está correto | — |
| D-12 | `CacheMigrationV2` | **Aposentar** | Reescreve entradas por heurística de string (`includes('cifra') && includes('nivel')`) e **apaga a antiga**. Com a chave unificada não tem trabalho a fazer, e a flag já está `true` na maioria dos aparelhos | Se algum aparelho antigo dependia dela, perde a migração — mas ela já não roda lá |
| D-13 | `#16 content-visibility` | **Medir antes de aplicar; descartar se não render** | As listas já paginam em 50 itens; a auditoria supôs listas longas que não existem | Nenhum |
| D-14 | `#23` quebrar arquivos de 2.000+ linhas | **Só depois da Fase 2**, e só o que sobrar grande | A unificação apaga oito estratégias difusas de `offline.js`; parte do problema se resolve sozinha | Nenhum |
| D-15 | `#29` modo offline | **Dar entrada visível e apagar o `OfflineGestureDetector` órfão** | O componente de sete toques não é importado em lugar nenhum: o modo offline não está escondido, está inalcançável a não ser digitando `/offline`. Investimos em skeletons e estatísticas numa tela sem porta | Se a intenção era ser privado, reverter é uma linha |

**Estas quinze decisões são minhas, não suas.** Se alguma estiver errada, cada uma vive num commit isolado e sai com um `git revert`.

---

## Índice das tarefas

| # | Tarefa | Achado | Fase |
|---|---|---|---|
| 1 | Ressuscitar os seis testes que nenhum runner abre | #24 | 0 |
| 2 | Contrato executável da normalização de caminho | #24 | 0 |
| 3 | Contrato executável da camada de URL e do compartilhamento | prep. #21 | 0 |
| 4 | Guarda de rota em `updateUrlParams` e fim do duplo decode | #21 | 1 |
| 5 | Um só codificador de URL de PDF | #22 | 2 |
| 6 | NFC na normalização de armazenamento | #22 | 2 |
| 7 | O índice de disponibilidade sobre a chave real | #22 | 2 |
| 8 | Remover as estratégias que podem devolver o PDF errado | #22 | 2 |
| 9 | Apagar a normalização perdedora e as oito estratégias restantes | #22 | 2 |
| 10 | Compartilhamento de listas à prova de `%` e de `+` | #21 | 3 |
| 11 | `urlSync` unidirecional e a home sem flags | #21 | 3 |
| 12 | A biblioteca sem flags e sem o anel de `arranjoEspecial` | #21 | 3 |
| 13 | Os três estados vazios da home | #27 | 4 |
| 14 | Estado de carregamento na home e na biblioteca | #28 | 4 |
| 15 | Controle de brilho no leitor | #30 | 4 |
| 16 | Uma porta para o modo offline | #29 | 4 |
| 17 | A biblioteca usa o controle de paginação compartilhado | novo | 4 |
| 18 | Lote — ciclo de vida do SW e armazenamento defensivo | parqueados | 5 |
| 19 | Lote — código morto e bugs inertes | novos | 5 |
| 20 | Enxugar a cópia do pdf.js | #18 | 5 |
| 21 | `content-visibility` só se a medição justificar | #16 | 5 |
| 22 | Zerar os tipos em `src/lib/offline/**` e travar no CI | #20 | 6 |
| 23 | Quebrar os arquivos que passam de 2.000 linhas | #23 | 6 |

---

## Conflitos entre tarefas, resolvidos antes da execução

As seções deste plano foram redigidas em paralelo, por autores que não se viam. A varredura abaixo cruza cada par de tarefas que compartilha arquivo ou interface. **Cada linha já vem com a decisão** — o executor segue a decisão, não reabre a discussão.

| # | Conflito | O que uma produz × o que a outra consome | Decisão |
|---|---|---|---|
| K-1 | **Tarefa 3 × Tarefa 11** | A 3 extrai `src/lib/utils/urlParams.js` puro (ler e escrever *parâmetros*). A 11 cria `src/lib/utils/urlEstado.js` com `lerEstadoDaUrl` (derivar o *estado da página*). Foram escritas em paralelo, sem se ver | **Os dois módulos podem coexistir — são camadas, não cópias — mas `urlEstado.js` consome `urlParams.js` e não reimplementa nenhuma regra de parsing ou serialização.** O primeiro passo da Tarefa 11 é diferenciar os dois arquivos e apagar da 11 tudo que a 3 já resolve. Se sobrar menos de uma função em `urlEstado.js`, ela vira export de `urlParams.js` e o arquivo não nasce |
| K-2 | **Tarefa 3 × Tarefa 12** | A 12 apaga `parseUrlParams` e os dois serializadores. O contrato da 3 os exercita | **Nenhuma asserção do contrato pode ser apagada.** A Tarefa 12 migra as asserções para o leitor novo **antes** de remover as funções, e o commit que remove tem de sair com o contrato verde. Um contrato que some junto com o código que ele protege nunca protegeu nada |
| K-3 | **Tarefa 4 × Tarefa 11** | A 4 cria `podeEscreverNaUrl(pathname)`. A 11 descreve a guarda de rota "checada no flush" | A Tarefa 11 **consome** `podeEscreverNaUrl`; não reimplementa a regra. A mudança da 11 é *onde* a guarda é checada (no flush, não na chamada), não *qual* é a regra |
| K-4 | **Tarefa 1 × Tarefa 5** | Ambas convertem os imports de `PdfPathManager.js` de `$lib` para caminho relativo | Quem executar primeiro faz; a outra confere com `grep -n "^import" src/lib/offline/utils/PdfPathManager.js` e segue. Não é conflito de conteúdo, é trabalho repetido |
| K-5 | **Tarefa 9 × Tarefa 19** | As duas mexem nos três imports mortos de `urlNormalizer` (`CacheMigration.js`, `StatsCalculator.js`, `PackageDownloader.js`) | **Ficam na Tarefa 9**, que apaga o módulo inteiro. A Tarefa 19 já está redigida citando isso |
| K-6 | **Tarefa 12 × Tarefa 17** | As duas reescrevem trechos de `src/routes/biblioteca/+page.svelte` | **17 depois de 12.** A 12 se apoia em `arquivo:linha` do código de hoje; rodar a 17 antes invalida essas referências. O inverso só exige reler o arquivo |
| K-7 | **Tarefa 2 × Tarefa 5** | As duas geram fixtures a partir do `louvores-manifest.json` | A **Tarefa 2 é a dona** da fixture versionada (`src/lib/utils/fixtures/caminhos-acervo.json`). A Tarefa 5 consome; se precisar de caminho que não esteja lá, estende a fixture da 2 em vez de criar outra |
| K-8 | **Tarefa 18 × Tarefa 23** | A 18 extrai `partVerification.js` de `offline.js`; a 23 divide `offline.js` por responsabilidade | **18 antes de 23.** A extração da 18 já é uma divisão por responsabilidade e reduz o alvo da 23. A 23 começa remedindo o arquivo, então absorve o resultado da 18 sem retrabalho |
| K-9 | **Fase 2 inteira × Tarefa 23** | A Fase 2 remove ~1.700 linhas, boa parte em `offline.js` e `offline/+page.svelte` | Decisão **D-14** do cabeçalho: a Tarefa 23 só corre depois da Fase 2, e o primeiro passo dela é **remedir**. Dividir antes seria dividir código que vai sumir |
| K-10 | **Tarefa 21 pode não mudar código** | O achado #16 pressupunha listas longas; as listas paginam em 50 | **Terminar sem mudança é desfecho válido**, desde que o número medido fique registrado. Uma tarefa que descarta um achado com medição é tão concluída quanto uma que aplica CSS |

Um conflito que a varredura procurou e **não** encontrou: nenhuma tarefa toca `src/lib/server/r2KeyMatch.js` nem `worker/`, e nenhuma altera o formato do `?file=` do leitor. As duas fronteiras congeladas pelas Global Constraints seguem congeladas.

---

## Fase 0 — Rede de segurança

Nenhuma tarefa desta fase muda comportamento. Elas existem para que as fases seguintes tenham como provar que não quebraram nada.

---

### Task 1: Ressuscitar os seis testes que nenhum runner abre (#24)

O script `test` do `package.json` lista **treze** arquivos de teste, um por um, à mão. O repositório tem **dezenove** arquivos `*.test.js`. Os seis de fora nunca rodaram: quatro importam de `vitest`, que não está nas dependências; um usa os globais `describe`/`test`/`expect` do Jest, que também não existe aqui; e um é um roteiro para colar no console do navegador, com `console.log` em vez de asserções. Entre eles estão os únicos testes que descrevem as **duas normalizações de caminho de PDF** que a Fase 1 vai unificar — ou seja, o comportamento mais perigoso do sistema está documentado só em arquivos que ninguém executa. Pior: a lista manual é uma armadilha permanente, porque um teste novo só passa a valer se alguém lembrar de acrescentá-lo à linha.

Esta tarefa acaba com a lista manual e resolve os seis, um a um. Dois são convertidos para `node:test` + `node:assert/strict` com imports relativos. Quatro são apagados, e cada apagamento traz a razão verificada por comando, mais o registro do que se perde. Sucesso = `npm test` descobre sozinho **todos** os `*.test.js` de `src/` e termina com `fail 0`; nenhum arquivo de teste fica no repositório sem rodar.

**Files:**
- Modify: `package.json` (script `test`: lista manual → glob)
- Modify: `src/lib/offline/utils/PdfPathManager.js:8-9` (imports `$lib` → relativos)
- Modify: `src/lib/offline/utils/PdfPathManager.test.js` (Jest → `node:test`)
- Modify: `src/lib/utils/louvoresManifestChecksum.test.js` (vitest → `node:test`)
- Delete: `src/lib/offline/normalization/UrlNormalizer.test.js`
- Delete: `src/lib/offline/validation/PdfValidator.test.js`
- Delete: `src/lib/stores/louvores.checksum.test.js`
- Delete: `src/lib/stores/louvores.versioning.test.js`

**Interfaces:**
- Consumes: nada. Esta é a primeira tarefa do plano.
- Produces:
  - Script `npm test` = `node --test "src/**/*.test.js"`. **A partir daqui, criar um arquivo `*.test.js` sob `src/` basta para ele rodar.** Nenhuma tarefa posterior precisa (nem deve) editar a lista do `package.json` — se uma tarefa mais adiante mandar acrescentar um arquivo ao script `test`, esse passo virou desnecessário.
  - `src/lib/offline/utils/PdfPathManager.js` passa a importar por caminho relativo (`../../utils/urlEncoding.js`) e, com isso, **carrega sob `node --test`**. As Tarefas 2, 5 e 6 dependem disso. A Tarefa 5, Step 2, manda fazer exatamente esta troca: ao chegar lá, confirme que já está feita e siga para o Step 3.
  - `PdfPathManager.normalizeForStorage` e `PdfPathManager.createRequestUrl` ganham cobertura executável (16 casos), que a Tarefa 2 usa como base e as Tarefas 5 e 6 têm de manter verde.

- [ ] **Step 1: Ver o buraco**

Este comando compara os arquivos que existem com os que o runner abre. Não altera nada.

```bash
cd "$(git rev-parse --show-toplevel)" && node -e "
const fs=require('fs');
const {execSync}=require('child_process');
const script=JSON.parse(fs.readFileSync('package.json','utf8')).scripts.test;
const listados=new Set(script.split(/\s+/).filter(t=>t.endsWith('.test.js')));
const existentes=execSync('find src -name \"*.test.js\"',{encoding:'utf8'}).trim().split('\n').sort();
console.log('arquivos *.test.js em src/ :', existentes.length);
console.log('arquivos no script test    :', listados.size);
console.log('nunca executados:');
for(const f of existentes) if(!listados.has(f)) console.log('  ', f);
"
```

Saída esperada, exatamente:

```
arquivos *.test.js em src/ : 19
arquivos no script test    : 13
nunca executados:
   src/lib/offline/normalization/UrlNormalizer.test.js
   src/lib/offline/utils/PdfPathManager.test.js
   src/lib/offline/validation/PdfValidator.test.js
   src/lib/stores/louvores.checksum.test.js
   src/lib/stores/louvores.versioning.test.js
   src/lib/utils/louvoresManifestChecksum.test.js
```

- [ ] **Step 2: Medir se o `node --test` desta versão de Node aceita glob**

A decisão "lista manual ou glob" não pode ser por fé. Meça.

```bash
cd "$(git rev-parse --show-toplevel)" && node --version && sh -c 'node --test "src/**/*.memo.test.js"' 2>&1 | tail -6
```

Saída esperada:

```
v25.8.2
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 70.810375
```

Dois fatos que essa saída estabelece: o `node --test` desta versão expande `**` sozinho, e funciona sob `sh -c`, que é como o npm executa os scripts (o `sh` do macOS não tem *globstar*; ao não casar nada, ele repassa o padrão literal, e quem expande é o Node). **Decisão: glob, entre aspas.** As aspas não são decorativas — sem elas o `sh` tenta expandir primeiro e o resultado passa a depender do shell de quem roda.

Se o `node --version` da sua máquina for anterior a `v21`, o glob não existe e a decisão se inverte: mantenha a lista manual e acrescente à mão os arquivos que sobreviverem a esta tarefa. Anote qual dos dois caminhos você tomou.

- [ ] **Step 3: Trocar a lista pelo glob e ver os seis falharem**

Em `package.json`, substitua o valor inteiro do script `test`:

```
"test": "node --test src/lib/utils/groupLouvores.test.js src/lib/offline/import/zipCdReader.test.js … src/lib/utils/swDebugMessage.test.js",
```

por:

```
"test": "node --test \"src/**/*.test.js\"",
```

O script `test:offline-bundle` fica como está — é um atalho para rodar só o subconjunto de importação de bundle, e continua útil.

```bash
npm test 2>&1 | tail -20
```

Saída esperada — os seis arquivos agora são visíveis e vermelhos:

```
ℹ tests 137
ℹ suites 28
ℹ pass 131
ℹ fail 6

✖ failing tests:
✖ src/lib/offline/normalization/UrlNormalizer.test.js
✖ src/lib/offline/utils/PdfPathManager.test.js
✖ src/lib/offline/validation/PdfValidator.test.js
✖ src/lib/stores/louvores.checksum.test.js
✖ src/lib/stores/louvores.versioning.test.js
✖ src/lib/utils/louvoresManifestChecksum.test.js
```

com quatro `Cannot find package 'vitest'` e dois `Cannot find package '$lib'`. Este é o vermelho de partida da tarefa. Os próximos passos o zeram um arquivo por vez.

- [ ] **Step 4: Tornar `PdfPathManager` carregável fora do Vite**

`src/lib/offline/utils/PdfPathManager.js:8-9` importa por `$lib`, um alias que só existe dentro do Vite. Ele é o motivo do `Cannot find package '$lib'` do passo anterior. O módulo de destino, `src/lib/utils/urlEncoding.js`, não importa nada — trocar para caminho relativo torna a cadeia inteira carregável sob `node --test`.

Substitua as duas linhas:

```js
import { decodeUrlUtf8Multiple } from '$lib/utils/urlEncoding.js';
import { createUrlUtf8 } from '$lib/utils/urlEncoding.js';
```

por:

```js
// Caminho relativo, não `$lib`: este módulo precisa carregar sob `node --test`,
// e o alias `$lib` só existe dentro do Vite. De src/lib/offline/utils/ para
// src/lib/utils/ são dois níveis acima.
import { decodeUrlUtf8Multiple, createUrlUtf8 } from '../../utils/urlEncoding.js';
```

Confirme que o módulo carrega fora do Vite:

```bash
cd "$(git rev-parse --show-toplevel)" && node --input-type=module -e "
const M = (await import('./src/lib/offline/utils/PdfPathManager.js')).default;
console.log(M.createRequestUrl('Categoria/arquivo.pdf', 'https://example.com'));
"
```

Saída esperada:

```
https://example.com/assets/Categoria/arquivo.pdf
```

- [ ] **Step 5: Converter `PdfPathManager.test.js` para `node:test`**

O arquivo usa `describe`/`test`/`expect` sem importar nada — a convenção do Jest. Reescreva-o inteiro, preservando os dezesseis casos originais um a um. Substitua todo o conteúdo de `src/lib/offline/utils/PdfPathManager.test.js` por:

```js
/**
 * Normalização de caminho que preserva caixa e acentos.
 * Run: node --test src/lib/offline/utils/PdfPathManager.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import PdfPathManager from './PdfPathManager.js';

describe('PdfPathManager.normalizeForStorage', () => {
  it('preserva caixa e acentos', () => {
    assert.equal(
      PdfPathManager.normalizeForStorage('assets/Cifra nível I/arquivo.pdf'),
      'assets/Cifra nível I/arquivo.pdf'
    );
  });

  it('preserva maiúsculas em nome de categoria', () => {
    assert.equal(
      PdfPathManager.normalizeForStorage('assets/ColAdultos/001.pdf'),
      'assets/ColAdultos/001.pdf'
    );
  });

  it('acrescenta o prefixo assets/ quando falta', () => {
    assert.equal(
      PdfPathManager.normalizeForStorage('Categoria/arquivo.pdf'),
      'assets/Categoria/arquivo.pdf'
    );
  });

  it('não duplica o prefixo assets/ quando já existe', () => {
    assert.equal(
      PdfPathManager.normalizeForStorage('assets/Categoria/arquivo.pdf'),
      'assets/Categoria/arquivo.pdf'
    );
  });

  it('remove barras iniciais', () => {
    assert.equal(
      PdfPathManager.normalizeForStorage('/assets/Categoria/arquivo.pdf'),
      'assets/Categoria/arquivo.pdf'
    );
  });

  it('remove protocolo e domínio', () => {
    assert.equal(
      PdfPathManager.normalizeForStorage('https://example.com/assets/Categoria/arquivo.pdf'),
      'assets/Categoria/arquivo.pdf'
    );
  });

  it('converte separador do Windows para barra', () => {
    assert.equal(
      PdfPathManager.normalizeForStorage('assets\\Categoria\\arquivo.pdf'),
      'assets/Categoria/arquivo.pdf'
    );
  });

  it('devolve string vazia para string vazia', () => {
    assert.equal(PdfPathManager.normalizeForStorage(''), '');
  });

  it('devolve string vazia para null e undefined', () => {
    assert.equal(PdfPathManager.normalizeForStorage(null), '');
    assert.equal(PdfPathManager.normalizeForStorage(undefined), '');
  });
});

describe('PdfPathManager.createRequestUrl', () => {
  it('monta a URL completa a partir da origem', () => {
    const url = PdfPathManager.createRequestUrl('assets/Categoria/arquivo.pdf', 'https://example.com');
    assert.equal(url, 'https://example.com/assets/Categoria/arquivo.pdf');
  });

  it('normaliza o caminho antes de montar a URL', () => {
    const url = PdfPathManager.createRequestUrl('Categoria/arquivo.pdf', 'https://example.com');
    assert.equal(url, 'https://example.com/assets/Categoria/arquivo.pdf');
  });

  it('devolve string vazia para caminho vazio', () => {
    assert.equal(PdfPathManager.createRequestUrl(''), '');
  });
});

describe('PdfPathManager.createSearchVariations', () => {
  it('gera pelo menos uma variação, todas string', () => {
    const variacoes = PdfPathManager.createSearchVariations(
      'assets/Categoria/arquivo.pdf',
      'https://example.com'
    );
    assert.ok(variacoes.length > 0);
    assert.ok(variacoes.every((v) => typeof v === 'string'));
  });

  it('as variações incluem o caminho normalizado', () => {
    const variacoes = PdfPathManager.createSearchVariations(
      'Categoria/arquivo.pdf',
      'https://example.com'
    );
    assert.ok(variacoes.some((v) => v.includes('assets/Categoria/arquivo.pdf')));
  });

  it('não repete variações', () => {
    const variacoes = PdfPathManager.createSearchVariations(
      'assets/Categoria/arquivo.pdf',
      'https://example.com'
    );
    assert.equal(variacoes.length, new Set(variacoes).size);
  });

  it('devolve lista vazia para caminho vazio', () => {
    assert.deepEqual(PdfPathManager.createSearchVariations(''), []);
  });
});
```

```bash
node --test src/lib/offline/utils/PdfPathManager.test.js 2>&1 | tail -8
```

Saída esperada: `ℹ tests 16`, `ℹ pass 16`, `ℹ fail 0`.

- [ ] **Step 6: Converter `louvoresManifestChecksum.test.js` para `node:test`**

Este arquivo importa `describe/it/expect/vi` de `vitest`. O módulo sob teste, `src/lib/utils/louvoresManifestChecksum.js`, não importa **nada** e lê o `localStorage` **global** (`:43`, `:52`, `:58`, `:68`, `:80`, `:96`). Basta injetar um `localStorage` falso em `globalThis`. O `vi.useFakeTimers()` do original é desnecessário: todas as funções recebem `now` por parâmetro.

Substitua todo o conteúdo de `src/lib/utils/louvoresManifestChecksum.test.js` por:

```js
/**
 * Checksum do louvores-manifest.json: janela de 24 h e backoff.
 * Run: node --test src/lib/utils/louvoresManifestChecksum.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MANIFEST_SYNC_RETRY_DELAYS_MIN,
  parseExpectedChecksumFromResponseBody,
  readManifestSyncPenalty,
  recordManifestSyncFailure,
  resetManifestSyncPenalty,
  sha256HexUtf8,
  shouldFetchExpectedChecksum,
  writeChecksumLastOkAt,
  writeManifestBodySha256
} from './louvoresManifestChecksum.js';

/** Storage de memória com a mesma interface de window.localStorage. */
function criarStorage() {
  const mapa = new Map();
  return {
    get length() { return mapa.size; },
    key(i) { return [...mapa.keys()][i] ?? null; },
    getItem(k) { return mapa.has(k) ? mapa.get(k) : null; },
    setItem(k, v) { mapa.set(k, String(v)); },
    removeItem(k) { mapa.delete(k); }
  };
}

describe('louvoresManifestChecksum', () => {
  beforeEach(() => {
    // O módulo lê o `localStorage` global, não um parâmetro injetado.
    globalThis.localStorage = criarStorage();
  });

  afterEach(() => {
    delete globalThis.localStorage;
  });

  it('sha256HexUtf8 bate com o digest conhecido da string vazia', async () => {
    assert.equal(
      await sha256HexUtf8(''),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('parseExpectedChecksumFromResponseBody aceita 64 hex e devolve minúsculo', () => {
    const maiusculo = 'ABCDEF0123456789'.repeat(4);
    assert.equal(parseExpectedChecksumFromResponseBody(`  ${maiusculo}  `), maiusculo.toLowerCase());
    assert.equal(parseExpectedChecksumFromResponseBody('not-hex'), null);
    assert.equal(parseExpectedChecksumFromResponseBody(''), null);
  });

  it('shouldFetchExpectedChecksum exige baseline, estar online e a janela de 24 h', async () => {
    const corpo = '[{"pdfId":"x"}]';
    writeManifestBodySha256(await sha256HexUtf8(corpo));
    const agora = 1_000_000_000_000;

    assert.equal(shouldFetchExpectedChecksum(agora, false), false);
    assert.equal(shouldFetchExpectedChecksum(agora, true), true);

    writeChecksumLastOkAt(agora);
    assert.equal(shouldFetchExpectedChecksum(agora + 1, true), false);
    assert.equal(shouldFetchExpectedChecksum(agora + 24 * 60 * 60 * 1000, true), true);
  });

  it('recordManifestSyncFailure aplica 1–2–4–8–16 min e depois 24 h de espera', () => {
    const t0 = 10_000_000_000_000;
    resetManifestSyncPenalty();

    let t = t0;
    for (let i = 0; i < 4; i++) {
      recordManifestSyncFailure(t);
      const p = readManifestSyncPenalty();
      assert.equal(p.failStreak, i + 1);
      assert.equal(p.cooldownUntil, 0);
      assert.equal(p.nextRetryAt, t + MANIFEST_SYNC_RETRY_DELAYS_MIN[i] * 60_000);
      t = p.nextRetryAt;
    }

    recordManifestSyncFailure(t);
    const final = readManifestSyncPenalty();
    assert.equal(final.failStreak, 0);
    assert.equal(final.nextRetryAt, 0);
    assert.equal(final.cooldownUntil, t + 24 * 60 * 60 * 1000);
  });
});
```

```bash
node --test src/lib/utils/louvoresManifestChecksum.test.js 2>&1 | tail -8
```

Saída esperada: `ℹ tests 4`, `ℹ pass 4`, `ℹ fail 0`.

- [ ] **Step 7: Apagar `UrlNormalizer.test.js` — o módulo sob teste não carrega fora do Vite**

Este arquivo não é um teste: é um roteiro para colar no console do navegador, com `console.log`/`console.error` e funções exportadas (`runAllTests`, `runCompatibilityTest`) que ninguém chama. Não tem uma única asserção.

E ele não pode ser convertido, porque o módulo que ele testa não carrega sob `node --test`. A cadeia é: `UrlNormalizer.js:7-8` importa `NormalizationCache.js` e `OfflineLogger.js`; ambos importam `OfflineConfig.js`; e `src/lib/offline/core/OfflineConfig.js:6` importa `$app/environment`, que **só existe dentro do SvelteKit**. Ao contrário do `$lib`, isso não se resolve trocando por caminho relativo: não há arquivo para apontar.

Prove antes de apagar:

```bash
cd "$(git rev-parse --show-toplevel)" && node --input-type=module -e "
await import('./src/lib/offline/normalization/UrlNormalizer.js');
" 2>&1 | head -3
```

Saída esperada:

```
node:internal/modules/package_json_reader:301
  throw new ERR_MODULE_NOT_FOUND(packageName, fileURLToPath(base), null);
        ^
```

seguida de `Cannot find package '$app' imported from …/src/lib/offline/core/OfflineConfig.js`.

**O que se perde e onde reaparece.** O arquivo documentava a intenção original da normalização minúscula — `assets/ColAdultos/001.pdf` → `assets/coladultos/001.pdf` (`UrlNormalizer.test.js:21-47`, catorze pares entrada/esperado). Essa intenção **não se perde**: `UrlNormalizer` apenas delega para `normalizePdfUrl` de `src/lib/utils/pathUtils.js` (`UrlNormalizer.js:49`), que **carrega sob `node --test`** (só importa `./urlEncoding.js`), e a **Tarefa 2** congela o comportamento dessa função com caminhos reais do acervo. Ao executar a Tarefa 2, leve os catorze pares deste arquivo para lá se algum deles cobrir um caso que a fixture não cobre.

```bash
git rm src/lib/offline/normalization/UrlNormalizer.test.js
```

- [ ] **Step 8: Apagar `PdfValidator.test.js` — testa uma interface que deixou de existir**

O arquivo afirma, em nove asserções, que os validadores normalizam com `urlNormalizer.normalizeForCache` (`PdfValidator.test.js:84`, `:109-110`, `:257-259`) e que o resultado é minúsculo (`:275`: `expect(result.normalizedPath).toBe('assets/coladultos/001.pdf')`). **Os três validadores já migraram para `PdfPathManager.normalizeForStorage`**, que preserva caixa e acento. Confirme:

```bash
cd "$(git rev-parse --show-toplevel)" && grep -n "normalizeForStorage\|normalizeForCache" \
  src/lib/offline/validation/CacheValidator.js \
  src/lib/offline/validation/IndexValidator.js \
  src/lib/offline/validation/NetworkValidator.js
```

Saída esperada — só uma ocorrência de `normalizeForCache`, e é o bug de `urlNormalizer` não importado:

```
src/lib/offline/validation/CacheValidator.js:51:      const normalizedPath = PdfPathManager.normalizeForStorage(pdfPath);
src/lib/offline/validation/CacheValidator.js:96:        normalizedPath: PdfPathManager.normalizeForStorage(pdfPath) || '',
src/lib/offline/validation/IndexValidator.js:41:        normalizedPath: PdfPathManager.normalizeForStorage(pdfPath) || '',
src/lib/offline/validation/IndexValidator.js:51:      const normalizedPath = PdfPathManager.normalizeForStorage(pdfPath);
src/lib/offline/validation/NetworkValidator.js:43:        normalizedPath: urlNormalizer.normalizeForCache(pdfPath) || '',
src/lib/offline/validation/NetworkValidator.js:51:      const normalizedPath = PdfPathManager.normalizeForStorage(pdfPath);
```

O contrato que o arquivo descreve não existe mais, e o que ele afirma como certo (`assets/coladultos/001.pdf`) é exatamente a direção que a Global Constraint deste plano proíbe. Além disso ele depende de `vi.mock` para `$lib/utils/pdfIndex` e para o `CacheStorageAdapter`, mocking de módulo ESM que o `node --test` desta versão não oferece sem flag experimental (medido no Step 9).

**Anote em `NetworkValidator.js:43`:** `urlNormalizer` não está importado nesse arquivo (os imports estão em `:6-8`). A linha lança `ReferenceError` no ramo "offline". Isto é um bug real, mas corrigi-lo **muda comportamento** e esta fase não muda comportamento nenhum — leve o achado para a Fase 1.

```bash
git rm src/lib/offline/validation/PdfValidator.test.js
```

- [ ] **Step 9: Apagar os dois testes de `louvores.js` — nenhum caminho sem vitest**

`src/lib/stores/louvores.checksum.test.js` e `src/lib/stores/louvores.versioning.test.js` testam `src/lib/stores/louvores.js` usando **cinco** `vi.mock` cada (`$app/environment`, `$lib/utils/swRegistration`, `$lib/utils/louvorSearch`, `$lib/utils/pdfIndex`, `$lib/stores/offline.js`, mais `$lib/utils/appSnackbar.js` no segundo). Converter exige três coisas que não existem:

1. **Mocking de módulo ESM.** O `node --test` tem `mock.module`, mas ele é experimental e some sem a flag. Meça:

```bash
cd "$(git rev-parse --show-toplevel)" && node --input-type=module -e "
import { mock } from 'node:test';
console.log(typeof mock.module);
"
```

Saída esperada: `undefined`. (Com `--experimental-test-module-mocks` ele vira `function`, mas a Global Constraint deste plano é rodar `npm test` sem flags experimentais, e o resto do problema continua de pé.)

2. **Resolução dos aliases do SvelteKit.** `louvores.js:2` importa `$app/environment`, que não é um pacote. Um *resolve hook* resolveria `$lib/`, mas o arquivo também importa sem extensão (`louvores.js:3`: `from '$lib/utils/swRegistration'`), o que obrigaria o hook a adivinhar extensão — reconstruir meio Vite para rodar dois arquivos de teste.

3. **Instalar vitest**, que a Global Constraint proíbe.

**O que se perde, exatamente.** Estes dois arquivos **nunca rodaram uma vez** — não há proteção sendo removida, só intenção documentada. As decisões *puras* que eles cobrem (não buscar checksum quando offline, não buscar sem baseline, respeitar a janela de 24 h, o backoff de 1–2–4–8–16 min) continuam cobertas pelo `louvoresManifestChecksum.test.js` convertido no Step 6, porque vivem em `src/lib/utils/louvoresManifestChecksum.js`. O que fica sem teste automatizado é a **orquestração** dentro de `louvores.js:428-509` e `:251-330`. Registre estes cinco casos na lista de verificação manual do plano:

| # | Caso | Como verificar no navegador |
|---|---|---|
| M-1 | Checksum igual ao local | Com `plpcjf:louvores:manifestBodySha256` gravado e `checksumLastOkAt` com mais de 24 h, recarregue: a aba Network mostra **um** GET de `/louvores-manifest.sha256` e **nenhum** de `/louvores-manifest.json` |
| M-2 | Checksum diferente e corpo confere | Publique um manifesto novo: o app baixa `/louvores-manifest.json` com `cache: 'no-store'`, limpa o manifesto do cache do SW e a lista na tela muda |
| M-3 | Checksum diferente e corpo **não** confere | Sirva um `/louvores-manifest.sha256` que não bate com o corpo: a lista na tela **não pode** mudar |
| M-4 | Resposta 204 no checksum | Nada acontece, nenhum download de manifesto |
| M-5 | Offline | Nenhuma requisição de checksum é feita |

Se alguém quiser essa cobertura de volta como teste, o caminho é uma tarefa futura que extraia a orquestração de `louvores.js` para um módulo puro que receba `fetch` por parâmetro — não está no escopo deste plano.

```bash
git rm src/lib/stores/louvores.checksum.test.js src/lib/stores/louvores.versioning.test.js
```

- [ ] **Step 10: Ver tudo verde e nenhum arquivo de fora**

```bash
npm test 2>&1 | tail -10
```

Saída esperada:

```
ℹ tests 151
ℹ suites 33
ℹ pass 151
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

(`tests` é `131` de antes `+ 16` do `PdfPathManager` `+ 4` do checksum. O número de `suites` varia com quantos `describe` aninhados você usou; o que tem de bater é `fail 0`.)

Agora repita o Step 1. Saída esperada:

```
arquivos *.test.js em src/ : 15
arquivos no script test    : 0
nunca executados:
```

`arquivos no script test : 0` é o resultado correto: não há mais lista, há um glob. E a lista de "nunca executados" está vazia.

```bash
npm run build
```

Saída esperada: build conclui (`✓ built in …`). Este passo importa porque o Step 4 mexeu num módulo de produção.

- [ ] **Step 11: Commit**

```bash
git add package.json \
        src/lib/offline/utils/PdfPathManager.js \
        src/lib/offline/utils/PdfPathManager.test.js \
        src/lib/utils/louvoresManifestChecksum.test.js
git commit -m "test: descobrir os testes por glob e ressuscitar os seis que nenhum runner abria (#24)"
```

---

### Task 2: Contrato executável da normalização de caminho (#24, preparação de #22)

Existem duas funções que transformam um caminho de PDF numa chave, e elas discordam. `normalizePdfUrl` (`src/lib/utils/pathUtils.js:161-207`) baixa a caixa e troca acentos por letras sem acento; `PdfPathManager.normalizeForStorage` (`src/lib/offline/utils/PdfPathManager.js:23-65`) preserva as duas coisas. Sobre os **4629 caminhos reais** do acervo, elas divergem em **4629** — cem por cento, porque todo caminho tem pelo menos uma maiúscula. As chaves dos PDFs que o usuário já baixou estão gravadas na convenção da segunda. A Fase 1 vai apagar a primeira; antes disso, é preciso um teste que diga, com dados reais, o que cada uma faz **hoje**.

Este é um teste de **caracterização**: ele congela o comportamento atual sem afirmar que ele é o certo. Vários dos casos que ele grava são bugs — que `normalizePdfUrl` destrói um nome de arquivo que é Base64, que ela não trata acentos em forma decomposta, que as duas produzem espaços de nomes disjuntos. Gravá-los é o ponto: quando as Tarefas 5 a 9 mexerem nessas funções, o diff do teste vai mostrar exatamente o que mudou. O `louvores-manifest.json` (raiz do repo, 4629 entradas) **não é versionado** e não pode virar fixture: o teste tem de rodar em qualquer clone. Por isso um script determinístico extrai dele uma fixture pequena — 42 caminhos, versionada — que cobre as classes perigosas.

Sucesso = a fixture existe no git, um teste `node --test` a percorre e passa, e quando o manifesto real está presente na raiz o mesmo teste roda também sobre os 4629 caminhos.

**Coordenação com a Tarefa 5**, que já está escrita e também cria fixture: a Tarefa 5 cria `src/lib/offline/utils/PdfPathManager.encoder.test.js` com três caminhos **embutidos no próprio arquivo de teste** e uma varredura opcional do manifesto, e o assunto dela é o **codificador de URL** (`encodeURI` × parser `URL`). Esta tarefa cria um arquivo diferente, com assunto diferente (as duas **normalizações de caminho**), e é a dona da fixture versionada. Não há duplicação e não há conflito: nenhum arquivo é tocado pelas duas. Se ao executar a Tarefa 5 você achar mais limpo fazer o `encoder.test.js` ler a fixture desta tarefa em vez dos três caminhos embutidos, pode — a fixture já estará no git, e o grupo `colchetes` mais o `nfd` contêm os três.

**Files:**
- Create: `scripts/gerar-fixture-caminhos.mjs`
- Create: `src/lib/utils/fixtures/caminhos-acervo.json` (gerado pelo script, **versionado**)
- Create: `src/lib/utils/normalizacaoCaminho.contrato.test.js`

**Interfaces:**
- Consumes: `PdfPathManager` importável sob `node --test` (Tarefa 1, Step 4) e o `npm test` por glob (Tarefa 1, Step 3) — este teste roda sem ninguém registrá-lo em lugar nenhum.
- Produces:
  - `src/lib/utils/fixtures/caminhos-acervo.json` — `{ totalNoAcervo: number, nomesDeArquivoRepetidos: number, grupos: Record<string, string[]> }`, com os grupos `nfd`, `colchetes`, `base64NoNome`, `acentoECedilha`, `basenameRepetido`, `zeroAEsquerda`, `parenteses`, `pontuacaoRara`, `amostraUniforme`. **Caminhos relativos com prefixo `assets/`, caixa e acento como estão no `pdfId`.** As Tarefas 5, 6 e 7 podem ler esta fixture.
  - `node scripts/gerar-fixture-caminhos.mjs` — regenera a fixture a partir do manifesto real. Determinístico: mesma entrada, mesma saída byte a byte.
  - O contrato congelado. **As Tarefas 6 e 7 vão quebrar asserções deste arquivo de propósito** — cada uma dessas asserções está marcada com um comentário `// ⚠︎ Tarefa N muda isto`. Quebrar uma delas sem que a tarefa correspondente diga que ia quebrar é regressão.

- [ ] **Step 1: Confirmar que o manifesto real está na raiz e ver o que ele tem**

Sem `louvores-manifest.json` você não consegue gerar a fixture. Ele não é versionado; peça-o ao dono do projeto se não estiver lá.

```bash
cd "$(git rev-parse --show-toplevel)" && node -e "
const fs=require('fs');
if(!fs.existsSync('louvores-manifest.json')){console.error('louvores-manifest.json ausente na raiz — peça ao dono do projeto'); process.exit(1);}
const m=JSON.parse(fs.readFileSync('louvores-manifest.json','utf8'));
const paths=m.map(l=>{let p=Buffer.from(l.pdfId,'base64').toString('utf8').replace(/^\/+/,'').trim();
  if(!p.toLowerCase().startsWith('assets/'))p='assets/'+p; return p;});
const base=p=>p.split('/').pop();
const c={}; for(const p of paths){const b=base(p); c[b]=(c[b]||0)+1;}
console.log('caminhos                      :', paths.length);
console.log('em NFD                        :', paths.filter(p=>p!==p.normalize('NFC')).length);
console.log('com colchetes                 :', paths.filter(p=>p.includes('[')).length);
console.log('nome de arquivo em Base64     :', paths.filter(p=>/^[A-Za-z0-9+/]{24,}={0,2}\.pdf\$/.test(base(p))).length);
console.log('partilham nome de arquivo     :', paths.filter(p=>c[base(p)]>1).length);
console.log('chamados Cifra I.pdf          :', c['Cifra I.pdf']);
console.log('com # ? ou %                  :', paths.filter(p=>/[#?%]/.test(p)).length);
"
```

Saída esperada, exatamente:

```
caminhos                      : 4629
em NFD                        : 8
com colchetes                 : 3
nome de arquivo em Base64     : 621
partilham nome de arquivo     : 3311
chamados Cifra I.pdf          : 1036
com # ? ou %                  : 0
```

Os `3311` e os `1036` são a razão de a fixture ter um grupo de nomes repetidos: qualquer correspondência por nome de arquivo acerta o PDF errado.

- [ ] **Step 2: Escrever o gerador da fixture**

Crie `scripts/gerar-fixture-caminhos.mjs`:

```js
/**
 * Extrai uma fixture pequena e versionada de caminhos reais do acervo.
 *
 * O louvores-manifest.json (raiz do repo, ~4629 entradas) NÃO é versionado, e o
 * teste de caracterização precisa rodar em qualquer clone. Este script escolhe
 * um punhado de caminhos que cobrem as classes perigosas e grava o resultado em
 * src/lib/utils/fixtures/caminhos-acervo.json, que VAI para o git.
 *
 * Determinístico: ordena tudo antes de escolher, e escolhe sempre os primeiros
 * de cada classe. Mesma entrada, mesma saída byte a byte.
 *
 * Uso: node scripts/gerar-fixture-caminhos.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const MANIFESTO = 'louvores-manifest.json';
const SAIDA = 'src/lib/utils/fixtures/caminhos-acervo.json';

if (!fs.existsSync(MANIFESTO)) {
  console.error(`${MANIFESTO} não encontrado na raiz do repo. Peça-o ao dono do projeto.`);
  process.exit(1);
}

/** Replica computePdfRelPath (src/lib/utils/pathUtils.js:41-80) sem depender do Vite. */
function caminhoDoPdfId(pdfId) {
  let p = Buffer.from(pdfId, 'base64').toString('utf8').replace(/^\/+/, '').trim();
  if (!p.toLowerCase().startsWith('assets/')) p = `assets/${p}`;
  return p;
}

const dados = JSON.parse(fs.readFileSync(MANIFESTO, 'utf8'));
const caminhos = dados.map((l) => caminhoDoPdfId(l.pdfId)).sort();
const nomeArquivo = (p) => p.split('/').pop();

const repetidos = {};
for (const p of caminhos) {
  const b = nomeArquivo(p);
  repetidos[b] = (repetidos[b] || 0) + 1;
}

const primeiros = (predicado, n) => caminhos.filter(predicado).slice(0, n);

const grupos = {
  // Acento em forma decomposta: 'é' como 'e' + U+0301. normalizePdfUrl não os trata.
  nfd: caminhos.filter((p) => p !== p.normalize('NFC')),
  // encodeURI escapa [ e ]; o parser da URL não. É a divergência da Tarefa 5.
  colchetes: caminhos.filter((p) => p.includes('[')),
  // Nome de arquivo que é ele próprio Base64 — e Base64 é sensível à caixa.
  base64NoNome: primeiros((p) => /^[A-Za-z0-9+/]{24,}={0,2}\.pdf$/.test(nomeArquivo(p)), 3),
  acentoECedilha: primeiros((p) => /ç/.test(p) && /[áàãâéêíóôõú]/.test(p), 4),
  // Mesmo nome de arquivo, diretórios diferentes: 1036 caminhos se chamam 'Cifra I.pdf'.
  basenameRepetido: primeiros((p) => nomeArquivo(p) === 'Cifra I.pdf', 4),
  zeroAEsquerda: primeiros((p) => /\/0\d+\.pdf$/.test(p), 3),
  parenteses: primeiros((p) => p.includes('(') && p.includes(')'), 3),
  pontuacaoRara: [
    ...primeiros((p) => p.includes('’'), 1),
    ...primeiros((p) => p.includes('º'), 1),
    ...primeiros((p) => p.includes('&'), 1),
    ...primeiros((p) => p.includes('!'), 1),
    ...primeiros((p) => p.includes(','), 1)
  ],
  amostraUniforme: Array.from({ length: 12 }, (_, i) =>
    caminhos[Math.floor((i * caminhos.length) / 12)]
  )
};

// Um caminho só aparece uma vez, no primeiro grupo que o reivindicar.
const vistos = new Set();
for (const nome of Object.keys(grupos)) {
  grupos[nome] = grupos[nome].filter((p) => {
    if (vistos.has(p)) return false;
    vistos.add(p);
    return true;
  });
}

const fixture = {
  _comentario:
    'Gerado por scripts/gerar-fixture-caminhos.mjs a partir do louvores-manifest.json real. Não editar à mão.',
  totalNoAcervo: caminhos.length,
  nomesDeArquivoRepetidos: Object.values(repetidos).filter((n) => n > 1).length,
  grupos
};

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');

const total = Object.values(grupos).reduce((s, g) => s + g.length, 0);
console.log(`${SAIDA}: ${total} caminhos em ${Object.keys(grupos).length} grupos`);
for (const [nome, g] of Object.entries(grupos)) console.log(`  ${nome}: ${g.length}`);
```

```bash
cd "$(git rev-parse --show-toplevel)" && node scripts/gerar-fixture-caminhos.mjs
```

Saída esperada, exatamente:

```
src/lib/utils/fixtures/caminhos-acervo.json: 42 caminhos em 9 grupos
  nfd: 8
  colchetes: 2
  base64NoNome: 3
  acentoECedilha: 4
  basenameRepetido: 4
  zeroAEsquerda: 3
  parenteses: 3
  pontuacaoRara: 4
  amostraUniforme: 11
```

`colchetes: 2` e não 3 é correto: o terceiro caminho com colchetes (`assets/PES/Ó profundidade das riquezas - Vocal [20 03 2026].pdf`) está **também** em NFD e o grupo `nfd` o reivindicou primeiro. Ele exercita as duas correções ao mesmo tempo. `pontuacaoRara: 4` e `amostraUniforme: 11` pela mesma razão de deduplicação.

Confira que a fixture ficou legível e com os caminhos certos:

```bash
cd "$(git rev-parse --show-toplevel)" && head -20 src/lib/utils/fixtures/caminhos-acervo.json
```

Saída esperada:

```json
{
  "_comentario": "Gerado por scripts/gerar-fixture-caminhos.mjs a partir do louvores-manifest.json real. Não editar à mão.",
  "totalNoAcervo": 4629,
  "nomesDeArquivoRepetidos": 431,
  "grupos": {
    "nfd": [
      "assets/05042026/A Obra do Senhor é Perfeita/Coro.pdf",
      "assets/05042026/Bênção Aarônica (Bênção Apostólica)/Coro.pdf",
      "assets/05042026/Tabernáculo/Coro.pdf",
      "assets/30102025/A ORAÇÃO DA TUA IGREJA - Coro.pdf",
      "assets/30102025/Preciosa graça de Jesus (T&F V) - Vocal -16 10 2025-.pdf",
      "assets/Avulsos Diversos/Ao Único.pdf",
      "assets/PES/Alto preço - CIFRA.pdf",
      "assets/PES/Ó profundidade das riquezas - Vocal [20 03 2026].pdf"
    ],
    "colchetes": [
      "assets/30102025/Sobe aqui [26-07-2025] - Coro.pdf",
      "assets/PES/Perante a tua grandeza - Vocal [06 02 2025].pdf"
    ],
```

Rode o gerador uma segunda vez e confirme que o arquivo não mudou — é a prova de que é determinístico:

```bash
cd "$(git rev-parse --show-toplevel)" && node scripts/gerar-fixture-caminhos.mjs >/dev/null && git status --porcelain src/lib/utils/fixtures/caminhos-acervo.json
```

Saída esperada (segunda execução, arquivo ainda não commitado): `?? src/lib/utils/fixtures/caminhos-acervo.json` — e nada mais. Depois do commit do Step 6, a mesma linha vira vazia.

- [ ] **Step 3: Teste que falha — o contrato ainda não existe**

Crie `src/lib/utils/normalizacaoCaminho.contrato.test.js`:

```js
/**
 * Contrato executável das DUAS normalizações de caminho de PDF (#24, prepara #22).
 *
 * Isto é um teste de CARACTERIZAÇÃO: ele grava o que o código faz hoje, não o
 * que deveria fazer. Vários casos abaixo são bugs conhecidos e estão marcados
 * como tal. Quando as Tarefas 5-9 mexerem nessas funções, o diff deste arquivo
 * é a lista exata do que mudou.
 *
 * Run: node --test src/lib/utils/normalizacaoCaminho.contrato.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizePdfUrl } from './pathUtils.js';
import PdfPathManager from '../offline/utils/PdfPathManager.js';

const fixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/caminhos-acervo.json', import.meta.url), 'utf8')
);

const G = fixture.grupos;
/** Os 42 caminhos da fixture, em ordem estável. */
const TODOS = Object.values(G).flat();

const paraArmazenamento = (p) => PdfPathManager.normalizeForStorage(p);

describe('as duas normalizações são espaços de nomes disjuntos', () => {
  it('a fixture tem 42 caminhos em 9 grupos', () => {
    assert.equal(TODOS.length, 42);
    assert.equal(Object.keys(G).length, 9);
    assert.equal(fixture.totalNoAcervo, 4629);
  });

  it('todos os 42 caminhos divergem entre as duas funções', () => {
    // É o achado #22 em miniatura: no acervo inteiro são 4629 de 4629.
    const divergentes = TODOS.filter((p) => normalizePdfUrl(p) !== paraArmazenamento(p));
    assert.equal(divergentes.length, TODOS.length);
  });

  it('nenhuma das duas perde informação a ponto de colidir', () => {
    assert.equal(new Set(TODOS.map(normalizePdfUrl)).size, TODOS.length);
    assert.equal(new Set(TODOS.map(paraArmazenamento)).size, TODOS.length);
  });

  it('as duas são idempotentes', () => {
    for (const p of TODOS) {
      assert.equal(normalizePdfUrl(normalizePdfUrl(p)), normalizePdfUrl(p));
      assert.equal(paraArmazenamento(paraArmazenamento(p)), paraArmazenamento(p));
    }
  });
});

describe('normalizeForStorage — a normalização vencedora', () => {
  it('devolve o caminho do acervo inalterado', () => {
    // Todo caminho do manifesto já está na forma canônica desta função. É por
    // isso que unificar nesta direção não invalida nenhuma chave já gravada.
    // ⚠︎ Tarefa 6 muda isto para o grupo `nfd`: com .normalize('NFC'), os oito
    // caminhos decompostos passam a sair recompostos, diferentes da entrada.
    for (const p of TODOS) {
      assert.equal(paraArmazenamento(p), p, `mudou: ${p}`);
    }
  });

  it('preserva o nome de arquivo em Base64 byte a byte', () => {
    const p = G.base64NoNome[0];
    assert.equal(
      paraArmazenamento(p),
      'assets/Adicionados/QWRpY2lvbmFkb3MvQ29tIG11aXRvIGxvdXZvci9DaWZyYS5wZGY=.pdf'
    );
  });

  it('hoje NÃO unifica as duas formas Unicode do mesmo acento', () => {
    // ⚠︎ Tarefa 6 muda isto: depois dela as duas formas dão a mesma chave.
    for (const nfd of G.nfd) {
      assert.notEqual(paraArmazenamento(nfd), paraArmazenamento(nfd.normalize('NFC')));
    }
  });

  it('caminhos com o mesmo nome de arquivo continuam sendo chaves distintas', () => {
    assert.equal(G.basenameRepetido.length, 4);
    assert.equal(new Set(G.basenameRepetido.map(paraArmazenamento)).size, 4);
  });
});

describe('normalizePdfUrl — a normalização perdedora', () => {
  it('baixa a caixa e tira o acento pré-composto', () => {
    assert.equal(
      normalizePdfUrl('assets/06112025/Há Esperança/Cifra.pdf'),
      'assets/06112025/ha esperanca/cifra.pdf'
    );
  });

  it('destrói um nome de arquivo que é Base64 (bug real, entrada real)', () => {
    // Base64 é sensível à caixa; a saída não decodifica de volta.
    assert.equal(
      normalizePdfUrl(G.base64NoNome[0]),
      'assets/adicionados/qwrpy2lvbmfkb3mvq29tig11axrvigxvdxzvci9dawzyys5wzgy=.pdf'
    );
  });

  it('não trata acento em forma decomposta (bug real, 8 caminhos do acervo)', () => {
    // normalizeAccents (pathUtils.js:121-142) é um mapa de caracteres
    // pré-compostos e não chama normalize(). O acento decomposto sobrevive.
    const nfd = 'assets/05042026/A Obra do Senhor é Perfeita/Coro.pdf'.normalize('NFD');
    assert.equal(normalizePdfUrl(nfd), 'assets/05042026/a obra do senhor é perfeita/coro.pdf');
    assert.equal(
      normalizePdfUrl(nfd.normalize('NFC')),
      'assets/05042026/a obra do senhor e perfeita/coro.pdf'
    );
    assert.notEqual(normalizePdfUrl(nfd), normalizePdfUrl(nfd.normalize('NFC')));
  });

  it('caminhos com o mesmo nome de arquivo continuam sendo chaves distintas', () => {
    assert.equal(new Set(G.basenameRepetido.map(normalizePdfUrl)).size, 4);
  });
});

describe('varredura do acervo inteiro (só quando o manifesto está na raiz)', () => {
  const MANIFESTO = 'louvores-manifest.json';

  it('4629 caminhos, 4629 divergências, 0 colisões em cada função', () => {
    if (!fs.existsSync(MANIFESTO)) return; // manifesto não é versionado
    const caminhos = caminhosDoManifesto(MANIFESTO);
    assert.equal(caminhos.length, 4629);
    const divergentes = caminhos.filter((p) => normalizePdfUrl(p) !== paraArmazenamento(p));
    assert.equal(divergentes.length, 4629);
    assert.equal(new Set(caminhos.map(normalizePdfUrl)).size, 4629);
    assert.equal(new Set(caminhos.map(paraArmazenamento)).size, 4629);
  });

  it('a fixture só contém caminhos que existem mesmo no acervo', () => {
    if (!fs.existsSync(MANIFESTO)) return;
    const doAcervo = new Set(caminhosDoManifesto(MANIFESTO));
    for (const p of TODOS) assert.ok(doAcervo.has(p), `fora do acervo: ${p}`);
  });
});

/** @param {string} arquivo */
function caminhosDoManifesto(arquivo) {
  const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  return dados.map((/** @type {{pdfId: string}} */ l) => {
    let p = Buffer.from(l.pdfId, 'base64').toString('utf8').replace(/^\/+/, '').trim();
    if (!p.toLowerCase().startsWith('assets/')) p = `assets/${p}`;
    return p;
  });
}
```

Antes de rodar o teste completo, prove que ele **falha** sem a fixture — é o vermelho desta tarefa:

```bash
cd "$(git rev-parse --show-toplevel)" && mv src/lib/utils/fixtures/caminhos-acervo.json /tmp/fixture.bak && node --test src/lib/utils/normalizacaoCaminho.contrato.test.js 2>&1 | head -5
```

Saída esperada: erro de carregamento do arquivo, `ENOENT: no such file or directory, open '…/fixtures/caminhos-acervo.json'`.

Devolva a fixture:

```bash
cd "$(git rev-parse --show-toplevel)" && mv /tmp/fixture.bak src/lib/utils/fixtures/caminhos-acervo.json
```

- [ ] **Step 4: Ver o contrato passar**

```bash
cd "$(git rev-parse --show-toplevel)" && node --test src/lib/utils/normalizacaoCaminho.contrato.test.js 2>&1 | tail -8
```

Saída esperada: `ℹ tests 13`, `ℹ pass 13`, `ℹ fail 0`.

Se `4629 caminhos, 4629 divergências` falhar dizendo que o total é outro número, o manifesto na sua raiz é mais novo que este plano. Não conserte o teste baixando a asserção: **regenere a fixture** (Step 2), atualize os números deste arquivo e do Step 1, e anote o número novo no commit — todas as tarefas seguintes citam 4629.

- [ ] **Step 5: Confirmar que a fixture não entra no build e o `npm test` a inclui sozinho**

A fixture é um `.json` dentro de `src/`, mas nenhum módulo da aplicação a importa — só o teste. Ela não pode acabar no bundle nem em `static/`.

```bash
cd "$(git rev-parse --show-toplevel)" && grep -rn "caminhos-acervo" src --include='*.js' --include='*.svelte' | grep -v '\.test\.js' ; echo "---"; npm run build >/dev/null 2>&1 && grep -rl "caminhos-acervo" .svelte-kit/output 2>/dev/null | head; echo "fim"
```

Saída esperada: nada entre o `---` e o `fim` — nenhum módulo de produção a importa e nada dela aparece na saída do build.

```bash
npm test 2>&1 | tail -8
```

Saída esperada: `ℹ tests 164`, `ℹ fail 0` (os 151 da Tarefa 1 mais os 13 deste arquivo). O teste novo apareceu sozinho, porque o `npm test` é um glob desde a Tarefa 1.

- [ ] **Step 6: Commit**

```bash
git add scripts/gerar-fixture-caminhos.mjs \
        src/lib/utils/fixtures/caminhos-acervo.json \
        src/lib/utils/normalizacaoCaminho.contrato.test.js
git commit -m "test(pdf): congelar em teste o comportamento das duas normalizacoes de caminho (#24)"
```

---

### Task 3: Contrato executável da camada de URL e do compartilhamento (preparação de #21)

**Esta é a tarefa mais importante do plano.** Não existe hoje um único teste automatizado da camada de URL — nenhum dos quinze arquivos de teste toca `urlSync`, `filters`, `classificationFilters`, `pdfViewer`, `playlistUtils` ou as páginas. E é essa camada que decide se um link de playlist mandado no WhatsApp continua abrindo a playlist certa. O link de compartilhamento é **autocontido**: ele carrega os `pdfId` inteiros na query string (`src/lib/utils/playlistUtils.js:56-61`), sem servidor e sem encurtador. Se a reescrita da Fase 3 mudar como esses valores são lidos, todo link já enviado morre em silêncio — o carrossel abre vazio e ninguém recebe um erro.

Há um obstáculo concreto: `parseUrlParams` e `updateUrlParams` vivem em `src/lib/utils/urlSync.js`, que importa `$app/navigation` e `$app/stores` (`:1-2`). Esses módulos só existem dentro do SvelteKit — o arquivo **não carrega sob `node --test`**, e por isso a camada nunca pôde ser testada. Lendo o arquivo, a separação é limpa: das 199 linhas, só três dependem do framework (`get(page)` em `:85` e o `goto` em `:197-201`); as outras 196 são cálculo puro sobre strings. Esta tarefa move o cálculo para um módulo sem framework, `src/lib/utils/urlParams.js`, e deixa `urlSync.js` como casca fina que continua exportando exatamente as mesmas funções para os dezenove pontos de uso — **nenhum call site muda**. É refatoração pura: mesma entrada, mesma saída, mesma navegação.

Sobre o módulo puro, traduza em teste os casos C1-C14, F1-F18, P1-P16, L1-L7, R1-R6 e D1-D9 da seção 5 do relatório `docs/superpowers/investigacao/2026-08-31-url-estado.md`. Uma parte deles **não é observável numa função pura** — depende de blocos reativos do Svelte, de `localStorage`, de timers ou de navegação. Esses não são fingidos de teste: vão para a lista de verificação manual no fim da tarefa, com o passo a passo de como conferir cada um no navegador. Sucesso = todo caso da seção 5 está ou num teste que roda, ou na lista manual, e nenhum ficou sem destino.

**Files:**
- Create: `src/lib/utils/urlParams.js`
- Create: `src/lib/utils/urlParams.test.js`
- Create: `src/lib/utils/playlistShare.contrato.test.js`
- Modify: `src/lib/utils/urlSync.js` (199 linhas → casca de ~40)

**Interfaces:**
- Consumes: `npm test` por glob (Tarefa 1) — os dois testes novos rodam sem registro.
- Produces, de `src/lib/utils/urlParams.js` (**módulo sem nenhum import de framework**):
  - `serializeArrayParam(array: string[]): string` — junta com vírgula; `[]` vira `''`. Movida de `urlSync.js:13-18` sem mudança.
  - `deserializeArrayParam(param: string): string[]` — `split(',')` + `trim()` por item + `filter(Boolean)`. Movida de `urlSync.js:34-39` sem mudança. **A Tarefa 4 muda o corpo desta função** (tira o decode a mais) preservando `trim` e `filter`.
  - `parseUrlParams(url: URL): { materiais: string[], arranjo: string[], arranjoEspecial: string[], comoAbrir: string, pesquisa: string, ordenar: string, itensPorPagina: number | null, pagina: number | null }` — movida de `urlSync.js:46-67`. **Atenção**: `itensPorPagina` e `pagina` devolvem `NaN`, não `null`, quando o valor não é numérico (`'abc'` é *truthy*). É contrato de hoje e está no teste.
  - `construirQueryAtualizada(searchAtual: string, newParams: object, options?: { defaultMateriais?: string[], defaultComoAbrir?: string }): string` — **nova**, é o corpo de `updateUrlParams` (`urlSync.js:91-194`) sem o `goto`. Recebe a query atual (com ou sem `?`) e devolve a query nova **sem** `?`. Preserva todo parâmetro que `newParams` não cita.
- Produces, de `src/lib/utils/urlSync.js` (casca): `serializeArrayParam`, `deserializeArrayParam`, `parseUrlParams` reexportadas, e `updateUrlParams(newParams, options)` com **a assinatura de hoje, inalterada**. A Tarefa 4 acrescenta a guarda de rota aqui.

- [ ] **Step 1: Provar que a camada de URL não tem teste nenhum e não carrega fora do Vite**

```bash
cd "$(git rev-parse --show-toplevel)" && echo "--- testes que tocam a camada de URL ---" && grep -rln "urlSync\|urlParams\|playlistUtils\|classificationFilters" --include='*.test.js' src ; echo "--- fim ---" && node --input-type=module -e "await import('./src/lib/utils/urlSync.js');" 2>&1 | grep -E "Cannot find|Error" | head -2
```

Saída esperada:

```
--- testes que tocam a camada de URL ---
--- fim ---
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '$app' imported from /Volumes/SSD 2TB SD/dev/plpcjf/src/lib/utils/urlSync.js
```

Nenhuma linha entre os dois marcadores: zero cobertura. E o motivo estrutural, na linha seguinte.

- [ ] **Step 2: Teste que falha — o módulo puro ainda não existe**

Crie `src/lib/utils/urlParams.test.js`. Cada `it` traz o código do caso da seção 5 do relatório no nome, para que a rastreabilidade seja mecânica.

```js
/**
 * Contrato de compatibilidade da camada de URL (prepara #21).
 *
 * Cada caso corresponde a uma linha da seção 5 de
 * docs/superpowers/investigacao/2026-08-31-url-estado.md. Isto é
 * CARACTERIZAÇÃO: grava o que o app faz hoje. Os casos marcados com ⚠︎ no
 * relatório são comportamentos discutíveis que as Tarefas 10-12 vão decidir —
 * quando decidirem, o teste correspondente muda junto, de propósito.
 *
 * Run: node --test src/lib/utils/urlParams.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeArrayParam,
  deserializeArrayParam,
  parseUrlParams,
  construirQueryAtualizada
} from './urlParams.js';

/** As três categorias de material (src/lib/stores/filters.js:6). */
const CATEGORIAS = ['Partitura', 'Cifra', 'Gestos em Gravura'];
/** Os cinco arranjos (relatório §1.3). */
const ARRANJOS = ['Avulsos Diversos', 'Coletânea Adultos', 'Coletânea CIAs', 'PES', 'PES CIAs'];

/** @param {string} caminhoEQuery */
const url = (caminhoEQuery) => new URL(caminhoEQuery, 'https://plpcg.com');

describe('§5.2 filtros e busca — links que já circulam', () => {
  it('F1: o arranjo=<5 valores> que o app grava sozinho na barra de endereços', () => {
    const u = url(
      '/?arranjo=Avulsos+Diversos%2CColet%C3%A2nea+Adultos%2CColet%C3%A2nea+CIAs%2CPES%2CPES+CIAs'
    );
    assert.deepEqual(parseUrlParams(u).arranjo, ARRANJOS);
  });

  it('F1 (volta): escrever os 5 arranjos reproduz exatamente esse link', () => {
    assert.equal(
      construirQueryAtualizada('', { arranjo: ARRANJOS }),
      'arranjo=Avulsos+Diversos%2CColet%C3%A2nea+Adultos%2CColet%C3%A2nea+CIAs%2CPES%2CPES+CIAs'
    );
  });

  it('F2: vírgula e espaço crus, digitados à mão', () => {
    assert.deepEqual(parseUrlParams(url('/?arranjo=PES,PES CIAs')).arranjo, ['PES', 'PES CIAs']);
    assert.deepEqual(parseUrlParams(url('/?arranjo=PES,PES+CIAs')).arranjo, ['PES', 'PES CIAs']);
    assert.deepEqual(parseUrlParams(url('/?arranjo=PES,PES%20CIAs')).arranjo, ['PES', 'PES CIAs']);
  });

  it('F3: espaço em borda e item vazio são tolerados', () => {
    // trim() por item + filter(Boolean). Comportamento a PRESERVAR na Tarefa 4.
    assert.deepEqual(parseUrlParams(url('/?arranjo=%20PES%20,,PES%20CIAs%20')).arranjo, [
      'PES',
      'PES CIAs'
    ]);
  });

  it('F4/F5: materiais aceita um ou vários, e a ordem da URL é irrelevante na leitura', () => {
    assert.deepEqual(parseUrlParams(url('/?materiais=Cifra')).materiais, ['Cifra']);
    assert.deepEqual(parseUrlParams(url('/?materiais=Cifra,Partitura')).materiais, [
      'Cifra',
      'Partitura'
    ]);
    assert.deepEqual(parseUrlParams(url('/?materiais=Partitura,Cifra')).materiais, [
      'Partitura',
      'Cifra'
    ]);
  });

  it('F6: os três materiais são aceitos na leitura e nunca produzidos na escrita', () => {
    assert.deepEqual(parseUrlParams(url('/?materiais=Partitura,Cifra,Gestos em Gravura')).materiais, CATEGORIAS);
    assert.equal(construirQueryAtualizada('', { materiais: CATEGORIAS }, { defaultMateriais: CATEGORIAS }), '');
  });

  it('F7: materiais= vazio devolve lista vazia', () => {
    // ⚠︎ na página isso vira zero resultados. Aqui só se grava o parse.
    assert.deepEqual(parseUrlParams(url('/?materiais=')).materiais, []);
  });

  it('F8: arranjo= vazio devolve lista vazia', () => {
    assert.deepEqual(parseUrlParams(url('/?arranjo=')).arranjo, []);
  });

  it('F9/F10/F11: os cinco modos de comoAbrir sobrevivem ao round-trip', () => {
    for (const modo of ['leitor', 'online', 'newtab', 'share', 'save']) {
      assert.equal(parseUrlParams(url(`/?comoAbrir=${modo}`)).comoAbrir, modo);
    }
    // O default é apagado da URL; os outros quatro são gravados.
    assert.equal(construirQueryAtualizada('', { comoAbrir: 'leitor' }, { defaultComoAbrir: 'leitor' }), '');
    assert.equal(construirQueryAtualizada('', { comoAbrir: 'newtab' }, { defaultComoAbrir: 'leitor' }), 'comoAbrir=newtab');
  });

  it('F12: comoAbrir inválido é devolvido cru e permanece na URL', () => {
    // ⚠︎ D-9 decide normalizar isto na próxima escrita; hoje o param fica pendurado.
    assert.equal(parseUrlParams(url('/?comoAbrir=lixo')).comoAbrir, 'lixo');
    assert.equal(construirQueryAtualizada('?comoAbrir=lixo', { pesquisa: 'x' }), 'comoAbrir=lixo&pesquisa=x');
  });

  it('F13/F14/F15: pesquisa textual, numérica e acentuada', () => {
    assert.equal(parseUrlParams(url('/?pesquisa=amor')).pesquisa, 'amor');
    assert.equal(parseUrlParams(url('/?pesquisa=124')).pesquisa, '124');
    assert.equal(parseUrlParams(url('/?pesquisa=Cora%C3%A7%C3%A3o')).pesquisa, 'Coração');
  });

  it('F16: pesquisa com % não lança e devolve o texto certo', () => {
    assert.equal(parseUrlParams(url('/?pesquisa=100%25')).pesquisa, '100%');
    assert.equal(construirQueryAtualizada('', { pesquisa: '100%' }), 'pesquisa=100%25');
  });

  it('F17: pesquisa= vazio devolve string vazia e a escrita apaga o param', () => {
    assert.equal(parseUrlParams(url('/?pesquisa=')).pesquisa, '');
    assert.equal(construirQueryAtualizada('?pesquisa=amor', { pesquisa: '' }), '');
    assert.equal(construirQueryAtualizada('?pesquisa=amor', { pesquisa: '   ' }), '');
  });

  it('F18: os quatro params ao mesmo tempo', () => {
    const p = parseUrlParams(url('/?pesquisa=amor&arranjo=PES&materiais=Cifra&comoAbrir=newtab'));
    assert.equal(p.pesquisa, 'amor');
    assert.deepEqual(p.arranjo, ['PES']);
    assert.deepEqual(p.materiais, ['Cifra']);
    assert.equal(p.comoAbrir, 'newtab');
  });
});

describe('§5.3 paginação e ordenação', () => {
  it('P1/P5/P6: pagina e itensPorPagina são lidos como número', () => {
    assert.equal(parseUrlParams(url('/?pesquisa=amor&pagina=3')).pagina, 3);
    assert.equal(parseUrlParams(url('/biblioteca?pagina=5')).pagina, 5);
    const p = parseUrlParams(url('/biblioteca?pagina=5&itensPorPagina=25'));
    assert.equal(p.pagina, 5);
    assert.equal(p.itensPorPagina, 25);
  });

  it('P4: pagina=0, -2 e abc — e a armadilha do NaN', () => {
    assert.equal(parseUrlParams(url('/?pagina=0')).pagina, 0);
    assert.equal(parseUrlParams(url('/?pagina=-2')).pagina, -2);
    // 'abc' é truthy, então parseInt roda e devolve NaN — NÃO null.
    // Quem consome tem de blindar com `> 0`. É armadilha de refatoração.
    assert.ok(Number.isNaN(parseUrlParams(url('/?pagina=abc')).pagina));
    assert.equal(parseUrlParams(url('/')).pagina, null);
  });

  it('P2/P3: a escrita apaga pagina quando é 1 ou menor', () => {
    assert.equal(construirQueryAtualizada('', { pagina: 3 }), 'pagina=3');
    assert.equal(construirQueryAtualizada('?pagina=3', { pagina: 1 }), '');
    assert.equal(construirQueryAtualizada('?pagina=3', { pagina: 0 }), '');
  });

  it('P7/P8/P9: ordenar aceita nome, apaga numero e devolve o inválido cru', () => {
    assert.equal(parseUrlParams(url('/biblioteca?ordenar=nome')).ordenar, 'nome');
    assert.equal(parseUrlParams(url('/biblioteca?ordenar=numero')).ordenar, 'numero');
    assert.equal(parseUrlParams(url('/biblioteca?ordenar=aleatorio')).ordenar, 'aleatorio');
    assert.equal(construirQueryAtualizada('', { ordenar: 'numero' }), '');
    assert.equal(construirQueryAtualizada('', { ordenar: 'nome' }), 'ordenar=nome');
  });

  it('P10/P11: itensPorPagina inválido vira NaN na leitura; a escrita apaga o default 10', () => {
    assert.equal(parseUrlParams(url('/biblioteca?itensPorPagina=7')).itensPorPagina, 7);
    assert.ok(Number.isNaN(parseUrlParams(url('/?itensPorPagina=xyz')).itensPorPagina));
    assert.equal(construirQueryAtualizada('?itensPorPagina=25', { itensPorPagina: 10 }), '');
    assert.equal(construirQueryAtualizada('', { itensPorPagina: 25 }), 'itensPorPagina=25');
  });

  it('P12: os sete params simultâneos, o caso de regressão mais denso do app', () => {
    const p = parseUrlParams(
      url(
        '/biblioteca?ordenar=nome&itensPorPagina=50&pagina=4&arranjo=PES&arranjoEspecial=GLTM&materiais=Cifra&comoAbrir=newtab'
      )
    );
    assert.deepEqual(p, {
      materiais: ['Cifra'],
      arranjo: ['PES'],
      arranjoEspecial: ['GLTM'],
      comoAbrir: 'newtab',
      pesquisa: '',
      ordenar: 'nome',
      itensPorPagina: 50,
      pagina: 4
    });
  });

  it('P13/P14/P15: arranjoEspecial, inclusive o valor sintético Padrão', () => {
    assert.deepEqual(parseUrlParams(url('/biblioteca?arranjoEspecial=GLTM')).arranjoEspecial, ['GLTM']);
    assert.deepEqual(parseUrlParams(url('/biblioteca?arranjoEspecial=Inexistente')).arranjoEspecial, ['Inexistente']);
    assert.deepEqual(parseUrlParams(url('/biblioteca?arranjoEspecial=Padr%C3%A3o')).arranjoEspecial, ['Padrão']);
  });
});

describe('§5.5 a fronteira do PDF — não pode quebrar', () => {
  // O /leitor NÃO usa parseUrlParams: lê com URLSearchParams direto
  // (src/routes/leitor/+page.svelte:100-104). O contrato congelado é esse.
  const lerLeitor = (/** @type {string} */ href) => {
    const sp = new URLSearchParams(new URL(href, 'https://plpcg.com').search);
    return {
      file: sp.get('file') ?? '/pdfs/exemplo.pdf',
      titulo: sp.get('titulo') ?? '',
      subtitulo: sp.get('subtitulo') ?? '',
      skipValidation: sp.get('validated') === 'true'
    };
  };

  it('R1: link completo com acento, cedilha e barra vertical', () => {
    assert.deepEqual(
      lerLeitor(
        '/leitor?file=%2F04112025%2FConhe%C3%A7amos%20e%20prossigamos%2FCifra.pdf&titulo=Conhe%C3%A7amos%20e%20prossigamos&subtitulo=Cifra%20%7C%20PES%20CIAs&validated=true'
      ),
      {
        file: '/04112025/Conheçamos e prossigamos/Cifra.pdf',
        titulo: 'Conheçamos e prossigamos',
        subtitulo: 'Cifra | PES CIAs',
        skipValidation: true
      }
    );
  });

  it('R2: sem &validated=true, a validação não é pulada', () => {
    assert.equal(lerLeitor('/leitor?file=%2Fassets%2FColCIAs%2F001.pdf').skipValidation, false);
  });

  it('R3: /leitor sem params cai no PDF de exemplo', () => {
    assert.equal(lerLeitor('/leitor').file, '/pdfs/exemplo.pdf');
  });

  it('R1/R5: escrever um filtro numa query de leitor a poluiria — hoje nada impede', () => {
    // ⚠︎ Este é o mecanismo exato do medo "pode quebrar a leitura dos PDFs".
    // A função pura NÃO sabe em que rota está; a guarda tem de vir de fora.
    // A Tarefa 4 acrescenta essa guarda em updateUrlParams, com um teste próprio.
    // Esta asserção continua valendo depois dela, porque a função pura não muda.
    const queryDoLeitor = '?file=%2Fassets%2FColCIAs%2F001.pdf&titulo=Meu+Deus&validated=true';
    assert.equal(
      construirQueryAtualizada(queryDoLeitor, { pesquisa: 'amor' }),
      'file=%2Fassets%2FColCIAs%2F001.pdf&titulo=Meu+Deus&validated=true&pesquisa=amor'
    );
  });
});

describe('§5.6 casos degenerados', () => {
  it('D1/D2: parâmetros de terceiros são preservados por toda reescrita', () => {
    // utm_source e fbclid chegam em links de WhatsApp e Facebook.
    assert.equal(
      construirQueryAtualizada('?utm_source=whatsapp', { pesquisa: 'amor' }),
      'utm_source=whatsapp&pesquisa=amor'
    );
    assert.equal(
      construirQueryAtualizada('?fbclid=abc&pagina=3', { pesquisa: '  amor  ' }),
      'fbclid=abc&pagina=3&pesquisa=amor'
    );
  });

  it('D4: chave repetida — o primeiro valor vence', () => {
    assert.equal(parseUrlParams(url('/?pesquisa=amor&pesquisa=paz')).pesquisa, 'amor');
  });

  it('D5: as chaves são sensíveis à caixa', () => {
    assert.equal(parseUrlParams(url('/?PESQUISA=amor')).pesquisa, '');
  });

  it('D6: um param de outra rota é inerte e sobrevive a todas as reescritas', () => {
    assert.equal(construirQueryAtualizada('?ordenar=nome', { pesquisa: 'x' }), 'ordenar=nome&pesquisa=x');
  });

  it('D9: recarregar restaura tudo — o round-trip fecha em todos os params', () => {
    const original = parseUrlParams(
      url('/biblioteca?arranjo=PES%2CPES+CIAs&materiais=Cifra&comoAbrir=newtab&ordenar=nome&itensPorPagina=25&pagina=4')
    );
    const query = construirQueryAtualizada(
      '',
      {
        arranjo: original.arranjo,
        materiais: original.materiais,
        comoAbrir: original.comoAbrir,
        ordenar: original.ordenar,
        itensPorPagina: original.itensPorPagina,
        pagina: original.pagina
      },
      { defaultMateriais: CATEGORIAS, defaultComoAbrir: 'leitor' }
    );
    assert.deepEqual(parseUrlParams(url(`/biblioteca?${query}`)), original);
  });
});

describe('serialização de array', () => {
  it('junta com vírgula e devolve vazio para lista vazia', () => {
    assert.equal(serializeArrayParam(['a', 'b']), 'a,b');
    assert.equal(serializeArrayParam([]), '');
    assert.equal(serializeArrayParam(null), '');
  });

  it('deserializa com trim por item e descarta vazios', () => {
    assert.deepEqual(deserializeArrayParam(' PES ,,PES CIAs '), ['PES', 'PES CIAs']);
    assert.deepEqual(deserializeArrayParam(''), []);
    assert.deepEqual(deserializeArrayParam(null), []);
  });
});
```

```bash
cd "$(git rev-parse --show-toplevel)" && node --test src/lib/utils/urlParams.test.js 2>&1 | head -5
```

Saída esperada: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/src/lib/utils/urlParams.js'`.

- [ ] **Step 3: Extrair o módulo puro**

Crie `src/lib/utils/urlParams.js` com o cálculo que hoje está em `urlSync.js`. É cópia literal, com um só acréscimo: o corpo de `updateUrlParams` vira `construirQueryAtualizada`, que devolve a query em vez de navegar.

```js
/**
 * Leitura e escrita dos parâmetros de URL da aplicação, sem nenhuma dependência
 * de framework.
 *
 * Este módulo existe separado de urlSync.js por um motivo único e importante:
 * urlSync.js importa $app/navigation e $app/stores, que só existem dentro do
 * SvelteKit, e por isso a camada de URL nunca pôde ser testada. Tudo o que é
 * cálculo sobre strings mora aqui e roda sob `node --test`; urlSync.js fica só
 * com o `get(page)` e o `goto`.
 *
 * NÃO importe nada de $app, $lib ou svelte aqui.
 */

/**
 * Serializa um array em um único valor de query (vírgulas entre itens).
 * Não use encodeURIComponent por item: URLSearchParams.set já codifica o valor
 * inteiro uma vez; codificar antes geraria %2520 etc.
 * Itens não devem conter vírgula literal (não há escape por item neste formato).
 * @param {string[]} array
 * @returns {string}
 */
export function serializeArrayParam(array) {
  if (!Array.isArray(array) || array.length === 0) {
    return '';
  }
  return array.map((item) => String(item)).join(',');
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function safeDecodeURIComponent(value) {
  if (value == null || value === '') return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Deserializa uma string de URL param em array.
 * Tolerante de propósito: `trim()` por item e descarte de vazios, para aceitar
 * `?arranjo= PES , ,PES CIAs ` digitado à mão.
 * @param {string} param
 * @returns {string[]}
 */
export function deserializeArrayParam(param) {
  if (!param || typeof param !== 'string') {
    return [];
  }
  return param.split(',').map((item) => safeDecodeURIComponent(item.trim())).filter(Boolean);
}

/**
 * Parseia todos os params relevantes da URL atual.
 * Atenção: `itensPorPagina` e `pagina` devolvem NaN (não null) quando o valor
 * não é numérico — quem consome tem de blindar com `> 0`.
 * @param {URL} url
 * @returns {{materiais: string[], arranjo: string[], arranjoEspecial: string[], comoAbrir: string, pesquisa: string, ordenar: string, itensPorPagina: number | null, pagina: number | null}}
 */
export function parseUrlParams(url) {
  const search = url.search || '';
  const params = new URLSearchParams(search);

  const comoAbrirParam = params.get('comoAbrir');
  const pesquisaParam = params.get('pesquisa');

  const ordenarParam = params.get('ordenar');
  const itensPorPaginaParam = params.get('itensPorPagina');
  const paginaParam = params.get('pagina');

  return {
    materiais: deserializeArrayParam(params.get('materiais') || ''),
    arranjo: deserializeArrayParam(params.get('arranjo') || ''),
    arranjoEspecial: deserializeArrayParam(params.get('arranjoEspecial') || ''),
    comoAbrir: safeDecodeURIComponent(comoAbrirParam || ''),
    pesquisa: safeDecodeURIComponent(pesquisaParam || ''),
    ordenar: safeDecodeURIComponent(ordenarParam || ''),
    itensPorPagina: itensPorPaginaParam ? parseInt(itensPorPaginaParam, 10) : null,
    pagina: paginaParam ? parseInt(paginaParam, 10) : null
  };
}

/**
 * Constrói a query nova a partir da atual, mantendo todo param não citado em
 * `newParams` — inclusive os de terceiros (`utm_source`, `fbclid`).
 * Params com valor padrão ou vazio são removidos.
 *
 * @param {string} searchAtual - a query atual, com ou sem o `?` inicial
 * @param {Object} newParams - os params a atualizar
 * @param {Object} [options]
 * @param {string[]} [options.defaultMateriais] - se todos estiverem selecionados, o param sai da URL
 * @param {string} [options.defaultComoAbrir] - valor padrão de comoAbrir (normalmente 'leitor')
 * @returns {string} a query nova, SEM o `?` inicial
 */
export function construirQueryAtualizada(searchAtual, newParams, options = {}) {
  const { defaultMateriais = [], defaultComoAbrir = 'leitor' } = options;

  const currentParams = new URLSearchParams(searchAtual || '');

  if (newParams.materiais !== undefined) {
    const materiais = Array.isArray(newParams.materiais) ? newParams.materiais : [];
    // Se todos os materiais estão selecionados, remover o param
    const allSelected =
      materiais.length === defaultMateriais.length &&
      defaultMateriais.every((m) => materiais.includes(m));
    if (allSelected || materiais.length === 0) {
      currentParams.delete('materiais');
    } else {
      const serialized = serializeArrayParam(materiais);
      if (serialized) currentParams.set('materiais', serialized);
      else currentParams.delete('materiais');
    }
  }

  if (newParams.arranjo !== undefined) {
    const arranjo = Array.isArray(newParams.arranjo) ? newParams.arranjo : [];
    if (arranjo.length === 0) {
      currentParams.delete('arranjo');
    } else {
      const serialized = serializeArrayParam(arranjo);
      if (serialized) currentParams.set('arranjo', serialized);
      else currentParams.delete('arranjo');
    }
  }

  if (newParams.arranjoEspecial !== undefined) {
    const arranjoEspecial = Array.isArray(newParams.arranjoEspecial) ? newParams.arranjoEspecial : [];
    if (arranjoEspecial.length === 0) {
      currentParams.delete('arranjoEspecial');
    } else {
      const serialized = serializeArrayParam(arranjoEspecial);
      if (serialized) currentParams.set('arranjoEspecial', serialized);
      else currentParams.delete('arranjoEspecial');
    }
  }

  if (newParams.comoAbrir !== undefined) {
    const comoAbrir = newParams.comoAbrir || '';
    if (comoAbrir === defaultComoAbrir || !comoAbrir) {
      currentParams.delete('comoAbrir');
    } else {
      // URLSearchParams.set já aplica percent-encoding
      currentParams.set('comoAbrir', comoAbrir);
    }
  }

  if (newParams.pesquisa !== undefined) {
    const pesquisa = (newParams.pesquisa || '').trim();
    if (!pesquisa) currentParams.delete('pesquisa');
    else currentParams.set('pesquisa', pesquisa);
  }

  if (newParams.ordenar !== undefined) {
    const ordenar = (newParams.ordenar || '').trim();
    if (ordenar === 'numero' || !ordenar) currentParams.delete('ordenar');
    else currentParams.set('ordenar', ordenar);
  }

  if (newParams.itensPorPagina !== undefined) {
    const itensPorPagina = parseInt(newParams.itensPorPagina, 10);
    if (isNaN(itensPorPagina) || itensPorPagina === 10) currentParams.delete('itensPorPagina');
    else currentParams.set('itensPorPagina', itensPorPagina.toString());
  }

  if (newParams.pagina !== undefined) {
    const pagina = parseInt(newParams.pagina, 10);
    if (isNaN(pagina) || pagina <= 1) currentParams.delete('pagina');
    else currentParams.set('pagina', pagina.toString());
  }

  return currentParams.toString();
}
```

```bash
cd "$(git rev-parse --show-toplevel)" && node --test src/lib/utils/urlParams.test.js 2>&1 | tail -8
```

Saída esperada: `ℹ tests 32`, `ℹ pass 32`, `ℹ fail 0`.

- [ ] **Step 4: `urlSync.js` vira casca fina**

Substitua todo o conteúdo de `src/lib/utils/urlSync.js` por:

```js
/**
 * Ponte entre a camada pura de parâmetros de URL (urlParams.js) e a navegação
 * do SvelteKit. Todo o cálculo mora em urlParams.js, que roda sob `node --test`;
 * aqui só ficam as duas coisas que exigem o framework: ler a URL corrente de
 * `$app/stores` e navegar com `goto`.
 *
 * As assinaturas exportadas são as mesmas de sempre — os dezenove pontos de uso
 * não mudam.
 */

import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { get } from 'svelte/store';
import { construirQueryAtualizada } from './urlParams.js';

export { serializeArrayParam, deserializeArrayParam, parseUrlParams } from './urlParams.js';

/**
 * Atualiza os params da URL mantendo os existentes e adicionando/atualizando os
 * novos. Remove params vazios ou com valores padrão.
 * @param {Object} newParams - Objeto com os params a atualizar
 * @param {Object} options - Opções
 * @param {string[]} [options.defaultMateriais] - Materiais padrão (não vão para a URL se todos selecionados)
 * @param {string} [options.defaultComoAbrir] - Valor padrão de comoAbrir (normalmente 'leitor')
 * @param {boolean} [options.replaceState] - Se true, usa replaceState (default: true)
 */
export function updateUrlParams(newParams, options = {}) {
  const { replaceState = true } = options;

  const currentUrl = get(page);
  if (!currentUrl || !currentUrl.url || !currentUrl.url.pathname) {
    console.warn('updateUrlParams: currentUrl inválido', currentUrl);
    return;
  }

  const newSearch = construirQueryAtualizada(currentUrl.url.search || '', newParams, options);
  const pathname = currentUrl.url.pathname || '/';
  const newUrl = pathname + (newSearch ? `?${newSearch}` : '');

  // replaceState para não empilhar cada filtro no histórico do navegador.
  goto(newUrl, {
    replaceState,
    noScroll: true,
    keepFocus: true
  });
}
```

Confirme que os dezenove pontos de uso continuam resolvendo e que o app compila:

```bash
cd "$(git rev-parse --show-toplevel)" && grep -rn "from '\$lib/utils/urlSync'" src --include='*.js' --include='*.svelte' | wc -l && npm run build 2>&1 | tail -3
```

Saída esperada: `7` (sete arquivos importam de `urlSync`; são dezenove *chamadas*), e o build concluindo com `✓ built in …`.

- [ ] **Step 5: Teste que falha — o contrato do link de compartilhamento**

Crie `src/lib/utils/playlistShare.contrato.test.js`. `src/lib/utils/playlistUtils.js` não importa nenhum módulo de framework, então já carrega sob `node --test`; o que falta é o teste.

```js
/**
 * Contrato do link de compartilhamento de lista (§5.1 do relatório de URL).
 *
 * O link é AUTOCONTIDO: carrega os pdfId inteiros na query. Não há servidor, não
 * há id curto. Se a leitura mudar, todo link já enviado no WhatsApp morre em
 * silêncio. Isto é caracterização — grava o que acontece hoje, bugs incluídos.
 *
 * Run: node --test src/lib/utils/playlistShare.contrato.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generatePlaylistShareUrl } from './playlistUtils.js';

/** Dois pdfId reais do acervo (Base64 padrão do caminho em UTF-8). */
const ID_A = 'MDQxMTIwMjUvQ29uaGXDp2Ftb3MgZSBwcm9zc2lnYW1vcy9DaWZyYS5wZGY=';
const ID_B = 'MDQxMTIwMjUvQ29uaGXDp2Ftb3MgZSBwcm9zc2lnYW1vcy9HZXN0b3MgQ0lBcy5wZGY=';

/** Reproduz a leitura de src/routes/+page.svelte:259-267, tal como está hoje. */
function lerLinkDeLista(href) {
  const u = new URL(href, 'https://plpcg.com');
  const params = new URLSearchParams(u.search);
  const sharepdfs = params.get('sharepdfs');
  const sharename = params.get('sharename');
  const pdfIds = sharepdfs ? sharepdfs.split(',').filter((id) => id.trim()) : [];
  // +page.svelte:277 decodifica DE NOVO um valor que .get() já decodificou.
  const nome = sharename ? decodeURIComponent(sharename) : undefined;
  return { pdfIds, nome };
}

describe('§5.1 escrita do link', () => {
  it('C1: o formato é ?sharepdfs=<ids por vírgula>&sharename=<encodeURIComponent>', () => {
    assert.equal(
      generatePlaylistShareUrl([ID_A, ID_B], 'Culto de Domingo'),
      `/?sharepdfs=${ID_A},${ID_B}&sharename=Culto%20de%20Domingo`
    );
  });

  it('C3: o nome default gerado pelo app sobrevive ao encode', () => {
    assert.equal(
      generatePlaylistShareUrl(['a'], 'lista 04/11/2025 10:20:30'),
      '/?sharepdfs=a&sharename=lista%2004%2F11%2F2025%2010%3A20%3A30'
    );
  });

  it('C5: o = de padding do Base64 vai cru na URL e volta inteiro', () => {
    // 2198 dos 4629 pdfId terminam em '='. O = só é significativo na primeira
    // ocorrência de cada par, então isto funciona — por sorte, não por design.
    const { pdfIds } = lerLinkDeLista(generatePlaylistShareUrl([ID_A, ID_B], 'x'));
    assert.deepEqual(pdfIds, [ID_A, ID_B]);
  });

  it('C6: a barra dentro de um pdfId sobrevive', () => {
    const comBarra = 'YWJj/ZGVm';
    assert.deepEqual(lerLinkDeLista(`/?sharepdfs=${comBarra}`).pdfIds, [comBarra]);
  });

  it('C7: um + num pdfId quebraria a lista em silêncio', () => {
    // ⚠︎ Hoje zero ids do acervo têm '+', mas o pdfId é Base64 de um caminho
    // arbitrário: um arquivo novo arma a bomba. URLSearchParams lê '+' como
    // espaço, o id corrompido não casa no Map do carrossel e é DESCARTADO SEM
    // AVISO. D-5 manda corrigir na escrita e continuar aceitando o formato cru
    // na leitura — quando isso acontecer, este teste inverte.
    assert.deepEqual(lerLinkDeLista('/?sharepdfs=YWJj+ZGVm').pdfIds, ['YWJj ZGVm']);
  });
});

describe('§5.1 leitura do link', () => {
  it('C1: os ids voltam na ordem dada', () => {
    assert.deepEqual(lerLinkDeLista(`/?sharepdfs=${ID_A},${ID_B}`).pdfIds, [ID_A, ID_B]);
  });

  it('C4: um id inexistente não atrapalha a leitura da lista', () => {
    // O descarte do id desconhecido acontece em carousel.loadPlaylist, não aqui.
    // Ver M-C4 na lista de verificação manual.
    assert.deepEqual(lerLinkDeLista(`/?sharepdfs=${ID_A},naoexiste,${ID_B}`).pdfIds, [
      ID_A,
      'naoexiste',
      ID_B
    ]);
  });

  it('C8: um nome de lista com % lança URIError (bug real)', () => {
    // ⚠︎ O erro sobe de dentro de um bloco reativo, DEPOIS de o carrossel já ter
    // sido carregado e ANTES de a lista ser salva: o usuário vê a lista aberta,
    // ela não é salva, e a URL fica suja. D-6 manda corrigir na Fase 3.
    const link = generatePlaylistShareUrl([ID_A], 'Louvor 100%');
    assert.throws(() => lerLinkDeLista(link), URIError);
    assert.throws(() => lerLinkDeLista(generatePlaylistShareUrl([ID_A], 'Culto 50%off')), URIError);
  });

  it('C8: nomes sem % passam ilesos', () => {
    assert.equal(lerLinkDeLista(generatePlaylistShareUrl([ID_A], 'Ação de Graças')).nome, 'Ação de Graças');
    assert.equal(
      lerLinkDeLista(generatePlaylistShareUrl([ID_A], 'lista 04/11/2025 10:20:30')).nome,
      'lista 04/11/2025 10:20:30'
    );
  });

  it('C8: um %20 literal no nome é corrompido pelo decode duplo', () => {
    assert.equal(lerLinkDeLista(generatePlaylistShareUrl([ID_A], 'Ensaio %20 teste')).nome, 'Ensaio   teste');
  });

  it('C9/C10: sharepdfs vazio ou só vírgulas não produz id nenhum', () => {
    assert.deepEqual(lerLinkDeLista('/?sharepdfs=&sharename=x').pdfIds, []);
    assert.deepEqual(lerLinkDeLista('/?sharepdfs=,,,').pdfIds, []);
  });

  it('C12: uma lista de 50 louvores cabe num link de ~3450 caracteres', () => {
    const ids = Array.from({ length: 50 }, () => ID_A);
    const link = generatePlaylistShareUrl(ids, 'Ensaio');
    assert.ok(link.length > 3000 && link.length < 4000, `tamanho inesperado: ${link.length}`);
    assert.equal(lerLinkDeLista(link).pdfIds.length, 50);
  });

  it('C13/D2: um param de terceiros convive com o link de lista na leitura', () => {
    const { pdfIds } = lerLinkDeLista(`/?utm_source=whatsapp&sharepdfs=${ID_A}&pesquisa=amor`);
    assert.deepEqual(pdfIds, [ID_A]);
    // ⚠︎ A LIMPEZA da URL é que descarta utm_source e pesquisa junto
    // (+page.svelte:281). Ver M-C13 na lista manual; D-7 manda corrigir.
  });
});
```

```bash
cd "$(git rev-parse --show-toplevel)" && node --test src/lib/utils/playlistShare.contrato.test.js 2>&1 | tail -8
```

Saída esperada: `ℹ tests 13`, `ℹ pass 13`, `ℹ fail 0`. Este arquivo passa de primeira porque `playlistUtils.js` já existe e já carrega — ele documenta comportamento, e o vermelho dele viria de uma mudança futura.

- [ ] **Step 6: Rodar tudo e conferir que nada regrediu**

```bash
npm test 2>&1 | tail -8 && npm run build 2>&1 | tail -3
```

Saída esperada: `ℹ tests 209`, `ℹ fail 0` (os 164 da Tarefa 2 mais 32 de `urlParams` e 13 de `playlistShare`), e o build concluindo.

- [ ] **Step 7: Registrar no plano os casos que nenhuma função pura observa**

Os casos abaixo dependem de blocos reativos do Svelte, de `localStorage`, de timers ou de navegação real. **Nenhum teste desta tarefa os cobre**, e fingir que cobre seria pior que não ter teste. Acrescente esta tabela ao fim de `docs/superpowers/plans/` junto do plano, ou ao corpo do commit — o importante é que ela exista escrita antes de a Fase 3 começar. Cada linha é para rodar em `npm run preview` num navegador.

| # | Caso | Passo a passo | Resultado esperado hoje |
|---|---|---|---|
| M-C1 | Importar uma lista compartilhada | Gere um link em `/listas`, abra numa aba nova | Carrossel com os louvores na ordem dada; lista salva em `/listas`; a URL volta a `/` |
| M-C2 | Link aberto antes de o manifesto carregar | Abra o link com a rede em *Slow 3G* | Nada acontece até a lista de louvores existir; então importa. **Nunca perder o link por chegar cedo** |
| M-C4 | Id inexistente no meio | Edite o link trocando um id por `naoexiste` | Carrossel só com os válidos; ⚠︎ a lista **salva** guarda o id fantasma |
| M-C9 | `?sharepdfs=` vazio | Abra `/?sharepdfs=&sharename=x` | ⚠︎ A URL fica suja e o bloco reativo reavalia a cada mudança de página |
| M-C10 | `?sharepdfs=,,,` | Abra `/?sharepdfs=,,,` | ⚠︎ Nada importado e a URL fica suja para sempre |
| M-C11 | Mesmo link três vezes | Abra o mesmo link 3× e vá a `/listas` | ⚠︎ Três listas idênticas. D-4 manda deduplicar |
| M-C13 | Link com `pesquisa` junto | Abra `/?sharepdfs=<id>&pesquisa=amor` | ⚠︎ `pesquisa` é descartado junto na limpeza da URL |
| M-C14 | Link aberto offline | DevTools → Network → Offline, cole o link | Importa normalmente (o consumo não faz rede) |
| M-F7 | `/?materiais=` vazio | Abra e olhe a lista | ⚠︎ Zero resultados, sem aviso |
| M-F8 | `/?arranjo=` vazio | Abra e olhe a lista | ⚠︎ Zero resultados: o auto-select-all não roda |
| M-P1 | `/?pesquisa=amor&pagina=3` em aba fria | Feche o navegador, limpe o cache, abra o link | ⚠︎ **Corrida**: página 3 em aba quente, página 1 em aba fria. D-3 manda fixar em página 3 |
| M-P3 | `/?pagina=3` sem busca | Abra | Clampa para 1 e remove `pagina` da URL |
| M-P10/P11 | `itensPorPagina=7` | Abra `/biblioteca?itensPorPagina=7` e depois `/?itensPorPagina=7` | ⚠︎ Assimetria: a biblioteca **limpa** o param, a home **mantém** |
| M-P16 | Vazamento entre rotas | Vá a `/biblioteca?itensPorPagina=25` e navegue para `/` | ⚠︎ A home grava `itensPorPagina=25` na própria URL |
| M-L1 | `/listas?viewId=<id válido>` | Abra a visualização de uma lista salva | Abre a lista |
| M-L2/L3 | `viewId` inexistente ou vazio | Abra `/listas?viewId=zzz` | Volta à lista geral **e apaga o param** com `replaceState` |
| M-L4 | `/listas?editId=<id>` | Salve uma lista pelo carrossel | Entra em modo edição de nome e limpa **toda** a query |
| M-L5 | `editId` + `viewId` válido juntos | Monte a URL à mão | `editId` é descartado, `viewId` prevalece |
| M-L7 | `viewId` mandado para outro aparelho | Abra o link noutro navegador | Cai em M-L2. **Correto, não "consertar"** |
| M-R4 | Digitar e clicar em menos de 500 ms | Digite `amor` e clique num louvor imediatamente | ⚠︎ O PDF tem de abrir; a URL do leitor **não pode** ganhar `pesquisa`. É o que a Tarefa 4 conserta |
| M-R6 | `/leitor?file=…` em modo standalone | Instale o PWA e abra um link de leitor por ele | O `checkAndFixUrl` repara a URL; o PDF abre |
| M-D3 | `/?pesquisa=arranjo=x` | Abra | ⚠︎ `includes('arranjo=')` dá falso-positivo e a home mostra zero resultados |
| M-D7 | URL limpa vira `?arranjo=<5 valores>` sozinha | Abra `/` e espere ~200 ms | ⚠︎ A barra de endereços muda sozinha. D-2 manda remover |
| M-D8 | Botão voltar depois de filtrar | Busque, pagine, filtre e aperte voltar | ⚠︎ **Sai do app** — nada disso entra no histórico. D-1 manda manter assim |

- [ ] **Step 8: Commit**

```bash
git add src/lib/utils/urlParams.js \
        src/lib/utils/urlParams.test.js \
        src/lib/utils/playlistShare.contrato.test.js \
        src/lib/utils/urlSync.js
git commit -m "test(url): extrair a camada pura de params e congelar o contrato de compatibilidade (#21)"
```

---

## Fase 1 — Contenção imediata

Uma tarefa só, e ela é a resposta direta ao aviso do dono do projeto. As duas correções aqui são pequenas, independentes das reescritas das Fases 2 e 3, e já eliminam o mecanismo concreto pelo qual a camada de filtros consegue tocar a URL do leitor.

Esta tarefa **muda comportamento** — por isso não está na Fase 0. Ela entra com o contrato da Tarefa 3 verde e sem nenhuma asserção alterada.

---

### Task 4: Guarda de rota em `updateUrlParams` e fim do duplo decode (contenção de #21)

O dono do projeto tem um medo específico da reescrita da camada de URL: *"pode quebrar a leitura dos PDFs"*. Esse medo tem um mecanismo concreto, e ele cabe em duas mudanças pequenas, independentes uma da outra e independentes de toda a reescrita.

**(a)** `updateUrlParams` **não tem guarda de rota**: ela lê o `pathname` corrente e reescreve a query em cima dele, seja qual for a rota. Hoje isso não explode por acidente — os componentes que escrevem filtros não são montados no leitor. Mas o debounce de 500 ms da busca (`src/routes/+page.svelte:546-562`) é o **único** escritor de URL da home sem checagem de `pathname` (compare com `:101`, `:335`, `:474`, `:511`, que todos conferem `pathname === '/'`). Digitar na busca e clicar num louvor em menos de meio segundo faz o timer disparar já em `/leitor`: se a navegação ainda não resolveu, o `goto` do filtro **compete com** a ida ao leitor; se já resolveu, a URL do leitor vira `/leitor?file=…&titulo=…&pesquisa=amor`, com `replaceState`, sobrescrevendo o histórico. Além disso, as três stores globais (`filters`, `classificationFilters`, `pdfViewer`) chamam `updateUrlParams` a partir de um `page.subscribe` de módulo, que roda em **qualquer** rota — basta alguém expor um controle de filtro no leitor, ou a reescrita mover uma escrita para dentro de um subscribe, e a URL do PDF é reescrita.

**(b)** `parseUrlParams` aplica `safeDecodeURIComponent` sobre valores que o `URLSearchParams.get()` **já decodificou** (`urlSync.js:20-26, 38, 61-63`). É um decode a mais, e ele corrompe em silêncio qualquer `%XX` que o usuário tenha digitado de verdade: `?pesquisa=a%2520b` deveria dar `a%20b` e dá `a b`. O próprio arquivo mostra que o autor sabia do risco — o comentário de `:7-8` avisa para não codificar por item na **escrita** — e replicou o erro na **leitura**.

Esta é a única tarefa da Fase 0 que muda comportamento, e muda o mínimo. A guarda (a) não altera nada que aconteça hoje num uso normal: ela apenas garante o que hoje é garantido por acidente. E a correção (b) é invisível para **todos** os casos do contrato de compatibilidade da Tarefa 3 — o Step 7 prova isso rodando os 45 testes daquele contrato sem tocar em nenhum. O que muda é só a entrada que contém um `%XX` literal depois do primeiro decode, que o app nunca produz sozinho. Sucesso = nenhuma escrita de URL pode ocorrer em `/leitor`, provado por teste e no navegador; e `?pesquisa=a%2520b` devolve `a%20b`, com o comportamento tolerante de `deserializeArrayParam` intacto.

**Files:**
- Modify: `src/lib/utils/urlParams.js` (acrescenta `podeEscreverNaUrl`; `deserializeArrayParam` e `parseUrlParams` perdem o decode a mais; `safeDecodeURIComponent` é apagada)
- Modify: `src/lib/utils/urlParams.test.js` (casos novos)
- Modify: `src/lib/utils/urlSync.js` (guarda dentro de `updateUrlParams`)
- Modify: `src/routes/+page.svelte:546-562` (guarda de `pathname` no debounce)

**Interfaces:**
- Consumes: `construirQueryAtualizada`, `parseUrlParams`, `deserializeArrayParam` de `src/lib/utils/urlParams.js` (Tarefa 3).
- Produces:
  - `podeEscreverNaUrl(pathname: string): boolean` — exportada de `src/lib/utils/urlParams.js`. Devolve `false` para `/leitor` e para qualquer coisa sob `/leitor/`; `true` para o resto. **Toda tarefa posterior que escreva URL tem de passar por aqui, e nenhuma pode remover esta guarda** (Global Constraint).
  - `updateUrlParams(newParams, options)` — assinatura inalterada, mas agora **não faz nada** quando a rota corrente é proibida. Retorna `undefined` em silêncio, sem `goto`.
  - `deserializeArrayParam(param: string): string[]` — mesma assinatura, sem o decode a mais. Mantém `trim()` por item e `filter(Boolean)`: `' PES ,,PES CIAs '` continua devolvendo `['PES', 'PES CIAs']` (caso F3 do contrato).
  - `parseUrlParams(url)` — mesma forma de retorno; `comoAbrir`, `pesquisa` e `ordenar` deixam de sofrer o decode extra.

- [ ] **Step 1: Reproduzir o mecanismo — ver que `construirQueryAtualizada` polui a URL do leitor**

Nada a alterar. Este comando mostra o que aconteceria se o debounce disparasse já em `/leitor`.

```bash
cd "$(git rev-parse --show-toplevel)" && node --input-type=module -e "
const { construirQueryAtualizada } = await import('./src/lib/utils/urlParams.js');
const queryDoLeitor = '?file=%2Fassets%2FColCIAs%2F001.pdf&titulo=Meu+Deus&validated=true';
console.log('/leitor?' + construirQueryAtualizada(queryDoLeitor, { pesquisa: 'amor' }));
"
```

Saída esperada:

```
/leitor?file=%2Fassets%2FColCIAs%2F001.pdf&titulo=Meu+Deus&validated=true&pesquisa=amor
```

O `file` sobrevive — o PDF ainda abriria — mas a URL do leitor ganhou um parâmetro de filtro e o histórico foi sobrescrito. É o que a guarda impede.

- [ ] **Step 2: Teste que falha — `podeEscreverNaUrl` não existe**

Acrescente ao fim de `src/lib/utils/urlParams.test.js`, e ajuste a linha de import no topo do arquivo para incluir `podeEscreverNaUrl`:

```js
import {
  serializeArrayParam,
  deserializeArrayParam,
  parseUrlParams,
  construirQueryAtualizada,
  podeEscreverNaUrl
} from './urlParams.js';
```

```js
describe('R5: nenhuma escrita de URL em /leitor', () => {
  it('as rotas de navegação normal podem escrever', () => {
    for (const rota of ['/', '/biblioteca', '/listas', '/offline', '/sobre']) {
      assert.equal(podeEscreverNaUrl(rota), true, `deveria poder escrever em ${rota}`);
    }
  });

  it('/leitor não pode, em nenhuma forma', () => {
    assert.equal(podeEscreverNaUrl('/leitor'), false);
    assert.equal(podeEscreverNaUrl('/leitor/'), false);
    assert.equal(podeEscreverNaUrl('/leitor/qualquer-coisa'), false);
  });

  it('uma rota que só começa com as mesmas letras não é bloqueada', () => {
    // /leitores não existe hoje, mas a guarda não pode bloquear por prefixo solto.
    assert.equal(podeEscreverNaUrl('/leitores'), true);
  });

  it('entrada inválida é tratada como bloqueada — na dúvida, não escreve', () => {
    assert.equal(podeEscreverNaUrl(''), false);
    assert.equal(podeEscreverNaUrl(null), false);
    assert.equal(podeEscreverNaUrl(undefined), false);
  });
});
```

```bash
cd "$(git rev-parse --show-toplevel)" && node --test src/lib/utils/urlParams.test.js 2>&1 | grep -E "podeEscreverNaUrl|fail" | head -5
```

Saída esperada: `SyntaxError: The requested module './urlParams.js' does not provide an export named 'podeEscreverNaUrl'`, e o arquivo inteiro falhando.

- [ ] **Step 3: Implementar `podeEscreverNaUrl`**

Acrescente ao fim de `src/lib/utils/urlParams.js`:

```js
/**
 * Rotas em que NENHUMA escrita de URL pode ocorrer.
 *
 * O `/leitor` recebe o PDF exclusivamente pelo query param `?file=`, que é
 * também um link público e compartilhável — existem links assim em conversas de
 * WhatsApp e um está hard-coded em src/routes/offline/+page.svelte:1117.
 * Qualquer reescrita de query nessa rota pode competir com a navegação que está
 * abrindo o PDF ou sobrescrever o histórico. Hoje isso é evitado por acidente
 * (nenhum componente que escreve filtro é montado lá); esta lista torna a
 * garantia explícita.
 */
const ROTAS_SEM_ESCRITA_DE_URL = ['/leitor'];

/**
 * A rota corrente aceita escrita de URL?
 * Na dúvida (pathname vazio ou não-string), devolve false: não escrever é
 * sempre mais seguro que escrever no lugar errado.
 * @param {string} pathname
 * @returns {boolean}
 */
export function podeEscreverNaUrl(pathname) {
  if (!pathname || typeof pathname !== 'string') return false;
  return !ROTAS_SEM_ESCRITA_DE_URL.some(
    (rota) => pathname === rota || pathname.startsWith(`${rota}/`)
  );
}
```

```bash
cd "$(git rev-parse --show-toplevel)" && node --test src/lib/utils/urlParams.test.js 2>&1 | tail -8
```

Saída esperada: `ℹ tests 36`, `ℹ pass 36`, `ℹ fail 0`.

- [ ] **Step 4: Ligar a guarda dentro de `updateUrlParams`**

A guarda vai na própria `updateUrlParams`, não só no chamador — é o único ponto por onde todas as dezenove chamadas passam.

Em `src/lib/utils/urlSync.js`, troque a linha de import de `urlParams.js`:

```js
import { construirQueryAtualizada } from './urlParams.js';
```

por:

```js
import { construirQueryAtualizada, podeEscreverNaUrl } from './urlParams.js';
```

e, dentro de `updateUrlParams`, logo depois do bloco que valida `currentUrl`, acrescente:

```js
  const pathname = currentUrl.url.pathname || '/';

  // #21: nenhuma escrita de URL em /leitor. A guarda mora aqui, e não só nos
  // chamadores, porque as stores globais (filters, classificationFilters,
  // pdfViewer) escrevem a partir de um page.subscribe de módulo, que roda em
  // qualquer rota.
  if (!podeEscreverNaUrl(pathname)) {
    return;
  }
```

Como `pathname` passa a estar declarado no topo da função, remova a declaração duplicada que existe mais abaixo:

```js
  const newSearch = construirQueryAtualizada(currentUrl.url.search || '', newParams, options);
  const pathname = currentUrl.url.pathname || '/';
  const newUrl = pathname + (newSearch ? `?${newSearch}` : '');
```

passa a ser:

```js
  const newSearch = construirQueryAtualizada(currentUrl.url.search || '', newParams, options);
  const newUrl = pathname + (newSearch ? `?${newSearch}` : '');
```

```bash
cd "$(git rev-parse --show-toplevel)" && npm run build 2>&1 | tail -3
```

Saída esperada: build conclui com `✓ built in …`. Se aparecer `Identifier 'pathname' has already been declared`, você esqueceu de remover a declaração duplicada.

- [ ] **Step 5: Guarda de `pathname` no debounce da busca**

Mesmo com a guarda em `updateUrlParams`, o debounce precisa da sua: sem ela o timer ainda chama `parseUrlParams($page.url)` com a URL do leitor e liga `isUpdatingFromUrl` por 100 ms sem motivo, e a intenção do bloco fica ilegível.

Em `src/routes/+page.svelte:546-547`, substitua:

```js
    searchUrlUpdateTimer = setTimeout(() => {
      if (!isUpdatingFromUrl) {
```

por:

```js
    searchUrlUpdateTimer = setTimeout(() => {
      // #21: o usuário pode ter clicado num louvor e ido para /leitor dentro
      // dos 500 ms. Sem esta checagem de rota, a escrita da busca dispara já lá
      // — competindo com a navegação, ou poluindo a URL do PDF. É o único
      // escritor de URL da home que não conferia o pathname.
      if (!isUpdatingFromUrl && $page?.url?.pathname === '/') {
```

```bash
cd "$(git rev-parse --show-toplevel)" && sed -n '546,566p' src/routes/+page.svelte && npm run build 2>&1 | tail -3
```

Saída esperada: o trecho impresso mostra a nova condição, e o build conclui.

**Anote e não conserte agora:** `handleClear()` (`src/routes/+page.svelte:366-370`) também chama `updateUrlParams` sem conferir `pathname`. Ela só pode ser disparada pelo botão de limpar da `SearchBar`, que só é montada na home, e a partir do Step 4 a guarda de `updateUrlParams` a cobre de qualquer forma. Deixe como está para manter o diff desta tarefa pequeno; a reescrita da Fase 3 resolve.

- [ ] **Step 6: Teste que falha — o duplo decode**

Acrescente ao fim de `src/lib/utils/urlParams.test.js`:

```js
describe('§4.10 duplo decode — o valor já vem decodificado de URLSearchParams', () => {
  it('um %20 literal digitado pelo usuário sobrevive na busca', () => {
    // URLSearchParams.get() já decodifica uma vez: '?pesquisa=a%2520b' devolve
    // 'a%20b'. Decodificar de novo transformava isso em 'a b' — texto do
    // usuário corrompido em silêncio.
    assert.equal(parseUrlParams(url('/?pesquisa=a%2520b')).pesquisa, 'a%20b');
  });

  it('um %20 literal sobrevive dentro de um item de array', () => {
    assert.deepEqual(parseUrlParams(url('/?arranjo=a%2520b,c')).arranjo, ['a%20b', 'c']);
    assert.deepEqual(deserializeArrayParam('a%20b,c'), ['a%20b', 'c']);
  });

  it('o comportamento tolerante de deserializeArrayParam é preservado', () => {
    // trim() por item e filter(Boolean) continuam valendo — é o caso F3.
    assert.deepEqual(deserializeArrayParam(' PES ,,PES CIAs '), ['PES', 'PES CIAs']);
    assert.deepEqual(deserializeArrayParam('  ,  ,  '), []);
    assert.deepEqual(deserializeArrayParam('PES'), ['PES']);
  });

  it('um % solto não lança em nenhum dos params', () => {
    assert.equal(parseUrlParams(url('/?pesquisa=100%25')).pesquisa, '100%');
    assert.deepEqual(parseUrlParams(url('/?arranjo=100%25,x')).arranjo, ['100%', 'x']);
    assert.equal(parseUrlParams(url('/?comoAbrir=100%25')).comoAbrir, '100%');
    assert.equal(parseUrlParams(url('/?ordenar=100%25')).ordenar, '100%');
  });
});
```

```bash
cd "$(git rev-parse --show-toplevel)" && node --test src/lib/utils/urlParams.test.js 2>&1 | grep -A4 "sobrevive na busca" | head -10
```

Saída esperada: o primeiro caso falhando, com

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected

+ 'a b'
- 'a%20b'
```

- [ ] **Step 7: Tirar o decode a mais**

Em `src/lib/utils/urlParams.js`, apague a função `safeDecodeURIComponent` inteira (ela fica sem nenhum uso) e ajuste os dois pontos que a chamavam.

`deserializeArrayParam` passa a ser:

```js
/**
 * Deserializa uma string de URL param em array.
 *
 * O valor que chega aqui vem de `URLSearchParams.get()`, que JÁ decodificou o
 * percent-encoding uma vez. Decodificar de novo corrompia qualquer `%XX` que o
 * usuário tivesse digitado de verdade (`a%20b` virava `a b`).
 *
 * Tolerante de propósito: `trim()` por item e descarte de vazios, para aceitar
 * `?arranjo= PES , ,PES CIAs ` digitado à mão. Isso é contrato (caso F3) e não
 * pode sair.
 * @param {string} param
 * @returns {string[]}
 */
export function deserializeArrayParam(param) {
  if (!param || typeof param !== 'string') {
    return [];
  }
  return param.split(',').map((item) => item.trim()).filter(Boolean);
}
```

e, dentro de `parseUrlParams`, as três linhas que ainda decodificavam:

```js
    comoAbrir: safeDecodeURIComponent(comoAbrirParam || ''),
    pesquisa: safeDecodeURIComponent(pesquisaParam || ''),
    ordenar: safeDecodeURIComponent(ordenarParam || ''),
```

passam a ser:

```js
    // Sem decode extra: URLSearchParams.get() já decodificou uma vez.
    comoAbrir: comoAbrirParam || '',
    pesquisa: pesquisaParam || '',
    ordenar: ordenarParam || '',
```

```bash
cd "$(git rev-parse --show-toplevel)" && node --test src/lib/utils/urlParams.test.js 2>&1 | tail -8
```

Saída esperada: `ℹ tests 40`, `ℹ pass 40`, `ℹ fail 0`.

**O que essa contagem prova.** Os 32 casos originais do contrato da Tarefa 3 — F1 a F18, P1 a P16, R1 a R3, D1 a D9 — continuam verdes **sem uma única alteração**. A correção do duplo decode é invisível para todo link que já circula; ela só muda a entrada que contém um `%XX` literal depois do primeiro decode, que o app nunca produz sozinho.

- [ ] **Step 8: Verificação em navegador — o PDF não pode ser tocado**

Teste unitário não prova navegação. Este passo prova.

1. `npm run build && npm run preview`; abra `http://localhost:4173`.
2. Na home, digite `amor` no campo de busca e, **em menos de meio segundo**, clique num cartão de louvor. Repita umas cinco vezes para pegar a janela.
   **Sucesso:** o leitor abre, o PDF renderiza, e a barra de endereços fica exatamente `/leitor?file=…&titulo=…&subtitulo=…&validated=true` — **sem** `&pesquisa=amor`.
   **Falha:** aparece `&pesquisa=` na URL do leitor, ou a navegação é cancelada e você volta para a home.
3. Já dentro do leitor, force uma escrita a partir de uma store global, pelo console da página:

```js
const m = await import('/src/lib/utils/urlSync.js');
const antes = location.href;
m.updateUrlParams({ pesquisa: 'teste' });
await new Promise((r) => setTimeout(r, 300));
console.log(antes === location.href ? 'GUARDA OK' : 'GUARDA FALHOU: ' + location.href);
```

   **Sucesso:** `GUARDA OK`. (Em produção o caminho do módulo é outro; este `import` só funciona no `preview`/`dev`. Se não resolver, repita o passo 2, que exercita o mesmo caminho pela UI.)
4. Volte para a home e confira que a busca **continua** gravando na URL: digite `amor`, espere um segundo sem clicar em nada.
   **Sucesso:** a barra de endereços vira `/?...&pesquisa=amor`. Se não virar, a guarda do Step 5 está bloqueando a home — confira que a comparação é `=== '/'` e não outra coisa.
5. Cole `http://localhost:4173/?pesquisa=a%2520b` e olhe o campo de busca.
   **Sucesso:** o campo mostra `a%20b`. **Falha (comportamento antigo):** mostra `a b`.

- [ ] **Step 9: Rodar tudo**

```bash
npm test 2>&1 | tail -8 && npm run build 2>&1 | tail -3
```

Saída esperada: `ℹ tests 217`, `ℹ fail 0` (os 209 da Tarefa 3 mais os 8 casos novos), e o build concluindo.

- [ ] **Step 10: Commit**

```bash
git add src/lib/utils/urlParams.js \
        src/lib/utils/urlParams.test.js \
        src/lib/utils/urlSync.js \
        src/routes/+page.svelte
git commit -m "fix(url): guarda de rota em updateUrlParams e fim do duplo decode em parseUrlParams (#21)"
```

---

---

## Fase 2 — Unificar a normalização de caminho (#22)

A ordem desta fase é obrigatória. Cada tarefa é reversível e observável sozinha, e nenhuma pode ser integrada com o contrato da Tarefa 2 vermelho.

---

### Contexto que todas as tarefas 5-9 assumem

Você provavelmente não conhece este projeto. Cinco fatos bastam para executar esta fase; todos foram verificados executando código sobre os dados reais.

1. **O que é um "caminho de PDF".** O catálogo (`louvores-manifest.json`, na raiz do repo, **não versionado**) tem 4629 entradas. Cada uma traz um campo `pdfId`, que é o caminho do arquivo em Base64/UTF-8. Decodificado, dá algo como `assets/04112025/Conheçamos e prossigamos/Cifra.pdf` — **com maiúsculas e acentos**. Essa string é a chave real no bucket R2, é o nome da entrada dentro dos ZIPs de download offline, e é o que vai no link `/leitor?file=…`.

2. **Onde os PDFs baixados vivem.** No Cache Storage do navegador, num cache chamado `plpc-pdfs` que **não tem versão** e sobrevive a todo deploy (`src/lib/offline/sw/swCaches.js:18,44-48`). A chave de cada entrada é uma **URL absoluta percent-encoded**. `cache.match()` compara URL byte a byte — não existe modo *case-insensitive*, nem *accent-insensitive*, nem *Unicode-normalizing*. Se a chave que o código procura não for exatamente a chave gravada, o PDF simplesmente não existe para o usuário, sem erro nenhum.

3. **Existem duas normalizações de caminho, e elas divergem em 4629 de 4629 caminhos reais.** `pathUtils.normalizePdfUrl` (`src/lib/utils/pathUtils.js:161-207`) baixa a caixa e tira os acentos; `PdfPathManager.normalizeForStorage` (`src/lib/offline/utils/PdfPathManager.js:23-65`) preserva os dois. Como todo caminho do acervo tem pelo menos uma maiúscula, as duas nunca coincidem em produção.

4. **A direção é inegociável: `normalizeForStorage` vence.** Ela já é a convenção dos quatro escritores do cache. Unificar na direção minúscula faria `cache.match` deixar de encontrar **100 %** dos PDFs já baixados no aparelho do usuário. Nenhuma tarefa desta fase pode inverter isso.

5. **Não toque em `src/lib/server/r2KeyMatch.js` nem em `worker/`.** `worker/index.js:12` importa `findExactKeyMatch` de `src/lib/server/` por caminho relativo e é um **deploy separado**; mudar a regra ali sem publicar o Worker deixa `v2.plpcg.com` e `120826.plpcg.com` com a regra antiga.

**Como rodar os testes.** O runner é `node --test`, sem vitest e sem jest. Arquivos testáveis só podem importar por **caminho relativo** — `$lib` não resolve fora do Vite. Um teste novo só roda se você o acrescentar à lista do script `test` em `package.json`.

**Números do acervo que você vai ver citados** (todos reexecutáveis com o comando do Step 1 da Tarefa 5):

| medida | valor |
|---|---|
| caminhos no manifesto | 4629 |
| caminhos onde `encodeURI` e o parser `URL` divergem | **3** (os que têm `[` `]` no nome) |
| caminhos em forma Unicode NFD | **8** |
| caminhos que partilham nome de arquivo com outro | **3311** |
| caminhos chamados `Cifra I.pdf` | **1036** |
| caracteres `#`, `?` ou `%` em algum caminho | **0** |

---

### Task 5: Um só codificador de URL de PDF (#22.1)

Uma URL de PDF é construída em três lugares diferentes do cliente, e eles não concordam. `PdfPathManager.createRequestUrl` (`src/lib/offline/utils/PdfPathManager.js:75-97`) e `createUrlUtf8` (`src/lib/utils/urlEncoding.js:224-281`) terminam em `encodeURI`, que escapa `[` para `%5B` e `]` para `%5D`. O leitor (`src/routes/leitor/+page.svelte:264`) usa o parser WHATWG `new URL(...)`, que deixa os colchetes literais. Sobre os 4629 caminhos reais **três divergem** — e para esses três a chave gravada no cache nunca é a URL que o leitor pede. O `cache.match(event.request)` direto do Service Worker (`src/service-worker.js:203`) erra sempre nesses três, e só a busca por variações (`:206`, a estratégia "F1") os salva. F1 não é redundância: hoje é o único mecanismo que serve esses PDFs.

Esta tarefa escolhe **um** codificador e o aplica nos três construtores. **A escolha é `createUrlUtf8`/`encodeURI`, não o parser `URL`** — e isso contraria a recomendação do §6.4 do relatório de investigação, por três razões que foram medidas depois que o relatório foi escrito e que estão no Step 1: (a) `encodeURI` é o que os quatro escritores do cache já usaram, então **zero** das 4629 chaves já gravadas muda — a direção oposta orfanaria 3 entradas já no aparelho de quem baixou; (b) a saída de `encodeURI` é **ponto fixo do parser `URL`** para os 4629 caminhos (`new URL(encodeURI(p), o).pathname === encodeURI(p)`, 0 divergências), enquanto a recíproca é falsa, de modo que qualquer chamada residual a `createUrlUtf8` que sobreviver ao refactor continua convergente em vez de virar uma bomba; (c) os pontos cegos conhecidos de `encodeURI` (`#`, `?`, `%`, que ele deixa passar) não ocorrem em nenhum dos 4629 caminhos, e o Step 3 põe um teste de guarda para o dia em que ocorrerem. O formato do `?file=` **não muda** — ele continua sendo `encodeURIComponent('/' + caminho com caixa e acento originais)`, e links antigos continuam resolvendo porque o leitor passa a canonicalizar o valor recebido.

Sucesso = as três construções produzem a mesma string para os 4629 caminhos, e a instrumentação do Step 7 mostra **zero** acertos por variação de F1 num navegador real. Esse zero é o que autoriza a Tarefa 9.

**Files:**
- Create: `src/lib/offline/utils/PdfPathManager.encoder.test.js`
- Modify: `src/lib/offline/utils/PdfPathManager.js:8-9` (imports relativos), `:75-97` (`createRequestUrl` documentada como canônica), fim do arquivo (instrumentação)
- Modify: `src/routes/leitor/+page.svelte:264`
- Modify: `src/lib/utils/missingPdfsDownloader.js:112`
- Modify: `src/lib/utils/pdfValidation.js:121`, `:171`
- Modify: `src/service-worker.js:206-223`
- Modify: `src/lib/offline/storage/CacheStorageAdapter.js:201-218`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes: nada de tarefas anteriores desta fase.
- Produces:
  - `PdfPathManager.createRequestUrl(pdfPath: string, origin?: string | null): string` — **o único construtor de URL de PDF do cliente**. Normaliza com `normalizeForStorage` e codifica com `createUrlUtf8`. Devolve `''` para entrada inválida. Toda tarefa posterior usa esta função e nenhuma outra.
  - `PdfPathManager.normalizeForStorage(pdfPath: string): string` — caminho relativo canônico, sem barra inicial, prefixo `assets/` garantido, caixa e acento preservados. Assinatura inalterada; a Tarefa 6 muda o corpo.
  - `registrarAcertoPdf(tipo: 'direto' | 'variacao' | 'miss'): void` e `pdfMatchStats: {direto: number, variacao: number, miss: number}`, exportados de `PdfPathManager.js`. Instrumentação temporária; a Tarefa 9 os apaga.

- [ ] **Step 1: Medir a divergência antes de mexer em nada**

Este comando lê o manifesto real e imprime os números que o resto da tarefa assume. Ele não altera nada. Se `louvores-manifest.json` não existir na raiz do repo, peça-o ao dono do projeto antes de continuar — sem ele você não consegue verificar esta fase.

```bash
cd "$(git rev-parse --show-toplevel)" && node -e "
const fs=require('fs');
const m=JSON.parse(fs.readFileSync('louvores-manifest.json','utf8'));
const paths=m.map(l=>{let p=Buffer.from(l.pdfId,'base64').toString('utf8').replace(/^\/+/,'').trim();
  if(!p.toLowerCase().startsWith('assets/'))p='assets/'+p; return p;});
let div=0; for(const p of paths){ if(encodeURI('/'+p)!==new URL('/'+p,'https://plpcg.com').pathname) div++; }
let naoPontoFixo=0; for(const p of paths){ const e=encodeURI('/'+p); if(new URL(e,'https://plpcg.com').pathname!==e) naoPontoFixo++; }
const perigosos=paths.filter(p=>/[#?%]/.test(p)).length;
console.log('caminhos                       :', paths.length);
console.log('encodeURI != parser URL        :', div);
console.log('encodeURI nao e ponto fixo     :', naoPontoFixo);
console.log('caminhos com # ? ou %          :', perigosos);
console.log('caminhos em NFD                :', paths.filter(p=>p!==p.normalize('NFC')).length);
"
```

Saída esperada, exatamente:

```
caminhos                       : 4629
encodeURI != parser URL        : 3
encodeURI nao e ponto fixo     : 0
caminhos com # ? ou %          : 0
caminhos em NFD                : 8
```

`encodeURI nao e ponto fixo : 0` é a linha que justifica a escolha do codificador. Anote os quatro números; o Step 8 da Tarefa 9 os repete.

- [ ] **Step 2: Tornar `PdfPathManager` importável sob `node --test`**

Hoje o módulo importa por `$lib`, que só existe dentro do Vite. Troque pelos caminhos relativos equivalentes — de `src/lib/offline/utils/` para `src/lib/utils/` são dois níveis acima.

Em `src/lib/offline/utils/PdfPathManager.js:8-9`, substitua:

```js
import { decodeUrlUtf8Multiple } from '$lib/utils/urlEncoding.js';
import { createUrlUtf8 } from '$lib/utils/urlEncoding.js';
```

por:

```js
// Caminho relativo, não `$lib`: este módulo precisa rodar sob `node --test`,
// e o alias `$lib` só existe dentro do Vite.
import { decodeUrlUtf8Multiple, createUrlUtf8 } from '../../utils/urlEncoding.js';
```

Confirme que o módulo carrega fora do Vite:

```bash
node --input-type=module -e "
import PdfPathManager from './src/lib/offline/utils/PdfPathManager.js';
console.log(PdfPathManager.createRequestUrl('assets/ColCIAs/001.pdf','https://plpcg.com'));
"
```

Saída esperada:

```
https://plpcg.com/assets/ColCIAs/001.pdf
```

- [ ] **Step 3: Teste que falha — as três construções têm de coincidir**

Crie `src/lib/offline/utils/PdfPathManager.encoder.test.js`. Os três caminhos com colchetes estão embutidos como fixture porque `louvores-manifest.json` não é versionado; a varredura completa dos 4629 roda só quando o arquivo está presente.

```js
/**
 * Um só codificador de URL de PDF (#22.1).
 * Run: node --test src/lib/offline/utils/PdfPathManager.encoder.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import PdfPathManager from './PdfPathManager.js';

const ORIGEM = 'https://plpcg.com';

/** Os três caminhos reais do acervo em que encodeURI e o parser URL divergem. */
const COM_COLCHETES = [
  'assets/30102025/Sobe aqui [26-07-2025] - Coro.pdf',
  'assets/PES/Ó profundidade das riquezas - Vocal [20 03 2026].pdf',
  'assets/PES/Perante a tua grandeza - Vocal [06 02 2025].pdf'
];

/** Reproduz o que o leitor faz hoje: parser WHATWG sobre o caminho já decodificado. */
function urlPeloParser(caminho) {
  return new URL(`/${caminho}`, ORIGEM).href;
}

describe('createRequestUrl é o único codificador', () => {
  it('a chave canônica é ponto fixo do parser URL', () => {
    // Se isto vale, qualquer new URL() aplicado depois da codificação canônica
    // devolve a mesma string — é o que permite ao leitor não divergir.
    for (const caminho of COM_COLCHETES) {
      const canonica = PdfPathManager.createRequestUrl(caminho, ORIGEM);
      assert.equal(new URL(canonica).href, canonica, `não é ponto fixo: ${caminho}`);
    }
  });

  it('o leitor, canonicalizando, chega à mesma URL que o escritor do cache', () => {
    for (const caminho of COM_COLCHETES) {
      const chaveGravada = PdfPathManager.createRequestUrl(caminho, ORIGEM);
      // O leitor recebe o caminho já decodificado, vindo de ?file=.
      const pedidoDoLeitor = PdfPathManager.createRequestUrl(caminho, ORIGEM);
      assert.equal(pedidoDoLeitor, chaveGravada);
    }
  });

  it('o parser WHATWG cru diverge — é o bug que esta tarefa fecha', () => {
    // Guarda de regressão: se um dia isto passar a ser igual, o navegador mudou
    // e a escolha de codificador precisa ser reavaliada.
    for (const caminho of COM_COLCHETES) {
      assert.notEqual(urlPeloParser(caminho), PdfPathManager.createRequestUrl(caminho, ORIGEM));
    }
  });

  it('nenhum caminho do acervo tem # ? ou %, que encodeURI deixaria passar', () => {
    const manifesto = 'louvores-manifest.json';
    if (!fs.existsSync(manifesto)) return; // fixture opcional: não versionado
    for (const caminho of caminhosDoManifesto(manifesto)) {
      assert.ok(!/[#?%]/.test(caminho), `caractere perigoso em ${caminho}`);
    }
  });

  it('sobre os 4629 caminhos reais, a chave canônica é sempre ponto fixo', () => {
    const manifesto = 'louvores-manifest.json';
    if (!fs.existsSync(manifesto)) return; // fixture opcional: não versionado
    const caminhos = caminhosDoManifesto(manifesto);
    assert.equal(caminhos.length, 4629);
    let divergentes = 0;
    for (const caminho of caminhos) {
      const canonica = PdfPathManager.createRequestUrl(caminho, ORIGEM);
      if (new URL(canonica).href !== canonica) divergentes++;
    }
    assert.equal(divergentes, 0);
  });
});

/** @param {string} arquivo */
function caminhosDoManifesto(arquivo) {
  const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  return dados.map((/** @type {{pdfId: string}} */ l) => {
    let p = Buffer.from(l.pdfId, 'base64').toString('utf8').replace(/^\/+/, '').trim();
    if (!p.toLowerCase().startsWith('assets/')) p = `assets/${p}`;
    return p;
  });
}
```

Rode e veja passar os cinco casos — eles descrevem o alvo, e `createRequestUrl` **já** o cumpre, porque ela já usa `createUrlUtf8`:

```bash
node --test src/lib/offline/utils/PdfPathManager.encoder.test.js
```

Saída esperada: `# pass 5`, `# fail 0`.

O que ainda **não** cumpre o alvo são os outros dois construtores. Acrescente ao mesmo arquivo, no fim do `describe`, o caso que falha:

```js
  it('o leitor de hoje não chega à chave gravada (falha até o Step 4)', () => {
    const caminho = COM_COLCHETES[0];
    const chaveGravada = PdfPathManager.createRequestUrl(caminho, ORIGEM);
    // urlPeloParser() é literalmente a linha 264 de src/routes/leitor/+page.svelte.
    assert.equal(urlPeloParser(caminho), chaveGravada);
  });
```

```bash
node --test src/lib/offline/utils/PdfPathManager.encoder.test.js
```

Saída esperada: `# fail 1`, com

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ 'https://plpcg.com/assets/30102025/Sobe%20aqui%20[26-07-2025]%20-%20Coro.pdf'
- 'https://plpcg.com/assets/30102025/Sobe%20aqui%20%5B26-07-2025%5D%20-%20Coro.pdf'
```

Esse é o bug, reproduzido. Agora apague esse último `it` (ele existe só para você ver a falha; o terceiro caso do arquivo já guarda a regressão para sempre) e siga.

- [ ] **Step 4: O leitor passa a usar o codificador canônico**

Em `src/routes/leitor/+page.svelte:262-264`, a URL do PDF é montada com o parser cru. Substitua:

```ts
    const urlObj = new URL(fileUrl, window.location.origin);
    const pdfPath = urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
    const originalFullUrl = new URL(`/${pdfPath}`, window.location.origin).href;
```

por:

```ts
    const urlObj = new URL(fileUrl, window.location.origin);
    const pdfPath = urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
    // #22.1: um só codificador. O parser WHATWG deixa `[` e `]` literais e o
    // escritor do cache os escapa — para os 3 PDFs do acervo com colchetes no
    // nome, a URL pedida aqui nunca era a chave gravada.
    const originalFullUrl = PdfPathManager.createRequestUrl(pdfPath, window.location.origin);
```

Adicione o import junto aos outros do bloco `<script>` do arquivo:

```ts
  import PdfPathManager from '$lib/offline/utils/PdfPathManager.js';
```

(Aqui `$lib` é correto: `.svelte` só roda dentro do Vite.)

```bash
npm run build
```

Saída esperada: build conclui sem erro (`✓ built in …`).

- [ ] **Step 5: Os dois construtores auxiliares passam pelo canônico**

Três chamadas montam a URL com `createUrlUtf8` diretamente, o que hoje coincide com o canônico mas não é garantido por nada. Faça-as passar pela função única.

Em `src/lib/utils/missingPdfsDownloader.js:111-112`, substitua:

```js
        // Create full URL using createUrlUtf8 to handle UTF-8 encoding
        const fullUrl = createUrlUtf8(`/${pdfPath}`, window.location.origin);
```

por:

```js
        // #22.1: um só construtor de URL de PDF em todo o cliente.
        const fullUrl = PdfPathManager.createRequestUrl(pdfPath, window.location.origin);
```

e acrescente o import no topo do arquivo:

```js
import PdfPathManager from '$lib/offline/utils/PdfPathManager.js';
```

Em `src/lib/utils/pdfValidation.js:120-121` e `:170-171`, os dois trechos são idênticos. Substitua **os dois**:

```js
  const normalizedPath = pdfPath.startsWith('/') ? pdfPath.substring(1) : pdfPath;
  const fullUrl = createUrlUtf8(`/${normalizedPath}`, window.location.origin);
```

por:

```js
  // #22.1: um só construtor de URL de PDF em todo o cliente.
  const normalizedPath = PdfPathManager.normalizeForStorage(pdfPath);
  const fullUrl = PdfPathManager.createRequestUrl(pdfPath, window.location.origin);
```

e acrescente o import no topo:

```js
import PdfPathManager from '$lib/offline/utils/PdfPathManager.js';
```

```bash
npm run build && npm test
```

Saída esperada: build conclui; `# fail 0` em todos os arquivos de teste.

- [ ] **Step 6: O Service Worker grava pelo canônico**

`src/service-worker.js:219-222` monta a chave de gravação à mão, repetindo a composição `normalizeForStorage` + `createUrlUtf8`. Substitua:

```js
      const normalizedPath = PdfPathManager.normalizeForStorage(url.pathname);
      const normalizedRequest = new Request(
        createUrlUtf8(`/${normalizedPath}`, self.location.origin)
      );
```

por:

```js
      // #22.1: a chave de gravação sai do mesmo construtor que o leitor usa.
      const normalizedPath = PdfPathManager.normalizeForStorage(url.pathname);
      const normalizedRequest = new Request(
        PdfPathManager.createRequestUrl(url.pathname, self.location.origin)
      );
```

O import de `createUrlUtf8` em `src/service-worker.js:27` pode ficar por enquanto — a Tarefa 9 confere se ainda é usado.

```bash
npm run build
```

Saída esperada: build conclui sem erro.

- [ ] **Step 7: Instrumentar quantas vezes uma variação de F1 ainda acerta**

Este é o passo cujo resultado autoriza a Tarefa 9. Acrescente ao fim de `src/lib/offline/utils/PdfPathManager.js`, **antes** do `export default`:

```js
/**
 * Instrumentação temporária da Fase 1 (#22.1).
 *
 * Conta como cada PDF foi encontrado no cache: pela chave canônica (`direto`),
 * por alguma das variações difusas de `createSearchVariations` (`variacao`), ou
 * não encontrado (`miss`). Depois desta tarefa, `variacao` tem de ficar em zero
 * — é esse zero que autoriza a remoção das estratégias na Tarefa 9.
 *
 * A Tarefa 9 apaga este bloco inteiro.
 */
export const pdfMatchStats = { direto: 0, variacao: 0, miss: 0 };

/** @param {'direto' | 'variacao' | 'miss'} tipo */
export function registrarAcertoPdf(tipo, detalhe = '') {
  if (tipo in pdfMatchStats) pdfMatchStats[tipo] += 1;
  if (tipo === 'variacao') {
    console.warn('[F1] acerto por variação:', detalhe);
  }
  const escopo = typeof self !== 'undefined' ? self : globalThis;
  escopo.__plpcPdfMatchStats = pdfMatchStats;
}
```

Em `src/service-worker.js`, no `handlePdf`, instrumente os três desfechos. Substitua `:203-214`:

```js
  const direct = await cache.match(event.request);
  if (direct) return direct;

  const variations = PdfPathManager.createSearchVariations(url.pathname, self.location.origin);
  for (const variationUrl of variations) {
    try {
      const cached = await cache.match(new Request(variationUrl));
      if (cached) return cached;
    } catch {
      // Variação malformada: tenta a próxima.
    }
  }
```

por:

```js
  const direct = await cache.match(event.request);
  if (direct) {
    registrarAcertoPdf('direto');
    return direct;
  }

  const variations = PdfPathManager.createSearchVariations(url.pathname, self.location.origin);
  for (const variationUrl of variations) {
    try {
      const cached = await cache.match(new Request(variationUrl));
      if (cached) {
        registrarAcertoPdf('variacao', variationUrl);
        return cached;
      }
    } catch {
      // Variação malformada: tenta a próxima.
    }
  }
  registrarAcertoPdf('miss', url.pathname);
```

e acrescente `registrarAcertoPdf` ao import de `src/service-worker.js:26`:

```js
import PdfPathManager, { registrarAcertoPdf } from '$lib/offline/utils/PdfPathManager.js';
```

Faça o mesmo em `src/lib/offline/storage/CacheStorageAdapter.js`. No laço de `:201-218`, dentro do `if (response) {`, logo antes do `return response;` de `:213`, acrescente:

```js
            registrarAcertoPdf(url === searchVariations[0] ? 'direto' : 'variacao', url);
```

e ajuste o import de `:11`:

```js
import PdfPathManager, { registrarAcertoPdf } from '../utils/PdfPathManager.js';
```

```bash
npm run build && npm test
```

Saída esperada: build conclui; `# fail 0`.

- [ ] **Step 8: Verificação em navegador — o número que autoriza a Tarefa 9**

Testes unitários não provam `cache.match`. Este passo prova.

1. `npm run build && npm run preview`, abra `http://localhost:4173` no Chrome.
2. DevTools → Application → Service Workers → marque **Update on reload**; recarregue com Ctrl+Shift+R até o SW ficar *activated and is running* com o build novo.
3. Vá a `/offline` e baixe **uma** categoria pequena inteira (a menor da lista serve). Espere o progresso chegar a 100 %.
4. DevTools → Application → Cache Storage → `plpc-pdfs`. Confirme que as chaves são URLs absolutas com `%20` nos espaços. Procure na caixa de filtro por `Sobe aqui` — se a categoria baixada contiver esse louvor, a chave tem de terminar em `Sobe%20aqui%20%5B26-07-2025%5D%20-%20Coro.pdf`, com `%5B`/`%5D` e **não** com colchetes literais.
5. DevTools → Network → marque **Offline**.
6. Abra pelo menos **oito** louvores dessa categoria pelo leitor, clicando nos cartões. Inclua obrigatoriamente, se estiverem na categoria, os três com colchetes no nome: `Sobe aqui [26-07-2025] - Coro`, `Ó profundidade das riquezas - Vocal [20 03 2026]`, `Perante a tua grandeza - Vocal [06 02 2025]`. Se nenhum dos três estiver na categoria que você baixou, baixe também `PES`, que contém dois deles.
7. Abra o console **do Service Worker** (Application → Service Workers → link `inspect` ao lado do worker ativo) e execute:

```js
self.__plpcPdfMatchStats
```

**Sucesso:** `variacao` é `0`, `direto` é maior ou igual ao número de PDFs que você abriu, e o console do SW não tem nenhuma linha `[F1] acerto por variação:`.

**Falha:** qualquer `variacao` maior que zero. Nesse caso a linha `[F1] acerto por variação: <url>` no console do SW diz exatamente qual variação salvou o dia — compare essa URL com a chave em Cache Storage, e a diferença entre as duas é o construtor que você ainda não unificou. **Não avance para a Tarefa 9 sem esse zero.**

8. Repita a leitura no console da **página** (não do SW), que cobre o caminho do `CacheStorageAdapter`:

```js
window.__plpcPdfMatchStats
```

Mesmo critério: `variacao` em zero.

Anote os dois objetos no corpo do commit.

- [ ] **Step 9: Registrar o teste novo no runner**

Em `package.json`, no script `test`, acrescente o arquivo novo ao fim da lista (é uma linha só; mantenha tudo numa linha):

```
… src/lib/utils/swDebugMessage.test.js src/lib/offline/utils/PdfPathManager.encoder.test.js"
```

```bash
npm test
```

Saída esperada: a contagem total de testes sobe em 5 e `# fail 0`.

- [ ] **Step 10: Commit**

```bash
git add src/lib/offline/utils/PdfPathManager.js \
        src/lib/offline/utils/PdfPathManager.encoder.test.js \
        src/routes/leitor/+page.svelte \
        src/lib/utils/missingPdfsDownloader.js \
        src/lib/utils/pdfValidation.js \
        src/service-worker.js \
        src/lib/offline/storage/CacheStorageAdapter.js \
        package.json
git commit -m "fix(pdf): unificar o codificador de URL de PDF em createRequestUrl (#22.1)"
```

---

### Task 6: NFC na normalização de armazenamento (#22.2)

`normalizeForStorage` preserva caixa e acento, o que é certo, mas não unifica as duas formas Unicode de um mesmo acento. `é` pode ser um único code point (NFC, `U+00E9`) ou dois (NFD, `e` + `U+0301`) — o usuário vê a mesma letra, o `cache.match` vê duas chaves diferentes. **Oito caminhos reais do acervo estão em NFD** (verificado por execução; a lista está no Step 1). Uma linha, `.normalize('NFC')`, fecha o buraco e alinha o cliente com `normalizeR2Key` (`src/lib/server/r2KeyMatch.js:19-29`), que já passa por NFD e portanto já trata as duas formas como iguais no servidor.

**A pergunta que esta tarefa não pode deixar em aberto: entradas já gravadas em NFD deixam de ser encontradas pela chave NFC?** A resposta é **sim, para esses oito caminhos, e por isso esta tarefa inclui uma migração.** A cadeia: as chaves de cache nascem de `pdfId` (via `getPdfRelPath`, `src/lib/utils/pathUtils.js:41-80`, que decodifica Base64 e não normaliza) e de nomes de entrada dentro do ZIP (`scripts/generate-offline-packages.mjs:197-200`, que grava `decodePdfId(pdfId)` verbatim). **As duas fontes produzem a mesma forma que está no `pdfId`, e para esses oito o `pdfId` está em NFD.** Logo, num aparelho que baixou essas categorias, oito entradas do `plpc-pdfs` têm chave NFD (`.../A%20Obra%20do%20Senhor%20e%CC%81%20Perfeita/Coro.pdf`), e depois desta tarefa o app passaria a procurar a forma NFC (`...%C3%A9...`) e não a acharia. Online ninguém nota, porque o R2 resolve pela cascata de `findExactKeyMatch`; **offline, esses oito somem em silêncio** — exatamente a classe de falha que esta fase existe para eliminar. A migração é barata: uma varredura única do `plpc-pdfs` que só toca as entradas cuja chave difere da sua forma canônica (esperado: ≤8 por aparelho), sem rede, com `put` antes de `delete` para que uma interrupção deixe as duas chaves em vez de nenhuma. Não migrar seria defensável pelo tamanho (8 de 4629), mas não pelo custo: a migração são ~40 linhas testáveis e roda uma vez na vida do aparelho.

Sucesso = as duas formas de um mesmo caminho produzem a mesma chave; os 4629 caminhos continuam dando 4629 chaves distintas depois do NFC (verificado: 0 colisões); e a migração converte as chaves NFD já gravadas sem perder nenhum PDF.

**Files:**
- Modify: `src/lib/offline/utils/PdfPathManager.js:35-46` (NFC depois do decode)
- Create: `src/lib/offline/utils/PdfPathManager.nfc.test.js`
- Create: `src/lib/offline/storage/pdfCacheNfcMigration.js`
- Create: `src/lib/offline/storage/pdfCacheNfcMigration.test.js`
- Modify: `src/lib/stores/offline.js:535-569` (`normalizeZipEntryName` delega), `:806-809` e `:1807-1810` (`prepareForComparison` canoniza)
- Modify: `src/lib/offline/core/OfflineManager.js:103-115` (chamar a migração)
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes: `PdfPathManager.normalizeForStorage(pdfPath)` e `PdfPathManager.createRequestUrl(pdfPath, origin)` da Tarefa 5.
- Produces:
  - `PdfPathManager.normalizeForStorage(pdfPath: string): string` — agora idempotente sobre a forma Unicode: devolve sempre NFC. Assinatura inalterada.
  - `migrarChavesPdfParaNfc(cache: Cache, canonicalizar: (url: string) => string): Promise<{migradas: number, mantidas: number, erros: number}>` — exportada de `src/lib/offline/storage/pdfCacheNfcMigration.js`. Recebe o cache e o canonicalizador por parâmetro, para ser testável sob `node --test`.
  - `NFC_MIGRATION_FLAG: string` — a chave de `localStorage` que marca a migração como feita, exportada do mesmo módulo.

- [ ] **Step 1: Ver os oito caminhos NFD do acervo**

```bash
cd "$(git rev-parse --show-toplevel)" && node -e "
const fs=require('fs');
const m=JSON.parse(fs.readFileSync('louvores-manifest.json','utf8'));
const paths=m.map(l=>{let p=Buffer.from(l.pdfId,'base64').toString('utf8').replace(/^\/+/,'').trim();
  if(!p.toLowerCase().startsWith('assets/'))p='assets/'+p; return p;});
const nfd=paths.filter(p=>p!==p.normalize('NFC'));
console.log('em NFD:', nfd.length); nfd.forEach(p=>console.log(' ', p));
console.log('chaves distintas depois de NFC:', new Set(paths.map(p=>p.normalize('NFC'))).size, 'de', paths.length);
"
```

Saída esperada:

```
em NFD: 8
  assets/05042026/A Obra do Senhor é Perfeita/Coro.pdf
  assets/05042026/Bênção Aarônica (Bênção Apostólica)/Coro.pdf
  assets/05042026/Tabernáculo/Coro.pdf
  assets/30102025/A ORAÇÃO DA TUA IGREJA - Coro.pdf
  assets/30102025/Preciosa graça de Jesus (T&F V) - Vocal -16 10 2025-.pdf
  assets/Avulsos Diversos/Ao Único.pdf
  assets/PES/Alto preço - CIFRA.pdf
  assets/PES/Ó profundidade das riquezas - Vocal [20 03 2026].pdf
chaves distintas depois de NFC: 4629 de 4629
```

`4629 de 4629` é a licença para normalizar: o NFC não colapsa dois louvores diferentes numa chave só. Note que o último da lista é também um dos três com colchetes da Tarefa 5 — ele exercita as duas correções juntas.

- [ ] **Step 2: Teste que falha — NFD e NFC têm de dar a mesma chave**

Crie `src/lib/offline/utils/PdfPathManager.nfc.test.js`:

```js
/**
 * NFC na normalização de armazenamento (#22.2).
 * Run: node --test src/lib/offline/utils/PdfPathManager.nfc.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import PdfPathManager from './PdfPathManager.js';

const ORIGEM = 'https://plpcg.com';

/** Os oito caminhos reais do acervo que chegam em NFD. */
const EM_NFD = [
  'assets/05042026/A Obra do Senhor é Perfeita/Coro.pdf',
  'assets/05042026/Bênção Aarônica (Bênção Apostólica)/Coro.pdf',
  'assets/05042026/Tabernáculo/Coro.pdf',
  'assets/30102025/A ORAÇÃO DA TUA IGREJA - Coro.pdf',
  'assets/30102025/Preciosa graça de Jesus (T&F V) - Vocal -16 10 2025-.pdf',
  'assets/Avulsos Diversos/Ao Único.pdf',
  'assets/PES/Alto preço - CIFRA.pdf',
  'assets/PES/Ó profundidade das riquezas - Vocal [20 03 2026].pdf'
].map((p) => p.normalize('NFD'));

describe('normalizeForStorage unifica a forma Unicode', () => {
  it('NFD e NFC do mesmo caminho dão a mesma chave', () => {
    for (const nfd of EM_NFD) {
      const nfc = nfd.normalize('NFC');
      assert.notEqual(nfd, nfc, 'a fixture tem de estar mesmo em NFD');
      assert.equal(
        PdfPathManager.normalizeForStorage(nfd),
        PdfPathManager.normalizeForStorage(nfc)
      );
    }
  });

  it('a saída é sempre NFC', () => {
    for (const nfd of EM_NFD) {
      const saida = PdfPathManager.normalizeForStorage(nfd);
      assert.equal(saida, saida.normalize('NFC'));
    }
  });

  it('a URL canônica também converge', () => {
    for (const nfd of EM_NFD) {
      assert.equal(
        PdfPathManager.createRequestUrl(nfd, ORIGEM),
        PdfPathManager.createRequestUrl(nfd.normalize('NFC'), ORIGEM)
      );
    }
  });

  it('normalizeForStorage é idempotente', () => {
    for (const nfd of EM_NFD) {
      const uma = PdfPathManager.normalizeForStorage(nfd);
      assert.equal(PdfPathManager.normalizeForStorage(uma), uma);
    }
  });

  it('o NFC não colapsa dois caminhos do acervo numa chave só', () => {
    const manifesto = 'louvores-manifest.json';
    if (!fs.existsSync(manifesto)) return; // fixture opcional: não versionado
    const dados = JSON.parse(fs.readFileSync(manifesto, 'utf8'));
    const chaves = new Set(
      dados.map((/** @type {{pdfId: string}} */ l) =>
        PdfPathManager.normalizeForStorage(Buffer.from(l.pdfId, 'base64').toString('utf8'))
      )
    );
    assert.equal(chaves.size, dados.length);
  });
});
```

```bash
node --test src/lib/offline/utils/PdfPathManager.nfc.test.js
```

Saída esperada: `# fail 3` — falham os três primeiros casos, com

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ 'assets/05042026/A Obra do Senhor é Perfeita/Coro.pdf'
- 'assets/05042026/A Obra do Senhor é Perfeita/Coro.pdf'
```

(as duas strings parecem iguais no terminal porque diferem só na forma Unicode — é exatamente o bug.)

- [ ] **Step 3: A linha que resolve**

Em `src/lib/offline/utils/PdfPathManager.js:35-46`, logo depois do bloco de decode e antes da normalização de separadores, insira o `normalize('NFC')`. O trecho passa a ser:

```js
      // Decode URI encoding (handle multiple encodings) but preserve case and accents
      // Use UTF-8 explicit decoding
      try {
        if (normalized.includes('%')) {
          normalized = decodeUrlUtf8Multiple(normalized, 3);
        }
      } catch {
        // If decoding fails, continue with original
      }

      // #22.2: unifica a forma Unicode DEPOIS de decodificar — um acento pode
      // chegar como um code point (NFC) ou dois (NFD), e o `cache.match` trata
      // as duas formas como chaves diferentes. Oito caminhos do acervo chegam
      // em NFD. Alinha o cliente com normalizeR2Key, que já passa por NFD.
      normalized = normalized.normalize('NFC');

      // Normalize path separators (Windows vs Unix)
      normalized = normalized.replace(/\\/g, '/');
```

Faça o mesmo no ramo de fallback do `catch`, em `:58`:

```js
      let fallback = pdfPath.normalize('NFC').replace(/^\/+/, '').replace(/\\/g, '/');
```

```bash
node --test src/lib/offline/utils/PdfPathManager.nfc.test.js
```

Saída esperada: `# pass 5`, `# fail 0`.

- [ ] **Step 4: Fechar a cópia de `normalizeForStorage` que escreve no cache**

`src/lib/stores/offline.js:535-569` tem `normalizeZipEntryName`, uma cópia literal de `normalizeForStorage` que só difere por devolver com barra inicial. Ela é o **escritor de cache** do download por categoria (`:981` e `:2002`). Se ela não ganhar o NFC junto, esta tarefa cria uma divergência nova: o leitor procuraria NFC e o extrator de ZIP continuaria gravando NFD. Faça-a delegar. Substitua o corpo inteiro de `:535-569` por:

```js
function normalizeZipEntryName(entryName) {
  if (!entryName) {
    return '';
  }

  // #22.2: delega ao normalizador canônico — era uma cópia literal dele, e uma
  // cópia não recebe as correções do original. A única diferença de contrato é
  // a barra inicial, que o Cache Storage espera aqui.
  const prepared = PdfPathManager.normalizeForStorage(entryName);

  if (!prepared || prepared.endsWith('/')) {
    return '';
  }

  return `/${prepared}`;
}
```

Acrescente o import no topo de `src/lib/stores/offline.js`:

```js
import PdfPathManager from '$lib/offline/utils/PdfPathManager.js';
```

- [ ] **Step 5: Canonizar os dois lados da comparação do extrator de ZIP**

O extrator decide o que gravar comparando o nome da entrada do ZIP (agora NFC) com a lista de URLs pedidas, que vem de `getPdfUrl` (`src/lib/stores/offline.js:1519-1545`) e **não** passa por `normalizeForStorage` — continua na forma do `pdfId`, NFD inclusive. Sem este passo, os oito PDFs NFD deixariam de ser gravados a partir do ZIP, porque `remaining.has(...)` daria falso e o `continue` de `:978` os puliria em silêncio.

Em `src/lib/stores/offline.js:806-809`, substitua:

```js
  const prepareForComparison = (/** @type {string} */ url) => {
    const path = url.replace(/^\/+/, '');
    return path || '';
  };
```

por:

```js
  // #22.2: os dois lados da comparação passam pelo normalizador canônico, senão
  // um caminho em NFD vindo do pdfId nunca casa com a entrada de ZIP já em NFC.
  const prepareForComparison = (/** @type {string} */ url) =>
    PdfPathManager.normalizeForStorage(url);
```

Aplique **exatamente a mesma substituição** em `src/lib/stores/offline.js:1807-1810`, que é o mesmo trecho duplicado no segundo fluxo de download.

```bash
npm run build
```

Saída esperada: build conclui sem erro.

- [ ] **Step 6: Teste que falha — a migração das chaves NFD já gravadas**

Crie `src/lib/offline/storage/pdfCacheNfcMigration.test.js`. O teste usa um Cache falso em memória, para rodar sob `node --test`:

```js
/**
 * Migração das chaves de PDF gravadas em NFD (#22.2).
 * Run: node --test src/lib/offline/storage/pdfCacheNfcMigration.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrarChavesPdfParaNfc } from './pdfCacheNfcMigration.js';

/** Cache Storage falso: guarda pares url → corpo. */
function cacheFalso(entradas) {
  const mapa = new Map(entradas);
  return {
    mapa,
    async keys() {
      return [...mapa.keys()].map((url) => ({ url }));
    },
    async match(req) {
      const url = typeof req === 'string' ? req : req.url;
      return mapa.has(url) ? { corpo: mapa.get(url), clone: () => ({ corpo: mapa.get(url) }) } : undefined;
    },
    async put(req, res) {
      mapa.set(typeof req === 'string' ? req : req.url, res.corpo);
    },
    async delete(req) {
      return mapa.delete(typeof req === 'string' ? req : req.url);
    }
  };
}

/** Canonicalizador injetado: decodifica, aplica NFC, recodifica. */
function canonicalizar(url) {
  const u = new URL(url);
  const caminho = decodeURIComponent(u.pathname).normalize('NFC');
  return `${u.origin}${encodeURI(caminho)}`;
}

const NFD = 'https://plpcg.com/assets/PES/Alto%20prec%CC%A7o%20-%20CIFRA.pdf';
const NFC = 'https://plpcg.com/assets/PES/Alto%20pre%C3%A7o%20-%20CIFRA.pdf';
const JA_OK = 'https://plpcg.com/assets/ColCIAs/001.pdf';

describe('migrarChavesPdfParaNfc', () => {
  it('reescreve a chave NFD sob a forma NFC e apaga a antiga', async () => {
    const cache = cacheFalso([[NFD, 'pdf-a'], [JA_OK, 'pdf-b']]);
    const r = await migrarChavesPdfParaNfc(cache, canonicalizar);
    assert.deepEqual(r, { migradas: 1, mantidas: 1, erros: 0 });
    assert.equal(cache.mapa.get(NFC), 'pdf-a');
    assert.equal(cache.mapa.has(NFD), false);
    assert.equal(cache.mapa.get(JA_OK), 'pdf-b');
  });

  it('não toca em nada quando tudo já está canônico', async () => {
    const cache = cacheFalso([[NFC, 'pdf-a'], [JA_OK, 'pdf-b']]);
    const r = await migrarChavesPdfParaNfc(cache, canonicalizar);
    assert.deepEqual(r, { migradas: 0, mantidas: 2, erros: 0 });
  });

  it('é idempotente: rodar duas vezes dá o mesmo cache', async () => {
    const cache = cacheFalso([[NFD, 'pdf-a']]);
    await migrarChavesPdfParaNfc(cache, canonicalizar);
    const r = await migrarChavesPdfParaNfc(cache, canonicalizar);
    assert.deepEqual(r, { migradas: 0, mantidas: 1, erros: 0 });
    assert.equal(cache.mapa.size, 1);
  });

  it('grava a chave nova antes de apagar a velha', async () => {
    // Se a operação for interrompida no meio, tem de sobrar a entrada antiga,
    // nunca nenhuma. Provamos observando a ordem: falhamos o delete de
    // propósito e conferimos que a chave nova já existe.
    const cache = cacheFalso([[NFD, 'pdf-a']]);
    cache.delete = async () => {
      throw new Error('falha simulada');
    };
    const r = await migrarChavesPdfParaNfc(cache, canonicalizar);
    assert.equal(cache.mapa.has(NFC), true);
    assert.equal(cache.mapa.has(NFD), true);
    assert.equal(r.erros, 1);
  });
});
```

```bash
node --test src/lib/offline/storage/pdfCacheNfcMigration.test.js
```

Saída esperada: falha por módulo inexistente —

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../pdfCacheNfcMigration.js'
```

- [ ] **Step 7: Implementar a migração**

Crie `src/lib/offline/storage/pdfCacheNfcMigration.js`:

```js
/**
 * Migração única das chaves do cache de PDFs para a forma Unicode NFC (#22.2).
 *
 * Oito caminhos do acervo chegam do `pdfId` em NFD. Antes de #22.2 eles eram
 * gravados assim; depois de #22.2 o app procura a forma NFC, e `cache.match` é
 * comparação byte a byte de URL. Sem esta varredura, esses PDFs somem em
 * silêncio para quem está offline.
 *
 * Custo: uma passada por `cache.keys()` (só metadados) e uma reescrita para
 * cada chave que não estiver canônica — na prática, no máximo oito. Sem rede.
 * Grava a chave nova ANTES de apagar a velha: uma interrupção deixa as duas
 * chaves apontando para o mesmo PDF, o que é inofensivo, e nunca nenhuma.
 * Idempotente: rodar de novo não faz nada.
 *
 * Recebe `cache` e `canonicalizar` por parâmetro para poder rodar sob
 * `node --test`, que não tem Cache Storage nem o alias `$lib`.
 */

/** Chave de localStorage que marca a migração como concluída neste aparelho. */
export const NFC_MIGRATION_FLAG = 'plpc_pdf_cache_nfc_migration_v1';

/**
 * @param {Cache} cache - o cache `plpc-pdfs` já aberto
 * @param {(url: string) => string} canonicalizar - devolve a URL canônica de uma chave
 * @returns {Promise<{migradas: number, mantidas: number, erros: number}>}
 */
export async function migrarChavesPdfParaNfc(cache, canonicalizar) {
  const resultado = { migradas: 0, mantidas: 0, erros: 0 };

  const chaves = await cache.keys();

  for (const requisicao of chaves) {
    const urlAntiga = requisicao.url;
    let urlNova = '';
    try {
      urlNova = canonicalizar(urlAntiga);
    } catch {
      resultado.erros++;
      continue;
    }

    if (!urlNova || urlNova === urlAntiga) {
      resultado.mantidas++;
      continue;
    }

    try {
      const resposta = await cache.match(requisicao);
      if (!resposta) {
        resultado.erros++;
        continue;
      }
      // Primeiro grava a nova. Só então apaga a velha.
      await cache.put(urlNova, resposta.clone());
    } catch {
      resultado.erros++;
      continue;
    }

    try {
      await cache.delete(requisicao);
      resultado.migradas++;
    } catch {
      // A entrada nova já existe; a velha ficou para trás. Inofensivo.
      resultado.erros++;
    }
  }

  return resultado;
}
```

```bash
node --test src/lib/offline/storage/pdfCacheNfcMigration.test.js
```

Saída esperada: `# pass 4`, `# fail 0`.

- [ ] **Step 8: Ligar a migração na inicialização**

Em `src/lib/offline/core/OfflineManager.js`, logo depois do bloco da migração V2 (`:103-115`), acrescente:

```js
        // #22.2: converte para NFC as chaves de PDF gravadas em NFD antes desta
        // versão. Uma vez por aparelho, sem rede, no máximo oito entradas.
        try {
          if (localStorage.getItem(NFC_MIGRATION_FLAG) !== 'true') {
            const cachePdfs = await caches.open(getConfig('PDF_CACHE_NAME') || 'plpc-pdfs');
            const r = await migrarChavesPdfParaNfc(cachePdfs, (url) => {
              const u = new URL(url);
              return PdfPathManager.createRequestUrl(decodeURIComponent(u.pathname), u.origin);
            });
            logger.info('OfflineManager', `Migração NFC: ${r.migradas} migradas, ${r.mantidas} mantidas, ${r.erros} erros`);
            if (r.erros === 0) localStorage.setItem(NFC_MIGRATION_FLAG, 'true');
          }
        } catch (error) {
          logger.warn('OfflineManager', 'Migração NFC falhou (não crítico)', error);
        }
```

e os imports no topo do arquivo:

```js
import PdfPathManager from '../utils/PdfPathManager.js';
import { migrarChavesPdfParaNfc, NFC_MIGRATION_FLAG } from '../storage/pdfCacheNfcMigration.js';
import { getConfig } from './OfflineConfig.js';
```

Se `getConfig` já estiver importado nesse arquivo, não duplique o import.

```bash
npm run build && npm test
```

Saída esperada: build conclui; `# fail 0`.

- [ ] **Step 9: Verificação em navegador — os oito NFD sobrevivem**

1. `npm run build && npm run preview`; abra `http://localhost:4173`.
2. Antes de recarregar com o código novo, **simule o estado antigo**: no console da página, grave uma chave NFD à mão e confirme que ela existe.

```js
const c = await caches.open('plpc-pdfs');
const nfd = location.origin + encodeURI('/assets/PES/Alto preço - CIFRA.pdf'.normalize('NFD'));
await c.put(nfd, new Response(new Blob([new Uint8Array([37,80,68,70])], {type:'application/pdf'})));
(await c.keys()).filter(r => r.url.includes('CIFRA')).map(r => r.url);
```

Saída esperada: um array com **uma** URL contendo `prec%CC%A7o`.

3. Limpe a flag para forçar a migração e recarregue:

```js
localStorage.removeItem('plpc_pdf_cache_nfc_migration_v1'); location.reload();
```

4. Depois do reload, no console:

```js
const c = await caches.open('plpc-pdfs');
(await c.keys()).filter(r => r.url.includes('CIFRA')).map(r => r.url);
```

**Sucesso:** um array com **uma** URL, agora contendo `pre%C3%A7o` (NFC), e nenhuma com `prec%CC%A7o`. O console traz `Migração NFC: 1 migradas, N mantidas, 0 erros`.

**Falha:** as duas URLs presentes (o `delete` não rodou — verifique se a exceção foi engolida) ou só a NFD (a migração não rodou — a flag ainda estava `true`, ou o `OfflineManager.initialize` não foi chamado nesta rota; abra `/offline`, que o chama sempre).

5. Ponha o navegador em **Offline** (DevTools → Network) e abra pelo leitor um dos oito louvores da lista do Step 1 que você tenha baixado — `Alto preço - CIFRA` em `PES` é o mais direto. **Sucesso:** o PDF renderiza. **Falha:** a mensagem "PDF não está disponível offline. Por favor, baixe primeiro".

- [ ] **Step 10: Registrar os testes novos no runner**

Em `package.json`, acrescente os dois arquivos ao fim da lista do script `test`:

```
… src/lib/offline/utils/PdfPathManager.encoder.test.js src/lib/offline/utils/PdfPathManager.nfc.test.js src/lib/offline/storage/pdfCacheNfcMigration.test.js"
```

```bash
npm test
```

Saída esperada: `# fail 0`.

- [ ] **Step 11: Commit**

```bash
git add src/lib/offline/utils/PdfPathManager.js \
        src/lib/offline/utils/PdfPathManager.nfc.test.js \
        src/lib/offline/storage/pdfCacheNfcMigration.js \
        src/lib/offline/storage/pdfCacheNfcMigration.test.js \
        src/lib/stores/offline.js \
        src/lib/offline/core/OfflineManager.js \
        package.json
git commit -m "fix(pdf): unificar a forma Unicode em NFC e migrar as chaves NFD gravadas (#22.2)"
```

---

### Task 7: O índice de disponibilidade sobre a chave real (#22.3)

O índice que responde "este louvor já está baixado" tem dois defeitos que se somam. O primeiro: `src/lib/utils/pdfIndex.js:51-53` monta o índice com `urlNormalizer.normalizePdfUrl` — a normalização **perdedora**, minúscula e sem acento. Ela é aplicada aos dois lados da comparação, então é internamente consistente e não invalida nada já gravado; mas mantém viva a função que esta fase existe para apagar, e é uma segunda régua num sistema que precisa de uma só. O segundo é muito pior: `buildPdfCacheIndex` (`src/lib/utils/pdfCacheIndex.js:60-88`) mantém um **segundo Set indexado por nome de arquivo** e, quando o caminho não bate, aceita qualquer entrada em cache com o mesmo *basename* (`:85-86`). **3311 dos 4629 caminhos do acervo partilham nome de arquivo com outro, e 1036 se chamam `Cifra I.pdf`.** Na prática, basta um `Cifra I.pdf` qualquer estar em cache para o índice responder "tem" a mais de mil louvores que não estão baixados. O próprio código já registra a desconfiança: `src/lib/stores/offline.js:703-712` documenta, por escrito, que evita este índice de propósito — "`buildPdfCacheIndex` também casa por nome de arquivo, e como quase toda parte tem um `Coro.pdf` isso daria falso positivo justamente na hora de decidir se uma parte pode ser pulada". É a evidência interna de que a estratégia já era conhecida como defeituosa; esta tarefa a remove em vez de contorná-la.

Esta tarefa faz três coisas: troca a normalização do índice pela vencedora; bumpa `INDEX_VERSION` de `1` para `2` (`src/lib/utils/pdfIndex.js:10`) para que o índice antigo — construído com a régua errada e contaminado pelos falsos positivos — seja descartado no próximo carregamento em vez de esperar as 24 h de TTL (`loadPdfIndex:148-152` já faz isso sozinho ao ver versão diferente); e apaga o fallback por basename, junto com a função `basenameOf` que só existia para servi-lo.

**Quem consome este índice, e o que muda para cada um.** Há **quatro** call-sites de `buildPdfCacheIndex`, não dois — o relatório de investigação lista apenas os dois primeiros, e os dois últimos foram encontrados por grep (Step 1). O terceiro e o quarto são o motivo pelo qual esta tarefa **não pode** se limitar a apagar o fallback:

| # | call-site | quem lê o resultado | o que muda |
|---|---|---|---|
| 1 | `pdfIndex.js:51` (`generatePdfIndex`) | `pdfAvailabilityIndex` no `localStorage` → `isPdfAvailableInIndex` (`pdfIndex.js:173`) → `IndexValidator.js:63`, `LouvorCard.svelte:140`, `navigateLouvorToLeitor.js:44` | deixa de responder "tem" por homônimo; o índice velho é descartado pelo bump de versão |
| 2 | `pdfValidation.js:280` (`findMissingPdfs`) | `offline.js:1554`, `missingPdfsDownloader.js:87`, `DownloadManager.js:146`, `StatsCalculator.js:156,165` | a contagem de "PDFs faltando" **sobe** e as estatísticas por categoria passam a mostrar a cobertura verdadeira |
| 3 | `offline.js:812` (`wantedIndex`, download por categoria) | `offline.js:977` decide se grava uma entrada do ZIP | **precisa ganhar `options.normalize` nesta tarefa.** Sem o fallback e sem a normalização canônica, um caminho em NFD vindo do `pdfId` deixa de casar com a entrada de ZIP já canonizada pela Tarefa 6, e o PDF é pulado **em silêncio** |
| 4 | `offline.js:1813` (`wantedIndex`, segundo fluxo) | `offline.js:1998` | idem |

**Efeito colateral esperado e desejado:** em aparelhos que baixaram só parte do acervo, a contagem de "PDFs faltando" vai subir e algumas categorias vão deixar de aparecer como completas. Não é regressão: é o número verdadeiro aparecendo pela primeira vez. Antes, homônimos escondiam as lacunas.

Sucesso = nenhuma chamada a `normalizePdfUrl` sobra em `pdfIndex.js`; `INDEX_VERSION` é `2`; `buildPdfCacheIndex` responde `false` para um caminho ausente cujo homônimo esteja em cache; e o download por categoria continua gravando os 8 caminhos NFD.

**Files:**
- Modify: `src/lib/utils/pdfCacheIndex.js:1-10` (docstring), `:41-49` (apagar `basenameOf`), `:60-88` (apagar o Set de basenames e o fallback)
- Modify: `src/lib/utils/pdfIndex.js:6` (import), `:10` (`INDEX_VERSION`), `:49-53` (normalizador)
- Modify: `src/lib/utils/pdfValidation.js:278-280`
- Modify: `src/lib/stores/offline.js:703-712` (comentário), `:811-812`, `:1812-1813`
- Test: `src/lib/utils/pdfCacheIndex.test.js` (já está na lista do script `test`)

**Interfaces:**
- Consumes:
  - `PdfPathManager.normalizeForStorage(pdfPath: string): string` — das Tarefas 5 e 6: caminho canônico, sem barra inicial, prefixo `assets/`, caixa e acento preservados, forma Unicode NFC.
  - O import `import PdfPathManager from '$lib/offline/utils/PdfPathManager.js';` já existe em `src/lib/utils/pdfValidation.js` (Tarefa 5, Step 5) e em `src/lib/stores/offline.js` (Tarefa 6, Step 4). Não duplique.
- Produces:
  - `buildPdfCacheIndex(cachedUrls: string[] | null, options?: {normalize?: (path: string) => string}): {size: number, has: (candidate: string) => boolean}` — assinatura inalterada, semântica estreitada: **`has` passa a ser correspondência exata de caminho**, sem fallback por nome de arquivo.
  - `basenameOf` **deixa de existir**. Atenção: ela é exportada e hoje tem consumidor — `src/lib/utils/pdfCacheIndex.test.js:7,40-45`. O Step 2 remove esse consumidor junto.
  - `INDEX_VERSION = 2` em `pdfIndex.js`, o que descarta o `localStorage.pdfAvailabilityIndex` de todo aparelho no próximo carregamento.

- [ ] **Step 1: Medir o alcance do falso positivo e listar os consumidores reais**

```bash
cd "$(git rev-parse --show-toplevel)" && node -e "
const fs=require('fs');
const m=JSON.parse(fs.readFileSync('louvores-manifest.json','utf8'));
const paths=m.map(l=>{let p=Buffer.from(l.pdfId,'base64').toString('utf8').replace(/^\/+/,'').trim();
  if(!p.toLowerCase().startsWith('assets/'))p='assets/'+p; return p;});
const c={}; for(const p of paths){const b=p.split('/').pop(); c[b]=(c[b]||0)+1;}
console.log('caminhos                        :', paths.length);
console.log('nomes de arquivo distintos      :', Object.keys(c).length);
console.log('caminhos com basename partilhado:', paths.filter(p=>c[p.split('/').pop()]>1).length);
console.log('quantos se chamam Cifra I.pdf   :', c['Cifra I.pdf']);
"
```

Saída esperada, exatamente:

```
caminhos                        : 4629
nomes de arquivo distintos      : 1749
caminhos com basename partilhado: 3311
quantos se chamam Cifra I.pdf   : 1036
```

Agora os consumidores. Estes dois comandos são a verificação que a tabela da introdução afirma:

```bash
grep -rn --include='*.js' --include='*.svelte' 'buildPdfCacheIndex' src | grep -v 'pdfCacheIndex.js:'
grep -rn --include='*.js' --include='*.svelte' 'basenameOf' src
```

Saída esperada do primeiro (quatro call-sites de produção mais os imports e o teste):

```
src/lib/stores/offline.js:15:import { buildPdfCacheIndex, toComparablePath } from '$lib/utils/pdfCacheIndex.js';
src/lib/stores/offline.js:706: * Estrito de propósito: `buildPdfCacheIndex` também casa por nome de arquivo, e
src/lib/stores/offline.js:812:  const wantedIndex = buildPdfCacheIndex(pdfUrls);
src/lib/stores/offline.js:1813:  const wantedIndex = buildPdfCacheIndex(pdfUrls);
src/lib/utils/pdfValidation.js:10:import { buildPdfCacheIndex } from './pdfCacheIndex.js';
src/lib/utils/pdfValidation.js:280:  const cacheIndex = buildPdfCacheIndex(cachedPdfs);
src/lib/utils/pdfIndex.js:7:import { buildPdfCacheIndex } from './pdfCacheIndex.js';
src/lib/utils/pdfIndex.js:51:    const cacheIndex = buildPdfCacheIndex(cachedPdfs, {
```

E do segundo, três ocorrências em `pdfCacheIndex.js` (`:45`, `:75`, `:85`) e três em `pdfCacheIndex.test.js` (`:7`, `:42`, `:43`). **Nenhum outro módulo importa `basenameOf`** — é o que autoriza apagá-la. Se o grep mostrar um import fora desses dois arquivos, pare e reavalie.

- [ ] **Step 2: Teste que falha — o homônimo deixa de contar**

Os testes de hoje **exigem** o falso positivo: `src/lib/utils/pdfCacheIndex.test.js:59-62` e `:86-90` afirmam que o índice acerta por nome de arquivo. Inverta os dois, apague o bloco de `basenameOf`, e acrescente o caso do acervo real.

Substitua a linha `:7`:

```js
import { toComparablePath, basenameOf, buildPdfCacheIndex } from './pdfCacheIndex.js';
```

por:

```js
import { toComparablePath, buildPdfCacheIndex } from './pdfCacheIndex.js';
import PdfPathManager from '../offline/utils/PdfPathManager.js';
```

Apague o bloco inteiro de `:40-45`:

```js
describe('basenameOf', () => {
  it('devolve o último segmento', () => {
    assert.equal(basenameOf('assets/ColAdultos/001.pdf'), '001.pdf');
    assert.equal(basenameOf('001.pdf'), '001.pdf');
  });
});
```

Substitua o caso de `:59-62`:

```js
  it('acerta por nome de arquivo quando o diretório difere', () => {
    const index = buildPdfCacheIndex(cached);
    assert.equal(index.has('assets/OutraPasta/001.pdf'), true);
  });
```

por:

```js
  it('NÃO acerta por nome de arquivo quando o diretório difere (#22.3)', () => {
    // Era o fallback F6. Com 3311 dos 4629 caminhos do acervo partilhando
    // basename, ele fazia o índice mentir para milhares de louvores.
    const index = buildPdfCacheIndex(cached);
    assert.equal(index.has('assets/OutraPasta/001.pdf'), false);
  });
```

Substitua o caso de `:86-90`:

```js
  it('substitui a antiga Estratégia 3: sufixo com mesmo nome de arquivo', () => {
    // cached tem prefixo extra; a comparação por basename cobre o caso.
    const index = buildPdfCacheIndex(['/prefixo/extra/assets/ColAdultos/001.pdf']);
    assert.equal(index.has('assets/ColAdultos/001.pdf'), true);
  });
```

por:

```js
  it('a antiga Estratégia 3 (sufixo) também sai: só caminho exato conta', () => {
    const index = buildPdfCacheIndex(['/prefixo/extra/assets/ColAdultos/001.pdf']);
    assert.equal(index.has('assets/ColAdultos/001.pdf'), false);
  });

  it('o caso real: 1036 louvores se chamam Cifra I.pdf e não são o mesmo PDF', () => {
    const emCache = ['https://plpcg.com/assets/Coletanea/001 - Louvor A/Cifra I.pdf'];
    const index = buildPdfCacheIndex(emCache);
    assert.equal(index.has('assets/Coletanea/001 - Louvor A/Cifra I.pdf'), true);
    assert.equal(index.has('assets/Coletanea/002 - Louvor B/Cifra I.pdf'), false);
    assert.equal(index.has('assets/PES/Cifra I.pdf'), false);
  });

  it('com normalizeForStorage nos dois lados, NFD e NFC casam', () => {
    // É esta a régua que os quatro consumidores passam a usar. Sem ela, os 8
    // caminhos NFD do acervo (Tarefa 6, Step 1) deixariam de casar assim que o
    // fallback por basename saísse.
    const normalize = (/** @type {string} */ p) => PdfPathManager.normalizeForStorage(p);
    const nfd = 'assets/PES/Alto preço - CIFRA.pdf'.normalize('NFD');
    const nfc = 'assets/PES/Alto preço - CIFRA.pdf'.normalize('NFC');
    const index = buildPdfCacheIndex([`https://plpcg.com/${nfd}`], { normalize });
    assert.equal(index.has(nfc), true);
  });
```

```bash
node --test src/lib/utils/pdfCacheIndex.test.js
```

Saída esperada: `# fail 3` — falham `NÃO acerta por nome de arquivo`, `a antiga Estratégia 3 (sufixo) também sai` e `o caso real: 1036 louvores…`, todos com

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

true !== false
```

O último caso (`NFD e NFC casam`) já passa, porque a Tarefa 6 pôs o NFC em `normalizeForStorage`.

- [ ] **Step 3: Apagar o fallback por basename e a função que o servia**

Em `src/lib/utils/pdfCacheIndex.js`, substitua a docstring de `:1-10`:

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
```

por:

```js
/**
 * Índice de PDFs em cache. Correspondência **exata** de caminho, e só ela.
 *
 * Até #22.3 havia um segundo Set indexado por nome de arquivo: se o caminho não
 * batesse, o índice aceitava qualquer entrada em cache com o mesmo basename.
 * Como 3311 dos 4629 caminhos do acervo partilham nome de arquivo — 1036 se
 * chamam `Cifra I.pdf` —, isso fazia o índice responder "tem" para milhares de
 * louvores que não estavam baixados. Era o falso positivo de maior alcance do
 * sistema, e `stores/offline.js` já o evitava de propósito.
 *
 * Quem precisa casar caixa, acento e forma Unicode passa `options.normalize`
 * (use `PdfPathManager.normalizeForStorage`), que é aplicado aos dois lados.
 *
 * Só importa por caminho relativo — precisa rodar sob `node --test`.
 */
```

Apague a função inteira de `:41-49`:

```js
/**
 * @param {string} path
 * @returns {string}
 */
export function basenameOf(path) {
  if (!path) return '';
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}
```

E substitua o corpo de `buildPdfCacheIndex` (`:60-88`) por:

```js
export function buildPdfCacheIndex(cachedUrls, options = {}) {
  const normalize =
    typeof options.normalize === 'function' ? options.normalize : (/** @type {string} */ p) => p;

  /** @type {Set<string>} */
  const byPath = new Set();

  const list = Array.isArray(cachedUrls) ? cachedUrls : [];

  for (const url of list) {
    const path = normalize(toComparablePath(url));
    if (!path) continue;
    byPath.add(path);
  }

  return {
    size: byPath.size,
    has(candidate) {
      // #22.3: só caminho exato. O fallback por nome de arquivo saiu daqui.
      const path = normalize(toComparablePath(candidate));
      if (!path) return false;
      return byPath.has(path);
    }
  };
}
```

```bash
node --test src/lib/utils/pdfCacheIndex.test.js
```

Saída esperada: `# fail 0`, com 11 casos passando.

- [ ] **Step 4: O índice de disponibilidade sobre a régua vencedora**

Em `src/lib/utils/pdfIndex.js`, substitua o import de `:6`:

```js
import urlNormalizer from '$lib/offline/normalization/UrlNormalizer.js';
```

por:

```js
import PdfPathManager from '$lib/offline/utils/PdfPathManager.js';
```

Substitua `:10`:

```js
const INDEX_VERSION = 1;
```

por:

```js
// #22.3: bumpado de 1 para 2 porque o índice gravado antes desta versão foi
// construído com a normalização minúscula e contaminado pelo falso positivo de
// basename. `loadPdfIndex` (:148-152) descarta sozinho o de versão diferente —
// é como o índice velho morre no próximo carregamento, e não em 24 h de TTL.
const INDEX_VERSION = 2;
```

Substitua `:49-53`:

```js
    // Mesma normalização de antes (minúsculas + sem acento), agora aplicada
    // uma vez na indexação e uma vez na consulta.
    const cacheIndex = buildPdfCacheIndex(cachedPdfs, {
      normalize: (path) => urlNormalizer.normalizePdfUrl(path)
    });
```

por:

```js
    // #22.3: a régua canônica — preserva caixa e acento e unifica a forma
    // Unicode. Aplicada aos dois lados (lista em cache e candidato), como antes.
    const cacheIndex = buildPdfCacheIndex(cachedPdfs, {
      normalize: (path) => PdfPathManager.normalizeForStorage(path)
    });
```

Confirme que `normalizePdfUrl` sumiu deste arquivo:

```bash
grep -n 'urlNormalizer\|normalizePdfUrl' src/lib/utils/pdfIndex.js; echo "exit=$?"
```

Saída esperada: nenhuma linha e `exit=1`.

- [ ] **Step 5: `findMissingPdfs` sobre a mesma régua**

Em `src/lib/utils/pdfValidation.js:278-280`, substitua:

```js
  // Índice O(1) dos PDFs em cache (caminhos decodificados, sem normalização —
  // preserva maiúsculas/minúsculas e acentos, como antes).
  const cacheIndex = buildPdfCacheIndex(cachedPdfs);
```

por:

```js
  // Índice O(1) dos PDFs em cache. #22.3: correspondência exata de caminho, com
  // a normalização canônica nos dois lados. A contagem de faltantes sobe em
  // relação à versão anterior — é o número verdadeiro: antes, um homônimo em
  // cache escondia a lacuna.
  const cacheIndex = buildPdfCacheIndex(cachedPdfs, {
    normalize: (/** @type {string} */ path) => PdfPathManager.normalizeForStorage(path)
  });
```

O import de `PdfPathManager` já foi acrescentado no topo deste arquivo pela Tarefa 5 (Step 5). Confirme antes de rodar:

```bash
grep -n "import PdfPathManager" src/lib/utils/pdfValidation.js
```

Saída esperada: uma linha, `import PdfPathManager from '$lib/offline/utils/PdfPathManager.js';`. Se não houver, acrescente-a.

- [ ] **Step 6: Os dois `wantedIndex` do download por categoria**

Este é o passo que impede uma regressão silenciosa. `offline.js:812` e `:1813` montam um índice dos PDFs **pedidos** e o consultam em `:977` e `:1998` para decidir se gravam uma entrada do ZIP. Até agora, era o fallback por basename que fazia esse `has` acertar quando os dois lados discordavam na forma Unicode. Sem ele e sem a régua canônica, os 8 caminhos NFD do acervo seriam pulados sem erro nenhum.

Em `src/lib/stores/offline.js:811-812`, substitua:

```js
  // Índice O(1) dos PDFs desejados; `remaining` controla o que ainda falta gravar.
  const wantedIndex = buildPdfCacheIndex(pdfUrls);
```

por:

```js
  // Índice O(1) dos PDFs desejados; `remaining` controla o que ainda falta gravar.
  // #22.3: os dois lados passam pela régua canônica. Sem isto, e sem o fallback
  // por nome de arquivo que acabou de sair, um caminho em NFD vindo do `pdfId`
  // nunca casaria com a entrada de ZIP já canonizada — o PDF seria pulado aqui
  // em silêncio, sem erro e sem log.
  const wantedIndex = buildPdfCacheIndex(pdfUrls, {
    normalize: (/** @type {string} */ path) => PdfPathManager.normalizeForStorage(path)
  });
```

Aplique **exatamente a mesma substituição** em `src/lib/stores/offline.js:1812-1813`, que é o mesmo trecho duplicado no segundo fluxo de download.

E atualize o comentário de `:703-712`, que descrevia o defeito que acabou de ser removido. Substitua:

```js
/**
 * Conjunto estrito dos caminhos que já estão no cache de PDFs.
 *
 * Estrito de propósito: `buildPdfCacheIndex` também casa por nome de arquivo, e
 * como quase toda parte tem um "Coro.pdf" isso daria falso positivo justamente
 * na hora de decidir se uma parte pode ser pulada.
 *
 * @param {Cache} cache
 * @returns {Promise<Set<string> | null>} null quando não deu para ler o cache
 */
```

por:

```js
/**
 * Conjunto dos caminhos que já estão no cache de PDFs.
 *
 * Era "estrito de propósito" porque `buildPdfCacheIndex` casava por nome de
 * arquivo e daria falso positivo justamente na hora de decidir se uma parte pode
 * ser pulada. #22.3 removeu esse fallback: o índice agora é tão estrito quanto
 * este Set, e esta função sobrevive só por ser o caminho mais direto para ler o
 * cache de uma vez.
 *
 * @param {Cache} cache
 * @returns {Promise<Set<string> | null>} null quando não deu para ler o cache
 */
```

```bash
npm run build && npm test
```

Saída esperada: build conclui (`✓ built in …`); `# fail 0` em todos os arquivos.

- [ ] **Step 7: Verificação em navegador — o índice para de mentir, e o download continua completo**

Testes unitários não provam `cache.match` nem o índice real. Este passo prova as duas coisas.

1. `npm run build && npm run preview`, abra `http://localhost:4173` no Chrome.
2. DevTools → Application → Service Workers → **Update on reload**; recarregue com Ctrl+Shift+R até o SW ficar *activated and is running* com o build novo.
3. Application → Storage → **Clear site data** (marque Cache Storage e Local/Session Storage). Recarregue.
4. Vá a `/offline` e baixe **uma só** categoria que contenha louvores chamados `Cifra I.pdf` — `Louvores Coletânea de Partituras` é a maior fonte deles; se for grande demais para o seu tempo, qualquer categoria serve desde que o passo 6 encontre um alvo. Espere o progresso chegar a 100 %.
5. Force a reconstrução do índice e volte para a biblioteca:

```js
localStorage.removeItem('pdfAvailabilityIndex');
sessionStorage.removeItem('pdfIndexLastVerification');
location.href = '/biblioteca';
```

Espere uns 5 segundos (o índice é reconstruído em segundo plano com debounce de 2 s).

6. No console da **página**, procure um louvor **não baixado** cujo homônimo esteja em cache, e pergunte ao índice:

```js
const manifesto = await (await fetch('/louvores-manifest.json')).json();
const decodifica = (id) => new TextDecoder().decode(Uint8Array.from(atob(id), (c) => c.charCodeAt(0)));
const caminhoDe = (l) => {
  let p = decodifica(l.pdfId).replace(/^\/+/, '').trim();
  return p.toLowerCase().startsWith('assets/') ? p : `assets/${p}`;
};
const c = await caches.open('plpc-pdfs');
const emCache = new Set((await c.keys()).map((r) => decodeURIComponent(new URL(r.url).pathname).replace(/^\/+/, '')));
const baseEmCache = new Set([...emCache].map((p) => p.split('/').pop()));
const alvo = manifesto.find((l) => {
  const p = caminhoDe(l);
  return !emCache.has(p) && baseEmCache.has(p.split('/').pop());
});
const indice = JSON.parse(localStorage.getItem('pdfAvailabilityIndex'));
console.log('versão do índice :', indice.version);
console.log('alvo            :', alvo && alvo.nome, '|', alvo && caminhoDe(alvo));
console.log('índice diz       :', indice.index[alvo.pdfId]);
```

**Sucesso:** `versão do índice : 2`, o `alvo` é um louvor real de outra pasta com o mesmo nome de arquivo, e `índice diz : false`.

**Falha:** `índice diz : true` — o fallback por basename ainda está vivo em algum ponto; confira se o `has` de `pdfCacheIndex.js` foi mesmo substituído e se o índice foi reconstruído (se `versão do índice` vier `1`, ele não foi: repita o passo 5). Se `alvo` vier `undefined`, a categoria que você baixou não tem homônimos fora dela — baixe também `PES` e repita.

7. Confirme na UI: abra `/biblioteca`, filtre por uma categoria que você **não** baixou e olhe os cartões. **Sucesso:** eles aparecem como não disponíveis offline. **Falha:** um cartão de categoria não baixada marcado como disponível.

8. Agora prove que o download não regrediu. Ainda em `/offline`, baixe uma **segunda** categoria e espere terminar. No console:

```js
const c = await caches.open('plpc-pdfs');
(await c.keys()).length
```

**Sucesso:** o total sobe pelo número de PDFs da segunda categoria (a tela de `/offline` mostra o esperado), e a categoria aparece marcada como baixada. **Falha:** o progresso trava abaixo de 100 % ou a contagem fica curta — nesse caso o `wantedIndex` do Step 6 está estreito demais; procure no console por `PDF not found in cache` e compare o caminho relatado com a chave em Cache Storage.

9. Por fim, DevTools → Network → **Offline**, e abra pelo leitor três louvores da categoria baixada. **Sucesso:** os três renderizam. **Falha:** "PDF não está disponível offline. Por favor, baixe primeiro" — pare e não avance para a Tarefa 8.

- [ ] **Step 8: Commit**

```bash
git add src/lib/utils/pdfCacheIndex.js \
        src/lib/utils/pdfCacheIndex.test.js \
        src/lib/utils/pdfIndex.js \
        src/lib/utils/pdfValidation.js \
        src/lib/stores/offline.js
git commit -m "fix(pdf): indexar disponibilidade pela chave real e remover o fallback por nome de arquivo (#22.3)"
```

---

### Task 8: Remover as estratégias que podem devolver o PDF errado (#22.4)

Três estratégias de correspondência difusa não comparam caminhos: comparam *pedaços* de caminho. **F4** (`src/lib/offline/storage/CacheStorageAdapter.js:220-246`) tenta, como último recurso, `new Request(normalizedPath.split('/').pop())` — o **nome do arquivo nu**. **F9** (`src/lib/stores/offline.js:1333-1359`) aceita `cached.endsWith(pdfPath)`, ou o mesmo nome de arquivo desde que `cachedDir.includes(expectedDir)`. **F10** (`src/lib/stores/offline.js:1495`) usa `cached.includes(pdfUrl)` — substring pura, numa lista de milhares de URLs. Com 1036 arquivos chamados `Cifra I.pdf` e 254 chamados `Gestos CIAs.pdf`, qualquer acerto por nome de arquivo é, por construção, um acerto no PDF errado. O código já sabe disso: `src/lib/stores/offline.js:1282-1286` força `strictMode = true` só para a categoria `Gestos em Gravura`, com o comentário "This category has many PDFs with the same filename, causing validation issues".

**O que a medição mostrou, e onde ela contraria o relatório de investigação.** O relatório classifica F9 e F10 como "falso positivo garantido pelo basename". Executando as três regras sobre os 4629 caminhos reais (Step 1), o falso positivo **não acontece hoje: são 0**. O defeito real é o oposto e é maior. `encodeURI` não altera **2032** dos 4629 caminhos; nos outros **2597** ele escapa espaço ou acento. Como a chave gravada no cache é a URL codificada e `pdfPath` é o caminho decodificado, `cached.endsWith(pdfPath)` e `cached.includes(pdfUrl)` só podem casar nos 2032 — **56 % do acervo é invisível para F9 e F10 pela própria regra deles**. Num cenário medido (categoria `Cifra` inteira baixada, 652 PDFs), F9 não encontra 40 dos 652 que estão de fato em cache, e F10 declara "novo" esses mesmos 40, mandando baixá-los de novo a cada mudança de manifesto. Ou seja: as duas estratégias são **estritamente dominadas** pela chave exata — nunca acertam algo que ela não acerte, e erram 6 % do que ela acerta. O falso positivo continua sendo um risco **estrutural** (o Step 3 exibe o caso: basta o acervo ganhar um `assets/ColCIAs/2026/001.pdf` para `assets/ColCIAs/001.pdf` passar a "existir"), mas o argumento que autoriza a remoção hoje é mais forte que ele: não há nada a perder.

F4 é mais simples ainda de justificar. Depois das Tarefas 5 e 6, medi as três variações que ela adiciona sobre os 4629 caminhos: a primeira é **byte a byte igual** à URL canônica em 4629 de 4629; a segunda também, porque `normalizeForStorage` desfaz o `encodeURIComponent` antes de recodificar (`PdfPathManager.js:37-43`); e a terceira, o basename nu, `new Request` resolve contra o diretório da página — `new URL('Coro.pdf', 'https://plpcg.com/biblioteca')` dá `https://plpcg.com/Coro.pdf`, que nunca é uma chave de `plpc-pdfs` (todas começam em `/assets/`). F4 são, portanto, **duas repetições exatas de um `cache.match` que acabou de ser feito, mais uma que só poderia acertar o PDF errado.**

**Sobre o `strictMode`: ele deixa de ser necessário, e esta tarefa o remove.** O único efeito de `strictMode` é pular o bloco de fallback de `:1324-1360`. Removido o bloco, o modo estrito passa a ser o comportamento de todas as categorias, e a exceção codificada para `Gestos em Gravura` — que é um nome de categoria escrito à mão dentro de uma função genérica — sai junto, com o parâmetro.

Sucesso = `npm test` verde com um teste novo que prova, sobre caminhos reais do acervo, que a chave exata cobre tudo que as três estratégias cobriam; nenhuma menção a `Gestos em Gravura` sobra em `offline.js`; e a verificação em navegador mostra os PDFs abrindo offline e as categorias baixadas continuando marcadas como completas.

**Files:**
- Create: `src/lib/utils/correspondenciaExata.test.js`
- Modify: `src/lib/offline/storage/CacheStorageAdapter.js:12-17` (import), `:220-246` (apagar F4)
- Modify: `src/lib/stores/offline.js:1256-1264` (docstring e assinatura), `:1282-1296` (strictMode forçado e `cachedPdfsSet`), `:1324-1360` (apagar F9), `:1362-1369` (log), `:1495` (apagar F10), `:2756` (call site)
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes:
  - `PdfPathManager.createRequestUrl(pdfPath: string, origin?: string | null): string` e `PdfPathManager.normalizeForStorage(pdfPath: string): string` — Tarefas 5 e 6.
  - `buildPdfCacheIndex(cachedUrls, options?: {normalize?: (path: string) => string})` com **correspondência exata** — Tarefa 7. Já importado em `src/lib/stores/offline.js:15`.
- Produces:
  - `CacheStorageAdapter.getPdf(pdfPath)` — mesma assinatura; deixa de ter o bloco de fallback. As variações de `createSearchVariations` continuam por enquanto: a Tarefa 9 as remove.
  - `isCategoryCompletelyDownloaded(category, cachedPdfs, louvoresData)` — **o quarto parâmetro `strictMode` deixa de existir**. Quem chamava com `true` (`src/lib/stores/offline.js:2756`) passa a chamar com três argumentos.

- [ ] **Step 1: Medir o que as três estratégias realmente fazem sobre o acervo**

Este comando não altera nada. Ele produz os números que o resto da tarefa afirma.

```bash
cd "$(git rev-parse --show-toplevel)" && node -e "
const fs=require('fs');
const m=JSON.parse(fs.readFileSync('louvores-manifest.json','utf8'));
const dec=l=>{let p=Buffer.from(l.pdfId,'base64').toString('utf8').replace(/^\/+/,'').trim();
  if(!p.toLowerCase().startsWith('assets/'))p='assets/'+p; return p;};
const O='https://plpcg.com', enc=p=>O+encodeURI('/'+p);
const todos=m.map(dec);
console.log('caminhos                          :', todos.length);
console.log('caminhos que encodeURI NAO altera :', todos.filter(p=>encodeURI('/'+p)==='/'+p).length);
// A regra de F9, copiada de offline.js:1335-1353
function f9(arr,pdfPath){ return arr.some(cached=>{
  if(cached===pdfPath) return true;
  if(cached.endsWith(pdfPath)) return true;
  const cf=cached.split('/').pop(), ef=pdfPath.split('/').pop();
  if(cf&&ef&&cf===ef){const cd=cached.replace(cf,''),ed=pdfPath.replace(ef,'');
    if(cd&&ed&&cd.includes(ed))return true;}
  return false; }); }
const baixados=m.filter(l=>l.categoria==='Cifra').map(dec);
const arr=baixados.map(enc), emCache=new Set(arr);
const naoBaixados=todos.filter(p=>!emCache.has(enc(p)));
console.log('cenario: categoria Cifra baixada  :', baixados.length, 'PDFs');
console.log('F9 falso positivo (nao baixados)  :', naoBaixados.filter(p=>f9(arr,p)).length);
console.log('F9 NAO acha o que esta em cache   :', baixados.filter(p=>!f9(arr,p)).length);
console.log('F10 diz NOVO o que esta em cache  :', baixados.filter(p=>!arr.some(c=>c.includes('/'+p))).length);
let fpGlobal=0; const encAll=todos.map(enc);
for(let i=0;i<todos.length;i++){ for(let j=0;j<encAll.length;j++){ if(i===j)continue;
  if(f9([encAll[j]],todos[i])){fpGlobal++;break;} } }
console.log('F9 falso positivo no acervo INTEIRO:', fpGlobal);
"
```

Saída esperada, exatamente:

```
caminhos                          : 4629
caminhos que encodeURI NAO altera : 2032
cenario: categoria Cifra baixada  : 652 PDFs
F9 falso positivo (nao baixados)  : 0
F9 NAO acha o que esta em cache   : 40
F10 diz NOVO o que esta em cache  : 40
F9 falso positivo no acervo INTEIRO: 0
```

Leia esses números assim: **hoje** as duas estratégias não inventam acertos, mas perdem 40 de 652 (6,1 %) do que a chave exata acha. Elas não são uma rede de segurança — são um buraco. Anote os números; o corpo do commit os cita.

- [ ] **Step 2: Teste que falha — a chave exata cobre tudo que F4 cobria**

Crie `src/lib/utils/correspondenciaExata.test.js`:

```js
/**
 * A chave exata cobre o que as estratégias difusas cobriam (#22.4).
 * Run: node --test src/lib/utils/correspondenciaExata.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import PdfPathManager from '../offline/utils/PdfPathManager.js';
import { encodeUrlComponentUtf8 } from './urlEncoding.js';
import { buildPdfCacheIndex } from './pdfCacheIndex.js';

const ORIGEM = 'https://plpcg.com';

/** Caminhos reais do acervo, escolhidos por exercitarem escape de URL. */
const REAIS = [
  'assets/ColCIAs/001.pdf',
  'assets/04112025/Conheçamos e prossigamos/Gestos CIAs.pdf',
  'assets/30102025/Sobe aqui [26-07-2025] - Coro.pdf',
  'assets/Louvores Coletânea de Partituras/255 - Meu Coração Engrandece ao Senhor - Cântico de Vitória/Cifra I.pdf'
];

/** A chave que os quatro escritores do cache gravam. */
const chave = (/** @type {string} */ p) => PdfPathManager.createRequestUrl(p, ORIGEM);

describe('F4 — o fallback do CacheStorageAdapter era duplicata e armadilha', () => {
  it('o primeiro fallback é byte a byte a chave canônica', () => {
    for (const p of REAIS) {
      const normalizado = PdfPathManager.normalizeForStorage(p);
      assert.equal(PdfPathManager.createRequestUrl(normalizado, ORIGEM), chave(p));
    }
  });

  it('o segundo fallback também: normalizeForStorage desfaz o encodeURIComponent', () => {
    for (const p of REAIS) {
      const normalizado = PdfPathManager.normalizeForStorage(p);
      const agressivo = encodeUrlComponentUtf8(normalizado);
      assert.equal(PdfPathManager.createRequestUrl(agressivo, ORIGEM), chave(p));
    }
  });

  it('o terceiro fallback, o basename nu, nunca resolve para /assets/', () => {
    // `new Request('Cifra I.pdf')` resolve contra o diretório da página. Se um dia
    // acertasse, seria em outro PDF: 1036 arquivos do acervo se chamam assim.
    for (const pagina of ['https://plpcg.com/', 'https://plpcg.com/biblioteca', 'https://plpcg.com/leitor']) {
      for (const p of REAIS) {
        const basename = PdfPathManager.normalizeForStorage(p).split('/').pop() || '';
        const resolvida = new URL(basename, pagina).href;
        assert.ok(!resolvida.includes('/assets/'), `resolveu para dentro de assets: ${resolvida}`);
        assert.notEqual(resolvida, chave(p));
      }
    }
  });

  it('sobre os 4629 caminhos reais, os dois primeiros fallbacks são a chave canônica', () => {
    const manifesto = 'louvores-manifest.json';
    if (!fs.existsSync(manifesto)) return; // fixture opcional: não versionado
    let divergentes = 0;
    for (const p of caminhosDoManifesto(manifesto)) {
      const normalizado = PdfPathManager.normalizeForStorage(p);
      if (PdfPathManager.createRequestUrl(normalizado, ORIGEM) !== chave(p)) divergentes++;
      if (PdfPathManager.createRequestUrl(encodeUrlComponentUtf8(normalizado), ORIGEM) !== chave(p)) divergentes++;
    }
    assert.equal(divergentes, 0);
  });
});

/** @param {string} arquivo */
function caminhosDoManifesto(arquivo) {
  const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  return dados.map((/** @type {{pdfId: string}} */ l) => {
    let p = Buffer.from(l.pdfId, 'base64').toString('utf8').replace(/^\/+/, '').trim();
    if (!p.toLowerCase().startsWith('assets/')) p = `assets/${p}`;
    return p;
  });
}
```

```bash
node --test src/lib/utils/correspondenciaExata.test.js
```

Saída esperada: `# pass 4`, `# fail 0`. Os quatro casos **já passam** — eles não descrevem código a escrever, descrevem a propriedade que autoriza a remoção do Step 3. Se algum falhar, **não remova F4**: significa que as Tarefas 5 ou 6 não fecharam o codificador, e o fallback ainda está servindo alguém.

- [ ] **Step 3: Teste que falha — o que F9 e F10 fazem, e o que a chave exata faz**

Acrescente ao mesmo arquivo, depois do primeiro `describe`:

```js
/** A regra de F9, copiada verbatim de src/lib/stores/offline.js:1335-1353. */
function predicadoF9(/** @type {string[]} */ cache, /** @type {string} */ pdfPath) {
  return cache.some((cached) => {
    if (cached === pdfPath) return true;
    if (cached.endsWith(pdfPath)) return true;
    const cachedFilename = cached.split('/').pop();
    const expectedFilename = pdfPath.split('/').pop();
    if (cachedFilename && expectedFilename && cachedFilename === expectedFilename) {
      const cachedDir = cached.replace(cachedFilename, '');
      const expectedDir = pdfPath.replace(expectedFilename, '');
      if (cachedDir && expectedDir && cachedDir.includes(expectedDir)) return true;
    }
    return false;
  });
}

/** A regra de F10, copiada verbatim de src/lib/stores/offline.js:1495. */
function predicadoF10(/** @type {string[]} */ cache, /** @type {string} */ pdfUrl) {
  return cache.some((cached) => cached.includes(pdfUrl));
}

/** O substituto: índice exato com a régua canônica nos dois lados. */
function indiceExato(/** @type {string[]} */ cache) {
  return buildPdfCacheIndex(cache, {
    normalize: (/** @type {string} */ p) => PdfPathManager.normalizeForStorage(p)
  });
}

describe('F9 e F10 — dominadas pela chave exata', () => {
  const emCache = REAIS.map(chave);

  it('F9 não acha 3 dos 4 PDFs que estão de fato em cache', () => {
    // Só o caminho sem espaço nem acento sobrevive: a chave gravada é
    // percent-encoded e `pdfPath` não é, então endsWith falha nos outros três.
    const achados = REAIS.filter((p) => predicadoF9(emCache, p));
    assert.deepEqual(achados, ['assets/ColCIAs/001.pdf']);
  });

  it('F10 falha exatamente nos mesmos três', () => {
    const achados = REAIS.filter((p) => predicadoF10(emCache, `/${p}`));
    assert.deepEqual(achados, ['assets/ColCIAs/001.pdf']);
  });

  it('o índice exato acha os quatro', () => {
    const indice = indiceExato(emCache);
    for (const p of REAIS) {
      assert.equal(indice.has(p), true, `não achou: ${p}`);
    }
  });

  it('F9 arma um falso positivo assim que o acervo ganhar uma subpasta', () => {
    // Hoje o acervo não tem esse par (medido: 0 falsos positivos em 4629).
    // Mas a regra `cachedDir.includes(expectedDir)` já está pronta para ele.
    const cacheComSubpasta = [chave('assets/ColCIAs/2026/001.pdf')];
    assert.equal(predicadoF9(cacheComSubpasta, 'assets/ColCIAs/001.pdf'), true);
    // O índice exato responde a verdade: são dois PDFs diferentes.
    assert.equal(indiceExato(cacheComSubpasta).has('assets/ColCIAs/001.pdf'), false);
  });

  it('o caso Gestos em Gravura: 254 arquivos com o mesmo nome', () => {
    // É a categoria para a qual offline.js:1284-1286 força strictMode. Com a
    // chave exata, cada um dos 254 é ele mesmo — sem precisar de exceção.
    const a = 'assets/04112025/Conheçamos e prossigamos/Gestos CIAs.pdf';
    const b = 'assets/04112025/A luz que brilha mais que o sol/Gestos CIAs.pdf';
    const indice = indiceExato([chave(a)]);
    assert.equal(indice.has(a), true);
    assert.equal(indice.has(b), false);
  });
});
```

```bash
node --test src/lib/utils/correspondenciaExata.test.js
```

Saída esperada: `# pass 9`, `# fail 0`. Estes cinco casos são a prova de que remover F9 e F10 não perde nada e ganha os três de quatro que elas não achavam.

- [ ] **Step 4: Registrar o teste novo e vê-lo no runner**

Em `package.json`, acrescente o arquivo ao fim da lista do script `test` (mantenha tudo numa linha):

```
… src/lib/offline/storage/pdfCacheNfcMigration.test.js src/lib/utils/correspondenciaExata.test.js"
```

```bash
npm test
```

Saída esperada: a contagem total sobe em 9 e `# fail 0`.

- [ ] **Step 5: Apagar F4**

Em `src/lib/offline/storage/CacheStorageAdapter.js`, apague o bloco de `:220-246` inteiro:

```js
      // Last resort: Try additional variations with different UTF-8 encodings
      const fallbackVariations = [
        PdfPathManager.createRequestUrl(normalizedPath, window.location.origin),
        // Try with encodeUrlComponentUtf8 (more aggressive UTF-8 encoding)
        PdfPathManager.createRequestUrl(encodeUrlComponentUtf8(normalizedPath), window.location.origin),
        // Try filename-only matching as last resort (less reliable)
        normalizedPath.split('/').pop()
      ].filter(Boolean);

      for (const url of fallbackVariations) {
        try {
          const request = new Request(url);
          const response = await cache.match(request);
          if (response) {
            // Cache successful result
            this._variationCache.set(normalizedPath, {
              found: true,
              url: url,
              timestamp: Date.now()
            });
            logger.debug('CacheStorageAdapter', `PDF found in cache (fallback): ${normalizedPath}`);
            return response;
          }
        } catch (e) {
          // Continue to next variation
        }
      }
```

e ponha no lugar apenas o comentário que registra por quê:

```js
      // #22.4: o bloco de fallback saiu. Suas três tentativas eram, medidas
      // sobre os 4629 caminhos reais: a chave canônica de novo (4629/4629
      // idêntica), a mesma chave depois de um encodeURIComponent que
      // `normalizeForStorage` desfaz (4629/4629 idêntica), e o nome do arquivo
      // nu — que `new Request` resolve contra o diretório da página, nunca
      // contra /assets/, e que só poderia acertar outro PDF: 1036 arquivos do
      // acervo se chamam `Cifra I.pdf`.
```

Com isso `encodeUrlComponentUtf8` deixa de ser usado neste arquivo. Substitua o import de `:12-17`:

```js
import { 
  encodeUrlUtf8, 
  decodeUrlUtf8, 
  encodeUrlComponentUtf8, 
  decodeUrlComponentUtf8
} from '$lib/utils/urlEncoding.js';
```

por (o único ainda usado é `decodeUrlUtf8`, em `:547`):

```js
import { decodeUrlUtf8 } from '$lib/utils/urlEncoding.js';
```

Confirme:

```bash
grep -n 'encodeUrlComponentUtf8\|encodeUrlUtf8\|decodeUrlComponentUtf8' src/lib/offline/storage/CacheStorageAdapter.js; echo "exit=$?"
npm run build
```

Saída esperada: nenhuma linha, `exit=1`, e o build conclui.

- [ ] **Step 6: Apagar F9 e a exceção codificada de `Gestos em Gravura`**

Em `src/lib/stores/offline.js`, quatro edições no mesmo bloco.

**(a)** Docstring e assinatura, `:1256-1264`. Substitua:

```js
 * FIX: Added strict validation mode for problematic categories like "Gestos em Gravura"
 * that verifies directly in Cache Storage to avoid false positives from filename matching.
 * FIX: Now handles category normalization - aggregates "Cifra nível I" and "Cifra nível II" into "Cifra"
 * @param {string} category
 * @param {any[]} cachedPdfs
 * @param {any[]} louvoresData
 */
async function isCategoryCompletelyDownloaded(category, cachedPdfs, louvoresData, strictMode = false) {
```

por:

```js
 * #22.4: a verificação é sempre direta no Cache Storage. O antigo `strictMode`,
 * que existia para desligar um bloco de fallback difuso em "Gestos em Gravura",
 * saiu junto com o bloco — agora todas as categorias usam o modo estrito.
 * FIX: Now handles category normalization - aggregates "Cifra nível I" and "Cifra nível II" into "Cifra"
 * @param {string} category
 * @param {any[]} cachedPdfs - só sinaliza que a lista de cache já foi carregada
 * @param {any[]} louvoresData
 */
async function isCategoryCompletelyDownloaded(category, cachedPdfs, louvoresData) {
```

**(b)** O `strictMode` forçado e o `cachedPdfsSet`, `:1282-1296`. Apague os dois blocos:

```js
  // FIX: For "Gestos em Gravura", always use strict mode to avoid false positives
  // This category has many PDFs with the same filename, causing validation issues
  if (category === 'Gestos em Gravura') {
    strictMode = true;
  }

  // Use original paths for comparison (no normalization)
  // Create set of cached PDFs using original paths
  const cachedPdfsSet = new Set(
    cachedPdfs.map((/** @type {string} */ url) => {
      // Prepare path (remove leading slash for comparison)
      const path = url.replace(/^\/+/, '');
      return path;
    })
  );
```

Não ponha nada no lugar: `cachedPdfsSet` só era lido pelo bloco que sai em (c).

**(c)** O bloco de fallback, `:1324-1360`. Apague inteiro:

```js
    // Fallback strategies: Use original path comparison only if direct verification fails
    // This provides compatibility with old cache entries or edge cases
    if (!isCached && !strictMode) {
      // Strategy 1: Exact match in cached list
      if (cachedPdfsSet.has(pdfPath)) {
        isCached = true;
        foundPdfs.add(pdfPath);
      }
      
      // Strategy 2: Partial match (check if any cached path ends with expected path)
      if (!isCached) {
        isCached = Array.from(cachedPdfsSet).some(cached => {
          // Check if paths match (handling different URL formats)
          if (cached === pdfPath) return true;
          // Only accept if cached path ends with expected path (not vice versa)
          if (cached.endsWith(pdfPath)) return true;
          
          // Check filename match only if paths are similar
          const cachedFilename = cached.split('/').pop();
          const expectedFilename = pdfPath.split('/').pop();
          if (cachedFilename && expectedFilename && cachedFilename === expectedFilename) {
            // Additional check: paths should be similar (same directory structure)
            const cachedDir = cached.replace(cachedFilename, '');
            const expectedDir = pdfPath.replace(expectedFilename, '');
            if (cachedDir && expectedDir && cachedDir.includes(expectedDir)) {
              return true;
            }
          }
          
          return false;
        });
        
        if (isCached) {
          foundPdfs.add(pdfPath);
        }
      }
    }
```

e ponha no lugar:

```js
    // #22.4: as duas "estratégias de fallback" saíram. Medido sobre o acervo
    // real: elas não achavam 40 dos 652 PDFs de uma categoria de fato baixada
    // (a chave gravada é percent-encoded e `pdfPath` não é), e não achavam
    // nenhum que a verificação direta acima já não achasse.
```

**(d)** O log de `:1364-1369`, que menciona `strictMode`. Substitua:

```js
      if (missingCount <= 3) { // Log first 3 missing PDFs to avoid spam
        console.warn(`[Offline Store] PDF not found in cache: ${pdfUrl}`);
        if (strictMode) {
          console.warn(`[Offline Store] Strict mode: verified directly in cache storage - NOT FOUND`);
        }
      }
```

por:

```js
      if (missingCount <= 3) { // Log first 3 missing PDFs to avoid spam
        console.warn(`[Offline Store] PDF não encontrado no cache (verificação direta): ${pdfUrl}`);
      }
```

**(e)** O único call site que passava o quarto argumento, `:2756`. Substitua:

```js
    const isDownloaded = await isCategoryCompletelyDownloaded(category, cachedPdfs, louvoresData, true);
```

por:

```js
    // #22.4: o modo estrito é o único modo agora — não há mais quarto argumento.
    const isDownloaded = await isCategoryCompletelyDownloaded(category, cachedPdfs, louvoresData);
```

Confirme que nada sobrou:

```bash
grep -n 'strictMode\|Gestos em Gravura\|cachedPdfsSet' src/lib/stores/offline.js; echo "exit=$?"
```

Saída esperada: nenhuma linha e `exit=1`.

- [ ] **Step 7: Apagar F10**

Em `src/lib/stores/offline.js:1490-1496`, substitua:

```js
      const pdfUrl = getPdfUrl(louvor);
      if (!pdfUrl) {
        return false;
      }
      
      return !cachedPdfs.some(cached => cached.includes(pdfUrl));
```

por:

```js
      const pdfUrl = getPdfUrl(louvor);
      if (!pdfUrl) {
        return false;
      }
      
      // #22.4: era `cached.includes(pdfUrl)` — substring pura sobre milhares de
      // URLs. Como a chave gravada é percent-encoded, ela dizia "novo" para os
      // 2597 caminhos do acervo que têm espaço ou acento, mandando baixar de
      // novo o que já estava no aparelho a cada mudança de manifesto.
      return !indiceDeCache.has(pdfUrl);
```

e monte o índice **uma vez**, fora do `filter`. Logo antes de `const newPdfs = louvoresData.filter(...)` (`:1484`), insira:

```js
    const indiceDeCache = buildPdfCacheIndex(cachedPdfs, {
      normalize: (/** @type {string} */ path) => PdfPathManager.normalizeForStorage(path)
    });
```

`buildPdfCacheIndex` já está importado em `:15` e `PdfPathManager` foi importado pela Tarefa 6.

```bash
npm run build && npm test
```

Saída esperada: build conclui; `# fail 0`.

- [ ] **Step 8: Verificação em navegador — nada some, nada é baixado duas vezes**

Testes unitários não provam `cache.match`. Este passo prova, e é o único jeito de saber se a remoção quebrou alguma leitura real.

1. `npm run build && npm run preview`, abra `http://localhost:4173` no Chrome.
2. DevTools → Application → Service Workers → **Update on reload**; Ctrl+Shift+R até o SW aparecer como *activated and is running* com o build novo.
3. Application → Storage → **Clear site data**. Recarregue.
4. Em `/offline`, baixe **`Gestos em Gravura`** — é a categoria da exceção que acabou de sair, e tem 254 arquivos todos chamados `Gestos CIAs.pdf`. Espere 100 %.
5. **Sucesso imediato:** a categoria aparece marcada como baixada, com a contagem cheia (254). **Falha:** ela fica em "incompleta" ou com contagem parcial — nesse caso a remoção de F9 tirou algo que era necessário; o console traz `PDF não encontrado no cache (verificação direta): <url>` para os três primeiros faltantes. Compare essa URL com a chave em Application → Cache Storage → `plpc-pdfs` (filtre por `Gestos`); a diferença entre as duas strings é o defeito.
6. DevTools → Network → **Offline**. Abra pelo leitor **cinco** louvores de `Gestos em Gravura`, de diretórios diferentes. **Sucesso:** os cinco renderizam, e cada um é o louvor certo — confira o título na barra do leitor contra o conteúdo da página. **Falha:** um PDF abre com o conteúdo de outro louvor (era exatamente o que F4 podia causar) ou a mensagem "PDF não está disponível offline".
7. Volte para **Online**. Force o caminho de F10: no console da página,

```js
localStorage.removeItem('lastManifestHash');
location.href = '/offline';
```

(se a chave tiver outro nome no seu build, encontre-a com `Object.keys(localStorage).filter(k => k.toLowerCase().includes('manifest'))`.)

Recarregue e observe a aba **Network**, filtrada por `.pdf`. **Sucesso:** nenhum PDF de `Gestos em Gravura` é rebaixado — a lista fica vazia ou traz só PDFs de categorias que você não baixou. **Falha:** dezenas de PDFs já em cache voltando pela rede; é o sintoma de que o índice do Step 7 não está casando, e a causa provável é o import de `PdfPathManager` faltando.
8. Application → Cache Storage → `plpc-pdfs`: anote o número de entradas antes e depois do passo 7. **Sucesso:** o número não muda.

Anote no corpo do commit o total de entradas e o resultado do passo 7.

- [ ] **Step 9: Commit**

```bash
git add src/lib/offline/storage/CacheStorageAdapter.js \
        src/lib/stores/offline.js \
        src/lib/utils/correspondenciaExata.test.js \
        package.json
git commit -m "fix(pdf): remover as estratégias de correspondência por nome de arquivo e substring (#22.4)"
```

---

### Task 9: Apagar a normalização perdedora e as oito estratégias restantes (#22.5)

Esta é a tarefa de colheita. As Tarefas 5 a 8 fizeram o trabalho perigoso: fecharam o codificador de URL, unificaram a forma Unicode, puseram o índice sobre a chave real e tiraram as três estratégias que podiam devolver o PDF errado. O que sobra agora existe **só** para absorver a divergência que não existe mais. São oito estratégias — F1 (`PdfPathManager.createSearchVariations`), F2 (o Service Worker que a usa), F3 e F5 (`CacheStorageAdapter.getPdf` e `.deletePdf`), F8 (`offline.js verifyPdfInCacheStorage`, seis variações reimplementadas à mão), F11 (o leitor tentando seis `getDocument` completos no `catch`) e F12 (`PackageDownloader.extractPdfsFromZip`, seis formas de cada caminho esperado mais `endsWith` nas duas direções) — mais oito símbolos: `normalizePdfUrl`, `normalizeAccents`, `UrlNormalizer`, `NormalizationCache`, `LocalStorageAdapter`, `CacheRepository._normalizePath`, `CacheMigrationV2` e `normalizeZipEntryName`.

**Não comece esta tarefa sem os três sinais verdes.** (1) `npm test` passando com os arquivos criados pelas Tarefas 5, 6, 7 e 8. (2) A verificação em navegador do Step 8 da Tarefa 5 tendo mostrado `variacao: 0` — é literalmente a medição de quantas vezes F1 ainda salva alguém, e o zero é a licença para apagá-la. (3) A verificação em navegador da Tarefa 8 tendo mostrado `Gestos em Gravura` completa e abrindo offline. Sem esses três, esta tarefa apaga uma rede de segurança que ainda está pegando gente.

Duas coisas a mais entram aqui porque não cabem em lugar nenhum melhor. A primeira é um bug de verdade: `src/lib/offline/validation/NetworkValidator.js:43` referencia `urlNormalizer`, que **não é importado naquele arquivo** (os imports são `:6-8`). A linha só é alcançada no ramo "network check skipped" — ou seja, **exatamente quando o usuário está offline** — e lança `ReferenceError` que o `try/catch` do chamador engole, fazendo a validação de rede sumir sem log. Não dá para apagar `urlNormalizer` sem corrigir isso. A segunda é a decisão **D-12**: `CacheMigrationV2` é aposentada. Ela reescreve entradas do cache com base numa heurística de string (`CacheMigrationV2.js:170-172`: `storedPath.includes('cifra') && storedPath.includes('nivel')`) e **apaga a entrada antiga** (`:202-208`). Com a chave unificada ela não tem trabalho a fazer, sua flag `cache_migration_v2_completed` já está `true` na maioria dos aparelhos, e a função `runMigration` de `src/routes/offline/+page.svelte:562` que a expunha **não é chamada de lugar nenhum do template** (verificado por grep no Step 1) — é um botão que não existe.

**Não toque em `src/lib/server/r2KeyMatch.js` nem em `worker/`.** `worker/index.js:12` importa `findExactKeyMatch` por caminho relativo e é um **deploy separado**; mudar a regra ali sem publicar o Worker deixa `v2.plpcg.com` e `120826.plpcg.com` servindo `/assets/**.pdf` com a regra antiga. `normalizeR2Key` é a peça saudável do sistema: trata NFD corretamente e tem o único teste de normalização que sempre rodou (`src/lib/server/r2KeyMatch.test.js`).

Sucesso = cinco arquivos apagados, oito estratégias fora, `grep` sem nenhuma referência morta, `npm test` verde, `npm run build` concluindo, e o acervo continuando a abrir offline num navegador real.

**Files:**
- Delete: `src/lib/offline/normalization/UrlNormalizer.js`, `src/lib/offline/normalization/NormalizationCache.js`, `src/lib/offline/normalization/UrlNormalizer.test.js`, `src/lib/offline/storage/LocalStorageAdapter.js`, `src/lib/offline/storage/CacheMigrationV2.js`
- Modify: `src/lib/offline/utils/PdfPathManager.js:99-142` (F1) e o bloco de instrumentação da Tarefa 5
- Modify: `src/service-worker.js:26-27`, `:200-214` (F2)
- Modify: `src/lib/offline/storage/CacheStorageAdapter.js:196-218` (F3), `:484-500` (F5)
- Modify: `src/lib/stores/offline.js:535-550` (`normalizeZipEntryName`), `:971-986` e `:1992-2007` (call sites), `:1206-1249` (F8)
- Modify: `src/routes/leitor/+page.svelte:369-423` (F11)
- Modify: `src/lib/offline/download/PackageDownloader.js:153-173`, `:186-210` (F12)
- Modify: `src/lib/utils/pathUtils.js:114-207` (`normalizeAccents`, `normalizePdfUrl`)
- Modify: `src/lib/offline/validation/NetworkValidator.js:39-47` (o `ReferenceError`)
- Modify: `src/lib/offline/storage/CacheRepository.js:6`, `:98-121` (`_normalizePath`)
- Modify: `src/lib/offline/storage/CacheMigration.js:7`, `src/lib/offline/stats/StatsCalculator.js:8`, `src/lib/offline/download/PackageDownloader.js:7` (imports mortos de `urlNormalizer`)
- Modify: `src/lib/offline/core/OfflineManager.js:15`, `:103-115` (D-12)
- Modify: `src/routes/offline/+page.svelte:28`, `:94-98`, `:559-597`, `:1359-1397`, `:2753-2845` (D-12)
- Modify: `src/lib/offline/utils/PdfPathManager.test.js:83-109`, `src/lib/offline/validation/PdfValidator.test.js`
- Modify: o teste de caracterização criado pela Tarefa 2 (localizado por grep no Step 15)
- Modify: `src/lib/utils/correspondenciaExata.test.js` (Step 2)
- Modify: `package.json` se algum arquivo de teste apagado estiver na lista

**Interfaces:**
- Consumes: `PdfPathManager.createRequestUrl(pdfPath, origin)` e `PdfPathManager.normalizeForStorage(pdfPath)` — Tarefas 5 e 6; `buildPdfCacheIndex` exato — Tarefa 7.
- Produces:
  - `PdfPathManager` com **exatamente dois métodos**: `normalizeForStorage(pdfPath: string): string` e `createRequestUrl(pdfPath: string, origin?: string | null): string`. `createSearchVariations`, `pdfMatchStats` e `registrarAcertoPdf` deixam de existir.
  - `src/lib/utils/pathUtils.js` exportando só o que sobra (`getPdfRelPath`, `computePdfRelPath`, `atobUTF8` e afins). `normalizePdfUrl` e `normalizeAccents` deixam de existir.
  - `isCategoryCompletelyDownloaded`, `verifyPdfInCacheStorage` e `CacheStorageAdapter.getPdf` mantêm as assinaturas; passam a fazer **um** `cache.match` cada.
  - Nenhuma tarefa posterior deste plano pode reintroduzir uma segunda normalização de caminho de PDF no cliente.

- [ ] **Step 1: Confirmar os três sinais verdes e levantar o inventário**

```bash
cd "$(git rev-parse --show-toplevel)" && npm test 2>&1 | tail -20
```

Saída esperada: `# fail 0`.

```bash
git log --oneline -4
```

Saída esperada: os commits das Tarefas 5, 6, 7 e 8, nesta ordem inversa. Se algum faltar, pare.

Agora o inventário do que vai sair. Guarde a saída deste bloco: o Step 16 a repete e espera zero.

```bash
for s in createSearchVariations normalizePdfUrl normalizeAccents urlNormalizer UrlNormalizer NormalizationCache LocalStorageAdapter _normalizePath CacheMigrationV2 normalizeZipEntryName registrarAcertoPdf pdfMatchStats; do
  echo "### $s: $(grep -rn --include='*.js' --include='*.svelte' "$s" src worker | wc -l | tr -d ' ')"
done
echo '--- runMigration é chamado do template? ---'
grep -n 'runMigration' src/routes/offline/+page.svelte
```

Saída esperada: contagens não nulas para todos, e para `runMigration` **apenas duas linhas** (`:562` e `:563`, a declaração) — nenhuma `on:click={runMigration}`. Se aparecer um `on:click`, pare: há um botão de migração visível e a decisão D-12 precisa ser reavaliada com o dono do projeto.

E confirme mais uma vez que `LocalStorageAdapter` é mesmo código morto:

```bash
grep -rn --include='*.js' --include='*.svelte' "LocalStorageAdapter\|localStorageAdapter" src worker | grep -v 'storage/LocalStorageAdapter.js:'
```

Saída esperada: **nenhuma linha**. Não há barril `src/lib/offline/storage/index.js` que o reexporte (verifique com `ls src/lib/offline/*/index.js` — só `core`, `download`, `stats` e `validation` têm um).

- [ ] **Step 2: Teste que falha — a superfície pública encolhe**

Acrescente ao fim de `src/lib/utils/correspondenciaExata.test.js` um bloco que congela o resultado desta tarefa:

```js
describe('#22.5 — sobrou uma normalização só', () => {
  it('PdfPathManager tem exatamente dois métodos públicos', () => {
    const metodos = Object.getOwnPropertyNames(PdfPathManager)
      .filter((n) => typeof (/** @type {any} */ (PdfPathManager))[n] === 'function');
    assert.deepEqual(metodos.sort(), ['createRequestUrl', 'normalizeForStorage']);
  });

  it('createSearchVariations não existe mais', () => {
    assert.equal(/** @type {any} */ (PdfPathManager).createSearchVariations, undefined);
  });

  it('pathUtils não exporta mais a normalização minúscula', async () => {
    const pathUtils = await import('./pathUtils.js');
    assert.equal(/** @type {any} */ (pathUtils).normalizePdfUrl, undefined);
    assert.equal(/** @type {any} */ (pathUtils).normalizeAccents, undefined);
  });
});
```

```bash
node --test src/lib/utils/correspondenciaExata.test.js
```

Saída esperada: `# fail 2` — falham `PdfPathManager tem exatamente dois métodos públicos` (a lista vem com `createSearchVariations` no meio) e `createSearchVariations não existe mais`. O terceiro pode falhar por erro de import se `pathUtils.js` ainda importar `$lib`; nesse caso ele passa a valer a partir do Step 12, e você vê a falha real ali.

- [ ] **Step 3: F3 e F5 — o adaptador de cache passa a uma chave só**

Em `src/lib/offline/storage/CacheStorageAdapter.js`, substitua o bloco de `:196-218` (o `_openCache`, as variações e o laço, já sem o fallback que a Tarefa 8 removeu, e com a chamada `registrarAcertoPdf` que a Tarefa 5 acrescentou):

```js
      const cache = await this._openCache();
      
      // Use PdfPathManager to generate search variations
      const searchVariations = PdfPathManager.createSearchVariations(pdfPath, window.location.origin);

      for (const url of searchVariations) {
        try {
          const request = new Request(url);
          const response = await cache.match(request);
          if (response) {
            // Cache successful result
            this._variationCache.set(normalizedPath, {
              found: true,
              url: url,
              timestamp: Date.now()
            });
            registrarAcertoPdf(url === searchVariations[0] ? 'direto' : 'variacao', url);
            logger.debug('CacheStorageAdapter', `PDF found in cache: ${normalizedPath}`);
            return response;
          }
        } catch (e) {
          // Continue to next variation
        }
      }
```

por:

```js
      const cache = await this._openCache();

      // #22.5: uma chave só. As "variações" eram, medidas sobre os 4629
      // caminhos reais, a mesma string repetida mais duas formas sem origem que
      // `new Request` resolvia contra a página — nunca contra uma chave gravada.
      const url = PdfPathManager.createRequestUrl(pdfPath, window.location.origin);
      if (url) {
        try {
          const response = await cache.match(new Request(url));
          if (response) {
            this._variationCache.set(normalizedPath, {
              found: true,
              url: url,
              timestamp: Date.now()
            });
            logger.debug('CacheStorageAdapter', `PDF encontrado no cache: ${normalizedPath}`);
            return response;
          }
        } catch {
          // URL malformada: trata como miss.
        }
      }
```

E ajuste o import de `:11`, desfazendo o que a Tarefa 5 acrescentou:

```js
import PdfPathManager from '../utils/PdfPathManager.js';
```

Agora `deletePdf`. Substitua `:484-500`:

```js
      const cache = await this._openCache();
      
      // Use PdfPathManager to generate search variations for deletion
      const urlVariations = PdfPathManager.createSearchVariations(pdfPath, window.location.origin);

      let deleted = false;
      for (const url of urlVariations) {
        try {
          const request = new Request(url);
          const result = await cache.delete(request);
          if (result) {
            deleted = true;
          }
        } catch (e) {
          // Continue to next variation
        }
      }
```

por:

```js
      const cache = await this._openCache();

      // #22.5: apaga a chave canônica — a mesma que `_putPdfInternal` grava.
      const url = PdfPathManager.createRequestUrl(pdfPath, window.location.origin);
      let deleted = false;
      if (url) {
        try {
          deleted = await cache.delete(new Request(url));
        } catch {
          deleted = false;
        }
      }
```

```bash
npm run build
```

Saída esperada: build conclui sem erro.

- [ ] **Step 4: F2 — o Service Worker passa a uma chave só**

Em `src/service-worker.js`, substitua o corpo de `handlePdf` de `:200-214` (com a instrumentação que a Tarefa 5 acrescentou):

```js
async function handlePdf(event, url) {
  const cache = await caches.open(PDF_CACHE);

  const direct = await cache.match(event.request);
  if (direct) {
    registrarAcertoPdf('direto');
    return direct;
  }

  const variations = PdfPathManager.createSearchVariations(url.pathname, self.location.origin);
  for (const variationUrl of variations) {
    try {
      const cached = await cache.match(new Request(variationUrl));
      if (cached) {
        registrarAcertoPdf('variacao', variationUrl);
        return cached;
      }
    } catch {
      // Variação malformada: tenta a próxima.
    }
  }
  registrarAcertoPdf('miss', url.pathname);
```

por:

```js
async function handlePdf(event, url) {
  const cache = await caches.open(PDF_CACHE);

  // #22.5: uma chave só, a canônica. O `event.request` já chega nela — a
  // instrumentação da Tarefa 5 mediu zero acertos por variação num navegador
  // real —, mas derivar a chave do pathname garante que uma query string
  // acidental não vire um miss (`cache.match` compara a URL inteira).
  const chave = PdfPathManager.createRequestUrl(url.pathname, self.location.origin);
  const cached = await cache.match(chave || event.request);
  if (cached) return cached;
```

Atualize também o comentário do bloco em `:191-194`, que descreve as variações:

```js
/**
 * PDFs do acervo: cache primeiro, com as variações de URL do PdfPathManager,
 * porque o mesmo PDF pode ter sido gravado com acentuação codificada de formas
 * diferentes. É o conteúdo que o modo offline existe para servir.
 */
```

vira:

```js
/**
 * PDFs do acervo: cache primeiro, por chave exata. Desde #22.1/#22.2 há um só
 * codificador e uma só forma Unicode, então a chave que se procura é sempre a
 * chave que foi gravada. É o conteúdo que o modo offline existe para servir.
 */
```

E desfaça o import que a Tarefa 5 alterou, em `:26`:

```js
import PdfPathManager from '$lib/offline/utils/PdfPathManager.js';
```

```bash
grep -n 'registrarAcertoPdf\|createSearchVariations' src/service-worker.js; echo "exit=$?"
npm run build
```

Saída esperada: nenhuma linha, `exit=1`, build conclui.

- [ ] **Step 5: F1 — apagar `createSearchVariations` e a instrumentação**

Em `src/lib/offline/utils/PdfPathManager.js`, apague o método inteiro de `:99-142` (`createSearchVariations`, do bloco de docstring até o `return [...new Set(variations.filter(Boolean))];` e a chave que o fecha) e apague também o bloco de instrumentação que a Tarefa 5 acrescentou antes do `export default` (`pdfMatchStats` e `registrarAcertoPdf`, do comentário `Instrumentação temporária da Fase 1` até o fim da função).

O arquivo tem de terminar assim:

```js
    // Create URL with UTF-8 encoding
    return createUrlUtf8(`/${normalizedPath}`, baseOrigin);
  }
}

export default PdfPathManager;
```

```bash
node --test src/lib/utils/correspondenciaExata.test.js
```

Saída esperada: os dois casos do Step 2 sobre `PdfPathManager` passam agora. O caso de `pathUtils` ainda pode falhar — ele fecha no Step 12.

- [ ] **Step 6: F8 — `verifyPdfInCacheStorage` passa a uma chave só**

Em `src/lib/stores/offline.js`, substitua o corpo inteiro de `:1211-1244` (do `try {` ao `return false;` que precede o `catch`):

```js
  try {
    const cache = await openPdfCache();
    
    // CRITICAL: Cache stores with URL encoding (new URL() does automatic encoding)
    // So we must try with URL encoding FIRST to match what's actually stored
    // Ensure pdfUrl is a string
    const pdfUrlStr = typeof pdfUrl === 'string' ? pdfUrl : String(pdfUrl);
    
    const urlVariations = [
      // Try with URL encoding first (as stored in cache by new URL())
      new URL(pdfUrlStr, location.origin).toString(),
      // Also try with explicit encoding
      new URL(encodeURI(pdfUrlStr), location.origin).toString(),
      // Try path with leading slash and encoding
      new URL(pdfUrlStr.startsWith('/') ? pdfUrlStr : `/${pdfUrlStr}`, location.origin).toString(),
      // Fallback: try without encoding (for compatibility)
      pdfUrlStr.startsWith('/') ? pdfUrlStr : `/${pdfUrlStr}`,
      pdfUrlStr.replace(/^\/+/, ''),
      pdfUrlStr
    ];
    
    for (const url of urlVariations) {
      try {
        const request = new Request(url);
        const response = await cache.match(request);
        if (response) {
          return true;
        }
      } catch (e) {
        // Continue to next variation
      }
    }
    
    return false;
```

por:

```js
  try {
    const cache = await openPdfCache();

    // #22.5: uma chave só, a mesma que os quatro escritores gravam. Eram seis
    // variações, e duas delas (`new URL(...)` cru e o caminho sem origem)
    // divergiam da chave gravada exatamente nos caminhos com colchetes que a
    // Tarefa 5 corrigiu.
    const pdfUrlStr = typeof pdfUrl === 'string' ? pdfUrl : String(pdfUrl);
    const url = PdfPathManager.createRequestUrl(pdfUrlStr, location.origin);
    if (!url) return false;

    const response = await cache.match(new Request(url));
    return !!response;
```

```bash
npm run build
```

Saída esperada: build conclui sem erro.

- [ ] **Step 7: F11 — o leitor para de tentar seis vezes**

`src/routes/leitor/+page.svelte:369-403` monta seis URLs e tenta um `getDocument` completo em cada, dentro do `catch` do carregamento. Com a chave canônica, `originalFullUrl` (linha 268, escrita pela Tarefa 5) já **é** a única URL possível — as cinco outras são a mesma string em formatos que `getDocument` resolve para a mesma requisição. Cada tentativa custava um download ou um miss de cache no caminho crítico da leitura.

Apague as linhas `:369-403` inteiras (do comentário `// Try fallback variations if original URL failed` até o `}` que fecha o `for`) e substitua o `if (!loadedSuccessfully) {` de `:405` e o `}` de `:423` por um bloco sem condição. O trecho, de `:368` a `:423`, passa a ser:

```ts
      
      // #22.5: não há mais variações a tentar. `originalFullUrl` é a chave
      // canônica — a mesma string que o escritor do cache grava e que o Service
      // Worker procura. As seis tentativas do bloco antigo eram a mesma URL em
      // seis formatos, e cada uma custava um `getDocument` completo.
      setPdfUi('retryableError', 'Erro ao carregar PDF. Verifique se o arquivo está disponível.');

      // FASE 2: Invalidar cache de validação quando há erro definitivo no leitor
      // Como não temos pdfId aqui, invalidamos todo o cache para forçar revalidação
      try {
        const { clearAllValidationCache } = await import('$lib/utils/pdfValidation');
        clearAllValidationCache();
      } catch (err) {
        console.warn('[Leitor] Erro ao invalidar cache de validação:', err);
      }

      // Try retry if still have attempts
      if (retryCount < MAX_RETRIES && navigator.onLine) {
        retryCount++;
        setTimeout(() => load(fileUrl), 2000);
        return;
      }
```

```bash
grep -n 'urlVariations\|uniqueVariations\|loadedSuccessfully' src/routes/leitor/+page.svelte; echo "exit=$?"
npm run build
```

Saída esperada: nenhuma linha, `exit=1`, build conclui.

- [ ] **Step 8: F12 — o extrator de ZIP passa a um `Set` e uma consulta**

Em `src/lib/offline/download/PackageDownloader.js`, substitua o bloco de `:153-173`:

```js
      // Normalize expected PDFs for comparison
      // Use PdfPathManager to preserve case and accents (consistent with extraction)
      const expectedSet = new Set();
      const expectedSetOriginal = new Set(expectedPdfs);
      
      for (const pdf of expectedPdfs) {
        // Normalize using PdfPathManager (preserves case and accents)
        const normalized = PdfPathManager.normalizeForStorage(pdf);
        if (normalized) {
          expectedSet.add(`/${normalized}`);
          expectedSet.add(normalized);
        }
        // Also add original variations
        expectedSet.add(pdf);
        expectedSet.add(pdf.replace(/^\/+/, ''));
        // Add normalized variations for comparison
        const normalizedForComparison = PdfPathManager.normalizeForStorage(pdf);
        if (normalizedForComparison) {
          expectedSet.add(normalizedForComparison);
        }
      }
```

por:

```js
      // #22.5: um Set canônico. Eram seis formas de cada caminho esperado, e
      // depois `endsWith` nas duas direções contra cada entrada do ZIP — O(n·m)
      // e ambíguo. `_normalizeZipEntryName` devolve exatamente esta mesma forma.
      const esperados = new Set(
        expectedPdfs
          .map((/** @type {string} */ pdf) => PdfPathManager.normalizeForStorage(pdf))
          .filter(Boolean)
      );
```

E substitua o bloco de `:186-210`:

```js
        // Check if this PDF is expected (if expectedPdfs provided)
        if (expectedPdfs.length > 0) {
          const normalizedForComparison = `/${normalizedPath}`;
          // Also normalize originalName for comparison (preserves case and accents)
          const originalNormalized = PdfPathManager.normalizeForStorage(entryName);
          const isExpected = expectedSet.has(normalizedForComparison) ||
                             expectedSet.has(normalizedPath) ||
                             expectedSet.has(originalNormalized) ||
                             expectedSetOriginal.has(normalizedPath) ||
                             expectedSetOriginal.has(normalizedPath.replace(/^\/+/, '')) ||
                             expectedSetOriginal.has(entryName) ||
                             Array.from(expectedSetOriginal).some(url => {
                               // Use PdfPathManager for consistent normalization
                               const urlNormalized = PdfPathManager.normalizeForStorage(url);
                               return urlNormalized === normalizedPath ||
                                      urlNormalized === originalNormalized ||
                                      urlNormalized.endsWith(normalizedPath) ||
                                      normalizedPath.endsWith(urlNormalized);
                             });

          if (!isExpected) {
            logger.debug('PackageDownloader', `Skipping unexpected PDF: ${normalizedPath} (original: ${entryName})`);
            continue;
          }
        }
```

por:

```js
        // #22.5: uma consulta O(1) sobre a forma canônica.
        if (expectedPdfs.length > 0 && !esperados.has(normalizedPath)) {
          logger.debug('PackageDownloader', `Ignorando PDF não esperado: ${normalizedPath} (entrada: ${entryName})`);
          continue;
        }
```

```bash
npm run build
```

Saída esperada: build conclui sem erro.

- [ ] **Step 9: `normalizeZipEntryName` some, e os dois call sites usam o canônico**

Depois da Tarefa 6 esta função é um invólucro de três linhas em volta de `normalizeForStorage`, cuja única razão de existir era devolver com barra inicial. Os call sites não precisam dela.

Em `src/lib/stores/offline.js`, apague a função inteira (o bloco que começa em `:535` com `function normalizeZipEntryName(entryName) {` e termina na chave que o fecha, incluindo a docstring acima).

Substitua o trecho de `:971-986`:

```js
          const preparedPath = normalizeZipEntryName(name);
          if (!preparedPath || !preparedPath.endsWith('.pdf')) continue;

          const pathForComparison = prepareForComparison(preparedPath);

          // Só grava o que foi pedido e ainda não foi gravado.
          if (!wantedIndex.has(preparedPath)) continue;
          if (!remaining.has(pathForComparison)) continue;

          const pdfBlob = new Blob([data], { type: 'application/pdf' });
          const requestUrl = createUrlUtf8(preparedPath, location.origin);
```

por:

```js
          // #22.5: o normalizador canônico direto, sem o invólucro que só
          // acrescentava a barra inicial.
          const preparedPath = PdfPathManager.normalizeForStorage(name);
          if (!preparedPath || !preparedPath.endsWith('.pdf')) continue;

          const pathForComparison = prepareForComparison(preparedPath);

          // Só grava o que foi pedido e ainda não foi gravado.
          if (!wantedIndex.has(preparedPath)) continue;
          if (!remaining.has(pathForComparison)) continue;

          const pdfBlob = new Blob([data], { type: 'application/pdf' });
          const requestUrl = PdfPathManager.createRequestUrl(preparedPath, location.origin);
```

Aplique **exatamente a mesma substituição** em `src/lib/stores/offline.js:1992-2002`, o mesmo trecho duplicado no segundo fluxo de download.

Atenção: `createUrlUtf8` **continua importado e usado** neste arquivo, em `:1005` e `:2026`, para a URL do pacote ZIP. Não apague o import.

```bash
grep -n 'normalizeZipEntryName' src/lib/stores/offline.js; echo "exit=$?"
npm run build && npm test
```

Saída esperada: nenhuma linha, `exit=1`, build conclui, `# fail 0`.

- [ ] **Step 10: Corrigir o `ReferenceError` de `NetworkValidator.js:43`**

Este é um bug independente do refactor, e precisa ser corrigido antes de `urlNormalizer` deixar de existir — senão o arquivo passa a ter uma referência a um símbolo que nunca existiu ali. O ramo é o de "network check skipped", alcançado **quando o usuário está offline**.

Em `src/lib/offline/validation/NetworkValidator.js:39-47`, substitua:

```js
    if (!shouldCheckNetwork) {
      return {
        available: false,
        source: 'network',
        normalizedPath: urlNormalizer.normalizeForCache(pdfPath) || '',
        needsDownload: false,
        error: 'Network check skipped (offline or disabled)'
      };
    }
```

por:

```js
    if (!shouldCheckNetwork) {
      // #22.5: `urlNormalizer` nunca foi importado neste arquivo — esta linha
      // lançava ReferenceError exatamente no ramo offline, e o try/catch do
      // CompositeValidator engolia o erro, fazendo a validação de rede sumir
      // sem log. `PdfPathManager` já está importado em :7.
      return {
        available: false,
        source: 'network',
        normalizedPath: PdfPathManager.normalizeForStorage(pdfPath) || '',
        needsDownload: false,
        error: 'Network check skipped (offline or disabled)'
      };
    }
```

```bash
grep -n 'urlNormalizer' src/lib/offline/validation/NetworkValidator.js; echo "exit=$?"
```

Saída esperada: nenhuma linha e `exit=1`.

- [ ] **Step 11: Apagar `UrlNormalizer`, `NormalizationCache`, `LocalStorageAdapter` e `_normalizePath`**

Primeiro os três imports que nunca são usados — o grep do Step 1 mostrou que `urlNormalizer.` não aparece em nenhum destes arquivos, só o import:

```bash
sed -i '' "/import urlNormalizer from '..\/normalization\/UrlNormalizer.js';/d" \
  src/lib/offline/storage/CacheMigration.js \
  src/lib/offline/stats/StatsCalculator.js \
  src/lib/offline/download/PackageDownloader.js
grep -rn 'urlNormalizer' src/lib/offline/storage/CacheMigration.js src/lib/offline/stats/StatsCalculator.js src/lib/offline/download/PackageDownloader.js; echo "exit=$?"
```

Saída esperada: nenhuma linha e `exit=1`.

Depois `CacheRepository`. Em `src/lib/offline/storage/CacheRepository.js`, apague o import de `:6`:

```js
import urlNormalizer from '../normalization/UrlNormalizer.js';
```

e o método inteiro de `:98-121` (`_normalizePath`, da docstring `Normalize PDF path using UrlNormalizer` até a chave que o fecha). Ele já estava marcado `@deprecated` e com um aviso em maiúsculas dizendo para não usá-lo em PDFs; seu único chamador era `LocalStorageAdapter` (`:51,81,105`), que é o próximo a sair.

Agora os quatro arquivos:

```bash
git rm src/lib/offline/normalization/UrlNormalizer.js \
       src/lib/offline/normalization/UrlNormalizer.test.js \
       src/lib/offline/normalization/NormalizationCache.js \
       src/lib/offline/storage/LocalStorageAdapter.js
ls src/lib/offline/normalization/
```

Saída esperada: o diretório fica só com `.gitkeep`.

```bash
npm run build
```

Saída esperada: build conclui sem erro. Se falhar com `Failed to resolve import`, o grep do Step 1 deixou passar um consumidor: o erro diz qual arquivo.

- [ ] **Step 12: Apagar `normalizePdfUrl` e `normalizeAccents`**

Em `src/lib/utils/pathUtils.js`, apague tudo de `:114` até o fim do arquivo (`:207`) — são as duas funções e suas docstrings. O arquivo passa a terminar na chave de `getPdfRelPath`, em `:112`.

Com isso `decodeUrlComponentUtf8` deixa de ser referenciado (só aparecia num comentário em `:64`). Substitua o import de `:1`:

```js
import { decodeUrlComponentUtf8, decodeUrlUtf8Multiple } from './urlEncoding.js';
```

por:

```js
import { decodeUrlUtf8Multiple } from './urlEncoding.js';
```

```bash
node --test src/lib/utils/correspondenciaExata.test.js src/lib/utils/pathUtils.memo.test.js
```

Saída esperada: `# fail 0` — os três casos do Step 2 passam agora, e a memoização de `getPdfRelPath` continua intacta.

- [ ] **Step 13: Aposentar `CacheMigrationV2` (D-12)**

Quatro edições e um `git rm`.

**(a)** Em `src/lib/offline/core/OfflineManager.js`, apague o import de `:15`:

```js
import cacheMigrationV2 from '../storage/CacheMigrationV2.js';
```

e o bloco inteiro de `:103-115`:

```js
        // Run cache migration V2 if needed (unified normalization)
        try {
          const migrationV2Completed = await cacheMigrationV2.isMigrationCompleted();
          if (!migrationV2Completed) {
            logger.info('OfflineManager', 'Running cache migration V2...');
            const migrationResult = await cacheMigrationV2.migrate();
            logger.info('OfflineManager', `Cache migration V2 completed: ${migrationResult.migrated} migrated, ${migrationResult.skipped} skipped, ${migrationResult.errors} errors`);
          } else {
            logger.debug('OfflineManager', 'Cache migration V2 already completed');
          }
        } catch (error) {
          logger.warn('OfflineManager', 'Cache migration V2 failed (non-critical)', error);
        }
```

pondo no lugar:

```js
        // #22.5 / D-12: a CacheMigrationV2 foi aposentada. Ela reescrevia
        // entradas do cache por heurística de string
        // (`includes('cifra') && includes('nivel')`) e apagava a antiga. Com a
        // chave unificada não há o que migrar, e a migração NFC de #22.2, logo
        // abaixo, cobre o único caso real de chave divergente.
```

**Atenção:** o bloco da migração NFC que a Tarefa 6 (Step 8) acrescentou vem logo depois deste. Não o apague — ele é o que substitui a V2.

**(b)** Em `src/routes/offline/+page.svelte`, apague o import de `:28`, as quatro variáveis de estado de `:94-98` (`isMigrating`, `migrationProgress`, `migrationResult`, `migrationNeeded` — o comentário `// Migration V2 state` sai junto), a função `runMigration` inteira de `:559-597`, os dois blocos de template de `:1359-1397` (`<!-- Migration progress -->` e `<!-- Migration result -->`), e o bloco de CSS de `:2753-2845` (de `.migration-banner {` até a chave que fecha `.migration-close:hover`).

**(c)** Apague o arquivo:

```bash
git rm src/lib/offline/storage/CacheMigrationV2.js
```

**(d)** Confirme:

```bash
grep -rn --include='*.js' --include='*.svelte' 'CacheMigrationV2\|cacheMigrationV2\|migrationProgress\|migrationResult\|migrationNeeded\|isMigrating\|runMigration\|migration-' src; echo "exit=$?"
npm run build
```

Saída esperada: nenhuma linha, `exit=1`, build conclui. A flag `cache_migration_v2_completed` fica órfã no `localStorage` de quem já a tem; é uma string de 4 bytes e não vale um passo de limpeza.

- [ ] **Step 14: Os testes mortos que documentavam a normalização perdedora**

Dois arquivos ainda citam o que acabou de sair. `src/lib/offline/normalization/UrlNormalizer.test.js` já foi apagado no Step 11.

**(a)** `src/lib/offline/utils/PdfPathManager.test.js:83-109`: apague o `describe('createSearchVariations', …)` inteiro, com seus quatro `test`. O que sobra (`normalizeForStorage` e `createRequestUrl`) continua descrevendo a intenção correta — "preserves case and accents" — e é o que a Tarefa 1 converteu para `node --test`.

**(b)** `src/lib/offline/validation/PdfValidator.test.js` usa `urlNormalizer` em oito lugares (`:11,30,43,61,84,109,257` e a expectativa de `:112`). Troque cada `urlNormalizer.normalizeForCache(x)` e `urlNormalizer.normalizePdfUrl(x)` por `PdfPathManager.normalizeForStorage(x)`, troque o import de `:11` por `import PdfPathManager from '../utils/PdfPathManager.js';`, apague a linha `urlNormalizer.clearCache();` de `:30`, e corrija a expectativa que congelava a régua errada:

```js
        expect(result.normalizedPath).toBe('assets/coladultos/001.pdf');
```

vira:

```js
        expect(result.normalizedPath).toBe('assets/ColAdultos/001.pdf');
```

Se a Tarefa 1 já converteu este arquivo para `node --test`, use `assert.equal(result.normalizedPath, 'assets/ColAdultos/001.pdf')` na forma que ela deixou. Se ela o excluiu em vez de converter, apague-o e siga.

```bash
grep -rn 'urlNormalizer\|normalizePdfUrl\|normalizeForCache' src --include='*.test.js'
```

Saída esperada: no máximo o teste de caracterização da Tarefa 2, que o Step 15 trata.

- [ ] **Step 15: Atualizar o teste de caracterização da Tarefa 2**

A Tarefa 2 criou um teste que congela o comportamento das **duas** normalizações lado a lado — era o contrato que impedia esta fase de mudar de direção sem perceber. Agora existe uma só, e o teste tem de congelar essa uma. Localize-o:

```bash
grep -rln 'normalizePdfUrl' src --include='*.test.js'
```

Saída esperada: **um** arquivo. Abra-o e faça três coisas, exatamente:

1. Apague o import de `normalizePdfUrl` (de `$lib/utils/pathUtils`, de `./pathUtils.js` ou de `UrlNormalizer.js` — todos deixaram de existir).
2. Em cada caso da tabela de caracterização, apague a coluna/asserção da normalização minúscula e **mantenha** a de `normalizeForStorage`. Onde o teste comparava as duas (algo como `assert.notEqual(normalizePdfUrl(p), PdfPathManager.normalizeForStorage(p))`), substitua pela asserção que passa a valer:

```js
    // #22.5: sobrou uma normalização. O que este caso congela agora é que ela
    // preserva caixa e acento, é idempotente, e devolve sempre NFC.
    const canonico = PdfPathManager.normalizeForStorage(entrada);
    assert.equal(canonico, esperadoParaArmazenamento);
    assert.equal(PdfPathManager.normalizeForStorage(canonico), canonico);
    assert.equal(canonico, canonico.normalize('NFC'));
```

3. Atualize o comentário de cabeçalho do arquivo para dizer que ele congela **a** normalização de caminho de PDF do cliente, e que `normalizeR2Key` (`src/lib/server/r2KeyMatch.js`) é uma normalização **de servidor** deliberadamente diferente, coberta por `src/lib/server/r2KeyMatch.test.js`, e fora do escopo deste plano.

```bash
npm test
```

Saída esperada: `# fail 0`. Se o script `test` do `package.json` listar `UrlNormalizer.test.js` ou `PdfValidator.test.js` e eles tiverem sido apagados, remova-os da lista agora — o `node --test` falha com `ERR_MODULE_NOT_FOUND` e diz o nome.

- [ ] **Step 16: Medir a redução e provar por grep que não sobrou referência**

```bash
cd "$(git rev-parse --show-toplevel)" && git diff --stat HEAD | tail -1
```

Saída esperada: da ordem de **~1700 linhas removidas** contra menos de 150 acrescentadas. Só os cinco arquivos apagados somam 1124 linhas (`UrlNormalizer.js` 189, `UrlNormalizer.test.js` 235, `NormalizationCache.js` 119, `LocalStorageAdapter.js` 231, `CacheMigrationV2.js` 350). Se o número de removidas vier abaixo de 1400, algum passo não foi aplicado — compare com a lista de `Files` no topo da tarefa.

Agora o grep final. Este bloco é o mesmo do Step 1 e tem de dar **zero em tudo**:

```bash
for s in createSearchVariations normalizePdfUrl normalizeAccents urlNormalizer UrlNormalizer NormalizationCache LocalStorageAdapter _normalizePath CacheMigrationV2 normalizeZipEntryName registrarAcertoPdf pdfMatchStats expectedSetOriginal urlVariations loadedSuccessfully; do
  n=$(grep -rn --include='*.js' --include='*.svelte' "$s" src worker | wc -l | tr -d ' ')
  echo "$s: $n"
done
```

Saída esperada: `0` em todas as quinze linhas.

E confirme que o servidor ficou intacto — esta é a fronteira que o plano proíbe cruzar:

```bash
git diff --name-only HEAD | grep -E '^(worker/|src/lib/server/)'; echo "exit=$?"
```

Saída esperada: nenhuma linha e `exit=1`. Se aparecer qualquer arquivo, reverta-o antes de continuar: `worker/index.js` é um deploy separado.

```bash
npm test && npm run build
```

Saída esperada: `# fail 0` e build concluindo.

- [ ] **Step 17: Verificação em navegador — o acervo continua inteiro**

Este é o passo que decide se a fase inteira foi bem-sucedida. Nenhum teste unitário toca `cache.match`; só este.

1. `npm run build && npm run preview`, abra `http://localhost:4173` no Chrome.
2. DevTools → Application → Service Workers → **Update on reload**; Ctrl+Shift+R até o SW ficar *activated and is running* com o build novo.
3. **Não limpe o site data.** O ponto desta verificação é que o acervo baixado nas Tarefas 7 e 8 continue funcionando com o código novo. Se você limpou por acidente, baixe de novo `Gestos em Gravura` e `PES` antes de seguir.
4. Application → Cache Storage → `plpc-pdfs`: anote o número de entradas. Ele **não pode** mudar durante esta verificação.
5. DevTools → Network → **Offline**.
6. Abra pelo leitor **dez** louvores, escolhidos assim: três de `Gestos em Gravura` em diretórios diferentes (todos chamados `Gestos CIAs.pdf` — é o teste do fim da correspondência por nome de arquivo); os três com colchetes no nome, se estiverem baixados (`Sobe aqui [26-07-2025] - Coro`, `Ó profundidade das riquezas - Vocal [20 03 2026]`, `Perante a tua grandeza - Vocal [06 02 2025]`); dois dos oito em NFD da lista do Step 1 da Tarefa 6 (`Alto preço - CIFRA`, `Ao Único`); e dois quaisquer.
   **Sucesso:** os dez renderizam, e cada um é o louvor certo — confira o título na barra do leitor contra o conteúdo da primeira página. **Falha:** qualquer "PDF não está disponível offline. Por favor, baixe primeiro" ou qualquer PDF cujo conteúdo não corresponda ao título.
7. Console do Service Worker (Application → Service Workers → `inspect`): **Sucesso:** nenhuma linha de erro, e nada de `[F1]` (a instrumentação saiu no Step 5). Console da página: **Sucesso:** nenhum `ReferenceError`.
8. Volte para **Online** e vá a `/offline`. **Sucesso:** as categorias baixadas continuam marcadas como baixadas, com as contagens de antes; a tela não mostra nenhum banner ou barra de migração (eles saíram no Step 13); e não há um pico de requisições `.pdf` na aba Network.
9. Apague um louvor pelo caminho normal da UI (o botão de remover do cartão, se houver) ou pelo console:

```js
const { default: adapter } = await import('/src/lib/offline/storage/CacheStorageAdapter.js');
```

Se o import direto não funcionar no build de produção, faça a prova equivalente com o cache cru:

```js
const c = await caches.open('plpc-pdfs');
const antes = (await c.keys()).length;
const alvo = (await c.keys()).find(r => r.url.includes('Gestos'));
await c.delete(alvo);
console.log(antes, '->', (await c.keys()).length, '| apagada:', alvo.url);
```

**Sucesso:** o total cai em exatamente 1. É a prova de que a chave é única — antes, `deletePdf` varria cinco variações porque não se sabia sob qual delas a entrada estava.
10. Recarregue e confirme que o louvor apagado agora aparece como não disponível offline, e que os demais continuam disponíveis.

Anote no corpo do commit: o total de entradas do passo 4, os dez louvores abertos no passo 6, e o resultado do passo 9.

- [ ] **Step 18: Commit**

```bash
git add -A src/lib/offline src/lib/utils src/lib/stores/offline.js \
        src/routes/leitor/+page.svelte src/routes/offline/+page.svelte \
        src/service-worker.js package.json
git commit -m "refactor(pdf): apagar a normalização minúscula e as oito estratégias de correspondência difusa (#22.5)"
```

O corpo do commit deve trazer, em pt-BR, as três medições que autorizaram a tarefa: `variacao: 0` da Tarefa 5, o total de entradas do cache antes e depois da verificação do Step 17, e o número de linhas removidas do Step 16.

---

## Fase 3 — URL ↔ estado (#21)

Nenhuma tarefa desta fase entra na `main` com o contrato da Tarefa 3 vermelho. Um link de playlist quebrado é invisível para nós e permanente para quem recebeu.

---

### Task 10: Compartilhamento de listas à prova de `%` e de `+` (#21 parte 1)

O app não tem servidor de listas: o link de compartilhamento carrega os ids dos louvores embutidos e crus na query — `{origin}/?sharepdfs=<b64>,<b64>&sharename=<enc>`, montado em `src/lib/utils/playlistUtils.js:56-61` e consumido em `src/routes/+page.svelte:256-294`. Cada `pdfId` é base64 padrão do caminho relativo do PDF (não base64url): 2 198 dos 4 629 ids do acervo contêm `=`, 9 contêm `/`, e nenhum contém `+` — ainda. Como `pdfIds.join(',')` entra na URL **sem encode**, o dia em que um arquivo novo produzir um id com `+`, o `URLSearchParams` do receptor vai ler esse `+` como espaço, o id não vai casar no `Map` de `carousel.loadPlaylist` (`src/lib/stores/carousel.js:118-130`) e o louvor **some da lista sem nenhum erro**. No mesmo caminho existem quatro defeitos já ativos hoje: `+page.svelte:277` decodifica o `sharename` uma segunda vez (o `URLSearchParams.get` já decodificou), então qualquer `%` no nome — "Louvor 100%" — lança `URIError` **depois** de `carousel.loadPlaylist` e **antes** de `savedPlaylists.savePlaylist`, ou seja: o carrossel carrega, a lista não é salva, a URL fica suja e não há segunda tentativa porque `sharedLinkProcessed` já foi marcado em `:264`; abrir o mesmo link três vezes cria três listas idênticas; ids não resolvidos entram na lista salva (`:278` passa o array cru) mas não no carrossel (`:274` filtra), e depois envenenam `findPlaylistByPdfIds` (`savedPlaylists.js:182-189`, que compara por `join(',')`); e a limpeza em `:281` faz `goto($page.url.pathname)`, jogando fora `utm_source`, `fbclid` e qualquer outro param de terceiros que veio no link do WhatsApp.

Esta tarefa é independente da reescrita das Tarefas 11 e 12 e é a de maior valor por linha alterada do plano inteiro: um link de playlist quebrado é invisível para nós e permanente para quem recebeu. Sucesso é: os links que já circulam continuam abrindo exatamente como abrem hoje (leitura tolerante ao formato cru), os links novos sobrevivem a `+`, `%` e `=`, nenhum caminho degenerado deixa a URL suja ou o bloco reativo girando, e toda a lógica de codificação/limpeza passa a viver num módulo puro coberto por `node --test` — porque `+page.svelte` não é testável e é justamente lá que os quatro bugs moram.

**Files:**
- Create: `src/lib/utils/playlistShare.js`
- Create: `src/lib/utils/playlistShare.test.js`
- Modify: `src/lib/utils/playlistUtils.js:56-61`
- Modify: `src/routes/+page.svelte:256-294`

**Interfaces:**
- Consumes: o contrato executável da Tarefa 3, que já congelou os casos C1-C14 e D1-D2 e é rodado por `npm test` (glob, desde a Tarefa 1). Você **não** cria testes de contrato aqui; você faz virar verde o que a Tarefa 3 deixou marcado como comportamento esperado, e altera a expectativa **só** nos casos listados no Step 9.
- Consumes: `savedPlaylists.findPlaylistByPdfIds(pdfIds: string[]) => {id, nome, pdfIds, createdAt, favorita} | null` — `src/lib/stores/savedPlaylists.js:182-189`, já existente e já usada em `src/lib/components/CarouselNavigator.svelte:72`.
- Consumes: `carousel.loadPlaylist(pdfIds: string[], allLouvores: any[]) => void` — `src/lib/stores/carousel.js:113-142`.
- Produces: `encodeSharePdfIds(pdfIds: string[]) => string` — valor pronto para ir depois de `sharepdfs=` numa URL.
- Produces: `parseSharePdfIds(param: string | null) => string[]` — recebe o valor **já decodificado** por `URLSearchParams.get('sharepdfs')`.
- Produces: `stripShareParams(search: string) => string` — devolve `''` ou `'?resto=...'`.
- Produces: `resolveKnownPdfIds(pdfIds: string[], louvores: any[]) => string[]` — ordem preservada, desconhecidos descartados.

- [ ] **Step 1: Branch**

```bash
cd "/Volumes/SSD 2TB SD/dev/plpcjf"
git checkout main && git pull
git checkout -b feat/21-compartilhamento-listas
npm test 2>&1 | tail -4
```

Saída esperada: `ℹ fail 0`. Se o contrato da Tarefa 3 estiver vermelho aqui, **pare** — nada desta fase entra com o contrato vermelho.

- [ ] **Step 2: Teste vermelho da codificação dos ids**

Os dois ids abaixo são reais, extraídos do manifesto (`04112025/Conheçamos e prossigamos/Cifra.pdf` e `.../Gestos CIAs.pdf`). O terceiro é sintético, com o `+` que hoje quebra em silêncio.

```bash
cat > src/lib/utils/playlistShare.test.js <<'EOF'
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { encodeSharePdfIds, parseSharePdfIds } from './playlistShare.js';

// Ids reais do acervo: base64 padrão do caminho relativo, com `=` de padding.
const ID_CIFRA = 'MDQxMTIwMjUvQ29uaGXDp2Ftb3MgZSBwcm9zc2lnYW1vcy9DaWZyYS5wZGY=';
const ID_GESTOS = 'MDQxMTIwMjUvQ29uaGXDp2Ftb3MgZSBwcm9zc2lnYW1vcy9HZXN0b3MgQ0lBcy5wZGY=';
// Id sintético com o `+` que o URLSearchParams leria como espaço.
const ID_COM_MAIS = 'YWJj+ZGVm/Z2hp=';

/** Simula a viagem completa: escrita na URL → leitura pelo receptor. */
function idaEVolta(pdfIds) {
  const url = new URL(`https://plpcg.com/?sharepdfs=${encodeSharePdfIds(pdfIds)}`);
  return parseSharePdfIds(url.searchParams.get('sharepdfs'));
}

describe('encodeSharePdfIds / parseSharePdfIds', () => {
  it('preserva ids reais do acervo, com = de padding e / no meio', () => {
    assert.deepEqual(idaEVolta([ID_CIFRA, ID_GESTOS]), [ID_CIFRA, ID_GESTOS]);
  });

  it('protege o + na escrita e devolve o id intacto na leitura', () => {
    assert.deepEqual(idaEVolta([ID_COM_MAIS]), [ID_COM_MAIS]);
  });

  it('continua aceitando o formato cru dos links já compartilhados', () => {
    // Link antigo: ids crus separados por vírgula, sem encode por item.
    const antigo = new URL(`https://plpcg.com/?sharepdfs=${ID_CIFRA},${ID_GESTOS}`);
    assert.deepEqual(parseSharePdfIds(antigo.searchParams.get('sharepdfs')), [
      ID_CIFRA,
      ID_GESTOS
    ]);
  });

  it('tolera vazio, vírgulas sobrando e espaços em volta', () => {
    assert.deepEqual(parseSharePdfIds(''), []);
    assert.deepEqual(parseSharePdfIds(null), []);
    assert.deepEqual(parseSharePdfIds(',,,'), []);
    assert.deepEqual(parseSharePdfIds(` ${ID_CIFRA} ,, ${ID_GESTOS} `), [ID_CIFRA, ID_GESTOS]);
  });
});
EOF
node --test src/lib/utils/playlistShare.test.js 2>&1 | tail -6
```

Saída esperada: falha de resolução de módulo — `Cannot find module` apontando para `playlistShare.js`. É o vermelho correto: o módulo ainda não existe.

- [ ] **Step 3: Implementar a codificação**

`encodeURIComponent` por item é seguro aqui **porque o valor não passa por `URLSearchParams.set`** (o link é montado por template literal em `playlistUtils.js:60`) — a advertência de `urlSync.js:6-11` sobre `%2520` vale para o outro caminho, não para este. Do lado da leitura, `URLSearchParams.get` desfaz exatamente um nível de encode, então o formato novo e o formato cru chegam idênticos ao `split(',')`: é por isso que a leitura não muda e todo link já enviado continua vivo.

```bash
cat > src/lib/utils/playlistShare.js <<'EOF'
/**
 * Codificação e limpeza do link de compartilhamento de listas.
 *
 * Formato do link: `{origin}/?sharepdfs=<id>,<id>&sharename=<nome>`.
 * Cada `pdfId` é base64 padrão (não base64url) do caminho relativo do PDF,
 * então pode conter `=`, `/` e — no futuro — `+`. O `+` cru numa query é lido
 * como espaço pelo URLSearchParams, o que corrompe o id sem nenhum erro.
 *
 * Módulo puro de propósito: `+page.svelte` não é testável sob `node --test`.
 */

/**
 * Serializa os ids para ir depois de `sharepdfs=` na URL.
 * Codifica item a item (protege `+`) e junta com vírgula literal.
 * @param {string[]} pdfIds
 * @returns {string}
 */
export function encodeSharePdfIds(pdfIds) {
  if (!Array.isArray(pdfIds)) return '';
  return pdfIds
    .filter((id) => typeof id === 'string' && id.trim() !== '')
    .map((id) => encodeURIComponent(id.trim()))
    .join(',');
}

/**
 * Lê o valor de `sharepdfs` já decodificado por `URLSearchParams.get`.
 * Aceita tanto o formato novo (cada id codificado) quanto o cru dos links
 * antigos: depois do decode do URLSearchParams os dois são a mesma string.
 * @param {string | null | undefined} param
 * @returns {string[]}
 */
export function parseSharePdfIds(param) {
  if (typeof param !== 'string' || param === '') return [];
  return param
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}
EOF
node --test src/lib/utils/playlistShare.test.js 2>&1 | tail -6
```

Saída esperada: `ℹ tests 4`, `ℹ pass 4`, `ℹ fail 0`.

- [ ] **Step 4: Teste vermelho da limpeza da URL e da resolução de ids**

```bash
python3 - <<'EOF'
import io
caminho = 'src/lib/utils/playlistShare.test.js'
texto = io.open(caminho, encoding='utf-8').read()
texto = texto.replace(
    "import { encodeSharePdfIds, parseSharePdfIds } from './playlistShare.js';",
    "import {\n  encodeSharePdfIds,\n  parseSharePdfIds,\n  resolveKnownPdfIds,\n  stripShareParams\n} from './playlistShare.js';"
)
texto += '''
describe('stripShareParams', () => {
  it('remove sharepdfs e sharename', () => {
    assert.equal(stripShareParams('?sharepdfs=abc,def&sharename=Culto'), '');
  });

  it('preserva params de terceiros que chegam no link do WhatsApp', () => {
    const resto = stripShareParams('?utm_source=whatsapp&sharepdfs=abc&fbclid=IwAR1&sharename=x');
    const params = new URLSearchParams(resto);
    assert.equal(params.get('utm_source'), 'whatsapp');
    assert.equal(params.get('fbclid'), 'IwAR1');
    assert.equal(params.has('sharepdfs'), false);
    assert.equal(params.has('sharename'), false);
  });

  it('devolve string vazia quando não sobra nada', () => {
    assert.equal(stripShareParams(''), '');
    assert.equal(stripShareParams('?sharepdfs='), '');
  });
});

describe('resolveKnownPdfIds', () => {
  it('mantém a ordem pedida e descarta os ids que o catálogo não conhece', () => {
    const acervo = [{ pdfId: 'A' }, { pdfId: 'B' }, { pdfId: 'C' }];
    assert.deepEqual(resolveKnownPdfIds(['B', 'FANTASMA', 'A'], acervo), ['B', 'A']);
  });

  it('devolve [] quando nada resolve ou a entrada não é lista', () => {
    assert.deepEqual(resolveKnownPdfIds(['X'], [{ pdfId: 'A' }]), []);
    assert.deepEqual(resolveKnownPdfIds(null, [{ pdfId: 'A' }]), []);
  });
});
'''
io.open(caminho, 'w', encoding='utf-8').write(texto)
EOF
node --test src/lib/utils/playlistShare.test.js 2>&1 | tail -6
```

Saída esperada: `ℹ tests 9`, `ℹ pass 4`, `ℹ fail 5` — os cinco novos falham com `stripShareParams is not a function` / `resolveKnownPdfIds is not a function`.

- [ ] **Step 5: Implementar limpeza e resolução**

`resolveKnownPdfIds` reproduz exatamente o critério de `carousel.js:118-130` (existir como `pdfId` no catálogo), para que a lista salva e o carrossel nunca mais divirjam.

```bash
cat >> src/lib/utils/playlistShare.js <<'EOF'

/**
 * Remove só `sharepdfs` e `sharename` da query, preservando todo o resto
 * (`utm_source`, `fbclid` e afins chegam nesses links).
 * @param {string} search - `location.search`, com ou sem `?`
 * @returns {string} `''` ou `'?resto=...'`
 */
export function stripShareParams(search) {
  const params = new URLSearchParams(search || '');
  params.delete('sharepdfs');
  params.delete('sharename');
  const resto = params.toString();
  return resto ? `?${resto}` : '';
}

/**
 * Filtra os ids que o catálogo realmente conhece, preservando a ordem pedida.
 * Mesmo critério de `carousel.loadPlaylist`: casar por `pdfId`.
 * @param {string[]} pdfIds
 * @param {Array<{pdfId?: string}>} louvores
 * @returns {string[]}
 */
export function resolveKnownPdfIds(pdfIds, louvores) {
  if (!Array.isArray(pdfIds) || !Array.isArray(louvores)) return [];
  const conhecidos = new Set(
    louvores.map((louvor) => louvor && louvor.pdfId).filter(Boolean)
  );
  return pdfIds.filter((id) => conhecidos.has(id));
}
EOF
node --test src/lib/utils/playlistShare.test.js 2>&1 | tail -6
```

Saída esperada: `ℹ tests 9`, `ℹ pass 9`, `ℹ fail 0`.

- [ ] **Step 6: Teste vermelho das duas direções no link real**

Este é o teste que prova a compatibilidade exigida por D-5: o link **novo** sobrevive ao `+`, e o link **antigo** continua sendo lido. Ele monta a URL pela função de produção e a lê pelo `URLSearchParams`, como faz o navegador do receptor.

```bash
python3 - <<'EOF'
import io
caminho = 'src/lib/utils/playlistShare.test.js'
texto = io.open(caminho, encoding='utf-8').read()
texto = texto.replace(
    "import {\n  encodeSharePdfIds,",
    "import { generatePlaylistShareUrl } from './playlistUtils.js';\nimport {\n  encodeSharePdfIds,"
)
texto += '''
describe('generatePlaylistShareUrl', () => {
  it('gera link cujo id com + sobrevive à leitura do receptor', () => {
    globalThis.window = { location: { origin: 'https://plpcg.com' } };
    try {
      const url = new URL(generatePlaylistShareUrl([ID_COM_MAIS, ID_CIFRA], 'Culto de Domingo'));
      assert.deepEqual(parseSharePdfIds(url.searchParams.get('sharepdfs')), [
        ID_COM_MAIS,
        ID_CIFRA
      ]);
      assert.equal(url.searchParams.get('sharename'), 'Culto de Domingo');
    } finally {
      delete globalThis.window;
    }
  });

  it('devolve o nome com % legível após o único decode do URLSearchParams', () => {
    globalThis.window = { location: { origin: 'https://plpcg.com' } };
    try {
      const url = new URL(generatePlaylistShareUrl([ID_CIFRA], 'Louvor 100%'));
      // Um decode só. O segundo decode é o que hoje lança URIError em +page.svelte:277.
      assert.equal(url.searchParams.get('sharename'), 'Louvor 100%');
    } finally {
      delete globalThis.window;
    }
  });
});
'''
io.open(caminho, 'w', encoding='utf-8').write(texto)
EOF
node --test src/lib/utils/playlistShare.test.js 2>&1 | tail -6
```

Saída esperada: `ℹ tests 11`, `ℹ pass 10`, `ℹ fail 1` — falha o teste do `+`, com `[ 'YWJj ZGVm/Z2hp=', ... ] !== [ 'YWJj+ZGVm/Z2hp=', ... ]`. É exatamente o defeito §2.4b do relatório, agora capturado.

- [ ] **Step 7: Encodar os ids na geração do link**

Uma linha em `src/lib/utils/playlistUtils.js:58`.

```bash
python3 - <<'EOF'
import io
caminho = 'src/lib/utils/playlistUtils.js'
texto = io.open(caminho, encoding='utf-8').read()
texto = texto.replace(
    "/**\n * Share playlist link using Web Share API or clipboard fallback",
    "import { encodeSharePdfIds } from './playlistShare.js';\n\n/**\n * Share playlist link using Web Share API or clipboard fallback",
    1
)
texto = texto.replace(
    "  const pdfIdsParam = pdfIds.join(',');",
    "  // Cada id é codificado à parte para proteger o `+` do base64 (§2.4b da\n  // investigação). A leitura continua aceitando o formato cru dos links antigos.\n  const pdfIdsParam = encodeSharePdfIds(pdfIds);"
)
io.open(caminho, 'w', encoding='utf-8').write(texto)
EOF
node --test src/lib/utils/playlistShare.test.js 2>&1 | tail -6
```

Saída esperada: `ℹ tests 11`, `ℹ pass 11`, `ℹ fail 0`.

- [ ] **Step 8: Reescrever o consumo do link na home**

Substitui `handleSharedPlaylistLink` e o bloco reativo (`src/routes/+page.svelte:253-294`) inteiros. As cinco mudanças, todas visíveis no bloco: a guarda passa a ser `has('sharepdfs')` (marca processado mesmo com valor vazio — mata o bloco reativo girando de §2.4e); `sharename` vai direto, sem o segundo `decodeURIComponent` (D-6); a lista salva usa os ids **resolvidos**, os mesmos que o carrossel recebe (§2.4c); `findPlaylistByPdfIds` evita a duplicata (D-4); e a limpeza sai do `if`, roda sempre e preserva os params de terceiros (D-7, §2.4f/g).

```bash
python3 - <<'PYEOF'
import io
caminho = 'src/routes/+page.svelte'
texto = io.open(caminho, encoding='utf-8').read()

antigo_inicio = "  /**\n   * Handle shared playlist link from query parameters\n   */"
antigo_fim = "  // Normalize classification by removing content in parentheses"
i = texto.index(antigo_inicio)
j = texto.index(antigo_fim)

novo = '''  /**
   * Importa a lista compartilhada que veio na query (`?sharepdfs=...&sharename=...`).
   * A URL é limpa sempre que o param existe, mesmo quando nada é importado.
   */
  function handleSharedPlaylistLink() {
    if (sharedLinkProcessed) return;

    const urlParams = new URLSearchParams($page.url.search);
    if (!urlParams.has('sharepdfs')) return;
    // Sem catálogo não dá para resolver os ids: espera o manifesto (caso C2).
    if ($louvores.length === 0) return;

    sharedLinkProcessed = true;

    const pdfIds = parseSharePdfIds(urlParams.get('sharepdfs'));
    // A lista salva guarda os mesmos ids que o carrossel mostra: ids fantasmas
    // envenenariam findPlaylistByPdfIds para sempre.
    const idsResolvidos = resolveKnownPdfIds(pdfIds, $louvores);

    if (idsResolvidos.length > 0) {
      carousel.clearCarousel();
      carousel.loadPlaylist(idsResolvidos, $louvores);

      // URLSearchParams.get já decodificou uma vez; decodificar de novo lançava
      // URIError em qualquer nome com `%` e abortava o save.
      const sharename = urlParams.get('sharename');
      const playlistName = sharename || undefined;

      // Abrir o mesmo link várias vezes não cria listas duplicadas.
      if (!savedPlaylists.findPlaylistByPdfIds(idsResolvidos)) {
        savedPlaylists.savePlaylist(idsResolvidos, playlistName);
      }
    }

    // Limpa só os params do compartilhamento; utm_source/fbclid seguem vivos.
    // replaceState: voltar não pode reimportar a lista.
    const destino = $page.url.pathname + stripShareParams($page.url.search);
    goto(destino, { replaceState: true, noScroll: true });
  }

  // Importa assim que o catálogo existir; o link nunca se perde por chegar cedo.
  $: if (browser && $louvores.length > 0 && !sharedLinkProcessed && $page && $page.url) {
    handleSharedPlaylistLink();
  }

'''

texto = texto[:i] + novo + texto[j:]
texto = texto.replace(
    "  import { parseUrlParams, updateUrlParams } from '$lib/utils/urlSync';",
    "  import { parseUrlParams, updateUrlParams } from '$lib/utils/urlSync';\n  import {\n    parseSharePdfIds,\n    resolveKnownPdfIds,\n    stripShareParams\n  } from '$lib/utils/playlistShare';"
)
io.open(caminho, 'w', encoding='utf-8').write(texto)
PYEOF
grep -n "parseSharePdfIds\|stripShareParams\|resolveKnownPdfIds\|decodeURIComponent(sharename)" src/routes/+page.svelte
```

Saída esperada: quatro linhas do import, três usos dentro de `handleSharedPlaylistLink`, e **nenhuma** ocorrência de `decodeURIComponent(sharename)`.

- [ ] **Step 9: Ajustar as expectativas do contrato**

Sete casos do contrato da Tarefa 3 mudam de expectativa por decisão do cabeçalho, e nenhum outro pode mudar. Localize cada um e atualize a asserção para o comportamento novo:

```bash
grep -rn "C4\|C7\|C8\|C9\|C10\|C11\|C13\|D2" src/lib/utils/*.contrato.test.js src/lib/**/*.contrato.test.js 2>/dev/null
```

| Caso | Era | Passa a ser | Decisão |
|---|---|---|---|
| C4 | lista salva guarda o id fantasma | lista salva contém **só** os ids resolvidos | §2.4c |
| C7 | id com `+` quebra em silêncio | id com `+` sobrevive ida e volta | D-5 |
| C8 | `URIError`, lista não salva, URL suja | nome `Louvor 100%`, lista salva, URL limpa | D-6 |
| C9 | `?sharepdfs=` deixa a URL suja e o bloco girando | URL limpa, processado uma vez só | D-6/D-7 |
| C10 | `?sharepdfs=,,,` deixa a URL suja | URL limpa | D-7 |
| C11 | 3 aberturas → 3 listas | 3 aberturas → 1 lista | D-4 |
| C13 / D2 | limpeza descarta `pesquisa`/`utm_source` | limpeza preserva tudo que não seja `sharepdfs`/`sharename` | D-7 |

Casos que **continuam verdes sem alteração** e servem de rede: C1, C2, C3, C5, C6, C12, C14.

```bash
npm test 2>&1 | tail -4
```

Saída esperada: `ℹ fail 0`.

- [ ] **Step 10: Verificação em navegador**

O bloco reativo de importação não se prova em teste unitário.

```bash
npm run dev
```

Com o app aberto em `http://localhost:5173`, monte um link real: abra `/biblioteca`, adicione dois louvores ao carrossel, use o botão de compartilhar da barra do carrossel e cole o link copiado no bloco de notas. Depois cole no navegador, uma URL por vez, **sempre em aba nova**:

1. O link copiado, com `&sharename=Louvor%20100%25` no lugar do nome gerado. Esperado: o carrossel mostra os dois louvores, a lista aparece em `/listas` com o nome `Louvor 100%`, e a barra de endereços vira `http://localhost:5173/`. **Falha:** `URIError` no console, ou a lista não aparecer em `/listas`.
2. O mesmo link **três vezes seguidas** (recarregando com a URL completa). Esperado: `/listas` continua com **uma** lista. **Falha:** duas ou três listas idênticas.
3. `http://localhost:5173/?utm_source=whatsapp&sharepdfs=<cole os ids>&sharename=Teste`. Esperado: a barra vira `http://localhost:5173/?utm_source=whatsapp`. **Falha:** o `utm_source` sumir, ou `sharepdfs` continuar visível.
4. `http://localhost:5173/?sharepdfs=` e depois `http://localhost:5173/?sharepdfs=,,,`. Esperado nos dois: a barra vira `http://localhost:5173/`, o console fica limpo, e a aba não consome CPU. **Falha:** a URL continuar suja, ou o Performance do DevTools mostrar reavaliação contínua.
5. O link com um id inventado no meio (troque cinco caracteres do meio de um dos ids). Esperado: o carrossel mostra só os louvores válidos, e a lista salva em `/listas` tem exatamente a mesma quantidade de itens que o carrossel. **Falha:** contagens diferentes.

- [ ] **Step 11: Verificação completa**

```bash
npm test 2>&1 | tail -4
npm run build 2>&1 | tail -3
```

Saída esperada: `ℹ fail 0` e o build concluindo sem erro.

- [ ] **Step 12: Commit**

```bash
git add src/lib/utils/playlistShare.js \
        src/lib/utils/playlistShare.test.js \
        src/lib/utils/playlistUtils.js \
        src/routes/+page.svelte
git commit -m "fix(compartilhamento): proteger link de lista contra % e + e limpar a URL sem perder params de terceiros (#21)"
```

---

### Task 11: `urlSync` unidirecional e a home sem flags (#21 parte 2)

> **Antes de começar, leia as linhas K-1, K-2 e K-3 da tabela "Conflitos entre tarefas" no topo deste plano.** Esta tarefa foi redigida em paralelo com a Tarefa 3 e há sobreposição real: `urlEstado.js` só pode conter o que `urlParams.js` (criado pela Tarefa 3) ainda não resolve, e a guarda de rota é a `podeEscreverNaUrl` que a Tarefa 4 já criou — você muda *onde* ela é checada, não *qual* é a regra.

Hoje a home mantém dois sentidos de sincronização ao mesmo tempo — a URL escreve no estado e o estado escreve na URL — e segura os laços resultantes com sete variáveis de controle (`isUpdatingFromUrl`, `isUpdatingPageFromUrl`, `isUpdatingItemsPerPageFromUrl`, `homeUrlSyncInitialized`, `pageInitializedFromUrl`, `shouldResetPageOnFilterResult`, `lastKnownHomeUrl`) e cinco religamentos por `setTimeout` de 0 ou 100 ms (`+page.svelte:105`, `:141`, `:208`, `:346`, `:492`, `:500`, `:557`). A investigação mostrou que as flags de 100 ms são cinto redundante — quem realmente segura o laço é `lastKnownHomeUrl` — e que só o par `itensPorPagina` (blocos `:468` e `:507`, exatamente opostos) tem laço genuíno de duas pontas. `pageInitializedFromUrl` é escrita em quatro lugares e lida em nenhum. Três defeitos concretos saem disso: `?pesquisa=X&pagina=3` leva à página 3 em aba quente e à página 1 em aba fria, porque depende de o auto-select-all dos arranjos chegar antes ou depois do debounce de 300 ms (§4.7); duas escritas no mesmo tick partem da mesma base `get(page)` e a segunda descarta a primeira, defeito que o time já remendou pontualmente com `homeSearchUrlParams` (`:120-123`); e a home reescreve a barra de endereços sozinha, ~200 ms depois de abrir, para `?arranjo=<5 valores>` — o link mais copiado do app.

O desenho novo é uma regra só: **a URL é a fonte de verdade, o estado deriva dela por `$:`, e a escrita acontece exclusivamente em resposta a evento de usuário ou como normalização idempotente**. Uma escrita idempotente não precisa de flag: depois que ela acontece, a condição que a disparou é falsa, e o bloco reativo roda de novo sem fazer nada. É por isso que as sete flags e os cinco timers somem sem nada tomar o lugar deles. Sucesso é: o contrato da Tarefa 3 verde, `?pesquisa=amor&pagina=3` valendo 3 em aba fria e quente, nenhuma escrita de URL saindo de `/leitor`, e nenhum `setTimeout` restante em `+page.svelte` além dos dois debounces de busca (300 ms de filtragem, 500 ms de gravação).

**Files:**
- Create: `src/lib/utils/urlEstado.js`
- Create: `src/lib/utils/urlEstado.test.js`
- Modify: `src/lib/utils/urlSync.js:1-203` (reescrita; `parseUrlParams` fica como compatibilidade até a Tarefa 12)
- Modify: `src/lib/stores/filters.js:63-148`
- Modify: `src/lib/stores/classificationFilters.js:24-91`
- Modify: `src/lib/stores/pdfViewer.js:27-76`
- Modify: `src/routes/+page.svelte`

**Interfaces:**
- Consumes: da Tarefa 4, a guarda de rota em `updateUrlParams` (nenhuma escrita em `/leitor`) e o `parseUrlParams` já sem o duplo decode. Você **preserva** a guarda e **reforça** — ela passa a ser checada também no momento do flush, não só no da chamada. Não refaça a correção de decode.
- Consumes: o contrato executável da Tarefa 3 (casos F1-F18, P1-P4, P11, P16, D1-D9, R4-R5), rodado por `npm test`.
- Consumes: `updateUrlParams(newParams, options)` continua com a mesma assinatura de hoje (`urlSync.js:78`) — os 19 call sites existentes não mudam de forma.
- Produces: `lerEstadoDaUrl(url) => { pesquisa: string, materiais: string[], temMateriais: boolean, arranjo: string[], temArranjo: boolean, arranjoEspecial: string[], temArranjoEspecial: boolean, comoAbrir: string, ordenar: string, itensPorPagina: number, pagina: number, paramsInvalidos: string[] }` — nunca devolve `null` nem `NaN`.
- Produces: `aplicarParamsNaQuery(search: string, novos: object, opcoes?: {materiaisPadrao?: string[]}) => string` — query nova, sem `?`.
- Produces: `classificationFilters.aplicarPadrao(todas: string[]) => void` — popula o store **sem** escrever na URL.

- [ ] **Step 1: Branch**

```bash
cd "/Volumes/SSD 2TB SD/dev/plpcjf"
git checkout main && git pull
git checkout -b feat/21-urlsync-unidirecional
npm test 2>&1 | tail -4
```

Saída esperada: `ℹ fail 0`. Contrato vermelho aqui significa parar.

- [ ] **Step 2: Teste vermelho do leitor normalizado**

```bash
cat > src/lib/utils/urlEstado.test.js <<'EOF'
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lerEstadoDaUrl } from './urlEstado.js';

const u = (query) => new URL(`https://plpcg.com/${query}`);

describe('lerEstadoDaUrl', () => {
  it('lê o formato que o app grava sozinho hoje na barra de endereços (F1)', () => {
    const estado = lerEstadoDaUrl(
      u('?arranjo=Avulsos+Diversos%2CColet%C3%A2nea+Adultos%2CColet%C3%A2nea+CIAs%2CPES%2CPES+CIAs')
    );
    assert.deepEqual(estado.arranjo, [
      'Avulsos Diversos',
      'Coletânea Adultos',
      'Coletânea CIAs',
      'PES',
      'PES CIAs'
    ]);
    assert.equal(estado.temArranjo, true);
  });

  it('aceita CSV digitado à mão, com espaço, + e vírgulas sobrando (F2/F3)', () => {
    assert.deepEqual(lerEstadoDaUrl(u('?arranjo=PES,PES CIAs')).arranjo, ['PES', 'PES CIAs']);
    assert.deepEqual(lerEstadoDaUrl(u('?arranjo=PES+CIAs')).arranjo, ['PES CIAs']);
    assert.deepEqual(lerEstadoDaUrl(u('?arranjo=%20PES%20,,PES%20CIAs%20')).arranjo, [
      'PES',
      'PES CIAs'
    ]);
  });

  it('aceita materiais completos, que a escrita nunca produz (F6)', () => {
    const estado = lerEstadoDaUrl(u('?materiais=Partitura,Cifra,Gestos em Gravura'));
    assert.deepEqual(estado.materiais, ['Partitura', 'Cifra', 'Gestos em Gravura']);
    assert.equal(estado.temMateriais, true);
  });

  it('distingue param ausente de param vazio (F7/F8)', () => {
    assert.equal(lerEstadoDaUrl(u('')).temMateriais, false);
    assert.equal(lerEstadoDaUrl(u('?materiais=')).temMateriais, true);
    assert.deepEqual(lerEstadoDaUrl(u('?materiais=')).materiais, []);
  });

  it('devolve o texto de busca com % intacto (F16)', () => {
    assert.equal(lerEstadoDaUrl(u('?pesquisa=100%25')).pesquisa, '100%');
    assert.equal(lerEstadoDaUrl(u('?pesquisa=Cora%C3%A7%C3%A3o')).pesquisa, 'Coração');
    assert.equal(lerEstadoDaUrl(u('')).pesquisa, '');
  });

  it('normaliza comoAbrir inválido para leitor e aceita os cinco modos (F9/F10/F12)', () => {
    for (const modo of ['leitor', 'online', 'newtab', 'share', 'save']) {
      assert.equal(lerEstadoDaUrl(u(`?comoAbrir=${modo}`)).comoAbrir, modo);
    }
    assert.equal(lerEstadoDaUrl(u('?comoAbrir=lixo')).comoAbrir, 'leitor');
    assert.equal(lerEstadoDaUrl(u('')).comoAbrir, 'leitor');
  });

  it('nunca devolve NaN nem null para pagina (P4)', () => {
    assert.equal(lerEstadoDaUrl(u('?pagina=3')).pagina, 3);
    assert.equal(lerEstadoDaUrl(u('?pagina=0')).pagina, 1);
    assert.equal(lerEstadoDaUrl(u('?pagina=-2')).pagina, 1);
    assert.equal(lerEstadoDaUrl(u('?pagina=abc')).pagina, 1);
    assert.equal(lerEstadoDaUrl(u('')).pagina, 1);
  });

  it('normaliza ordenar (P7/P8/P9)', () => {
    assert.equal(lerEstadoDaUrl(u('?ordenar=nome')).ordenar, 'nome');
    assert.equal(lerEstadoDaUrl(u('?ordenar=numero')).ordenar, 'numero');
    assert.equal(lerEstadoDaUrl(u('?ordenar=aleatorio')).ordenar, 'numero');
  });

  it('normaliza itensPorPagina igual nas duas rotas (P10/P11)', () => {
    assert.equal(lerEstadoDaUrl(u('?itensPorPagina=25')).itensPorPagina, 25);
    assert.equal(lerEstadoDaUrl(u('?itensPorPagina=7')).itensPorPagina, 10);
    assert.equal(lerEstadoDaUrl(u('')).itensPorPagina, 10);
  });

  it('não confunde um valor que contém "arranjo=" com o param arranjo (D3)', () => {
    assert.equal(lerEstadoDaUrl(u('?pesquisa=arranjo=x')).temArranjo, false);
    assert.equal(lerEstadoDaUrl(u('?pesquisa=arranjo%3Dx')).temArranjo, false);
    assert.equal(lerEstadoDaUrl(u('?pesquisa=arranjo=x')).pesquisa, 'arranjo=x');
  });

  it('mantém as regras do URLSearchParams para chave repetida e caixa (D4/D5)', () => {
    assert.equal(lerEstadoDaUrl(u('?pesquisa=amor&pesquisa=paz')).pesquisa, 'amor');
    assert.equal(lerEstadoDaUrl(u('?PESQUISA=amor')).pesquisa, '');
  });

  it('lista os params conhecidos com valor inválido (D-9)', () => {
    assert.deepEqual(lerEstadoDaUrl(u('?comoAbrir=lixo&ordenar=aleatorio')).paramsInvalidos, [
      'comoAbrir',
      'ordenar'
    ]);
    assert.deepEqual(lerEstadoDaUrl(u('?itensPorPagina=7&pagina=abc')).paramsInvalidos, [
      'itensPorPagina',
      'pagina'
    ]);
    assert.deepEqual(lerEstadoDaUrl(u('?ordenar=nome&pagina=3')).paramsInvalidos, []);
  });
});
EOF
node --test src/lib/utils/urlEstado.test.js 2>&1 | tail -6
```

Saída esperada: `Cannot find module` apontando para `urlEstado.js`.

- [ ] **Step 3: Implementar o leitor**

```bash
cat > src/lib/utils/urlEstado.js <<'EOF'
/**
 * Leitura e escrita normalizadas da query string.
 *
 * Módulo puro de propósito: `urlSync.js` importa `$app/navigation` e
 * `$app/stores` e por isso não roda sob `node --test`. Toda a regra que dá para
 * testar mora aqui; lá sobra só o `goto`.
 *
 * Princípio: a URL é a fonte de verdade e `lerEstadoDaUrl` devolve sempre um
 * valor já válido — nunca `null`, nunca `NaN`. O `parseUrlParams` antigo
 * devolvia `NaN` para `?pagina=abc` e obrigava cada consumidor a blindar de
 * novo (§1.6 da investigação).
 */

export const CATEGORIAS_PADRAO = ['Partitura', 'Cifra', 'Gestos em Gravura'];
export const ITENS_POR_PAGINA_VALIDOS = [10, 25, 50];
export const ITENS_POR_PAGINA_PADRAO = 10;
export const ORDENACOES_VALIDAS = ['numero', 'nome'];
export const ORDENACAO_PADRAO = 'numero';
export const MODOS_ABERTURA_VALIDOS = ['leitor', 'online', 'newtab', 'share', 'save'];
export const MODO_ABERTURA_PADRAO = 'leitor';

/**
 * CSV tolerante: trim por item e descarte de vazios. `?arranjo= PES ,,PES CIAs `
 * e `?arranjo=PES,PES CIAs` são a mesma coisa — comportamento a preservar.
 * @param {string | null} valor
 * @returns {string[]}
 */
export function lerListaCsv(valor) {
  if (typeof valor !== 'string' || valor === '') return [];
  return valor
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** @param {string | number | null} valor @returns {number} */
export function normalizarPagina(valor) {
  const n = parseInt(String(valor), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** @param {string | number | null} valor @returns {number} */
export function normalizarItensPorPagina(valor) {
  const n = parseInt(String(valor), 10);
  return ITENS_POR_PAGINA_VALIDOS.includes(n) ? n : ITENS_POR_PAGINA_PADRAO;
}

/** @param {string | null} valor @returns {string} */
export function normalizarOrdenacao(valor) {
  return ORDENACOES_VALIDAS.includes(String(valor)) ? String(valor) : ORDENACAO_PADRAO;
}

/** @param {string | null} valor @returns {string} */
export function normalizarModoAbertura(valor) {
  return MODOS_ABERTURA_VALIDOS.includes(String(valor)) ? String(valor) : MODO_ABERTURA_PADRAO;
}

/**
 * Params conhecidos presentes na URL com valor que não sobrevive à
 * normalização. São os que a próxima escrita arruma (D-9).
 * @param {URLSearchParams} params
 * @returns {string[]}
 */
function listarParamsInvalidos(params) {
  const invalidos = [];
  if (params.has('comoAbrir') && !MODOS_ABERTURA_VALIDOS.includes(params.get('comoAbrir'))) {
    invalidos.push('comoAbrir');
  }
  if (params.has('ordenar') && !ORDENACOES_VALIDAS.includes(params.get('ordenar'))) {
    invalidos.push('ordenar');
  }
  if (
    params.has('itensPorPagina') &&
    String(normalizarItensPorPagina(params.get('itensPorPagina'))) !== params.get('itensPorPagina')
  ) {
    invalidos.push('itensPorPagina');
  }
  if (params.has('pagina') && String(normalizarPagina(params.get('pagina'))) !== params.get('pagina')) {
    invalidos.push('pagina');
  }
  return invalidos;
}

/**
 * Estado completo derivado da URL. Aceita um `URL`, um `$page.url` ou qualquer
 * objeto com `.search`.
 * @param {{search?: string} | URL} url
 */
export function lerEstadoDaUrl(url) {
  const params = new URLSearchParams((url && url.search) || '');
  return {
    pesquisa: params.get('pesquisa') || '',
    materiais: lerListaCsv(params.get('materiais')),
    temMateriais: params.has('materiais'),
    arranjo: lerListaCsv(params.get('arranjo')),
    temArranjo: params.has('arranjo'),
    arranjoEspecial: lerListaCsv(params.get('arranjoEspecial')),
    temArranjoEspecial: params.has('arranjoEspecial'),
    comoAbrir: normalizarModoAbertura(params.get('comoAbrir')),
    ordenar: normalizarOrdenacao(params.get('ordenar')),
    itensPorPagina: normalizarItensPorPagina(params.get('itensPorPagina')),
    pagina: normalizarPagina(params.get('pagina')),
    paramsInvalidos: listarParamsInvalidos(params)
  };
}
EOF
node --test src/lib/utils/urlEstado.test.js 2>&1 | tail -6
```

Saída esperada: `ℹ tests 12`, `ℹ pass 12`, `ℹ fail 0`.

- [ ] **Step 4: Teste vermelho da escrita**

```bash
python3 - <<'PYEOF'
import io
caminho = 'src/lib/utils/urlEstado.test.js'
texto = io.open(caminho, encoding='utf-8').read()
texto = texto.replace(
    "import { lerEstadoDaUrl } from './urlEstado.js';",
    "import { aplicarParamsNaQuery, lerEstadoDaUrl } from './urlEstado.js';"
)
texto += '''
describe('aplicarParamsNaQuery', () => {
  it('nunca apaga params de terceiros (D1/D2/D6)', () => {
    const query = aplicarParamsNaQuery('?utm_source=whatsapp&fbclid=IwAR1&ordenar=nome', {
      pesquisa: 'amor'
    });
    const params = new URLSearchParams(query);
    assert.equal(params.get('utm_source'), 'whatsapp');
    assert.equal(params.get('fbclid'), 'IwAR1');
    assert.equal(params.get('ordenar'), 'nome');
    assert.equal(params.get('pesquisa'), 'amor');
  });

  it('apaga os valores padrão e mantém os não-padrão', () => {
    assert.equal(aplicarParamsNaQuery('?pagina=5', { pagina: 1 }), '');
    assert.equal(aplicarParamsNaQuery('', { pagina: 4 }), 'pagina=4');
    assert.equal(aplicarParamsNaQuery('?itensPorPagina=25', { itensPorPagina: 10 }), '');
    assert.equal(aplicarParamsNaQuery('', { itensPorPagina: 50 }), 'itensPorPagina=50');
    assert.equal(aplicarParamsNaQuery('?ordenar=nome', { ordenar: 'numero' }), '');
    assert.equal(aplicarParamsNaQuery('?comoAbrir=newtab', { comoAbrir: 'leitor' }), '');
    assert.equal(aplicarParamsNaQuery('?pesquisa=amor', { pesquisa: '   ' }), '');
  });

  it('some com materiais quando todos estão selecionados', () => {
    const query = aplicarParamsNaQuery('', {
      materiais: ['Cifra', 'Gestos em Gravura', 'Partitura']
    });
    assert.equal(query, '');
  });

  it('grava materiais= vazio quando nada está selecionado (D-8)', () => {
    const query = aplicarParamsNaQuery('', { materiais: [] });
    assert.equal(query, 'materiais=');
    assert.equal(lerEstadoDaUrl({ search: `?${query}` }).temMateriais, true);
    assert.deepEqual(lerEstadoDaUrl({ search: `?${query}` }).materiais, []);
  });

  it('grava arranjo= e arranjoEspecial= vazios, pelo mesmo motivo', () => {
    assert.equal(aplicarParamsNaQuery('?arranjo=PES', { arranjo: [] }), 'arranjo=');
    assert.equal(
      aplicarParamsNaQuery('?arranjoEspecial=GLTM', { arranjoEspecial: [] }),
      'arranjoEspecial='
    );
  });

  it('normaliza params conhecidos inválidos mesmo sem falar deles (D-9)', () => {
    const query = aplicarParamsNaQuery('?comoAbrir=lixo&ordenar=aleatorio&itensPorPagina=7', {});
    assert.equal(query, '');
    assert.equal(aplicarParamsNaQuery('?utm_source=x&pagina=abc', {}), 'utm_source=x');
  });

  it('acumula escritas sucessivas em vez de descartar a anterior (§4.9)', () => {
    // É o que `homeSearchUrlParams` remendava à mão: gravar `pesquisa` não pode
    // derrubar um `pagina` gravado no mesmo flush.
    const primeira = aplicarParamsNaQuery('', { pagina: 3 });
    const segunda = aplicarParamsNaQuery(primeira, { pesquisa: 'amor' });
    const params = new URLSearchParams(segunda);
    assert.equal(params.get('pagina'), '3');
    assert.equal(params.get('pesquisa'), 'amor');
  });
});
'''
io.open(caminho, 'w', encoding='utf-8').write(texto)
PYEOF
node --test src/lib/utils/urlEstado.test.js 2>&1 | tail -6
```

Saída esperada: `ℹ tests 19`, `ℹ pass 12`, `ℹ fail 7` — os sete novos falham com `aplicarParamsNaQuery is not a function`.

- [ ] **Step 5: Implementar a escrita**

```bash
cat >> src/lib/utils/urlEstado.js <<'EOF'

/**
 * Aplica um conjunto de params sobre uma query existente e devolve a query
 * nova (sem `?`). Preserva tudo que não for citado — inclusive `utm_source`,
 * `fbclid` e params inertes de outras rotas.
 *
 * @param {string} search - query atual, com ou sem `?`
 * @param {Object} novos
 * @param {{materiaisPadrao?: string[]}} [opcoes]
 * @returns {string}
 */
export function aplicarParamsNaQuery(search, novos = {}, opcoes = {}) {
  const { materiaisPadrao = CATEGORIAS_PADRAO } = opcoes;
  const params = new URLSearchParams(search || '');

  if (novos.pesquisa !== undefined) {
    const valor = String(novos.pesquisa || '').trim();
    if (valor) params.set('pesquisa', valor);
    else params.delete('pesquisa');
  }

  if (novos.materiais !== undefined) {
    const lista = Array.isArray(novos.materiais) ? novos.materiais : [];
    const todosSelecionados =
      lista.length === materiaisPadrao.length && materiaisPadrao.every((m) => lista.includes(m));
    // "Tudo selecionado" é o padrão e some da URL. "Nada selecionado" passa a
    // ser gravado como `materiais=` vazio: o estado é alcançável pela UI e
    // antes se perdia ao recarregar (D-8).
    if (todosSelecionados) params.delete('materiais');
    else params.set('materiais', lista.join(','));
  }

  // arranjo e arranjoEspecial não têm "todos = padrão" gravável: o padrão é a
  // ausência do param, calculada pela página. Vazio é gravado como vazio, para
  // que "desmarquei tudo" sobreviva a um F5.
  if (novos.arranjo !== undefined) {
    const lista = Array.isArray(novos.arranjo) ? novos.arranjo : [];
    params.set('arranjo', lista.join(','));
  }
  if (novos.arranjoEspecial !== undefined) {
    const lista = Array.isArray(novos.arranjoEspecial) ? novos.arranjoEspecial : [];
    params.set('arranjoEspecial', lista.join(','));
  }

  if (novos.comoAbrir !== undefined) {
    const valor = normalizarModoAbertura(novos.comoAbrir);
    if (valor === MODO_ABERTURA_PADRAO) params.delete('comoAbrir');
    else params.set('comoAbrir', valor);
  }

  if (novos.ordenar !== undefined) {
    const valor = normalizarOrdenacao(novos.ordenar);
    if (valor === ORDENACAO_PADRAO) params.delete('ordenar');
    else params.set('ordenar', valor);
  }

  if (novos.itensPorPagina !== undefined) {
    const valor = normalizarItensPorPagina(novos.itensPorPagina);
    if (valor === ITENS_POR_PAGINA_PADRAO) params.delete('itensPorPagina');
    else params.set('itensPorPagina', String(valor));
  }

  if (novos.pagina !== undefined) {
    const valor = normalizarPagina(novos.pagina);
    if (valor === 1) params.delete('pagina');
    else params.set('pagina', String(valor));
  }

  // D-9: todo param conhecido com valor inválido é arrumado na próxima escrita,
  // mesmo que esta escrita não fale dele. Params desconhecidos nunca são tocados.
  for (const chave of listarParamsInvalidos(params)) {
    if (chave === 'comoAbrir' || chave === 'ordenar') {
      params.delete(chave);
    } else if (chave === 'itensPorPagina') {
      const valor = normalizarItensPorPagina(params.get('itensPorPagina'));
      if (valor === ITENS_POR_PAGINA_PADRAO) params.delete('itensPorPagina');
      else params.set('itensPorPagina', String(valor));
    } else if (chave === 'pagina') {
      const valor = normalizarPagina(params.get('pagina'));
      if (valor === 1) params.delete('pagina');
      else params.set('pagina', String(valor));
    }
  }

  return params.toString();
}
EOF
node --test src/lib/utils/urlEstado.test.js 2>&1 | tail -6
```

Saída esperada: `ℹ tests 19`, `ℹ pass 19`, `ℹ fail 0`.

- [ ] **Step 6: Reescrever `urlSync.js`**

Duas mudanças estruturais: a query passa a ser acumulada num buffer antes do `goto`, de modo que duas escritas no mesmo tick se somem em vez de a segunda descartar a primeira (§4.9 — é isto que aposenta `homeSearchUrlParams`); e a guarda de rota da Tarefa 4 passa a ser checada **também no flush**, porque entre a chamada e o `goto` o usuário pode ter clicado num louvor e a rota já ser `/leitor` (§4.8, caso R4). `parseUrlParams` fica de pé, sem mudar, porque `biblioteca/+page.svelte`, `bibliotecaSort.js` e `bibliotecaItemsPerPage.js` ainda dependem dele; a Tarefa 12 o apaga.

```bash
python3 - <<'PYEOF'
import io
caminho = 'src/lib/utils/urlSync.js'
texto = io.open(caminho, encoding='utf-8').read()

cabecalho = """import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { get } from 'svelte/store';
import { aplicarParamsNaQuery, lerEstadoDaUrl } from './urlEstado.js';

export { lerEstadoDaUrl };

/**
 * Rotas onde nenhuma escrita de URL é permitida. `/leitor` lê `file`, `titulo`,
 * `subtitulo` e `validated` direto da query: uma reescrita ali quebra o PDF.
 */
const ROTAS_SEM_ESCRITA = ['/leitor'];

/**
 * Query acumulada até o próximo flush. Sem isto, duas chamadas no mesmo tick
 * partiriam ambas de `get(page)` e a segunda descartaria a primeira (§4.9).
 * @type {string | null}
 */
let queryPendente = null;
/** @type {string | null} */
let rotaPendente = null;
let flushAgendado = false;
let versaoFlush = 0;

function agendarFlush() {
  if (flushAgendado) return;
  flushAgendado = true;
  queueMicrotask(async () => {
    flushAgendado = false;
    const query = queryPendente;
    const rota = rotaPendente;
    const versao = ++versaoFlush;

    // A rota pode ter mudado entre o agendamento e o flush: digitar e clicar
    // num louvor em menos de 500 ms levava a escrita de `pesquisa` para dentro
    // da URL do leitor (§4.8).
    const atual = get(page);
    const rotaAgora = atual && atual.url ? atual.url.pathname : null;
    if (rotaAgora !== rota || ROTAS_SEM_ESCRITA.includes(String(rotaAgora))) {
      queryPendente = null;
      rotaPendente = null;
      return;
    }

    await goto(rota + (query ? `?${query}` : ''), {
      replaceState: true,
      noScroll: true,
      keepFocus: true
    });

    // Só esquece o acumulado se ninguém escreveu por cima durante o goto.
    if (versao === versaoFlush) {
      queryPendente = null;
      rotaPendente = null;
    }
  });
}

/**
 * Atualiza params da URL preservando todos os demais.
 * Sempre `replaceState`: filtro, busca e paginação não entram no histórico.
 * @param {Object} newParams
 * @param {{defaultMateriais?: string[]}} [options]
 */
export function updateUrlParams(newParams, options = {}) {
  const atual = get(page);
  if (!atual || !atual.url || !atual.url.pathname) {
    console.warn('updateUrlParams: página inválida', atual);
    return;
  }

  const pathname = atual.url.pathname;
  if (ROTAS_SEM_ESCRITA.includes(pathname)) return;

  const base = queryPendente !== null && rotaPendente === pathname ? queryPendente : atual.url.search;
  queryPendente = aplicarParamsNaQuery(base, newParams, {
    materiaisPadrao: options.defaultMateriais
  });
  rotaPendente = pathname;
  agendarFlush();
}

"""

# Mantém apenas parseUrlParams e seus auxiliares, para a biblioteca (Tarefa 12).
inicio_legado = texto.index('/**\n * Serializa um array')
fim_legado = texto.index('/**\n * Atualiza os params da URL')
legado = texto[inicio_legado:fim_legado]

io.open(caminho, 'w', encoding='utf-8').write(
    cabecalho
    + '// --- Compatibilidade: só `biblioteca/+page.svelte`, `bibliotecaSort.js` e\n'
    + '// `bibliotecaItemsPerPage.js` ainda usam isto. A Tarefa 12 apaga o bloco abaixo.\n'
    + legado
)
PYEOF
grep -c "setTimeout" src/lib/utils/urlSync.js; grep -n "export function" src/lib/utils/urlSync.js
npm run build 2>&1 | tail -3
```

Saída esperada: `0` ocorrências de `setTimeout`; os exports `serializeArrayParam`, `deserializeArrayParam`, `parseUrlParams` e `updateUrlParams`; build concluindo.

- [ ] **Step 7: Tirar as seis flags de 0 ms das três stores globais**

`filters.js`, `classificationFilters.js` e `pdfViewer.js` têm um `page.subscribe` de **módulo** que roda em qualquer rota, cada um com o par `isUpdatingFromUrl`/`isUpdatingUrl` religado por `setTimeout(…, 0)`. No desenho novo o `subscribe` é só leitor — quem escreve são os setters, que são eventos de usuário — então as flags não têm o que proteger: basta o setter atualizar também a memória `currentValue` para o leitor não refazer trabalho. De quebra, a detecção "o param existe?" sai do teste de substring `search.includes('materiais=')` para `searchParams.has('materiais')`, o que corrige o falso-positivo do caso D3.

```bash
python3 - <<'PYEOF'
import io

# --- filters.js -------------------------------------------------------------
caminho = 'src/lib/stores/filters.js'
texto = io.open(caminho, encoding='utf-8').read()
texto = texto.replace(
    "import { parseUrlParams, updateUrlParams } from '$lib/utils/urlSync';",
    "import { lerEstadoDaUrl, updateUrlParams } from '$lib/utils/urlSync';"
)
texto = texto.replace("const urlParams = parseUrlParams(currentPage.url);", "const urlParams = lerEstadoDaUrl(currentPage.url);")
inicio = texto.index("function createFiltersStore() {")
fim = texto.index("  return {\n    subscribe,\n    set: (categories) => {")
texto = texto[:inicio] + '''function createFiltersStore() {
  const { subscribe, set: setStore, update } = writable(getInitialFilters());
  let currentValue = getInitialFilters();

  // Leitor: a URL manda. Não há flag porque este bloco nunca escreve.
  if (browser) {
    page.subscribe(($page) => {
      if (!$page || !$page.url) return;

      const estado = lerEstadoDaUrl($page.url);
      // `searchParams.has` no lugar de `search.includes('materiais=')`: a
      // substring dava falso-positivo dentro do valor de outro param (D3).
      const novoValor = estado.temMateriais
        ? normalizeCategoryOrder(estado.materiais)
        : CATEGORY_OPTIONS;

      if (!areCategoriesEqual(novoValor, currentValue)) {
        setStore(novoValor);
        currentValue = novoValor;
      }
    });
  }

  function updateUrl(categories) {
    if (!browser) return;
    const normalizadas = normalizeCategoryOrder(categories);
    // Atualiza a memória antes do goto: o leitor acima vê o valor já casado e
    // não refaz nada quando `$page` chegar.
    currentValue = normalizadas;
    updateUrlParams({ materiais: normalizadas }, { defaultMateriais: CATEGORY_OPTIONS });
  }

''' + texto[fim:]
io.open(caminho, 'w', encoding='utf-8').write(texto)

# --- classificationFilters.js ----------------------------------------------
caminho = 'src/lib/stores/classificationFilters.js'
texto = io.open(caminho, encoding='utf-8').read()
texto = texto.replace(
    "import { parseUrlParams, updateUrlParams } from '$lib/utils/urlSync';",
    "import { lerEstadoDaUrl, updateUrlParams } from '$lib/utils/urlSync';"
)
texto = texto.replace("const urlParams = parseUrlParams(currentPage.url);", "const urlParams = lerEstadoDaUrl(currentPage.url);")
inicio = texto.index("function createClassificationFiltersStore() {")
fim = texto.index("  return {\n    subscribe,\n    toggleClassification:")
texto = texto[:inicio] + '''/**
 * Compara dois conjuntos ignorando a ordem, sem serializar e sem `.sort()` —
 * o `.sort()` do código antigo mutava o array guardado no lugar.
 * @param {string[]} a
 * @param {string[]} b
 */
function mesmosArranjos(a, b) {
  if (a.length !== b.length) return false;
  const conjunto = new Set(a);
  return b.every((item) => conjunto.has(item));
}

function createClassificationFiltersStore() {
  const { subscribe, set, update } = writable(getInitialFilters());
  let currentValue = getInitialFilters();

  // Leitor: a URL manda quando o param existe. Ausente significa "padrão", e
  // quem sabe qual é o padrão é a página — daí `aplicarPadrao` abaixo.
  if (browser) {
    page.subscribe(($page) => {
      if (!$page || !$page.url) return;

      const estado = lerEstadoDaUrl($page.url);
      if (!estado.temArranjo) return;

      if (!mesmosArranjos(estado.arranjo, currentValue)) {
        set(estado.arranjo);
        currentValue = estado.arranjo;
      }
    });
  }

  function updateUrl(classifications) {
    if (!browser) return;
    currentValue = classifications;
    updateUrlParams({ arranjo: classifications });
  }

''' + texto[fim:]
texto = texto.replace(
    "    deselectAll: () => {\n      set([]);\n      updateUrl([]);\n    }",
    '''    deselectAll: () => {
      set([]);
      updateUrl([]);
    },
    /**
     * Popula o store com o padrão calculado pela página **sem escrever na URL**.
     * É o que substitui o `?arranjo=<5 valores>` que a home gravava sozinha
     * ~200 ms depois de abrir (D-2). Links nesse formato continuam sendo lidos.
     * @param {string[]} todas
     */
    aplicarPadrao: (todas) => {
      set(todas);
      currentValue = todas;
    }'''
)
io.open(caminho, 'w', encoding='utf-8').write(texto)

# --- pdfViewer.js -----------------------------------------------------------
caminho = 'src/lib/stores/pdfViewer.js'
texto = io.open(caminho, encoding='utf-8').read()
texto = texto.replace(
    "import { parseUrlParams, updateUrlParams } from '$lib/utils/urlSync';",
    "import { lerEstadoDaUrl, updateUrlParams } from '$lib/utils/urlSync';"
)
texto = texto.replace("const urlParams = parseUrlParams(currentPage.url);", "const urlParams = lerEstadoDaUrl(currentPage.url);")
inicio = texto.index("function createPdfViewerStore() {")
fim = texto.index("  return {\n    subscribe,\n    set: (value) => {")
texto = texto[:inicio] + '''function createPdfViewerStore() {
  const { subscribe, set } = writable(getInitialViewerMode());
  let currentValue = getInitialViewerMode();

  // Leitor puro: `lerEstadoDaUrl` já normaliza ausente e inválido para 'leitor'.
  if (browser) {
    page.subscribe(($page) => {
      if (!$page || !$page.url) return;
      const novoValor = lerEstadoDaUrl($page.url).comoAbrir;
      if (novoValor !== currentValue) {
        set(novoValor);
        currentValue = novoValor;
      }
    });
  }

  function updateUrl(value) {
    if (!browser) return;
    currentValue = value;
    updateUrlParams({ comoAbrir: value }, { defaultComoAbrir: DEFAULT_VIEWER_MODE });
  }

''' + texto[fim:]
io.open(caminho, 'w', encoding='utf-8').write(texto)
PYEOF
grep -c "setTimeout\|isUpdatingUrl\|isUpdatingFromUrl" src/lib/stores/filters.js src/lib/stores/classificationFilters.js src/lib/stores/pdfViewer.js
grep -rn "includes('materiais=')\|includes('comoAbrir=')" src/lib/stores/
npm run build 2>&1 | tail -3
```

Saída esperada: `0` nos três arquivos, nenhuma linha de `includes(...)` nas stores, build concluindo.

- [ ] **Step 8: Home — todo o estado passa a derivar da URL**

Substitui as declarações de estado e os blocos de leitura. Some `isUpdatingFromUrl`, `isUpdatingPageFromUrl`, `isUpdatingItemsPerPageFromUrl`, `homeUrlSyncInitialized`, `pageInitializedFromUrl`, `lastKnownHomeUrl`, `shouldResetPageOnFilterResult` e `homeSearchUrlParams`.

```bash
python3 - <<'PYEOF'
import io
caminho = 'src/routes/+page.svelte'
texto = io.open(caminho, encoding='utf-8').read()

texto = texto.replace(
    "  import { parseUrlParams, updateUrlParams } from '$lib/utils/urlSync';",
    "  import { lerEstadoDaUrl, updateUrlParams } from '$lib/utils/urlSync';"
)

inicio = texto.index("  // Inicializar searchQuery da URL")
fim = texto.index("  /**\n   * @param {any[]} results\n   */")
texto = texto[:inicio] + '''  // A URL é a fonte de verdade. Todo o estado de busca, filtro e paginação
  // deriva dela; a escrita só nasce de evento de usuário ou de normalização
  // idempotente. Por isso não existe nenhuma flag de "estou atualizando".
  $: estadoUrl = lerEstadoDaUrl(browser && $page && $page.url ? $page.url : { search: '' });
  $: naHome = browser && $page?.url?.pathname === '/';

  /** Texto do input. Só é reescrito quando o valor **da URL** muda de verdade. */
  let searchQuery = browser && $page && $page.url ? lerEstadoDaUrl($page.url).pesquisa : '';
  let ultimaPesquisaDaUrl = searchQuery;
  $: if (browser && estadoUrl.pesquisa !== ultimaPesquisaDaUrl) {
    ultimaPesquisaDaUrl = estadoUrl.pesquisa;
    if (estadoUrl.pesquisa !== (searchQuery || '').trim()) {
      searchQuery = estadoUrl.pesquisa;
    }
  }

  /** @type {any[]} */
  let filteredResults = [];
  /** @type {any} */
  let debounceTimer = null;
  /** @type {any} */
  let searchUrlUpdateTimer = null;
  let sharedLinkProcessed = false;
  let pageInput = '1';
  /** @type {any[]} */
  let paginatedResults = [];
  let filtersExpanded = false;

  /** Vira true quando filterLouvores já rodou com catálogo e arranjos prontos. */
  let resultadosProntos = false;
  /** Critério de filtro da última execução; mudar de verdade zera a paginação. */
  /** @type {string | null} */
  let criterioAnterior = null;

''' + texto[fim:]

# finalizeFilteredResults perde a lógica de paginação: ela virou bloco reativo.
inicio = texto.index("  function finalizeFilteredResults(results) {")
fim = texto.index("  function scrollHomeResultsTop() {")
texto = texto[:inicio] + '''  function finalizeFilteredResults(results) {
    filteredResults = results;
    // Marca que já houve uma filtragem real. Antes disso, ajustar a paginação
    // seria apagar o `?pagina=3` de um deep link em aba fria (§4.7 / D-3).
    if ($louvoresLoaded && $louvores.length > 0 && $classificationFilters.length > 0) {
      resultadosProntos = true;
    }
  }

  /**
   * Única porta de escrita da paginação. Não mexe em estado local: a página vem
   * da URL, e a URL vem daqui.
   * @param {number} p
   * @param {{ scroll?: boolean }} [opts]
   */
  function setPage(p, { scroll = true } = {}) {
    const alvo = Math.max(1, Math.min(totalPagesHome, p));
    updateUrlParams({ pagina: alvo });
    if (scroll && browser) {
      scrollHomeResultsTop();
    }
  }

''' + texto[fim:]

# Remove o bloco reativo URL -> searchQuery com flag e o remendo homeSearchUrlParams.
inicio = texto.index("  /** Mantém `pagina` na URL ao sincronizar pesquisa")
fim = texto.index("  let filtersInitialized = false;")
texto = texto[:inicio] + texto[fim:]

io.open(caminho, 'w', encoding='utf-8').write(texto)
PYEOF
grep -c "isUpdatingFromUrl\|isUpdatingPageFromUrl\|isUpdatingItemsPerPageFromUrl\|homeUrlSyncInitialized\|pageInitializedFromUrl\|lastKnownHomeUrl\|shouldResetPageOnFilterResult\|homeSearchUrlParams" src/routes/+page.svelte
```

Saída esperada: um número maior que zero ainda — as ocorrências restantes vivem nos blocos que o Step 9 substitui. Não rode `npm run build` aqui; o arquivo está no meio da conversão.

- [ ] **Step 9: Home — derivação da página e escritas idempotentes**

Aqui moram as três coisas que a tarefa precisa resolver de propósito. A paginação passa a ser derivada e limitada pelo total (`currentPage`), a correção da URL só acontece **depois** que houve filtragem real (é isso que faz `?pesquisa=X&pagina=3` valer 3 em aba fria e em aba quente, D-3), e o reset por mudança de filtro registra a primeira chave sem resetar — a chegada dos arranjos deixa de ser "uma mudança" e passa a ser "o começo".

```bash
python3 - <<'PYEOF'
import io
caminho = 'src/routes/+page.svelte'
texto = io.open(caminho, encoding='utf-8').read()

inicio = texto.index("  $: groupedResults = groupLouvoresByGroupId(filteredResults);")
fim = texto.index("  // Debounce: Aguarda 300ms após o usuário parar de digitar")
texto = texto[:inicio] + '''  $: groupedResults = groupLouvoresByGroupId(filteredResults);
  $: itemsPerPageHome = $bibliotecaItemsPerPage;
  $: totalPagesHome =
    groupedResults.length === 0 ? 1 : Math.max(1, Math.ceil(groupedResults.length / itemsPerPageHome));

  /** Página efetiva: a que está na URL, limitada ao que existe de verdade. */
  $: currentPage = Math.min(Math.max(1, estadoUrl.pagina), totalPagesHome);
  $: paginatedResults = groupedResults.slice(
    (currentPage - 1) * itemsPerPageHome,
    currentPage * itemsPerPageHome
  );

  /** Espelha a página efetiva no input, sem atropelar quem está digitando nele. */
  let ultimaPaginaPublicada = null;
  $: if (currentPage !== ultimaPaginaPublicada) {
    ultimaPaginaPublicada = currentPage;
    pageInput = String(currentPage);
  }

  // Corrige a URL quando a página pedida não existe mais (P2/P3). Idempotente:
  // depois da escrita a condição é falsa. Sem `resultadosProntos`, `?pagina=3`
  // seria apagado antes de a lista existir — a corrida de §4.7.
  $: if (browser && naHome && resultadosProntos && estadoUrl.pagina !== currentPage) {
    updateUrlParams({ pagina: currentPage });
  }

  // itensPorPagina: o param manda quando existe; quando não existe, a
  // preferência do store (compartilhada com /biblioteca, D-10) é publicada.
  // Também idempotente: depois de uma passada as duas pontas coincidem.
  $: if (browser && naHome && $page?.url) {
    const temParam = $page.url.searchParams.has('itensPorPagina');
    if (temParam && estadoUrl.itensPorPagina !== $bibliotecaItemsPerPage) {
      bibliotecaItemsPerPage.set(estadoUrl.itensPorPagina);
    } else if (!temParam && $bibliotecaItemsPerPage !== 10) {
      updateUrlParams({ itensPorPagina: $bibliotecaItemsPerPage });
    }
  }

  // D-9: param conhecido com valor inválido é normalizado uma vez. Resolve a
  // assimetria home × biblioteca do `?itensPorPagina=7` (P10/P11) e o
  // `?comoAbrir=lixo` que ficava pendurado para sempre (F12).
  $: if (browser && naHome && estadoUrl.paramsInvalidos.length > 0) {
    updateUrlParams({});
  }

  // Chave de identidade do filtro. Separadores fora do alfabeto dos valores:
  // o `::`/`|` antigo colidiria com um arranjo chamado `A::B` (§4.1).
  $: criterioAtual = [
    estadoUrl.pesquisa,
    [...$filters].sort().join('\\u0001'),
    [...$classificationFilters].sort().join('\\u0001')
  ].join('\\u0000');

  // Trocar de filtro volta para a página 1. A **primeira** chave é só
  // registrada: é o que preserva a página de um deep link (D-3).
  $: if (browser && naHome && resultadosProntos) {
    if (criterioAnterior === null) {
      criterioAnterior = criterioAtual;
    } else if (criterioAtual !== criterioAnterior) {
      criterioAnterior = criterioAtual;
      if (estadoUrl.pagina !== 1) {
        updateUrlParams({ pagina: 1 });
      }
    }
  }

''' + texto[fim:]

# Debounce sem flag: a guarda passa a ser "o valor mudou", não "quem está escrevendo".
inicio = texto.index("  $: if (searchQuery !== undefined && !isUpdatingFromUrl && browser) {")
fim = texto.index("  // Initialize filters with all classifications on first load")
texto = texto[:inicio] + '''  $: if (browser && searchQuery !== undefined) {
    $filters;
    $classificationFilters;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      filterLouvores();
    }, 300);

    if (searchUrlUpdateTimer) clearTimeout(searchUrlUpdateTimer);
    searchUrlUpdateTimer = setTimeout(() => {
      // Digitar é evento de usuário: a escrita nasce daqui e nunca da URL.
      if (!naHome) return;
      if (estadoUrl.pesquisa === (searchQuery || '').trim()) return;
      updateUrlParams({ pesquisa: searchQuery });
    }, 500);
  } else if (!browser) {
    filterLouvores();
  }

''' + texto[fim:]
io.open(caminho, 'w', encoding='utf-8').write(texto)
PYEOF
grep -n "setTimeout" src/routes/+page.svelte
```

Saída esperada: exatamente duas linhas — os debounces de 300 ms e 500 ms. Nenhum religamento de flag sobrou.

- [ ] **Step 10: Home — apagar o resto e parar de gravar `?arranjo=` sozinho**

Cinco limpezas: `handleSearch()` é código morto (`SearchBar.svelte` só despacha `clear` e `blur`); o `onMount` deixa de ler a URL para dentro de estado local; `initializeFiltersIfNeeded` passa a usar `aplicarPadrao`, que **não** escreve a URL (D-2) e usa `temArranjo` no lugar da substring (D3); os handlers de busca e de itens por página escrevem direto; e o cleanup de timers sai do `onMount` `async` — onde o Svelte **ignora** o retorno — para um `onDestroy` de verdade.

```bash
python3 - <<'PYEOF'
import io
caminho = 'src/routes/+page.svelte'
texto = io.open(caminho, encoding='utf-8').read()

texto = texto.replace("  import { onMount } from 'svelte';", "  import { onDestroy, onMount } from 'svelte';")

# initializeFiltersIfNeeded: padrão calculado, não gravado.
inicio = texto.index("  function initializeFiltersIfNeeded() {")
fim = texto.index("  /**\n   * @param {CustomEvent<{ value: number }>} e\n   */")
texto = texto[:inicio] + '''  function initializeFiltersIfNeeded() {
    if (filtersInitialized || !browser || !$louvoresLoaded || !$louvores.length) return;

    const classifications = uniqueNormalizedClassifications;
    if (classifications.length === 0) return;

    filtersInitialized = true;
    // D-2: o padrão "todos os arranjos" deixa de ser gravado na barra de
    // endereços. Os links já compartilhados no formato `?arranjo=<5 valores>`
    // continuam sendo lidos — quem os lê é o page.subscribe da store.
    if (!estadoUrl.temArranjo && $classificationFilters.length === 0) {
      classificationFilters.aplicarPadrao(classifications);
    }
  }

''' + texto[fim:]

# handleHomeItemsPerPage: as duas escritas viram um goto só.
texto = texto.replace('''  function handleHomeItemsPerPage(e) {
    bibliotecaItemsPerPage.set(e.detail.value);
    setPage(1, { scroll: false });
    scrollHomeResultsTop();
  }''', '''  function handleHomeItemsPerPage(e) {
    bibliotecaItemsPerPage.set(e.detail.value);
    // As duas escritas entram na mesma query pendente e viram um goto só.
    updateUrlParams({ itensPorPagina: e.detail.value, pagina: 1 });
    scrollHomeResultsTop();
  }''')

# onMount: só carrega o catálogo. O bloco reativo de backup inicializa os filtros.
inicio = texto.index("  onMount(async () => {")
fim = texto.index("  /**\n   * Importa a lista compartilhada")
texto = texto[:inicio] + '''  onMount(async () => {
    await loadLouvores();
  });

  // O retorno de um onMount `async` é uma Promise e o Svelte o ignora: o
  // cleanup antigo nunca rodava. Os timers agora morrem aqui.
  onDestroy(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (searchUrlUpdateTimer) clearTimeout(searchUrlUpdateTimer);
  });

''' + texto[fim:]

# handleSearch morto, flush e clear sem flag.
inicio = texto.index("  function handleSearch() {")
fim = texto.index("  function filterLouvores() {")
texto = texto[:inicio] + '''  /**
   * Ao sair do campo, grava o texto imediatamente em vez de esperar o debounce.
   */
  function flushSearchToUrlOnBlur() {
    if (!browser || !naHome) return;
    if (searchUrlUpdateTimer) {
      clearTimeout(searchUrlUpdateTimer);
      searchUrlUpdateTimer = null;
    }
    if (estadoUrl.pesquisa === (searchQuery || '').trim()) return;
    updateUrlParams({ pesquisa: searchQuery });
  }

  function handleClear() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (searchUrlUpdateTimer) {
      clearTimeout(searchUrlUpdateTimer);
      searchUrlUpdateTimer = null;
    }
    searchQuery = '';
    filteredResults = [];
    updateUrlParams({ pesquisa: '', pagina: 1 });
  }

''' + texto[fim:]

# filterLouvores perde o cálculo de criteriaKey, que virou bloco reativo.
inicio = texto.index("  function filterLouvores() {\n    const qNow")
fim = texto.index("    if (!$louvores || $louvores.length === 0) {")
texto = texto[:inicio] + "  function filterLouvores() {\n" + texto[fim:]

io.open(caminho, 'w', encoding='utf-8').write(texto)
PYEOF
grep -c "handleSearch\|lastSearchAppliedInFilter\|lastFilterCriteriaKey\|initTimeout\|parseUrlParams" src/routes/+page.svelte
npm run check 2>&1 | tail -8
npm run build 2>&1 | tail -3
```

Saída esperada: `0` no `grep`; `npm run check` sem erros novos em `+page.svelte`; build concluindo. Se `npm run check` acusar `filtersInitialized` ou `uniqueNormalizedClassifications` usados antes da declaração, mova as declarações para cima do `initializeFiltersIfNeeded` — em Svelte 4 a ordem dos `$:` é topológica, mas a de `let` e `function` não é.

- [ ] **Step 11: Ajustar as expectativas do contrato**

```bash
grep -rn "F7\|F8\|F12\|P11\|D7\|D3" src/lib/utils/*.contrato.test.js src/lib/**/*.contrato.test.js 2>/dev/null
```

| Caso | Era | Passa a ser | Decisão |
|---|---|---|---|
| F7 | `materiais=` vazio existia só na leitura | também é **produzido** pela escrita ao desmarcar tudo | D-8 |
| F8 | `arranjo=` vazio era efeito colateral do bloqueio do auto-select-all | é o valor gravado ao desmarcar tudo; ausente passa a significar "padrão" | D-8, estendido |
| F12 | `?comoAbrir=lixo` fica na URL para sempre | é apagado na primeira escrita | D-9 |
| P9 | `?ordenar=aleatorio` fica na URL | é apagado na primeira escrita | D-9 |
| P11 | home mantém `?itensPorPagina=7`, biblioteca limpa | as duas limpam | D-9/P10 |
| P1 | página 3 em aba quente, 1 em aba fria | página 3 sempre | D-3 |
| D3 | `?pesquisa=arranjo=x` dava zero resultados | trata como busca comum | §4.1 |
| D7 | a URL vira `?arranjo=<5 valores>` sozinha | a URL fica como veio | D-2 |
| R4 | escrita de busca podia poluir a URL do leitor | a escrita é descartada no flush | §4.8 |

Casos que devem continuar verdes **sem alteração**: F1-F6, F9-F11, F13-F18, P2-P4, P16, D1, D4-D6, D8, D9, R1-R3, R5, R6, e todos os C1-C14 da Tarefa 10.

```bash
npm test 2>&1 | tail -4
```

Saída esperada: `ℹ fail 0`.

- [ ] **Step 12: Verificação em navegador**

Nada aqui se prova em teste unitário: bloco reativo só existe em navegador.

```bash
npm run dev
```

Abra o DevTools na aba Console **e** na aba Network, e cole uma URL por vez, **sempre em aba nova**:

1. `http://localhost:5173/` — esperado: a barra de endereços continua `http://localhost:5173/` depois de 5 segundos, e os filtros de arranjo aparecem todos marcados. **Falha:** a URL virar `?arranjo=Avulsos+Diversos%2C...` sozinha (D-2 não foi aplicado).
2. `http://localhost:5173/?arranjo=PES,PES%20CIAs&pesquisa=amor` — esperado: só dois arranjos marcados, campo de busca com `amor`, resultados filtrados. **Falha:** os cinco arranjos marcados, ou zero resultados.
3. **Aba fria**, o caso central. No DevTools ative Network → *Disable cache* e *Slow 3G*, então abra `http://localhost:5173/?pesquisa=louvor&pagina=3` (troque `louvor` por um termo que dê mais de 3 páginas com 10 itens). Esperado: quando a lista aparece, o controle mostra **Página 3**, e a URL continua com `pagina=3`. Repita **cinco vezes**, sempre em aba nova. **Falha:** qualquer abertura em que caia na página 1, ou o `pagina=3` sumir da URL.
4. Ainda com Slow 3G, `http://localhost:5173/?pesquisa=louvor&pagina=999` — esperado: cai na última página existente e a URL é reescrita com esse número. **Falha:** página em branco, ou `pagina=999` persistindo.
5. Digite no campo de busca e, em **menos de 500 ms**, clique num louvor. Esperado: o leitor abre, e a URL é `/leitor?file=...&titulo=...` **sem** `pesquisa`. **Falha:** aparecer `&pesquisa=` na URL do leitor, ou a navegação ser cancelada e voltar para a home. Repita cinco vezes.
6. Digite `100%` no campo de busca, espere um segundo, dê F5. Esperado: o campo volta com `100%`. **Falha:** virar `100` ou vazio.
7. `http://localhost:5173/?itensPorPagina=7&comoAbrir=lixo&utm_source=whatsapp` — esperado: a URL vira `?utm_source=whatsapp`, o seletor de modo mostra "leitor", a paginação mostra 10 itens. **Falha:** o `utm_source` sumir, ou os params inválidos ficarem.
8. Pesquise, pagine até a página 3, mude um filtro de material. Esperado: volta para a página 1 e o `pagina` some da URL. **Falha:** continuar na página 3 numa lista curta, ou a lista aparecer vazia.
9. Pesquise, pagine, filtre, e aperte o **botão voltar**. Esperado: sai do app / volta para a página anterior real, exatamente como hoje (D-1, `replaceState` mantido). **Falha:** navegar por entre estados de filtro.
10. Deixe a aba parada por 30 segundos numa URL com filtros e observe o Console e o Network. **Falha:** qualquer `goto` recorrente, ou uso de CPU contínuo — sinal de laço reativo.

- [ ] **Step 13: Verificação completa**

```bash
npm test 2>&1 | tail -4
npm run build 2>&1 | tail -3
grep -rn "isUpdating" src/routes/+page.svelte src/lib/stores/filters.js src/lib/stores/classificationFilters.js src/lib/stores/pdfViewer.js src/lib/utils/urlSync.js
```

Saída esperada: `ℹ fail 0`, build concluindo, e **nenhuma** ocorrência de `isUpdating` nos cinco arquivos.

- [ ] **Step 14: Commit e merge**

Esta branch só entra na `main` com o contrato da Tarefa 3 **inteiro** verde e com os dez passos do Step 12 conferidos em navegador. Se um único deles falhar, a branch fica de fora — um link de filtro quebrado circula por meses antes de alguém reclamar.

```bash
git add src/lib/utils/urlEstado.js \
        src/lib/utils/urlEstado.test.js \
        src/lib/utils/urlSync.js \
        src/lib/stores/filters.js \
        src/lib/stores/classificationFilters.js \
        src/lib/stores/pdfViewer.js \
        src/routes/+page.svelte
git commit -m "refactor(url): tornar a sincronizacao URL-estado unidirecional e remover as flags da home (#21)"
```

---

### Task 12: A biblioteca sem flags e sem o anel de `arranjoEspecial` (#21 parte 3)

> **Antes de começar, leia as linhas K-2 e K-6 da tabela "Conflitos entre tarefas" no topo deste plano.** Esta tarefa remove `parseUrlParams` e os dois serializadores — funções que o contrato da Tarefa 3 exercita com 45 asserções. **Migre as asserções para o leitor novo antes de remover as funções**, e só faça o commit com o contrato verde. E a Tarefa 17 (paginação da biblioteca) roda **depois** desta, nunca antes.

`src/routes/biblioteca/+page.svelte` carrega doze variáveis de controle (`urlSyncInitialized`, `isUpdatingSortFromUrl`, `isUpdatingItemsPerPageFromUrl`, `isUpdatingPageFromUrl`, `isUpdatingArranjoEspecialFromUrl`, `pageInitializedFromUrl`, `lastKnownUrlState`, `previousAvailableLength`, `specialArrangementsInitialized`, `previousSelectedClassifications`, `previousFilteredCount`, `filtersInitialized`) e um religamento composto que solta três flags 100 ms depois do `onMount` e uma quarta 500 ms depois disso, aninhado (`biblioteca:633-642`). O subsistema de `arranjoEspecial` é o mais frágil do repositório: cinco blocos reativos formam um anel — `:212` escreve a URL, `$page` muda, `:192` escreve o estado, `:250` recalcula a lista filtrada, `:77` recalcula os arranjos disponíveis, e `:212` dispara outra vez. A flag que deveria proteger esse anel, `isUpdatingArranjoEspecialFromUrl`, é ligada e desligada **no mesmo tick síncrono** (`:199-202`, `:217-221`, `:234-237`), portanto não protege coisa alguma contra o `$page`, que é assíncrono; quem de fato segura o anel são `specialArrangementsInitialized` e `previousAvailableLength`. No caminho ainda há `JSON.stringify(a.sort()) !== JSON.stringify(b.sort())` (`:198`), cujo `.sort()` **muta o estado reativo do componente no lugar**, sem disparar reatividade, dentro de um `if`; e `:204`, um `else if` sobre `$page.pathname`, propriedade que não existe (o correto seria `$page.url.pathname`), logo uma condição que nunca pode ser verdadeira.

A conversão é a mesma da Tarefa 11, e no caso do `arranjoEspecial` ela é mais simples do que parece: a seleção deixa de ser estado escrito e passa a ser **derivada** de dois fatos — os arranjos disponíveis e o que a URL diz. O padrão "todos selecionados" vira um valor calculado em vez de um valor gravado, e com isso o anel some inteiro, junto com as cinco flags que existiam para contê-lo. Sucesso é: nenhuma variável `isUpdating*` no arquivo, nenhum `setTimeout` de sincronização, o caso P12 do contrato (sete params simultâneos) funcionando, e o contrato da Tarefa 3 verde.

**Files:**
- Modify: `src/routes/biblioteca/+page.svelte`
- Modify: `src/lib/utils/urlSync.js` (apagar `parseUrlParams`, `serializeArrayParam` e `deserializeArrayParam`, que ficam sem consumidores)
- Modify: `src/lib/stores/bibliotecaSort.js:5,16`
- Modify: `src/lib/stores/bibliotecaItemsPerPage.js:5,17`

**Interfaces:**
- Consumes: `lerEstadoDaUrl(url)` e `updateUrlParams(newParams, options)` da Tarefa 11, com a query acumulada por flush e a guarda de rota.
- Consumes: `classificationFilters.aplicarPadrao(todas: string[]) => void` da Tarefa 11 — popula o store sem escrever na URL.
- Consumes: o contrato executável da Tarefa 3 (casos P5-P15, F11, D9).
- Produces: nada de novo. Esta tarefa só apaga.

- [ ] **Step 1: Branch**

A Tarefa 11 precisa estar na `main` — esta tarefa depende de `lerEstadoDaUrl`, de `aplicarPadrao` e do `updateUrlParams` novo.

```bash
cd "/Volumes/SSD 2TB SD/dev/plpcjf"
git checkout main && git pull
git log --oneline -1
git checkout -b feat/21-biblioteca-sem-flags
npm test 2>&1 | tail -4
```

Saída esperada: o commit da Tarefa 11 no topo e `ℹ fail 0`.

- [ ] **Step 2: Derivar `arranjoEspecial` e desmontar o anel**

Substitui a declaração de `selectedSpecialArrangements` e os três blocos reativos que a escreviam (`:162-247`). Com a derivação, `isUpdatingArranjoEspecialFromUrl`, `previousSelectedClassifications`, `previousAvailableLength` e `specialArrangementsInitialized` deixam de ter função — e o `else if` morto de `:204` vai junto.

```bash
python3 - <<'PYEOF'
import io
caminho = 'src/routes/biblioteca/+page.svelte'
texto = io.open(caminho, encoding='utf-8').read()

texto = texto.replace(
    "  import { parseUrlParams, updateUrlParams } from '$lib/utils/urlSync';",
    "  import { lerEstadoDaUrl, updateUrlParams } from '$lib/utils/urlSync';"
)
texto = texto.replace("  import { onMount, onDestroy } from 'svelte';", "  import { onDestroy, onMount } from 'svelte';")

inicio = texto.index("  // State for selected special arrangements - inicializar da URL")
fim = texto.index("  // Final filtered list (refined by Arranjo Especial if applicable)")
texto = texto[:inicio] + '''  // A URL é a fonte de verdade. Nada aqui é sincronizado nos dois sentidos.
  $: estadoUrl = lerEstadoDaUrl(browser && $page && $page.url ? $page.url : { search: '' });
  $: naBiblioteca = browser && $page?.url?.pathname === '/biblioteca';

  /**
   * Arranjo especial, inteiramente derivado — não é mais estado escrito.
   *
   * Antes eram cinco blocos reativos num anel: um deles gravava a URL, a URL
   * reescrevia a seleção, a seleção recalculava a lista filtrada, a lista
   * recalculava os arranjos disponíveis, e o primeiro bloco disparava de novo.
   * A flag que deveria conter isso era ligada e desligada no mesmo tick
   * síncrono, então nunca protegeu nada contra o `$page`, que é assíncrono.
   *
   * Aqui não há escrita nenhuma: quando a URL traz o param, ele manda (filtrado
   * pelo que existe); quando não traz, o padrão "todos" é **calculado**, e não
   * gravado na barra de endereços (mesma decisão D-2 da home).
   * @type {string[]}
   */
  $: selectedSpecialArrangements =
    availableSpecialArrangements.length === 0
      ? []
      : estadoUrl.temArranjoEspecial
        ? estadoUrl.arranjoEspecial.filter((sa) => availableSpecialArrangements.includes(sa))
        : availableSpecialArrangements;

''' + texto[fim:]

# Handlers: escrevem a URL e só. A seleção volta pela derivação acima.
inicio = texto.index("  // Handlers for Special Arrangement Filters")
fim = texto.index("</script>")
texto = texto[:inicio] + '''  // Handlers do filtro de arranjo especial: a única coisa que fazem é gravar a
  // URL. A seleção exibida volta pela derivação, no mesmo ciclo.
  /**
   * @param {CustomEvent<{ item: string }>} event
   */
  function handleSpecialArrangementToggle(event) {
    const item = event.detail.item;
    const novo = selectedSpecialArrangements.includes(item)
      ? selectedSpecialArrangements.filter((sa) => sa !== item)
      : [...selectedSpecialArrangements, item];
    updateUrlParams({ arranjoEspecial: novo });
  }

  /**
   * @param {CustomEvent<{ item: string }>} event
   */
  function handleSpecialArrangementSelectOnly(event) {
    updateUrlParams({ arranjoEspecial: [event.detail.item] });
  }

  /**
   * @param {CustomEvent<{ items: string[] }>} event
   */
  function handleSpecialArrangementSelectAll(event) {
    updateUrlParams({ arranjoEspecial: [...event.detail.items] });
  }

  function handleSpecialArrangementDeselectAll() {
    // Vazio é gravado como `arranjoEspecial=` para sobreviver a um F5.
    updateUrlParams({ arranjoEspecial: [] });
  }
''' + texto[fim:]

io.open(caminho, 'w', encoding='utf-8').write(texto)
PYEOF
grep -c "isUpdatingArranjoEspecialFromUrl\|specialArrangementsInitialized\|previousAvailableLength\|previousSelectedClassifications\|\$page.pathname" src/routes/biblioteca/+page.svelte
```

Saída esperada: `0` — as cinco somem de uma vez, inclusive o `$page.pathname` que nunca podia ser verdadeiro.

- [ ] **Step 3: Derivar paginação, ordenação e itens por página**

Substitui os blocos `:280-300` (declarações e `lastKnownUrlState`), `:322-336` (`setPage`), `:338-354`, `:356-389` (os dois blocos de reset de página) e `:391-479` (o triângulo URL↔stores). A regra é a mesma da home: derivar, e escrever só em evento de usuário ou como normalização idempotente.

```bash
python3 - <<'PYEOF'
import io
caminho = 'src/routes/biblioteca/+page.svelte'
texto = io.open(caminho, encoding='utf-8').read()

inicio = texto.index("  // Pagination\n  let currentPage = 1;")
fim = texto.index("  /**\n     * @param {number} page\n     */\n  function goToPage(page) {")
texto = texto[:inicio] + '''  // Paginação
  let pageInput = '1';
  let itemsPerPageMenuOpen = false;
  /** @type {HTMLElement | null} */
  let louvoresContainer = null;
  /** Critério de filtro da última execução; mudar de verdade zera a paginação. */
  /** @type {string | null} */
  let criterioAnterior = null;

  function scrollToLouvores() {
    if (!browser) return;

    const target = louvoresContainer || document.getElementById('louvores');
    if (!target) return;

    const mediaQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    const prefersReducedMotion = mediaQuery?.matches;
    target.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start'
    });
  }

  $: itemsPerPage = $bibliotecaItemsPerPage;
  $: groupedLouvores = groupLouvoresByGroupId(sortedLouvores);
  $: totalPages =
    groupedLouvores.length === 0 ? 1 : Math.max(1, Math.ceil(groupedLouvores.length / itemsPerPage));

  /** Página efetiva: a que está na URL, limitada ao que existe de verdade. */
  $: currentPage = Math.min(Math.max(1, estadoUrl.pagina), totalPages);
  $: paginatedLouvores = groupedLouvores.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  /** Espelha a página efetiva no input, sem atropelar quem está digitando nele. */
  let ultimaPaginaPublicada = null;
  $: if (currentPage !== ultimaPaginaPublicada) {
    ultimaPaginaPublicada = currentPage;
    pageInput = String(currentPage);
  }

  /**
   * Única porta de escrita da paginação.
   * @param {number} numeroPagina
   * @param {{ scroll?: boolean }} [options]
   */
  function setPage(numeroPagina, { scroll = true } = {}) {
    const alvo = Math.max(1, Math.min(totalPages, numeroPagina));
    updateUrlParams({ pagina: alvo });
    if (scroll) {
      scrollToLouvores();
    }
  }

  /** Só depois disso faz sentido corrigir a paginação (preserva `?pagina=N`). */
  $: resultadosProntos = $louvoresLoaded && $louvores.length > 0 && $classificationFilters.length > 0;

  // Corrige a URL quando a página pedida não existe mais. Idempotente: depois
  // da escrita a condição é falsa, então não há laço e não há flag.
  $: if (browser && naBiblioteca && resultadosProntos && estadoUrl.pagina !== currentPage) {
    updateUrlParams({ pagina: currentPage });
  }

  // Chave de identidade do filtro. Separadores fora do alfabeto dos valores.
  // `[...]` antes de `.sort()`: o código antigo ordenava o array no lugar.
  $: criterioAtual = [
    [...$filters].sort().join('\\u0001'),
    [...$classificationFilters].sort().join('\\u0001'),
    [...selectedSpecialArrangements].sort().join('\\u0001')
  ].join('\\u0000');

  // Trocar de filtro volta para a página 1. A **primeira** chave é só
  // registrada: é o que preserva `/biblioteca?pagina=5` de um deep link.
  $: if (browser && naBiblioteca && resultadosProntos) {
    if (criterioAnterior === null) {
      criterioAnterior = criterioAtual;
    } else if (criterioAtual !== criterioAnterior) {
      criterioAnterior = criterioAtual;
      if (estadoUrl.pagina !== 1) {
        updateUrlParams({ pagina: 1 });
      }
    }
  }

  // ordenar: o param manda quando existe; senão a preferência do store é
  // publicada na URL. Idempotente nas duas pontas.
  $: if (browser && naBiblioteca && $page?.url) {
    if ($page.url.searchParams.has('ordenar')) {
      if (estadoUrl.ordenar !== $bibliotecaSort) {
        bibliotecaSort.set(estadoUrl.ordenar);
      }
    } else if ($bibliotecaSort !== 'numero') {
      updateUrlParams({ ordenar: $bibliotecaSort });
    }
  }

  // itensPorPagina: mesma regra. O store é compartilhado com a home de propósito
  // (D-10) — é preferência do usuário, não estado de rota.
  $: if (browser && naBiblioteca && $page?.url) {
    if ($page.url.searchParams.has('itensPorPagina')) {
      if (estadoUrl.itensPorPagina !== $bibliotecaItemsPerPage) {
        bibliotecaItemsPerPage.set(estadoUrl.itensPorPagina);
      }
    } else if ($bibliotecaItemsPerPage !== 10) {
      updateUrlParams({ itensPorPagina: $bibliotecaItemsPerPage });
    }
  }

  // D-9: param conhecido com valor inválido é normalizado uma vez.
  $: if (browser && naBiblioteca && estadoUrl.paramsInvalidos.length > 0) {
    updateUrlParams({});
  }

''' + texto[fim:]
io.open(caminho, 'w', encoding='utf-8').write(texto)
PYEOF
grep -c "isUpdatingSortFromUrl\|isUpdatingItemsPerPageFromUrl\|isUpdatingPageFromUrl\|lastKnownUrlState\|previousFilteredCount\|pageInitializedFromUrl" src/routes/biblioteca/+page.svelte
```

Saída esperada: um número ainda maior que zero — sobram as ocorrências no `onMount`, que o Step 4 apaga.

- [ ] **Step 4: Apagar o `onMount` de sincronização e o `initFilters` duplicado**

O bloco `:589-697` inicializa a URL para dentro de estado local, solta três flags 100 ms depois e uma quarta 500 ms depois disso, e ainda carrega uma segunda cópia da inicialização de filtros. No desenho derivado nada disso tem função: o estado já vem da URL desde o primeiro render.

```bash
python3 - <<'PYEOF'
import io
caminho = 'src/routes/biblioteca/+page.svelte'
texto = io.open(caminho, encoding='utf-8').read()

inicio = texto.index("  let filtersInitialized = false;")
fim = texto.index("  /**\n   * @param {{ groupId?: string, materials?: { pdfId?: string }[] }} group\n   */")
texto = texto[:inicio] + '''  let filtersInitialized = false;

  function initializeFiltersIfNeeded() {
    if (filtersInitialized || !browser || !$louvoresLoaded || !$louvores.length) return;

    const classifications = uniqueNormalizedClassifications;
    if (classifications.length === 0) return;

    filtersInitialized = true;
    // D-2: o padrão "todos os arranjos" é calculado, não gravado na URL. Links
    // no formato `?arranjo=<5 valores>` continuam sendo lidos normalmente.
    if (!estadoUrl.temArranjo && $classificationFilters.length === 0) {
      classificationFilters.aplicarPadrao(classifications);
    }
  }

  onMount(async () => {
    await loadLouvores();
    if (browser) {
      document.addEventListener('click', handleClickOutside);
    }
  });

  // O retorno de um `onMount` async é uma Promise e o Svelte o ignora: o
  // cleanup antigo nunca rodava. Fica só este.
  onDestroy(() => {
    if (browser) {
      document.removeEventListener('click', handleClickOutside);
    }
  });

  // Backup reativo: assim que o catálogo existe, o padrão dos filtros é aplicado.
  $: if (browser && $louvoresLoaded && $louvores.length > 0 && !filtersInitialized) {
    initializeFiltersIfNeeded();
  }

''' + texto[fim:]
io.open(caminho, 'w', encoding='utf-8').write(texto)
PYEOF
grep -n "setTimeout\|isUpdating\|urlSyncInitialized\|initTimeout" src/routes/biblioteca/+page.svelte
npm run check 2>&1 | tail -10
```

Saída esperada: **nenhuma** linha no `grep`; `npm run check` sem erros novos. Se acusar `uniqueNormalizedClassifications` ou `availableSpecialArrangements` usados antes de declarados, mova os `let`/`function` — a ordem topológica do Svelte vale para `$:`, não para declarações.

- [ ] **Step 5: Apagar `parseUrlParams` e os dois serializadores**

Depois do Step 4 ninguém mais usa `parseUrlParams`, `serializeArrayParam` nem `deserializeArrayParam` — exceto os dois stores de biblioteca, convertidos aqui. É o último resto da API antiga.

```bash
python3 - <<'PYEOF'
import io

caminho = 'src/lib/utils/urlSync.js'
texto = io.open(caminho, encoding='utf-8').read()
corte = texto.index('// --- Compatibilidade')
io.open(caminho, 'w', encoding='utf-8').write(texto[:corte].rstrip() + '\n')

for caminho, campo in [
    ('src/lib/stores/bibliotecaSort.js', 'ordenar'),
    ('src/lib/stores/bibliotecaItemsPerPage.js', 'itensPorPagina')
]:
    texto = io.open(caminho, encoding='utf-8').read()
    texto = texto.replace(
        "import { parseUrlParams } from '$lib/utils/urlSync';",
        "import { lerEstadoDaUrl } from '$lib/utils/urlSync';"
    )
    texto = texto.replace(
        "const urlParams = parseUrlParams(currentPage.url);",
        "const urlParams = lerEstadoDaUrl(currentPage.url);"
    )
    io.open(caminho, 'w', encoding='utf-8').write(texto)
PYEOF
grep -rn "parseUrlParams\|serializeArrayParam\|deserializeArrayParam" src || echo "sem consumidores"
npm test 2>&1 | tail -4
npm run build 2>&1 | tail -3
```

Saída esperada: `sem consumidores`, `ℹ fail 0`, build concluindo. `lerEstadoDaUrl` já normaliza ausente para `'numero'` e `10`, então os dois stores mantêm exatamente o mesmo default de hoje.

- [ ] **Step 6: Ajustar as expectativas do contrato**

```bash
grep -rn "P9\|P13\|P14\|D7" src/lib/utils/*.contrato.test.js src/lib/**/*.contrato.test.js 2>/dev/null
```

| Caso | Era | Passa a ser | Decisão |
|---|---|---|---|
| P9 | `?ordenar=aleatorio` fica pendurado na URL | apagado na primeira escrita | D-9 (já introduzido na Tarefa 11) |
| D7, na `/biblioteca` | a URL ganhava `arranjoEspecial=<todos>` sozinha ~200 ms depois de abrir | a URL fica como veio; o padrão "todos" é calculado | D-2, estendido ao especial |
| — | ao sumirem os arranjos especiais, o app apagava `arranjoEspecial` da URL | o param fica; quando os arranjos voltam, ele volta a valer | consequência da derivação |

Casos que devem continuar verdes **sem alteração**: P5, P6, P7, P8, P10, **P12**, P13, P14, P15, P16, F11, D1, D6, D9, e todo o resto do contrato.

Sobre P13/P14, verifique que a expectativa não mudou: `?arranjoEspecial=GLTM` seleciona só GLTM, e `?arranjoEspecial=Inexistente` filtra para lista vazia — que, no filtro final (`biblioteca:250-269`), significa "não refina por especial" e mostra todos os louvores da classificação, exatamente como hoje.

```bash
npm test 2>&1 | tail -4
```

Saída esperada: `ℹ fail 0`.

- [ ] **Step 7: Verificação em navegador**

```bash
npm run dev
```

Uma URL por vez, **sempre em aba nova**, com o Console e o Network abertos:

1. `http://localhost:5173/biblioteca?ordenar=nome&itensPorPagina=50&pagina=4&arranjo=PES&arranjoEspecial=GLTM&materiais=Cifra&comoAbrir=newtab` — o caso P12, sete params ao mesmo tempo, o mais denso do app. Esperado: ordenação alfabética, 50 itens por página, **página 4**, só o arranjo PES marcado, só o especial GLTM marcado, só o material Cifra marcado, seletor de abertura em "nova aba", e a URL **inalterada** depois de 5 segundos. **Falha:** qualquer um dos sete perdido, ou a URL se reescrevendo sozinha.
2. `http://localhost:5173/biblioteca` — esperado: a URL continua sem query depois de 5 segundos, com todos os arranjos e todos os especiais marcados. **Falha:** aparecer `?arranjo=...` ou `?arranjoEspecial=...` sozinho.
3. `http://localhost:5173/biblioteca?arranjoEspecial=Padr%C3%A3o` — esperado: só o chip `Padrão` marcado. **Falha:** todos marcados, ou nenhum.
4. `http://localhost:5173/biblioteca?arranjoEspecial=Inexistente` — esperado: nenhum chip especial marcado, e a lista mostra os louvores normalmente. **Falha:** lista vazia, ou o param sendo apagado da URL.
5. Com `?arranjo=PES` na URL, **desmarque todos os arranjos** pela UI e dê F5. Esperado: continua com nada marcado (a URL guarda `arranjo=`). **Falha:** voltar marcado tudo.
6. `http://localhost:5173/biblioteca?pagina=5` — esperado: página 5 já no primeiro render da lista, tanto com cache quente quanto com Network em Slow 3G. Repita cinco vezes em Slow 3G. **Falha:** qualquer abertura caindo na página 1.
7. Na página 4, mude o filtro de material. Esperado: volta para a página 1 e o `pagina` some da URL. **Falha:** ficar numa página vazia.
8. `http://localhost:5173/biblioteca?ordenar=aleatorio&itensPorPagina=7&utm_source=x` — esperado: a URL vira `?utm_source=x`, ordenação numérica, 10 por página. **Falha:** o `utm_source` sumir.
9. Vá de `/biblioteca?itensPorPagina=25` para `/` pelo menu. Esperado: a home continua com 25 por página e grava `?itensPorPagina=25` na própria URL — o comportamento de hoje, preservado (P16/D-10). **Falha:** voltar para 10.
10. Fique 30 segundos parado em `/biblioteca` com sete params e observe o Network. **Falha:** qualquer navegação recorrente — é o anel do `arranjoEspecial` de volta.

- [ ] **Step 8: Verificação completa**

```bash
npm test 2>&1 | tail -4
npm run build 2>&1 | tail -3
grep -rn "isUpdating\|lastKnownUrlState\|setTimeout" src/routes/biblioteca/+page.svelte src/routes/+page.svelte src/lib/utils/urlSync.js
```

Saída esperada: `ℹ fail 0`, build concluindo, e no `grep` apenas as duas linhas de `setTimeout` da home (os debounces de 300 ms e 500 ms). Zero em `biblioteca/+page.svelte` e em `urlSync.js`.

- [ ] **Step 9: Commit e merge**

Esta branch só entra na `main` com o contrato da Tarefa 3 inteiro verde e com os dez passos do Step 7 conferidos em navegador — em especial o passo 1, o P12. Se um deles falhar, a branch fica de fora.

```bash
git add src/routes/biblioteca/+page.svelte \
        src/lib/utils/urlSync.js \
        src/lib/stores/bibliotecaSort.js \
        src/lib/stores/bibliotecaItemsPerPage.js
git commit -m "refactor(biblioteca): derivar arranjo especial e paginacao da URL, removendo as doze flags (#21)"
```

---

---

## Fase 4 — Interface

Tarefas independentes entre si e independentes das Fases 1 e 2. Podem ser executadas em qualquer ordem, ou em paralelo com o resto, desde que não colidam nos mesmos arquivos.

---

### Task 13: Os três estados vazios da home (#27)

Hoje `src/routes/+page.svelte:637-680` só sabe desenhar dois estados: a lista de resultados (`{#if groupedResults.length > 0}`) ou, quando há algo digitado na busca e nada bate, a frase "Nenhum resultado encontrado." (`{:else if searchQuery}`). Todo o resto — a home recém-montada antes de o usuário digitar qualquer coisa, ou o usuário tendo desmarcado "Todos" em Material (`src/lib/components/CategoryFilters.svelte`, store `filters`) ou em Arranjo (`src/lib/components/ClassificationFilters.svelte`, store `classificationFilters`) — cai no `{/if}` sem renderizar nada. A área de resultados fica um retângulo em branco, sem nenhuma pista do que aconteceu nem de como sair de lá. Quem usa o app em ensaio, apertado, lê isso como "quebrou", não como "esqueci de digitar" ou "desmarquei o Arranjo sem querer".

`filterLouvores()` (`src/routes/+page.svelte:373-458`) já decide, internamente, por que o resultado é vazio: `activeCategories.length === 0` zera tudo antes mesmo de olhar para a busca (linha 400-401); `selectedFilters.length === 0` (classificação) faz o mesmo (linha 419-420); só depois disso é que `!searchQuery.trim()` zera por falta de busca (linha 441-442). O template não usa nenhuma dessas informações — só olha `groupedResults.length` e `searchQuery`. Sucesso aqui é a área de resultados nunca ficar em branco: sempre um texto que diz o que está acontecendo e um botão que resolve.

**Files:**
- Modify: `src/routes/+page.svelte:466` (novo bloco reativo, logo após o `$: paginatedResults = ...` existente)
- Modify: `src/routes/+page.svelte:637-680` (template da área de resultados)
- Modify: `src/routes/+page.svelte:714-716` (`<style>`, ao lado de `.no-results-message`)

**Interfaces:**
- Consumes: `groupedResults` (reativo, já existe), `$louvoresLoaded` (`$lib/stores/louvores`, já importado), `$filters` (`$lib/stores/filters`, já importado como `filters`), `$classificationFilters` (`$lib/stores/classificationFilters`, já importado), `filtersInitialized` (variável local já existente, linha 147), `uniqueNormalizedClassifications` (reativo já existente, linha 319), `searchQuery` (variável local já existente), `handleClear` (função já existente, linha 351), `LOUVOR_SEARCH_INPUT_ID` (constante já existente, linha 26).
- Produces: variável reativa `homeEmptyState: 'materiais-vazios' | 'arranjos-vazios' | 'sem-resultado' | 'inicial' | null` e classes CSS `.empty-state-message` / `.empty-state-action`. A Task 14 (skeleton de carregamento) lê `homeEmptyState` implicitamente ao decidir onde encaixar o branch de carregamento — quando `homeEmptyState` é `null` e `groupedResults.length === 0`, é porque `$louvoresLoaded` ainda é `false` (nenhum dos quatro estados nomeados se aplica antes de os dados chegarem).

**Nota de execução:** esta tarefa e a Task 14 tocam o mesmo bloco `{#if groupedResults.length > 0}` em `src/routes/+page.svelte:638`. Não rode as duas em paralelo — a ordem entre elas não importa, mas uma precisa terminar (e commitar) antes de a outra abrir o arquivo, ou uma delas vai editar por cima de um `old_string` que já mudou.

- [ ] **Step 1: Adicionar a variável reativa `homeEmptyState`**

Depois do bloco `$: paginatedResults = groupedResults.slice(...)` (`src/routes/+page.svelte:463-466`), adicionar:

```js
  /**
   * Por que `groupedResults` está vazio, para a Task 13 (#27). `null` quando
   * há resultados a mostrar, ou quando os louvores ainda não carregaram (aí
   * quem decide o que aparece é o skeleton da Task 14). A ordem dos `if`
   * é a prioridade: um filtro zerado explica o vazio antes de "nada
   * encontrado" e antes do estado inicial.
   * @type {'materiais-vazios' | 'arranjos-vazios' | 'sem-resultado' | 'inicial' | null}
   */
  $: homeEmptyState =
    !$louvoresLoaded || groupedResults.length > 0
      ? null
      : $filters.length === 0
        ? 'materiais-vazios'
        : filtersInitialized && $classificationFilters.length === 0
          ? 'arranjos-vazios'
          : searchQuery.trim()
            ? 'sem-resultado'
            : 'inicial';
```

O guarda `filtersInitialized &&` em `arranjos-vazios` existe porque `classificationFilters` começa vazio (`[]`) até `initializeFiltersIfNeeded()` rodar (`src/routes/+page.svelte:151-174`) — sem ele, a mensagem "você desmarcou os arranjos" apareceria por uma fração de segundo em toda montagem da página, antes de o `selectAll` automático preencher o filtro.

- [ ] **Step 2: Substituir o `{#if groupedResults.length > 0}...{:else if searchQuery}...{/if}` pelos quatro estados**

Trocar o bloco de `src/routes/+page.svelte:638` a `678` (mantendo a lista de resultados como está — só a cauda `{:else if searchQuery}...{/if}` muda):

```svelte
    {#if groupedResults.length > 0}
      <div class="louvores-container w-full max-w-4xl">
        <span class="container-tag">Louvores</span>

        <LouvorPaginationControls
          variant="top"
          bind:pageInput
          currentPage={currentPage}
          totalPages={totalPagesHome}
          itemsPerPage={itemsPerPageHome}
          on:itemsPerPage={handleHomeItemsPerPage}
          on:gotoPage={handleHomePaginationPage}
          on:previous={() => currentPage > 1 && setPage(currentPage - 1)}
          on:next={() => currentPage < totalPagesHome && setPage(currentPage + 1)}
          on:first={() => setPage(1)}
          on:last={() => setPage(totalPagesHome)}
        />

        <div class="louvores-list">
          {#each paginatedResults as group (getGroupKey(group))}
            <LouvorCard louvor={group.materials[0]} materials={group.materials} />
          {/each}
        </div>

        <LouvorPaginationControls
          variant="bottom"
          bind:pageInput
          currentPage={currentPage}
          totalPages={totalPagesHome}
          itemsPerPage={itemsPerPageHome}
          on:itemsPerPage={handleHomeItemsPerPage}
          on:gotoPage={handleHomePaginationPage}
          on:previous={() => currentPage > 1 && setPage(currentPage - 1)}
          on:next={() => currentPage < totalPagesHome && setPage(currentPage + 1)}
          on:first={() => setPage(1)}
          on:last={() => setPage(totalPagesHome)}
        />
      </div>
    {:else if homeEmptyState === 'materiais-vazios'}
      <div class="empty-state-message">
        <p>Você desmarcou todos os materiais (Partitura, Cifra, Gestos em Gravura).</p>
        <button type="button" class="empty-state-action" on:click={() => filters.selectAll()}>
          Selecionar todos os materiais
        </button>
      </div>
    {:else if homeEmptyState === 'arranjos-vazios'}
      <div class="empty-state-message">
        <p>Você desmarcou todos os arranjos.</p>
        <button
          type="button"
          class="empty-state-action"
          on:click={() => classificationFilters.selectAll(uniqueNormalizedClassifications)}
        >
          Selecionar todos os arranjos
        </button>
      </div>
    {:else if homeEmptyState === 'sem-resultado'}
      <div class="empty-state-message">
        <p>Nenhum resultado encontrado para "{searchQuery}".</p>
        <button type="button" class="empty-state-action" on:click={handleClear}>
          Limpar busca
        </button>
      </div>
    {:else if homeEmptyState === 'inicial'}
      <div class="empty-state-message">
        <p>Digite algo na busca para encontrar um louvor.</p>
        <button
          type="button"
          class="empty-state-action"
          on:click={() => document.getElementById(LOUVOR_SEARCH_INPUT_ID)?.focus()}
        >
          Ir para a busca
        </button>
      </div>
    {/if}
```

`filters.selectAll()` e `classificationFilters.selectAll(...)` são os mesmos métodos que o botão "Todos" de cada filtro já chama (`src/lib/components/CategoryFilters.svelte:32-38`, `src/lib/components/ClassificationFilters.svelte:32-38`) — nenhum store novo, nenhuma lógica nova, só o mesmo caminho acessível de outro lugar da tela.

- [ ] **Step 3: Estilo dos novos estados**

Em `src/routes/+page.svelte`, logo depois de `.no-results-message` (linha 714-716), adicionar:

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

Cores e bordas iguais às do botão `.items-per-page-button` de `LouvorPaginationControls.svelte:216-227` — mesmo par card-color/gold-color já usado em todo botão secundário do app. O anel de foco por teclado vem de graça do seletor global `:focus-visible` em `src/app.css:57-63`; não precisa repetir aqui.

- [ ] **Step 4: Verificação — `npm run build`**

```bash
npm run build
```

Esperado: build conclui sem erro novo introduzido por este arquivo (o projeto já tem 1278 erros pré-existentes do `svelte-check`, achado #20 do inventário — não é este passo que os resolve, só não pode adicionar um novo erro de sintaxe).

- [ ] **Step 5: Verificação manual dos quatro estados**

Rodar `npm run dev`, abrir a home no navegador:
1. Recarregar a página e olhar a área de resultados **antes** de digitar nada: deve aparecer "Digite algo na busca para encontrar um louvor." com o botão "Ir para a busca" (clicar nele deve focar o campo de busca).
2. Digitar algo que não existe (ex.: `zzzzz999`): deve trocar para "Nenhum resultado encontrado para "zzzzz999"." com o botão "Limpar busca" (clicar limpa o campo e volta ao estado 1).
3. Abrir o painel de filtros ("Toque para ver mais"), clicar em "Todos" de Material para desmarcar tudo: deve aparecer "Você desmarcou todos os materiais..." com o botão "Selecionar todos os materiais" (clicar restaura a lista).
4. Com materiais de volta, clicar em "Todos" de Arranjo para desmarcar tudo: deve aparecer "Você desmarcou todos os arranjos." com o botão "Selecionar todos os arranjos".

Falha: qualquer um dos quatro passos deixar a área de resultados em branco, ou o botão de ação não resolver o estado.

- [ ] **Step 6: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat(home): distinguir os quatro estados vazios da busca (#27)"
```

### Task 14: Estado de carregamento na home e na biblioteca (#28)

`src/lib/stores/louvores.js:36` começa com `let louvoresLoaded = writable(false);` e só vira `true` depois que `loadLouvores()` (chamada em `onMount` de `src/routes/+page.svelte:193` e `src/routes/biblioteca/+page.svelte:588`) termina de buscar e processar o manifesto — hoje **1,45 MB** de JSON (confirmar com `du -h static/louvores-manifest.json` ou o manifesto real servido; o número vem do achado #28 do inventário). Nesse intervalo, `groupedResults`/`groupedLouvores` estão vazios e `searchQuery` também, então a área de resultados renderiza em branco nas duas páginas — sem spinner, sem esqueleto, sem texto. Em conexão lenta (o cenário exato em que um músico abre o app às pressas antes do culto) isso lê como tela quebrada.

Existe um padrão de skeleton **já desenhado** no CSS de `src/routes/offline/+page.svelte:2589-2603` (`.skeleton { background: linear-gradient(90deg, var(--placeholder-color) 25%, rgba(255,255,255,0.1) 50%, var(--placeholder-color) 75%); background-size: 200% 100%; animation: loading 1.5s infinite; } @keyframes loading {...}`) — só que **nenhuma dessas classes é usada em lugar nenhum do template daquela página** (`grep -n "skeleton" src/routes/offline/+page.svelte` só bate no bloco `<style>`, nunca no HTML acima dele). É CSS morto: alguém desenhou o padrão visual e nunca o ligou a nada. Isto contradiz a premissa de que "o padrão de skeleton já existe" no sentido de "já está em uso" — existe só como intenção visual gravada em CSS. Esta tarefa é a primeira a efetivamente usá-lo, reaproveitando a técnica (gradiente + `--placeholder-color` + a mesma animação de 1,5s) em vez de inventar um segundo idioma de carregamento (um spinner, por exemplo).

Sucesso: entre o primeiro paint da home/biblioteca e `$louvoresLoaded` virar `true`, a área de resultados mostra linhas fantasma do tamanho de um `LouvorCard`, na mesma quantidade que a paginação atual mostraria — nunca fica em branco.

**Files:**
- Create: `src/lib/components/LouvorListSkeleton.svelte`
- Modify: `src/routes/+page.svelte:637-638` (abrir um branch de carregamento antes do `{#if groupedResults.length > 0}`)
- Modify: `src/routes/biblioteca/+page.svelte:793-794` (mesmo tipo de branch)

**Interfaces:**
- Consumes: `$louvoresLoaded` (`$lib/stores/louvores`, já importado nas duas páginas), `$bibliotecaItemsPerPage` (via `itemsPerPageHome` na home, `itemsPerPage` na biblioteca — ambas já reativas), `--placeholder-color` (`src/app.css:12`).
- Produces: componente `LouvorListSkeleton.svelte`, prop `count: number` (quantidade de linhas fantasma a desenhar).

**Nota de execução:** esta tarefa e a Task 13 tocam o mesmo `{#if groupedResults.length > 0}` de `src/routes/+page.svelte:638`. Não rode as duas em paralelo neste arquivo — a ordem entre elas não importa (esta tarefa só precisa abrir **mais um** branch antes do que já estiver lá), mas rode uma de cada vez.

- [ ] **Step 1: Criar o componente `LouvorListSkeleton.svelte`**

```svelte
<script>
  /** Quantas linhas fantasma desenhar — acompanha o `itensPorPagina` atual da página que chama. */
  export let count = 10;
</script>

<div class="louvor-skeleton-list" aria-hidden="true">
  {#each Array(count) as _, i (i)}
    <div class="louvor-skeleton-card"></div>
  {/each}
</div>

<style>
  /* Mesmo padrão de shimmer definido (e nunca usado) em
     src/routes/offline/+page.svelte:2589-2603 — reaproveitado aqui em vez
     de inventar uma segunda linguagem visual de carregamento. */
  .louvor-skeleton-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 1.5rem;
    margin-bottom: 1.5rem;
    width: 100%;
  }

  .louvor-skeleton-card {
    height: 4.5rem;
    border-radius: 0.5rem;
    background: linear-gradient(90deg, var(--placeholder-color) 25%, rgba(255, 255, 255, 0.1) 50%, var(--placeholder-color) 75%);
    background-size: 200% 100%;
    animation: louvor-skeleton-loading 1.5s infinite;
  }

  @keyframes louvor-skeleton-loading {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .louvor-skeleton-card {
      animation: none;
      background: var(--placeholder-color);
    }
  }
</style>
```

`aria-hidden="true"` porque não há nada para um leitor de tela anunciar aqui — a linha fantasma não é conteúdo, é só a promessa visual de que a lista está a caminho.

- [ ] **Step 2: Importar o componente na home**

Em `src/routes/+page.svelte`, junto aos outros imports de componente (perto da linha 21, ao lado de `import LouvorPaginationControls from '$lib/components/LouvorPaginationControls.svelte';`):

```js
  import LouvorListSkeleton from '$lib/components/LouvorListSkeleton.svelte';
```

- [ ] **Step 3: Envolver a área de resultados da home com o branch de carregamento**

Em `src/routes/+page.svelte:637-638`, trocar:

```svelte
  <div id="home-louvores-results" class="mt-8 flex justify-center">
    {#if groupedResults.length > 0}
```

por:

```svelte
  <div id="home-louvores-results" class="mt-8 flex justify-center">
    {#if !$louvoresLoaded}
      <div class="louvores-container w-full max-w-4xl">
        <span class="container-tag">Louvores</span>
        <LouvorListSkeleton count={itemsPerPageHome} />
      </div>
    {:else if groupedResults.length > 0}
```

Se a Task 13 já rodou antes desta, o `{:else if groupedResults.length > 0}` no arquivo real vem seguido de mais `{:else if homeEmptyState === '...'}` — não mexer neles, só inserir o novo branch `{#if !$louvoresLoaded}` na frente de tudo, convertendo o `{#if groupedResults.length > 0}` original em `{:else if groupedResults.length > 0}`.

- [ ] **Step 4: Repetir para a biblioteca**

Em `src/routes/biblioteca/+page.svelte`, adicionar o import junto aos outros (perto da linha 20, ao lado de `import { groupLouvoresByGroupId, compareLouvorNome } from '$lib/utils/groupLouvores.js';`):

```js
  import LouvorListSkeleton from '$lib/components/LouvorListSkeleton.svelte';
```

E em `src/routes/biblioteca/+page.svelte:793-794`, trocar:

```svelte
  <div class="mt-8 flex justify-center">
    {#if paginatedLouvores.length > 0}
```

por:

```svelte
  <div class="mt-8 flex justify-center">
    {#if !$louvoresLoaded}
      <div class="louvores-container w-full max-w-4xl">
        <span class="container-tag">Louvores</span>
        <LouvorListSkeleton count={itemsPerPage} />
      </div>
    {:else if paginatedLouvores.length > 0}
```

- [ ] **Step 5: Verificação — `npm run build`**

```bash
npm run build
```

Esperado: build conclui sem erro novo.

- [ ] **Step 6: Verificação manual em conexão lenta**

No Chrome DevTools, aba Network, trocar o throttling para "Slow 3G". Recarregar a home (`/`) com cache do navegador desabilitado (checkbox "Disable cache" na mesma aba). Observar a área de resultados desde o primeiro paint: deve mostrar de imediato as linhas fantasma animadas (shimmer se movendo da esquerda para a direita), dentro da mesma moldura "Louvores" que a lista real usa, e só trocar para a lista de verdade (ou para um dos quatro estados da Task 13) quando o manifesto terminar de carregar. Repetir em `/biblioteca`. Falha: qualquer intervalo de tela em branco entre o primeiro paint e a lista aparecer.

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/LouvorListSkeleton.svelte src/routes/+page.svelte src/routes/biblioteca/+page.svelte
git commit -m "feat(home,biblioteca): mostrar skeleton enquanto o manifesto carrega (#28)"
```

### Task 15: Controle de brilho no leitor (#30)

O leitor (`src/routes/leitor/+page.svelte`) é usado em dois ambientes opostos: culto com luz baixa, onde a tela de um celular no colo de um músico já é claridade de mais, e ensaio ao ar livre com sol direto, onde a tela padrão fica ilegível. Hoje não existe controle de brilho nenhum — as duas únicas ocorrências de "brightness" no arquivo (`src/routes/leitor/+page.svelte:1600` e `:1637` neste ponto da investigação, hoje possivelmente outras linhas) são `filter: brightness(1.05)`/`brightness(1.1)` de **hover** em CSS, decorativas, não algo que o usuário controla.

**Decisão: filtro CSS sobre o conteúdo do PDF, não Wake Lock.** A Screen Wake Lock API (`navigator.wakeLock`) resolve um problema diferente — impedir que a tela apague sozinha — e não tem nenhuma relação com brilho: nenhuma API web dá a uma página acesso ao brilho físico da tela do aparelho (isso é sistema operacional, fora do sandbox do navegador). A única alavanca real disponível é aplicar `filter: brightness()` sobre o conteúdo renderizado. Isso resolve bem o caso do culto (escurecer para não ofuscar) e ajuda de forma limitada o caso do sol (`brightness() > 100%` estoura os brancos para mais contraste aparente, mas não pode vencer luz solar direta incidindo sobre o vidro — nenhuma técnica em CSS pode). É a ferramenta certa dentro do que a web expõe, com a limitação declarada em vez de prometida.

O filtro é aplicado no `#viewerContainer` (`src/routes/leitor/+page.svelte:2084`), que envolve só as páginas do PDF renderizadas por `pdfjs-dist` (`.viewer.pdfViewer`, linha 2140) — não a toolbar, que precisa continuar legível e com contraste fixo independente do brilho escolhido para a partitura.

O controle entra na toolbar como mais um `.btn` na camada 3 (a camada de zoom em mobile — `showZoomMinus`/`showZoomFit`/`showZoomPlus`, `src/routes/leitor/+page.svelte:1359-1361`), do mesmo jeito que o botão `zoom-fit` já combina clique e toque longo num único elemento (`src/routes/leitor/+page.svelte:1982-1999`, comentário "GestureButton age como o elemento interativo (sem button aninhado)"): clique curto alterna entre três predefinições (100% → 60% → 130% → 100%), toque longo volta direto para 100%. Não é um slider: um slider ocuparia uma faixa de largura que a toolbar não tem sobrando (é por isso que o mobile já precisa de três camadas rotativas para caber todos os controles) e um arraste horizontal dentro da toolbar competiria com os gestos de navegação de página que já vivem logo abaixo, na área do PDF. Um botão do mesmo tamanho dos outros não rouba área de toque de nada que já existe — só ocupa o espaço que a camada 3 já reserva para "mais um botão de exibição".

**Files:**
- Modify: `src/lib/pdf-reader/readerPreferences.js` (adicionar `getBrightness`/`setBrightness` ao lado de `getFitMode`/`setFitMode`)
- Modify: `src/routes/leitor/+page.svelte:13` (import)
- Modify: `src/routes/leitor/+page.svelte:111` (novo estado `readerBrightness`, ao lado de `preferredFitMode`)
- Modify: `src/routes/leitor/+page.svelte:1362` (novo `$: showBrightness`)
- Modify: `src/routes/leitor/+page.svelte:2009` (novo botão na toolbar, entre `showZoomPlus` e `showNavMode`)
- Modify: `src/routes/leitor/+page.svelte:2084` (aplicar o filtro no `#viewerContainer`)
- Modify: `src/routes/leitor/+page.svelte:1666` (`<style>`, ao lado de `.btn.layer-toggle`)

**Interfaces:**
- Consumes: `GestureButton` (`$lib/components/GestureButton.svelte`, já importado no leitor), `--tbtn-h`/`--tbtn-px`/`--tbtn-r` (`src/routes/leitor/+page.svelte:1462-1464`), `deviceType`/`activeToolbarLayer` (já existentes).
- Produces: `getBrightness()`/`setBrightness(value)` em `src/lib/pdf-reader/readerPreferences.js` — mesma assinatura de `getFitMode`/`setFitMode`, disponíveis para qualquer tarefa futura que precise ler ou alterar a preferência de brilho fora do leitor.

- [ ] **Step 1: Adicionar `getBrightness`/`setBrightness` a `readerPreferences.js`**

Em `src/lib/pdf-reader/readerPreferences.js`, adicionar a `BRIGHTNESS` ao objeto `KEYS` e as duas funções, seguindo exatamente o padrão de `getFitMode`/`setFitMode` já existentes no arquivo (sem `try/catch` — é a convenção local deste arquivo, diferente de outros stores do projeto):

```js
const KEYS = {
  FIT_MODE: 'pdfPreferredFitMode',
  NAV_MODE: 'pdfNavigationMode',
  BRIGHTNESS: 'pdfReaderBrightness',
};

/** Predefinições de brilho, em % — 100 é o padrão (sem filtro). */
export const BRIGHTNESS_PRESETS = [100, 60, 130];
export const DEFAULT_BRIGHTNESS = 100;

/**
 * @returns {number}
 */
export function getBrightness() {
  if (typeof window === 'undefined') return DEFAULT_BRIGHTNESS;
  const saved = Number(localStorage.getItem(KEYS.BRIGHTNESS));
  return BRIGHTNESS_PRESETS.includes(saved) ? saved : DEFAULT_BRIGHTNESS;
}

/**
 * @param {number} value
 */
export function setBrightness(value) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEYS.BRIGHTNESS, String(value));
}
```

- [ ] **Step 2: Importar no leitor**

Em `src/routes/leitor/+page.svelte:13`, trocar:

```ts
  import { getFitMode, setFitMode, getNavigationMode, setNavigationMode } from '$lib/pdf-reader/readerPreferences';
```

por:

```ts
  import { getFitMode, setFitMode, getNavigationMode, setNavigationMode, getBrightness, setBrightness, BRIGHTNESS_PRESETS, DEFAULT_BRIGHTNESS } from '$lib/pdf-reader/readerPreferences';
```

- [ ] **Step 3: Estado local e funções de alternância**

Logo depois de `let preferredFitMode: 'page-width' | 'page-fit' = getFitMode();` (`src/routes/leitor/+page.svelte:111`), adicionar:

```ts
  // Brilho da página do PDF (não da toolbar) — persistido via readerPreferences
  let readerBrightness: number = getBrightness();

  function cycleBrightness() {
    const idx = BRIGHTNESS_PRESETS.indexOf(readerBrightness);
    const next = BRIGHTNESS_PRESETS[(idx + 1) % BRIGHTNESS_PRESETS.length];
    readerBrightness = next;
    setBrightness(next);
  }

  function resetBrightness() {
    readerBrightness = DEFAULT_BRIGHTNESS;
    setBrightness(DEFAULT_BRIGHTNESS);
  }
```

- [ ] **Step 4: Visibilidade na camada 3 da toolbar**

Em `src/routes/leitor/+page.svelte:1362`, logo após `$: showLayerToggle = deviceType === 'mobile';`, adicionar:

```ts
  $: showBrightness = deviceType !== 'mobile' || activeToolbarLayer === 3;
```

- [ ] **Step 5: Botão na toolbar**

Em `src/routes/leitor/+page.svelte`, entre o bloco `{#if showZoomPlus}` (fecha na linha 2009) e o bloco `{#if showNavMode}` (abre na linha 2010), inserir:

```svelte
    {#if showBrightness}
      <!-- brightness-toggle: mesma estrutura de zoom-fit — GestureButton preenche o .btn, sem button aninhado -->
      <div class="btn brightness-toggle">
        <GestureButton
          on:click={cycleBrightness}
          on:longpress={resetBrightness}
          longPressDuration={500}
          hapticFeedback={true}
          preventDefault={true}
          ariaLabel="Brilho da página: {readerBrightness}% — toque para alternar entre predefinições, toque longo para voltar ao padrão"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="icon">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
          </svg>
          <span class="brightness-value">{readerBrightness}%</span>
        </GestureButton>
      </div>
    {/if}

```

- [ ] **Step 6: Aplicar o filtro só no conteúdo do PDF**

Em `src/routes/leitor/+page.svelte:2084`, trocar:

```svelte
<div id="viewerContainer" bind:this={containerEl} class="container {containerClass}" class:vertical-nav={navigationMode === 'vertical'} class:hidden={pdfLoading || pdfError}>
```

por:

```svelte
<div id="viewerContainer" bind:this={containerEl} class="container {containerClass}" class:vertical-nav={navigationMode === 'vertical'} class:hidden={pdfLoading || pdfError} style="filter: brightness({readerBrightness}%);">
```

A toolbar (`<div class="toolbar" ...>`, linha 1897) fica **fora** deste elemento — o filtro nunca a atinge, então os próprios controles continuam com contraste fixo mesmo com a página escurecida ao máximo.

- [ ] **Step 7: Estilo do botão**

Em `src/routes/leitor/+page.svelte`, logo após o bloco `.btn.layer-toggle` (linha ~1666-1670), adicionar:

```css
  /* brightness-toggle: mesma estrutura de zoom-fit — GestureButton preenche a área do .btn */
  .btn.brightness-toggle {
    padding: 0;
    cursor: pointer;
    position: relative;
  }
  .btn.brightness-toggle :global(.gesture-button-wrapper) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    height: 100%;
    min-width: var(--tbtn-h);
    padding: 0 var(--tbtn-px);
    position: relative;
    box-sizing: border-box;
  }
  .brightness-value {
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
```

- [ ] **Step 8: Verificação — `npm run build`**

```bash
npm run build
```

Esperado: build conclui sem erro novo.

- [ ] **Step 9: Verificação manual**

Abrir qualquer PDF no leitor (`/leitor?file=...`). No desktop, o botão de brilho aparece direto na toolbar, ao lado dos controles de zoom. No mobile (ou DevTools em modo responsivo, largura < breakpoint de `deviceType`), ele só aparece na camada 3 — usar o botão de camada (`.layer-toggle`) para alternar até vê-lo junto dos botões de zoom. Clicar nele: a página do PDF escurece (60%), a toolbar continua com o mesmo contraste de sempre. Clicar de novo: página clareia (130%). Clicar de novo: volta a 100%. Segurar o botão pressionado (toque longo): volta direto a 100% de qualquer predefinição. Recarregar a página com o brilho em 60%: deve abrir já em 60% (persistido via `localStorage`, chave `pdfReaderBrightness`). Falha: o filtro afetar a toolbar, ou o valor não persistir entre recargas.

- [ ] **Step 10: Commit**

```bash
git add src/lib/pdf-reader/readerPreferences.js src/routes/leitor/+page.svelte
git commit -m "feat(leitor): adicionar controle de brilho da página (#30)"
```

### Task 16: Uma porta para o modo offline (#29)

**A investigação de hoje muda a premissa desta tarefa.** O plano (e o achado #29 original) parte de "o modo offline completo está inalcançável a não ser digitando `/offline` na barra de endereços". Isso não é mais verdade — se é que já foi. `src/routes/+layout.svelte:150-153` define:

```js
function handleOfflineClick() {
  goto('/offline');
}
```

e esse handler está preso a um **botão permanente no cabeçalho principal**, visível em toda página exceto `/leitor` (`src/routes/+layout.svelte:227-236`):

```svelte
<button 
  class="header-button offline-button"
  class:active={isOfflineActive}
  class:inactive={hasActivePage && !isOfflineActive}
  on:click={handleOfflineClick}
  aria-label="Offline"
>
  <CloudOff class="icon" />
  <span>Offline</span>
  <div class="light-beam"></div>
</button>
```

Este botão tem o mesmo tamanho, o mesmo destaque visual e o mesmo comportamento de estado ativo que os botões "Como Usar", "Biblioteca" e "Listas" ao lado dele — não é menor, não está escondido num menu secundário, não depende de nenhum gesto. `src/lib/components/OfflineIndicator.svelte:96-97` soma um **segundo** caminho, condicional (`{#if enabled || downloading || isOfflineReady}`, linha 101): quando o modo offline já está ativo ou baixando, o indicador de status no cabeçalho também navega para `/offline` ao ser clicado. Ou seja: a porta de entrada visível que o achado #29 pedia **já existe**, provavelmente desde antes desta investigação — o relatório original parece ter visto o `goto('/offline')` sem perceber que ele está preso a um botão de primeira classe na navegação principal, não a um link escondido.

O que sobra do achado #29, confirmado pela investigação: `src/lib/components/OfflineGestureDetector.svelte` — sete toques em 5 segundos disparando `dispatch('gesture-detected')` — **não é importado em lugar nenhum do projeto**. `grep -rn "OfflineGestureDetector" src` só bate no próprio arquivo; `grep -rn "gesture-detected" src` também só bate nele mesmo. É código morto, histórico de uma ideia (esconder o modo offline atrás de um gesto secreto) que nunca chegou a ser ligada a nada e que a decisão D-15 do plano já mandou apagar. Esta tarefa fica reduzida a isso: remover o componente órfão e confirmar, sem construir nada novo, que as duas portas de entrada que já existem continuam funcionando.

**Files:**
- Delete: `src/lib/components/OfflineGestureDetector.svelte`

**Interfaces:**
- Consumes: nenhuma — não há import a remover em nenhum outro arquivo, porque não há import do componente em nenhum outro arquivo.
- Produces: nenhuma. Esta tarefa não cria componente nem store novo.

- [ ] **Step 1: Confirmar que o componente é órfão antes de apagar**

```bash
grep -rn "OfflineGestureDetector" src
```

Esperado: uma única linha, `src/lib/components/OfflineGestureDetector.svelte:1` (a linha em que o próprio arquivo abre `<script>` não conta como import — na prática o comando deve retornar só a ocorrência do próprio arquivo, nunca um `import ... from` em outro lugar). Se aparecer qualquer import de outro arquivo, **parar aqui** — a premissa desta tarefa (código órfão) não se confirma e apagar quebraria alguma tela; nesse caso, investigar onde o import está antes de prosseguir.

- [ ] **Step 2: Apagar o componente**

```bash
rm src/lib/components/OfflineGestureDetector.svelte
```

- [ ] **Step 3: Verificação — `npm run build`**

```bash
npm run build
```

Esperado: build conclui sem erro. Como nada importava o arquivo, remover não deveria gerar nenhum erro de módulo ausente.

- [ ] **Step 4: Verificação manual das duas portas de entrada existentes**

Rodar `npm run dev`, abrir a home no navegador:
1. Confirmar que o botão "Offline" aparece no cabeçalho, ao lado de "Como Usar", "Biblioteca" e "Listas" — visível sem precisar rolar, sem precisar de nenhum gesto ou toque repetido.
2. Clicar nele: deve navegar para `/offline` e abrir a tela cheia de configuração (categorias para baixar, estatísticas, download em lote).
3. Voltar para a home, navegar para `/leitor?file=...`: confirmar que o cabeçalho (e portanto o botão "Offline") some nessa rota — comportamento esperado, o leitor não mostra a toolbar principal do app.
4. Voltar para fora do `/leitor`: o botão "Offline" deve reaparecer.

Falha: o botão não aparecer em nenhuma página, não navegar para `/offline`, ou o `npm run build` falhar por referência quebrada ao componente apagado.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/OfflineGestureDetector.svelte
git commit -m "chore(offline): remover OfflineGestureDetector.svelte órfão (#29)"
```

### Task 17: A biblioteca usa o controle de paginação compartilhado (achado novo)

`src/routes/biblioteca/+page.svelte` tem sua própria cópia inline dos controles de paginação — duplicada duas vezes (topo e rodapé da lista) — em vez de usar `src/lib/components/LouvorPaginationControls.svelte`, que a home já usa (`src/routes/+page.svelte:642-657`). As quatro ocorrências (topo: `src/routes/biblioteca/+page.svelte:843-858` botão anterior e `:877-892` botão próxima; rodapé: `:947-962` e `:981-996`) têm o mesmo formato:

```svelte
<GestureButton on:click={previousPage} on:longpress={goToFirstPage} ...>
  <button type="button" class="pagination-button" disabled={currentPage === 1} title="...">
    <ChevronLeft class="w-5 h-5" />
  </button>
</GestureButton>
```

Um `<button>` real aninhado dentro do `<div class="gesture-button-wrapper">` que `GestureButton.svelte:389-414` renderiza em torno do seu `<slot/>` — ou seja, dois elementos interativos empilhados no mesmo lugar: o `<div>` do `GestureButton` já é focável e clicável, e o `<button>` HTML dentro dele soma um segundo tab stop no mesmo ponto da tela, com nome acessível vindo só do `title` (que leitores de tela tratam de forma inconsistente, e que não existe para quem navega por teclado). Quem usa Tab para navegar a página passa duas vezes pelo mesmo botão visual.

O mesmo defeito já foi corrigido no componente compartilhado: `LouvorPaginationControls.svelte:120-134` e `:150-164` usam `<div class="pagination-button">` em vez de `<button>` dentro do `GestureButton`, com `ariaLabel` no próprio `GestureButton` fazendo o papel de nome acessível. A biblioteca não herda esse conserto porque não usa o componente — mantém uma cópia própria e desatualizada da mesma lógica (mesmas classes CSS, mesmas funções `previousPage`/`nextPage`/`goToFirstPage`/`goToLastPage`/`handlePageInput`/`handlePageInputKeydown`, `src/routes/biblioteca/+page.svelte:491-539`). A tarefa é trocar a cópia pelo componente — não corrigir o `<button>` aninhado da cópia, que já foi resolvido do jeito certo em outro lugar do próprio repositório.

**Ordem em relação à Task 12 (reescrita da sincronização URL ↔ estado): esta tarefa deve rodar DEPOIS da Task 12, nunca antes nem em paralelo.** A Task 12 reescreve a camada de URL do projeto inteiro, incluindo esta mesma página — e o investigativo `docs/superpowers/investigacao/2026-08-31-url-estado.md`, base de projeto da Task 12, foi produzido lendo e citando `arquivo:linha` do código de hoje, quase certamente incluindo `setPage`, `handlePageInput`, `handlePageInputKeydown`, `urlSyncInitialized` e o bloco de inicialização de URL no `onMount` de `src/routes/biblioteca/+page.svelte` (linhas 296-340 e 588-660 nesta leitura). Se a Task 17 rodar primeiro, ela apaga ou desloca boa parte dessas linhas (a paginação inline soma ~200 linhas de HTML mais as funções de suporte) antes de a Task 12 ser executada — invalidando as referências `arquivo:linha` que a Task 12 carrega e obrigando quem a executar a reinvestigar o arquivo do zero. Rodando na ordem inversa, a Task 17 lê o arquivo já reescrito pela Task 12 (o Edit tool exige ler antes de editar) e adapta a troca ao formato que a Task 12 deixou — sem custo extra, porque esta tarefa não depende de nenhum detalhe fino de como a URL é sincronizada, só de que `setPage`/`previousPage`/`nextPage`/`goToFirstPage`/`goToLastPage` continuem existindo com o mesmo papel, o que a Task 12 preserva por definição (ela reescreve *como* a URL é sincronizada, não *que* a paginação tem essas funções).

**Files:**
- Modify: `src/routes/biblioteca/+page.svelte:19` (import)
- Modify: `src/routes/biblioteca/+page.svelte:281-283,542` (remover estado que só servia à cópia inline)
- Modify: `src/routes/biblioteca/+page.svelte:491-514,548-554` (remover funções que só serviam à cópia inline)
- Modify: `src/routes/biblioteca/+page.svelte:593,694,702` (remover o listener de clique-fora que só servia ao menu de itens-por-página inline)
- Modify: `src/routes/biblioteca/+page.svelte:799-903` (bloco de paginação do topo)
- Modify: `src/routes/biblioteca/+page.svelte:903-999` (bloco de paginação do rodapé)
- Modify: `src/routes/biblioteca/+page.svelte:1041-1243` (`<style>`, remover CSS duplicado)

As faixas de linha acima valem para o código de hoje (antes da Task 12 rodar); depois dela, os números vão ter mudado — localizar os mesmos trechos pelo conteúdo (`pagination-controls`, `handlePageInput`, `ChevronLeft`/`ChevronRight`) em vez de confiar na linha exata.

**Interfaces:**
- Consumes: `LouvorPaginationControls` (`$lib/components/LouvorPaginationControls.svelte`) — props `variant`, `currentPage`, `totalPages`, `itemsPerPage`, `pageInput` (via `bind:`), eventos `itemsPerPage`, `gotoPage`, `previous`, `next`, `first`, `last`. `setPage`, `previousPage`, `nextPage`, `goToFirstPage`, `goToLastPage` (funções já existentes em `src/routes/biblioteca/+page.svelte:319-368,515-539`), `bibliotecaItemsPerPage` (store, já importado), `scrollToLouvores` (já existente).
- Produces: nenhuma interface nova — esta tarefa só troca a implementação da paginação por uma já existente, sem mudar nenhum contrato externo à página.

- [ ] **Step 1: Importar `LouvorPaginationControls` e remover os ícones que só a cópia inline usava**

Em `src/routes/biblioteca/+page.svelte:19`, trocar:

```js
  import { ChevronLeft, ChevronRight } from 'lucide-svelte';
```

por:

```js
  import LouvorPaginationControls from '$lib/components/LouvorPaginationControls.svelte';
```

(`ChevronLeft`/`ChevronRight` só eram usados dentro da cópia inline que este passo remove nos passos seguintes — `LouvorPaginationControls.svelte` já importa os seus próprios ícones internamente.)

- [ ] **Step 2: Adicionar o handler de itens-por-página**

Perto de `setPage` (`src/routes/biblioteca/+page.svelte:319-334`), adicionar:

```js
  /**
   * @param {CustomEvent<{ value: number }>} e
   */
  function handleItemsPerPage(e) {
    bibliotecaItemsPerPage.set(e.detail.value);
    scrollToLouvores();
  }

  /**
   * @param {CustomEvent<{ page: number; scroll?: boolean }>} e
   */
  function handleGotoPage(e) {
    setPage(e.detail.page, { scroll: e.detail.scroll !== false });
  }
```

`handleItemsPerPage` não chama `setPage(1, ...)` — a cópia inline que está sendo substituída também não resetava a página ao trocar o número de itens (só chamava `scrollToLouvores()`); manter esse comportamento evita uma mudança de comportamento não pedida por esta tarefa.

- [ ] **Step 3: Trocar o bloco de paginação do topo**

Em `src/routes/biblioteca/+page.svelte`, o bloco que vai do comentário `<!-- Pagination Controls (Top) -->` (linha 799) até o fechamento do `<div class="pagination-controls pagination-controls-top">` (linha 895) — todo o HTML de `items-per-page-selector` e `pagination-input-group` inline — vira:

```svelte
        <LouvorPaginationControls
          variant="top"
          bind:pageInput
          currentPage={currentPage}
          totalPages={totalPages}
          itemsPerPage={itemsPerPage}
          on:itemsPerPage={handleItemsPerPage}
          on:gotoPage={handleGotoPage}
          on:previous={previousPage}
          on:next={nextPage}
          on:first={goToFirstPage}
          on:last={goToLastPage}
        />
```

- [ ] **Step 4: Trocar o bloco de paginação do rodapé**

O bloco equivalente no rodapé (comentário `<!-- Pagination Controls (Bottom) -->`, linha ~903, até o fechamento em ~999) vira:

```svelte
        <LouvorPaginationControls
          variant="bottom"
          bind:pageInput
          currentPage={currentPage}
          totalPages={totalPages}
          itemsPerPage={itemsPerPage}
          on:itemsPerPage={handleItemsPerPage}
          on:gotoPage={handleGotoPage}
          on:previous={previousPage}
          on:next={nextPage}
          on:first={goToFirstPage}
          on:last={goToLastPage}
        />
```

- [ ] **Step 5: Remover o estado e as funções que só serviam à paginação inline**

Remover de `src/routes/biblioteca/+page.svelte`:
- `let itemsPerPageMenuOpen = false;` (linha 283)
- `let itemsPerPageButtonElement = null;` e seu bloco JSDoc (linha ~541-542)
- a função `handleClickOutside` inteira (linhas ~547-552)
- as funções `handlePageInput` e `handlePageInputKeydown` inteiras (linhas ~491-514) — `LouvorPaginationControls` já traz sua própria versão internamente
- as duas chamadas `document.addEventListener('click', handleClickOutside);` / `document.removeEventListener('click', handleClickOutside);` no `onMount` (linhas ~593, ~694) e a chamada equivalente no `onDestroy` (linha ~702)

Manter `previousPage`, `nextPage`, `goToFirstPage`, `goToLastPage` e `setPage` — são consumidos pelo componente agora, como listado em Interfaces.

- [ ] **Step 6: Remover o CSS duplicado**

Em `src/routes/biblioteca/+page.svelte`, remover o bloco inteiro de `.pagination-controls` até o fim do `@media (max-width: 640px) { ... }` que o segue (linhas ~1041-1243) — é uma cópia byte-a-byte do `<style>` de `LouvorPaginationControls.svelte:250-460`, que passa a valer sozinho agora que o componente é usado. Manter `.no-results-message`, que vem logo depois e não faz parte da paginação.

- [ ] **Step 7: Verificação — `npm run check` e `npm run build`**

```bash
npm run build
```

Esperado: build conclui sem erro. `ChevronLeft`, `ChevronRight`, `itemsPerPageMenuOpen`, `itemsPerPageButtonElement`, `handleClickOutside`, `handlePageInput`, `handlePageInputKeydown` não podem mais aparecer em `src/routes/biblioteca/+page.svelte` — conferir com:

```bash
grep -n "ChevronLeft\|ChevronRight\|itemsPerPageMenuOpen\|itemsPerPageButtonElement\|handleClickOutside\|handlePageInput" src/routes/biblioteca/+page.svelte
```

Esperado: nenhuma ocorrência.

- [ ] **Step 8: Verificação manual — sem tab stop duplicado**

Abrir `/biblioteca` no navegador. Clicar em qualquer ponto vazio da página para tirar o foco de tudo, depois apertar Tab repetidamente contando as paradas até chegar nos botões de paginação (anterior/próxima, topo e rodapé): cada botão deve receber foco **uma única vez** (um anel dourado visível por botão, não dois seguidos no mesmo lugar). Testar também: clicar em "anterior"/"próxima" navega de página; segurar pressionado (toque longo, ~500ms) em "anterior" vai para a primeira página, em "próxima" vai para a última; trocar "Itens por página" muda a lista sem resetar para a página 1 (mesmo comportamento de antes); digitar um número no campo de página e apertar Enter navega direto para aquela página. Falha: dois tab stops seguidos no mesmo botão visual, ou qualquer uma das interações acima parar de funcionar.

- [ ] **Step 9: Commit**

```bash
git add src/routes/biblioteca/+page.svelte
git commit -m "refactor(biblioteca): usar LouvorPaginationControls em vez da cópia inline"
```

---

## Fase 5 — Achados novos, parqueados e limpezas

Nada aqui é urgente e nada aqui é grande. São correções que a execução do plano anterior encontrou e deixou anotadas, agrupadas por forma para caber em poucos commits.

---
### Task 18: Lote — ciclo de vida do service worker e armazenamento defensivo

Seis correções pequenas e independentes entre si, encontradas durante a verificação do plano anterior (inventário itens 14-19). Nenhuma muda comportamento visível em uso normal — todas fecham uma janela de falha silenciosa: um listener que nunca é removido, um cleanup que corre atrás da promise errada, um cache que "Limpar tudo" esquece, um `localStorage` cru que lança em navegador com storage bloqueado, um detector de portal cativo que só reconhece um `content-type` entre vários, e uma verificação de download que encolhe o que fiscaliza sem avisar. Sucesso é: os seis pontos do inventário deixam de estar abertos, `npm test` continua verde, e os três itens de ciclo de vida de Service Worker (que teste unitário não prova) têm uma verificação manual em navegador anexada ao passo.

**Files:**
- Modify: `src/lib/utils/swRegistration.js:79-102`
- Modify: `src/routes/+layout.svelte:113-141`
- Modify: `src/service-worker.js:18-25,649-660`
- Modify: `src/lib/stores/offline.js:29,720-764,882,1903,2285`
- Create: `src/lib/offline/download/partVerification.js`
- Test: `src/lib/offline/download/partVerification.test.js`
- Modify: `src/lib/offline/download/partProgress.js:337-344`
- Test: `src/lib/offline/download/partProgress.test.js`
- Modify: `package.json:18` (registrar `partVerification.test.js` no script `test`)

**Interfaces:**
- Consumes: `getPdfRelPath({ pdfId })` de `$lib/utils/pathUtils` (já importado em `offline.js:29`); `PDF_IMPORT_STAGING_CACHE_NAME` de `$lib/offline/sw/swCaches.js`.
- Produces: `getPartPdfPaths(part, getPdfRelPath): { paths: string[], unresolved: number }`; `verifyCompletedPart(part, cachedPaths, getPdfRelPath): { skippable: boolean, paths: string[] }` — ambas agora exportadas de `partVerification.js`, não mais privadas de `offline.js`.

---

- [ ] **Step 1: `swRegistration.js` — o listener `statechange` não guardado**

`registration.js:79-91` cria um `newWorker.addEventListener('statechange', () => {...})` com uma função anônima: nada é guardado para remover depois, e `updatefound` pode disparar de novo a cada checagem horária (`updateIntervalId`, linha 75-77), empilhando um listener por tentativa de instalação.

Abra `src/lib/utils/swRegistration.js` e troque o bloco de `onUpdateFound` (linhas 79-91):

```js
    const onUpdateFound = () => {
      const newWorker = registration.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // Novo service worker disponível
          debugLog('[SW Registration] New service worker available');
          dispatchUpdateEvent();
        }
      });
    };

    registration.addEventListener('updatefound', onUpdateFound);
```

por:

```js
    /** @type {ServiceWorker | null} worker cujo listener de statechange está ativo agora. */
    let installingWorker = null;
    /** @type {(() => void) | null} o listener em si, para poder removê-lo depois. */
    let onInstallingStateChange = null;

    const onUpdateFound = () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      // Cada `updatefound` é uma tentativa de instalação nova: solta o listener
      // da tentativa anterior antes de prender um novo, senão acumula um por
      // checagem horária (setInterval acima) sem nunca soltar nenhum.
      if (installingWorker && onInstallingStateChange) {
        installingWorker.removeEventListener('statechange', onInstallingStateChange);
      }

      onInstallingStateChange = () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // Novo service worker disponível
          debugLog('[SW Registration] New service worker available');
          dispatchUpdateEvent();
        }
      };
      installingWorker = newWorker;
      newWorker.addEventListener('statechange', onInstallingStateChange);
    };

    registration.addEventListener('updatefound', onUpdateFound);
```

E o `cleanup` devolvido por `registerServiceWorker` (linhas 96-101), que hoje só solta `updatefound` e `controllerchange`:

```js
      cleanup: () => {
        clearInterval(updateIntervalId);
        registration.removeEventListener('updatefound', onUpdateFound);
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      }
```

passa a soltar também o `statechange` pendente, se houver um:

```js
      cleanup: () => {
        clearInterval(updateIntervalId);
        registration.removeEventListener('updatefound', onUpdateFound);
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
        if (installingWorker && onInstallingStateChange) {
          installingWorker.removeEventListener('statechange', onInstallingStateChange);
        }
      }
```

- [ ] **Step 2: Verificar em navegador — o listener não se acumula**

Ciclo de vida de Service Worker não se prova em `node --test`. Verificação manual:

```bash
npm run dev
```

1. Abra o app no Chrome, DevTools → Console, e cole antes de qualquer atualização:

```js
window.__stateChangeAdds = 0;
window.__stateChangeRemoves = 0;
const origAdd = EventTarget.prototype.addEventListener;
const origRemove = EventTarget.prototype.removeEventListener;
EventTarget.prototype.addEventListener = function (type, ...rest) {
  if (type === 'statechange') window.__stateChangeAdds++;
  return origAdd.call(this, type, ...rest);
};
EventTarget.prototype.removeEventListener = function (type, ...rest) {
  if (type === 'statechange') window.__stateChangeRemoves++;
  return origRemove.call(this, type, ...rest);
};
```

2. DevTools → Application → Service Workers → clique "Update" três vezes seguidas (cada clique, se houver algo para instalar, dispara `updatefound`; sem mudança no arquivo, edite um comentário em `src/service-worker.js` e salve entre os cliques para forçar um worker novo a cada vez).
3. No console: `window.__stateChangeAdds - window.__stateChangeRemoves` deve ficar em **0 ou 1** (0 quando o último `installed` já resolveu e não há instalação pendente; 1 enquanto uma instalação está em andamento) — nunca crescendo a cada clique. Antes da correção, esse número crescia 1 por clique e nunca descia.

- [ ] **Step 3: `+layout.svelte` — o cleanup do Service Worker corre atrás de uma promise que já resolveu tarde demais**

`src/routes/+layout.svelte:113-141`: `swCleanup` só é atribuído dentro do `.then()` de `registerServiceWorker()`. Se o componente desmontar antes dessa promise resolver, a função de cleanup do `onMount` já rodou com `swCleanup` ainda `null` — quando a promise resolve depois, `swCleanup` é setado mas nunca mais chamado.

Troque:

```js
      let swCleanup = null;
      let swMessageCleanup = null;

      registerServiceWorker().then(({ cleanup }) => {
        swCleanup = cleanup;

        // Setup Service Worker message listener
        swMessageCleanup = setupServiceWorkerMessageListener();

        // Setup BroadcastChannel for cross-tab sync
        setupCacheSync();
      });
```

por:

```js
      let disposed = false;
      let swCleanup = null;
      let swMessageCleanup = null;

      registerServiceWorker().then(({ cleanup }) => {
        if (disposed) {
          // O componente já foi desmontado enquanto o registro estava em voo:
          // não adianta religar listener nenhum, só soltar o que acabou de
          // ser criado.
          cleanup?.();
          return;
        }
        swCleanup = cleanup;

        // Setup Service Worker message listener
        swMessageCleanup = setupServiceWorkerMessageListener();

        // Setup BroadcastChannel for cross-tab sync
        setupCacheSync();
      });
```

E o cleanup do `onMount` (linhas 135-141):

```js
      return () => {
        removeLouvoresChecksumTriggers();
        removeStaleChunkListeners();
        cancelStaleRecoveryReset();
        swCleanup?.();
        swMessageCleanup?.();
      };
```

por:

```js
      return () => {
        disposed = true;
        removeLouvoresChecksumTriggers();
        removeStaleChunkListeners();
        cancelStaleRecoveryReset();
        swCleanup?.();
        swMessageCleanup?.();
      };
```

- [ ] **Step 4: Verificar em navegador — o cleanup tardio não vaza**

O `+layout.svelte` raiz normalmente só desmonta com o app inteiro (navegação client-side não o destrói). O jeito de reproduzir a corrida é via HMR do Vite em dev, que destrói e recria o componente:

```bash
npm run dev
```

1. DevTools → Network → throttling "Slow 3G" (isso atrasa o `fetch` de `/service-worker.js` dentro de `registerServiceWorker()`, mantendo a promise pendente por alguns segundos).
2. Recarregue a página para começar com a promise em voo.
3. Enquanto ainda estiver carregando (antes do worker responder), edite `src/routes/+layout.svelte` — acrescente um espaço em branco em qualquer linha e salve. O HMR do Svelte destrói e recria o componente da rota raiz, rodando o cleanup do `onMount` antigo.
4. No Console, confirme que não aparece nenhum erro (`TypeError`, `Cannot read properties of null`) na sequência do reload/HMR. Adicione temporariamente `console.log('[layout] cleanup tardio, disposed=true')` dentro do `if (disposed)` do Step 3 para confirmar que esse ramo é de fato alcançado quando a promise resolve depois do desmonte — depois remova o log.
5. Volte o throttling para "No throttling".

- [ ] **Step 5: `handleClearCache` não apaga o cache de staging da importação de ZIP**

`src/service-worker.js:649-660` apaga `PDF_CACHE`, `CATALOG_CACHE` e `APP_CACHE`, mas nunca `plpc-pdfs-import-staging` — o cache de área de espera de `OfflineBundleImporter`, que `PROTECTED_CACHE_NAMES` (`src/lib/offline/sw/swCaches.js:44-48`) também protege do `activate`, então uma importação abortada deixa PDFs parciais lá para sempre, e "Limpar tudo" não os alcança.

Em `src/service-worker.js`, acrescente `PDF_IMPORT_STAGING_CACHE_NAME` ao import de `swCaches.js` (linhas 18-25):

```js
import {
  appCacheName,
  isObsoleteCacheName,
  migrateCatalogManifests,
  CATALOG_CACHE_NAME,
  CATALOG_MANIFEST_PATHS,
  PDF_CACHE_NAME
} from '$lib/offline/sw/swCaches.js';
```

vira:

```js
import {
  appCacheName,
  isObsoleteCacheName,
  migrateCatalogManifests,
  CATALOG_CACHE_NAME,
  CATALOG_MANIFEST_PATHS,
  PDF_CACHE_NAME,
  PDF_IMPORT_STAGING_CACHE_NAME
} from '$lib/offline/sw/swCaches.js';
```

Logo abaixo do `const CATALOG_CACHE = CATALOG_CACHE_NAME;` (perto da linha 38), acrescente:

```js
/** Área de espera da importação de bundle offline — também precisa sumir em "Limpar tudo". */
const PDF_IMPORT_STAGING_CACHE = PDF_IMPORT_STAGING_CACHE_NAME;
```

E em `handleClearCache` (linhas 649-660):

```js
async function handleClearCache(event) {
  try {
    await caches.delete(PDF_CACHE);
    await caches.delete(CATALOG_CACHE);
    await caches.delete(APP_CACHE);
    debug('Todos os caches limpos');
```

vira:

```js
async function handleClearCache(event) {
  try {
    await caches.delete(PDF_CACHE);
    await caches.delete(CATALOG_CACHE);
    await caches.delete(APP_CACHE);
    await caches.delete(PDF_IMPORT_STAGING_CACHE);
    debug('Todos os caches limpos');
```

- [ ] **Step 6: Verificar em navegador — o staging some junto**

```bash
npm run dev
```

1. DevTools → Application → Cache Storage. Confirme que `plpc-pdfs-import-staging` não existe ainda.
2. No Console, crie o cache manualmente para não depender de rodar uma importação de ZIP inteira:
   ```js
   await caches.open('plpc-pdfs-import-staging');
   ```
3. Recarregue o painel Cache Storage (botão de refresh) — `plpc-pdfs-import-staging` aparece na lista.
4. Vá à página `/offline`, use a ação "Limpar tudo" (ou, no Console, `await navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE', data: {} })` — sem porta de resposta, é só para disparar a limpeza).
5. Atualize o painel Cache Storage de novo: `plpc-pdfs-import-staging` não deve mais estar na lista, junto com `plpc-pdfs`, `plpc-catalog` e o `plpc-<version>-app`.

- [ ] **Step 7: `offline.js:2285` — `localStorage` cru fora do `safeStorage()`**

O mesmo arquivo já tem o padrão certo em `offline.js:2143` (`safeStorage()?.getItem('IS_LEITOR_OFFLINE')`), com o comentário explicando por quê: no Firefox com dados do site bloqueados, `localStorage` cru lança. A linha 2285 é a mesma leitura, sem a proteção.

Troque, em `src/lib/stores/offline.js`:

```js
  // Check if IS_LEITOR_OFFLINE flag exists, if not open PDF in leitor
  const isLeitorOffline = localStorage.getItem('IS_LEITOR_OFFLINE');
```

por:

```js
  // Check if IS_LEITOR_OFFLINE flag exists, if not open PDF in leitor
  // Via safeStorage(): mesmo motivo da linha ~2143 — no Firefox com dados do
  // site bloqueados, o acesso direto a localStorage aqui lançaria.
  const isLeitorOffline = safeStorage()?.getItem('IS_LEITOR_OFFLINE');
```

Este trecho de `offline.js` não faz parte de nenhuma suíte de `node --test` (o arquivo importa `$app/environment` e `svelte/store`, que não resolvem fora do SvelteKit). A verificação é por grep, direto no terminal:

```bash
grep -n "localStorage\.\(get\|set\|remove\)Item" src/lib/stores/offline.js | grep -v "function safeStorage"
```

Saída esperada: nenhuma linha (todo acesso a `localStorage` no arquivo passa por `safeStorage()` ou `safeSetItem()`, exceto a própria definição de `safeStorage()`, que o `grep -v` acima já exclui).

- [ ] **Step 8: `partProgress.js` — teste que falha: `looksLikeCaptivePortal` não cobre `xhtml+xml`, resposta sem `content-type` nem redirecionamento**

`src/lib/offline/download/partProgress.js:337-344` só casa `text/html`. Um portal cativo que devolve `application/xhtml+xml`, ou que redireciona para outro host sem repetir um `content-type` de arquivo, ou que responde sem `content-type` nenhum, passa hoje como pacote válido.

Em `src/lib/offline/download/partProgress.test.js`, no `describe('classificação de resposta', ...)`, depois do teste existente `'reconhece portal cativo pelo content-type'`, acrescente:

```js
  it('reconhece xhtml+xml também', () => {
    const xhtml = { headers: { get: () => 'application/xhtml+xml; charset=utf-8' } };
    assert.equal(looksLikeCaptivePortal(xhtml), true);
  });

  it('reconhece redirecionamento sem content-type de arquivo', () => {
    const redirecionado = { redirected: true, headers: { get: () => null } };
    const zipRedirecionado = { redirected: true, headers: { get: () => 'application/zip' } };
    assert.equal(looksLikeCaptivePortal(redirecionado), true);
    assert.equal(looksLikeCaptivePortal(zipRedirecionado), false);
  });

  it('reconhece resposta sem content-type nenhum', () => {
    const semHeader = { headers: { get: () => null } };
    assert.equal(looksLikeCaptivePortal(semHeader), true);
  });
```

Rode e veja falhar:

```bash
node --test src/lib/offline/download/partProgress.test.js
```

Saída esperada: `# fail 1` (a última das três, "reconhece resposta sem content-type nenhum" — as duas primeiras dependem da ordem de implementação; rodar de novo depois de cada `it` isolada mostra os três casos falhando um a um se comentados em separado). O essencial: `# pass` menor que o total, com `AssertionError` de `false !== true` apontando para as linhas novas.

- [ ] **Step 9: Implementar e ver passar**

Em `src/lib/offline/download/partProgress.js`, troque:

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

por:

```js
export function looksLikeCaptivePortal(response) {
  try {
    if (!response) return false;
    const contentType = (response.headers?.get?.('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
      return true;
    }
    // Sem content-type nenhum, ou a resposta final não é mais a URL pedida
    // (redirect): as duas são assinatura de portal cativo devolvendo outra
    // coisa no lugar do pacote — a não ser que o content-type já diga que é
    // um arquivo de verdade (pdf/zip). É uma escolha deliberadamente
    // conservadora: prefere rejeitar uma resposta ambígua a aceitar um
    // portal como pacote válido.
    const pareceArquivo = contentType.includes('pdf') || contentType.includes('zip');
    if (!pareceArquivo && (contentType === '' || response.redirected)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
```

```bash
node --test src/lib/offline/download/partProgress.test.js
```

Saída esperada: `# pass 39`, `# fail 0` (36 testes já existentes no arquivo + os 3 novos).

- [ ] **Step 10: `offline.js` — teste que falha: `getPartPdfPaths` descarta ids em silêncio**

`src/lib/stores/offline.js:734-746` (`getPartPdfPaths`) e `:757-764` (`verifyCompletedPart`) hoje: qualquer `pdfId` que não seja string, ou para o qual `getPdfRelPath` não resolva, some do array sem contagem — e `verifyCompletedPart` só verifica o que sobrou, podendo marcar uma parte como "pode pular" mesmo quando parte dela nunca foi checada.

Como `offline.js` não é testável sob `node --test` (importa `$app/environment` e `svelte/store`), extraia as duas funções — que já são puras — para um módulo novo, no mesmo padrão de `partProgress.js`: lógica pura, storage/resolvedor injetado por parâmetro.

Crie `src/lib/offline/download/partVerification.test.js`:

```js
/**
 * Verificação de "parte já baixada" contra o cache real.
 * Run: node --test src/lib/offline/download/partVerification.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPartPdfPaths, verifyCompletedPart } from './partVerification.js';

/** Resolvedor de teste: só resolve o que está no mapa. */
function makeResolver(map) {
  return ({ pdfId }) => map[pdfId] ?? null;
}

describe('getPartPdfPaths', () => {
  it('resolve todos os ids válidos', () => {
    const resolver = makeResolver({ a: 'assets/a.pdf', b: 'assets/b.pdf' });
    const part = { pdfs: ['a', 'b'] };
    assert.deepEqual(getPartPdfPaths(part, resolver), {
      paths: ['assets/a.pdf', 'assets/b.pdf'],
      unresolved: 0
    });
  });

  it('conta em unresolved, não descarta em silêncio', () => {
    const resolver = makeResolver({ a: 'assets/a.pdf' });
    const part = { pdfs: ['a', 123, 'b-sem-mapa'] };
    const { paths, unresolved } = getPartPdfPaths(part, resolver);
    assert.deepEqual(paths, ['assets/a.pdf']);
    assert.equal(unresolved, 2);
  });

  it('parte sem pdfs devolve vazio', () => {
    assert.deepEqual(getPartPdfPaths({}, makeResolver({})), { paths: [], unresolved: 0 });
  });
});

describe('verifyCompletedPart', () => {
  it('pula quando todos os caminhos resolvidos estão no cache', () => {
    const resolver = makeResolver({ a: 'assets/a.pdf', b: 'assets/b.pdf' });
    const part = { pdfs: ['a', 'b'] };
    const cached = new Set(['assets/a.pdf', 'assets/b.pdf']);
    assert.equal(verifyCompletedPart(part, cached, resolver).skippable, true);
  });

  it('não pula se falta algum caminho no cache', () => {
    const resolver = makeResolver({ a: 'assets/a.pdf', b: 'assets/b.pdf' });
    const part = { pdfs: ['a', 'b'] };
    const cached = new Set(['assets/a.pdf']);
    assert.equal(verifyCompletedPart(part, cached, resolver).skippable, false);
  });

  it('não pula se algum id não resolveu — é o bug que este teste fecha', () => {
    const resolver = makeResolver({ a: 'assets/a.pdf' });
    const part = { pdfs: ['a', 'id-sem-mapa'] };
    // O único caminho resolvido está no cache — mas o outro id nunca foi checado.
    const cached = new Set(['assets/a.pdf']);
    assert.equal(verifyCompletedPart(part, cached, resolver).skippable, false);
  });

  it('sem cachedPaths, nunca pula', () => {
    const resolver = makeResolver({ a: 'assets/a.pdf' });
    assert.equal(verifyCompletedPart({ pdfs: ['a'] }, null, resolver).skippable, false);
  });
});
```

Rode e veja falhar (o módulo ainda não existe):

```bash
node --test src/lib/offline/download/partVerification.test.js
```

Saída esperada:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../partVerification.js'
```

- [ ] **Step 11: Implementar `partVerification.js` e ver passar**

Crie `src/lib/offline/download/partVerification.js`:

```js
/**
 * Verificação de "parte já baixada" contra o cache real.
 *
 * Extraído de `stores/offline.js` para ser testável sob `node --test`: as duas
 * funções são puras, e só a resolução de caminho (`getPdfRelPath`) precisa vir
 * de fora — é a única parte que depende de `$lib/utils/pathUtils`.
 */

/**
 * Caminhos relativos ("assets/…") dos PDFs declarados em uma parte do manifesto.
 *
 * Qualquer id que não resolva vira parte do `unresolved` em vez de sumir do
 * array em silêncio — sem isso, uma parte com PDFs "invisíveis" para o
 * resolvedor podia ser marcada como completa tendo verificado só o que sobrou.
 *
 * @param {any} part
 * @param {(louvor: { pdfId: string }) => string | null | undefined} getPdfRelPath
 * @returns {{ paths: string[], unresolved: number }}
 */
export function getPartPdfPaths(part, getPdfRelPath) {
  const ids = Array.isArray(part?.pdfs) ? part.pdfs : [];
  /** @type {string[]} */
  const paths = [];
  let unresolved = 0;
  for (const pdfId of ids) {
    if (typeof pdfId !== 'string') {
      unresolved++;
      continue;
    }
    const relPath = getPdfRelPath({ pdfId });
    if (relPath) {
      paths.push(relPath);
    } else {
      unresolved++;
    }
  }
  return { paths, unresolved };
}

/**
 * Decide se uma parte marcada como concluída pode mesmo ser pulada.
 *
 * Só pula se todos os PDFs declarados na parte estiverem de fato no cache **e**
 * todos tiverem sido resolvidos — um id que não resolveu não é "não conta",
 * é "não sei", e "não sei" não pode virar "completo".
 *
 * @param {any} part
 * @param {Set<string> | null} cachedPaths
 * @param {(louvor: { pdfId: string }) => string | null | undefined} getPdfRelPath
 * @returns {{ skippable: boolean, paths: string[] }}
 */
export function verifyCompletedPart(part, cachedPaths, getPdfRelPath) {
  const { paths, unresolved } = getPartPdfPaths(part, getPdfRelPath);
  if (!cachedPaths || paths.length === 0 || unresolved > 0) {
    return { skippable: false, paths };
  }
  const skippable = paths.every((path) => cachedPaths.has(path));
  return { skippable, paths };
}
```

```bash
node --test src/lib/offline/download/partVerification.test.js
```

Saída esperada: `# tests 7`, `# pass 7`, `# fail 0`.

- [ ] **Step 12: Ligar `partVerification.js` em `offline.js`**

Em `src/lib/stores/offline.js`, acrescente o import (perto da linha 25, junto dos outros imports de `offline/download`):

```js
import { verifyCompletedPart } from '$lib/offline/download/partVerification.js';
```

Apague as duas funções locais que a linha 720-764 continha (o bloco que começa em `/**\n * Caminhos relativos ("assets/…")...` e termina no fechamento de `verifyCompletedPart`):

```js
/**
 * Caminhos relativos ("assets/…") dos PDFs declarados em uma parte do manifesto.
 * @param {any} part
 * @returns {string[]}
 */
function getPartPdfPaths(part) {
  const ids = Array.isArray(part?.pdfs) ? part.pdfs : [];
  /** @type {string[]} */
  const paths = [];
  for (const pdfId of ids) {
    if (typeof pdfId !== 'string') continue;
    const relPath = getPdfRelPath({ pdfId });
    if (relPath) paths.push(relPath);
  }
  return paths;
}

/**
 * Decide se uma parte marcada como concluída pode mesmo ser pulada.
 *
 * Só pula se todos os PDFs declarados na parte estiverem de fato no cache: a
 * marca no localStorage sozinha não basta (o usuário pode ter limpado o cache
 * entre as duas tentativas).
 *
 * @param {any} part
 * @param {Set<string> | null} cachedPaths
 * @returns {{ skippable: boolean, paths: string[] }}
 */
function verifyCompletedPart(part, cachedPaths) {
  const paths = getPartPdfPaths(part);
  if (!cachedPaths || paths.length === 0) {
    return { skippable: false, paths };
  }
  const skippable = paths.every((path) => cachedPaths.has(path));
  return { skippable, paths };
}
```

E atualize as duas chamadas (linhas 882 e 1903), de:

```js
          const { skippable, paths } = verifyCompletedPart(part, cachedPaths);
```

para:

```js
          const { skippable, paths } = verifyCompletedPart(part, cachedPaths, getPdfRelPath);
```

(`getPdfRelPath` já está importado no topo do arquivo, linha 29, e continua usado só aqui — o import não fica órfão.)

- [ ] **Step 13: Registrar `partVerification.test.js` no runner**

Em `package.json`, acrescente o novo arquivo à lista do script `test` (linha 18):

```bash
sed -i '' 's# src/lib/utils/swDebugMessage.test.js"# src/lib/utils/swDebugMessage.test.js src/lib/offline/download/partVerification.test.js"#' package.json
grep -o 'partVerification.test.js' package.json
```

Saída esperada: `partVerification.test.js`.

- [ ] **Step 14: Rodar a suíte inteira e commitar**

```bash
npm test
```

Saída esperada: `# fail 0`, com mais testes que antes (131 + 3 do captive portal + 7 do `partVerification` = 141 no mínimo).

```bash
npm run build
```

```bash
git add src/lib/utils/swRegistration.js src/routes/+layout.svelte src/service-worker.js \
  src/lib/stores/offline.js src/lib/offline/download/partVerification.js \
  src/lib/offline/download/partVerification.test.js src/lib/offline/download/partProgress.js \
  src/lib/offline/download/partProgress.test.js package.json
git commit -m "fix: ciclo de vida do SW e armazenamento defensivo (lote de achados)"
```

---

### Task 19: Lote — código morto e bugs inertes

Dois bugs de ordem de operação (inventário itens 11 e 12) e uma varredura de código morto nos módulos tocados por esta mesma investigação. Sucesso é: os dois bugs corrigidos com teste vermelho→verde, os três imports mortos de `urlNormalizer` deliberadamente **não** tocados aqui (justificado abaixo — pertencem à Tarefa 9), e pelo menos um achado de código morto genuíno, com prova de zero importadores, removido.

**Files:**
- Modify: `src/lib/utils/validationCacheStore.js:38-50,108-152`
- Test: `src/lib/utils/validationCacheStore.test.js`
- Modify: `src/lib/offline/import/zipCdReader.js:1-14,160-172`
- Modify: `src/lib/offline/import/OfflineBundleImporter.js:233-239`
- Test: `src/lib/offline/import/zipCdReader.test.js`
- Modify: `src/lib/utils/swRegistration.js:109-126` (remover `unregisterServiceWorker`)

**Interfaces:**
- Consumes: nada novo.
- Produces: `writeAll(storage, data): boolean` (antes não devolvia nada) em `validationCacheStore.js`; `iterateZipEntriesCd(file, signal)` continua com a mesma assinatura, mas agora pode lançar `Error('Entrada ZIP insegura: ...')` **durante a iteração** (antes só o consumidor lançava isso, depois de já ter inflado a entrada).

**Não duplicar:** três achados de código morto adjacentes já pertencem a outras tarefas deste plano e não devem ser repetidos aqui — `src/routes/biblioteca/+page.svelte:204` (leitura direta de `$page.pathname`) e a flag `pageInitializedFromUrl` decorativa da home estão na Tarefa 12 e na Tarefa 11 respectivamente; a função `handleSearch()` morta da home está na Tarefa 11.

---

- [ ] **Step 1: `validationCacheStore.js` — teste que falha: a migração apaga antes de garantir que gravou**

`src/lib/utils/validationCacheStore.js:131-150` (`migrateLegacyValidationKeys`): o laço `for (const key of legacyKeys)` já chama `storage.removeItem(key)` a cada iteração, **antes** do `writeAll(storage, data)` final. Se a gravação consolidada falhar (cota estourada, ou a aba fechar entre os dois passos), as chaves antigas já sumiram e o registro novo nunca existiu — perda total daquelas entradas.

Em `src/lib/utils/validationCacheStore.test.js`, depois do teste `'migra e apaga as chaves antigas pdfValidation_*'`, acrescente:

```js
  it('não apaga as chaves antigas se a gravação final falhar', () => {
    const legacy = createStorage({
      'pdfValidation_a': JSON.stringify({ available: true, url: '/a.pdf', timestamp: NOW })
    });
    const originalSetItem = legacy.setItem.bind(legacy);
    legacy.setItem = (key, value) => {
      if (key === VALIDATION_CACHE_KEY) {
        throw new Error('quota estourada');
      }
      originalSetItem(key, value);
    };

    migrateLegacyValidationKeys(legacy);

    assert.notEqual(legacy.getItem('pdfValidation_a'), null);
  });
```

Rode e veja falhar:

```bash
node --test src/lib/utils/validationCacheStore.test.js
```

Saída esperada:

```
AssertionError [ERR_ASSERTION]: Expected "actual" to be strictly unequal to: null
```

(a chave antiga já foi removida pelo laço antes de `writeAll` sequer tentar gravar — e como `writeAll` engole a própria exceção em silêncio, hoje não há sinal nenhum de que a migração falhou).

- [ ] **Step 2: Implementar — inverter a ordem, e fazer `writeAll` reportar se gravou**

O bug tem duas partes: a ordem errada, **e** o fato de `writeAll` (linhas 38-50) nunca informar sucesso ou falha a quem chamou — sem isso, inverter a ordem sozinho não basta, porque o laço de remoção rodaria de qualquer jeito depois de uma escrita que falhou em silêncio.

Em `src/lib/utils/validationCacheStore.js`, troque `writeAll` (linhas 38-50):

```js
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
```

por:

```js
function writeAll(storage, data) {
  try {
    storage.setItem(VALIDATION_CACHE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    // Cota estourada: descarta o cache inteiro (é reconstruível) e tenta uma vez.
    try {
      storage.removeItem(VALIDATION_CACHE_KEY);
      storage.setItem(VALIDATION_CACHE_KEY, JSON.stringify({ v: 1, entries: {} }));
    } catch {
      // Storage indisponível (modo privado): seguir sem cache.
    }
    return false;
  }
}
```

(Os outros três chamadores de `writeAll` — `readValidationEntry`, `writeValidationEntry`, `removeValidationEntry` — ignoram o valor de retorno hoje; continuam válidos sem mudança, já que uma função que passa a devolver algo não quebra quem não usa o retorno.)

E o fim de `migrateLegacyValidationKeys` (linhas 129-151):

```js
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

por:

```js
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
  }

  // Grava o registro consolidado ANTES de apagar as chaves antigas: se a
  // gravação falhar (cota estourada, storage bloqueado), aborta sem apagar
  // nada — o pior caso vira "migra de novo na próxima sessão", nunca "perdeu
  // o dado porque a chave antiga já tinha sumido antes do registro existir".
  if (!writeAll(storage, data)) return 0;

  for (const key of legacyKeys) {
    try {
      storage.removeItem(key);
    } catch {
      // ignorar
    }
  }

  return legacyKeys.length;
}
```

```bash
node --test src/lib/utils/validationCacheStore.test.js
```

Saída esperada: `# tests 9`, `# pass 9`, `# fail 0`.

- [ ] **Step 3: `zipCdReader.js` — teste que falha: `iterateZipEntriesCd` infla antes de filtrar pelo nome**

`src/lib/offline/import/zipCdReader.js:160-172` chama `readZipEntryData` (que roda `inflateSync`) para **toda** entrada que não é diretório, antes de entregá-la ao consumidor. O único filtro por nome (`isUnsafeZipPath`, dot-files) vive em `OfflineBundleImporter.js:233-239`, depois do `yield` — ou seja, depois da inflação. Num download parcial ou bundle com lixo (`.DS_Store`, `__MACOSX/`), CPU e memória são gastos inflando bytes que o consumidor ia descartar de qualquer jeito.

Primeiro, torne o helper de teste do arquivo capaz de gerar entradas comprimidas (hoje `buildYazlZip` força `{ compress: false }` sempre). Em `src/lib/offline/import/zipCdReader.test.js`, troque:

```js
    for (const f of files) {
      z.addBuffer(f.data, f.name, { compress: false });
    }
```

por:

```js
    for (const f of files) {
      z.addBuffer(f.data, f.name, { compress: f.compress ?? false });
    }
```

Depois, no fim do arquivo (depois do `describe('zipCdReader', ...)`), acrescente um novo `describe`:

```js
describe('iterateZipEntriesCd filtra pelo nome antes de inflar (#12)', () => {
  it('pula um dot-file corrompido sem tentar inflar', async () => {
    // O `.DS_Store` é comprimido (method 8) e depois corrompido byte a byte:
    // se o gerador chamar inflateSync nele antes de filtrar pelo nome, o
    // teste pega o throw. Se filtrar primeiro (o alvo desta correção), o
    // dot-file nunca chega a ser lido e a iteração termina limpa.
    const zip = await buildYazlZip([
      { name: 'assets/a.pdf', data: Buffer.alloc(1000, 7), compress: false },
      { name: '.DS_Store', data: Buffer.from('x'.repeat(300)), compress: true }
    ]);

    const { entries } = await readZipCentralDirectory(new Blob([zip]));
    const dotEntry = entries.find((e) => e.name === '.DS_Store');

    // Corrompe os bytes comprimidos do .DS_Store in-place (mesmo tamanho,
    // então nenhum offset do central directory se move).
    const mutable = Buffer.from(zip);
    const head = mutable.subarray(dotEntry.localHeaderOffset, dotEntry.localHeaderOffset + 30);
    const extraLen = head.readUInt16LE(28);
    const dataStart = dotEntry.localHeaderOffset + 30 + dotEntry.name.length + extraLen;
    for (let i = 0; i < dotEntry.compSize; i++) {
      mutable[dataStart + i] ^= 0xff;
    }
    const blob = new Blob([mutable]);

    // Sanidade: ler a entrada corrompida direto tem que lançar — confirma
    // que a corrupção funcionou.
    const { entries: entries2 } = await readZipCentralDirectory(blob);
    const dotEntry2 = entries2.find((e) => e.name === '.DS_Store');
    await assert.rejects(() => readZipEntryData(blob, dotEntry2));

    // O teste real: iterar o zip inteiro não pode lançar, e o dot-file não
    // pode aparecer — hoje (sem a correção) isto lança "unexpected EOF"
    // porque `readZipEntryData` roda antes do filtro por nome.
    const names = [];
    for await (const entry of iterateZipEntriesCd(blob)) {
      names.push(entry.name);
    }
    assert.deepEqual(names, ['assets/a.pdf']);
  });
});
```

Rode e veja falhar:

```bash
node --test src/lib/offline/import/zipCdReader.test.js
```

Saída esperada:

```
Error: unexpected EOF
    at inflt (.../node_modules/fflate/esm/index.mjs:...)
    at inflateSync (.../node_modules/fflate/esm/index.mjs:...)
    at readZipEntryData (.../zipCdReader.js:150:...)
    at async iterateZipEntriesCd (.../zipCdReader.js:167:...)
```

- [ ] **Step 4: Implementar — filtrar por nome dentro do gerador, antes do `readZipEntryData`**

`isUnsafeZipPath` e `zipEntryBasename` já existem em `bundleValidation.js`, sem import nenhum hoje (`zipCdReader.js` só importa `fflate`) — e `bundleValidation.js` não importa nada, então não há risco de ciclo.

Em `src/lib/offline/import/zipCdReader.js`, acrescente o import logo abaixo do de `fflate`:

```js
import { inflateSync } from 'fflate';
import { isUnsafeZipPath, zipEntryBasename } from './bundleValidation.js';
```

E troque `iterateZipEntriesCd` (linhas 160-172):

```js
export async function* iterateZipEntriesCd(file, signal) {
  const { entries } = await readZipCentralDirectory(file);
  for (const entry of entries) {
    if (signal?.aborted) {
      throw new DOMException('Import cancelled', 'AbortError');
    }
    if (!entry.name || entry.name.endsWith('/')) continue;
    const data = await readZipEntryData(file, entry);
    yield { name: entry.name, data };
  }
}
```

por:

```js
export async function* iterateZipEntriesCd(file, signal) {
  const { entries } = await readZipCentralDirectory(file);
  for (const entry of entries) {
    if (signal?.aborted) {
      throw new DOMException('Import cancelled', 'AbortError');
    }
    if (!entry.name || entry.name.endsWith('/')) continue;

    // Filtra pelo nome ANTES de inflar — o nome já está disponível no central
    // directory, sem custo de leitura de bytes. Inflar e só depois descartar
    // (como o consumidor fazia) gasta CPU e memória em toda entrada de um
    // download parcial que nem ia ser usada.
    if (isUnsafeZipPath(entry.name)) {
      throw new Error(`Entrada ZIP insegura: ${entry.name}`);
    }
    const base = zipEntryBasename(entry.name);
    if (!base || base.startsWith('.')) continue;

    const data = await readZipEntryData(file, entry);
    yield { name: entry.name, data };
  }
}
```

```bash
node --test src/lib/offline/import/zipCdReader.test.js
```

Saída esperada: `# tests 4`, `# pass 4`, `# fail 0`.

- [ ] **Step 5: Simplificar o consumidor — o filtro já veio pronto do gerador**

`src/lib/offline/import/OfflineBundleImporter.js:233-239` repetia as mesmas duas checagens depois do `yield`. Agora são redundantes (o gerador já garante nome seguro e não-dot-file antes de entregar a entrada), mas `base` continua necessário logo depois para comparar com `OFFLINE_MANIFEST_NAME`, `LOUVORES_MANIFEST_NAME` e `requiredParts`.

Troque:

```js
      for await (const entry of iterateZipEntriesCd(file, signal)) {
        throwIfAborted();
        if (isUnsafeZipPath(entry.name)) {
          throw new Error(`Entrada ZIP insegura: ${entry.name}`);
        }

        const base = zipEntryBasename(entry.name);
        if (!base || base.startsWith('.')) continue;
```

por:

```js
      for await (const entry of iterateZipEntriesCd(file, signal)) {
        throwIfAborted();

        // #12: nome já filtrado dentro do gerador (isUnsafeZipPath e
        // dot-files), antes de qualquer inflateSync — não repetir aqui.
        const base = zipEntryBasename(entry.name);
```

`isUnsafeZipPath` continua importado e usado em `OfflineBundleImporter.js:204` (dentro de `processPart`, filtrando o resultado de `unzip` de uma part já extraída) — o import não fica órfão.

```bash
node --test src/lib/offline/import/OfflineBundleImporter.rollback.test.js src/lib/offline/import/zipCdReader.test.js src/lib/offline/import/bundleValidation.test.js
```

Saída esperada: `# fail 0` nas três suítes.

- [ ] **Step 6: Os três imports mortos de `urlNormalizer` — deixados para a Tarefa 9, não corrigidos aqui**

`CacheMigration.js:7`, `PackageDownloader.js:7` e `StatsCalculator.js:8` importam `urlNormalizer` de `../normalization/UrlNormalizer.js` e nunca o usam (confirmado por leitura: `grep -n "urlNormalizer" <cada arquivo>` só acha a linha do import, em nenhum dos três). São mortos de verdade.

Mas a Tarefa 9 deste plano (`Apagar a normalização perdedora e as oito estratégias restantes`, Step 11: "Apagar `UrlNormalizer`, `NormalizationCache`, `LocalStorageAdapter` e `_normalizePath`") já apaga o arquivo `UrlNormalizer.js` inteiro e, no mesmo passo, remove estes três imports com `sed` (`src/lib/offline/storage/CacheMigration.js:7`, `src/lib/offline/stats/StatsCalculator.js:8`, `src/lib/offline/download/PackageDownloader.js:7`). Corrigir aqui primeiro criaria dois jeitos de a mesma linha sumir, dependendo da ordem de execução das tarefas — e se a Tarefa 19 rodar depois da 9, o `sed` da Tarefa 9 já não encontraria a linha e o passo falharia silenciosamente (o `grep` de verificação do Step 11 da Tarefa 9 continuaria vazio, mas por um motivo diferente do que o passo assume).

Não altere `CacheMigration.js`, `PackageDownloader.js` nem `StatsCalculator.js` nesta tarefa. Nenhum passo, nenhum arquivo na lista de commit.

- [ ] **Step 7: Levantamento de código morto adjacente — `unregisterServiceWorker`**

Nos módulos já lidos por esta investigação (`swRegistration.js`, `swCaches.js`, `partProgress.js`, `bundleValidation.js`, `zipCdReader.js`, `validationCacheStore.js`), varredura de todo export contra o resto de `src/`:

```bash
for sym in unregisterServiceWorker sendMessageToSW isRetryableStatus CACHE_PREFIX PROTECTED_CACHE_NAMES VALIDATION_CACHE_KEY findEocdOffset readZipCentralDirectory readZipEntryData; do
  echo "== $sym =="
  grep -rn "$sym" src
done
```

`sendMessageToSW`, `isRetryableStatus`, `CACHE_PREFIX`, `PROTECTED_CACHE_NAMES` e `VALIDATION_CACHE_KEY` são usados dentro do próprio arquivo (helpers internos) ou no teste do próprio módulo — vivos. `findEocdOffset`, `readZipCentralDirectory`, `readZipEntryData` só aparecem em `zipCdReader.js` e no próprio `zipCdReader.test.js` — são primitivas exportadas para serem testadas em isolamento, no mesmo estilo do resto do arquivo, não código morto.

`unregisterServiceWorker` (`src/lib/utils/swRegistration.js:112-126`) é diferente: **zero** ocorrências fora da própria definição, em qualquer arquivo `.js` ou `.svelte` do projeto, e não existe teste para `swRegistration.js`. `unregisterServiceWorker` nunca é chamada — o único outro lugar que desregistra um SW é `src/lib/utils/staleChunkRecovery.js:38`, que chama `.unregister()` direto na `ServiceWorkerRegistration`, sem passar por este helper.

Apague a função. Em `src/lib/utils/swRegistration.js`, remova (linhas 109-126):

```js
/**
 * Unregister the service worker
 */
export async function unregisterServiceWorker() {
  if (!swRegistration) {
    return false;
  }

  try {
    const success = await swRegistration.unregister();
    debugLog('[SW Registration] Service worker unregistered:', success);
    swRegistration = null;
    return success;
  } catch (error) {
    console.error('[SW Registration] Failed to unregister service worker:', error);
    return false;
  }
}

```

```bash
grep -rn "unregisterServiceWorker" src; echo "exit=$?"
```

Saída esperada: nenhuma linha, `exit=1`.

- [ ] **Step 8: Rodar a suíte inteira e commitar**

```bash
npm test
```

Saída esperada: `# fail 0`.

```bash
npm run build
```

```bash
git add src/lib/utils/validationCacheStore.js src/lib/utils/validationCacheStore.test.js \
  src/lib/offline/import/zipCdReader.js src/lib/offline/import/zipCdReader.test.js \
  src/lib/offline/import/OfflineBundleImporter.js src/lib/utils/swRegistration.js
git commit -m "fix: ordem de migração do cache de validação, filtro antes de inflar no import de ZIP, e código morto"
```

---

### Task 20: Enxugar a cópia do pdf.js (#18)

`scripts/copy-pdfjs-viewer.mjs`, rodado no `postinstall` (`package.json:7`), copia a pasta `web` inteira e dois arquivos de `build` do pacote `pdfjs-dist` para `static/pdfjs/` — hoje **3,1 MB** (`du -sh static/pdfjs`), incluindo `web/pdf_viewer.mjs.map` (723.799 bytes) e `build/pdf.worker.min.mjs` (1.369.805 bytes). `src/service-worker.js:73-92` já exclui `/pdfjs/` inteiro do precache — o comentário ali registra que "são 3,1 MB de módulos legados que o app não consome mais" — então isto não é mais custo de cache do usuário: é peso morto de deploy (Cloudflare Pages serve `static/` inteiro) e de primeira requisição de quem baixa a lista de arquivos do site.

A leitura do código, não suposição, é o que decide a lista final. `src/routes/leitor/+page.svelte:1382` carrega só `/pdfjs/web/pdf_viewer.css` via `<link rel="stylesheet">`. O núcleo de verdade — `pdf.mjs`, `pdf.worker.min.mjs`, `pdf_viewer.mjs` — **não vem de `static/`**: `src/lib/utils/pdfjsLoader.js:126,138,146,205` importa `pdfjs-dist/build/pdf.mjs?url`, `pdfjs-dist/build/pdf.worker.min.mjs?url` e `pdfjs-dist/web/pdf_viewer.mjs?url` diretamente do pacote npm; o Vite resolve esses módulos a partir de `node_modules` e os emite como assets com hash em `/_app/immutable/`, cobertos pelo precache normal do `build` do SvelteKit. Ou seja: `static/pdfjs/build/*`, `static/pdfjs/web/pdf_viewer.mjs` e o `.map` nunca são pedidos por ninguém — nem pelo app, nem pelo Service Worker.

A folha de estilo, porém, referencia imagens relativas que **são** pedidas pelo navegador quando a folha casa com os elementos do viewer: `web/pdf_viewer.css` tem 15 `url(images/...)` distintos (ícones do editor de anotação, cursores, spinner de carregamento, barra de mensagem). `static/pdfjs/web/images/` hoje tem 26 arquivos; só 15 são referenciados pelo CSS — os outros 11 (`annotation-*.svg`) não aparecem em nenhum `url()` da folha e não são código morto de outro lugar: são simplesmente sobra do pacote. Sucesso é: o script passa a copiar uma lista explícita de 16 arquivos (a CSS + as 15 imagens referenciadas), `static/pdfjs/` cai de 3,1 MB para ~122 KB, e uma verificação com o app rodando confirma que nada 404.

**Atenção:** `static/pdfjs/` está versionado no git (`git ls-files static/pdfjs | wc -l` → 32 arquivos hoje), não é gerado só localmente e ignorado — o `postinstall` o regenera a cada `npm install`, mas o resultado também fica commitado. A remoção dos 16 arquivos que saem da lista precisa virar `git rm`/`git add` de verdade, não só sumir do disco.

**Files:**
- Modify: `scripts/copy-pdfjs-viewer.mjs`
- Modify: `static/pdfjs/` (32 arquivos versionados → 16; ver Step 3)

**Interfaces:**
- Consumes: `node_modules/pdfjs-dist/web/pdf_viewer.css` e `node_modules/pdfjs-dist/web/images/*` (via `cp`, `fs/promises`).
- Produces: nada (script de build, sem export).

---

- [ ] **Step 1: Confirmar a lista de imagens referenciadas por leitura da CSS**

```bash
grep -o "images/[A-Za-z0-9_.-]*\.\(svg\|gif\|png\)" static/pdfjs/web/pdf_viewer.css | sort -u
```

Saída esperada (15 linhas):

```
images/altText_add.svg
images/altText_disclaimer.svg
images/altText_done.svg
images/altText_spinner.svg
images/altText_warning.svg
images/cursor-editorFreeHighlight.svg
images/cursor-editorFreeText.svg
images/cursor-editorInk.svg
images/cursor-editorTextHighlight.svg
images/editor-toolbar-delete.svg
images/loading-icon.gif
images/messageBar_closingButton.svg
images/messageBar_warning.svg
images/toolbarButton-editorHighlight.svg
images/toolbarButton-menuArrow.svg
```

Compare com o total hoje versionado (`find static/pdfjs/web/images -type f | wc -l` → 26): os 11 que faltam na lista acima (`annotation-check.svg`, `annotation-comment.svg`, `annotation-help.svg`, `annotation-insert.svg`, `annotation-key.svg`, `annotation-newparagraph.svg`, `annotation-noicon.svg`, `annotation-note.svg`, `annotation-paperclip.svg`, `annotation-paragraph.svg`, `annotation-pushpin.svg`) não são citados em nenhum `url()` da folha — não entram na lista nova.

- [ ] **Step 2: Reescrever o script para uma lista explícita**

Troque o conteúdo de `scripts/copy-pdfjs-viewer.mjs` inteiro por:

```js
import { cp, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Únicos arquivos de `pdfjs-dist/web` que o app pede em runtime.
 *
 * `pdf_viewer.css` é carregado direto por `<link>` em `leitor/+page.svelte`.
 * As imagens são as que o próprio CSS referencia via `url(images/...)` — sem
 * elas a folha de estilo carrega, mas os ícones do editor de anotações, os
 * cursores e o spinner de carregamento quebram.
 *
 * Tudo o mais que o pacote `pdfjs-dist` tem em `web/` e `build/` (pdf.mjs,
 * pdf.worker.min.mjs, pdf_viewer.mjs, o source map de 724 KB, e as imagens de
 * anotação que a CSS não referencia) não é servido daqui: o núcleo do PDF.js
 * vem do pacote npm via Vite, que emite os módulos como assets com hash em
 * `/_app/immutable/` (ver src/lib/utils/pdfjsLoader.js) — já cobertos pelo
 * precache normal do `build` do SvelteKit. Copiar a pasta `web` inteira só
 * engordava o deploy: 3,1 MB por ~120 KB de verdade usados (achado #18).
 */
const RUNTIME_FILES = [
  'web/pdf_viewer.css',
  'web/images/altText_add.svg',
  'web/images/altText_disclaimer.svg',
  'web/images/altText_done.svg',
  'web/images/altText_spinner.svg',
  'web/images/altText_warning.svg',
  'web/images/cursor-editorFreeHighlight.svg',
  'web/images/cursor-editorFreeText.svg',
  'web/images/cursor-editorInk.svg',
  'web/images/cursor-editorTextHighlight.svg',
  'web/images/editor-toolbar-delete.svg',
  'web/images/loading-icon.gif',
  'web/images/messageBar_closingButton.svg',
  'web/images/messageBar_warning.svg',
  'web/images/toolbarButton-editorHighlight.svg',
  'web/images/toolbarButton-menuArrow.svg'
];

async function ensureDir(path) {
  try {
    await access(path, constants.F_OK);
  } catch {
    await mkdir(path, { recursive: true });
  }
}

/** @param {string} pkgRoot */
async function copyRuntimeFiles(pkgRoot) {
  for (const rel of RUNTIME_FILES) {
    const source = resolve(pkgRoot, rel);
    const target = resolve(process.cwd(), 'static', 'pdfjs', rel);
    await ensureDir(dirname(target));
    await cp(source, target);
  }
}

async function main() {
  const pkgRootA = resolve(__dirname, '..', 'node_modules', 'pdfjs-dist');
  const pkgRootB = resolve(process.cwd(), 'node_modules', 'pdfjs-dist');

  try {
    await copyRuntimeFiles(pkgRootA);
    // eslint-disable-next-line no-console
    console.log(`[pdfjs] Copiados ${RUNTIME_FILES.length} arquivos de runtime de ${pkgRootA}`);
    return;
  } catch (err) {
    // tenta o caminho alternativo
  }

  try {
    await copyRuntimeFiles(pkgRootB);
    // eslint-disable-next-line no-console
    console.log(`[pdfjs] Copiados ${RUNTIME_FILES.length} arquivos de runtime de ${pkgRootB}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[pdfjs] Falha ao copiar assets de runtime do pdf.js. pdfjs-dist está instalado?',
      err?.message || err
    );
    process.exitCode = 0; // não quebra o install, só avisa
  }
}

main();
```

- [ ] **Step 3: Apagar a cópia antiga e regenerar com o script novo**

```bash
rm -rf static/pdfjs
node scripts/copy-pdfjs-viewer.mjs
```

Saída esperada: `[pdfjs] Copiados 16 arquivos de runtime de .../node_modules/pdfjs-dist`.

```bash
find static/pdfjs -type f | wc -l
du -sh static/pdfjs
```

Saída esperada: `16` arquivos, e um tamanho na casa de **120-130 KB** (contra os 3,1 MB de antes — a CSS sozinha já são ~97 KB, as 15 imagens somam ~27 KB).

Confirme que o git está vendo a redução de verdade, já que `static/pdfjs/` é versionado:

```bash
git add static/pdfjs
git status --short static/pdfjs | awk '{print $1}' | sort | uniq -c
```

Saída esperada: linhas `D` (deleted) para os 16 arquivos que saem — `build/pdf.mjs`, `build/pdf.worker.min.mjs`, `web/pdf_viewer.mjs`, `web/pdf_viewer.mjs.map`, `web/pdf_viewer.d.mts` e as 11 `web/images/annotation-*.svg` — e nenhuma linha para os 16 que ficam (mesmo conteúdo do pacote, então não aparecem como alterados). Total: 16 arquivos removidos do índice do git, 16 mantidos.

- [ ] **Step 4: Verificar com o app rodando — nada 404**

```bash
npm run dev -- --port 5199 --strictPort &
sleep 5
for p in \
  /pdfjs/web/pdf_viewer.css \
  /pdfjs/web/images/altText_add.svg \
  /pdfjs/web/images/altText_disclaimer.svg \
  /pdfjs/web/images/altText_done.svg \
  /pdfjs/web/images/altText_spinner.svg \
  /pdfjs/web/images/altText_warning.svg \
  /pdfjs/web/images/cursor-editorFreeHighlight.svg \
  /pdfjs/web/images/cursor-editorFreeText.svg \
  /pdfjs/web/images/cursor-editorInk.svg \
  /pdfjs/web/images/cursor-editorTextHighlight.svg \
  /pdfjs/web/images/editor-toolbar-delete.svg \
  /pdfjs/web/images/loading-icon.gif \
  /pdfjs/web/images/messageBar_closingButton.svg \
  /pdfjs/web/images/messageBar_warning.svg \
  /pdfjs/web/images/toolbarButton-editorHighlight.svg \
  /pdfjs/web/images/toolbarButton-menuArrow.svg \
  /leitor; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:5199$p")
  echo "$code  $p"
done
kill %1 2>/dev/null
```

Saída esperada: `200` em todas as 17 linhas (as 16 do runtime + `/leitor`).

Depois, abra o app de verdade e confirme visualmente: em `npm run dev`, navegue até `/leitor?file=/offline-setup.pdf` (ou qualquer PDF do acervo), DevTools → Network → filtre por `pdfjs`. Confirme que só as 16 URLs acima aparecem (nenhuma para `pdf.mjs`, `pdf.worker.min.mjs`, `pdf_viewer.mjs` sob `/pdfjs/` — esses vêm de `/_app/immutable/` com outro nome, hasheado) e que nenhuma delas está em vermelho (404). Abra o editor de anotações do visualizador (ícone de caneta/destaque na barra, se exposto na UI) e confirme que os cursores e ícones aparecem — são as 15 imagens que a lista nova preservou.

- [ ] **Step 5: Commit**

```bash
git add scripts/copy-pdfjs-viewer.mjs static/pdfjs
git commit -m "chore: copiar só os arquivos de runtime do pdfjs-dist, não a pasta web inteira (#18)"
```

---

### Task 21: `content-visibility` só se a medição justificar (#16)

A auditoria original mirava "listas longas" sem `content-visibility: auto`. A verificação (inventário item 1) achou que essa premissa mudou: tanto a home (`src/routes/+page.svelte:462-465`, `paginatedResults`) quanto a biblioteca (`src/routes/biblioteca/+page.svelte:340-343`, `paginatedLouvores`) já paginam com `.slice()` antes de renderizar, e `src/lib/stores/bibliotecaItemsPerPage.js:8` trava `VALID_OPTIONS` em `[10, 25, 50]` — no máximo 50 `<LouvorCard>` (`src/lib/components/LouvorCard.svelte`, 613 linhas, dentro de `.louvores-list` em `+page.svelte:706-712` e `biblioteca/+page.svelte:1033-1039`) são montados de uma vez, nunca a lista inteira. `content-visibility: auto` existe para listas de centenas ou milhares de itens fora da tela; 50 cards simples (grid de duas colunas, sem imagem) num aparelho atual pode já custar tempo de layout indistinguível do ruído da própria medição.

Por decisão **D-13** do cabeçalho deste plano: medir antes de aplicar. Esta tarefa tem dois desfechos possíveis, ambos legítimos — **aplicar** a propriedade se a medição mostrar um custo de verdade, ou **descartar o achado com o número medido registrado** se não mostrar. Sucesso não é "content-visibility aplicado"; sucesso é "a decisão certa, com o número que a sustenta, visível para quem ler o código depois".

**Files:**
- Measure only (nenhum arquivo, é medição em navegador)
- Modify (só no desfecho A): `src/lib/components/LouvorCard.svelte:363-374`
- Modify (só no desfecho B): `src/routes/+page.svelte:706-712`, `src/routes/biblioteca/+page.svelte:1033-1039` (comentário registrando a medição)

**Interfaces:**
- Consumes: nada.
- Produces: nada — CSS puro, sem mudança de assinatura em nenhum componente.

---

- [ ] **Step 1: Preparar o cenário de medição — 50 cards renderizados**

```bash
npm run dev
```

Abra `/biblioteca` no Chrome (tem mais louvores que a home filtrada, chega em 50 por página sem precisar montar busca nenhuma). No seletor "Itens por página" do rodapé, escolha **50**. Confirme no Console:

```js
document.querySelectorAll('.louvor-card').length
```

Saída esperada: `50` (ou o total do acervo, se for menor que 50 — improvável, mas se for, ajuste e siga com o total real).

DevTools → Performance → ícone de engrenagem → CPU: **6x slowdown** (simula um aparelho modesto sem precisar de um aparelho modesto).

- [ ] **Step 2: Medir o custo de layout marginal de 10 → 50 itens**

No Console, com a página em 50 itens:

```js
// Força reflow síncrono repetidas vezes sobre .louvores-list e mede quanto
// custa, sem mudar nada visível (só invalida o layout via custom property).
function medirLayout(seletor, repeticoes = 40) {
  const el = document.querySelector(seletor);
  if (!el) throw new Error('não achou ' + seletor);
  const tempos = [];
  for (let i = 0; i < repeticoes; i++) {
    el.style.setProperty('--probe', String(i));
    const t0 = performance.now();
    void el.offsetHeight; // força o layout a rodar agora, não no próximo frame
    tempos.push(performance.now() - t0);
  }
  tempos.sort((a, b) => a - b);
  const mediana = tempos[Math.floor(tempos.length / 2)];
  const resultado = { n: document.querySelectorAll('.louvor-card').length, mediana, min: tempos[0], max: tempos[tempos.length - 1] };
  console.table([resultado]);
  return resultado;
}
window.__m50 = medirLayout('.louvores-list');
```

Anote `__m50`. Agora troque "Itens por página" para **10**, espere a lista re-renderizar, e rode de novo:

```js
window.__m10 = medirLayout('.louvores-list');
```

Anote `__m10`. Calcule:

```js
({ delta: window.__m50.mediana - window.__m10.mediana, ruido: Math.max(window.__m50.max - window.__m50.min, window.__m10.max - window.__m10.min) })
```

- [ ] **Step 3: Decidir — o delta supera o ruído da própria medição?**

Regra: se `delta` (o custo marginal de ir de 10 para 50 cards) for **menor** que `ruido` (a variação que a mesma medição tem sozinha, repetida sobre o mesmo número de itens), o resultado não é distinguível de ruído de medição — não há o que otimizar. Se `delta` for **claramente maior** que `ruido` (função de quanto: o critério é "dá para apontar a diferença com confiança olhando os dois números lado a lado", não um limiar mágico), a lista tem custo de layout real e vale aplicar.

Repita a medição completa (Steps 1-2) pelo menos **duas vezes** antes de decidir — layout de 50 elementos simples costuma rodar em frações de milissegundo mesmo com throttling 6x, e uma medição isolada de JavaScript no V8 tem ruído de GC e JIT que uma repetição só não filtra.

Registre os números medidos (as três repetições, `__m50`, `__m10`, `delta`, `ruido`) — vão para o comentário do desfecho B ou para a mensagem de commit do desfecho A.

- [ ] **Step 4a (só se `delta` claramente maior que `ruido`): Aplicar `content-visibility` no card**

Em `src/lib/components/LouvorCard.svelte`, meça a altura real renderizada de um card não agrupado no DevTools (selecione um `.louvor-card` sem `class:grouped`, veja `offsetHeight` no painel Computed) — é o valor que entra em `contain-intrinsic-size` como estimativa de placeholder antes do primeiro layout real.

Troque a regra `.louvor-card` (linhas 363-374):

```css
  .louvor-card {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.75rem;
    width: 100%;
    padding: 0.75rem 1rem;
    background-color: var(--title-color);
    border: 2px solid var(--gold-color);
    border-radius: 0.5rem;
    box-shadow: var(--shadow-md);
    transition: all 0.2s ease;
  }
```

por (troque `<ALTURA_MEDIDA>` pelo número real do `offsetHeight` medido acima, em px):

```css
  .louvor-card {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.75rem;
    width: 100%;
    padding: 0.75rem 1rem;
    background-color: var(--title-color);
    border: 2px solid var(--gold-color);
    border-radius: 0.5rem;
    box-shadow: var(--shadow-md);
    transition: all 0.2s ease;
    /* #16, medido em <DATA>: 50 cards custam ~<delta>ms de layout a mais que
       10, contra ~<ruido>ms de ruído da própria medição — custo real, não
       ruído. `auto` deixa o navegador lembrar a altura de verdade depois do
       primeiro layout; o valor fixo é só o placeholder inicial. */
    content-visibility: auto;
    contain-intrinsic-size: auto <ALTURA_MEDIDA>px;
  }
```

A variante agrupada (`.louvor-card.grouped`, linha 376-378) fica mais alta que a não agrupada (empilha vários materiais) — o placeholder de `contain-intrinsic-size` é só uma estimativa inicial, não precisa ser exato para cada variante: o navegador corrige para o tamanho real assim que o card entra em tela pela primeira vez, e "auto" faz-o lembrar esse tamanho daí em diante.

Verifique em navegador que nada quebrou: `grep -n "scrollIntoView\|getBoundingClientRect" src/routes/+page.svelte src/routes/biblioteca/+page.svelte` mostra que o scroll da paginação mira `#home-louvores-results` e o alvo de `scrollToLouvores()`, não elementos `.louvor-card` individuais — `content-visibility: auto` não interfere nisso. Role a lista de 50 itens até o fim e volte ao topo, confirme que nenhum card fica com altura errada nem "pisca" ao entrar em tela.

Rode a medição do Step 2 mais uma vez para confirmar que `delta` caiu.

```bash
npm run build
```

```bash
git add src/lib/components/LouvorCard.svelte
git commit -m "perf: content-visibility em LouvorCard, medido (#16)"
```

- [ ] **Step 4b (só se `delta` não for distinguível de `ruido`): Descartar com o número registrado**

Não mude `LouvorCard.svelte`. Em vez disso, registre a medição perto de onde a lista é renderizada, para que ninguém reabra o achado sem motivo novo.

Em `src/routes/+page.svelte`, logo acima da regra `.louvores-list` (linha 706):

```css
  /* #16: content-visibility avaliado e descartado em <DATA>. Medido em
     /biblioteca (mesmo componente LouvorCard, mesma paginação de até 50
     itens): 10→50 cards custou ~<delta>ms de layout a mais, contra ~<ruido>ms
     de ruído da própria medição (CPU 6x throttle, 3 repetições) — abaixo do
     que dá para atribuir com confiança à lista em vez de ao ruído. As listas
     já paginam em no máximo 50 itens (bibliotecaItemsPerPage.js); não há
     lista longa de verdade para otimizar hoje. Reabrir só se o limite de
     paginação subir ou o card ficar bem mais pesado. */
  .louvores-list {
```

Repita o mesmo comentário (mesmos números) acima de `.louvores-list` em `src/routes/biblioteca/+page.svelte:1033`.

```bash
npm run build
```

```bash
git add src/routes/+page.svelte src/routes/biblioteca/+page.svelte
git commit -m "docs: #16 (content-visibility) medido e descartado — número registrado no código"
```

---

## Fase 6 — Manutenção

O que sobra depois que o comportamento está certo: fazer a verificação de tipos valer alguma coisa, dividir o que ficou grande demais para caber na cabeça, e encerrar a duplicação de infraestrutura herdada do achado #31.

---

### Task 22: Zerar os tipos em `src/lib/offline/**` e travar num CI que ainda não existe (#20)

Hoje `npm run check` acusa **1278 erros e 52 avisos em 102 arquivos** — uma verificação que sempre falha é igual a não ter verificação, e ninguém vai notar quando um erro novo de verdade entrar. `src/lib/offline/**` concentra **640 dos 1278 erros** (nenhum aviso), quase metade do total. A estratégia é zerar só essa pasta e travar — o resto fica para depois.

Não existe `.github/workflows/` neste repositório: "travar no CI" aqui significa criar o CI pela primeira vez. O script `check:offline` também não existe no `package.json` — esta tarefa cria os dois.

Uma tentativa de isolar a checagem com um `tsconfig.offline.json` próprio (`include: ["src/lib/offline/**/*.js"]`) foi testada e **descartada**: rodar `svelte-check` com esse tsconfig restrito produz **872 erros**, não 640, incluindo classes que nem aparecem no check real (`Cannot find name 'global'`, `mockResolvedValue` inexistente) — o `include` restrito perde contexto ambiente que o `tsconfig.json` do projeto fornece. A abordagem correta, verificada nesta investigação, é rodar o **mesmo** `svelte-check --tsconfig ./tsconfig.json` que `npm run check` já usa, em modo `--output machine`, e filtrar a saída por prefixo de caminho — isso reproduz exatamente os 640.

Os erros não se resolvem arquivo por arquivo: uma única causa-raiz explica **287 dos 640** (quase metade). `src/lib/offline/utils/OfflineLogger.js:150` declara `createLogger` com `@returns {Object}` — tipo genérico demais, então toda chamada `logger.info/warn/debug/error(...)` em qualquer um dos ~19 módulos que importam esse logger vira "Property 'X' does not exist on type 'Object'". Corrigir o JSDoc de retorno de uma função, num arquivo, elimina quase metade dos erros da pasta inteira. Isso é a prova do porquê "corrigir por classe, não por arquivo" importa: corrigir arquivo por arquivo levaria a repetir a mesma correção umas 19 vezes espalhadas; corrigir a causa raiz resolve todas de uma vez. Sucesso é `check:offline` saindo com código 0, o CI rodando de verdade em `push`/`pull_request`, e nenhuma correção tê-la sido feita "porque sim" — cada padrão anotado com sua contagem antes/depois.

**Files:**
- Create: `scripts/checkOfflineGate.mjs`
- Create: `.github/workflows/ci.yml`
- Modify: `package.json` (script `check:offline`, devDependency `@types/node`)
- Modify: `src/lib/offline/utils/OfflineLogger.js`
- Modify: arquivos em `src/lib/offline/**` conforme cada padrão apontar (lista de arquivos e contagens fica registrada a cada passo)

**Interfaces:**
- Consumes: `svelte-check --tsconfig ./tsconfig.json --output machine` (binário já é devDependency do projeto).
- Produces: script `npm run check:offline` (sai com código 0 quando `src/lib/offline/**` está limpo, 1 caso contrário); `.github/workflows/ci.yml` rodando em `push` e `pull_request`.

- [ ] **Step 1: Medir a linha de base de hoje**

Esta tarefa roda depois das Fases 1-4 do plano, que tocam bastante código dentro de `src/lib/offline/**` — a contagem pode ter mudado. Rode a medição de novo antes de confiar em qualquer número deste texto:

```bash
npx svelte-check --tsconfig ./tsconfig.json --output machine 2>&1 \
  | grep -cE '^[0-9]+ (ERROR|WARNING) "src/lib/offline/'
```

Esperado hoje: `640`. Anote o número real obtido — é a meta a levar a zero nesta execução, substituindo qualquer contagem citada abaixo que não bater.

- [ ] **Step 2: Instalar `@types/node`**

Doze dos 640 erros de hoje são `Cannot find module 'node:test'` / `'node:assert/strict'` (seis cada) em arquivos de teste — o projeto não tem `@types/node`, então os módulos embutidos do Node não resolvem para o compilador de tipos:

```bash
npm install --save-dev @types/node
```

```bash
npx svelte-check --tsconfig ./tsconfig.json --output machine 2>&1 \
  | grep -cE '^[0-9]+ (ERROR|WARNING) "src/lib/offline/.*Cannot find module .node:'
```

Esperado: `0` (eram 12). Isso não muda nenhum runtime — `@types/node` é só declaração de tipos, `node --test` continua sendo o executor real dos testes.

- [ ] **Step 3: Corrigir o tipo de retorno de `createLogger` — a causa raiz de quase metade dos erros**

`src/lib/offline/utils/OfflineLogger.js:145-157` hoje:

```js
/**
 * Create a logger instance for a specific module
 * @param {string} moduleName - Name of the module
 * @returns {Object} Logger instance with bound methods
 */
export function createLogger(moduleName) {
  return {
    error: (message, err) => error(moduleName, message, err),
    warn: (message, data) => warn(moduleName, message, data),
    info: (message, data) => info(moduleName, message, data),
    debug: (message, data, metrics) => debug(moduleName, message, data, metrics)
  };
}
```

`@returns {Object}` é o problema: é um tipo real de TypeScript (o objeto `Object` global), sem nenhuma das quatro chaves. Trocar por um `@typedef` nomeado:

```js
/**
 * @typedef {Object} OfflineLoggerInstance
 * @property {(message: string, err?: unknown) => void} error
 * @property {(message: string, data?: unknown) => void} warn
 * @property {(message: string, data?: unknown) => void} info
 * @property {(message: string, data?: unknown, metrics?: Record<string, unknown> | null) => void} debug
 */

/**
 * Create a logger instance for a specific module
 * @param {string} moduleName - Name of the module
 * @returns {OfflineLoggerInstance} Logger instance with bound methods
 */
export function createLogger(moduleName) {
  return {
    error: (message, err) => error(moduleName, message, err),
    warn: (message, data) => warn(moduleName, message, data),
    info: (message, data) => info(moduleName, message, data),
    debug: (message, data, metrics) => debug(moduleName, message, data, metrics)
  };
}
```

```bash
npx svelte-check --tsconfig ./tsconfig.json --output machine 2>&1 \
  | grep -cE '^[0-9]+ (ERROR|WARNING) "src/lib/offline/.*does not exist on type .Object.'
```

Esperado: `0` (eram 293, incluindo os 4 que não eram do logger — confira se sobrou algum residual fora dos ~19 arquivos que chamam `logger.*`; se sobrar, é `OfflineLogger.js` mesmo, que ainda tem outros erros próprios tratados no Step 5).

- [ ] **Step 4: Medir o que sobrou e registrar por classe**

```bash
npx svelte-check --tsconfig ./tsconfig.json --output machine 2>&1 \
  | grep -E '^[0-9]+ (ERROR|WARNING) "src/lib/offline/' \
  | sed -E 's/^[0-9]+ (ERROR|WARNING) "[^"]+" [0-9]+:[0-9]+ "//; s/'"'"'[^'"'"']*'"'"'/X/g' \
  | sort | uniq -c | sort -rn
```

Registre a saída num comentário do commit final (Step 10) ou num arquivo local de trabalho — ela é o mapa de quanto falta em cada padrão dos Steps 5-8.

- [ ] **Step 5: Padrão — `catch (error)` acessando `.message`/`.name` sem narrowing**

`error` capturado por `catch` é `unknown` sob `strict: true`. Exemplo real, `src/lib/offline/download/PackageDownloader.js:124-129`:

```js
    } catch (error) {
      if (error.name === 'AbortError' || abortSignal?.aborted) {
        throw new Error('DOWNLOAD_CANCELLED');
      }
      logger.error('PackageDownloader', `Error downloading package: ${fullUrl}`, error);
```

Corrigido:

```js
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      if (isAbort || abortSignal?.aborted) {
        throw new Error('DOWNLOAD_CANCELLED');
      }
      logger.error('PackageDownloader', `Error downloading package: ${fullUrl}`, error);
```

Aplique o mesmo narrowing (`error instanceof Error` quando o acesso é a `.message`, `error instanceof DOMException` quando é a `.name` de abort) em cada ocorrência que a busca abaixo listar:

```bash
npx svelte-check --tsconfig ./tsconfig.json --output machine 2>&1 \
  | grep -E '^[0-9]+ (ERROR|WARNING) "src/lib/offline/.*is of type .unknown.'
```

Esperado ao final: `0` (eram 40).

- [ ] **Step 6: Padrão — parâmetro e variável implicitamente `any`**

Acrescentar JSDoc à assinatura resolve os dois casos. Exemplo real, os parâmetros de `formatMessage` em `OfflineLogger.js:44` já têm JSDoc — o problema típico é assinatura sem JSDoc nenhum, como em módulos de `src/lib/offline/storage/` e `src/lib/offline/download/`. Padrão:

```js
/**
 * @param {string} pdfPath
 * @param {{ useIndex?: boolean, checkNetwork?: boolean, pdfId?: string | null }} [options]
 * @returns {Promise<{ available: boolean, needsDownload: boolean, url: string | null, source: string }>}
 */
async function validate(pdfPath, options = {}) {
```

Para variáveis (não parâmetros) implicitamente `any` — majoritariamente em `src/lib/offline/download/partProgress.test.js` (29 das 33 do projeto) — anote no ponto de declaração:

```js
/** @type {Array<{ name: string, bytes: number }>} */
const parts = [];
```

```bash
npx svelte-check --tsconfig ./tsconfig.json --output machine 2>&1 \
  | grep -cE '^[0-9]+ (ERROR|WARNING) "src/lib/offline/.*implicitly has an .any. type'
```

Esperado ao final: `0` (eram 48 de parâmetro + 33 de variável = 81).

- [ ] **Step 7: Padrão — genérico sem argumento de tipo e literal vazio inferido como `never`**

Dois sub-padrões que a mesma técnica resolve — anotar o tipo explicitamente em vez de deixar o TypeScript inferir do literal.

`Array` sem parâmetro de tipo, `src/lib/offline/manifest/ManifestRepository.js:22`:

```js
  /**
   * Get louvores manifest
   * @param {boolean} [useCache=true] - Use cache if available
   * @returns {Promise<Array>} Louvores manifest array
   */
```

Corrigido — `Array` sozinho não é um tipo completo, precisa do argumento:

```js
  /**
   * Get louvores manifest
   * @param {boolean} [useCache=true] - Use cache if available
   * @returns {Promise<Array<Object>>} Louvores manifest array
   */
```

Array literal vazio inferido como `never[]`, `src/lib/offline/storage/CacheMigrationV2.js:100` (a função já tem um `@typedef` com `@property {string[]} errorDetails` em outro ponto do arquivo, mas o literal de retorno não está amarrado a ele):

```js
    const result = {
      migrated: 0,
      skipped: 0,
      errors: 0,
      errorDetails: []
```

Corrigido:

```js
    /** @type {{ migrated: number, skipped: number, errors: number, errorDetails: string[] }} */
    const result = {
      migrated: 0,
      skipped: 0,
      errors: 0,
      errorDetails: []
```

```bash
npx svelte-check --tsconfig ./tsconfig.json --output machine 2>&1 \
  | grep -cE '^[0-9]+ (ERROR|WARNING) "src/lib/offline/.*(requires 1 type argument|is not assignable to parameter of type .never.)'
```

Esperado ao final: `0` (eram 16 de genérico + parte dos "Argument of type... not assignable" que vinham de `never[]`).

- [ ] **Step 8: Corrigir o bug real que o Step 3 expôs**

Ao corrigir o Step 3, o compilador passa a enxergar `this.remove(...)` como uma chamada a um método inexistente — `ManifestCache` só declara `_remove`, não `remove`. `src/lib/offline/manifest/ManifestCache.js:48` e `:165`:

```js
        this.remove(type);
```

O método real, linha 122:

```js
  _remove(type) {
```

Esse `this.remove(...)` sempre lançou `TypeError: this.remove is not a function` em runtime sempre que o cache expirava — nenhum teste cobre esse caminho, por isso passou despercebido. Corrija as duas chamadas para `this._remove(type)`. `src/lib/offline/manifest/ManifestRepository.js:127` tem a mesma chamada errada por delegação — corrija também.

```bash
grep -rn "\.remove(" src/lib/offline/manifest/
```

Esperado: nenhuma ocorrência de `.remove(` que não seja `._remove(` ou a declaração do método.

- [ ] **Step 9: Arquivos de teste — decidir e converter, não excluir**

173 dos 640 erros de hoje vivem em arquivos `*.test.js` dentro de `src/lib/offline/**`. Excluir `*.test.js` do `check:offline` (via `exclude` no filtro) tornaria a checagem cega exatamente na superfície nova que as Fases 1-4 deste plano criam de propósito — o ponto de existir o CI é pegar tipo errado em código novo, e teste é código. **Decisão: os arquivos de teste entram no mesmo gate, sem exceção**, corrigidos com os mesmos padrões dos Steps 5-7, mais um específico deles:

`src/lib/offline/utils/PdfPathManager.test.js` usa `describe`/`test`/`expect` como globais soltos, sem importar nenhum executor — é o maior bloco de "Cannot find name" da pasta (39 dos 48 hoje) e, coerente com o achado #24 do inventário, **nunca rodou** sob `npm test` até hoje. Início do arquivo:

```js
import PdfPathManager from './PdfPathManager.js';

describe('PdfPathManager', () => {
  describe('normalizeForStorage', () => {
    test('preserves case and accents', () => {
      const path = 'assets/Cifra nível I/arquivo.pdf';
      const normalized = PdfPathManager.normalizeForStorage(path);
      expect(normalized).toBe('assets/Cifra nível I/arquivo.pdf');
    });
```

Corrigido — `node:test` expõe `describe`/`it`/`test`; `expect(x).toBe(y)` vira `assert.equal(x, y)`:

```js
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import PdfPathManager from './PdfPathManager.js';

describe('PdfPathManager', () => {
  describe('normalizeForStorage', () => {
    test('preserves case and accents', () => {
      const path = 'assets/Cifra nível I/arquivo.pdf';
      const normalized = PdfPathManager.normalizeForStorage(path);
      assert.equal(normalized, 'assets/Cifra nível I/arquivo.pdf');
    });
```

Percorra o arquivo inteiro aplicando a mesma troca de `expect(x).toBe(y)`/`toEqual(y)` por `assert.equal(x, y)`/`assert.deepEqual(x, y)`, então acrescente-o à lista do script `"test"` em `package.json` — ele existe, passa a rodar, e passa a contar de verdade. `src/lib/offline/validation/PdfValidator.test.js` importa de `'vitest'` e usa `vi.fn()`/`mockResolvedValue`/`global` — mesma decisão (converter para `node:test` + `node:assert/strict`, dublês feitos à mão com closures no lugar de `vi.fn()`), mas é conversão de maior superfície: trate como sub-passo próprio se o tempo não fechar em 2-5 minutos, sem deixar o arquivo fora do gate.

```bash
node --test src/lib/offline/utils/PdfPathManager.test.js src/lib/offline/validation/PdfValidator.test.js
```

Esperado: todos os casos PASS.

- [ ] **Step 10: Confirmar zero e resolver qualquer resíduo com os mesmos três padrões**

```bash
npx svelte-check --tsconfig ./tsconfig.json --output machine 2>&1 \
  | grep -cE '^[0-9]+ (ERROR|WARNING) "src/lib/offline/'
```

Esperado: `0`. Se sobrar algum diagnóstico fora dos padrões dos Steps 5-7 (por exemplo `'X' is possibly 'undefined'` — 7 casos hoje, majoritariamente em `OfflineBundleImporter.rollback.test.js`), resolva com `?.`/checagem explícita de nulidade no ponto exato apontado pela mensagem — não existe quarto padrão além de "narrow o `unknown`/`undefined`", "anote o JSDoc que falta" e "amarre o literal ao tipo com `@type`"; todo erro que sobrar neste ponto se encaixa em um dos três.

- [ ] **Step 11: Criar o script `check:offline`**

Criar `scripts/checkOfflineGate.mjs`:

```js
#!/usr/bin/env node
/**
 * Portão de tipos para src/lib/offline/**.
 *
 * `npm run check` verifica o projeto inteiro e falha por causa de mais de mil
 * erros em áreas fora do escopo desta tarefa (#20) — uma checagem que nunca
 * passa equivale a não ter checagem. Este script roda o MESMO svelte-check
 * do projeto inteiro (mesmo tsconfig.json, sem tsconfig separado: testado em
 * 2026-08-31, um tsconfig com `include` restrito a src/lib/offline perde
 * contexto ambiente do projeto e troca 640 erros por 872, incluindo classes
 * que não existem no check real) e falha só se sobrar diagnóstico em
 * src/lib/offline/**.
 *
 * Ao zerar uma pasta nova, acrescente o prefixo dela em TARGET_PREFIXES.
 */
import { spawnSync } from 'node:child_process';

const TARGET_PREFIXES = ['src/lib/offline/'];

const result = spawnSync(
  'svelte-check',
  ['--tsconfig', './tsconfig.json', '--output', 'machine'],
  { encoding: 'utf8', shell: true, maxBuffer: 1024 * 1024 * 50 }
);

const lines = (result.stdout || '').split('\n');
const hits = lines.filter((line) => {
  const match = line.match(/^\d+ (ERROR|WARNING) "([^"]+)"/);
  if (!match) return false;
  return TARGET_PREFIXES.some((prefix) => match[2].startsWith(prefix));
});

if (hits.length > 0) {
  console.error(`check:offline encontrou ${hits.length} diagnóstico(s) em src/lib/offline/**:\n`);
  hits.forEach((line) => console.error(line));
  process.exit(1);
}

console.log('check:offline: 0 diagnósticos em src/lib/offline/**.');
process.exit(result.status ?? 0);
```

Em `package.json`, acrescentar ao objeto `"scripts"`:

```json
"check:offline": "svelte-kit sync && node scripts/checkOfflineGate.mjs"
```

- [ ] **Step 12: Rodar o script novo**

```bash
npm run check:offline
```

Esperado: `check:offline: 0 diagnósticos em src/lib/offline/**.` e código de saída `0`. Rode `echo $?` logo depois para confirmar.

- [ ] **Step 13: Criar o workflow de CI**

Este repositório não tem `.github/workflows/`. `.node-version` na raiz fixa `20` — é a versão que o `wrangler@^4.45.3` e o `@sveltejs/adapter-cloudflare@^4.3.1` deste projeto já rodam localmente, então o CI usa a mesma para não validar contra uma versão de Node que ninguém roda de verdade. Criar `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

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

- [ ] **Step 14: Commit**

```bash
git add scripts/checkOfflineGate.mjs .github/workflows/ci.yml package.json package-lock.json \
  src/lib/offline/
git commit -m "chore: zero svelte-check errors in src/lib/offline and gate it in a new CI"
```

---

### Task 23: Quebrar os arquivos que passam de 2.000 linhas (#23)

Hoje três arquivos passam de 2.000 linhas: `src/routes/offline/+page.svelte` (2.863), `src/lib/stores/offline.js` (2.828) e `src/routes/leitor/+page.svelte` (2.142). Mais dois passam de 1.000: `src/routes/listas/+page.svelte` (1.510) e `src/routes/biblioteca/+page.svelte` (1.253). Por **D-14**, esta tarefa corre **depois da Fase 2**: a unificação da normalização (#22, o achado de caminho de PDF, não o #20 de tipos) apaga oito estratégias de correspondência difusa que hoje vivem dentro de `offline.js` — parte do arquivo desaparece sozinha, e dividir antes seria dividir código que está prestes a sumir.

Por isso o primeiro passo desta tarefa não é dividir — é remedir e decidir o que ainda merece divisão depois que a Fase 2 já tirou o que ia tirar. O resto da tarefa só entra em cada arquivo que, remedido, ainda estiver grande. Cada divisão é extração de responsabilidade, não de camada técnica (não "todos os `handle*` num arquivo, todo o resto no outro") — cada extração leva o comportamento que já tem hoje, sem mudar o quê ele faz.

**Files:**
- Modify: `src/routes/offline/+page.svelte`, `src/lib/stores/offline.js`, `src/routes/leitor/+page.svelte` (e os novos módulos/componentes que a divisão criar)

**Interfaces:**
- Consumes: nada (comportamento existente).
- Produces: nada (nenhuma API nova; o objetivo é reorganizar, não estender).

- [ ] **Step 1: Remedir os três arquivos depois da Fase 2**

```bash
wc -l src/routes/offline/+page.svelte src/lib/stores/offline.js src/routes/leitor/+page.svelte \
  src/routes/listas/+page.svelte src/routes/biblioteca/+page.svelte
```

Compare com a linha de base desta tarefa (2.863 / 2.828 / 2.142 / 1.510 / 1.253). `offline.js` deve ter encolhido de forma visível — as oito estratégias difusas que a Fase 2 removeu viviam nas funções de normalização e correspondência de caminho do arquivo. Para cada arquivo que **continuar acima de 1.500 linhas**, siga os passos abaixo. Para o que cair abaixo, registre no commit final que ele saiu da lista e pare por aí — não invente divisão para um arquivo que já não precisa.

- [ ] **Step 2: Mapear as fronteiras de responsabilidade em `src/lib/stores/offline.js`**

Sem a Fase 2, o arquivo hoje se organiza em blocos reconhecíveis pela ordem das declarações de função (não há nenhum comentário de seção — `grep -n "^// ---"` no arquivo não encontra nada):

- **Persistência de categorias baixadas** (`getSavedCategories`/`saveCategories`/`getDownloadedCategories`/`saveDownloadedCategories`, ~linha 1135-1519, mais `verifyPdfInCacheStorage`/`isCategoryCompletelyDownloaded`/`getCompletelyDownloadedCategories`/`checkForNewPDFs`) — lê e escreve o estado "o que já foi baixado" em `localStorage`/Cache Storage.
- **Orquestração de download** (`startDownload`/`startZipDownload`/`startZipDownloadWithSpecificParts`/`downloadByCategories`/`cancelDownload`/`clearAllCache`, ~linha 787-1135 e 1698-2414) — a maior fatia; só `startZipDownloadWithSpecificParts` sozinha tem ~350 linhas.
- **Estatísticas e disponibilidade** (`getCategoryAvailabilityStats`/`getRequiredPackagesInfo`/`clearStatsCalculationCache`, ~linha 1625-1698) — cálculo, não faz rede nem grava nada.
- **API pública do store e estado de UI** (`showOfflineModal`/`hideOfflineModal`/`enableOffline`/`clearError`/`updateOfflineState`, o objeto `offline` exportado e os `derived`, ~linha 2414 até o fim) — fica em `offline.js`; é o que o resto do app importa.

A fronteira certa é essa: persistência, orquestração de download e cálculo de estatísticas são três motivos diferentes para o arquivo mudar (mudar como se grava o que foi baixado não tem nada a ver com mudar como se calcula uma estatística), e é exatamente por isso que crescem juntos hoje sem nenhuma dependência forçada entre eles — cada bloco só depende de `getPdfRelPath`/`getConfig`/`louvores`, nunca um do outro. Depois da remedição do Step 1, confirme que essa divisão ainda bate com as linhas reais (a Fase 2 pode ter deslocado tudo) antes de extrair.

- [ ] **Step 3: Extrair persistência de categorias baixadas**

Criar `src/lib/stores/offlineDownloadedCategories.js` com `getSavedCategories`, `saveCategories`, `getDownloadedCategories`, `saveDownloadedCategories`, `verifyPdfInCacheStorage`, `isCategoryCompletelyDownloaded`, `getCompletelyDownloadedCategories`, `checkForNewPDFs` — mova o corpo de cada função tal como está hoje, sem reescrever lógica. `offline.js` importa essas funções de volta:

```js
import {
  getSavedCategories,
  saveCategories,
  getDownloadedCategories,
  saveDownloadedCategories,
  verifyPdfInCacheStorage,
  isCategoryCompletelyDownloaded,
  getCompletelyDownloadedCategories,
  checkForNewPDFs
} from './offlineDownloadedCategories.js';
```

Ajuste os imports internos do novo arquivo (`$lib/utils/pathUtils`, `safeStorage`/`safeSetItem` de `offline.js`, etc.) para caminho relativo correto a partir do novo local.

- [ ] **Step 4: Extrair estatísticas**

Criar `src/lib/stores/offlineStats.js` com `getCategoryAvailabilityStats`, `getRequiredPackagesInfo`, `clearStatsCalculationCache`. Mesma regra: mover o corpo tal como está, `offline.js` importa de volta.

- [ ] **Step 5: Provar que nada mudou de comportamento**

```bash
npm test
```

Esperado: `131 tests, 28 suites, 0 fail` — o mesmo resultado de antes da extração (nenhum teste existente cobre `offline.js` diretamente por trás de mocks de módulo, então um `fail` aqui indica um import quebrado pela extração, não um teste que passou a falhar por lógica).

```bash
npm run build
```

Esperado: build conclui sem erro. Um import relativo errado entre `offline.js` e os dois módulos novos aparece aqui como erro de resolução de módulo do Vite, antes de chegar a produção.

- [ ] **Step 6: Verificação em navegador — `/offline`**

Suba o app (`npm run dev`), abra `/offline`, e execute o fluxo que toca as três fronteiras extraídas: marcar uma categoria para baixar, iniciar o download, deixar completar, fechar e reabrir a página (a categoria continua marcada como baixada — prova a persistência), e clicar em "atualizar estatísticas" (prova o cálculo). Nenhuma mudança de comportamento visível é o critério de sucesso; qualquer erro no console do navegador durante esse fluxo é uma extração que quebrou uma referência.

- [ ] **Step 7: Mapear as fronteiras de responsabilidade em `src/routes/offline/+page.svelte`**

O arquivo é `<script>` (linhas 1-1349) + marcação (1349-1770) + `<style>` (1770-2862, sozinho maior que a marcação e o script somados de muitos componentes do projeto). As funções do `<script>` já caem nos mesmos três grupos temáticos da marcação (a marcação tem os comentários `<!-- Migration progress -->`, `<!-- Download / import progress -->`, `<!-- Stats -->`, `<!-- Error Modal -->` nas linhas 1359/1400/1483/1762 do arquivo):

- **Sincronização e migração de cache** (`checkOfflineAvailable`/`setOfflineAvailable`/`handleCacheSyncRequired`/`checkSyncOnFocus`/`handleOfflineCacheUpdated`/`forceSync`/`runMigration`) → seção "Migration progress/result".
- **Estatísticas por categoria** (`setupLazyLoading`/`processStatsInChunks`/`scheduleIdleLoading`/`loadCategoryStatsForCategories`/`loadCategoryStats`/`openCachedStats`/`formatSize`) → seção "Stats".
- **Download e importação** (`toggleCategory`/`startDownload`/`cancelDownload`/`handleBundleFileSelected`/`triggerBundleFilePicker`/`downloadAllCategories`/`handleDownloadMissingPdfs`/`closeErrorModal`/`clearAllCache`) → seções "Download / import progress" e "Error Modal".

A fronteira certa aqui é por componente Svelte, não por arquivo `.js` solto: cada grupo já é uma seção de UI própria na marcação, com seu próprio bloco de `<style>` escopado (extrair só o `<script>` e deixar o CSS para trás quebraria o escopo do Svelte — o `<style>` de 1.092 linhas só se divide junto com a marcação e o script que ele estiliza). Proponha três subcomponentes: `OfflineMigrationPanel.svelte`, `OfflineStatsPanel.svelte`, `OfflineDownloadPanel.svelte`, cada um recebendo como prop o que hoje é variável reativa da página (`migrationResult`, `categoryStats`, `downloadState`, etc.) e emitindo eventos para as ações que hoje são chamadas de função direta (`on:startDownload`, `on:forceSync`).

- [ ] **Step 8: Extrair `OfflineMigrationPanel.svelte`**

Criar `src/lib/components/OfflineMigrationPanel.svelte` movendo a marcação de "Migration progress"/"Migration result" (hoje linhas ~1357-1400 de `+page.svelte`) e as funções `checkOfflineAvailable`, `setOfflineAvailable`, `handleCacheSyncRequired`, `checkSyncOnFocus`, `handleOfflineCacheUpdated`, `forceSync`, `runMigration`, junto com o bloco de `<style>` correspondente às classes `.migration-*` usadas nessa marcação. `src/routes/offline/+page.svelte` importa e usa:

```svelte
<OfflineMigrationPanel {migrationResult} {isSyncing} on:forceSync={forceSync} on:runMigration={runMigration} />
```

- [ ] **Step 9: Extrair `OfflineStatsPanel.svelte`**

Mesma técnica para a seção "Stats" (categorias, disponibilidade, barra de progresso por categoria, pacotes necessários) e as funções listadas no Step 7.

- [ ] **Step 10: Extrair `OfflineDownloadPanel.svelte`**

Mesma técnica para "Download / import progress" e "Error Modal".

- [ ] **Step 11: Provar que nada mudou de comportamento**

```bash
npm test && npm run build
```

Esperado: mesmo resultado do Step 5 (131/28/0 fail; build conclui). Um `<slot>`/prop esquecido entre `+page.svelte` e os três componentes novos aparece como erro de compilação do Svelte no build, não silenciosamente.

- [ ] **Step 12: Verificação em navegador — `/offline` pós-divisão**

Repita o fluxo do Step 6 inteiro (agora contra os três componentes extraídos) e adicione: abrir o modal de erro (force um erro de download, ex. desconectando a rede no meio de um download) e confirmar que ele fecha e reabre igual a antes.

- [ ] **Step 13: Mapear a fronteira de responsabilidade em `src/routes/leitor/+page.svelte`**

O `<script lang="ts">` vai de 1 a 1379 — a maior parte do arquivo. Dentro dele, um grupo de funções tem uma fronteira de entrada/saída limpa e nenhuma dependência do resto do estado da página além de callbacks explícitos: o tratamento de toque, linhas ~894-1195 (~300 linhas) — `getTouchDistance`, `trySwipePageTurn`, `startPinch`, `movePinch`, `applyPinchPreview`, `commitPinch`, `onTouchStart`, `onTouchMove`, `onTouchEnd`. O projeto já tem o precedente exato para esse tipo de extração: `src/lib/components/gestures/TapStrategy.js` já isola uma estratégia de gesto do componente que a usa. A fronteira certa é a mesma — extrair o pinch/swipe como uma factory que recebe os callbacks que hoje são closures sobre variáveis do componente (`zoomIn`, `zoomOut`, `nextPage`, `prevPage`, o estado de zoom atual) e devolve os três handlers `onTouchStart`/`onTouchMove`/`onTouchEnd` para o `<script>` conectar aos eventos DOM.

Não proponha dividir o restante do `<script>` (carregamento de PDF, atalhos de teclado, toolbar) nesta tarefa: `onKeyDown` sozinho tem ~294 linhas mas é uma máquina de estados de um único evento, não um conjunto de responsabilidades separáveis — dividi-la exigiria decisão de design (qual subconjunto de teclas vai para onde) que esta tarefa de refatoração pura não deve tomar por conta própria.

- [ ] **Step 14: Extrair o tratamento de toque/pinch**

Criar `src/lib/utils/pdfTouchGestures.js` com uma função `createPdfTouchGestureHandlers({ onSwipeNext, onSwipePrev, onPinchZoom, getCurrentZoom })` que recria `getTouchDistance`, `trySwipePageTurn`, `startPinch`, `movePinch`, `applyPinchPreview`, `commitPinch` como funções internas do closure, devolvendo `{ onTouchStart, onTouchMove, onTouchEnd }`. Mova o corpo de cada função tal como está hoje. `src/routes/leitor/+page.svelte` passa a ter:

```ts
const touchHandlers = createPdfTouchGestureHandlers({
  onSwipeNext: nextPage,
  onSwipePrev: prevPage,
  onPinchZoom: (scale) => { /* corpo que hoje está em commitPinch */ },
  getCurrentZoom: () => currentZoom
});
```

e o template troca `on:touchstart={onTouchStart}` etc. pelos equivalentes de `touchHandlers`.

- [ ] **Step 15: Provar que nada mudou de comportamento**

```bash
npm test && npm run build
```

Esperado: mesmo resultado dos Steps 5/11.

- [ ] **Step 16: Verificação em navegador — `/leitor`**

Abra um PDF em `/leitor` num dispositivo (ou emulação de touch no DevTools) e confirme: swipe para a página seguinte/anterior funciona, pinch-to-zoom aplica e faz commit do zoom igual a antes, e o zoom por botão (`zoomIn`/`zoomOut`, não tocado por esta extração) continua funcionando — prova que a extração não vazou estado para fora do closure.

- [ ] **Step 17: Registrar o que ficou de fora**

`src/routes/listas/+page.svelte` (1.510 linhas) e `src/routes/biblioteca/+page.svelte` (1.253 linhas) ficam **fora do escopo** desta tarefa — o achado #23 fala em arquivos acima de 2.000 linhas; os dois entre 1.000 e 2.000 não justificam o mesmo tratamento sem uma decisão própria de fronteira, que não foi tomada aqui. Anote isso no commit para que não pareçam esquecidos.

- [ ] **Step 18: Commit**

```bash
git add src/lib/stores/offline.js src/lib/stores/offlineDownloadedCategories.js src/lib/stores/offlineStats.js \
  src/routes/offline/+page.svelte src/lib/components/OfflineMigrationPanel.svelte \
  src/lib/components/OfflineStatsPanel.svelte src/lib/components/OfflineDownloadPanel.svelte \
  src/routes/leitor/+page.svelte src/lib/utils/pdfTouchGestures.js
git commit -m "refactor: split offline.js and the two 2000+ line pages by responsibility"
```

---

## Verificação final do plano

### Cobertura da auditoria

Cada achado aberto, e onde ele é fechado. Um achado sem tarefa é um buraco no plano; um achado que a execução dissolveu está marcado como tal.

| Achado | Onde é fechado | Observação |
|---|---|---|
| #16 `content-visibility` | Tarefa 21 | Pode terminar descartado com número medido — as listas já paginam em 50 |
| #18 cópia do pdf.js | Tarefa 20 | 3,1 MB → ~124 KB; o SW novo já tinha tirado o custo de cache do usuário |
| #20 verificação de tipos | Tarefa 22 | Só `src/lib/offline/**` (640 dos 1278), e cria o CI que não existia |
| #21 sincronização URL ↔ estado | Tarefas 4, 10, 11, 12 | A 4 é contenção; a 10 é independente; 11 e 12 são a reescrita |
| #22 normalização de caminho | Tarefas 5, 6, 7, 8, 9 | Ordem obrigatória; `normalizeForStorage` vence |
| #23 arquivos de 2.000+ linhas | Tarefa 23 | Começa remedindo, depois da Fase 2 |
| #24 testes | Tarefas 1, 2, 3 | 6 testes mortos + dois contratos executáveis novos |
| #27 estados vazios | Tarefa 13 | Quatro estados, não três — a verificação achou um a mais |
| #28 skeleton | Tarefa 14 | Componente compartilhado entre home e biblioteca |
| #29 descoberta do offline | Tarefa 16 | **Achado dissolvido:** a porta já existe em `+layout.svelte:150-236`. Sobra apagar o detector de gestos órfão |
| #30 controle de brilho | Tarefa 15 | Filtro CSS; nenhuma API web dá acesso ao brilho físico |
| #33 aposentar v2/120826 | — | **Fora de escopo por decisão do dono** |
| `<button>` aninhado na paginação | Tarefa 17 | Já corrigido no componente compartilhado; a biblioteca só não o usa |
| `migrateLegacyValidationKeys` | Tarefa 19 | Grava antes de apagar |
| `iterateZipEntriesCd` | Tarefa 19 | Filtra antes de inflar |
| `isDevelopmentAsset()` | — | **Já resolvido** pela reescrita do service worker |
| `statechange` sem remoção | Tarefa 18 | |
| `+layout.svelte` cleanup assíncrono | Tarefa 18 | |
| `handleClearCache` e o staging | Tarefa 18 | |
| `localStorage` cru em `offline.js` | Tarefa 18 | |
| `looksLikeCaptivePortal` | Tarefa 18 | |
| `getPartPdfPaths` | Tarefa 18 | Vira módulo puro e testável |
| `npm run check:offline` inexistente | Tarefa 22 | O script passa a existir |

### Achados que só apareceram durante o planejamento

Nenhum deles estava na auditoria. Todos foram verificados por leitura ou execução do código real, e todos já têm tarefa:

| O que | Onde | Tarefa |
|---|---|---|
| `ManifestCache.js:48,165` chamam `this.remove()`; o método é `_remove` — `TypeError` garantido, sempre foi | `src/lib/offline/cache/ManifestCache.js` | 22 |
| `onMount` `async` devolve cleanup que o Svelte descarta: `clearTimeout` e `removeEventListener` nunca rodam | `+page.svelte:193`, `biblioteca:589` | 11, 12 |
| `NetworkValidator.js:43` usa `urlNormalizer` sem importar — `ReferenceError` no ramo offline | `src/lib/offline/validation/NetworkValidator.js` | 9 |
| `encodeURI` e o parser `URL` divergem em `[`/`]`: 3 PDFs reais cuja chave gravada nunca casa com a pedida | três construtores de URL | 5 |
| 40 de 652 PDFs em cache não são encontrados por `endsWith`/`includes`, e o app manda baixá-los de novo | `offline.js:1334-1354`, `:1495` | 8 |
| `sharename` com `%` lança `URIError` e a lista compartilhada não é salva | `+page.svelte:277` | 10 |
| `unregisterServiceWorker` sem nenhum chamador | `swRegistration.js:112-126` | 19 |
| Três imports mortos de `urlNormalizer` | `CacheMigration.js`, `StatsCalculator.js`, `PackageDownloader.js` | 9 |
| `static/pdfjs/` é versionado (32 arquivos), não ignorado — enxugar exige `git add`, não só mexer no disco | `static/pdfjs/` | 20 |
| `runMigration` em `offline/+page.svelte:562` não é chamada de lugar nenhum | `src/routes/offline/+page.svelte` | 9 |

### Ordem de execução

Fases 0 e 1 primeiro, sempre. Depois disso:

- **Fase 2 (#22)** é internamente sequencial: 5 → 6 → 7 → 8 → 9. Nenhuma pode pular a anterior.
- **Fase 3 (#21)**: a 10 é independente e pode ir a qualquer momento depois da Fase 0. A 11 antes da 12.
- **Fase 4**: 13, 14, 15 e 16 são independentes entre si e das outras fases. A 17 vai depois da 12 (K-6).
- **Fase 5**: 18, 19, 20 e 21 são independentes. A 18 antes da 23 (K-8).
- **Fase 6**: a 22 a qualquer momento; a 23 só depois da Fase 2 inteira (K-9, D-14).

As Fases 2 e 3 podem correr em paralelo em branches separadas — elas não compartilham arquivo, com uma exceção: a Tarefa 9 remove ~177 linhas de `src/routes/offline/+page.svelte`, que nenhuma tarefa da Fase 3 toca. Verifique com `git diff --stat` antes de integrar.

### Quando o plano está pronto

- `npm test` verde, com **todos** os `*.test.js` do repositório rodando — não uma lista mantida à mão.
- `npm run check:offline` sai com código 0, e o CI o exige.
- `npm run build` conclui.
- O contrato de URL da Tarefa 3 verde, com as asserções migradas e nenhuma apagada.
- Uma normalização de caminho só no cliente, e `git grep normalizePdfUrl` sem resultado.
- Verificação em navegador dos três cenários que teste nenhum cobre: um PDF baixado antes do plano continua abrindo offline; um link de playlist gerado antes do plano continua importando; `/biblioteca` com os sete parâmetros simultâneos restaura o estado inteiro depois de um F5.

---

## Pendência manual, fora do plano

**Secret `LOUVORES_MANIFEST_CHECKSUM` preso no ambiente de Preview.**

Ele é inerte hoje: nenhum código deste repositório lê `platform.env.LOUVORES_MANIFEST_CHECKSUM` — `grep -rn "LOUVORES_MANIFEST_CHECKSUM" src/` só encontra o nome em comentários e no símbolo, sem relação, `LOUVORES_MANIFEST_CHECKSUM_URL` (que é uma rota HTTP, `/louvores-manifest.sha256`, não a env var). O checksum real é lido de um objeto no R2 por `src/routes/louvores-manifest.sha256/+server.js:34-36` (`bucket.get('louvores-manifest.sha256')`), cujo próprio comentário de topo (linhas 7-12) documenta a troca: a env var nunca funcionou porque `wrangler.toml` é a fonte da verdade para env vars de Pages e desfazia, a cada deploy, o que a app admin gravava nela via API — por isso o checksum passou a viver como objeto no R2, ao lado do manifest, publicado pela mesma operação que publica o manifest. `wrangler.toml:31` já registra, em comentário, para nunca reintroduzi-la.

`wrangler pages secret delete LOUVORES_MANIFEST_CHECKSUM --project-name plpcjf --environment preview` falha com erro `10053` (`Binding name already in use`) — o mesmo tipo de erro documentado no repositório `plpcg-admin` ao migrar variável para secret, aqui na direção de remoção: a Cloudflare recusa a mutação enquanto uma *var* de mesmo nome ainda existir associada ao projeto publicado, e não há comando de `wrangler` que contorne isso.

Caminho no painel para remover à mão:

1. Painel da Cloudflare → **Workers & Pages**.
2. Selecione o projeto **plpcjf**.
3. Aba **Settings** → seção **Environment variables**.
4. Troque o seletor de ambiente para **Preview** (nunca existiu em Production — só ficou presa em Preview).
5. Localize `LOUVORES_MANIFEST_CHECKSUM` e clique no ícone de remover ao lado dela.
6. Clique em **Save**.

Não é passo de execução deste plano — é lembrete para quando alguém abrir o painel por outro motivo.
