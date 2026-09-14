import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateFolhetoHtml,
  folhetoDisplayUrl,
  isShortShareUrl
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
