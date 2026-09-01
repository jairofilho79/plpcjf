import { cp, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Únicos arquivos de `pdfjs-dist/web` que o app pede em runtime.
 *
 * `pdf_viewer.css` é carregado direto por `<link>` em `leitor/+page.svelte`.
 * As imagens são as que o próprio CSS referencia via `url(images/...)` — sem
 * elas a folha de estilo carrega, mas os ícones do editor de anotações, os
 * cursores e o spinner de carregamento quebram.
 *
 * Tudo o mais que o pacote `pdfjs-dist` tem em `web/` e `build/` (pdf.mjs,
 * pdf.worker.min.mjs, pdf_viewer.mjs, o source map de 724 KB, e as imagens de
 * anotação que a CSS não referencia) não é servido daqui: o núcleo do PDF.js
 * vem do pacote npm via Vite, que emite os módulos como assets com hash em
 * `/_app/immutable/` (ver src/lib/utils/pdfjsLoader.js) — já cobertos pelo
 * precache normal do `build` do SvelteKit. Copiar a pasta `web` inteira só
 * engordava o deploy: 3,1 MB por ~120 KB de verdade usados (achado #18).
 */
const RUNTIME_FILES = [
  'web/pdf_viewer.css',
  'web/images/altText_add.svg',
  'web/images/altText_disclaimer.svg',
  'web/images/altText_done.svg',
  'web/images/altText_spinner.svg',
  'web/images/altText_warning.svg',
  'web/images/cursor-editorFreeHighlight.svg',
  'web/images/cursor-editorFreeText.svg',
  'web/images/cursor-editorInk.svg',
  'web/images/cursor-editorTextHighlight.svg',
  'web/images/editor-toolbar-delete.svg',
  'web/images/loading-icon.gif',
  'web/images/messageBar_closingButton.svg',
  'web/images/messageBar_warning.svg',
  'web/images/toolbarButton-editorHighlight.svg',
  'web/images/toolbarButton-menuArrow.svg'
];

async function ensureDir(path) {
  try {
    await access(path, constants.F_OK);
  } catch {
    await mkdir(path, { recursive: true });
  }
}

/** @param {string} pkgRoot */
async function copyRuntimeFiles(pkgRoot) {
  for (const rel of RUNTIME_FILES) {
    const source = resolve(pkgRoot, rel);
    const target = resolve(process.cwd(), 'static', 'pdfjs', rel);
    await ensureDir(dirname(target));
    await cp(source, target);
  }
}

async function main() {
  const pkgRootA = resolve(__dirname, '..', 'node_modules', 'pdfjs-dist');
  const pkgRootB = resolve(process.cwd(), 'node_modules', 'pdfjs-dist');

  try {
    await copyRuntimeFiles(pkgRootA);
    // eslint-disable-next-line no-console
    console.log(`[pdfjs] Copiados ${RUNTIME_FILES.length} arquivos de runtime de ${pkgRootA}`);
    return;
  } catch (err) {
    // tenta o caminho alternativo
  }

  try {
    await copyRuntimeFiles(pkgRootB);
    // eslint-disable-next-line no-console
    console.log(`[pdfjs] Copiados ${RUNTIME_FILES.length} arquivos de runtime de ${pkgRootB}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[pdfjs] Falha ao copiar assets de runtime do pdf.js. pdfjs-dist está instalado?',
      err?.message || err
    );
    process.exitCode = 0; // não quebra o install, só avisa
  }
}

main();
