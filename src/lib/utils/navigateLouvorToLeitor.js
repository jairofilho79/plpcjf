import { goto } from '$app/navigation';
import { getPdfRelPath } from '$lib/utils/pathUtils';

/**
 * A mensagem é sobre o identificador, não sobre o PDF. Navegar na mesma dava
 * `/leitor?file=%2Fnull`, e o leitor concluía "PDF não está disponível
 * offline" — diagnóstico errado, que ainda mandava o utilizador para /offline
 * baixar um ficheiro que nunca ia resolver o problema.
 */
export const ERRO_IDENTIFICADOR_INVALIDO =
  'Este material tem um identificador inválido e não pode ser aberto.';

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
 * Esse caso passou a trazer `error` sempre. Antes devolvia `{ navigated: false }`
 * seco, e ambos os consumidores só mostram alguma coisa quando há `error`: o
 * clique não abria nada e também não dizia nada, e o utilizador só via o mesmo
 * ecrã de onde tinha clicado. `error` a mais é compatível com quem já lê
 * `result.error`; era a sua ausência que partia o contrato na prática.
 *
 * @param {LouvorNav} louvor
 * @returns {Promise<{ navigated: true } | { navigated: false, error: string }>}
 */
export async function navigateLouvorToLeitor(louvor) {
  const pdfPath = getPdfRelPath(louvor);
  if (!pdfPath) {
    return { navigated: false, error: ERRO_IDENTIFICADOR_INVALIDO };
  }

  const fileParam = encodeURIComponent(`/${pdfPath}`);
  const tituloParam = encodeURIComponent(louvor.nome || '');
  const subtituloText = `${louvor.categoria || ''} | ${louvor.classificacao || ''}`.trim();
  const subtituloParam = encodeURIComponent(subtituloText);

  await goto(`/leitor?file=${fileParam}&titulo=${tituloParam}&subtitulo=${subtituloParam}`);
  return { navigated: true };
}
