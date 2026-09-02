# Fase 9 — a corrida de controlo. O que ela decidiu, e o defeito que expôs.

**Data:** 2026-09-02 · Chrome, macOS · build de produção, `localhost:4188`
**Controlo:** `main` `861a99d`, **zero instrumentação** (`grep -rl FASE9 src` → 0,
`git diff --stat main -- src` → 0 linhas). Único desvio: o proxy de leitura.

## Porque foi preciso

A primeira corrida da Fase 9 mudou **dois** fatores de uma vez face à medição de
50 s: acrescentou instrumentação **e** corrigiu a receita de semeadura. Com dois
fatores mudados, a diferença de resultado não se atribui a nenhum. Esta corrida
mexe num só: tira a instrumentação, mantém a semeadura corrigida.

## O resultado

| | instrumentada | **controlo (sem instrumentação)** |
|---|---|---|
| louvores processados | parou em **1908** de 4630 | **4630 de 4630** |
| stats calculadas | não | **sim — 100%, `offlineStatsCache_v2` gravado** |
| botão aos 319 s | — | **`disabled`, "A atualizar…"** |
| `pdfAvailabilityIndex` | ausente | **ausente** |
| terminou? | não | **não** |

### 1. A instrumentação não é a causa — mas também não é inocente

O controlo **também não termina**. Logo, a paragem não é artefacto do instrumento.

Mas os dois falham de maneiras **diferentes** — um trava a meio dos louvores, o
outro processa-os todos e trava depois. Isso significa que a instrumentação
**altera o comportamento do que mede**. Como instrumento de medição fina, não é
de confiar no estado atual.

### 2. A linha de base de 50 s não se reproduz

Nem com instrumentação, nem sem ela, nem com a semeadura corrigida. **O número de
50 s que está no repo desde 2026-09-02 não é reproduzível pelo protocolo que o
próprio repo descreve.** Até se descobrir porquê, não deve ser usado para julgar
nada — e a Fase 4 foi descartada contra ele.

## O defeito que isto expôs, e que é o achado real

Na `main` de hoje, sem instrumentação nenhuma, com 4630 PDFs em cache:

1. clicar em "Clique aqui para atualizar";
2. a varredura corre e **acaba** — 4630 disponíveis, 0 faltantes, 100%, e o
   `offlineStatsCache_v2` fica gravado;
3. **o botão fica `disabled` a dizer "A atualizar…" para sempre.** Aos 319 s
   ainda estava. Sem erro na consola, sem exceção;
4. `pdfAvailabilityIndex` **nunca é gravado**;
5. **recarregar a página recupera** — o botão volta a "Clique aqui para atualizar".

Ou seja: o trabalho termina, o resultado é guardado, e o estado de carregamento
nunca se solta. É **exatamente o modo de falha "sem saída"** que a Fase 5 existiu
para eliminar — capa de pé, botão desativado — mas por um caminho que a Fase 5
não cobriu. A Fase 5 pôs a limpeza de cache dentro do `try` para o `finally`
sempre soltar `isLoadingStats`; aqui alguma coisa depois das stats continua
pendente e segura o `finally`. O `pdfAvailabilityIndex` ausente aponta para a
construção do índice, mas **isso é hipótese, não conclusão**.

Como recarregar resolve, o utilizador não fica preso para sempre — fica preso até
descobrir que tem de recarregar.

## O que continua por decidir

**A semeadura sintética.** 4630 corpos de 15 bytes é a única coisa que separa
este ambiente de um aparelho real. Se for ela a provocar a paragem, o defeito
acima não existe em produção. **Decide-se barato:** semear 500 em vez de 4630 e
repetir. Se completar a 500 e travar a 4630, é problema de escala no produto; se
travar nos dois, é do protocolo.

**Nada de perseguir os "47 s" antes disto.** A pergunta mudou: já não é "onde
está o tempo", é "porque é que a varredura não larga o estado de carregamento".
Um perfil tirado durante uma corrida que não termina mede uma coisa que não se
entende.
