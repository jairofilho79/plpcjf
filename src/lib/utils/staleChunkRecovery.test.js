/**
 * O resgate de deploy velho com sessionStorage hostil. Este é o caminho que
 * conserta um app partido — falhar aqui deixa o utilizador preso.
 * Run: node --test src/lib/utils/staleChunkRecovery.test.js
 */

import { register } from 'node:module';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { criarFakeStorage, criarStorageQueLanca } from '../testing/fakeStorage.js';

// Mesmo hook de aliases usado noutros testes que cruzam `$app/$lib` sob `node --test`.
const raizLib = fileURLToPath(new URL('../', import.meta.url));
const hookAliasesSvelteKit = `
const raizLib = ${JSON.stringify(raizLib)};
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '$app/environment') {
    return {
      url: 'data:text/javascript,export const version = "test";export const browser = true;export const dev = true;export const building = false;',
      shortCircuit: true
    };
  }
  if (specifier.startsWith('$lib/')) {
    return nextResolve(new URL(specifier.slice('$lib/'.length), 'file://' + raizLib).href, context);
  }
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(hookAliasesSvelteKit)}`, import.meta.url);

const { tryRecoverFromStaleDeployment } = await import('./staleChunkRecovery.js');

const originalSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function instalarSession(storage) {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: storage, configurable: true, writable: true
  });
}

let recarregou = 0;

beforeEach(() => {
  recarregou = 0;
  Object.defineProperty(globalThis, 'window', {
    value: { location: { reload: () => { recarregou++; } } },
    configurable: true, writable: true
  });
  // Sem service worker nem caches: `hardResetSwAndAppCaches` já tem try/catch
  // próprio, então basta que os globais não existam.
  Object.defineProperty(globalThis, 'navigator', {
    value: {}, configurable: true, writable: true
  });
});

afterEach(() => {
  if (originalSession) Object.defineProperty(globalThis, 'sessionStorage', originalSession);
  else delete globalThis.sessionStorage;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete globalThis.window;
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete globalThis.navigator;
});

describe('tryRecoverFromStaleDeployment — sessionStorage que lança', () => {
  beforeEach(() => instalarSession(criarStorageQueLanca('SecurityError')));

  it('não lança', async () => {
    await assert.doesNotReject(() => tryRecoverFromStaleDeployment('teste'));
  });

  it('recarrega mesmo assim — o resgate é mais importante que a contagem', async () => {
    const disparou = await tryRecoverFromStaleDeployment('teste');
    assert.equal(disparou, true);
    assert.equal(recarregou, 1);
  });
});

describe('tryRecoverFromStaleDeployment — sessionStorage normal', () => {
  beforeEach(() => instalarSession(criarFakeStorage()));

  it('conta as tentativas e desiste na terceira', async () => {
    assert.equal(await tryRecoverFromStaleDeployment('1'), true);
    assert.equal(await tryRecoverFromStaleDeployment('2'), true);
    assert.equal(await tryRecoverFromStaleDeployment('3'), false);
    assert.equal(recarregou, 2);
  });
});
