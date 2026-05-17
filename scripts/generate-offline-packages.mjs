import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZipFile } from 'yazl';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(projectRoot, 'static', 'louvores-manifest.json');

const GROUPS = [
  { id: 'partitura', keyword: 'partitura', filename: 'Partitura.zip' },
  { id: 'cifra', keyword: 'cifra', filename: 'Cifra.zip' },
  { id: 'gestos', keyword: 'gestos em gravura', filename: 'Gestos-em-Gravura.zip' }
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

async function readManifest() {
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

    for (const group of lowerKeywordGroups) {
      if (category.includes(group.keyword)) {
        group.entries.set(pdfPath, {
          louvor,
          pdfPath
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

async function validateAndCollectFiles(entriesMap, assetsDir) {
  const files = [];
  const normalizedAssetsDir = path.resolve(assetsDir);

  for (const [pdfPath, { louvor }] of entriesMap.entries()) {
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
    } catch {
      console.warn(`Arquivo não encontrado para '${louvor.nome || pdfPath}': ${pdfPath}`);
      continue;
    }

    files.push({
      pdfPath,
      absolutePath: resolvedAbsolute
    });
  }

  return files;
}

async function buildZip(outputPath, files) {
  if (files.length === 0) {
    console.warn(`Nenhum arquivo para ${path.basename(outputPath)} – zip não será criado.`);
    return false;
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
  return true;
}

async function main() {
  console.log('Gerando pacotes offline...');

  const assetsDir = await resolveAssetsDir();
  console.log(`Usando diretório de assets: ${assetsDir}`);

  const packagesDir = path.join(path.dirname(assetsDir), 'packages');
  await fs.mkdir(packagesDir, { recursive: true });

  const louvores = await readManifest();
  const grouped = categorizeLouvores(louvores);
  const summary = [];

  for (const group of grouped) {
    const files = await validateAndCollectFiles(group.entries, assetsDir);
    const outputPath = path.join(packagesDir, group.filename);
    const created = await buildZip(outputPath, files);
    summary.push({
      grupo: group.filename,
      arquivos: files.length,
      destino: outputPath,
      criado: created
    });
  }

  console.log('Resumo:');
  for (const item of summary) {
    const status = item.criado ? 'criado' : 'não criado';
    console.log(`- ${item.grupo}: ${item.arquivos} arquivos -> ${item.destino} (${status})`);
  }
  console.log('Concluído.');
}

main().catch((error) => {
  console.error('Erro ao gerar pacotes offline:', error);
  process.exitCode = 1;
});


