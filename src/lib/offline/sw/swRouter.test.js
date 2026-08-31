/**
 * Teste de roteamento do Service Worker.
 * Run: node --test src/lib/offline/sw/swRouter.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(here, '../../../../static/sw-router.js'), 'utf8');
const sandbox = { self: {} };
runInContext(source, createContext(sandbox));

/** @type {(pathname: string, ctx?: object) => string} */
const matchSwRoute = sandbox.self.matchSwRoute;

describe('matchSwRoute', () => {
  it('trata navegação antes de qualquer outra regra', () => {
    assert.equal(matchSwRoute('/leitor', { isNavigation: true }), 'navigation');
    assert.equal(matchSwRoute('/assets/x/Cifra.pdf', { isNavigation: true }), 'navigation');
  });

  it('roteia PDF.js e PDFs', () => {
    assert.equal(matchSwRoute('/pdfjs/web/pdf_viewer.css', {}), 'pdfjs');
    assert.equal(matchSwRoute('/assets/ColAdultos/001.pdf', {}), 'pdf');
  });

  it('não trata bundles do SvelteKit como PDF', () => {
    assert.equal(matchSwRoute('/_app/immutable/chunks/a.pdf.js', {}), 'hashed-asset');
  });

  it('nunca serve o checksum pelo app shell', () => {
    assert.equal(matchSwRoute('/louvores-manifest.sha256', {}), 'checksum');
  });

  it('nunca serve pacotes ZIP pelo app shell', () => {
    assert.equal(matchSwRoute('/packages/Cifra-1.zip', {}), 'package-zip');
  });

  it('roteia assets versionados do SvelteKit', () => {
    assert.equal(matchSwRoute('/_app/immutable/entry/start.abc123.js', {}), 'hashed-asset');
    assert.equal(matchSwRoute('/_app/version.json', {}), 'hashed-asset');
    assert.equal(matchSwRoute('/_app/env.js', {}), 'hashed-asset');
  });

  it('app shell casa por igualdade exata, nunca por prefixo', () => {
    assert.equal(matchSwRoute('/', {}), 'app-shell');
    assert.equal(matchSwRoute('/manifest.json', {}), 'app-shell');
    assert.equal(matchSwRoute('/louvores-manifest.json', {}), 'app-shell');
    // Este é o defeito #01: com startsWith('/'), tudo abaixo virava 'app-shell'.
    assert.equal(matchSwRoute('/qualquer/coisa', {}), 'default');
    assert.equal(matchSwRoute('/manifest.json.bak', {}), 'default');
  });

  it('tudo que não casa cai no padrão', () => {
    assert.equal(matchSwRoute('/sobre/imagem.png', {}), 'default');
  });
});
