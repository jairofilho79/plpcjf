// Reordenação dos chips da playlist por ponteiro (dedo, rato ou caneta).
//
// Porquê um módulo à parte: o CarouselChips.svelte trocou o drag-and-drop
// nativo do HTML5 por Pointer Events, e a parte que decide *para onde* o chip
// vai é a única que se consegue provar sem DOM — não depende de captura de
// ponteiro, de classes CSS nem de foco. Fica aqui, testada a sério; o
// componente só lhe entrega geometria e recebe um índice.
//
// Semântica do índice devolvido: é o índice de destino tal como
// `carousel.reorderCarousel(de, para)` o entende — remover o item da posição
// `de` e reinseri-lo na posição `para` da lista já sem ele. Ou seja, "o chip
// arrastado ocupa o lugar daquele em que o dedo está pousado", que é
// exatamente o que o utilizador vê.

/**
 * Distância mínima, em pixels, entre o pousar e o mover para o gesto contar
 * como arrasto. Não é uma espera: é só o filtro do tremor de quem pousa o dedo
 * — a decisão de produto é arrancar a 0 ms, e 6px percorrem-se num instante.
 * O valor é da ordem dos 5px que o handler antigo de `drag` já usava.
 */
export const DRAG_MOVE_THRESHOLD_PX = 6;

/**
 * A que distância das fronteiras da lista o arrasto passa a ser desistência.
 * O drag-and-drop nativo que saiu daqui não reordenava se se largasse fora da
 * lista, e essa saída não se podia perder: quem se engana a meio do gesto tem
 * de conseguir abortá-lo. A margem é generosa de propósito — arrastar até à
 * ponta da lista para empurrar um chip para o fim é gesto legítimo e não pode
 * ser confundido com desistir.
 */
export const DRAG_CANCEL_MARGIN_PX = 48;

/** Faixa junto às bordas da lista onde o arrasto começa a arrastar a lista. */
export const AUTO_SCROLL_EDGE_PX = 56;

/** Velocidade máxima do auto-scroll, em pixels por frame. */
export const AUTO_SCROLL_MAX_SPEED_PX = 18;

/**
 * @typedef {{ left: number, right: number, top: number, bottom: number }} Rect
 */

/**
 * O ponteiro saiu da lista ao ponto de o gesto dever ser abandonado?
 *
 * @param {{ x: number, y: number }} point
 * @param {Rect | null | undefined} bounds retângulo da lista
 * @param {number} [margin]
 */
export function isPointerOutsideList(point, bounds, margin = DRAG_CANCEL_MARGIN_PX) {
  if (!bounds) return false;
  return (
    point.x < bounds.left - margin ||
    point.x > bounds.right + margin ||
    point.y < bounds.top - margin ||
    point.y > bounds.bottom + margin
  );
}

/**
 * Decide em que chip o ponteiro está pousado, e portanto para que índice vai o
 * chip arrastado. Devolve null quando não há destino — nem chips medíveis, nem
 * ponteiro dentro da lista —, e null significa sempre "não reordenes".
 *
 * Compara com o *centro* de cada chip em vez de perguntar "está dentro deste
 * retângulo?": os chips têm larguras diferentes e há um vão de 0.5rem entre
 * eles, e um teste de contenção deixaria esses vãos como zonas mortas onde o
 * alvo desaparecia a meio do gesto. Pelo centro mais próximo não há buracos, e
 * a fronteira entre dois chips cai no ponto médio dos seus centros — que é
 * onde o olho a espera.
 *
 * Só o eixo principal da lista conta para escolher o chip. Na lista horizontal
 * o dedo costuma derivar um pouco para fora da faixa dos chips enquanto
 * arrasta, e perder o alvo por causa disso seria uma frustração sem motivo —
 * é para isso que a desistência tem margem própria, bem maior.
 *
 * @param {Array<Rect | null | undefined> | null | undefined} rects geometria dos chips, na ordem da lista
 * @param {{ x: number, y: number }} point posição do ponteiro, em coordenadas de viewport
 * @param {'x' | 'y'} axis eixo da lista: 'x' encolhida, 'y' expandida
 * @param {Rect | null} [bounds] retângulo da lista; sem ele não existe "fora"
 * @returns {number | null} índice de destino, ou null para não reordenar
 */
export function resolveTargetIndex(rects, point, axis, bounds = null) {
  if (!Array.isArray(rects) || rects.length === 0) return null;
  if (isPointerOutsideList(point, bounds)) return null;

  const coord = axis === 'y' ? point.y : point.x;

  /** @type {number | null} */
  let closestIndex = null;
  let closestDistance = Infinity;

  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    // Um chip ainda sem referência montada não pode roubar o alvo.
    if (!rect) continue;

    const center = axis === 'y' ? (rect.top + rect.bottom) / 2 : (rect.left + rect.right) / 2;
    const distance = Math.abs(coord - center);

    // Comparação estrita: em cima da fronteira ganha o índice mais baixo, e o
    // alvo fica estável em vez de piscar entre dois chips.
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = i;
    }
  }

  return closestIndex;
}

/**
 * Quanto deve a lista rolar sozinha, em pixels por frame, enquanto o ponteiro
 * está junto a uma das suas bordas.
 *
 * Sem isto o gesto só serve para listas que cabem no ecrã: numa playlist longa
 * o utilizador teria de largar o chip, rolar, e voltar a pegar-lhe — que é
 * precisamente a dificuldade que viemos resolver. A velocidade sobe com a
 * profundidade dentro da faixa, para o arranque não ser um salto.
 *
 * @param {{ x: number, y: number }} point
 * @param {Rect | null | undefined} bounds retângulo da lista
 * @param {'x' | 'y'} axis
 * @param {number} [edge] largura da faixa sensível
 * @param {number} [maxSpeed]
 * @returns {number} negativo para o início da lista, positivo para o fim, 0 no meio
 */
export function computeAutoScrollVelocity(
  point,
  bounds,
  axis,
  edge = AUTO_SCROLL_EDGE_PX,
  maxSpeed = AUTO_SCROLL_MAX_SPEED_PX
) {
  if (!bounds || edge <= 0) return 0;

  const coord = axis === 'y' ? point.y : point.x;
  const start = axis === 'y' ? bounds.top : bounds.left;
  const end = axis === 'y' ? bounds.bottom : bounds.right;

  // Numa lista mais estreita do que duas faixas as zonas sobrepõem-se; ganha o
  // início, que é o lado de onde se costuma vir.
  if (coord < start + edge) {
    const depth = Math.min(edge, start + edge - coord);
    return -(depth / edge) * maxSpeed;
  }
  if (coord > end - edge) {
    const depth = Math.min(edge, coord - (end - edge));
    return (depth / edge) * maxSpeed;
  }
  return 0;
}

/**
 * A tecla serve para reordenar? Separada do cálculo do destino porque o
 * componente precisa de saber isto *antes* de saber se o movimento é possível:
 * sem prevenir a tecla, uma seta no primeiro chip rolava a página em vez de
 * não fazer nada.
 *
 * @param {string} key valor de `KeyboardEvent.key`
 */
export function isReorderKey(key) {
  return (
    key === 'ArrowLeft' ||
    key === 'ArrowRight' ||
    key === 'ArrowUp' ||
    key === 'ArrowDown' ||
    key === 'Home' ||
    key === 'End'
  );
}

/**
 * Traduz uma tecla premida na alça de arrasto num índice de destino.
 *
 * Aceita os dois eixos de setas em qualquer estado da lista: quem navega por
 * teclado não tem de saber se a lista está encolhida (em linha) ou expandida
 * (em coluna) para acertar na seta certa.
 *
 * @param {number} currentIndex posição atual do chip
 * @param {string} key valor de `KeyboardEvent.key`
 * @param {number} total número de chips na lista
 * @returns {number | null} índice de destino, ou null se a tecla não reordena
 *                          ou o movimento sairia da lista
 */
export function computeKeyboardTarget(currentIndex, key, total) {
  if (!Number.isInteger(currentIndex) || !Number.isInteger(total)) return null;
  if (currentIndex < 0 || currentIndex >= total) return null;

  /** @type {number} */
  let target;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      target = currentIndex - 1;
      break;
    case 'ArrowRight':
    case 'ArrowDown':
      target = currentIndex + 1;
      break;
    case 'Home':
      target = 0;
      break;
    case 'End':
      target = total - 1;
      break;
    default:
      return null;
  }

  if (target < 0 || target >= total) return null;
  // Sem movimento não se mexe no store — evita gravações e anúncios inúteis.
  if (target === currentIndex) return null;
  return target;
}

/**
 * Já andou o suficiente para ser um arrasto e não um toque?
 *
 * Distância em linha reta, e não o maior dos eixos: um movimento diagonal
 * curto é tão intencional como um a direito, e tratá-lo por eixo obrigaria o
 * utilizador a arrastar mais para conseguir o mesmo.
 *
 * @param {number} dx deslocamento horizontal desde o pousar
 * @param {number} dy deslocamento vertical desde o pousar
 * @param {number} [threshold]
 */
export function hasPassedDragThreshold(dx, dy, threshold = DRAG_MOVE_THRESHOLD_PX) {
  return Math.hypot(dx, dy) >= threshold;
}
