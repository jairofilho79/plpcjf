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
  const source = resolve(__dirname, '..', 'node_modules', 'pdfjs-dist', 'web');
  // In monorepos or different working dirs, also try process.cwd()
  const fallbackSource = resolve(process.cwd(), 'node_modules', 'pdfjs-dist', 'web');
  const target = resolve(process.cwd(), 'static', 'pdfjs', 'web');

  await ensureDir(target);

  try {
    await cp(source, target, { recursive: true });
    // eslint-disable-next-line no-console
    console.log(`[pdfjs] Copied viewer from ${source} to ${target}`);
    return;
  } catch (err) {
    // try fallback
  }

  try {
    await cp(fallbackSource, target, { recursive: true });
    // eslint-disable-next-line no-console
    console.log(`[pdfjs] Copied viewer from ${fallbackSource} to ${target}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[pdfjs] Failed to copy PDF.js viewer. Is pdfjs-dist installed?', err?.message || err);
    process.exitCode = 0; // do not break install, just warn
  }
}

main();


