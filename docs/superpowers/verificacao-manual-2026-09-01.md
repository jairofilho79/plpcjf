# Verificação manual — o que os testes automatizados não alcançam

**Branch:** `feat/urls-caminhos-e-o-resto` · **Data:** 2026-09-01 · 45 commits, 315 testes automatizados

Este documento existe porque uma parte da verificação deste trabalho **não cabe em teste unitário**.
`node --test` não monta componente Svelte, não tem Cache Storage, não tem service worker e não tem
navegação real. Durante a execução, **quatro bugs reais deste plano passaram pela revisão de código
e só apareceram em navegador** — inclusive um que quebrava a navegação da home para a biblioteca.
As linhas abaixo são a memória disso.

Cada linha diz o resultado **esperado**. Uma linha que falhar é um defeito, não uma dúvida.

---

## 1. URL e compartilhamento — o que só se prova navegando

Estas foram registradas quando o contrato de URL foi congelado, e descrevem o comportamento que a
Fase 3 tinha de preservar ou corrigir de propósito.

| # | Caso | Passo a passo | Resultado esperado hoje |
|---|---|---|---|
| M-C1 | Importar uma lista compartilhada | Gere um link em /listas, abra numa aba nova | Carrossel com os louvores na ordem dada; lista salva em /listas; a URL volta a / |
| M-C2 | Link aberto antes de o manifesto carregar | Abra o link com a rede em Slow 3G | Nada acontece até a lista de louvores existir; então importa. Nunca perder o link por chegar cedo |
| M-C4 | Id inexistente no meio | Edite o link trocando um id por naoexiste | Carrossel só com os válidos; a lista salva guarda o id fantasma |
| M-C9 | ?sharepdfs= vazio | Abra /?sharepdfs=&sharename=x | A URL fica suja e o bloco reativo reavalia a cada mudança de página |
| M-C10 | ?sharepdfs=,,, | Abra /?sharepdfs=,,, | Nada importado e a URL fica suja para sempre |
| M-C11 | Mesmo link três vezes | Abra o mesmo link 3x e vá a /listas | Três listas idênticas |
| M-C13 | Link com pesquisa junto | Abra /?sharepdfs=<id>&pesquisa=amor | pesquisa é descartado junto na limpeza da URL |
| M-C14 | Link aberto offline | DevTools -> Network -> Offline, cole o link | Importa normalmente (o consumo não faz rede) |
| M-F7 | /?materiais= vazio | Abra e olhe a lista | Zero resultados, sem aviso |
| M-F8 | /?arranjo= vazio | Abra e olhe a lista | Zero resultados: o auto-select-all não roda |
| M-P1 | /?pesquisa=amor&pagina=3 em aba fria | Feche o navegador, limpe o cache, abra o link | Corrida: página 3 em aba quente, página 1 em aba fria |
| M-P3 | /?pagina=3 sem busca | Abra | Clampa para 1 e remove pagina da URL |
| M-P10/P11 | itensPorPagina=7 | Abra /biblioteca?itensPorPagina=7 e depois /?itensPorPagina=7 | Assimetria: a biblioteca limpa o param, a home mantém |
| M-P16 | Vazamento entre rotas | Vá a /biblioteca?itensPorPagina=25 e navegue para / | A home grava itensPorPagina=25 na própria URL |
| M-L1 | /listas?viewId=<id válido> | Abra a visualização de uma lista salva | Abre a lista |
| M-L2/L3 | viewId inexistente ou vazio | Abra /listas?viewId=zzz | Volta à lista geral e apaga o param com replaceState |
| M-L4 | /listas?editId=<id> | Salve uma lista pelo carrossel | Entra em modo edição de nome e limpa toda a query |
| M-L5 | editId + viewId válido juntos | Monte a URL à mão | editId é descartado, viewId prevalece |
| M-L7 | viewId mandado para outro aparelho | Abra o link noutro navegador | Cai em M-L2. Correto, não "consertar" |
| M-R4 | Digitar e clicar em menos de 500 ms | Digite amor e clique num louvor imediatamente | O PDF tem de abrir; a URL do leitor não pode ganhar pesquisa |
| M-R6 | /leitor?file=... em modo standalone | Instale o PWA e abra um link de leitor por ele | O checkAndFixUrl repara a URL; o PDF abre |
| M-D3 | /?pesquisa=arranjo=x | Abra | includes('arranjo=') dá falso-positivo e a home mostra zero resultados |
| M-D7 | URL limpa vira ?arranjo=<5 valores> sozinha | Abra / e espere ~200 ms | A barra de endereços muda sozinha |
| M-D8 | Botão voltar depois de filtrar | Busque, pagine, filtre e aperte voltar | Sai do app — nada disso entra no histórico |

| M-L6 | `/listas?editId=<id inexistente>` | Monte a URL à mão | Nada acontece, mas a query é limpa mesmo assim |

> **M-L6 estava faltando na tabela original** — a investigação a documentava, o texto do plano pulou
> de L5 para L7. Registrada aqui para não se perder de novo.

**R4 — a única dos dez cenários da Fase 3 que não foi observada.** Digitar uma busca e clicar num
louvor em **menos de 500 ms**. O PDF tem de abrir e a URL do leitor **não** pode ganhar `pesquisa`.
A automação não conseguiu reproduzir a janela de tempo; a garantia central foi confirmada (o leitor
abre sem o parâmetro), mas a corrida específica não. A regra tem quatro testes unitários próprios.

---

## 2. Cobertura perdida ao apagar testes obsoletos

Ao ressuscitar a suíte, quatro arquivos de teste foram apagados por dependerem de runners que este
projeto não usa. Isto é o que deixou de ter cobertura automatizada:

| # | O que se perdeu | Como verificar à mão |
|---|---|---|
| M-6 | Estratégia índice-primeiro do `CompositeValidator` | Com índice válido, abrir um louvor baixado: não deve consultar o cache |
| M-7 | Queda para o cache quando o índice não está disponível | Apagar `localStorage.pdfAvailabilityIndex` e abrir um louvor baixado |
| M-8 | As três estratégias em ordem | Índice ausente e cache ausente: deve tentar a rede |
| M-9 | Ramificação offline/online | Modo avião: o validador não pode tentar rede |
| M-10 | Erro de `pdfId` ausente | Chamar sem `pdfId`: erro claro, não silêncio |

---

## 3. Pendências conhecidas — decididas, não esquecidas

Nenhuma bloqueia o uso da branch. As três que restam abaixo foram encontradas durante a execução e
deixadas de fora com razão registrada.

> Quatro destas pendências foram corrigidas em 2026-09-01 pelo plano
> `docs/superpowers/plans/2026-09-01-pendencias-conhecidas.md`: a checagem de
> cancelamento do download, o logger que descartava o objeto de erro, o painel
> `/offline` que não recalculava depois do download, e a página em branco da
> `/biblioteca`. As três que restam abaixo seguem decididas, não esquecidas.

| Onde | O quê | Por que ficou |
|---|---|---|
| `offline.js` | 20+ acessos crus a `localStorage` | Num navegador com armazenamento bloqueado (Firefox estrito, aba privada), a limpeza de dados pode lançar no meio e abortar em silêncio. Pré-existente |
| `normalizeForStorage` | Não é idempotente para nome de arquivo com percent-encoding aninhado | Nenhum caminho do acervo tem `%`. **Merece registro próprio:** se algum dia disparar, a migração NFC reescreve a chave **e apaga a original** — a forma exata de perda silenciosa que este plano existiu para eliminar |
| `/` × `/biblioteca` | `resultadosProntos` é flag travada numa página e derivação viva na outra; mesmo nome, semânticas diferentes | Sem comentário dizendo isso. É o mecanismo por trás de `?arranjo=` vazio deixar `?pagina=999` preso |

---

## 4. Como rodar com dados reais

Este projeto nunca foi trabalhado em modo dev: **não há dado em localhost**. Para verificar qualquer
coisa acima, proxie os dados de produção no `vite.config.js` — **temporariamente, sem commitar**:

```js
server: { proxy: {
  '/louvores-manifest.json':   { target: 'https://plpcg.com', changeOrigin: true },
  '/louvores-manifest.sha256': { target: 'https://plpcg.com', changeOrigin: true },
  '/offline-manifest.json':    { target: 'https://plpcg.com', changeOrigin: true },
  '/assets':                   { target: 'https://plpcg.com', changeOrigin: true },
  '/packages':                 { target: 'https://plpcg.com', changeOrigin: true }
} }
```

Use `preview.proxy` com a mesma forma para `npm run preview`. É tráfego **somente de leitura**.

**Teste contra build de produção** (`npm run build && npm run preview`), não contra o dev server: o
HMR do Vite já produziu falso positivo nesta classe de bug neste projeto, e o service worker se
comporta diferente.
