/**
 * Extrai uma fixture pequena e versionada de caminhos reais do acervo.
 *
 * O louvores-manifest.json (raiz do repo, ~4629 entradas) NÃO é versionado, e o
 * teste de caracterização precisa rodar em qualquer clone. Este script escolhe
 * um punhado de caminhos que cobrem as classes perigosas e grava o resultado em
 * src/lib/utils/fixtures/caminhos-acervo.json, que VAI para o git.
 *
 * Determinístico: ordena tudo antes de escolher, e escolhe sempre os primeiros
 * de cada classe. Mesma entrada, mesma saída byte a byte.
 *
 * Uso: node scripts/gerar-fixture-caminhos.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const MANIFESTO = 'louvores-manifest.json';
const SAIDA = 'src/lib/utils/fixtures/caminhos-acervo.json';

if (!fs.existsSync(MANIFESTO)) {
  console.error(`${MANIFESTO} não encontrado na raiz do repo. Peça-o ao dono do projeto.`);
  process.exit(1);
}

/** Replica computePdfRelPath (src/lib/utils/pathUtils.js:41-80) sem depender do Vite. */
function caminhoDoPdfId(pdfId) {
  let p = Buffer.from(pdfId, 'base64').toString('utf8').replace(/^\/+/, '').trim();
  if (!p.toLowerCase().startsWith('assets/')) p = `assets/${p}`;
  return p;
}

const dados = JSON.parse(fs.readFileSync(MANIFESTO, 'utf8'));
const caminhos = dados.map((l) => caminhoDoPdfId(l.pdfId)).sort();
const nomeArquivo = (p) => p.split('/').pop();

const repetidos = {};
for (const p of caminhos) {
  const b = nomeArquivo(p);
  repetidos[b] = (repetidos[b] || 0) + 1;
}

const primeiros = (predicado, n) => caminhos.filter(predicado).slice(0, n);

const grupos = {
  // Acento em forma decomposta: 'é' como 'e' + U+0301. normalizePdfUrl não os trata.
  nfd: caminhos.filter((p) => p !== p.normalize('NFC')),
  // encodeURI escapa [ e ]; o parser da URL não. É a divergência da Tarefa 5.
  colchetes: caminhos.filter((p) => p.includes('[')),
  // Nome de arquivo que é ele próprio Base64 — e Base64 é sensível à caixa.
  base64NoNome: primeiros((p) => /^[A-Za-z0-9+/]{24,}={0,2}\.pdf$/.test(nomeArquivo(p)), 3),
  acentoECedilha: primeiros((p) => /ç/.test(p) && /[áàãâéêíóôõú]/.test(p), 4),
  // Mesmo nome de arquivo, diretórios diferentes: 1036 caminhos se chamam 'Cifra I.pdf'.
  basenameRepetido: primeiros((p) => nomeArquivo(p) === 'Cifra I.pdf', 4),
  zeroAEsquerda: primeiros((p) => /\/0\d+\.pdf$/.test(p), 3),
  parenteses: primeiros((p) => p.includes('(') && p.includes(')'), 3),
  pontuacaoRara: [
    ...primeiros((p) => p.includes('’'), 1),
    ...primeiros((p) => p.includes('º'), 1),
    ...primeiros((p) => p.includes('&'), 1),
    ...primeiros((p) => p.includes('!'), 1),
    ...primeiros((p) => p.includes(','), 1)
  ],
  amostraUniforme: Array.from({ length: 12 }, (_, i) =>
    caminhos[Math.floor((i * caminhos.length) / 12)]
  )
};

// Um caminho só aparece uma vez, no primeiro grupo que o reivindicar.
const vistos = new Set();
for (const nome of Object.keys(grupos)) {
  grupos[nome] = grupos[nome].filter((p) => {
    if (vistos.has(p)) return false;
    vistos.add(p);
    return true;
  });
}

const fixture = {
  _comentario:
    'Gerado por scripts/gerar-fixture-caminhos.mjs a partir do louvores-manifest.json real. Não editar à mão.',
  totalNoAcervo: caminhos.length,
  nomesDeArquivoRepetidos: Object.values(repetidos).filter((n) => n > 1).length,
  grupos
};

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');

const total = Object.values(grupos).reduce((s, g) => s + g.length, 0);
console.log(`${SAIDA}: ${total} caminhos em ${Object.keys(grupos).length} grupos`);
for (const [nome, g] of Object.entries(grupos)) console.log(`  ${nome}: ${g.length}`);
