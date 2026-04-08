/**
 * Centralized object URL lifecycle utilities.
 * Always revoke URLs when no longer needed to avoid memory leaks.
 */

/**
 * @param {Blob} blob
 * @param {(url: string) => void} consumer
 * @param {{ revokeDelayMs?: number }} [options]
 */
export function withObjectUrl(blob, consumer, options = {}) {
  const revokeDelayMs = Number(options.revokeDelayMs || 0);
  const url = URL.createObjectURL(blob);

  try {
    consumer(url);
  } finally {
    // Some flows (window.open/share) need a short delay before revoke.
    if (revokeDelayMs > 0) {
      setTimeout(() => URL.revokeObjectURL(url), revokeDelayMs);
    } else {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Small manager for component lifecycle usage.
 */
export function createObjectUrlManager() {
  /** @type {Set<string>} */
  const active = new Set();

  return {
    create(blob) {
      const url = URL.createObjectURL(blob);
      active.add(url);
      return url;
    },
    revoke(url) {
      if (!url || !active.has(url)) return;
      URL.revokeObjectURL(url);
      active.delete(url);
    },
    revokeAll() {
      for (const url of active) {
        URL.revokeObjectURL(url);
      }
      active.clear();
    }
  };
}
