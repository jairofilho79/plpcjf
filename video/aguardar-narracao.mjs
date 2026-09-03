#!/usr/bin/env node
/**
 * Espera os modelos de áudio voltarem e narra os roteiros pedidos.
 *
 * A narração é o único passo do pipeline que depende de rede. Separá-la assim
 * permite que uma indisponibilidade do OpenRouter — que já aconteceu duas vezes
 * a meio de uma gravação — não obrigue ninguém a ficar a vigiar: o vigia espera,
 * e quando o serviço volta grava todas as vozes em cache. Gravar, legendar e
 * montar seguem depois, offline.
 *
 * Uso: node video/aguardar-narracao.mjs 01-uso-basico 02-offline ...
 */
import { pathToFileURL } from 'node:url';
import { escolherModelo } from './lib/vozes.mjs';
import { narrar } from './narrar.mjs';

const INTERVALO_MS = 180000;   // 3 min entre sondagens
const JANELA_MS = 3 * 3600000; // desiste ao fim de 3 horas

function agora() {
  return new Date().toLocaleTimeString('pt-BR');
}

async function aguardar() {
  const limite = Date.now() + JANELA_MS;
  let tentativa = 0;

  while (Date.now() < limite) {
    tentativa++;
    try {
      const modelo = await escolherModelo('alloy');
      process.stderr.write(`[${agora()}] disponível na sondagem ${tentativa}: ${modelo}\n`);
      return modelo;
    } catch {
      const faltam = Math.round((limite - Date.now()) / 60000);
      process.stderr.write(`[${agora()}] sondagem ${tentativa}: ainda fora (desisto em ${faltam} min)\n`);
      await new Promise((r) => setTimeout(r, INTERVALO_MS));
    }
  }
  throw new Error(`os modelos de áudio não voltaram em ${JANELA_MS / 3600000} h`);
}

async function principal(ids) {
  const limite = Date.now() + JANELA_MS;
  const pendentes = [...ids];
  const feitos = [];

  // Insiste até conseguir, e não só até o serviço responder uma vez.
  //
  // A primeira versão sondava, encontrava o serviço de pé, e chamava a
  // narração — que falhava a meio porque o serviço tinha voltado a cair, e aí
  // desistia. Num serviço que oscila de minuto a minuto isso é a diferença
  // entre funcionar e não funcionar. Cada volta aproveita tudo o que já ficou
  // em cache na volta anterior, então repetir é barato.
  while (pendentes.length && Date.now() < limite) {
    await aguardar();

    for (const id of [...pendentes]) {
      try {
        process.stderr.write(`\n[${agora()}] narrando ${id}\n`);
        await narrar(id);
        feitos.push(id);
        pendentes.splice(pendentes.indexOf(id), 1);
      } catch (e) {
        process.stderr.write(`[${agora()}] ${id} não completou: ${e.message.split('\n')[0]}\n`);
      }
    }

    if (pendentes.length) {
      const faltam = Math.round((limite - Date.now()) / 60000);
      process.stderr.write(`[${agora()}] ainda faltam ${pendentes.join(', ')} — nova volta (desisto em ${faltam} min)\n`);
      await new Promise((r) => setTimeout(r, INTERVALO_MS));
    }
  }

  process.stderr.write(`\n[${agora()}] narrados: ${feitos.join(', ') || 'nenhum'}\n`);
  if (pendentes.length) process.stderr.write(`[${agora()}] não completaram: ${pendentes.join(', ')}\n`);
  return { feitos, falhados: pendentes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    process.stderr.write('uso: node video/aguardar-narracao.mjs <id> [<id>...]\n');
    process.exit(2);
  }
  principal(ids).catch((e) => {
    process.stderr.write(`falhou: ${e.message}\n`);
    process.exit(1);
  });
}
