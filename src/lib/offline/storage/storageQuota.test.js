/**
 * Espaço em disco antes e durante o download.
 * Run: node --test src/lib/offline/storage/storageQuota.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkQuota,
  ensurePersistentStorage,
  isQuotaError,
  quotaErrorMessage
} from './storageQuota.js';

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
    assert.equal(r.faltam, 400 * MB);
  });

  it('exige margem: recusa quando o pedido ocupa exatamente tudo', async () => {
    // Um download que enche o disco até o último byte falha no meio; a margem
    // é o que impede prometer que cabe quando na prática não cabe.
    const r = await checkQuota(fakeNavigator({ usage: 0, quota: 1000 * MB }), 1000 * MB);
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
