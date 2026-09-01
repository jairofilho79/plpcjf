/**
 * Preferências persistidas do leitor de PDF em localStorage.
 */

const KEYS = {
  FIT_MODE: 'pdfPreferredFitMode',
  NAV_MODE: 'pdfNavigationMode',
  BRIGHTNESS: 'pdfReaderBrightness',
};

/**
 * @returns {'page-fit' | 'page-width'}
 */
export function getFitMode() {
  if (typeof window === 'undefined') return 'page-fit';
  const saved = localStorage.getItem(KEYS.FIT_MODE);
  return saved === 'page-width' || saved === 'page-fit' ? saved : 'page-fit';
}

/**
 * @param {'page-fit' | 'page-width'} mode
 */
export function setFitMode(mode) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEYS.FIT_MODE, mode);
}

/**
 * @returns {'horizontal' | 'vertical'}
 */
export function getNavigationMode() {
  if (typeof window === 'undefined') return 'horizontal';
  const saved = localStorage.getItem(KEYS.NAV_MODE);
  return saved === 'vertical' ? 'vertical' : 'horizontal';
}

/**
 * @param {'horizontal' | 'vertical'} mode
 */
export function setNavigationMode(mode) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEYS.NAV_MODE, mode);
}

/** Predefinições de brilho, em % — 100 é o padrão (sem filtro). */
export const BRIGHTNESS_PRESETS = [100, 60, 130];
export const DEFAULT_BRIGHTNESS = 100;

/**
 * @returns {number}
 */
export function getBrightness() {
  if (typeof window === 'undefined') return DEFAULT_BRIGHTNESS;
  const saved = Number(localStorage.getItem(KEYS.BRIGHTNESS));
  return BRIGHTNESS_PRESETS.includes(saved) ? saved : DEFAULT_BRIGHTNESS;
}

/**
 * @param {number} value
 */
export function setBrightness(value) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEYS.BRIGHTNESS, String(value));
}
