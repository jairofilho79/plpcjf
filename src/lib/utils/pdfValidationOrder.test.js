/**
 * Ordem do caminho de abertura: cache antes da rede.
 * Run: node --test src/lib/utils/pdfValidationOrder.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAvailabilityInOrder } from './pdfValidationOrder.js';

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

    const { result } = await resolveAvailabilityInOrder({
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

    const { result } = await resolveAvailabilityInOrder({
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

    const { result } = await resolveAvailabilityInOrder({
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

    const { result } = await resolveAvailabilityInOrder({
      validate: validator.validate,
      checkConnectivity: probe.check
    });

    assert.equal(result.available, true);
    assert.equal(validator.calls[0].pdfId, undefined);
  });
});

describe('veredito de conectividade devolvido a quem chama', () => {
  // Sem isto, o leitor sondava a rede uma segunda vez para descobrir o que esta
  // função já tinha descoberto — 1,5 s de ecrã morto para repetir uma pergunta
  // já respondida.

  it('cache hit não sonda, e diz que não sondou', async () => {
    const validator = createValidatorDouble({ semRede: DISPONIVEL, comRede: DISPONIVEL });
    const probe = createConnectivityDouble(true);

    const { effectiveOnline } = await resolveAvailabilityInOrder({
      validate: validator.validate,
      checkConnectivity: probe.check,
      pdfId: 'abc'
    });

    assert.equal(probe.count, 0);
    assert.equal(effectiveOnline, undefined, 'não sondou, logo não tem veredito a dar');
  });

  it('sem cache e offline, devolve o veredito negativo', async () => {
    const validator = createValidatorDouble({ semRede: AUSENTE, comRede: DISPONIVEL });
    const probe = createConnectivityDouble(false);

    const { result, effectiveOnline } = await resolveAvailabilityInOrder({
      validate: validator.validate,
      checkConnectivity: probe.check,
      pdfId: 'abc'
    });

    assert.equal(result.available, false);
    assert.equal(effectiveOnline, false);
    assert.equal(probe.count, 1, 'uma sonda, e uma só — o chamador reutiliza este veredito');
  });

  it('sem cache e online, devolve o veredito positivo', async () => {
    const validator = createValidatorDouble({ semRede: AUSENTE, comRede: AUSENTE });
    const probe = createConnectivityDouble(true);

    const { result, effectiveOnline } = await resolveAvailabilityInOrder({
      validate: validator.validate,
      checkConnectivity: probe.check,
      pdfId: 'abc'
    });

    assert.equal(result.available, false);
    assert.equal(effectiveOnline, true);
    assert.equal(probe.count, 1);
  });
});
