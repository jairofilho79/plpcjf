# Medição da varredura de estatísticas — a Task 3 da Fase 4

**Data:** 2026-09-02 · **Quem:** medição em navegador, Chrome, macOS
**Motivo:** a Fase 4 do plano `2026-09-02-divida-tecnica-em-fases.md` exigia medir
antes e depois, com a instrução explícita de **não inventar ganho**.

## Resultado, em uma linha

**A otimização da Fase 4 não produz ganho mensurável.** Antes 50,0 s, depois
49,8 s — 0,5%, dentro do ruído. A premissa de que as 95 reconstruções do índice
eram o custo dominante **está errada**, e a medição diz por quê.

## Protocolo

Sem isto os números não valem nada, e duas medições minhas foram invalidadas
antes de eu chegar a este protocolo.

1. **Origem limpa.** `localhost:4188`, não 4173 — o 4173 tinha um **service
   worker de outra aplicação** registado, que chegou a servir o shell dela e a
   derrubar o `vite preview`. Conferir `navigator.serviceWorker.getRegistrations()`
   antes de confiar em qualquer número.
2. **`npm run build && vite preview`**, nunca o dev server, com o proxy de
   produção do §4 de `verificacao-manual-2026-09-01.md`.
3. **Cache Storage semeado por script**, não por download: os 4630 caminhos reais
   do manifesto, corpos de 15 bytes. O custo da varredura é JS, não I/O, então a
   carga é fiel e semear leva 920 ms em vez de horas.
   Chave: `new Request(new URL(encodeURI('assets/' + atob(pdfId)), origin))`.
   O app reconhece-a: `[Offline Page] Loading stats with 4630 cached PDFs`.
4. **Estado derivado apagado antes de cada corrida**, mantendo o Cache Storage:
   `pdfAvailabilityIndex`, `cachedPdfsList`, `cachedPdfsListLocal`,
   `offlineStatsCache_v2`. **Sem este passo a segunda corrida herda o índice da
   primeira e mede outra coisa** — foi exatamente o erro que cometi.
5. Recarregar, clicar em "Clique aqui para atualizar", cronometrar até a capa
   "Dados em cache" descer.

## Os números

| Versão | Varredura completa | Números finais |
|---|---|---|
| `main` `1ab45eb`, sem Fase 4 | **50,044 s** | 4598 / 32 / 4630 |
| Fase 4 `0030c60` | **49,790 s** | 4598 / 32 / 4630 |

Diferença: 0,25 s em 50 s. Ruído.

## Por que não houve ganho — os custos isolados

Medidos na mesma página, sobre as mesmas 4630 entradas:

| Operação | Custo |
|---|---|
| `cache.keys()` sobre 4630 entradas | 230 ms |
| extrair `.url` de 4630 requests | 3 ms |
| **normalizar 4630 caminhos** (`decodeURIComponent` + `new URL` + NFC) | **26 ms** |
| buscar o manifesto (4630 louvores) | 26 ms |

**Uma construção de índice custa ~26 ms.** Noventa e cinco custam ~2,5 s. A
varredura leva 50 s. Ou seja: as reconstruções que a Fase 4 elimina valem, no
melhor caso, **5% do tempo** — e a medição ponta a ponta nem isso mostrou.

**Os outros ~47 s estão noutro sítio, que nem a investigação nem o plano
identificaram.** Quem for atacar esta lentidão a seguir começa daqui, com um
profile do navegador, não com leitura de código: a leitura de código já falhou
uma vez, e produziu uma otimização correta que não serve para nada.

## O que fica

A investigação `2026-09-02-varredura-de-estatisticas.md` continua correta nos
factos que apurou — o índice **é** reconstruído 95 vezes, `toComparablePath`
**lança** milhares de vezes. O que estava errado era a inferência de que isso
dominava o tempo. Contar ocorrências não é medir custo.

O número de 2min30 citado no plano, e o de 10min17 que eu próprio medi antes de
descobrir a contaminação, **não se reproduzem em origem limpa**. Foram artefactos
do service worker estranho. Ficam registados aqui só para ninguém os perseguir.
