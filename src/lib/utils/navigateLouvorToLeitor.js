import { goto } from '$app/navigation';
import { getPdfRelPath } from '$lib/utils/pathUtils';
import { isPdfAvailableInIndex } from '$lib/utils/pdfIndex';
import { ensurePdfAvailable, getCachedValidation } from '$lib/utils/pdfValidation';

const OFFLINE_ERROR =
  'PDF não está disponível offline. Por favor, baixe primeiro na página de configuração offline.';

/**
 * @typedef {{
 *   pdfId: string;
 *   nome?: string;
 *   categoria?: string;
 *   classificacao?: string;
 *   pdf?: string;
 * }} LouvorNav
 */

/**
 * Navigate to /leitor for a louvor with the same validation flow as carousel chips.
 * @param {LouvorNav} louvor
 * @returns {Promise<{ navigated: true } | { navigated: false, error?: string }>}
 */
export async function navigateLouvorToLeitor(louvor) {
  const pdfPath = getPdfRelPath(louvor);
  if (!pdfPath) {
    return { navigated: false };
  }

  try {
    const cached = getCachedValidation(louvor.pdfId);
    if (cached && cached.available) {
      const fileParam = encodeURIComponent(`/${pdfPath}`);
      const tituloParam = encodeURIComponent(louvor.nome || '');
      const subtituloText = `${louvor.categoria || ''} | ${louvor.classificacao || ''}`.trim();
      const subtituloParam = encodeURIComponent(subtituloText);
      const url = `/leitor?file=${fileParam}&titulo=${tituloParam}&subtitulo=${subtituloParam}&validated=true`;
      await goto(url);
      return { navigated: true };
    }

    const indexCheck = isPdfAvailableInIndex(louvor.pdfId);
    let shouldProceed = false;

    if (indexCheck === true) {
      try {
        const { validatePdfAvailability } = await import('$lib/utils/pdfValidation');
        const quickValidation = await validatePdfAvailability(pdfPath, louvor.pdfId);
        if (quickValidation.available) {
          shouldProceed = true;
        } else if (quickValidation.needsDownload && navigator.onLine) {
          shouldProceed = true;
        }
      } catch (err) {
        console.warn('[navigateLouvorToLeitor] Quick validation failed, proceeding anyway:', err);
        shouldProceed = true;
      }
    } else {
      const isAvailable = await ensurePdfAvailable(pdfPath);

      if (isAvailable) {
        shouldProceed = true;
      } else {
        const { validatePdfAvailability } = await import('$lib/utils/pdfValidation');
        const validation = await validatePdfAvailability(pdfPath, louvor.pdfId);
        if (validation.needsDownload && navigator.onLine) {
          shouldProceed = true;
        } else if (!navigator.onLine && validation.available === false) {
          return { navigated: false, error: OFFLINE_ERROR };
        } else {
          console.warn(
            '[navigateLouvorToLeitor] Validation uncertain, allowing navigation - leitor will handle errors'
          );
          shouldProceed = true;
        }
      }
    }

    if (shouldProceed) {
      const fileParam = encodeURIComponent(`/${pdfPath}`);
      const tituloParam = encodeURIComponent(louvor.nome || '');
      const subtituloText = `${louvor.categoria || ''} | ${louvor.classificacao || ''}`.trim();
      const subtituloParam = encodeURIComponent(subtituloText);
      const url = `/leitor?file=${fileParam}&titulo=${tituloParam}&subtitulo=${subtituloParam}&validated=true`;
      await goto(url);
      return { navigated: true };
    }
  } catch (err) {
    console.error('Erro ao validar PDF:', err);
    const fileParam = encodeURIComponent(`/${pdfPath}`);
    const tituloParam = encodeURIComponent(louvor.nome || '');
    const subtituloText = `${louvor.categoria || ''} | ${louvor.classificacao || ''}`.trim();
    const subtituloParam = encodeURIComponent(subtituloText);
    const url = `/leitor?file=${fileParam}&titulo=${tituloParam}&subtitulo=${subtituloParam}`;
    await goto(url);
    return { navigated: true };
  }

  return { navigated: false };
}
