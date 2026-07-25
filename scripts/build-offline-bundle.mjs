#!/usr/bin/env node
/**
 * Builds plpc-offline-bundle.zip (zip-mãe):
 *   offline-manifest.json  (SSOT)
 *   louvores-manifest.json
 *   Partitura-N.zip / Cifra-N.zip / … (same filenames as offline-manifest parts)
 *
 * Usage:
 *   node scripts/build-offline-bundle.mjs --packages-dir ./packages --out ./plpc-offline-bundle.zip
 *   node scripts/build-offline-bundle.mjs --out ./plpc-offline-bundle.zip
 *     (downloads manifests + parts from R2 via wrangler)
 *
 * Optional:
 *   --offline-manifest <path>
 *   --louvores-manifest <path>
 *   --bucket pls-louvores
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { ZipFile } from 'yazl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const DEFAULT_BUCKET = 'pls-louvores';

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = { out: path.join(projectRoot, 'plpc-offline-bundle.zip'), bucket: DEFAULT_BUCKET };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--packages-dir') out.packagesDir = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--offline-manifest') out.offlineManifest = argv[++i];
    else if (a === '--louvores-manifest') out.louvoresManifest = argv[++i];
    else if (a === '--bucket') out.bucket = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: projectRoot, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * @param {string} bucket
 * @param {string} key
 * @param {string} destFile
 */
async function r2Get(bucket, key, destFile) {
  await fsp.mkdir(path.dirname(destFile), { recursive: true });
  const result = await run('npx', [
    'wrangler',
    'r2',
    'object',
    'get',
    `${bucket}/${key}`,
    '--file',
    destFile
  ]);
  if (result.code !== 0) {
    throw new Error(`wrangler r2 get failed for ${key}:\n${result.stderr || result.stdout}`);
  }
}

/**
 * @param {unknown} offlineManifest
 * @returns {string[]}
 */
function listPartFilenames(offlineManifest) {
  const names = [];
  const packages = offlineManifest?.packages;
  if (!packages || typeof packages !== 'object') return names;
  for (const packageData of Object.values(packages)) {
    const parts = packageData?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (part?.filename) names.push(path.basename(String(part.filename)));
    }
  }
  return names;
}

/**
 * @param {string} filePath
 * @param {string} entryName
 * @param {import('yazl').ZipFile} zipfile
 */
function addFileStore(zipfile, filePath, entryName) {
  // compressionLevel 0 = store (parts already compressed)
  zipfile.addFile(filePath, entryName, { compress: false });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  node scripts/build-offline-bundle.mjs --packages-dir ./packages --out ./plpc-offline-bundle.zip
  node scripts/build-offline-bundle.mjs --out ./plpc-offline-bundle.zip`);
    process.exit(0);
  }

  const tmpDir = await fsp.mkdtemp(path.join(projectRoot, '.offline-bundle-'));
  const outPath = path.resolve(String(args.out));
  const bucket = String(args.bucket);

  try {
    let offlineManifestPath = args.offlineManifest
      ? path.resolve(String(args.offlineManifest))
      : path.join(tmpDir, 'offline-manifest.json');
    let louvoresManifestPath = args.louvoresManifest
      ? path.resolve(String(args.louvoresManifest))
      : path.join(tmpDir, 'louvores-manifest.json');

    if (!args.offlineManifest) {
      console.log('Downloading offline-manifest.json from R2…');
      await r2Get(bucket, 'offline-manifest.json', offlineManifestPath);
    }
    if (!args.louvoresManifest) {
      console.log('Downloading louvores-manifest.json from R2…');
      await r2Get(bucket, 'louvores-manifest.json', louvoresManifestPath);
    }

    const offlineManifest = JSON.parse(await fsp.readFile(offlineManifestPath, 'utf8'));
    const louvoresManifest = JSON.parse(await fsp.readFile(louvoresManifestPath, 'utf8'));
    if (!offlineManifest?.packages) {
      throw new Error('offline-manifest.json inválido (sem packages)');
    }
    if (!Array.isArray(louvoresManifest) || louvoresManifest.length === 0) {
      throw new Error('louvores-manifest.json inválido');
    }

    const partNames = listPartFilenames(offlineManifest);
    if (partNames.length === 0) {
      throw new Error('offline-manifest não lista parts');
    }
    console.log(`Parts a incluir: ${partNames.length}`);

    /** @type {Map<string, string>} */
    const partFiles = new Map();
    const packagesDir = args.packagesDir ? path.resolve(String(args.packagesDir)) : null;

    for (const name of partNames) {
      if (packagesDir) {
        const local = path.join(packagesDir, name);
        try {
          await fsp.access(local);
          partFiles.set(name, local);
          continue;
        } catch {
          throw new Error(`Part em falta em --packages-dir: ${local}`);
        }
      }
      const dest = path.join(tmpDir, 'packages', name);
      console.log(`Downloading ${name} from R2…`);
      // R2 keys match public URLs: packages/Partitura-1.zip
      await r2Get(bucket, `packages/${name}`, dest);
      partFiles.set(name, dest);
    }

    console.log(`Writing ${outPath}…`);
    await fsp.mkdir(path.dirname(outPath), { recursive: true });

    await new Promise((resolve, reject) => {
      const zipfile = new ZipFile();
      const output = fs.createWriteStream(outPath);
      zipfile.outputStream.pipe(output);
      output.on('close', resolve);
      output.on('error', reject);
      zipfile.outputStream.on('error', reject);

      // Manifests first (importer requires offline-manifest before parts)
      addFileStore(zipfile, offlineManifestPath, 'offline-manifest.json');
      addFileStore(zipfile, louvoresManifestPath, 'louvores-manifest.json');
      for (const [name, filePath] of partFiles) {
        addFileStore(zipfile, filePath, name);
      }
      zipfile.end();
    });

    const stat = await fsp.stat(outPath);
    console.log(`OK: ${outPath} (${(stat.size / (1024 * 1024)).toFixed(1)} MiB)`);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
