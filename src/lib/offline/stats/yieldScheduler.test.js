/**
 * O cedente por orçamento de tempo.
 * Run: node --test src/lib/offline/stats/yieldScheduler.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { criarCedente, escolherAgendador } from './yieldScheduler.js';

/**
 * Agendador de teste: conta as cedências reais e resolve no microtask seguinte.
 * @returns {{ cedencias: number, agendar: (callback: () => void) => void }}
 */
function agendadorContado() {
  const estado = {
    cedencias: 0,
    agendar: (/** @type {() => void} */ callback) => {
      estado.cedencias++;
      queueMicrotask(callback);
    }
  };
  return estado;
}

describe('criarCedente', () => {
  it('não cede enquanto o orçamento não estoura, por mais chamadas que receba', async () => {
    const agendador = agendadorContado();
    const cedente = criarCedente({ orcamentoMs: 60_000, agendar: agendador.agendar });

    for (let i = 0; i < 5000; i++) {
      await cedente.talvezCeder();
    }

    assert.equal(agendador.cedencias, 0);
  });

  it('cede assim que o orçamento estoura', async () => {
    const agendador = agendadorContado();
    let agora = 0;
    const cedente = criarCedente({
      orcamentoMs: 16,
      agendar: agendador.agendar,
      agora: () => agora
    });

    await cedente.talvezCeder();
    assert.equal(agendador.cedencias, 0, 'no instante zero não há o que ceder');

    agora = 16;
    await cedente.talvezCeder();
    assert.equal(agendador.cedencias, 0, 'exatamente no orçamento ainda não cede');

    agora = 17;
    await cedente.talvezCeder();
    assert.equal(agendador.cedencias, 1);

    // O orçamento recomeça na cedência: logo depois dela, não cede de novo.
    await cedente.talvezCeder();
    assert.equal(agendador.cedencias, 1);

    agora = 34;
    await cedente.talvezCeder();
    assert.equal(agendador.cedencias, 2);
  });

  it('com o relógio real também cede quando o orçamento estoura', async () => {
    const agendador = agendadorContado();
    const cedente = criarCedente({ orcamentoMs: 1, agendar: agendador.agendar });

    await new Promise((resolve) => setTimeout(resolve, 10));
    await cedente.talvezCeder();

    assert.equal(agendador.cedencias, 1);
  });

  it('numa varredura de 4629 louvores cede muito menos que 95 — e cede mesmo quando o trabalho é lento', async () => {
    // 95 é o número de esperas de hoje — uma por chunk de 50, cada uma travada
    // em 1 s pelo clamp do Chrome em aba não visível.
    //
    // As duas metades importam. Só o limite superior seria satisfeito por um
    // cedente que nunca cede — que é o pior resultado possível, não o melhor.
    // Só o inferior não diria nada sobre o ganho. Aqui o mesmo cedente é
    // exercitado nas duas pontas: laço rápido (este Mac) e laço lento
    // (dispositivo 100x mais lento, simulado escalando o relógio).

    /** @param {number} fator @returns {Promise<number>} */
    async function varrer(fator) {
      const agendador = agendadorContado();
      const base = performance.now();
      const cedente = criarCedente({
        orcamentoMs: 16,
        agendar: agendador.agendar,
        agora: () => base + (performance.now() - base) * fator
      });
      let soma = 0;
      for (let i = 0; i < 4629; i++) {
        soma += i % 7;
        await cedente.talvezCeder();
      }
      assert.equal(soma > 0, true);
      return agendador.cedencias;
    }

    const rapido = await varrer(1);
    assert.equal(
      rapido < 95,
      true,
      `laço rápido cedeu ${rapido} vezes; hoje são 95 esperas de 1 s`
    );

    const lento = await varrer(100);
    assert.equal(lento >= 1, true, 'com o trabalho lento o cedente tem de ceder alguma vez');
    assert.equal(
      lento < 95,
      true,
      `mesmo 100x mais lento cedeu ${lento} vezes, e deviam ser menos que 95`
    );
  });

  it('a promessa devolvida quando não cede já vem resolvida', async () => {
    const cedente = criarCedente({ orcamentoMs: 60_000, agendar: () => {} });
    const p = cedente.talvezCeder();
    assert.equal(p instanceof Promise, true);
    // Se ela dependesse do agendador (que aqui nunca chama de volta), este await
    // ficaria pendurado e o teste estouraria por timeout.
    await p;
  });
});

describe('escolherAgendador', () => {
  it('prefere MessageChannel quando existe — é ele que escapa ao clamp de 1 s', () => {
    assert.equal(escolherAgendador({ MessageChannel: globalThis.MessageChannel }).tipo, 'MessageChannel');
  });

  it('cai para setTimeout quando MessageChannel não existe', () => {
    assert.equal(escolherAgendador({}).tipo, 'setTimeout');
  });

  it('os dois agendadores chamam de volta', async () => {
    for (const escopo of [{ MessageChannel: globalThis.MessageChannel }, {}]) {
      const { agendar } = escolherAgendador(escopo);
      await new Promise((resolve) => agendar(() => resolve(undefined)));
    }
  });

  it('o padrão do ambiente atual é utilizável de ponta a ponta', async () => {
    const cedente = criarCedente({ orcamentoMs: 0 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await cedente.talvezCeder();
  });
});
