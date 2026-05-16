/**
 * PdfSourceResolver
 *
 * Resolve a URL de um PDF para uma URL exibível, priorizando IndexedDB e Cache Storage.
 * Integra-se ao objectUrlManager para revogação automática de object URLs.
 */

import { fetchPdfAsBlob } from '$lib/utils/pdfUtils';
import { getConfig } from '$lib/offline/core/OfflineConfig';

/**
 * Resolve a URL de origem de um PDF. Se o PDF estiver no IndexedDB ou Cache Storage,
 * cria um object URL e retorna-o. Caso contrário, retorna a URL original.
 *
 * @param {string} fileUrl URL absoluta ou relativa do PDF
 * @param {{
 *   objectUrlManager: { create: (blob: Blob) => string, revoke: (url: string) => void },
 *   activeObjectUrl: string | null
 * }} opts
 * @returns {Promise<{ url: string, newObjectUrl: string | null }>}
 *   url: URL para passar ao PDF.js
 *   newObjectUrl: novo object URL criado (para que o componente atualize sua referência), ou null
 */
export async function resolvePdfSourceUrl(fileUrl, { objectUrlManager, activeObjectUrl }) {
  if (getConfig('OFFLINE_IDB_ENABLED') !== true) {
    return { url: fileUrl, newObjectUrl: null };
  }

  try {
    const pathname = new URL(fileUrl, window.location.origin).pathname;
    const blob = await fetchPdfAsBlob(pathname);
    if (!blob) return { url: fileUrl, newObjectUrl: null };

    // Revogar object URL anterior antes de criar um novo
    if (activeObjectUrl) {
      objectUrlManager.revoke(activeObjectUrl);
    }

    const newObjectUrl = objectUrlManager.create(blob);
    return { url: newObjectUrl, newObjectUrl };
  } catch {
    return { url: fileUrl, newObjectUrl: null };
  }
}
