import { toast } from 'svelte-sonner';
import AppSnackbarToast from '$lib/components/AppSnackbarToast.svelte';

const DURATIONS = {
  info: 10000,
  success: 3000,
  warning: 5000,
  error: 5000
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

  return toast.custom(AppSnackbarToast, {
    id: toastId,
    duration: durationMs,
    dismissible: true,
    componentProps: {
      toastId,
      variant,
      message,
      durationMs
    }
  });
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
  toast.dismiss(id);
}
