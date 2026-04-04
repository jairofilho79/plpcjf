import { writable } from 'svelte/store';

const DURATIONS = {
  info: 10000,
  success: 3000,
  warning: 5000,
  error: 5000
};

const MAX_VISIBLE_SNACKBARS = 3;
const snackbarsStore = writable([]);
const timers = new Map();

export const appSnackbars = {
  subscribe: snackbarsStore.subscribe
};

function makeToastId(prefix = 'snackbar') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Exibe snackbar reutilizavel com anel regressivo.
 * @param {'info'|'success'|'warning'|'error'} variant
 * @param {string} message
 * @param {{ durationMs?: number, id?: string|number }} [options]
 * @returns {string|number}
 */
export function showSnackbar(variant, message, options = {}) {
  const durationMs = options.durationMs ?? DURATIONS[variant] ?? 4000;
  const toastId = options.id ?? makeToastId(variant);
  const createdAt = Date.now();
  const snackbar = {
    id: toastId,
    variant,
    message,
    durationMs,
    createdAt
  };

  snackbarsStore.update((items) => {
    const withoutSameId = items.filter((item) => item.id !== toastId);
    const nextItems = [...withoutSameId, snackbar];
    return nextItems.slice(-MAX_VISIBLE_SNACKBARS);
  });

  if (timers.has(toastId)) {
    clearTimeout(timers.get(toastId));
  }

  timers.set(
    toastId,
    setTimeout(() => {
      dismissSnackbar(toastId);
    }, durationMs)
  );

  return toastId;
}

export function showInfoSnackbar(message, options) {
  return showSnackbar('info', message, options);
}

export function showSuccessSnackbar(message, options) {
  return showSnackbar('success', message, options);
}

export function showWarningSnackbar(message, options) {
  return showSnackbar('warning', message, options);
}

export function showErrorSnackbar(message, options) {
  return showSnackbar('error', message, options);
}

export function dismissSnackbar(id) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }

  snackbarsStore.update((items) => items.filter((item) => item.id !== id));
}
