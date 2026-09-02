/**
 * Cedência por orçamento de tempo, para laços longos que não podem prender a UI.
 *
 * Substitui o `await new Promise(r => setTimeout(r, 0))` que a varredura de
 * estatísticas fazia uma vez por chunk de 50 louvores. Dois problemas com ele:
 *
 * 1. Um `setTimeout` agendado de dentro de outro chega ao nível de aninhamento 5,
 *    e o Chrome trava-o em **1000 ms** numa aba não visível. Medido em produção:
 *    `Gestos` (6 chunks) e `Partitura` (34 chunks) gravaram-se com 27,98 s de
 *    diferença — 1,00 s por chunk, exato. Eram ~95 s de espera pura por varredura.
 *    `MessageChannel` não é temporizador: não sofre clamp nenhum.
 * 2. Cedia por contagem de itens, não por tempo gasto. Numa categoria pequena
 *    cedia de menos; numa grande, muito mais vezes do que o necessário.
 *
 * Aqui a régua é o relógio: só se cede quando o laço já ocupou a thread por mais
 * de `orcamentoMs`. O padrão de 16 ms é um quadro a 60 Hz.
 *
 * Só importa por caminho relativo — precisa rodar sob `node --test`.
 */

/** Uma só instância: `talvezCeder` devolve-a milhares de vezes por varredura. */
const JA_RESOLVIDA = Promise.resolve();

/** @type {() => number} */
const relogioPadrao =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

/**
 * @typedef {{ tipo: 'MessageChannel' | 'setTimeout', agendar: (callback: () => void) => void }} Agendador
 */

/**
 * Escolhe como voltar à fila de macrotarefas.
 *
 * `escopo` existe para o teste: é o único jeito de exercitar o fallback num
 * ambiente (Node, navegador) onde `MessageChannel` de facto existe.
 *
 * @param {any} [escopo]
 * @returns {Agendador}
 */
export function escolherAgendador(escopo = globalThis) {
  if (typeof escopo?.MessageChannel === 'function') {
    return {
      tipo: 'MessageChannel',
      agendar: (callback) => {
        const canal = new escopo.MessageChannel();
        canal.port1.onmessage = () => {
          // Fechar as duas pontas: a porta aberta segura o event loop no Node e
          // vaza um par de portas por cedência no navegador.
          canal.port1.close();
          canal.port2.close();
          callback();
        };
        canal.port2.postMessage(0);
      }
    };
  }

  return {
    tipo: 'setTimeout',
    agendar: (callback) => {
      setTimeout(callback, 0);
    }
  };
}

/**
 * @typedef {Object} OpcoesCedente
 * @property {number} [orcamentoMs=16] - Tempo de thread que o laço pode ocupar antes de ceder.
 * @property {(callback: () => void) => void} [agendar] - Agendador injetável (testes).
 * @property {() => number} [agora] - Relógio injetável (testes).
 */

/**
 * @param {OpcoesCedente} [opcoes]
 * @returns {{ talvezCeder: () => Promise<void> }}
 */
export function criarCedente(opcoes = {}) {
  const { orcamentoMs = 16, agendar, agora } = opcoes;

  const relogio = typeof agora === 'function' ? agora : relogioPadrao;
  const escalonar = typeof agendar === 'function' ? agendar : escolherAgendador().agendar;

  let ultimaCedencia = relogio();

  return {
    /**
     * Chame a cada item do laço. Na esmagadora maioria das vezes devolve uma
     * promessa já resolvida — custa um microtask, não uma macrotarefa.
     * @returns {Promise<void>}
     */
    talvezCeder() {
      if (relogio() - ultimaCedencia <= orcamentoMs) {
        return JA_RESOLVIDA;
      }

      return new Promise((resolve) => {
        escalonar(() => {
          // O orçamento novo conta do regresso, não da partida: o que interessa
          // é há quanto tempo a thread está presa a este laço.
          ultimaCedencia = relogio();
          resolve();
        });
      });
    }
  };
}
