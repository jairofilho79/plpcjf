/**
 * Preferências persistidas do leitor de PDF em localStorage.
 *
 * Todos os acessos passam por `safeStorage`. A guarda antiga
 * (`typeof window === 'undefined'`) foi removida de propósito: num navegador com
 * dados de site bloqueados ela é falsa e deixava passar o `getItem` que lança.
 * Como as três leituras correm em inicializador de instância de
 * `routes/leitor/+page.svelte`, esse throw abortava a construção do componente e
 * a página ficava em branco. `safeGet` devolve `null` nos dois casos — sem
 * armazenamento e com armazenamento hostil.
 */

import { safeGet, safeSet } from '../utils/safeStorage.js';

const KEYS = {
  FIT_MODE: 'pdfPreferredFitMode',
  NAV_MODE: 'pdfNavigationMode',
  BRIGHTNESS: 'pdfReaderBrightness',
};

/**
 * @returns {'page-fit' | 'page-width'}
 */
export function getFitMode() {
  const saved = safeGet(KEYS.FIT_MODE);
  return saved === 'page-width' || saved === 'page-fit' ? saved : 'page-fit';
}

/**
 * @param {'page-fit' | 'page-width'} mode
 */
export function setFitMode(mode) {
  safeSet(KEYS.FIT_MODE, mode);
}

/**
 * @returns {'horizontal' | 'vertical'}
 */
export function getNavigationMode() {
  const saved = safeGet(KEYS.NAV_MODE);
  return saved === 'vertical' ? 'vertical' : 'horizontal';
}

/**
 * @param {'horizontal' | 'vertical'} mode
 */
export function setNavigationMode(mode) {
  safeSet(KEYS.NAV_MODE, mode);
}

/** Predefinições de brilho, em % — 100 é o padrão (sem filtro). */
export const BRIGHTNESS_PRESETS = [100, 60, 130];
export const DEFAULT_BRIGHTNESS = 100;

/**
 * @returns {number}
 */
export function getBrightness() {
  const saved = safeGet(KEYS.BRIGHTNESS);
  // `Number('')` e `Number(null)` dão 0, que não está nos presets — o
  // `includes` abaixo já rejeita, mas o `saved === null` deixa a intenção clara.
  if (saved === null) return DEFAULT_BRIGHTNESS;
  const valor = Number(saved);
  return BRIGHTNESS_PRESETS.includes(valor) ? valor : DEFAULT_BRIGHTNESS;
}

/**
 * @param {number} value
 */
export function setBrightness(value) {
  safeSet(KEYS.BRIGHTNESS, String(value));
}
