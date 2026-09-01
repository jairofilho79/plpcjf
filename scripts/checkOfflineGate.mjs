#!/usr/bin/env node
/**
 * Portão de tipos para src/lib/offline/**.
 *
 * `npm run check` verifica o projeto inteiro e falha por causa de mais de mil
 * erros em áreas fora do escopo desta tarefa (#20) — uma checagem que nunca
 * passa equivale a não ter checagem. Este script roda o MESMO svelte-check
 * do projeto inteiro (mesmo tsconfig.json, sem tsconfig separado: testado em
 * 2026-08-31, um tsconfig com `include` restrito a src/lib/offline perde
 * contexto ambiente do projeto e troca 640 erros por 872, incluindo classes
 * que não existem no check real) e falha só se sobrar diagnóstico em
 * src/lib/offline/**.
 *
 * Ao zerar uma pasta nova, acrescente o prefixo dela em TARGET_PREFIXES.
 */
import { spawnSync } from 'node:child_process';

const TARGET_PREFIXES = ['src/lib/offline/'];

const result = spawnSync(
  'svelte-check',
  ['--tsconfig', './tsconfig.json', '--output', 'machine'],
  { encoding: 'utf8', shell: true, maxBuffer: 1024 * 1024 * 50 }
);

const lines = (result.stdout || '').split('\n');
const hits = lines.filter((line) => {
  const match = line.match(/^\d+ (ERROR|WARNING) "([^"]+)"/);
  if (!match) return false;
  return TARGET_PREFIXES.some((prefix) => match[2].startsWith(prefix));
});

if (hits.length > 0) {
  console.error(`check:offline encontrou ${hits.length} diagnóstico(s) em src/lib/offline/**:\n`);
  hits.forEach((line) => console.error(line));
  process.exit(1);
}

// Sai 0 aqui incondicionalmente: `result.status` reflete o svelte-check do
// projeto INTEIRO (hoje 1, por causa de erros fora do escopo desta tarefa —
// ver o comentário no topo do arquivo), não o subconjunto que este gate
// verifica. Amarrar o exit code a `result.status` faria o gate falhar sempre,
// mesmo com zero diagnósticos em src/lib/offline/**, o oposto do que existe
// para fazer.
console.log('check:offline: 0 diagnósticos em src/lib/offline/**.');
process.exit(0);
