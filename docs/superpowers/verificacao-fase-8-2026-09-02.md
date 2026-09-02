# Verificação da Fase 8 — armazenamento bloqueado, em navegador

**Data:** 2026-09-02 · **Build:** produção (`vite build` + `vite preview`), porta 4188
**Antes:** `c720440` · **Depois:** `main` com as Tasks 1–7 mescladas

Este documento fecha a lacuna que a Fase 3 deixou registada: *"o cenário de dados
bloqueados nunca foi verificado em navegador"*.

## Como, sem mexer nas definições do navegador

O plano previa pedir ao Jairo para bloquear os dados do site no Chrome ou usar o
Firefox estrito. Não foi preciso. Um script no `src/app.html`, **antes** do
bundle, substitui as duas globais por um getter que lança:

```js
Object.defineProperty(window, 'localStorage', {
  get: () => { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  configurable: true
});
```

Isto é fiel à mecânica real, e não uma aproximação: no Firefox estrito e no
Chrome com cookies bloqueados, `localStorage` **continua a ser uma referência
resolvível** e é o `[[Get]]` dela que lança. É exatamente por isso que
`typeof localStorage === 'undefined'` nunca protegeu — `typeof` só suprime o erro
de referência **não resolvível**, e esta resolve. Essa é a premissa de todo o
plano, e o harness reproduz precisamente esse mecanismo.

Ativa-se com `?storageBloqueado=1`. **Vive na branch `verificacao/storage-bloqueado`
e nunca entra na `main`.**

## Antes × depois

| | `c720440` (antes) | `main` (depois) |
|---|---|---|
| `/leitor` — texto visível | **0** | 32 |
| `/leitor` — `<canvas>` | **0** | **1** |
| `/leitor` — páginas renderizadas | **0** | **1** |
| Exceções não capturadas na consola | **1 `SecurityError`** | **0** |

**Controlo:** o mesmo URL sem a flag renderizava o PDF nas duas versões
(`canvas: 1`). A página em branco era o defeito, não um build partido.

Consola do "antes", que mostra as duas classes de acesso lado a lado:

```
[WARNING]   Não foi possível ler as playlists salvas do localStorage: SecurityError
[WARNING]   Não foi possível ler o carousel do localStorage: SecurityError
[EXCEPTION] SecurityError: The operation is insecure.      ← esta matava a página
```

Os dois `WARNING` vêm de acessos já dentro de `try` — avisam e sobrevivem, o que
confirma em execução a classificação "dentro/fora de `try`" que definiu o escopo
da fase. O `EXCEPTION` é o que abortava a construção do componente.

## Rotas, com armazenamento a lançar

| Rota | Resultado |
|---|---|
| `/` | abre; nav, filtros e o estado vazio normal ("Digite algo na busca…") |
| `/biblioteca` | abre, com resultados |
| `/listas` | abre (vazia — não há onde guardar) |
| `/offline` | abre; painel completo, stats a 0, faixa "Dados em cache" |
| `/leitor` | **abre e renderiza o PDF** |

**Garantia da Fase 5 conferida sob este cenário:** o botão "Clique aqui para
atualizar" existe e **não está `disabled`**. O modo de falha "capa de pé e os
dois botões desativados, sem saída" não ocorre com armazenamento bloqueado.

## Achado novo, não corrigido

Com as correções aplicadas, apareceu na consola:

```
[Offline:OfflineManager] [WARN] Migração NFC falhou (não crítico) SecurityError
```

`src/lib/offline/core/OfflineManager.js:100` lê a flag da migração NFC dentro de
um `try`. **Não parte nada** — por isso ficou fora do escopo dos 16 acessos —
mas reporta *"Migração NFC falhou"* quando a migração nem chegou a começar. É a
mesma classe de diagnóstico falso que a Task 4 corrigiu no `CacheMigration.js`.

**Isto expõe um limite real da decisão de escopo desta fase.** Os 16 acessos
foram escolhidos por risco de queda; os outros 80 ficaram de fora por não
partirem nada. Este caso mostra que um acesso dentro de `try` continua a poder
mentir no diagnóstico. Não é regressão nem urgência — é trabalho para uma fase
seguinte, agora observado em vez de suposto.

## O que NÃO foi verificado

- **Firefox real.** O mecanismo é reproduzido fielmente, mas é simulação; nenhum
  Firefox estrito correu.
- **Os fluxos de download e importação reais** com armazenamento bloqueado. As
  quatro ordenações da Fase 5 que envolvem download continuam por exercitar.
- **Escrita bem-sucedida após desbloqueio** — repor a definição e confirmar que
  as preferências voltam a persistir não foi testado, porque o harness é por URL
  e não por definição do navegador.
