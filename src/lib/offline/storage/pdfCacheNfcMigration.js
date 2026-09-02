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
 * A reescrita passa por `soMudouAFormaUnicode` (Fase 6): se a chave nova
 * diferir da antiga por algo além da forma Unicode, a entrada é pulada inteira
 * — nada é gravado, nada é apagado — e contada em `preservadas`. A guarda
 * decide ANTES do `put`: recusar depois de gravar deixaria a chave nova órfã no
 * cache, que é o defeito que a Fase 8 corrigiu.
 *
 * Recebe `cache` e `canonicalizar` por parâmetro para poder rodar sob
 * `node --test`, que não tem Cache Storage nem o alias `$lib`.
 */

/** Chave de localStorage que marca a migração como concluída neste aparelho. */
export const NFC_MIGRATION_FLAG = 'plpc_pdf_cache_nfc_migration_v1';

/**
 * A guarda que impede esta migração de apagar a chave boa (Fase 6).
 *
 * O `canonicalizar` injetado por `OfflineManager.ensureNfcMigration` decodifica
 * a pathname uma vez e entrega para `createRequestUrl`, que decodifica de novo
 * lá dentro — uma camada de decodificação a mais do que qualquer leitura normal
 * faz. Para um caminho com `%` embrulhado em três ou mais camadas de
 * `encodeURIComponent`, essa camada extra não muda a acentuação: come conteúdo
 * (ver `PdfPathManager.percentEncoding.test.js`). O resultado é uma chave nova
 * que **nenhuma leitura futura volta a construir** — e apagar a antiga, que é a
 * que o app continua pedindo, perde o PDF do usuário.
 *
 * A guarda óbvia não serve, e isto foi medido: "só apague se
 * `canonicalizar(urlNova)` for ponto fixo" dá `true` também para a chave
 * corrompida — a corrupção é estável sob `canonicalizar`.
 *
 * A guarda que serve é mais estreita, e é o próprio nome da migração: uma
 * migração NFC só deveria mudar a FORMA UNICODE da chave, nada mais. Decodifica
 * as duas pathnames uma vez e compara depois de `.normalize('NFC')` nas duas —
 * o que resta é exatamente a diferença que NÃO é de forma Unicode. Se sobrar
 * qualquer coisa, o tratamento de `%` mexeu em conteúdo, e não dá para apagar.
 *
 * @param {string} urlAntiga
 * @param {string} urlNova
 * @returns {boolean} true só quando a única diferença é a forma Unicode
 */
function soMudouAFormaUnicode(urlAntiga, urlNova) {
  try {
    // Uma chave de PDF não tem query nem fragmento. `createRequestUrl` codifica
    // com `createUrlUtf8`, que — como `encodeURI` — deixa `?` e `#` passarem sem
    // escape: um nome de arquivo com um deles vira delimitador de URL de
    // verdade. A partir daí `pathname` deixa de ser o caminho inteiro, e
    // comparar só `pathname` esconderia justamente o pedaço que sumiu.
    //
    // Comparar `search`/`hash` NÃO fecha o buraco: os dois devolvem `''` tanto
    // para "não tem" quanto para um delimitador final vazio. Numa chave
    // `https://plpcg.com/assets/x.pdf?` (caminho cru terminado em `%3F`), a
    // canonicalização engole o `?`, os dois lados dão `''`, as `pathname`
    // batem — e a guarda autorizaria apagar a chave que a leitura reconstrói.
    // Era o único falso negativo que sobrou na varredura adversarial.
    //
    // Sem conseguir provar nada, não se apaga.
    if (/[?#]/.test(urlAntiga) || /[?#]/.test(urlNova)) return false;

    const antiga = new URL(urlAntiga);
    const nova = new URL(urlNova);
    if (antiga.origin !== nova.origin) return false;
    return (
      decodeURIComponent(antiga.pathname).normalize('NFC') ===
      decodeURIComponent(nova.pathname).normalize('NFC')
    );
  } catch {
    // URL inválida, ou pathname que nem `decodeURIComponent` aceita: não dá
    // para provar que só a forma Unicode mudou, então não apaga.
    return false;
  }
}

/**
 * @param {Cache} cache - o cache `plpc-pdfs` já aberto
 * @param {(url: string) => string} canonicalizar - devolve a URL canônica de uma chave
 * @returns {Promise<{migradas: number, mantidas: number, preservadas: number, erros: number}>}
 */
export async function migrarChavesPdfParaNfc(cache, canonicalizar) {
  const resultado = { migradas: 0, mantidas: 0, preservadas: 0, erros: 0 };

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

    // Decidir ANTES de escrever. A guarda só olha para as duas URLs, não
    // precisa do corpo: quando ela recusa, nada é lido, nada é gravado, e o
    // cache fica exatamente como estava. (Fase 6 tinha esta verificação DEPOIS
    // do `put`, então uma recusa deixava a chave nova órfã no cache.)
    if (!soMudouAFormaUnicode(urlAntiga, urlNova)) {
      // A chave nova não é uma reescrita Unicode da antiga — o conteúdo mudou.
      // Fica só a antiga, que é a que toda leitura recalcula. Contada à parte,
      // nunca como migrada.
      resultado.preservadas++;
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
