/**
 * A política de ordem do caminho de abertura de um PDF.
 *
 * Vive fora de `pdfValidation.js` por uma razão só: aquele módulo importa por
 * `$lib`, alias que só existe dentro do Vite, e por isso não carrega sob
 * `node --test`. A ordem das tentativas é justamente o que esta correção muda,
 * e mudança sem teste que a prenda volta sozinha — aqui os colaboradores
 * entram por parâmetro e um duplo consegue contar quantas vezes a rede foi
 * tocada. Sem `$lib`, sem `window`: importar por caminho relativo.
 */

/**
 * @typedef {{ available: boolean, needsDownload: boolean, url?: string | null, source?: string }} ValidationResult
 */

/**
 * Resolve a disponibilidade tentando primeiro o que não custa rede.
 *
 * A ordem antiga sondava a conectividade — 1,5 s de espera no pior caso —
 * *antes* de sequer olhar para o cache. Quem estava offline com o PDF já
 * baixado pagava esse tempo inteiro para receber a resposta que o cache tinha
 * de imediato. Invertido: a rede só entra quando o cache falhou, que é o único
 * caso em que ela pode acrescentar alguma coisa.
 *
 * @param {Object} deps
 * @param {(options: { useIndex: boolean, checkNetwork: boolean, pdfId?: string }) => Promise<ValidationResult>} deps.validate
 * @param {() => Promise<boolean>} deps.checkConnectivity
 * @param {string | null} [deps.pdfId]
 * @returns {Promise<ValidationResult>}
 */
export async function resolveAvailabilityInOrder({ validate, checkConnectivity, pdfId = null }) {
  // `undefined`, não `null`: é a ausência que as opções do CompositeValidator
  // declaram, e um `null` explícito faria a mesma coisa por acidente de tipo.
  const id = pdfId ?? undefined;

  const semRede = await validate({ useIndex: true, checkNetwork: false, pdfId: id });
  if (semRede?.available) {
    return semRede;
  }

  // Só agora a sonda vale o que custa: sem cache, a resposta depende mesmo de
  // haver rede.
  const online = await checkConnectivity();
  if (!online) {
    // Repetir com `checkNetwork: true` estando offline daria exatamente o mesmo
    // resultado — o validador de rede é pulado quando não há rede.
    return semRede;
  }

  return await validate({ useIndex: true, checkNetwork: true, pdfId: id });
}

/**
 * Contrato de `ensurePdfAvailable`: uma pergunta, uma resposta.
 *
 * Já não baixa o ficheiro. Quem abre um PDF não precisa de o ter em cache
 * antes de o ver: o Service Worker busca-o da rede ao renderizar, e o
 * auto-download que estava aqui fazia o mesmo ficheiro ser transferido duas
 * vezes — a primeira só para que a segunda pudesse começar.
 *
 * O `pdfId` viaja porque é ele que autoriza a memorização do resultado. Sem
 * ele, um PDF disponível nunca era memorizado e o custo repetia-se em cada
 * clique, para sempre.
 *
 * @param {string} pdfPath
 * @param {string | null | undefined} pdfId
 * @param {(pdfPath: string, pdfId?: string | null) => Promise<ValidationResult>} validate
 * @returns {Promise<boolean>}
 */
export async function ensureAvailability(pdfPath, pdfId, validate) {
  const validation = await validate(pdfPath, pdfId);
  return validation?.available === true;
}
