/**
 * Gestos de toque do leitor: swipe horizontal de página e pinch-to-zoom.
 * Run: node --test src/lib/utils/pdfTouchGestures.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPdfTouchGestureHandlers } from './pdfTouchGestures.js';

// applyPinchPreview/commitPinch usam requestAnimationFrame para o preview via
// CSS transform e para reaplicar o scroll após o commit; Node não tem essa
// API global. Um polyfill síncrono é suficiente para os testes: não há
// animação real para observar, só o efeito final.
let originalRaf;
let originalCaf;
// trySwipePageTurn usa performance.now() duas vezes: para medir a duração do
// gesto e para o cooldown entre swipes (lastSwipePageTurnAt começa em 0 no
// módulo). Num processo Node recém-iniciado performance.now() já pode valer
// só ~40ms — menos que o cooldown de 250ms — e bloquearia o primeiro swipe
// do teste por um motivo que não existe no navegador real (lá o relógio já
// está bem à frente de 0 quando o usuário consegue tocar na tela). Um
// relógio falso e controlável remove essa dependência do tempo real.
let originalPerformanceNow;
let fakeNow;
beforeEach(() => {
  originalRaf = globalThis.requestAnimationFrame;
  originalCaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
  globalThis.cancelAnimationFrame = () => {};

  originalPerformanceNow = globalThis.performance.now;
  fakeNow = 100000; // bem à frente de 0, evita bloqueio espúrio de cooldown
  globalThis.performance.now = () => fakeNow;
});
afterEach(() => {
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.cancelAnimationFrame = originalCaf;
  globalThis.performance.now = originalPerformanceNow;
});

/** @param {number} ms */
function advanceTime(ms) {
  fakeNow += ms;
}

function makeContainerEl({ left = 0, top = 0, width = 400, height = 800 } = {}) {
  return {
    scrollLeft: 0,
    scrollTop: 0,
    getBoundingClientRect: () => ({ left, top, width, height })
  };
}

function makeViewerEl() {
  return { style: {} };
}

function makeDeps(overrides = {}) {
  const viewer = { currentScale: 1 };
  const containerEl = makeContainerEl();
  const viewerEl = makeViewerEl();
  const calls = { cancelScheduled: 0, setUserScale: [] };
  const zoomCtrl = {
    cancelScheduled: () => { calls.cancelScheduled++; },
    setUserScale: (s) => { calls.setUserScale.push(s); }
  };
  const nextPageCalls = [];
  const prevPageCalls = [];
  const deps = {
    getViewer: () => viewer,
    getContainerEl: () => containerEl,
    getViewerEl: () => viewerEl,
    getNavigationMode: () => 'horizontal',
    getPreferredFitMode: () => 'page-fit',
    zoomCtrl,
    nextPage: () => nextPageCalls.push(true),
    prevPage: () => prevPageCalls.push(true),
    ...overrides
  };
  return { deps, viewer, containerEl, viewerEl, calls, nextPageCalls, prevPageCalls };
}

/** @param {number} x @param {number} y */
function touch(x, y) {
  return { clientX: x, clientY: y };
}

/** Fake TouchEvent: touches/changedTouches como listas simples + preventDefault no-op. */
function fakeTouchEvent(overrides = {}) {
  return { type: 'touchstart', touches: [], preventDefault: () => {}, ...overrides };
}

describe('createPdfTouchGestureHandlers — swipe horizontal', () => {
  it('swipe rápido para a esquerda vira para a próxima página', () => {
    const { deps, nextPageCalls, prevPageCalls } = makeDeps();
    const { onTouchStart, onTouchEnd } = createPdfTouchGestureHandlers(deps);

    onTouchStart(fakeTouchEvent({ touches: [touch(300, 400)] }));
    advanceTime(50); // gesto rápido, bem abaixo de SWIPE_MAX_DURATION_MS
    onTouchEnd(fakeTouchEvent({
      type: 'touchend',
      touches: [],
      changedTouches: [touch(150, 400)] // dx = -150: esquerda
    }));

    assert.equal(nextPageCalls.length, 1);
    assert.equal(prevPageCalls.length, 0);
  });

  it('swipe rápido para a direita volta para a página anterior', () => {
    const { deps, nextPageCalls, prevPageCalls } = makeDeps();
    const { onTouchStart, onTouchEnd } = createPdfTouchGestureHandlers(deps);

    onTouchStart(fakeTouchEvent({ touches: [touch(100, 400)] }));
    advanceTime(50);
    onTouchEnd(fakeTouchEvent({
      type: 'touchend',
      touches: [],
      changedTouches: [touch(250, 400)] // dx = +150: direita
    }));

    assert.equal(prevPageCalls.length, 1);
    assert.equal(nextPageCalls.length, 0);
  });

  it('movimento abaixo do limiar de distância não vira página', () => {
    const { deps, nextPageCalls, prevPageCalls } = makeDeps();
    const { onTouchStart, onTouchEnd } = createPdfTouchGestureHandlers(deps);

    onTouchStart(fakeTouchEvent({ touches: [touch(300, 400)] }));
    advanceTime(50);
    onTouchEnd(fakeTouchEvent({
      type: 'touchend',
      touches: [],
      changedTouches: [touch(340, 400)] // dx = -40: menor que SWIPE_MIN_DISTANCE_PX (80)
    }));

    assert.equal(nextPageCalls.length, 0);
    assert.equal(prevPageCalls.length, 0);
  });

  it('gesto majoritariamente vertical não vira página (razão horizontal/vertical)', () => {
    const { deps, nextPageCalls, prevPageCalls } = makeDeps();
    const { onTouchStart, onTouchEnd } = createPdfTouchGestureHandlers(deps);

    onTouchStart(fakeTouchEvent({ touches: [touch(300, 400)] }));
    advanceTime(50);
    onTouchEnd(fakeTouchEvent({
      type: 'touchend',
      touches: [],
      changedTouches: [touch(150, 550)] // dx=-150, dy=+150: não é majoritariamente horizontal
    }));

    assert.equal(nextPageCalls.length, 0);
    assert.equal(prevPageCalls.length, 0);
  });

  it('gesto lento demais (acima de SWIPE_MAX_DURATION_MS) não vira página', () => {
    const { deps, nextPageCalls, prevPageCalls } = makeDeps();
    const { onTouchStart, onTouchEnd } = createPdfTouchGestureHandlers(deps);

    onTouchStart(fakeTouchEvent({ touches: [touch(300, 400)] }));
    advanceTime(600); // acima de SWIPE_MAX_DURATION_MS (400ms)
    onTouchEnd(fakeTouchEvent({
      type: 'touchend',
      touches: [],
      changedTouches: [touch(150, 400)]
    }));

    assert.equal(nextPageCalls.length, 0);
    assert.equal(prevPageCalls.length, 0);
  });

  it('respeita o cooldown entre dois swipes consecutivos', () => {
    const { deps, nextPageCalls } = makeDeps();
    const { onTouchStart, onTouchEnd } = createPdfTouchGestureHandlers(deps);
    const swipeLeft = () => {
      onTouchStart(fakeTouchEvent({ touches: [touch(300, 400)] }));
      advanceTime(50);
      onTouchEnd(fakeTouchEvent({ type: 'touchend', touches: [], changedTouches: [touch(150, 400)] }));
    };

    swipeLeft();
    assert.equal(nextPageCalls.length, 1);

    // Segundo swipe logo em seguida (dentro do cooldown de 250ms): ignorado.
    advanceTime(50);
    swipeLeft();
    assert.equal(nextPageCalls.length, 1);

    // Terceiro swipe depois do cooldown: funciona de novo.
    advanceTime(300);
    swipeLeft();
    assert.equal(nextPageCalls.length, 2);
  });

  it('modo vertical desliga o swipe horizontal inteiramente', () => {
    const { deps, nextPageCalls, prevPageCalls } = makeDeps({ getNavigationMode: () => 'vertical' });
    const { onTouchStart, onTouchEnd } = createPdfTouchGestureHandlers(deps);

    onTouchStart(fakeTouchEvent({ touches: [touch(300, 400)] }));
    advanceTime(50);
    onTouchEnd(fakeTouchEvent({
      type: 'touchend',
      touches: [],
      changedTouches: [touch(100, 400)]
    }));

    assert.equal(nextPageCalls.length, 0);
    assert.equal(prevPageCalls.length, 0);
  });

  it('touchcancel não vira página mesmo com deslocamento suficiente', () => {
    const { deps, nextPageCalls, prevPageCalls } = makeDeps();
    const { onTouchStart, onTouchEnd } = createPdfTouchGestureHandlers(deps);

    onTouchStart(fakeTouchEvent({ touches: [touch(300, 400)] }));
    advanceTime(50);
    onTouchEnd(fakeTouchEvent({
      type: 'touchcancel',
      touches: [],
      changedTouches: [touch(100, 400)]
    }));

    assert.equal(nextPageCalls.length, 0);
    assert.equal(prevPageCalls.length, 0);
  });
});

describe('createPdfTouchGestureHandlers — pinch-to-zoom', () => {
  it('funciona mesmo em modo vertical (2 dedos tem prioridade sobre o modo de navegação)', () => {
    const { deps, calls } = makeDeps({ getNavigationMode: () => 'vertical' });
    const { onTouchStart } = createPdfTouchGestureHandlers(deps);

    onTouchStart(fakeTouchEvent({ touches: [touch(100, 300), touch(200, 300)] }));

    // zoomCtrl.cancelScheduled só é chamado dentro de startPinch — prova que o
    // pinch iniciou mesmo com getNavigationMode() === 'vertical'.
    assert.equal(calls.cancelScheduled, 1);
  });

  it('afastar os dedos aumenta a escala e comita um valor final no viewer', () => {
    const { deps, viewer, calls } = makeDeps();
    const { onTouchStart, onTouchMove, onTouchEnd } = createPdfTouchGestureHandlers(deps);

    onTouchStart(fakeTouchEvent({ touches: [touch(150, 300), touch(250, 300)] })); // distância inicial 100
    onTouchMove(fakeTouchEvent({ type: 'touchmove', touches: [touch(100, 300), touch(300, 300)] })); // distância 200 → ratio 2
    onTouchEnd(fakeTouchEvent({ type: 'touchend', touches: [] })); // solta os dois dedos → commitPinch

    // pinchInitialScale (1) * ratio (2) = 2, dentro do clamp [0.25, 4]
    assert.equal(viewer.currentScale, 2);
    assert.deepEqual(calls.setUserScale, [2]);
  });

  it('não comita duas vezes se onTouchEnd for chamado de novo sem novo pinch', () => {
    const { deps, calls } = makeDeps();
    const { onTouchStart, onTouchEnd } = createPdfTouchGestureHandlers(deps);

    onTouchStart(fakeTouchEvent({ touches: [touch(150, 300), touch(250, 300)] }));
    onTouchEnd(fakeTouchEvent({ type: 'touchend', touches: [] }));
    onTouchEnd(fakeTouchEvent({ type: 'touchend', touches: [] }));

    assert.equal(calls.setUserScale.length, 1);
  });
});
