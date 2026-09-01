/**
 * Read ZIP entries via central directory + Blob.slice.
 * Avoids fflate streaming Unzip, which breaks on yazl data-descriptors
 * when a stored entry is itself a ZIP (nested PK\x03\x04 looks like a new local header).
 */

import { inflateSync } from 'fflate';
import { isUnsafeZipPath, zipEntryBasename } from './bundleValidation.js';

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CDFH = 0x02014b50;
const SIG_LFH = 0x04034b50;

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @returns {number}
 */
function u16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @returns {number}
 */
function u32(bytes, offset) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

/**
 * @param {Uint8Array} tail
 * @returns {number} offset of EOCD within tail, or -1
 */
export function findEocdOffset(tail) {
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === SIG_EOCD) return i;
  }
  return -1;
}

/**
 * @typedef {{ name: string, method: number, compSize: number, uncompSize: number, localHeaderOffset: number }} ZipCdEntry
 */

/**
 * Parse central directory entries from raw CD bytes.
 * @param {Uint8Array} cd
 * @returns {ZipCdEntry[]}
 */
export function parseCentralDirectory(cd) {
  /** @type {ZipCdEntry[]} */
  const entries = [];
  let off = 0;
  while (off + 46 <= cd.length) {
    if (u32(cd, off) !== SIG_CDFH) break;
    const method = u16(cd, off + 10);
    const compSize = u32(cd, off + 20);
    const uncompSize = u32(cd, off + 24);
    const nameLen = u16(cd, off + 28);
    const extraLen = u16(cd, off + 30);
    const commentLen = u16(cd, off + 32);
    const localHeaderOffset = u32(cd, off + 42);
    if (off + 46 + nameLen > cd.length) break;
    const name = new TextDecoder().decode(cd.subarray(off + 46, off + 46 + nameLen));
    entries.push({ name, method, compSize, uncompSize, localHeaderOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * @param {Blob} file
 * @returns {Promise<{ entries: ZipCdEntry[], cdOffset: number, cdSize: number }>}
 */
export async function readZipCentralDirectory(file) {
  const size = file.size;
  if (size < 22) throw new Error('Ficheiro ZIP demasiado pequeno');

  const tailLen = Math.min(size, 65557);
  const tail = new Uint8Array(await file.slice(size - tailLen).arrayBuffer());
  const eocdRel = findEocdOffset(tail);
  if (eocdRel < 0) throw new Error('ZIP inválido: EOCD não encontrado');

  let totalEntries = u16(tail, eocdRel + 10);
  let cdSize = u32(tail, eocdRel + 12);
  let cdOffset = u32(tail, eocdRel + 16);

  // ZIP64 when archive/offsets exceed 4 GiB (not our case today, but keep safe)
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || totalEntries === 0xffff) {
    let loc = -1;
    for (let i = eocdRel - 20; i >= 0; i--) {
      if (u32(tail, i) === SIG_ZIP64_EOCD_LOCATOR) {
        loc = i;
        break;
      }
    }
    if (loc < 0) throw new Error('ZIP64 locator em falta');
    const zip64Offset =
      Number(u32(tail, loc + 8)) + Number(u32(tail, loc + 12)) * 0x100000000;
    const zip64 = new Uint8Array(await file.slice(zip64Offset, zip64Offset + 56).arrayBuffer());
    if (u32(zip64, 0) !== SIG_ZIP64_EOCD) throw new Error('ZIP64 EOCD inválido');
    // sizes are uint64 little-endian at fixed offsets
    const dv = new DataView(zip64.buffer, zip64.byteOffset, zip64.byteLength);
    totalEntries = Number(dv.getBigUint64(32, true));
    cdSize = Number(dv.getBigUint64(40, true));
    cdOffset = Number(dv.getBigUint64(48, true));
  }

  if (cdOffset + cdSize > size) throw new Error('ZIP inválido: central directory fora do ficheiro');

  const cd = new Uint8Array(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const entries = parseCentralDirectory(cd);
  if (entries.length === 0) throw new Error('ZIP sem entradas no central directory');
  return { entries, cdOffset, cdSize };
}

/**
 * Read one entry payload (inflates if needed).
 * @param {Blob} file
 * @param {ZipCdEntry} entry
 * @returns {Promise<Uint8Array>}
 */
export async function readZipEntryData(file, entry) {
  if (entry.name.endsWith('/')) return new Uint8Array(0);

  const head = new Uint8Array(
    await file.slice(entry.localHeaderOffset, entry.localHeaderOffset + 30).arrayBuffer()
  );
  if (u32(head, 0) !== SIG_LFH) {
    throw new Error(`Local header inválido: ${entry.name}`);
  }
  const nameLen = u16(head, 26);
  const extraLen = u16(head, 28);
  const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen;
  const compressed = new Uint8Array(
    await file.slice(dataStart, dataStart + entry.compSize).arrayBuffer()
  );

  if (entry.method === 0) return compressed;
  if (entry.method === 8) {
    return inflateSync(compressed, { out: new Uint8Array(entry.uncompSize) });
  }
  throw new Error(`Método ZIP não suportado (${entry.method}) em ${entry.name}`);
}

/**
 * @param {Blob} file
 * @param {AbortSignal} [signal]
 * @returns {AsyncGenerator<{ name: string, data: Uint8Array }>}
 */
export async function* iterateZipEntriesCd(file, signal) {
  const { entries } = await readZipCentralDirectory(file);
  for (const entry of entries) {
    if (signal?.aborted) {
      throw new DOMException('Import cancelled', 'AbortError');
    }
    if (!entry.name || entry.name.endsWith('/')) continue;

    // Filtra pelo nome ANTES de inflar — o nome já está disponível no central
    // directory, sem custo de leitura de bytes. Inflar e só depois descartar
    // (como o consumidor fazia) gasta CPU e memória em toda entrada de um
    // download parcial que nem ia ser usada.
    if (isUnsafeZipPath(entry.name)) {
      throw new Error(`Entrada ZIP insegura: ${entry.name}`);
    }
    const base = zipEntryBasename(entry.name);
    if (!base || base.startsWith('.')) continue;

    const data = await readZipEntryData(file, entry);
    yield { name: entry.name, data };
  }
}
