# `/offline`: o botão "atualizar" nunca se solta

**Data:** 2026-09-02 · Chrome, macOS · build de produção, `localhost:4188`, proxy de leitura

**Achado:** na rota `/offline`, clicar em "Clique aqui para atualizar" deixa o
botão **`disabled`, a dizer "A atualizar…", indefinidamente** — mesmo depois de o
trabalho terminar e o resultado ser gravado. Recarregar a página recupera.

Não é lentidão. É um estado de carregamento que nunca se solta.

## As quatro corridas que o isolaram

Cada uma muda **um** fator. Todas com origem limpa (um só service worker,
worker no controlo) e as quatro chaves de estado derivado apagadas **depois** do
reload e imediatamente antes do clique.

| # | Versão | PDFs em cache | Instrumentação | Resultado |
|---|---|---|---|---|
| 1 | `fase9/instrumentacao` | 4630 | sim | parou nos 1908 louvores; nunca soltou |
| 2 | `main` `861a99d` | 4630 | **não** | processou os 4630, 100%, stats gravadas; **nunca soltou** (319 s) |
| 3 | `main` `861a99d` | **500** | não | stats gravadas; **nunca soltou** (158 s) |
| 4 | `main` `861a99d` | **0** | não | stats gravadas; **nunca soltou** (64 s) |
| 5 | **`42b7d67`, antes da Fase 8** | 0 | não | **nunca soltou** (67 s) |

### O que cada corrida elimina

- **(1) vs (2): não é a instrumentação.** O build sem instrumentação também não
  solta. Mas os dois falham de formas diferentes — um trava a meio dos louvores,
  o outro processa tudo e trava depois — logo a instrumentação **altera** o que
  mede e não serve como instrumento fino no estado atual.
- **(2) vs (3): não é escala.** 500 comporta-se como 4630.
- **(3) vs (4): não é a semeadura sintética.** Com o cache **completamente
  vazio**, sem um único PDF plantado, o botão prende na mesma. Isto exonera o
  protocolo de medição por inteiro.
- **(4) vs (5): não é a Fase 8.** O commit anterior a todo o trabalho de hoje
  trava identicamente. **O defeito é anterior**, e nenhuma das sete tarefas de
  hoje o introduziu.

## O que se observa no estado preso

- `offlineStatsCache_v2` — **gravado**. O trabalho terminou.
- `pdfAvailabilityIndex` — **ausente**, sempre, em todas as corridas.
- Consola: **zero erros, zero exceções**.
- Números na página: corretos e completos (na corrida 2, 4630/0/4630, 100%).
- Recarregar devolve o botão a "Clique aqui para atualizar", ativo.

O `pdfAvailabilityIndex` nunca gravado aponta para a construção do índice como o
que fica pendente e segura o `finally` que solta o `isLoadingStats`. **É hipótese,
não conclusão** — não foi verificada.

## O que isto faz à "medição dos 47 s"

A medição de 2026-09-02 diz que a varredura **completa** em 50,044 s. Nenhuma
destas cinco corridas completou. A explicação mais provável é que aquela medição
cronometrou **os números a aparecerem no ecrã**, não o botão a soltar-se — e que
o botão preso nunca foi notado. Se assim for, os 50 s medem uma coisa real (o
tempo até o resultado aparecer) mas o protocolo descreve outra.

**Consequência prática: a pergunta da Fase 9 mudou.** Não é "onde estão os 47 s".
É "porque é que o estado de carregamento nunca se solta" — e essa responde-se
lendo o caminho depois das stats, não com um perfil de desempenho.

## Relação com a Fase 5

A Fase 5 existiu para eliminar exatamente este modo de falha: capa de pé, botões
de atualizar `disabled`, sem saída. Ela pôs a limpeza de cache dentro do `try`
para o `finally` soltar sempre o `isLoadingStats`. **Esta corrida mostra que
existe outro caminho para o mesmo estado**, que a Fase 5 não cobriu. A correção
dela continua correta; o buraco é noutro sítio.

## Estado

Nada corrigido. Nenhuma alteração de produção feita a partir deste achado. As
branches `fase9/instrumentacao`, `controle/sem-instrumentacao` e
`controle/antes-fase8` são descartáveis e não vão para a `main`.
