import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateFolhetoHtml,
  folhetoDisplayUrl,
  isShortShareUrl,
  aguardarImagens
} from './folhetoUtils.js';

const louvores = [{ nome: 'Senhor meu Deus e Pai', numero: '055' }];

test('isShortShareUrl reconhece só o formato curto', () => {
  assert.equal(isShortShareUrl('https://plpcg.com/?s=060f-0679&n=Culto'), true);
  assert.equal(isShortShareUrl('https://plpcg.com/?sharepdfs=abc&sharename=Culto'), false);
  assert.equal(isShortShareUrl(''), false);
});

test('folhetoDisplayUrl tira o esquema e corta antes de &n=', () => {
  assert.equal(
    folhetoDisplayUrl('https://plpcg.com/?s=060f-0679&n=Culto%20de%20domingo'),
    'plpcg.com/?s=060f-0679'
  );
  assert.equal(folhetoDisplayUrl('https://plpcg.com/?s=060f'), 'plpcg.com/?s=060f');
});

test('sem shareUrl/qrDataUrl o folheto não tem banda de QR', () => {
  const html = generateFolhetoHtml(louvores);
  assert.equal(html.includes('Abrir lista no PLPCG'), false);
  assert.equal(html.includes('<img'), false);
  assert.ok(html.includes('SENHOR MEU DEUS E PAI'));
});

test('com shareUrl e qrDataUrl o folheto tem QR, legenda e URL curta exibida', () => {
  const html = generateFolhetoHtml(louvores, {
    shareUrl: 'https://plpcg.com/?s=060f-0679&n=Culto',
    qrDataUrl: 'data:image/png;base64,AAAA'
  });
  assert.ok(html.includes('<img src="data:image/png;base64,AAAA"'));
  assert.ok(html.includes('Abrir lista no PLPCG'));
  assert.ok(html.includes('plpcg.com/?s=060f-0679'));
  assert.equal(html.includes('&n=Culto'), false);
});

test('só shareUrl (sem QR gerado) não desenha a banda', () => {
  const html = generateFolhetoHtml(louvores, { shareUrl: 'https://plpcg.com/?s=060f&n=Culto' });
  assert.equal(html.includes('Abrir lista no PLPCG'), false);
});

test('folheto é envolvido por wrapper com margem de segurança', () => {
  const html = generateFolhetoHtml(louvores);
  assert.ok(html.startsWith('<div style="padding:16px;background:#4B2D2B;display:inline-block;">'));
});

// html2canvas 1.4.1 não pinta os descendentes de um `display:inline-block`
// que não seja o próprio alvo da captura (verificado em produção em
// 2026-09-14: folheto saía só com a moldura, e o QR saía como caixa branca).
// Só o wrapper externo — o alvo do html2canvas — pode ser inline-block.
test('só o wrapper externo usa display:inline-block (html2canvas não pinta inline-block aninhado)', () => {
  const html = generateFolhetoHtml(louvores, {
    shareUrl: 'https://plpcg.com/?s=060f-0679&n=Culto',
    qrDataUrl: 'data:image/png;base64,AAAA'
  });
  const ocorrencias = html.match(/display:\s*inline-block/g) ?? [];
  assert.equal(ocorrencias.length, 1);
  assert.ok(html.startsWith('<div style="padding:16px;background:#4B2D2B;display:inline-block;">'));
});

// `img.decode()` fica pendente indefinidamente em aba oculta (Chrome adia o
// decode), o que travava o folheto para sempre; a espera é pelo `load`.
test('aguardarImagens resolve com imagens já carregadas, no load e no erro', async () => {
  /** @param {Partial<HTMLImageElement>} props */
  const fakeImg = props => /** @type {HTMLImageElement} */ (/** @type {unknown} */ ({ onload: null, onerror: null, ...props }));
  const pronta = fakeImg({ complete: true, naturalWidth: 300 });
  const carregando = fakeImg({ complete: false, naturalWidth: 0 });
  const quebrada = fakeImg({ complete: false, naturalWidth: 0 });

  const p = aguardarImagens([pronta, carregando, quebrada]);
  let resolvido = false;
  p.then(() => { resolvido = true; });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(resolvido, false);

  carregando.onload?.(new Event('load'));
  quebrada.onerror?.(new Event('error'));
  await p;
  assert.equal(resolvido, true);
});
