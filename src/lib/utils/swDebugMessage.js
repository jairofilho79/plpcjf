// Lógica pura da propagação do gate de debug ao Service Worker.
//
// Extraída de swRegistration.js (fix de revisão, rodada 1 da Task 3) para
// poder rodar sob `node --test` sem bundler: este arquivo não importa nada
// de `$app` nem `$lib`, então não precisa de mock de `navigator`/`caches`
// para testar a parte que importa — qual worker é o alvo certo e qual
// mensagem sai.

/**
 * Devolve o ServiceWorker endereçável agora, sem depender de `controller`
 * (que só existe depois de `clients.claim()`, o que pode acontecer bem
 * depois do `register()` resolver — é a corrida da primeira visita).
 * Prioriza o worker mais recente: instalando > esperando > ativo, porque é
 * esse que estará no controle em breve, ou já está.
 *
 * @param {{ installing?: unknown, waiting?: unknown, active?: unknown } | null | undefined} registration
 * @returns {unknown} o worker a endereçar, ou `null` se nenhum existir ainda.
 */
export function resolveDebugTargetWorker(registration) {
  if (!registration) return null;
  return registration.installing || registration.waiting || registration.active || null;
}

/**
 * @param {boolean} enabled
 * @returns {{ type: 'SET_DEBUG', data: { enabled: boolean } }}
 */
export function buildSetDebugMessage(enabled) {
  return { type: 'SET_DEBUG', data: { enabled: !!enabled } };
}
