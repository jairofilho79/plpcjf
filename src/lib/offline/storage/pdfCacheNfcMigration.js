/**
 * Migração única das chaves do cache de PDFs para a forma Unicode NFC (#22.2).
 *
 * Oito caminhos do acervo chegam do `pdfId` em NFD. Antes de #22.2 eles eram
 * gravados assim; depois de #22.2 o app procura a forma NFC, e `cache.match` é
 * comparação byte a byte de URL. Sem esta varredura, esses PDFs somem em
 * silêncio para quem está offline.
 *
 * Custo: uma passada por `cache.keys()` (só metadados) e uma reescrita para
 * cada chave que não estiver canônica — na prática, no máximo oito. Sem rede.
 * Grava a chave nova ANTES de apagar a velha: uma interrupção deixa as duas
 * chaves apontando para o mesmo PDF, o que é inofensivo, e nunca nenhuma.
 * Idempotente: rodar de novo não faz nada.
 *
 * Recebe `cache` e `canonicalizar` por parâmetro para poder rodar sob
 * `node --test`, que não tem Cache Storage nem o alias `$lib`.
 */

/** Chave de localStorage que marca a migração como concluída neste aparelho. */
export const NFC_MIGRATION_FLAG = 'plpc_pdf_cache_nfc_migration_v1';

/**
 * @param {Cache} cache - o cache `plpc-pdfs` já aberto
 * @param {(url: string) => string} canonicalizar - devolve a URL canônica de uma chave
 * @returns {Promise<{migradas: number, mantidas: number, erros: number}>}
 */
export async function migrarChavesPdfParaNfc(cache, canonicalizar) {
  const resultado = { migradas: 0, mantidas: 0, erros: 0 };

  const chaves = await cache.keys();

  for (const requisicao of chaves) {
    const urlAntiga = requisicao.url;
    let urlNova = '';
    try {
      urlNova = canonicalizar(urlAntiga);
    } catch {
      resultado.erros++;
      continue;
    }

    if (!urlNova || urlNova === urlAntiga) {
      resultado.mantidas++;
      continue;
    }

    try {
      const resposta = await cache.match(requisicao);
      if (!resposta) {
        resultado.erros++;
        continue;
      }
      // Primeiro grava a nova. Só então apaga a velha.
      await cache.put(urlNova, resposta.clone());
    } catch {
      resultado.erros++;
      continue;
    }

    try {
      await cache.delete(requisicao);
      resultado.migradas++;
    } catch {
      // A entrada nova já existe; a velha ficou para trás. Inofensivo.
      resultado.erros++;
    }
  }

  return resultado;
}
