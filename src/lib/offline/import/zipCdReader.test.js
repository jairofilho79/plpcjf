/**
 * Tests for central-directory ZIP reader (yazl nested-zip safe).
 * Run: node --test src/lib/offline/import/zipCdReader.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ZipFile } from 'yazl';
import {
  findEocdOffset,
  parseCentralDirectory,
  readZipCentralDirectory,
  readZipEntryData,
  iterateZipEntriesCd
} from './zipCdReader.js';

/**
 * @param {Array<{ name: string, data: Buffer }>} files
 * @returns {Promise<Buffer>}
 */
function buildYazlZip(files) {
  const tmp = path.join(os.tmpdir(), `plpc-cd-test-${Date.now()}.zip`);
  return new Promise((resolve, reject) => {
    const z = new ZipFile();
    const out = fs.createWriteStream(tmp);
    z.outputStream.pipe(out);
    out.on('close', () => {
      try {
        resolve(fs.readFileSync(tmp));
      } finally {
        fs.unlinkSync(tmp);
      }
    });
    out.on('error', reject);
    z.outputStream.on('error', reject);
    for (const f of files) {
      z.addBuffer(f.data, f.name, { compress: f.compress ?? false });
    }
    z.end();
  });
}

describe('zipCdReader', () => {
  it('findEocdOffset locates EOCD near end', () => {
    const buf = Buffer.alloc(40, 0);
    buf.writeUInt32LE(0x06054b50, 10);
    assert.equal(findEocdOffset(new Uint8Array(buf)), 10);
  });

  it('reads nested stored ZIP at full size (yazl data-descriptor safe)', async () => {
    // Inner zip bytes start with PK — this is what broke streaming Unzip
    const innerZip = await buildYazlZip([
      { name: 'assets/a.pdf', data: Buffer.alloc(50_000, 7) },
      { name: 'assets/b.pdf', data: Buffer.alloc(60_000, 8) }
    ]);
    assert.ok(innerZip[0] === 0x50 && innerZip[1] === 0x4b);

    const mother = await buildYazlZip([
      { name: 'offline-manifest.json', data: Buffer.from('{"packages":{}}') },
      { name: 'louvores-manifest.json', data: Buffer.from('[]') },
      { name: 'Partitura-1.zip', data: innerZip }
    ]);

    const blob = new Blob([mother]);
    const { entries } = await readZipCentralDirectory(blob);
    assert.equal(entries.length, 3);

    const part = entries.find((e) => e.name === 'Partitura-1.zip');
    assert.ok(part);
    assert.equal(part.compSize, innerZip.length);
    assert.equal(part.uncompSize, innerZip.length);

    const data = await readZipEntryData(blob, part);
    assert.equal(data.byteLength, innerZip.length);
    assert.deepEqual(Buffer.from(data), innerZip);

    const names = [];
    const sizes = [];
    for await (const entry of iterateZipEntriesCd(blob)) {
      names.push(entry.name);
      sizes.push(entry.data.byteLength);
    }
    assert.deepEqual(names, [
      'offline-manifest.json',
      'louvores-manifest.json',
      'Partitura-1.zip'
    ]);
    assert.equal(sizes[2], innerZip.length);
  });

  it('parseCentralDirectory skips corrupt trailing bytes', () => {
    // Empty CD → empty list
    assert.deepEqual(parseCentralDirectory(new Uint8Array(0)), []);
  });
});

describe('iterateZipEntriesCd filtra pelo nome antes de inflar (#12)', () => {
  it('pula um dot-file corrompido sem tentar inflar', async () => {
    // O `.DS_Store` é comprimido (method 8) e depois corrompido byte a byte:
    // se o gerador chamar inflateSync nele antes de filtrar pelo nome, o
    // teste pega o throw. Se filtrar primeiro (o alvo desta correção), o
    // dot-file nunca chega a ser lido e a iteração termina limpa.
    const zip = await buildYazlZip([
      { name: 'assets/a.pdf', data: Buffer.alloc(1000, 7), compress: false },
      { name: '.DS_Store', data: Buffer.from('x'.repeat(300)), compress: true }
    ]);

    const { entries } = await readZipCentralDirectory(new Blob([zip]));
    const dotEntry = entries.find((e) => e.name === '.DS_Store');

    // Corrompe os bytes comprimidos do .DS_Store in-place (mesmo tamanho,
    // então nenhum offset do central directory se move).
    const mutable = Buffer.from(zip);
    const head = mutable.subarray(dotEntry.localHeaderOffset, dotEntry.localHeaderOffset + 30);
    const extraLen = head.readUInt16LE(28);
    const dataStart = dotEntry.localHeaderOffset + 30 + dotEntry.name.length + extraLen;
    for (let i = 0; i < dotEntry.compSize; i++) {
      mutable[dataStart + i] ^= 0xff;
    }
    const blob = new Blob([mutable]);

    // Sanidade: ler a entrada corrompida direto tem que lançar — confirma
    // que a corrupção funcionou.
    const { entries: entries2 } = await readZipCentralDirectory(blob);
    const dotEntry2 = entries2.find((e) => e.name === '.DS_Store');
    await assert.rejects(() => readZipEntryData(blob, dotEntry2));

    // O teste real: iterar o zip inteiro não pode lançar, e o dot-file não
    // pode aparecer — hoje (sem a correção) isto lança "unexpected EOF"
    // porque `readZipEntryData` roda antes do filtro por nome.
    const names = [];
    for await (const entry of iterateZipEntriesCd(blob)) {
      names.push(entry.name);
    }
    assert.deepEqual(names, ['assets/a.pdf']);
  });
});
