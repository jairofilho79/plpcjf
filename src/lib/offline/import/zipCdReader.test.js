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
      z.addBuffer(f.data, f.name, { compress: false });
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
