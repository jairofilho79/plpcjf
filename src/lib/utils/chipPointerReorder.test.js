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
  isPointerOutsideList,
  computeAutoScrollVelocity,
  isReorderKey,
  DRAG_MOVE_THRESHOLD_PX,
  DRAG_CANCEL_MARGIN_PX,
  AUTO_SCROLL_EDGE_PX,
  AUTO_SCROLL_MAX_SPEED_PX
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

/** Retângulo da lista que contém os chips horizontais, com folga de 5px. */
function listaHorizontal() {
  return { left: 0, right: 320, top: 195, bottom: 245 };
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

  it('sem fronteiras da lista não existe "fora": encosta aos extremos', () => {
    // Sem bounds o módulo não tem como saber onde a lista acaba; é este o
    // contrato para quem só quer o cálculo geométrico.
    const rects = chipsHorizontais();
    assert.equal(resolveTargetIndex(rects, { x: -500, y: 220 }, 'x'), 0);
    assert.equal(resolveTargetIndex(rects, { x: 5000, y: 220 }, 'x'), 2);
  });

  it('encosta ao último chip quando o dedo passa a ponta sem sair da lista', () => {
    // Empurrar um chip para o fim implica arrastar até depois do último; isso
    // é gesto legítimo e tem de continuar a apontar para o último índice.
    const rects = chipsHorizontais();
    const bounds = listaHorizontal();
    assert.equal(resolveTargetIndex(rects, { x: bounds.right + 10, y: 220 }, 'x', bounds), 2);
    assert.equal(resolveTargetIndex(rects, { x: bounds.left - 10, y: 220 }, 'x', bounds), 0);
  });

  it('desiste quando o dedo sai mesmo da lista — largar fora não reordena', () => {
    const rects = chipsHorizontais();
    const bounds = listaHorizontal();
    const m = DRAG_CANCEL_MARGIN_PX;
    // Longe pelas pontas.
    assert.equal(resolveTargetIndex(rects, { x: bounds.right + m + 1, y: 220 }, 'x', bounds), null);
    assert.equal(resolveTargetIndex(rects, { x: bounds.left - m - 1, y: 220 }, 'x', bounds), null);
    // E puxando o chip para fora da faixa, que é o gesto natural de "esquece".
    assert.equal(resolveTargetIndex(rects, { x: 160, y: bounds.top - m - 1 }, 'x', bounds), null);
    assert.equal(resolveTargetIndex(rects, { x: 160, y: bounds.bottom + m + 1 }, 'x', bounds), null);
  });

  it('em cima da margem ainda não é desistir', () => {
    const rects = chipsHorizontais();
    const bounds = listaHorizontal();
    assert.equal(
      resolveTargetIndex(rects, { x: bounds.right + DRAG_CANCEL_MARGIN_PX, y: 220 }, 'x', bounds),
      2
    );
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

describe('isPointerOutsideList — a saída de emergência do gesto', () => {
  it('dentro da lista não é fora', () => {
    assert.equal(isPointerOutsideList({ x: 160, y: 220 }, listaHorizontal()), false);
  });

  it('a folga da margem conta como dentro, em qualquer dos quatro lados', () => {
    const b = listaHorizontal();
    const m = DRAG_CANCEL_MARGIN_PX;
    assert.equal(isPointerOutsideList({ x: b.left - m, y: 220 }, b), false);
    assert.equal(isPointerOutsideList({ x: b.right + m, y: 220 }, b), false);
    assert.equal(isPointerOutsideList({ x: 160, y: b.top - m }, b), false);
    assert.equal(isPointerOutsideList({ x: 160, y: b.bottom + m }, b), false);
  });

  it('passar a margem é sair, em qualquer dos quatro lados', () => {
    const b = listaHorizontal();
    const m = DRAG_CANCEL_MARGIN_PX + 1;
    assert.equal(isPointerOutsideList({ x: b.left - m, y: 220 }, b), true);
    assert.equal(isPointerOutsideList({ x: b.right + m, y: 220 }, b), true);
    assert.equal(isPointerOutsideList({ x: 160, y: b.top - m }, b), true);
    assert.equal(isPointerOutsideList({ x: 160, y: b.bottom + m }, b), true);
  });

  it('sem retângulo da lista nunca está fora', () => {
    assert.equal(isPointerOutsideList({ x: -9999, y: -9999 }, null), false);
    assert.equal(isPointerOutsideList({ x: -9999, y: -9999 }, undefined), false);
  });

  it('aceita uma margem própria', () => {
    const b = listaHorizontal();
    assert.equal(isPointerOutsideList({ x: b.right + 20, y: 220 }, b, 10), true);
    assert.equal(isPointerOutsideList({ x: b.right + 20, y: 220 }, b, 30), false);
  });
});

describe('computeAutoScrollVelocity — alcançar os chips que não cabem no ecrã', () => {
  it('no meio da lista a lista não se mexe', () => {
    assert.equal(computeAutoScrollVelocity({ x: 160, y: 220 }, listaHorizontal(), 'x'), 0);
  });

  it('junto ao início puxa para trás, junto ao fim puxa para a frente', () => {
    const b = listaHorizontal();
    assert.ok(computeAutoScrollVelocity({ x: b.left + 10, y: 220 }, b, 'x') < 0);
    assert.ok(computeAutoScrollVelocity({ x: b.right - 10, y: 220 }, b, 'x') > 0);
  });

  it('acelera com a profundidade dentro da faixa, em vez de arrancar aos saltos', () => {
    const b = listaHorizontal();
    const pouco = computeAutoScrollVelocity({ x: b.right - AUTO_SCROLL_EDGE_PX + 8, y: 220 }, b, 'x');
    const muito = computeAutoScrollVelocity({ x: b.right - 4, y: 220 }, b, 'x');
    assert.ok(muito > pouco);
    assert.ok(pouco > 0);
  });

  it('não passa da velocidade máxima, mesmo com o dedo já fora', () => {
    const b = listaHorizontal();
    assert.equal(computeAutoScrollVelocity({ x: b.right + 500, y: 220 }, b, 'x'), AUTO_SCROLL_MAX_SPEED_PX);
    assert.equal(computeAutoScrollVelocity({ x: b.left - 500, y: 220 }, b, 'x'), -AUTO_SCROLL_MAX_SPEED_PX);
  });

  it('a fronteira exata da faixa ainda não rola', () => {
    const b = listaHorizontal();
    assert.equal(computeAutoScrollVelocity({ x: b.left + AUTO_SCROLL_EDGE_PX, y: 220 }, b, 'x'), 0);
    assert.equal(computeAutoScrollVelocity({ x: b.right - AUTO_SCROLL_EDGE_PX, y: 220 }, b, 'x'), 0);
  });

  it('na lista expandida rola na vertical e ignora o x', () => {
    const b = { left: 0, right: 300, top: 0, bottom: 400 };
    assert.ok(computeAutoScrollVelocity({ x: 9999, y: 5 }, b, 'y') < 0);
    assert.ok(computeAutoScrollVelocity({ x: -9999, y: 395 }, b, 'y') > 0);
    assert.equal(computeAutoScrollVelocity({ x: 150, y: 200 }, b, 'y'), 0);
  });

  it('sem lista, ou sem faixa, não há auto-scroll', () => {
    assert.equal(computeAutoScrollVelocity({ x: 0, y: 0 }, null, 'x'), 0);
    assert.equal(computeAutoScrollVelocity({ x: 0, y: 0 }, listaHorizontal(), 'x', 0), 0);
  });
});

describe('isReorderKey — o que a alça consome antes de saber se pode mover', () => {
  it('conhece as seis teclas de reordenação', () => {
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
      assert.equal(isReorderKey(k), true, k);
    }
  });

  it('deixa passar tudo o resto', () => {
    for (const k of ['Enter', ' ', 'Tab', 'Escape', 'a', 'PageDown']) {
      assert.equal(isReorderKey(k), false, k);
    }
  });

  it('é verdadeiro nas pontas, onde computeKeyboardTarget já não move nada', () => {
    // É esta a diferença que impede a seta de rolar a página no primeiro chip.
    assert.equal(isReorderKey('ArrowLeft'), true);
    assert.equal(computeKeyboardTarget(0, 'ArrowLeft', 5), null);
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
