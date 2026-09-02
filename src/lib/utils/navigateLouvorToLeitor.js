import { goto } from '$app/navigation';
import { getPdfRelPath } from '$lib/utils/pathUtils';

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
 * Navega para /leitor. Não valida nada antes: o leitor resolve a origem do PDF
 * sozinho — cache do Service Worker, depois rede — e só diagnostica quando isso
 * falha, que é o caso raro.
 *
 * Validar aqui custava duas sondas de conectividade e cinco pedidos do mesmo
 * PDF, o download completo incluído, antes de a navegação sequer começar. A
 * assinatura pública fica: o `{ navigated, error }` continua a ser o que
 * `CarouselChips.svelte` e `/listas` esperam receber, e `error` continua
 * possível para o único caso que ainda existe — não haver caminho de PDF.
 *
 * @param {LouvorNav} louvor
 * @returns {Promise<{ navigated: true } | { navigated: false, error?: string }>}
 */
export async function navigateLouvorToLeitor(louvor) {
  const pdfPath = getPdfRelPath(louvor);
  if (!pdfPath) {
    return { navigated: false };
  }

  const fileParam = encodeURIComponent(`/${pdfPath}`);
  const tituloParam = encodeURIComponent(louvor.nome || '');
  const subtituloText = `${louvor.categoria || ''} | ${louvor.classificacao || ''}`.trim();
  const subtituloParam = encodeURIComponent(subtituloText);

  await goto(`/leitor?file=${fileParam}&titulo=${tituloParam}&subtitulo=${subtituloParam}`);
  return { navigated: true };
}
