/// <reference types="node" />

/**
 * Lê um ficheiro JSON de manifesto a partir do disco apenas em `vite dev` (Node).
 * Em produção (Cloudflare Worker) devolve sempre null para não puxar `node:fs` para o bundle.
 *
 * Ordem: `static/<filename>` depois `<filename>` na raiz do projeto.
 *
 * @param {string} filename - ex.: louvores-manifest.json
 * @returns {Promise<string | null>}
 */
export async function readDevLocalManifest(filename) {
  if (!import.meta.env.DEV) {
    return null;
  }
  const { readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '../../..');
  for (const rel of [`static/${filename}`, filename]) {
    const p = join(root, rel);
    try {
      return await readFile(p, 'utf8');
    } catch {
      /* tentar próximo caminho */
    }
  }
  return null;
}
