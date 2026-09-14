import { test } from 'node:test';
import assert from 'node:assert/strict';

// O vite-plugin-svelte 3.x monta `resolve.mainFields` a partir de uma lista
// própria sem `browser` (['module','jsnext:main','jsnext']), e o Vite só honra
// o campo `browser` em forma de objeto (ex.: `qrcode`, que remapeia
// `lib/index.js` → `lib/browser.js`) quando `mainFields` contém 'browser'.
// Sem isso o bundle do cliente levava o entry Node do `qrcode` (pngjs,
// util.inherits) e o QR do folheto falhava em produção (2026-09-14).
test('vite.config mantém "browser" em resolve.mainFields', async () => {
  const config = (await import('../../../vite.config.js')).default;
  assert.ok(Array.isArray(config.resolve?.mainFields));
  assert.ok(config.resolve.mainFields.includes('browser'));
});
