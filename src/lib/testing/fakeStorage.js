/**
 * Fakes de `Storage` para teste. `node --test` não tem localStorage, e o
 * cenário que importa aqui — Firefox com dados bloqueados — não é "storage
 * ausente", é "storage que lança ao ser tocado".
 */

/**
 * @param {Record<string, string>} [inicial]
 * @returns {Storage}
 */
export function criarFakeStorage(inicial = {}) {
  const dados = new Map(Object.entries(inicial));
  return /** @type {any} */ ({
    get length() { return dados.size; },
    key: (/** @type {number} */ i) => [...dados.keys()][i] ?? null,
    getItem: (/** @type {string} */ k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { dados.set(k, String(v)); },
    removeItem: (/** @type {string} */ k) => { dados.delete(k); },
    clear: () => { dados.clear(); }
  });
}

/**
 * Storage em que TODA operação lança — o cenário do Firefox estrito.
 * @param {string} [nomeDoErro]
 * @returns {Storage}
 */
export function criarStorageQueLanca(nomeDoErro = 'SecurityError') {
  const lancar = () => {
    const e = new Error('storage bloqueado');
    e.name = nomeDoErro;
    throw e;
  };
  return /** @type {any} */ ({
    get length() { return lancar(); },
    key: lancar, getItem: lancar, setItem: lancar, removeItem: lancar, clear: lancar
  });
}

/**
 * Storage que lê bem mas lança ao gravar — cota estourada, Safari privado antigo.
 * @param {Record<string, string>} [inicial]
 * @returns {Storage}
 */
export function criarStorageSomenteLeitura(inicial = {}) {
  const base = criarFakeStorage(inicial);
  const lancarQuota = () => {
    const e = new Error('cota excedida');
    e.name = 'QuotaExceededError';
    throw e;
  };
  // `clear` precisa lançar também: herdá-lo do spread faria este fake apagar
  // tudo em silêncio, provando o contrário do que o nome dele promete.
  return /** @type {any} */ ({ ...base, setItem: lancarQuota, removeItem: lancarQuota,
    clear: lancarQuota,
    get length() { return base.length; }, key: (/** @type {number} */ i) => base.key(i),
    getItem: (/** @type {string} */ k) => base.getItem(k) });
}
