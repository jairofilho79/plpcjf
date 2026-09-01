/**
 * Verificação de "parte já baixada" contra o cache real.
 *
 * Extraído de `stores/offline.js` para ser testável sob `node --test`: as duas
 * funções são puras, e só a resolução de caminho (`getPdfRelPath`) precisa vir
 * de fora — é a única parte que depende de `$lib/utils/pathUtils`.
 */

/**
 * Caminhos relativos ("assets/…") dos PDFs declarados em uma parte do manifesto.
 *
 * Qualquer id que não resolva vira parte do `unresolved` em vez de sumir do
 * array em silêncio — sem isso, uma parte com PDFs "invisíveis" para o
 * resolvedor podia ser marcada como completa tendo verificado só o que sobrou.
 *
 * @param {any} part
 * @param {(louvor: { pdfId: string }) => string | null | undefined} getPdfRelPath
 * @returns {{ paths: string[], unresolved: number }}
 */
export function getPartPdfPaths(part, getPdfRelPath) {
  const ids = Array.isArray(part?.pdfs) ? part.pdfs : [];
  /** @type {string[]} */
  const paths = [];
  let unresolved = 0;
  for (const pdfId of ids) {
    if (typeof pdfId !== 'string') {
      unresolved++;
      continue;
    }
    const relPath = getPdfRelPath({ pdfId });
    if (relPath) {
      paths.push(relPath);
    } else {
      unresolved++;
    }
  }
  return { paths, unresolved };
}

/**
 * Decide se uma parte marcada como concluída pode mesmo ser pulada.
 *
 * Só pula se todos os PDFs declarados na parte estiverem de fato no cache **e**
 * todos tiverem sido resolvidos — um id que não resolveu não é "não conta",
 * é "não sei", e "não sei" não pode virar "completo".
 *
 * @param {any} part
 * @param {Set<string> | null} cachedPaths
 * @param {(louvor: { pdfId: string }) => string | null | undefined} getPdfRelPath
 * @returns {{ skippable: boolean, paths: string[] }}
 */
export function verifyCompletedPart(part, cachedPaths, getPdfRelPath) {
  const { paths, unresolved } = getPartPdfPaths(part, getPdfRelPath);
  if (!cachedPaths || paths.length === 0 || unresolved > 0) {
    return { skippable: false, paths };
  }
  const skippable = paths.every((path) => cachedPaths.has(path));
  return { skippable, paths };
}
