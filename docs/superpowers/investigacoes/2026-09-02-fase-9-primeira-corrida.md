# Fase 9 — primeira corrida com o instrumento. Inconclusiva, e porquê.

**Data:** 2026-09-02 · Chrome, macOS, build de produção, `localhost:4188`
**Instrumento:** branch `fase9/instrumentacao`, `01db1b1` (não mesclada)

**Isto não é um achado sobre onde estão os 47 s.** É o registo de uma corrida que
não concluiu, com o que se observou e o que ficou por decidir. Vale mais escrito
do que perdido.

## O protocolo do runbook tem um passo na ordem errada — corrigido aqui

O runbook (e o doc de medição de que ele deriva) manda **apagar as quatro chaves
de estado derivado e depois recarregar**. Isso não funciona: o próprio
carregamento da página repõe as quatro. Verificado:

```
depois de apagar e recarregar →
chavesPresentes: [pdfAvailabilityIndex, cachedPdfsList, cachedPdfsListLocal, offlineStatsCache_v2]
```

A primeira corrida saiu contaminada por causa disto, e **foi a instrumentação que
a denunciou**, não eu:

```
[FASE9] getCachedPDFsFast serviu do localStorage: corrida CONTAMINADA, apague cachedPdfsListLocal
```

**Ordem correta: recarregar → esperar assentar → apagar as quatro chaves →
clicar imediatamente.** Com essa ordem o aviso não aparece.

Fica também confirmado que a receita de semeadura do doc de 2026-09-02 estava
errada (`atob` em latin-1, sem `normalizeForStorage`/NFC). A corrigida, do
runbook, semeia 4630 entradas exatas em ~2,7 s.

## O que a corrida limpa mostrou

| Momento | Evento |
|---|---|
| `t+0 s` | instrumentação armada, clique |
| `t+1 s` | `Loading stats with 4630 cached PDFs` |
| `t+2 s` | categoria **Gestos em Gravura** — 254 louvores, 6 iterações |
| `t+29 s` | categoria **Partitura** — 1654 louvores, 34 iterações |
| `t+155 s` | contador parado em **1908** (= 254 + 1654), capa "A atualizar…" de pé |
| `t+294 s` | **contador ainda em 1908.** Zero mensagens novas desde `t+29 s`. Zero erros de consola |

A varredura **não progrediu entre os 29 s e os 294 s**, sem exceção, sem log, sem
avanço de contador. Não é lentidão: é paragem.

## Três explicações, nenhuma verificada

1. **Efeito do observador.** A instrumentação mede cada iteração de cada laço; em
   4630 louvores isso é muito `performance.mark`. Pode estar ela própria a
   dominar ou a alterar o escalonamento. **Decide-se** correndo a mesma
   sequência na `main` sem instrumentação e comparando.
2. **A medição de 50 s media outra coisa.** Ela usava a semeadura errada. Se as
   chaves antigas casavam por outro caminho, os 50 s e estes 294 s não são
   comparáveis, e **a linha de base que consta do repo pode estar errada.**
   **Decide-se** repetindo a corrida antiga com a semeadura corrigida.
3. **Há mesmo uma paragem** no produto depois da segunda categoria, que as
   corridas anteriores não expuseram. **Decide-se** com um profile do DevTools
   apanhado durante a janela parada.

## Como continuar

Começar por (1) — é a mais barata e é a que invalida ou valida o instrumento
inteiro. Enquanto (1) não estiver respondida, **nenhum número desta corrida deve
entrar em nenhuma decisão.**

E manter a regra que já custou a Fase 4: contar ocorrências não é medir custo, e
uma corrida que não terminou não é uma medição.
