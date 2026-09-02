/**
 * Ordem do caminho de abertura: cache antes da rede.
 * Run: node --test src/lib/utils/pdfValidationOrder.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAvailabilityInOrder, ensureAvailability } from './pdfValidationOrder.js';

/** @typedef {import('./pdfValidationOrder.js').ValidationResult} ValidationResult */
/** @typedef {{ useIndex: boolean, checkNetwork: boolean, pdfId?: string }} ValidateOptions */

/**
 * Duplo de `compositeValidator.validate` que regista cada chamada e responde
 * conforme `checkNetwork`. É a única forma de observar a ordem: o que importa
 * não é o resultado — é quantas vezes a rede foi tocada para o obter.
 *
 * @param {{ semRede: ValidationResult, comRede: ValidationResult }} respostas
 */
function createValidatorDouble({ semRede, comRede }) {
  /** @type {ValidateOptions[]} */
  const calls = [];
  return {
    calls,
    /** @param {ValidateOptions} options */
    validate: async (options) => {
      calls.push(options);
      return options.checkNetwork ? comRede : semRede;
    }
  };
}

/** @param {boolean} online */
function createConnectivityDouble(online) {
  const probe = {
    count: 0,
    check: async () => {
      probe.count++;
      return online;
    }
  };
  return probe;
}

/** @type {ValidationResult} */
const DISPONIVEL = { available: true, needsDownload: false, url: '/assets/a.pdf', source: 'cache' };
/** @type {ValidationResult} */
const AUSENTE = { available: false, needsDownload: true, url: null, source: 'unknown' };

describe('resolveAvailabilityInOrder', () => {
  it('PDF em cache resolve sem tocar na rede', async () => {
    const validator = createValidatorDouble({ semRede: DISPONIVEL, comRede: DISPONIVEL });
    const probe = createConnectivityDouble(true);

    const result = await resolveAvailabilityInOrder({
      validate: validator.validate,
      checkConnectivity: probe.check,
      pdfId: 'abc'
    });

    assert.equal(result.available, true);
    assert.equal(probe.count, 0, 'a sonda de conectividade não pode correr no caso comum');
    assert.equal(validator.calls.length, 1);
    assert.equal(validator.calls[0].checkNetwork, false, 'a primeira tentativa é sem rede');
  });

  it('a primeira validação vem sempre antes da sonda', async () => {
    /** @type {string[]} */
    const ordem = [];
    /** @param {ValidateOptions} options */
    const validate = async (options) => {
      ordem.push(`validate:${options.checkNetwork}`);
      return options.checkNetwork ? DISPONIVEL : AUSENTE;
    };
    const checkConnectivity = async () => {
      ordem.push('probe');
      return true;
    };

    await resolveAvailabilityInOrder({ validate, checkConnectivity, pdfId: 'abc' });

    assert.deepEqual(ordem, ['validate:false', 'probe', 'validate:true']);
  });

  it('sem cache e online, repete com rede e devolve o resultado da rede', async () => {
    const validator = createValidatorDouble({ semRede: AUSENTE, comRede: DISPONIVEL });
    const probe = createConnectivityDouble(true);

    const result = await resolveAvailabilityInOrder({
      validate: validator.validate,
      checkConnectivity: probe.check,
      pdfId: 'abc'
    });

    assert.equal(result.available, true);
    assert.equal(probe.count, 1);
    assert.equal(validator.calls.length, 2);
    assert.equal(validator.calls[1].checkNetwork, true);
  });

  it('sem cache e offline, não repete a validação', async () => {
    const validator = createValidatorDouble({ semRede: AUSENTE, comRede: DISPONIVEL });
    const probe = createConnectivityDouble(false);

    const result = await resolveAvailabilityInOrder({
      validate: validator.validate,
      checkConnectivity: probe.check,
      pdfId: 'abc'
    });

    assert.equal(result.available, false);
    assert.equal(probe.count, 1);
    assert.equal(validator.calls.length, 1, 'offline não tem segunda tentativa a fazer');
  });

  it('encaminha o pdfId a todas as tentativas', async () => {
    const validator = createValidatorDouble({ semRede: AUSENTE, comRede: AUSENTE });
    const probe = createConnectivityDouble(true);

    await resolveAvailabilityInOrder({
      validate: validator.validate,
      checkConnectivity: probe.check,
      pdfId: 'id-do-pdf'
    });

    assert.equal(validator.calls.length, 2);
    for (const call of validator.calls) {
      assert.equal(call.pdfId, 'id-do-pdf');
      assert.equal(call.useIndex, true);
    }
  });

  it('sem pdfId, a ausência é undefined — o que as opções do validador declaram', async () => {
    const validator = createValidatorDouble({ semRede: DISPONIVEL, comRede: DISPONIVEL });
    const probe = createConnectivityDouble(true);

    const result = await resolveAvailabilityInOrder({
      validate: validator.validate,
      checkConnectivity: probe.check
    });

    assert.equal(result.available, true);
    assert.equal(validator.calls[0].pdfId, undefined);
  });
});

describe('ensureAvailability', () => {
  it('encaminha pdfPath e pdfId ao validador', async () => {
    /** @type {{ pdfPath: string, pdfId: string | null | undefined }[]} */
    const calls = [];
    /** @param {string} pdfPath @param {string | null} [pdfId] */
    const validate = async (pdfPath, pdfId) => {
      calls.push({ pdfPath, pdfId });
      return DISPONIVEL;
    };

    const available = await ensureAvailability('assets/ColAdultos/001.pdf', 'id-do-pdf', validate);

    assert.equal(available, true);
    assert.deepEqual(calls, [{ pdfPath: 'assets/ColAdultos/001.pdf', pdfId: 'id-do-pdf' }]);
  });

  it('sem pdfId, deixa o default do validador valer', async () => {
    /** @type {{ pdfPath: string, pdfId: string | null }[]} */
    const calls = [];
    /** @param {string} pdfPath @param {string | null} [pdfId] */
    const validate = async (pdfPath, pdfId = null) => {
      calls.push({ pdfPath, pdfId });
      return AUSENTE;
    };

    const available = await ensureAvailability('assets/ColAdultos/001.pdf', undefined, validate);

    assert.equal(available, false);
    assert.equal(calls[0].pdfId, null, 'undefined deixa o parâmetro default de validate assumir');
  });

  it('não baixa nada: uma só chamada ao validador, mesmo indisponível', async () => {
    let count = 0;
    const validate = async () => {
      count++;
      return AUSENTE;
    };

    const available = await ensureAvailability('assets/ColAdultos/001.pdf', 'abc', validate);

    assert.equal(available, false);
    assert.equal(count, 1, 'sem auto-download, não há revalidação');
  });
});
