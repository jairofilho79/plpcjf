/**
 * Reordenação dos chips da playlist por ponteiro (dedo, rato ou caneta).
 * Run: node --test src/lib/utils/chipPointerReorder.test.js
 *
 * Este módulo é a única parte da interação que dá para provar sem DOM: dada a
 * geometria dos chips e a posição do ponteiro, para que índice vai o chip
 * arrastado. O resto (captura de ponteiro, foco, classes CSS) vive no
 * componente e está declarado como verificado por leitura no relatório.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTargetIndex,
  computeKeyboardTarget,
  hasPassedDragThreshold,
  DRAG_MOVE_THRESHOLD_PX
} from './chipPointerReorder.js';

/**
 * Três chips de 100px lado a lado com 10px de intervalo, como na lista
 * horizontal: centros em 50, 160 e 270.
 * @returns {Array<{left:number,right:number,top:number,bottom:number}>}
 */
function chipsHorizontais() {
  return [
    { left: 0, right: 100, top: 200, bottom: 240 },
    { left: 110, right: 210, top: 200, bottom: 240 },
    { left: 220, right: 320, top: 200, bottom: 240 }
  ];
}

/** Três chips empilhados (lista expandida): centros em y = 20, 70 e 120. */
function chipsVerticais() {
  return [
    { left: 0, right: 300, top: 0, bottom: 40 },
    { left: 0, right: 300, top: 50, bottom: 90 },
    { left: 0, right: 300, top: 100, bottom: 140 }
  ];
}

describe('resolveTargetIndex — para onde vai o chip arrastado', () => {
  it('devolve null quando não há chips', () => {
    assert.equal(resolveTargetIndex([], { x: 10, y: 10 }, 'x'), null);
    assert.equal(resolveTargetIndex(null, { x: 10, y: 10 }, 'x'), null);
  });

  it('mantém o índice de partida enquanto o dedo não sai do próprio chip', () => {
    assert.equal(resolveTargetIndex(chipsHorizontais(), { x: 50, y: 220 }, 'x'), 0);
    assert.equal(resolveTargetIndex(chipsHorizontais(), { x: 160, y: 220 }, 'x'), 1);
  });

  it('troca de alvo quando o dedo passa o centro do chip vizinho', () => {
    const rects = chipsHorizontais();
    // Fronteira entre o chip 0 e o 1 é o ponto médio dos centros: 105.
    assert.equal(resolveTargetIndex(rects, { x: 104, y: 220 }, 'x'), 0);
    assert.equal(resolveTargetIndex(rects, { x: 106, y: 220 }, 'x'), 1);
  });

  it('escolhe o vizinho mais próximo quando o dedo cai no intervalo entre chips', () => {
    const rects = chipsHorizontais();
    // x=108 está no vão de 10px entre os chips 0 e 1, mas mais perto do 1.
    assert.equal(resolveTargetIndex(rects, { x: 108, y: 220 }, 'x'), 1);
  });

  it('fixa-se nos extremos quando o dedo sai da lista pelas pontas', () => {
    const rects = chipsHorizontais();
    assert.equal(resolveTargetIndex(rects, { x: -500, y: 220 }, 'x'), 0);
    assert.equal(resolveTargetIndex(rects, { x: 5000, y: 220 }, 'x'), 2);
  });

  it('ignora o eixo secundário: o dedo pode fugir para cima da lista sem perder o alvo', () => {
    const rects = chipsHorizontais();
    assert.equal(resolveTargetIndex(rects, { x: 270, y: -900 }, 'x'), 2);
    assert.equal(resolveTargetIndex(rects, { x: 270, y: 9000 }, 'x'), 2);
  });

  it('usa top/bottom quando a lista está expandida (eixo vertical)', () => {
    const rects = chipsVerticais();
    assert.equal(resolveTargetIndex(rects, { x: 150, y: 20 }, 'y'), 0);
    assert.equal(resolveTargetIndex(rects, { x: 150, y: 120 }, 'y'), 2);
    // Fronteira entre 0 e 1: ponto médio dos centros = 45.
    assert.equal(resolveTargetIndex(rects, { x: 150, y: 44 }, 'y'), 0);
    assert.equal(resolveTargetIndex(rects, { x: 150, y: 46 }, 'y'), 1);
  });

  it('desempata para o índice mais baixo, para o alvo não oscilar em cima da fronteira', () => {
    const rects = chipsHorizontais();
    assert.equal(resolveTargetIndex(rects, { x: 105, y: 220 }, 'x'), 0);
  });

  it('respeita larguras diferentes: manda no centro de cada chip, não na ordem', () => {
    /** Um chip largo seguido de um estreito. */
    const rects = [
      { left: 0, right: 400, top: 0, bottom: 40 }, // centro 200
      { left: 410, right: 460, top: 0, bottom: 40 } // centro 435
    ];
    assert.equal(resolveTargetIndex(rects, { x: 300, y: 20 }, 'x'), 0);
    assert.equal(resolveTargetIndex(rects, { x: 320, y: 20 }, 'x'), 1);
  });

  it('salta referências vazias — um chip ainda por montar não engole o gesto', () => {
    const rects = [null, { left: 110, right: 210, top: 0, bottom: 40 }, undefined];
    assert.equal(resolveTargetIndex(rects, { x: 0, y: 0 }, 'x'), 1);
  });

  it('devolve null se nenhuma referência estiver montada', () => {
    assert.equal(resolveTargetIndex([null, undefined], { x: 0, y: 0 }, 'x'), null);
  });
});

describe('computeKeyboardTarget — reordenar sem rato nem dedo', () => {
  it('move para trás com seta esquerda e seta cima', () => {
    assert.equal(computeKeyboardTarget(2, 'ArrowLeft', 5), 1);
    assert.equal(computeKeyboardTarget(2, 'ArrowUp', 5), 1);
  });

  it('move para a frente com seta direita e seta baixo', () => {
    assert.equal(computeKeyboardTarget(2, 'ArrowRight', 5), 3);
    assert.equal(computeKeyboardTarget(2, 'ArrowDown', 5), 3);
  });

  it('não sai da lista pelas pontas', () => {
    assert.equal(computeKeyboardTarget(0, 'ArrowLeft', 5), null);
    assert.equal(computeKeyboardTarget(4, 'ArrowRight', 5), null);
  });

  it('Home e End saltam para as pontas', () => {
    assert.equal(computeKeyboardTarget(3, 'Home', 5), 0);
    assert.equal(computeKeyboardTarget(1, 'End', 5), 4);
  });

  it('Home no primeiro e End no último não são movimento nenhum', () => {
    assert.equal(computeKeyboardTarget(0, 'Home', 5), null);
    assert.equal(computeKeyboardTarget(4, 'End', 5), null);
  });

  it('ignora teclas que não são de reordenação', () => {
    assert.equal(computeKeyboardTarget(2, 'Enter', 5), null);
    assert.equal(computeKeyboardTarget(2, ' ', 5), null);
    assert.equal(computeKeyboardTarget(2, 'a', 5), null);
  });

  it('rejeita índices impossíveis em vez de mexer no store', () => {
    assert.equal(computeKeyboardTarget(-1, 'ArrowRight', 5), null);
    assert.equal(computeKeyboardTarget(5, 'ArrowLeft', 5), null);
    assert.equal(computeKeyboardTarget(1.5, 'ArrowLeft', 5), null);
    assert.equal(computeKeyboardTarget(0, 'ArrowRight', 1), null);
    assert.equal(computeKeyboardTarget(0, 'ArrowRight', 0), null);
  });
});

describe('hasPassedDragThreshold — distinguir arrasto de toque trémulo', () => {
  it('o tremor do dedo pousado não conta como arrasto', () => {
    assert.equal(hasPassedDragThreshold(0, 0), false);
    assert.equal(hasPassedDragThreshold(3, 3), false); // ~4.24px
    assert.equal(hasPassedDragThreshold(-4, 4), false); // ~5.66px
  });

  it('passa o limiar assim que o dedo anda de verdade, sem esperar tempo nenhum', () => {
    assert.equal(hasPassedDragThreshold(DRAG_MOVE_THRESHOLD_PX, 0), true);
    assert.equal(hasPassedDragThreshold(0, -DRAG_MOVE_THRESHOLD_PX), true);
    assert.equal(hasPassedDragThreshold(40, 0), true);
  });

  it('mede a distância em linha reta, não por eixo', () => {
    // 5 e 5 dão 7.07px: um movimento diagonal curto já é arrasto.
    assert.equal(hasPassedDragThreshold(5, 5), true);
  });

  it('aceita um limiar próprio', () => {
    assert.equal(hasPassedDragThreshold(10, 0, 20), false);
    assert.equal(hasPassedDragThreshold(30, 0, 20), true);
  });
});
