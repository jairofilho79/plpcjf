/**
 * Espaço em disco antes e durante o download.
 * Run: node --test src/lib/offline/storage/storageQuota.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkQuota,
  ensurePersistentStorage,
  isQuotaError,
  quotaErrorMessage,
  markUpdateQuotaBlocked,
  clearUpdateQuotaBlocked,
  readUpdateQuotaBlockedAt
} from './storageQuota.js';
import { criarFakeStorage } from '../../testing/fakeStorage.js';

const MB = 1024 * 1024;

/** @param {{ usage?: number, quota?: number, persisted?: boolean, persistOk?: boolean }} o */
function fakeNavigator(o = {}) {
  return {
    storage: {
      estimate: async () => ({ usage: o.usage ?? 0, quota: o.quota ?? 0 }),
      persisted: async () => o.persisted ?? false,
      persist: async () => o.persistOk ?? false
    }
  };
}

describe('checkQuota', () => {
  it('aprova quando sobra folga', async () => {
    const r = await checkQuota(fakeNavigator({ usage: 100 * MB, quota: 2000 * MB }), 800 * MB);
    assert.equal(r.ok, true);
    assert.equal(r.desconhecido, false);
    assert.equal(r.disponivel, 1900 * MB);
  });

  it('reprova quando o necessário não cabe na folga', async () => {
    const r = await checkQuota(fakeNavigator({ usage: 100 * MB, quota: 500 * MB }), 800 * MB);
    assert.equal(r.ok, false);
    // 400 MB de folga real contra 800 MB * 1.1 de margem + 40 MB de reserva.
    assert.equal(r.faltam, Math.ceil(800 * MB * 1.1 + 40 * MB - 400 * MB));
  });

  it('exige margem: recusa quando o pedido ocupa exatamente tudo', async () => {
    // Um download que enche o disco até o último byte falha no meio; a margem
    // é o que impede prometer que cabe quando na prática não cabe.
    const r = await checkQuota(fakeNavigator({ usage: 0, quota: 1000 * MB }), 1000 * MB);
    assert.equal(r.ok, false);
  });

  it('exige reserva: recusa mesmo quando só a reserva pós-download não cabe', async () => {
    // O download em si cabe com folga (900 MB pedidos, 1000 MB livres, margem
    // de 10% = 990 MB) mas não sobra nada para o catálogo escrever depois —
    // é exatamente o caso que travava a atualização automática de louvores.
    const r = await checkQuota(fakeNavigator({ usage: 0, quota: 1000 * MB }), 900 * MB);
    assert.equal(r.ok, false);
  });

  it('não bloqueia quando o navegador não sabe estimar', async () => {
    const r = await checkQuota({}, 800 * MB);
    assert.equal(r.ok, true);
    assert.equal(r.desconhecido, true);
  });

  it('não bloqueia quando a estimativa vem zerada', async () => {
    const r = await checkQuota(fakeNavigator({ usage: 0, quota: 0 }), 800 * MB);
    assert.equal(r.ok, true);
    assert.equal(r.desconhecido, true);
  });

  it('sem bytes a pedir, aprova sem consultar nada', async () => {
    const r = await checkQuota(fakeNavigator({ usage: 0, quota: 10 }), 0);
    assert.equal(r.ok, true);
  });

  it('estimate que lança não derruba a verificação', async () => {
    const nav = {
      storage: {
        estimate: async () => {
          throw new Error('bloqueado');
        }
      }
    };
    const r = await checkQuota(nav, 800 * MB);
    assert.equal(r.ok, true);
    assert.equal(r.desconhecido, true);
  });
});

describe('ensurePersistentStorage', () => {
  it('não pede de novo quando já é persistente', async () => {
    let pediu = false;
    const nav = {
      storage: {
        persisted: async () => true,
        persist: async () => {
          pediu = true;
          return true;
        }
      }
    };
    assert.equal(await ensurePersistentStorage(nav), true);
    assert.equal(pediu, false);
  });

  it('pede quando ainda não é persistente', async () => {
    assert.equal(await ensurePersistentStorage(fakeNavigator({ persistOk: true })), true);
  });

  it('devolve false quando o navegador recusa', async () => {
    assert.equal(await ensurePersistentStorage(fakeNavigator({ persistOk: false })), false);
  });

  it('devolve false sem a API, sem lançar', async () => {
    assert.equal(await ensurePersistentStorage({}), false);
  });
});

describe('isQuotaError', () => {
  it('reconhece QuotaExceededError', () => {
    const e = new Error('cheio');
    e.name = 'QuotaExceededError';
    assert.equal(isQuotaError(e), true);
  });

  it('reconhece a mensagem do Safari', () => {
    assert.equal(isQuotaError(new Error('The quota has been exceeded.')), true);
  });

  it('reconhece falta de espaço em disco', () => {
    assert.equal(isQuotaError(new Error('No space left on device')), true);
  });

  it('não confunde erro de rede com quota', () => {
    assert.equal(isQuotaError(new Error('Failed to fetch')), false);
  });

  it('tolera null', () => {
    assert.equal(isQuotaError(null), false);
  });
});

describe('quotaErrorMessage', () => {
  it('diz quanto falta quando dá para calcular', () => {
    const msg = quotaErrorMessage({ faltam: 250 * MB });
    assert.match(msg, /espaço/i);
    assert.match(msg, /250/);
  });

  it('funciona sem números', () => {
    assert.match(quotaErrorMessage({}), /espaço/i);
  });
});

describe('aviso de atualização bloqueada por cota', () => {
  beforeEach(() => {
    globalThis.localStorage = criarFakeStorage();
  });

  afterEach(() => {
    delete /** @type {any} */ (globalThis).localStorage;
  });

  it('não há aviso antes de qualquer bloqueio', () => {
    assert.equal(readUpdateQuotaBlockedAt(), null);
  });

  it('marca e lê o momento do bloqueio', () => {
    markUpdateQuotaBlocked(1234);
    assert.equal(readUpdateQuotaBlockedAt(), 1234);
  });

  it('limpar remove o aviso', () => {
    markUpdateQuotaBlocked(1234);
    clearUpdateQuotaBlocked();
    assert.equal(readUpdateQuotaBlockedAt(), null);
  });
});
