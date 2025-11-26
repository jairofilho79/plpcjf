import { cp, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function ensureDir(path) {
  try {
    await access(path, constants.F_OK);
  } catch {
    await mkdir(path, { recursive: true });
  }
}

async function main() {
  const pkgRootA = resolve(__dirname, '..', 'node_modules', 'pdfjs-dist');
  const pkgRootB = resolve(process.cwd(), 'node_modules', 'pdfjs-dist');

  const webSourceA = resolve(pkgRootA, 'web');
  const webSourceB = resolve(pkgRootB, 'web');
  const buildSourceA = resolve(pkgRootA, 'build');
  const buildSourceB = resolve(pkgRootB, 'build');
  const targetWeb = resolve(process.cwd(), 'static', 'pdfjs', 'web');
  const targetBuild = resolve(process.cwd(), 'static', 'pdfjs', 'build');

  await ensureDir(targetWeb);
  await ensureDir(targetBuild);

  try {
    await cp(webSourceA, targetWeb, { recursive: true });
    await cp(resolve(buildSourceA, 'pdf.worker.min.mjs'), resolve(targetBuild, 'pdf.worker.min.mjs'));
    await cp(resolve(buildSourceA, 'pdf.mjs'), resolve(targetBuild, 'pdf.mjs'));
    // eslint-disable-next-line no-console
    console.log(`[pdfjs] Copied viewer from ${webSourceA} to ${targetWeb}`);
    // eslint-disable-next-line no-console
    console.log(`[pdfjs] Copied core+worker from ${buildSourceA} to ${targetBuild}`);
    return;
  } catch (err) {
    // try fallback
  }

  try {
    await cp(webSourceB, targetWeb, { recursive: true });
    await cp(resolve(buildSourceB, 'pdf.worker.min.mjs'), resolve(targetBuild, 'pdf.worker.min.mjs'));
    await cp(resolve(buildSourceB, 'pdf.mjs'), resolve(targetBuild, 'pdf.mjs'));
    // eslint-disable-next-line no-console
    console.log(`[pdfjs] Copied viewer from ${webSourceB} to ${targetWeb}`);
    // eslint-disable-next-line no-console
    console.log(`[pdfjs] Copied core+worker from ${buildSourceB} to ${targetBuild}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[pdfjs] Failed to copy PDF.js viewer. Is pdfjs-dist installed?', err?.message || err);
    process.exitCode = 0; // do not break install, just warn
  }
}

main();


