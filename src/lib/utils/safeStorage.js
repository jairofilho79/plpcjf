/**
 * Acesso a `localStorage` que **nunca lança**.
 *
 * ## Por que este módulo existe
 *
 * A guarda que aparece espalhada por este repo —
 *
 * ```js
 * if (typeof localStorage === 'undefined') return;
 * ```
 *
 * — **não protege** contra storage bloqueado, e é isso que a torna pior do que
 * não ter guarda nenhuma: ela faz o leitor concluir que o caminho está seguro.
 *
 * `typeof` só suprime a exceção quando o operando é uma **referência não
 * resolvível** (ECMA-262 §13.5.3). `localStorage` é resolvível: existe como
 * propriedade do objeto global. O que lança é o `[[Get]]` dela. No Firefox com
 * "bloquear cookies e dados de sites" no estrito, e em algumas configurações de
 * aba privada, ler `window.localStorage` lança `SecurityError` — a linha da
 * guarda lança exatamente no cenário que ela deveria evitar.
 *
 * Por isso toda leitura do global aqui acontece dentro de `try`. Não
 * "simplifique" este módulo de volta para `typeof`.
 *
 * ## Contrato
 *
 * `safeGet` devolve `null` tanto para "a chave não existe" quanto para "o
 * storage está indisponível". É deliberado: quem hoje faz `getItem(k)` e trata
 * `null` como "não tenho esse dado" troca por `safeGet(k)` sem mudar lógica
 * nenhuma. Nenhum ponto de acesso cru deste repo surfaceia esse erro para a
 * interface — o padrão estabelecido é logar e seguir com o default.
 *
 * `safeRemove` devolve `false` **só** quando o acesso lançou. Storage ausente
 * (SSR) devolve `true`: não havia o que remover, e isso não é falha.
 */

/**
 * O storage **utilizável**, ou `null` quando não dá para usar.
 *
 * Há duas formas de storage bloqueado, e as duas existem: o getter global que
 * lança (Firefox estrito) e o objeto presente cujos membros lançam. Ler
 * `.length` cobre as duas — é a operação mais barata que toca o storage de
 * verdade e não muda nada. Um storage que lê mas recusa gravar (cota estourada,
 * Safari privado antigo) passa na sonda, e deve mesmo passar: leitura funciona.
 *
 * A sonda é conveniência para quem chama, não a defesa: `safeGet` e as outras
 * não dependem dela, cada uma tem o seu próprio `try`.
 *
 * @returns {Storage | null}
 */
export function getStorage() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    // Extensões de privacidade substituem `window.localStorage` por stubs. Um
    // número, uma string ou um `{}` passam no teste de verdade e estouram no
    // primeiro `.setItem` de quem chamou; a sonda tem de recusá-los.
    if (
      typeof storage.getItem !== 'function' ||
      typeof storage.setItem !== 'function' ||
      typeof storage.removeItem !== 'function' ||
      typeof storage.key !== 'function'
    ) {
      return null;
    }
    void storage.length;
    return storage;
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @returns {string | null} o valor, ou `null` se a chave não existe ou o storage não dá.
 */
export function safeGet(key) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    return storage.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {string} value
 * @returns {boolean} `true` só se gravou de fato.
 */
export function safeSet(key, value) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} key
 * @returns {boolean} `false` só se o acesso lançou.
 */
export function safeRemove(key) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return true;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {string[]} todas as chaves, ou `[]` se o storage não dá.
 */
export function safeKeys() {
  /** @type {string[]} */
  const chaves = [];
  try {
    const storage = globalThis.localStorage;
    if (!storage) return chaves;
    for (let i = 0, total = storage.length; i < total; i++) {
      const chave = storage.key(i);
      if (chave !== null) chaves.push(chave);
    }
  } catch {
    // Devolve o que deu para ler. Descartar o parcial faria a faxina da Fase 8
    // concluir "nada a limpar" num storage que lança no meio da enumeração.
  }
  return chaves;
}

/**
 * Remove várias chaves **sem parar na primeira que falhar**.
 *
 * É a razão de ser deste módulo para a limpeza de dados: uma sequência de
 * `removeItem` crus aborta no primeiro throw e deixa o estado pela metade —
 * permissão de offline apagada mas categorias ainda listadas como baixadas, por
 * exemplo. Aqui cada chave é tentada, e quem chama fica sabendo o que sobrou.
 *
 * @param {string[]} keys
 * @returns {{ removed: string[], failed: string[] }}
 */
export function safeRemoveMany(keys) {
  /** @type {string[]} */
  const removed = [];
  /** @type {string[]} */
  const failed = [];
  // Uma string É iterável. Sem esta linha, `safeRemoveMany('offlinePermission')`
  // — passar uma chave onde se queria uma lista, o erro de chamada mais provável
  // — itera os 17 caracteres e reporta ter removido 17 chaves de uma letra.
  if (typeof keys === 'string' || !keys || typeof keys[Symbol.iterator] !== 'function') {
    return { removed, failed };
  }
  try {
    for (const key of keys) {
      if (safeRemove(key)) removed.push(key);
      else failed.push(key);
    }
  } catch {
    // Lista inválida (`undefined`, `null`, não-iterável). O contrato desta
    // função é não lançar, e ela é justamente a que a limpeza de dados usa:
    // um throw aqui reintroduziria o abandono pela metade que ela veio matar.
  }
  return { removed, failed };
}
