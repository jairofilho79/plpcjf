/**
 * Escolha do worker-alvo e forma da mensagem SET_DEBUG.
 * Run: node --test src/lib/utils/swDebugMessage.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDebugTargetWorker, buildSetDebugMessage } from './swDebugMessage.js';

describe('resolveDebugTargetWorker', () => {
  it('prioriza installing sobre waiting e active (primeira visita, install em andamento)', () => {
    const registration = { installing: 'I', waiting: 'W', active: 'A' };
    assert.equal(resolveDebugTargetWorker(registration), 'I');
  });

  it('cai para waiting quando não há installing', () => {
    const registration = { installing: null, waiting: 'W', active: 'A' };
    assert.equal(resolveDebugTargetWorker(registration), 'W');
  });

  it('cai para active quando não há installing nem waiting (visita repetida)', () => {
    const registration = { installing: null, waiting: null, active: 'A' };
    assert.equal(resolveDebugTargetWorker(registration), 'A');
  });

  it('devolve null sem nenhum worker endereçável', () => {
    assert.equal(resolveDebugTargetWorker({ installing: null, waiting: null, active: null }), null);
    assert.equal(resolveDebugTargetWorker(null), null);
    assert.equal(resolveDebugTargetWorker(undefined), null);
  });
});

describe('buildSetDebugMessage', () => {
  it('monta a mensagem com enabled: true', () => {
    assert.deepEqual(buildSetDebugMessage(true), { type: 'SET_DEBUG', data: { enabled: true } });
  });

  it('monta a mensagem com enabled: false', () => {
    assert.deepEqual(buildSetDebugMessage(false), { type: 'SET_DEBUG', data: { enabled: false } });
  });

  it('normaliza valores não-booleanos (localStorage devolve string ou null)', () => {
    assert.deepEqual(buildSetDebugMessage('1' === '1'), { type: 'SET_DEBUG', data: { enabled: true } });
    assert.deepEqual(buildSetDebugMessage(undefined), { type: 'SET_DEBUG', data: { enabled: false } });
  });
});
