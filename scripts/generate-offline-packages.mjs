import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZipFile } from 'yazl';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

/** Limite por parte (soma dos tamanhos dos PDFs no disco; PDFs já comprimidos ⇒ ZIP ≈ essa soma + overhead). */
const DEFAULT_MAX_PART_BYTES = 28 * 1024 * 1024;

const MAX_PART_BYTES = (() => {
  const raw = process.env.OFFLINE_PACKAGE_MAX_BYTES;
  if (!raw) return DEFAULT_MAX_PART_BYTES;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`OFFLINE_PACKAGE_MAX_BYTES inválido: ${raw}, usando padrão ${DEFAULT_MAX_PART_BYTES}`);
    return DEFAULT_MAX_PART_BYTES;
  }
  return Math.floor(n);
})();

const GROUPS = [
  {
    id: 'partitura',
    keyword: 'partitura',
    manifestCategory: 'Partitura',
    zipBase: 'Partitura'
  },
  {
    id: 'cifra',
    keyword: 'cifra',
    manifestCategory: 'Cifra',
    zipBase: 'Cifra'
  },
  {
    id: 'gestos',
    keyword: 'gestos em gravura',
    manifestCategory: 'Gestos em Gravura',
    zipBase: 'Gestos-em-Gravura',
    /** Uma única parte mantém o nome histórico sem sufixo numérico. */
    singlePartFilename: 'Gestos-em-Gravura.zip'
  }
];

function normalizeBase64Url(base64) {
  return base64.replace(/-/g, '+').replace(/_/g, '/');
}

function decodePdfId(pdfId) {
  if (!pdfId || typeof pdfId !== 'string') {
    return null;
  }

  try {
    const normalized = normalizeBase64Url(pdfId);
    const padding = (4 - (normalized.length % 4)) % 4;
    const base64 = normalized + '='.repeat(padding);
    let decoded = Buffer.from(base64, 'base64').toString('utf8').trim();
    decoded = decoded.replace(/^\/+/, '');

    if (!decoded) {
      return null;
    }

    try {
      if (decoded.includes('%')) {
        decoded = decodeURIComponent(decoded);
      }
    } catch {
      // Ignore decoding errors and keep original string
    }

    if (!decoded.toLowerCase().startsWith('assets/')) {
      decoded = `assets/${decoded}`;
    }

    return decoded;
  } catch (error) {
    console.warn(`Não foi possível decodificar pdfId '${pdfId}': ${error.message}`);
    return null;
  }
}

function ensurePosixPath(filePath) {
  return filePath.split(path.sep).join(path.posix.sep);
}

async function resolveLouvoresManifestPath() {
  if (process.env.LOUVORES_MANIFEST) {
    const p = path.isAbsolute(process.env.LOUVORES_MANIFEST)
      ? process.env.LOUVORES_MANIFEST
      : path.resolve(projectRoot, process.env.LOUVORES_MANIFEST);
    try {
      await fs.access(p);
      return p;
    } catch {
      console.warn(`LOUVORES_MANIFEST não encontrado: ${p}`);
    }
  }

  const candidates = [
    path.join(projectRoot, 'static', 'louvores-manifest.json'),
    path.join(projectRoot, 'louvores-manifest.json')
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }

  throw new Error(
    'louvores-manifest.json não encontrado. Coloque em static/ ou na raiz, ou defina LOUVORES_MANIFEST.'
  );
}

async function readManifest(manifestPath) {
  const raw = await fs.readFile(manifestPath, 'utf8');

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('Manifest deve ser um array de louvores');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Falha ao analisar manifest: ${error.message}`);
  }
}

function categorizeLouvores(louvores) {
  const lowerKeywordGroups = GROUPS.map((group) => ({
    ...group,
    keyword: group.keyword.toLowerCase(),
    entries: new Map()
  }));

  for (const louvor of louvores) {
    const category = (louvor.categoria || '').toLowerCase();
    if (!category) {
      continue;
    }

    const pdfPath = decodePdfId(louvor.pdfId);
    if (!pdfPath) {
      console.warn(`Louvor sem caminho válido para PDF: ${louvor.nome || 'Sem nome'}`);
      continue;
    }

    if (!louvor.pdfId) {
      continue;
    }

    for (const group of lowerKeywordGroups) {
      if (category.includes(group.keyword)) {
        group.entries.set(pdfPath, {
          louvor,
          pdfPath,
          pdfId: louvor.pdfId
        });
      }
    }
  }

  return lowerKeywordGroups;
}

function resolveRelativeToAssets(pdfPath) {
  const sanitized = pdfPath.replace(/^assets[\\/]/i, '').replace(/^\/+/, '');
  return sanitized;
}

async function resolveAssetsDir() {
  const candidates = [];

  if (process.env.ASSETS_DIR) {
    const customPath = path.isAbsolute(process.env.ASSETS_DIR)
      ? process.env.ASSETS_DIR
      : path.resolve(projectRoot, process.env.ASSETS_DIR);
    candidates.push(customPath);
  }

  candidates.push(path.join(projectRoot, 'assets'));
  candidates.push(path.join(projectRoot, '..', 'pls2', 'assets'));

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) {
        return path.resolve(candidate);
      }
    } catch {
      // Ignore errors and continue searching
    }
  }

  throw new Error(
    'Diretório de assets não encontrado. Defina ASSETS_DIR ou garanta que exista uma pasta "assets".'
  );
}

/**
 * @param {Map<string, { louvor: object, pdfPath: string, pdfId: string }>} entriesMap
 * @param {string} assetsDir
 * @returns {Promise<Array<{ pdfPath: string, absolutePath: string, pdfId: string, size: number }>>}
 */
async function validateAndCollectFiles(entriesMap, assetsDir) {
  const files = [];
  const normalizedAssetsDir = path.resolve(assetsDir);

  for (const [pdfPath, { louvor, pdfId }] of entriesMap.entries()) {
    const relativeToAssets = resolveRelativeToAssets(pdfPath);
    if (!relativeToAssets) {
      console.warn(`Caminho inválido: ${pdfPath}`);
      continue;
    }

    const absolutePath = path.join(normalizedAssetsDir, relativeToAssets);
    const resolvedAbsolute = path.resolve(absolutePath);

    if (!resolvedAbsolute.startsWith(normalizedAssetsDir)) {
      console.warn(`Caminho inválido (fora de assets): ${pdfPath}`);
      continue;
    }

    try {
      const stat = await fs.stat(resolvedAbsolute);
      if (!stat.isFile()) {
        console.warn(`Caminho não é arquivo: ${pdfPath}`);
        continue;
      }
      files.push({
        pdfPath,
        absolutePath: resolvedAbsolute,
        pdfId,
        size: stat.size
      });
    } catch {
      console.warn(`Arquivo não encontrado para '${louvor.nome || pdfPath}': ${pdfPath}`);
      continue;
    }
  }

  return files;
}

/**
 * Agrupa arquivos em lotes cuja soma de tamanhos ≤ maxBytes (ordem decrescente para reduzir “sobras”).
 * @param {Array<{ size: number, pdfPath: string }>} files
 */
function chunkFilesByMaxBytes(files, maxBytes) {
  const sorted = [...files].sort((a, b) => b.size - a.size);
  /** @type {typeof files[]} */
  const chunks = [];
  /** @type {typeof files} */
  let current = [];
  let currentSum = 0;

  for (const f of sorted) {
    if (f.size > maxBytes) {
      console.warn(
        `AVISO: ${f.pdfPath} (${(f.size / 1024 / 1024).toFixed(2)} MiB) excede OFFLINE_PACKAGE_MAX_BYTES (${(maxBytes / 1024 / 1024).toFixed(2)} MiB) — será um pacote só com esse arquivo.`
      );
    }

    if (current.length > 0 && currentSum + f.size > maxBytes) {
      chunks.push(current);
      current = [];
      currentSum = 0;
    }

    current.push(f);
    currentSum += f.size;
  }

  if (current.length) {
    chunks.push(current);
  }

  return chunks;
}

function partFilename(group, partIndex1, totalParts) {
  if (totalParts === 1 && group.singlePartFilename) {
    return group.singlePartFilename;
  }
  return `${group.zipBase}-${partIndex1}.zip`;
}

async function buildZip(outputPath, files) {
  if (files.length === 0) {
    console.warn(`Nenhum arquivo para ${path.basename(outputPath)} – zip não será criado.`);
    return 0;
  }

  const zip = new ZipFile();
  const outputStream = zip.outputStream;
  const handle = await fs.open(outputPath, 'w');
  const writeStream = handle.createWriteStream();

  const piping = new Promise((resolve, reject) => {
    outputStream.pipe(writeStream);
    outputStream.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('finish', resolve);
  });

  for (const file of files) {
    const internalPath = ensurePosixPath(file.pdfPath);
    zip.addFile(file.absolutePath, internalPath);
  }

  zip.end();
  await piping;
  const st = await fs.stat(outputPath);
  return st.size;
}

async function main() {
  console.log('Gerando pacotes offline...');
  console.log(
    `Tamanho-alvo por parte: até ${(MAX_PART_BYTES / 1024 / 1024).toFixed(2)} MiB (soma dos PDFs). Ajuste com OFFLINE_PACKAGE_MAX_BYTES.`
  );

  const manifestPath = await resolveLouvoresManifestPath();
  console.log(`Manifest de louvores: ${manifestPath}`);

  const assetsDir = await resolveAssetsDir();
  console.log(`Diretório de assets: ${assetsDir}`);

  const packagesDir = path.join(path.dirname(assetsDir), 'packages');
  await fs.mkdir(packagesDir, { recursive: true });

  const louvores = await readManifest(manifestPath);
  const grouped = categorizeLouvores(louvores);

  /** @type {Record<string, { parts: object[], totalSize: number, totalParts: number }>} */
  const packages = {};

  for (const group of grouped) {
    const files = await validateAndCollectFiles(group.entries, assetsDir);
    const chunks = chunkFilesByMaxBytes(files, MAX_PART_BYTES);
    const manifestCategory = group.manifestCategory;
    const parts = [];
    let categoryBytes = 0;

    for (let i = 0; i < chunks.length; i++) {
      const batch = chunks[i];
      const filename = partFilename(group, i + 1, chunks.length);
      const outputPath = path.join(packagesDir, filename);
      const zipSizeOnDisk = await buildZip(outputPath, batch);
      if (zipSizeOnDisk === 0) {
        continue;
      }
      categoryBytes += zipSizeOnDisk;

      parts.push({
        filename,
        size: zipSizeOnDisk,
        url: `/packages/${filename}`,
        pdfs: batch.map((f) => f.pdfId)
      });

      console.log(
        `  ${manifestCategory} parte ${i + 1}/${chunks.length}: ${filename} — ${batch.length} PDFs, zip ${(zipSizeOnDisk / 1024 / 1024).toFixed(2)} MiB`
      );
    }

    packages[manifestCategory] = {
      parts,
      totalSize: categoryBytes,
      totalParts: parts.length
    };
  }

  const offlineManifest = {
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    packages
  };

  const json = JSON.stringify(offlineManifest, null, 2);
  const staticOut = path.join(projectRoot, 'static', 'offline-manifest.json');
  const rootOut = path.join(projectRoot, 'offline-manifest.json');

  await fs.mkdir(path.dirname(staticOut), { recursive: true });
  await fs.writeFile(staticOut, json, 'utf8');
  await fs.writeFile(rootOut, json, 'utf8');

  console.log(`offline-manifest.json escrito em:\n  ${staticOut}\n  ${rootOut}`);
  console.log('Pacotes em:', packagesDir);
  console.log('Concluído.');
}

main().catch((error) => {
  console.error('Erro ao gerar pacotes offline:', error);
  process.exitCode = 1;
});
