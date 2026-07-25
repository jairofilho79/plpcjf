#!/usr/bin/env node
/**
 * Rebuilds packages/*.zip + offline-manifest.json from louvores-manifest.json.
 * Bin-packs PDFs per category into parts of at most --max-mb (default 30).
 *
 * Usage:
 *   node scripts/rebuild-offline-packages.mjs
 *   node scripts/rebuild-offline-packages.mjs --louvores-manifest ./louvores-manifest.json \
 *     --assets ./assets --out-packages ./packages --out-manifest ./offline-manifest.json
 */

import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZipFile } from 'yazl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const CATEGORIES = [
  { name: 'Partitura', keyword: 'partitura', slug: 'Partitura' },
  { name: 'Cifra', keyword: 'cifra', slug: 'Cifra' },
  { name: 'Gestos em Gravura', keyword: 'gestos em gravura', slug: 'Gestos-em-Gravura' }
];

function parseArgs(argv) {
  const out = {
    louvoresManifest: path.join(projectRoot, 'louvores-manifest.json'),
    assets: path.join(projectRoot, 'assets'),
    outPackages: path.join(projectRoot, 'packages'),
    outManifest: path.join(projectRoot, 'offline-manifest.json'),
    maxMb: 30
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--louvores-manifest') out.louvoresManifest = path.resolve(argv[++i]);
    else if (a === '--assets') out.assets = path.resolve(argv[++i]);
    else if (a === '--out-packages') out.outPackages = path.resolve(argv[++i]);
    else if (a === '--out-manifest') out.outManifest = path.resolve(argv[++i]);
    else if (a === '--max-mb') out.maxMb = Number(argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function decodePdfId(pdfId) {
  if (!pdfId || typeof pdfId !== 'string') return null;
  try {
    const normalized = pdfId.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - (normalized.length % 4)) % 4;
    let decoded = Buffer.from(normalized + '='.repeat(pad), 'base64').toString('utf8').trim();
    decoded = decoded.replace(/^\/+/, '');
    if (!decoded) return null;
    try {
      if (decoded.includes('%')) decoded = decodeURIComponent(decoded);
    } catch {
      /* keep */
    }
    if (!decoded.toLowerCase().startsWith('assets/')) decoded = `assets/${decoded}`;
    return decoded;
  } catch {
    return null;
  }
}

function categoryFor(categoria) {
  const c = (categoria || '').toLowerCase();
  for (const cat of CATEGORIES) {
    if (c.includes(cat.keyword)) return cat;
  }
  return null;
}

function resolveOnDisk(assetsDir, zipPath) {
  const rel = zipPath.replace(/^assets[/\\]/i, '');
  return path.join(assetsDir, rel);
}

/**
 * First-fit packing by uncompressed size (proxy for zip size; store usually ≈ source).
 * @param {{ pdfId: string, zipPath: string, absPath: string, size: number }[]} files
 * @param {number} maxBytes
 */
function packParts(files, maxBytes) {
  /** @type {{ files: typeof files, size: number }[]} */
  const parts = [];
  for (const file of files) {
    if (file.size > maxBytes) {
      parts.push({ files: [file], size: file.size });
      continue;
    }
    let placed = false;
    for (const part of parts) {
      if (part.size + file.size <= maxBytes) {
        part.files.push(file);
        part.size += file.size;
        placed = true;
        break;
      }
    }
    if (!placed) parts.push({ files: [file], size: file.size });
  }
  return parts;
}

async function writeZip(outputPath, files) {
  const zip = new ZipFile();
  const handle = await fs.open(outputPath, 'w');
  const writeStream = handle.createWriteStream();
  const piping = new Promise((resolve, reject) => {
    zip.outputStream.pipe(writeStream);
    zip.outputStream.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('finish', resolve);
  });
  for (const f of files) {
    zip.addFile(f.absPath, f.zipPath.replace(/\\/g, '/'));
  }
  zip.end();
  await piping;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/rebuild-offline-packages.mjs [options]
  --louvores-manifest <path>
  --assets <path>
  --out-packages <path>
  --out-manifest <path>
  --max-mb <number>   (default 30)`);
    return;
  }

  // Leave headroom for zip local headers / central directory so final zip stays ≤ maxMb.
  const maxBytes = Math.floor(args.maxMb * 1024 * 1024);
  const packBudget = Math.floor(maxBytes * 0.985);
  console.log(`max part size: ${args.maxMb} MB (pack budget ${packBudget} bytes)`);
  console.log(`louvores: ${args.louvoresManifest}`);
  console.log(`assets:   ${args.assets}`);

  const louvores = JSON.parse(await fs.readFile(args.louvoresManifest, 'utf8'));
  if (!Array.isArray(louvores)) throw new Error('louvores-manifest must be an array');

  /** @type {Map<string, Map<string, { pdfId: string, zipPath: string, absPath: string, size: number }>>} */
  const byCat = new Map(CATEGORIES.map((c) => [c.name, new Map()]));
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const skipped = [];

  for (const entry of louvores) {
    const cat = categoryFor(entry.categoria);
    if (!cat) {
      skipped.push(`${entry.nome || '?'} (${entry.categoria})`);
      continue;
    }
    const zipPath = decodePdfId(entry.pdfId);
    if (!zipPath || !entry.pdfId) {
      missing.push(`${entry.nome || '?'}: invalid pdfId`);
      continue;
    }
    const absPath = resolveOnDisk(args.assets, zipPath);
    let size;
    try {
      const st = await fs.stat(absPath);
      if (!st.isFile()) throw new Error('not a file');
      size = st.size;
    } catch {
      missing.push(`${entry.nome || '?'}: ${zipPath}`);
      continue;
    }
    byCat.get(cat.name).set(entry.pdfId, { pdfId: entry.pdfId, zipPath, absPath, size });
  }

  if (missing.length) {
    console.warn(`\n⚠ ${missing.length} PDF(s) em falta (excluídos dos packages):`);
    for (const m of missing) console.warn(`  - ${m}`);
  }
  if (skipped.length) {
    console.warn(`\n⚠ ${skipped.length} sem categoria offline:`);
    for (const s of skipped.slice(0, 20)) console.warn(`  - ${s}`);
  }

  await fs.mkdir(args.outPackages, { recursive: true });

  // Remove previous numbered part zips we manage
  for (const cat of CATEGORIES) {
    const re = new RegExp(`^${cat.slug}-\\d+\\.zip$`);
    for (const name of await fs.readdir(args.outPackages)) {
      if (re.test(name)) await fs.unlink(path.join(args.outPackages, name));
    }
  }

  const packages = {};
  let totalParts = 0;
  let totalPdfs = 0;

  for (const cat of CATEGORIES) {
    const files = [...byCat.get(cat.name).values()].sort((a, b) => a.zipPath.localeCompare(b.zipPath));
    const parts = packParts(files, packBudget);
    const partEntries = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const filename = `${cat.slug}-${i + 1}.zip`;
      const outPath = path.join(args.outPackages, filename);
      process.stdout.write(`  ${filename}: ${part.files.length} PDFs (~${(part.size / 1024 / 1024).toFixed(1)} MB)… `);
      await writeZip(outPath, part.files);
      const zipSize = fssync.statSync(outPath).size;
      console.log(`${(zipSize / 1024 / 1024).toFixed(2)} MB zip`);
      if (zipSize > maxBytes) {
        console.warn(`    ⚠ zip acima de ${args.maxMb} MB (${zipSize} bytes)`);
      }
      partEntries.push({
        filename,
        url: `/packages/${filename}`,
        size: zipSize,
        pdfs: part.files.map((f) => f.pdfId)
      });
      totalParts += 1;
      totalPdfs += part.files.length;
    }

    packages[cat.name] = { parts: partEntries };
    console.log(`${cat.name}: ${partEntries.length} parts, ${files.length} PDFs`);
  }

  const offlineManifest = {
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    packages
  };

  await fs.writeFile(args.outManifest, JSON.stringify(offlineManifest, null, 2) + '\n', 'utf8');
  console.log(`\nWrote ${args.outManifest}`);
  console.log(`Total: ${totalPdfs} PDFs in ${totalParts} parts`);
  if (missing.length) {
    console.log(`Missing (not packaged): ${missing.length}`);
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
